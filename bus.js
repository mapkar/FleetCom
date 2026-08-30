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

    let incoming = null;

    function current() { return FleetStore.getSelected(); }

    function clock() {
      document.getElementById("clock").textContent = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit"
      });
    }

    function renderHeader() {
      const b = current();
      const el = document.getElementById("bus-tag");
      if (!b) {
        el.textContent = "ROUTE —";
        document.title = "FleetCom — Bus";
        return;
      }
      el.innerHTML = "Rt " + b.route_number + " <small>" + (b.driver_name || "No driver") + " · " + b.state_number + "</small>";
      document.title = "FleetCom — Rt " + b.route_number;
    }

    function renderBanner() {
      const el = document.getElementById("banner");
      if (!incoming || incoming.status !== "pending") {
        el.className = "banner empty";
        el.textContent = "No pending office message";
        return;
      }
      el.className = "banner " + incoming.priority;
      el.innerHTML = `
        <div class="from">Office · pending <span class="pri ${incoming.priority}">${incoming.priority}</span></div>
        <h2>${incoming.text}</h2>
        <p>${incoming.type.replaceAll("_", " ")}</p>
        <div class="row3">
          <button class="ack" data-act="acked">ACK</button>
          <button class="deny" data-act="denied">Deny</button>
          <button class="dismiss" data-act="dismissed">Dismiss</button>
        </div>`;
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

    function flashSent(text) {
      const el = document.getElementById("sent");
      el.style.display = "block";
      el.textContent = "Sent · " + text;
      setTimeout(() => { el.style.display = "none"; }, 2200);
    }

    function renderSetup() {
      const list = FleetStore.get();
      document.getElementById("setup-sub").textContent = FleetStore.hasBackend()
        ? "From the office roster file"
        : "From the office roster on this browser";
      const box = document.getElementById("setup-list");
      if (!list.length) {
        box.innerHTML = `<div class="empty-roster">No buses on the roster yet.<br>Add assignments in the office dashboard, then come back here.</div>`;
        return;
      }
      const sel = FleetStore.getSelectedId();
      box.innerHTML = list.map(b => `
        <button class="pick" data-id="${b.id}">
          <div class="rt">Route ${b.route_number}</div>
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
      if (incoming) incoming.bus_id = id;
      renderHeader();
      showSetup(false);
      publishStatus();
    }

    document.getElementById("banner").addEventListener("click", e => {
      const btn = e.target.closest("button[data-act]");
      if (!btn || !incoming) return;
      incoming.status = btn.dataset.act;
      const bus = current();
      if (bus) {
        FleetMQTT.publish("fleet/buses/" + bus.id + "/ack", {
          msg_id: incoming.msg_id, status: incoming.status, timestamp: new Date().toISOString(), bus_id: bus.id
        }, { qos: 1 });
      }
      renderBanner();
      flashSent("office message " + incoming.status);
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
      flashSent((ok ? "" : "offline · ") + "Rt " + bus.route_number + " · " + btn.textContent);
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
      el.className = "link " + (s === "online" ? "" : s === "connecting" ? "wait" : "off");
      el.textContent = s === "online" ? "MQTT" : (s === "connecting" ? "WAIT" : "OFF");
      el.title = text;
      const hint = document.getElementById("mqtt-hint");
      if (hint) hint.textContent = text;
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
          incoming = payload;
          incoming.status = incoming.status || "pending";
          renderBanner();
        }
      }
      if (topic === "fleet/buses/" + bus.id + "/ack" && incoming && payload.msg_id === incoming.msg_id) {
        incoming.status = payload.status;
        renderBanner();
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

    renderCats();
    renderBanner();
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
