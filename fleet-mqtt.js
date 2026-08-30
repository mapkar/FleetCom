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

  function wsUrl(port) {
    const proto = cfg.useTLS ? "wss" : "ws";
    const path = cfg.wsPath && cfg.wsPath.charAt(0) === "/" ? cfg.wsPath : "/" + (cfg.wsPath || "mqtt");
    return proto + "://" + cfg.host + ":" + port + path;
  }

  function classifyErr(err) {
    const msg = (err && err.message) ? err.message : String(err || "");
    const code = err && err.code;
    if (code === 4 || /bad user|bad username or password/i.test(msg)) return "bad-auth";
    if (code === 5 || /not authorized/i.test(msg)) return cfg.username ? "bad-auth" : "need-auth";
    if (/CONNACK refused \(4\)|bad username/i.test(msg)) return "bad-auth";
    if (/CONNACK refused \(5\)|not authorized/i.test(msg)) return cfg.username ? "bad-auth" : "need-auth";
    return "net";
  }

  function authMessage(kind) {
    if (kind === "need-auth") return "Automaton requires an MQTT username and password";
    if (kind === "bad-auth") return "MQTT username or password was rejected";
    return "";
  }

  function handlePacket(topic, payload) {
    if (payload && payload.msg_id) {
      if (seen.has(payload.msg_id)) return;
      seen.add(payload.msg_id);
      if (seen.size > 400) seen = new Set(Array.from(seen).slice(-200));
    }
    emit(topic, payload, false);
  }

  function connectWs(port) {
    return new Promise((resolve, reject) => {
      if (typeof mqtt === "undefined") {
        reject(new Error("mqtt.js missing"));
        return;
      }
      const url = wsUrl(port);
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
      c.on("error", (e) => finish(e || new Error("MQTT error at " + url)));
      c.on("close", () => {
        if (!settled) finish(new Error("closed " + url));
      });
    });
  }

  async function tryWebSocket() {
    const ports = [Number(cfg.wsPort) || 9001].concat(cfg.altWsPorts || []);
    const uniq = [];
    ports.forEach((p) => { if (uniq.indexOf(p) < 0) uniq.push(p); });
    let last = null;
    for (let i = 0; i < uniq.length; i++) {
      setStatus("connecting", "WS :" + uniq[i]);
      try {
        const c = await connectWs(uniq[i]);
        cfg.wsPort = uniq[i];
        return c;
      } catch (e) {
        last = e;
        const kind = classifyErr(e);
        if (kind === "need-auth" || kind === "bad-auth") {
          e.fleetKind = kind;
          throw e;
        }
      }
    }
    throw last || new Error("no websocket listener");
  }

  function wireWs(c) {
    client = c;
    mode = "ws";
    c.options.reconnectPeriod = 4000;
    setStatus("online", "MQTT WS " + cfg.host + ":" + cfg.wsPort, "ok");
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
    c.on("connect", () => setStatus("online", "MQTT WS " + cfg.host + ":" + cfg.wsPort, "ok"));
    c.on("error", (e) => {
      const kind = classifyErr(e);
      if (kind === "need-auth" || kind === "bad-auth") {
        setStatus("offline", authMessage(kind), kind);
      }
    });
  }

  async function tryBridge() {
    const res = await fetch("/api/mqtt/status", { cache: "no-store" });
    if (!res.ok) throw new Error("no bridge");
    const info = await res.json();
    if (!info.connected) {
      const err = new Error(info.error || "bridge offline");
      err.fleetKind = classifyErr(err);
      throw err;
    }
    mode = "bridge";
    setStatus("online", "MQTT via serve.py → " + (info.host || cfg.host) + ":" + (info.port || cfg.tcpPort), "ok");
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
    await pull();
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
        try {
          await tryBridge();
          return true;
        } catch (brErr) {
          const bKind = brErr.fleetKind || classifyErr(brErr);
          mode = "off";
          if (bKind === "need-auth" || bKind === "bad-auth") {
            setStatus("offline", authMessage(bKind), bKind);
          } else {
            setStatus("offline", "No MQTT at " + cfg.host + " — enter Automaton user/password", "net");
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
