#!/usr/bin/env python3
"""Serve FleetCom and optionally bridge to Automaton's MQTT broker over TCP."""
from __future__ import annotations

import json
import socket
import struct
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
ROSTER = ROOT / "data" / "roster.json"
MQTT_CFG = ROOT / "data" / "mqtt.json"
HOST = "0.0.0.0"
PORT = 8080


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def read_roster() -> list:
    data = read_json(ROSTER, [])
    return data if isinstance(data, list) else []


def write_roster(data: list) -> None:
    write_json(ROSTER, data)


def mqtt_defaults() -> dict:
    return {
        "host": "framland.duckdns.org",
        "port": 1883,
        "username": "",
        "password": "",
        "client_id": "fleetcom-bridge",
    }


def read_mqtt_cfg() -> dict:
    cfg = mqtt_defaults()
    raw = read_json(MQTT_CFG, {})
    if isinstance(raw, dict):
        cfg.update({k: raw[k] for k in raw if k in cfg or k in ("host", "port", "username", "password")})
    cfg["port"] = int(cfg.get("port") or 1883)
    return cfg


def encode_remaining(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n % 128
        n //= 128
        if n:
            byte |= 0x80
        out.append(byte)
        if not n:
            return bytes(out)


def encode_str(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack("!H", len(b)) + b


class MqttBridge:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.sock: socket.socket | None = None
        self.connected = False
        self.error = "not started"
        self.host = ""
        self.port = 1883
        self.inbox: list[dict[str, Any]] = []
        self.cursor = 0
        self._stop = False
        self._mid = 1

    def next_mid(self) -> int:
        self._mid = self._mid + 1 if self._mid < 65535 else 1
        return self._mid

    def _send(self, packet: bytes) -> None:
        if not self.sock:
            raise OSError("no socket")
        self.sock.sendall(packet)

    def _recv_exact(self, n: int) -> bytes:
        buf = b""
        assert self.sock is not None
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("broker closed")
            buf += chunk
        return buf

    def _recv_packet(self) -> tuple[int, bytes]:
        header = self._recv_exact(1)
        multiplier = 1
        length = 0
        while True:
            byte = self._recv_exact(1)[0]
            length += (byte & 127) * multiplier
            if byte & 128 == 0:
                break
            multiplier *= 128
        payload = self._recv_exact(length) if length else b""
        return header[0], payload

    def _connect_once(self, cfg: dict) -> None:
        self.host = cfg["host"]
        self.port = int(cfg["port"])
        s = socket.create_connection((self.host, self.port), timeout=8)
        s.settimeout(30)
        self.sock = s
        proto = encode_str("MQTT")
        flags = 0x02  # clean session
        payload = encode_str(cfg.get("client_id") or "fleetcom-bridge")
        user = str(cfg.get("username") or "")
        pwd = str(cfg.get("password") or "")
        if user:
            flags |= 0x80
            payload += encode_str(user)
            if pwd:
                flags |= 0x40
                payload += encode_str(pwd)
        variable = proto + bytes([4, flags]) + struct.pack("!H", 30)
        remaining = variable + payload
        packet = bytes([0x10]) + encode_remaining(len(remaining)) + remaining
        self._send(packet)
        cmd, body = self._recv_packet()
        if cmd >> 4 != 2 or len(body) < 2 or body[1] != 0:
            code = body[1] if len(body) > 1 else -1
            reasons = {
                1: "unacceptable protocol",
                2: "client id rejected",
                3: "broker unavailable",
                4: "bad username or password",
                5: "not authorized",
            }
            raise ConnectionError(reasons.get(code, f"CONNACK refused ({code})"))
        # subscribe fleet/#
        mid = self.next_mid()
        sub = struct.pack("!H", mid) + encode_str("fleet/#") + bytes([1])
        self._send(bytes([0x82]) + encode_remaining(len(sub)) + sub)
        self.connected = True
        self.error = ""

    def publish(self, topic: str, payload: Any, qos: int = 1, retain: bool = False) -> None:
        raw = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode("utf-8")
        qos = 1 if qos else 0
        flags = 0x30 | (qos << 1) | (1 if retain else 0)
        mid = self.next_mid()
        body = encode_str(topic)
        if qos:
            body += struct.pack("!H", mid)
        body += raw
        with self.lock:
            if not self.connected or not self.sock:
                raise ConnectionError("offline")
            self._send(bytes([flags]) + encode_remaining(len(body)) + body)

    def _handle(self, cmd: int, body: bytes) -> None:
        kind = cmd >> 4
        if kind == 3:  # PUBLISH
            if len(body) < 2:
                return
            tlen = struct.unpack("!H", body[:2])[0]
            topic = body[2:2 + tlen].decode("utf-8", "replace")
            qos = (cmd >> 1) & 0x03
            idx = 2 + tlen
            if qos:
                mid = struct.unpack("!H", body[idx:idx + 2])[0]
                idx += 2
                try:
                    self._send(bytes([0x40, 0x02]) + struct.pack("!H", mid))
                except OSError:
                    pass
            raw = body[idx:]
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                payload = {"text": raw.decode("utf-8", "replace")}
            with self.lock:
                self.cursor += 1
                self.inbox.append({"id": self.cursor, "topic": topic, "payload": payload})
                if len(self.inbox) > 500:
                    self.inbox = self.inbox[-300:]
            if topic == "fleet/office/roster" and isinstance(payload, list):
                write_roster(payload)
        elif kind == 13:  # PINGRESP
            pass

    def loop(self) -> None:
        while not self._stop:
            cfg = read_mqtt_cfg()
            try:
                with self.lock:
                    self.connected = False
                    self.error = "connecting"
                self._connect_once(cfg)
                while not self._stop:
                    try:
                        cmd, body = self._recv_packet()
                    except socket.timeout:
                        try:
                            self._send(bytes([0xC0, 0x00]))
                        except OSError:
                            raise
                        continue
                    self._handle(cmd, body)
            except Exception as exc:
                with self.lock:
                    self.connected = False
                    self.error = str(exc)
                if self.sock:
                    try:
                        self.sock.close()
                    except OSError:
                        pass
                    self.sock = None
                time.sleep(4)

    def start(self) -> None:
        threading.Thread(target=self.loop, name="mqtt-bridge", daemon=True).start()

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "connected": self.connected,
                "error": self.error,
                "host": self.host,
                "port": self.port,
            }

    def poll(self, since: int) -> dict:
        with self.lock:
            msgs = [m for m in self.inbox if m["id"] > since]
            return {
                "connected": self.connected,
                "error": self.error,
                "host": self.host,
                "port": self.port,
                "cursor": self.cursor,
                "messages": [{"topic": m["topic"], "payload": m["payload"]} for m in msgs],
            }


BRIDGE = MqttBridge()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def _json(self, code: int, obj) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/roster":
            self._json(200, read_roster())
            return
        if path == "/api/mqtt/status":
            self._json(200, BRIDGE.snapshot())
            return
        if path == "/api/mqtt/poll":
            qs = parse_qs(parsed.query)
            since = int((qs.get("since") or ["0"])[0] or 0)
            self._json(200, BRIDGE.poll(since))
            return
        if path == "/api/mqtt/config":
            cfg = read_mqtt_cfg()
            cfg["password"] = "" if not cfg.get("password") else "****"
            self._json(200, cfg)
            return
        return super().do_GET()

    def do_PUT(self):
        if urlparse(self.path).path != "/api/roster":
            self.send_error(404)
            return
        try:
            data = self._read_json()
            if not isinstance(data, list):
                raise ValueError("roster must be a list")
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
            self.send_error(400, "Invalid roster JSON")
            return
        write_roster(data)
        try:
            BRIDGE.publish("fleet/office/roster", data, qos=1, retain=True)
        except Exception:
            pass
        self._json(200, data)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/mqtt/pub":
            try:
                data = self._read_json()
                topic = str(data.get("topic") or "")
                if not topic.startswith("fleet/"):
                    self._json(400, {"ok": False, "error": "topic must be under fleet/"})
                    return
                BRIDGE.publish(topic, data.get("payload"), qos=int(data.get("qos") or 1), retain=bool(data.get("retain")))
                self._json(200, {"ok": True})
            except Exception as exc:
                self._json(503, {"ok": False, "error": str(exc)})
            return
        if path == "/api/mqtt/config":
            try:
                incoming = self._read_json()
            except json.JSONDecodeError:
                self.send_error(400)
                return
            cfg = read_mqtt_cfg()
            for key in ("host", "username", "password", "client_id"):
                if key in incoming and incoming[key] is not None:
                    cfg[key] = incoming[key]
            if "port" in incoming:
                cfg["port"] = int(incoming["port"] or 1883)
            write_json(MQTT_CFG, cfg)
            self._json(200, {"ok": True})
            return
        self.send_error(404)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    ROSTER.parent.mkdir(parents=True, exist_ok=True)
    if not ROSTER.exists():
        write_roster([])
    if not MQTT_CFG.exists():
        write_json(MQTT_CFG, mqtt_defaults())
    BRIDGE.start()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    cfg = read_mqtt_cfg()
    print(f"FleetCom  http://127.0.0.1:{PORT}/office.html")
    print(f"           http://127.0.0.1:{PORT}/bus.html")
    print(f"MQTT TCP   {cfg['host']}:{cfg['port']} (Automaton via DDNS)")
    httpd.serve_forever()
