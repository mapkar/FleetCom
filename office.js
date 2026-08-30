    const now = () => new Date().toISOString();
    const ago = (iso) => {
      const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
      if (s < 60) return Math.floor(s) + "s";
      if (s < 3600) return Math.floor(s / 60) + "m";
      return Math.floor(s / 3600) + "h";
    };

    const presence = {};
    let applyingRemote = false;

    function ingestMsg(m) {
      if (!m || !m.msg_id) return;
      const i = msgs.findIndex(x => x.msg_id === m.msg_id);
      if (i >= 0) msgs[i] = Object.assign({}, msgs[i], m);
      else msgs.unshift(m);
    }

    let selected = "42";
    let filter = "all";
    let msgs = [
      { msg_id: "m1", timestamp: new Date(Date.now() - 90000).toISOString(), sender: "bus-31", direction: "bus_to_office", bus_id: "31", priority: "emergency", category: "emergency", type: "medical_emergency", status: "pending", text: "Medical emergency — student" },
      { msg_id: "m2", timestamp: new Date(Date.now() - 4 * 60000).toISOString(), sender: "bus-17", direction: "bus_to_office", bus_id: "17", priority: "high", category: "delay", type: "traffic", status: "pending", text: "Traffic delay US-123" },
      { msg_id: "m3", timestamp: new Date(Date.now() - 6 * 60000).toISOString(), sender: "bus-42", direction: "bus_to_office", bus_id: "42", priority: "normal", category: "status", type: "boarding_complete", status: "pending", text: "Boarding complete" },
      { msg_id: "m4", timestamp: new Date(Date.now() - 18 * 60000).toISOString(), sender: "office", direction: "office_to_bus", bus_id: "05", priority: "normal", category: "office", type: "radio_check", status: "acked", text: "Radio check" },
      { msg_id: "m5", timestamp: new Date(Date.now() - 22 * 60000).toISOString(), sender: "bus-23", direction: "bus_to_office", bus_id: "23", priority: "normal", category: "route", type: "last_stop_complete", status: "dismissed", text: "Last stop complete" }
    ];

    function labelBus(b) {
      if (!b) return "";
      return "Rt " + b.route_number;
    }
    function busSub(b) {
      if (!b) return "";
      return [b.driver_name || "No driver", b.state_number].filter(Boolean).join(" · ");
    }

    function flagsFor(id) {
      const pending = msgs.filter(m => m.bus_id === id && m.status === "pending" && m.direction === "bus_to_office");
      const out = [];
      if (pending.some(m => m.priority === "emergency")) out.push("em");
      else if (pending.some(m => m.priority === "high")) out.push("hi");
      if (pending.length) out.push("pend");
      return out;
    }

    function renderBuses() {
      const roster = FleetStore.get();
      const online = roster.filter(b => (presence[b.id] || {}).online).length;
      document.getElementById("bus-count").textContent = roster.length + " · " + online + " up";
      if (!roster.some(b => b.id === selected) && roster[0]) selected = roster[0].id;
      document.getElementById("buses").innerHTML = roster.map(b => {
        const p = presence[b.id] || { online: false, last: now() };
        const flags = flagsFor(b.id);
        return `
        <div class="bus ${b.id === selected ? "sel" : ""}" data-id="${b.id}">
          <div class="dot ${p.online ? "on" : "off"}"></div>
          <div>
            <div class="bus-id">Rt ${b.route_number}</div>
            <div class="bus-meta">${busSub(b)} · ${p.online ? "now" : ago(p.last)}</div>
            ${b.comment ? `<div class="bus-cmt">${b.comment}</div>` : ""}
          </div>
          <div class="flags">
            ${flags.includes("em") ? '<span class="flag em">EM</span>' : ""}
            ${flags.includes("hi") ? '<span class="flag hi">HI</span>' : ""}
            ${flags.includes("pend") ? '<span class="flag pend">●</span>' : ""}
          </div>
        </div>`;
      }).join("") || `<p style="padding:16px;color:#8b97a8">No buses yet. Add the first assignment.</p>`;

      const to = document.getElementById("to");
      to.innerHTML = `<option value="broadcast">All buses (broadcast)</option>` +
        roster.map(b => `<option value="${b.id}" ${b.id === selected ? "selected" : ""}>${labelBus(b)} — ${busSub(b)}</option>`).join("");

      const card = document.getElementById("sel-card");
      const cur = FleetStore.find(selected);
      if (cur) {
        card.innerHTML = `<strong>Rt ${cur.route_number}</strong>
          ${busSub(cur)}
          ${cur.comment ? "<div style='color:#8b97a8;margin-top:4px'>" + cur.comment + "</div>" : ""}
          <button type="button" id="edit-sel">Edit assignment</button>`;
      } else {
        card.innerHTML = "Select a bus or add one to the roster.";
      }
    }

    function shown() {
      return msgs.filter(m => {
        if (filter === "unacked") return m.status === "pending" && m.direction === "bus_to_office";
        if (filter === "priority") return m.priority !== "normal";
        return true;
      }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    function renderFeed() {
      document.getElementById("feed").innerHTML = shown().map(m => {
        const canAct = m.direction === "bus_to_office" && m.status === "pending";
        const cls = m.priority === "emergency" ? "em" : m.priority === "high" ? "hi" : "nm";
        const rec = FleetStore.find(m.bus_id);
        const who = m.direction === "bus_to_office"
          ? (rec ? "Rt " + rec.route_number : "Route " + m.bus_id)
          : ("Office → " + (m.bus_id ? (rec ? "Rt " + rec.route_number : "Route " + m.bus_id) : "all"));
        return `<article class="msg ${cls}">
          <div class="msg-top">
            <strong>${who}</strong>
            <span class="pri ${m.priority}">${m.priority}</span>
            <span>${ago(m.timestamp)}</span>
            <span>${m.category}/${m.type}</span>
          </div>
          <h3>${m.text || m.type}</h3>
          ${canAct ? `<div class="actions">
            <button class="ack" data-act="acked" data-id="${m.msg_id}">Acknowledge</button>
            <button class="deny" data-act="denied" data-id="${m.msg_id}">Deny</button>
            <button data-act="dismissed" data-id="${m.msg_id}">Dismiss</button>
          </div>` : `<div class="st ${m.status}">${m.status}</div>`}
        </article>`;
      }).join("") || `<p style="padding:16px;color:#8b97a8">No messages in this filter.</p>`;
    }

    function toast(t) {
      const el = document.getElementById("toast");
      el.textContent = t;
      el.style.display = "block";
      setTimeout(() => el.style.display = "none", 1800);
    }

    function openEditor(row) {
      document.getElementById("mask").classList.add("on");
      document.getElementById("dlg-title").textContent = row ? "Edit assignment" : "Add bus";
      document.getElementById("f-id").value = row ? row.id : "";
      document.getElementById("f-state").value = row ? row.state_number : "";
      document.getElementById("f-route").value = row ? row.route_number : "";
      document.getElementById("f-driver").value = row ? row.driver_name : "";
      document.getElementById("f-comment").value = row ? row.comment : "";
      document.getElementById("f-err").textContent = "";
      document.getElementById("f-del").hidden = !row;
      document.getElementById("f-route").focus();
    }
    function closeEditor() { document.getElementById("mask").classList.remove("on"); }

    document.getElementById("add-bus").addEventListener("click", () => openEditor(null));
    document.getElementById("f-cancel").addEventListener("click", closeEditor);
    document.getElementById("mask").addEventListener("click", e => { if (e.target.id === "mask") closeEditor(); });
    document.getElementById("sel-card").addEventListener("click", e => {
      if (e.target.id === "edit-sel") openEditor(FleetStore.find(selected));
    });
    document.getElementById("f-state").addEventListener("input", e => {
      let v = e.target.value.replace(/[^\d]/g, "").slice(0, 7);
      if (v.length > 3) v = v.slice(0, 3) + "-" + v.slice(3);
      e.target.value = v;
    });
    document.getElementById("bus-form").addEventListener("submit", async e => {
      e.preventDefault();
      const res = await FleetStore.upsert({
        id: document.getElementById("f-id").value || undefined,
        state_number: document.getElementById("f-state").value,
        route_number: document.getElementById("f-route").value,
        driver_name: document.getElementById("f-driver").value,
        comment: document.getElementById("f-comment").value
      });
      if (!res.ok) {
        document.getElementById("f-err").textContent = res.error;
        return;
      }
      selected = res.row.id;
      closeEditor();
      renderBuses();
      renderFeed();
      FleetMQTT.publishRoster(FleetStore.get());
      toast("Roster saved · Rt " + res.row.route_number);
    });
    document.getElementById("f-del").addEventListener("click", async () => {
      const id = document.getElementById("f-id").value;
      const row = FleetStore.find(id);
      if (!row || !confirm("Remove route " + row.route_number + " from the roster?")) return;
      await FleetStore.remove(id);
      closeEditor();
      renderBuses();
      FleetMQTT.publishRoster(FleetStore.get());
      toast("Removed Rt " + row.route_number);
    });

    document.getElementById("buses").addEventListener("click", e => {
      const row = e.target.closest(".bus");
      if (!row) return;
      selected = row.dataset.id;
      renderBuses();
    });
    document.getElementById("buses").addEventListener("dblclick", e => {
      const row = e.target.closest(".bus");
      if (row) openEditor(FleetStore.find(row.dataset.id));
    });
    document.querySelector(".filters").addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      filter = btn.dataset.f;
      document.querySelectorAll(".filters button").forEach(b => b.classList.toggle("on", b === btn));
      renderFeed();
    });
    document.getElementById("feed").addEventListener("click", e => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const m = msgs.find(x => x.msg_id === btn.dataset.id);
      if (m) m.status = btn.dataset.act;
      if (m && m.bus_id) {
        FleetMQTT.publish("fleet/buses/" + m.bus_id + "/ack", {
          msg_id: m.msg_id, status: m.status, timestamp: now(), bus_id: m.bus_id
        }, { qos: 1 });
      }
      renderFeed();
      renderBuses();
      toast("Rt " + ((FleetStore.find(m.bus_id) || {}).route_number || m.bus_id) + " · " + m.status);
    });
    document.getElementById("compose").addEventListener("submit", e => {
      e.preventDefault();
      const to = document.getElementById("to").value;
      const type = document.getElementById("otype").value;
      const priority = document.getElementById("opri").value;
      const rec = to === "broadcast" ? null : FleetStore.find(to);
      const text = document.getElementById("otext").value.trim() || type.replaceAll("_", " ");
      const msg = FleetMQTT.makeMsg({
        sender: "office",
        direction: "office_to_bus",
        bus_id: to === "broadcast" ? null : to,
        priority: priority,
        category: "office",
        type: type,
        status: "pending",
        text: text,
        payload: rec ? { state_number: rec.state_number, route_number: rec.route_number, driver_name: rec.driver_name } : null
      });
      ingestMsg(msg);
      const topic = to === "broadcast" ? "fleet/office/broadcast" : "fleet/buses/" + to + "/messages/in";
      const ok = FleetMQTT.publish(topic, msg, { qos: 1 });
      document.getElementById("otext").value = "";
      renderFeed();
      toast((ok ? "" : "Queued locally · ") + (to === "broadcast" ? "Broadcast sent" : "Sent to Rt " + (rec ? rec.route_number : to)));
    });

    FleetStore.onChange(() => { renderBuses(); renderFeed(); });

    function fillMqttForm() {
      const c = FleetMQTT.getConfig();
      document.getElementById("m-host").value = c.host;
      document.getElementById("m-ws").value = c.wsPort;
      document.getElementById("m-path").value = c.wsPath;
      document.getElementById("m-tcp").value = c.tcpPort;
      document.getElementById("m-user").value = c.username;
      document.getElementById("m-pass").value = c.password;
      document.getElementById("m-tls").checked = !!c.useTLS;
      document.getElementById("m-err").textContent = "";
    }

    FleetMQTT.onStatus((s, text) => {
      const pill = document.getElementById("mqtt-pill");
      pill.className = "pill mqtt " + s;
      pill.textContent = s === "online" ? "MQTT" : (s === "connecting" ? "MQTT…" : "MQTT off");
      pill.title = text;
    });

    FleetMQTT.onMessage((topic, payload) => {
      if (topic === "fleet/office/roster" && Array.isArray(payload)) {
        applyingRemote = true;
        FleetStore.applyRemote(payload);
        applyingRemote = false;
        return;
      }
      const parts = topic.split("/");
      if (parts[0] === "fleet" && parts[1] === "buses" && parts[3] === "status") {
        const id = parts[2];
        presence[id] = {
          online: !!(payload && payload.online),
          last: (payload && payload.timestamp) || now()
        };
        renderBuses();
        return;
      }
      if (payload && payload.msg_id) {
        ingestMsg(payload);
        renderFeed();
        renderBuses();
      }
    });

    document.getElementById("mqtt-pill").addEventListener("click", () => {
      fillMqttForm();
      document.getElementById("mqtt-mask").classList.add("on");
    });
    document.getElementById("m-cancel").addEventListener("click", () => {
      document.getElementById("mqtt-mask").classList.remove("on");
    });
    document.getElementById("mqtt-mask").addEventListener("click", e => {
      if (e.target.id === "mqtt-mask") document.getElementById("mqtt-mask").classList.remove("on");
    });
    document.getElementById("mqtt-form").addEventListener("submit", async e => {
      e.preventDefault();
      FleetMQTT.setConfig({
        host: document.getElementById("m-host").value.trim(),
        wsPort: Number(document.getElementById("m-ws").value) || 9001,
        wsPath: document.getElementById("m-path").value.trim() || "/mqtt",
        tcpPort: Number(document.getElementById("m-tcp").value) || 1883,
        username: document.getElementById("m-user").value,
        password: document.getElementById("m-pass").value,
        useTLS: document.getElementById("m-tls").checked
      });
      document.getElementById("m-err").textContent = "Connecting…";
      const ok = await FleetMQTT.connect();
      document.getElementById("m-err").textContent = ok ? "" : FleetMQTT.getStatus().text;
      if (ok) {
        document.getElementById("mqtt-mask").classList.remove("on");
        FleetMQTT.publishRoster(FleetStore.get());
        FleetMQTT.publish("fleet/system/heartbeat", { sender: "office", timestamp: now() }, { qos: 0, retain: false });
      }
    });

    async function start() {
      await FleetStore.load();
      const pill = document.getElementById("src-pill");
      if (FleetStore.hasBackend()) {
        pill.textContent = "Roster file";
      } else {
        pill.textContent = "Local roster";
        pill.classList.add("warn");
      }
      document.getElementById("clock").textContent = new Date().toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      renderBuses();
      renderFeed();
      setInterval(() => {
        document.getElementById("clock").textContent = new Date().toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }, 1000);
      const ok = await FleetMQTT.connect();
      if (ok) {
        FleetMQTT.publishRoster(FleetStore.get());
        FleetMQTT.publish("fleet/system/heartbeat", { sender: "office", timestamp: now() }, { qos: 0 });
      } else {
        fillMqttForm();
        document.getElementById("m-err").textContent = FleetMQTT.getStatus().text;
        document.getElementById("mqtt-mask").classList.add("on");
      }
    }
    start();
