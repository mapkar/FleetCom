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

  function setStatus(s, text) {
    status = s;
    statusText = text;
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

  function handlePacket(topic, payload) {
    const key = topic + "|" + (payload && payload.msg_id ? payload.msg_id : JSON.stringify(payload).slice(0, 80));
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
        reconnectPeriod: 4000,
        connectTimeout: 6000,
        keepalive: 30,
        clean: true,
        protocolVersion: 4
      };
      if (cfg.username) opts.username = cfg.username;
      if (cfg.password) opts.password = cfg.password;
      const c = mqtt.connect(url, opts);
      const t = setTimeout(() => {
        try { c.end(true); } catch (_) {}
        reject(new Error("timeout " + url));
      }, 7000);
      c.on("connect", () => {
        clearTimeout(t);
        resolve(c);
      });
      c.on("error", () => {});
      c.on("close", () => {});
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
      }
    }
    throw last || new Error("no websocket listener");
  }

  function wireWs(c) {
    client = c;
    mode = "ws";
    setStatus("online", "MQTT WS " + cfg.host + ":" + cfg.wsPort);
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
    c.on("connect", () => setStatus("online", "MQTT WS " + cfg.host + ":" + cfg.wsPort));
  }

  async function tryBridge() {
    const res = await fetch("/api/mqtt/status", { cache: "no-store" });
    if (!res.ok) throw new Error("no bridge");
    const info = await res.json();
    if (!info.connected) throw new Error(info.error || "bridge offline");
    mode = "bridge";
    setStatus("online", "MQTT via serve.py → " + (info.host || cfg.host) + ":" + (info.port || cfg.tcpPort));
    if (bridgeTimer) clearInterval(bridgeTimer);
    let since = 0;
    async function pull() {
      try {
        const r = await fetch("/api/mqtt/poll?since=" + since, { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        since = data.cursor || since;
        (data.messages || []).forEach((m) => handlePacket(m.topic, m.payload));
        if (data.connected) setStatus("online", "MQTT via serve.py → " + (data.host || cfg.host));
        else setStatus("connecting", "bridge reconnecting");
      } catch (_) {}
    }
    await pull();
    bridgeTimer = setInterval(pull, 1200);
  }

  const Mqtt = {
    getConfig() { return Object.assign({}, cfg); },
    setConfig(next) { saveCfg(next); cfg = loadCfg(); },
    getStatus() { return { status: status, text: statusText, mode: mode }; },
    onStatus(fn) { listeners.status.add(fn); return () => listeners.status.delete(fn); },
    onMessage(fn) { listeners.message.add(fn); return () => listeners.message.delete(fn); },
    isOnline() { return status === "online"; },

    async connect() {
      cfg = loadCfg();
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
        try {
          await tryBridge();
          return true;
        } catch (brErr) {
          mode = "off";
          setStatus("offline", "No MQTT at " + cfg.host + " (WS and TCP bridge failed)");
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
