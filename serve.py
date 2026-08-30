#!/usr/bin/env python3
"""Serve FleetCom mocks and persist the office-maintained bus roster."""
from __future__ import annotations

import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ROSTER = ROOT / "data" / "roster.json"
HOST = "0.0.0.0"
PORT = 8080


def read_roster() -> list:
    if not ROSTER.exists():
        return []
    try:
        data = json.loads(ROSTER.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def write_roster(data: list) -> None:
    ROSTER.parent.mkdir(parents=True, exist_ok=True)
    ROSTER.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/roster":
            body = json.dumps(read_roster()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_PUT(self):
        if self.path.split("?", 1)[0] != "/api/roster":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"[]"
        try:
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, list):
                raise ValueError("roster must be a list")
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
            self.send_error(400, "Invalid roster JSON")
            return
        write_roster(data)
        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    ROSTER.parent.mkdir(parents=True, exist_ok=True)
    if not ROSTER.exists():
        write_roster([])
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"FleetCom  http://127.0.0.1:{PORT}/office.html")
    print(f"           http://127.0.0.1:{PORT}/bus.html")
    print(f"Roster     {ROSTER}")
    httpd.serve_forever()
