/* FleetCom MQTT client.
   Prefers MQTT.js over WebSocket to Automaton (framland.duckdns.org).
   Falls back to serve.py /api/mqtt/* which speaks MQTT TCP 1883. */
(function (global) {
  const STORE = "fleetcom.mqtt";
  const listeners = { status: new Set(), message: new Set() };
  let client = null;
  let mode = "off"; /* off | ws | bridge */
  let status = "offline";
  let statusText = "MQTT off";
  let lastKind = ""; /* "" | need-auth | bad-auth | net */
  let cfg = loadCfg();
  let bridgeTimer = null;
  let seen = new Set();

  function loadCfg() {
    const d = Object.assign({}, global.FLEET_MQTT_DEFAULTS || {});
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) Object.assign(d, JSON.parse(raw));
    } catch (_) {}
    return d;
  }

  function saveCfg(next) {
    cfg = Object.assign({}, cfg, next);
    localStorage.setItem(STORE, JSON.stringify({
      host: cfg.host,
      wsPort: Number(cfg.wsPort) || 9001,
      wssPort: Number(cfg.wssPort) || 443,
      wsPath: cfg.wsPath || "/mqtt",
      tcpPort: Number(cfg.tcpPort) || 1883,
      useTLS: !!cfg.useTLS,
      username: cfg.username || "",
      password: cfg.password || "",
      altWsPorts: cfg.altWsPorts
    }));
  }

  function setStatus(s, text, kind) {
    status = s;
    statusText = text;
    if (kind) lastKind = kind;
    listeners.status.forEach((fn) => fn(s, text, mode));
  }

  function emit(topic, payload, retain) {
    listeners.message.forEach((fn) => fn(topic, payload, retain));
  }

  function parsePayload(buf) {
    const s = typeof buf === "string" ? buf : new TextDecoder().decode(buf);
    try { return JSON.parse(s); } catch (_) { return { text: s }; }
  }

  function pageIsHttps() {
    try { return location.protocol === "https:"; } catch (_) { return false; }
  }

  function canUseBridge() {
    try {
      if (/\.github\.io$/i.test(location.hostname)) return false;
    } catch (_) {}
    return true;
  }

  function wsUrl(port, tls) {
    const proto = tls ? "wss" : "ws";
    const path = cfg.wsPath && cfg.wsPath.charAt(0) === "/" ? cfg.wsPath : "/" + (cfg.wsPath || "mqtt");
    const hidePort = (tls && Number(port) === 443) || (!tls && Number(port) === 80);
    return proto + "://" + cfg.host + (hidePort ? "" : ":" + port) + path;
  }

  function classifyErr(err) {
    const msg = (err && err.message) ? err.message : String(err || "");
    const code = Number(err && err.code);
    if (code === 4 || /bad user|bad username or password/i.test(msg)) return "bad-auth";
    if (code === 5 || /not authorized|connack refused \(5\)/i.test(msg)) {
      return cfg.username ? "bad-auth" : "need-auth";
    }
    if (/CONNACK refused \(4\)|bad username/i.test(msg)) return "bad-auth";
    if (/closed ws:|closed wss:|CONNACK|Not authorized/i.test(msg)) {
      return cfg.username ? "bad-auth" : "need-auth";
    }
    return "net";
  }

  function authMessage(kind) {
    if (kind === "need-auth") return "Automaton requires an MQTT username and password";
    if (kind === "bad-auth") {
      return "Automaton rejected user \"" + (cfg.username || "") + "\" (CONNACK 5). Add that user with mosquitto_passwd on the server.";
    }
    return "";
  }

  function handlePacket(topic, payload) {
    if (payload && payload.msg_id) {
      const key = payload.msg_id + "|" + (payload.status || "") + "|" + topic;
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 400) seen = new Set(Array.from(seen).slice(-200));
    }
    emit(topic, payload, false);
  }

  function connectWs(port, tls) {
    return new Promise((resolve, reject) => {
      if (typeof mqtt === "undefined") {
        reject(new Error("mqtt.js missing"));
        return;
      }
      const url = wsUrl(port, tls);
      const opts = {
        clientId: "fleetcom-" + Math.random().toString(16).slice(2, 10),
        reconnectPeriod: 0,
        connectTimeout: 5000,
        keepalive: 30,
        clean: true,
        protocolVersion: 4
      };
      if (cfg.username) opts.username = cfg.username;
      if (cfg.password) opts.password = cfg.password;
      const c = mqtt.connect(url, opts);
      let settled = false;
      const finish = (err, ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        if (err) {
          try { c.end(true); } catch (_) {}
          reject(err);
        } else {
          resolve(ok);
        }
      };
      const t = setTimeout(() => finish(new Error("timeout " + url)), 6000);
      c.on("connect", () => finish(null, c));
      c.on("packetreceive", (packet) => {
        if (!packet || packet.cmd !== "connack") return;
        const rc = packet.returnCode != null ? packet.returnCode : packet.reasonCode;
        if (rc) {
          const e = new Error("CONNACK refused (" + rc + ")");
          e.code = rc;
          finish(e);
        }
      });
      c.on("error", (e) => {
        const err = e || new Error("MQTT error at " + url);
        if (e && e.code != null) err.code = e.code;
        finish(err);
      });
      c.on("close", () => {
        if (settled) return;
        const e = new Error("closed " + url);
        e.code = cfg.username ? 4 : 5;
        finish(e);
      });
    });
  }

  async function tryWebSocket() {
    const httpsPage = pageIsHttps();
    const attempts = [];
    if (httpsPage || cfg.useTLS) {
      attempts.push({ tls: true, port: Number(cfg.wssPort) || 443, label: "WSS :443" });
    }
    if (!httpsPage) {
      attempts.push({ tls: false, port: Number(cfg.wsPort) || 9001, label: "WS :" + (cfg.wsPort || 9001) });
    }
    let last = null;
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      setStatus("connecting", a.label + " " + cfg.host);
      try {
        const c = await connectWs(a.port, a.tls);
        if (a.tls) cfg.wssPort = a.port;
        else cfg.wsPort = a.port;
        cfg.useTLS = a.tls;
        return c;
      } catch (e) {
        last = e;
        const kind = classifyErr(e);
        e.fleetKind = kind;
        if (kind === "need-auth" || kind === "bad-auth") throw e;
      }
    }
    throw last || new Error(httpsPage
      ? "GitHub Pages needs wss://" + cfg.host + "/mqtt on port 443"
      : "no websocket listener");
  }

  function wireWs(c) {
    client = c;
    mode = "ws";
    c.options.reconnectPeriod = 4000;
    setStatus("online", (cfg.useTLS ? "MQTT WSS " : "MQTT WS ") + cfg.host + (cfg.useTLS ? "" : ":" + cfg.wsPort), "ok");
    c.subscribe([
      "fleet/buses/+/messages/out",
      "fleet/buses/+/messages/in",
      "fleet/buses/+/status",
      "fleet/buses/+/ack",
      "fleet/office/broadcast",
      "fleet/office/roster",
      "fleet/office/messages",
      "fleet/system/heartbeat"
    ], { qos: 1 });
    c.on("message", (topic, buf) => handlePacket(topic, parsePayload(buf)));
    c.on("close", () => {
      if (mode === "ws") setStatus("offline", "MQTT dropped");
    });
    c.on("reconnect", () => setStatus("connecting", "MQTT reconnect"));
    c.on("connect", () => setStatus("online", (cfg.useTLS ? "MQTT WSS " : "MQTT WS ") + cfg.host + (cfg.useTLS ? "" : ":" + cfg.wsPort), "ok"));
    c.on("error", (e) => {
      const kind = classifyErr(e);
      if (kind === "need-auth" || kind === "bad-auth") {
        setStatus("offline", authMessage(kind), kind);
      }
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function tryBridge() {
    let lastErr = new Error("no bridge");
    for (let i = 0; i < 3; i++) {
      let info;
      try {
        const res = await fetch("/api/mqtt/status", { cache: "no-store" });
        if (!res.ok) throw new Error("no bridge");
        info = await res.json();
      } catch (e) {
        lastErr = e;
        await sleep(700);
        continue;
      }
      if (info.connected) {
        mode = "bridge";
        setStatus("online", "MQTT via serve.py → " + (info.host || cfg.host) + ":" + (info.port || cfg.tcpPort), "ok");
        startBridgePoll();
        return;
      }
      const err = new Error(info.error || "bridge offline");
      const kind = classifyErr(err);
      err.fleetKind = kind;
      lastErr = err;
      if (kind === "need-auth" || kind === "bad-auth") throw err;
      setStatus("connecting", i ? "TCP bridge retry" : "TCP bridge via serve.py");
      await sleep(700);
    }
    throw lastErr;
  }

  function startBridgePoll() {
    if (bridgeTimer) clearInterval(bridgeTimer);
    let since = 0;
    async function pull() {
      try {
        const r = await fetch("/api/mqtt/poll?since=" + since, { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        since = data.cursor || since;
        (data.messages || []).forEach((m) => handlePacket(m.topic, m.payload));
        if (data.connected) setStatus("online", "MQTT via serve.py → " + (data.host || cfg.host), "ok");
        else {
          const kind = classifyErr(data.error || "");
          setStatus("connecting", kind === "need-auth" || kind === "bad-auth" ? authMessage(kind) : "bridge reconnecting", kind);
        }
      } catch (_) {}
    }
    pull();
    bridgeTimer = setInterval(pull, 1200);
  }

  const Mqtt = {
    getConfig() { return Object.assign({}, cfg); },
    setConfig(next) { saveCfg(next); cfg = loadCfg(); },
    getStatus() { return { status: status, text: statusText, mode: mode, kind: lastKind }; },
    onStatus(fn) { listeners.status.add(fn); return () => listeners.status.delete(fn); },
    onMessage(fn) { listeners.message.add(fn); return () => listeners.message.delete(fn); },
    isOnline() { return status === "online"; },
    needsAuth() { return lastKind === "need-auth" || lastKind === "bad-auth"; },

    async connect() {
      cfg = loadCfg();
      lastKind = "";
      setStatus("connecting", "Connecting " + cfg.host);
      try {
        await fetch("/api/mqtt/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: cfg.host,
            port: Number(cfg.tcpPort) || 1883,
            username: cfg.username || "",
            password: cfg.password || ""
          })
        });
      } catch (_) {}
      if (client) {
        try { client.end(true); } catch (_) {}
        client = null;
      }
      if (bridgeTimer) { clearInterval(bridgeTimer); bridgeTimer = null; }
      try {
        const c = await tryWebSocket();
        wireWs(c);
        return true;
      } catch (wsErr) {
        const kind = wsErr.fleetKind || classifyErr(wsErr);
        if (kind === "need-auth" || kind === "bad-auth") {
          mode = "off";
          setStatus("offline", authMessage(kind), kind);
          return false;
        }
        if (!canUseBridge()) {
          mode = "off";
          setStatus("offline", pageIsHttps()
            ? "Pages is HTTPS — Automaton needs wss://" + cfg.host + "/mqtt (open 443 + launch.sh wss)"
            : "No MQTT WebSocket at " + cfg.host, "net");
          return false;
        }
        try {
          await tryBridge();
          return true;
        } catch (brErr) {
          const bKind = brErr.fleetKind || classifyErr(brErr);
          mode = "off";
          if (bKind === "need-auth" || bKind === "bad-auth") {
            setStatus("offline", authMessage(bKind), bKind);
          } else {
            setStatus("offline", cfg.username
              ? "Automaton rejected MQTT login for \"" + cfg.username + "\""
              : "Reached " + cfg.host + " but MQTT login was refused — enter Automaton user/password", cfg.username ? "bad-auth" : "net");
          }
          return false;
        }
      }
    },

    publish(topic, obj, opts) {
      const body = typeof obj === "string" ? obj : JSON.stringify(obj);
      const qos = (opts && opts.qos != null) ? opts.qos : 1;
      const retain = !!(opts && opts.retain);
      if (mode === "ws" && client && client.connected) {
        client.publish(topic, body, { qos: qos, retain: retain });
        return true;
      }
      if (mode === "bridge") {
        fetch("/api/mqtt/pub", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: topic, payload: obj, qos: qos, retain: retain })
        }).catch(() => {});
        return true;
      }
      return false;
    },

    publishRoster(list) {
      return Mqtt.publish("fleet/office/roster", list, { qos: 1, retain: true });
    },

    makeMsg(fields) {
      return Object.assign({
        msg_id: "m-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 6),
        timestamp: new Date().toISOString(),
        status: "pending"
      }, fields);
    }
  };

  global.FleetMQTT = Mqtt;
})(window);
