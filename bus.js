    const cats = [
      { id: "student", k: "Issue", s: "Student / behavior", types: [
        ["behavior", "Behavior"],
        ["injury_medical", "Injury / medical"],
        ["missing_student", "Missing student"],
        ["extra_rider", "Extra rider"],
        ["fight", "Fight"],
        ["parent_confrontation", "Parent confrontation"]
      ]},
      { id: "mechanical", k: "Mech", s: "Warning / breakdown", types: [
        ["warning_light", "Warning light"],
        ["tire", "Tire"],
        ["brakes", "Brakes"],
        ["door_lift", "Door / lift"],
        ["electronics", "Electronics"],
        ["wont_start", "Won't start"],
        ["other_mechanical", "Other mechanical"]
      ]},
      { id: "delay", k: "Delay", s: "Running late", types: [
        ["traffic", "Traffic"],
        ["weather", "Weather"],
        ["waiting_students", "Waiting on students"],
        ["mechanical_delay", "Mechanical delay"],
        ["previous_route_late", "Previous route late"],
        ["other_delay", "Other delay"]
      ]},
      { id: "route", k: "Route", s: "Stops / path", types: [
        ["temp_stop_added", "Temp stop added"],
        ["temp_stop_removed", "Temp stop removed"],
        ["reroute_road_closed", "Reroute — road closed"],
        ["reroute_traffic", "Reroute — traffic"],
        ["extra_stop_school", "Extra stop at school"],
        ["last_stop_complete", "Last stop complete"]
      ]},
      { id: "status", k: "Status", s: "All clear / request", types: [
        ["all_clear", "All clear"],
        ["boarding_complete", "Boarding complete"],
        ["request_radio", "Request radio"],
        ["request_call", "Request call"],
        ["fuel_low", "Fuel low"],
        ["capacity", "Capacity"]
      ]},
      { id: "emergency", k: "Emergency", s: "Needs help now", em: true, types: [
        ["assistance_needed", "Assistance needed"],
        ["accident", "Accident"],
        ["medical_emergency", "Medical emergency"],
        ["security_threat", "Security threat"]
      ]}
    ];

    const QKEY = "fleetcom.bus.queue";
    const OUTKEY = "fleetcom.bus.outbox";
    let queue = [];
    let outbox = [];
    let lastLink = "";

    function loadQueue() {
      try {
        const raw = sessionStorage.getItem(QKEY);
        const list = raw ? JSON.parse(raw) : [];
        queue = Array.isArray(list) ? list.filter(m => m && m.msg_id) : [];
      } catch (_) { queue = []; }
    }
    function saveQueue() {
      try { sessionStorage.setItem(QKEY, JSON.stringify(queue.slice(0, 40))); } catch (_) {}
    }
    function loadOutbox() {
      try {
        const raw = sessionStorage.getItem(OUTKEY);
        const list = raw ? JSON.parse(raw) : [];
        outbox = Array.isArray(list) ? list.filter(m => m && m.msg_id) : [];
      } catch (_) { outbox = []; }
    }
    function saveOutbox() {
      try { sessionStorage.setItem(OUTKEY, JSON.stringify(outbox.slice(0, 40))); } catch (_) {}
    }

    function priRank(p) {
      return p === "emergency" ? 0 : p === "high" ? 1 : 2;
    }
    function pendingQueue() {
      return queue.filter(m => m.status === "pending").sort((a, b) => {
        const d = priRank(a.priority) - priRank(b.priority);
        if (d) return d;
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
    }
    function currentIncoming() {
      return pendingQueue()[0] || null;
    }

    function enqueueOffice(msg) {
      if (!msg || !msg.msg_id) return false;
      const i = queue.findIndex(x => x.msg_id === msg.msg_id);
      if (i >= 0) {
        const prev = queue[i].status;
        queue[i] = Object.assign({}, queue[i], msg);
        saveQueue();
        return queue[i].status === "pending" && prev !== "pending";
      }
      queue.push(Object.assign({ status: "pending" }, msg));
      saveQueue();
      return (msg.status || "pending") === "pending";
    }

    function current() { return FleetStore.getSelected(); }
    function routeLabel(b) {
      if (!b) return "Route: —";
      return "Route: " + b.route_number;
    }

    function clock() {
      document.getElementById("clock").textContent = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit"
      });
    }

    function officeLabel(status) {
      if (status === "acked") return "Office approved";
      if (status === "denied") return "Office denied";
      if (status === "dismissed") return "Office dismissed";
      return "Waiting on office";
    }

    function renderHeader() {
      const b = current();
      const routeEl = document.getElementById("ident-route");
      const subEl = document.getElementById("ident-sub");
      if (!b) {
        routeEl.textContent = "Route: —";
        subEl.textContent = "Pick a route from the office roster";
        document.title = "FleetCom — Bus";
        return;
      }
      routeEl.textContent = routeLabel(b);
      subEl.textContent = (b.driver_name || "No driver") + " · " + b.state_number;
      document.title = "FleetCom — " + routeLabel(b);
    }

    function renderSlot() {
      const el = document.getElementById("slot");
      const k = document.getElementById("slot-k");
      const s = document.getElementById("slot-s");
      const latest = outbox.find(m => !m.offline && (!m.status || m.status === "pending")) || outbox[0];
      if (!latest) {
        el.className = "slot idle";
        k.textContent = "Ready";
        s.textContent = "No outgoing report yet";
        return;
      }
      const waiting = outbox.filter(m => !m.status || m.status === "pending").length;
      const label = latest.text || (latest.type || "").replaceAll("_", " ");
      if (latest.offline) {
        el.className = "slot offline";
        k.textContent = "Not sent · MQTT offline";
        s.textContent = label;
        return;
      }
      if (!latest.status || latest.status === "pending") {
        el.className = "slot wait";
        k.textContent = "Sent · waiting on office";
        s.textContent = label + (waiting > 1 ? " · " + waiting + " open" : "");
        return;
      }
      el.className = "slot " + latest.status;
      k.textContent = officeLabel(latest.status);
      s.textContent = label;
    }

    function renderBanner() {
      const el = document.getElementById("banner");
      const incoming = currentIncoming();
      const waiting = pendingQueue();
      if (!incoming) {
        el.className = "banner empty";
        el.textContent = "No pending office message";
        return;
      }
      const rest = waiting.slice(1);
      el.className = "banner " + incoming.priority;
      el.innerHTML = `
        <div class="from">Office · ${waiting.length} queued <span class="pri ${incoming.priority}">${incoming.priority}</span></div>
        <h2>${incoming.text || (incoming.type || "").replaceAll("_", " ")}</h2>
        <p>${(incoming.type || "").replaceAll("_", " ")}</p>
        <div class="row3">
          <button class="ack" data-act="acked">ACK</button>
          <button class="deny" data-act="denied">Deny</button>
          <button class="dismiss" data-act="dismissed">Dismiss</button>
        </div>
        ${rest.length ? `<div class="qcount">${rest.length} more waiting</div>
          <div class="qlist">${rest.slice(0, 4).map(m =>
            `<div>${m.priority === "emergency" ? "EM · " : m.priority === "high" ? "HI · " : ""}${m.text || (m.type || "").replaceAll("_", " ")}</div>`
          ).join("")}</div>` : ""}`;
    }

    function renderCats() {
      document.getElementById("cats").innerHTML = cats.map(c => `
        <button class="cat ${c.em ? "em" : ""}" data-cat="${c.id}">
          <div class="k">${c.k}</div>
          <div class="s">${c.s}</div>
        </button>`).join("");
    }

    function openCat(id) {
      const c = cats.find(x => x.id === id);
      document.getElementById("cats").style.display = "none";
      document.getElementById("sheet").classList.add("on");
      document.getElementById("sheet-title").textContent = c.k;
      document.getElementById("types").innerHTML = c.types.map(([t, label]) =>
        `<button class="type-btn" data-cat="${c.id}" data-type="${t}">${label}</button>`
      ).join("");
    }

    function closeSheet() {
      document.getElementById("sheet").classList.remove("on");
      document.getElementById("cats").style.display = "grid";
    }

    function rememberOut(msg, extra) {
      const row = Object.assign({}, msg, extra || {});
      const i = outbox.findIndex(x => x.msg_id === row.msg_id);
      if (i >= 0) outbox[i] = Object.assign({}, outbox[i], row);
      else outbox.unshift(row);
      saveOutbox();
      renderSlot();
    }

    function renderSetup() {
      const list = FleetStore.get();
      document.getElementById("setup-sub").textContent = FleetStore.hasBackend()
        ? "From the office roster file"
        : "From the office roster on this browser";
      const box = document.getElementById("setup-list");
      if (!list.length) {
        box.innerHTML = `<div class="empty-roster">No routes on the roster yet.<br>Add assignments in the office dashboard, then come back here.</div>`;
        return;
      }
      const sel = FleetStore.getSelectedId();
      box.innerHTML = list.map(b => `
        <button class="pick" data-id="${b.id}">
          <div class="rt">${routeLabel(b)}</div>
          <div class="dr">${b.driver_name || "No driver listed"}</div>
          <div class="sn">${b.state_number}${b.comment ? " · " + b.comment : ""}${b.id === sel ? " · current" : ""}</div>
        </button>`).join("");
    }

    function showSetup(on) {
      document.getElementById("setup").classList.toggle("on", on);
      if (on) renderSetup();
    }

    function publishStatus() {
      const bus = current();
      if (!bus) return;
      FleetMQTT.publish("fleet/buses/" + bus.id + "/status", {
        online: true,
        timestamp: new Date().toISOString(),
        bus_id: bus.id,
        route_number: bus.route_number,
        state_number: bus.state_number,
        driver_name: bus.driver_name
      }, { qos: 1, retain: true });
    }

    function applySelection(id) {
      FleetStore.setSelectedId(id);
      renderHeader();
      showSetup(false);
      publishStatus();
    }

    document.getElementById("banner").addEventListener("click", e => {
      const btn = e.target.closest("button[data-act]");
      const incoming = currentIncoming();
      if (!btn || !incoming) return;
      incoming.status = btn.dataset.act;
      saveQueue();
      const bus = current();
      if (bus) {
        FleetMQTT.publish("fleet/buses/" + bus.id + "/ack", {
          msg_id: incoming.msg_id,
          status: incoming.status,
          timestamp: new Date().toISOString(),
          bus_id: bus.id,
          sender: "bus-" + bus.id,
          direction: "office_to_bus",
          text: incoming.text,
          type: incoming.type,
          category: incoming.category,
          priority: incoming.priority
        }, { qos: 1 });
      }
      renderBanner();
    });
    document.getElementById("cats").addEventListener("click", e => {
      const btn = e.target.closest(".cat");
      if (btn) openCat(btn.dataset.cat);
    });
    document.getElementById("back").addEventListener("click", closeSheet);
    document.getElementById("types").addEventListener("click", e => {
      const btn = e.target.closest(".type-btn");
      if (!btn) return;
      const bus = current();
      if (!bus) { showSetup(true); return; }
      const pri = btn.dataset.cat === "emergency" ? "emergency"
        : (btn.dataset.cat === "student" && ["fight", "injury_medical", "missing_student"].includes(btn.dataset.type)) ? "high"
        : "normal";
      const payload = FleetMQTT.makeMsg({
        sender: "bus-" + bus.id,
        direction: "bus_to_office",
        bus_id: bus.id,
        priority: pri,
        category: btn.dataset.cat,
        type: btn.dataset.type,
        status: "pending",
        text: btn.textContent,
        payload: {
          state_number: bus.state_number,
          route_number: bus.route_number,
          driver_name: bus.driver_name
        }
      });
      const ok = FleetMQTT.publish("fleet/buses/" + bus.id + "/messages/out", payload, { qos: 1 });
      closeSheet();
      rememberOut(payload, { offline: !ok });
    });
    document.getElementById("switch").addEventListener("click", () => showSetup(true));
    document.getElementById("setup-list").addEventListener("click", e => {
      const btn = e.target.closest(".pick");
      if (btn) applySelection(btn.dataset.id);
    });

    FleetStore.onChange(() => {
      const id = FleetStore.getSelectedId();
      if (id && !FleetStore.find(id)) FleetStore.setSelectedId(null);
      renderHeader();
      if (document.getElementById("setup").classList.contains("on")) renderSetup();
      if (!FleetStore.getSelected()) showSetup(true);
    });

    FleetMQTT.onStatus((s, text) => {
      const el = document.getElementById("link");
      el.className = "pill mqtt " + (s === "online" ? "online" : s === "connecting" ? "connecting" : "offline");
      el.textContent = s === "online" ? "MQTT" : (s === "connecting" ? "MQTT…" : "MQTT off");
      el.title = text;
      const hint = document.getElementById("mqtt-hint");
      if (hint) hint.textContent = text;
      if (s === "online" && lastLink && lastLink !== "online") FleetNotify.link(true);
      if (s === "offline" && lastLink === "online") FleetNotify.link(false);
      lastLink = s;
    });

    FleetMQTT.onMessage((topic, payload) => {
      if (topic === "fleet/office/roster" && Array.isArray(payload)) {
        FleetStore.applyRemote(payload);
        return;
      }
      const bus = current();
      if (!bus || !payload) return;
      if (topic === "fleet/office/broadcast" || topic === "fleet/buses/" + bus.id + "/messages/in") {
        if (payload.direction === "office_to_bus" || payload.sender === "office") {
          const fresh = enqueueOffice(payload);
          renderBanner();
          if (fresh) FleetNotify.incoming(payload.priority || "normal");
        }
      }
      if (topic === "fleet/buses/" + bus.id + "/ack" && payload.msg_id) {
        const hit = queue.find(m => m.msg_id === payload.msg_id);
        if (hit && payload.status) {
          hit.status = payload.status;
          saveQueue();
          renderBanner();
        }
        const out = outbox.find(m => m.msg_id === payload.msg_id);
        if (out && payload.status && payload.sender === "office") {
          const prev = out.status;
          out.status = payload.status;
          out.offline = false;
          saveOutbox();
          renderSlot();
          if (prev !== payload.status) FleetNotify.reply(payload.status);
        }
      }
    });

    document.getElementById("mqtt-form").addEventListener("submit", async e => {
      e.preventDefault();
      FleetMQTT.setConfig({
        username: document.getElementById("m-user").value,
        password: document.getElementById("m-pass").value
      });
      const hint = document.getElementById("mqtt-hint");
      if (hint) hint.textContent = "Connecting…";
      await FleetMQTT.connect();
      if (hint) hint.textContent = FleetMQTT.getStatus().text;
      publishStatus();
    });

    loadQueue();
    loadOutbox();
    renderCats();
    renderBanner();
    renderSlot();
    clock();
    setInterval(clock, 1000);
    setInterval(publishStatus, 30000);

    FleetStore.load().then(async () => {
      renderHeader();
      if (!FleetStore.getSelected()) showSetup(true);
      const c = FleetMQTT.getConfig();
      document.getElementById("m-user").value = c.username || "";
      document.getElementById("m-pass").value = c.password || "";
      await FleetMQTT.connect();
      const hint = document.getElementById("mqtt-hint");
      if (hint) hint.textContent = FleetMQTT.getStatus().text;
      publishStatus();
    });
