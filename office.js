const now = () => new Date().toISOString();
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return Math.floor(s) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  return Math.floor(s / 3600) + "h";
};

const presence = {
  "42": { online: true, last: now() },
  "17": { online: true, last: now() },
  "08": { online: false, last: new Date(Date.now() - 14 * 60000).toISOString() },
  "23": { online: true, last: now() },
  "31": { online: true, last: now() },
  "05": { online: true, last: new Date(Date.now() - 3 * 60000).toISOString() }
};

let selected = "42";
let filter = "all";
let msgs = [
  { msg_id: "m1", timestamp: new Date(Date.now() - 90000).toISOString(), sender: "bus-31", direction: "bus_to_office", bus_id: "31", priority: "emergency", category: "emergency", type: "medical_emergency", status: "pending", text: "Medical emergency \u2014 student" },
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
  return [b.driver_name || "No driver", b.state_number].filter(Boolean).join(" \u00b7 ");
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
  document.getElementById("bus-count").textContent = roster.length + " \u00b7 " + online + " up";
  if (!roster.some(b => b.id === selected) && roster[0]) selected = roster[0].id;
  document.getElementById("buses").innerHTML = roster.map(function (b) {
    const p = presence[b.id] || { online: false, last: now() };
    const flags = flagsFor(b.id);
    return '<div class="bus ' + (b.id === selected ? "sel" : "") + '" data-id="' + b.id + '">' +
      '<div class="dot ' + (p.online ? "on" : "off") + '"></div>' +
      '<div><div class="bus-id">Rt ' + b.route_number + '</div>' +
      '<div class="bus-meta">' + busSub(b) + ' \u00b7 ' + (p.online ? "now" : ago(p.last)) + '</div>' +
      (b.comment ? '<div class="bus-cmt">' + b.comment + '</div>' : '') +
      '</div><div class="flags">' +
      (flags.indexOf("em") >= 0 ? '<span class="flag em">EM</span>' : '') +
      (flags.indexOf("hi") >= 0 ? '<span class="flag hi">HI</span>' : '') +
      (flags.indexOf("pend") >= 0 ? '<span class="flag pend">\u25cf</span>' : '') +
      '</div></div>';
  }).join("") || '<p style="padding:16px;color:#8b97a8">No buses yet. Add the first assignment.</p>';

  const to = document.getElementById("to");
  to.innerHTML = '<option value="broadcast">All buses (broadcast)</option>' +
    roster.map(function (b) {
      return '<option value="' + b.id + '" ' + (b.id === selected ? "selected" : "") + '>' + labelBus(b) + ' \u2014 ' + busSub(b) + '</option>';
    }).join("");

  const card = document.getElementById("sel-card");
  const cur = FleetStore.find(selected);
  if (cur) {
    card.innerHTML = '<strong>Rt ' + cur.route_number + '</strong>' +
      busSub(cur) +
      (cur.comment ? "<div style='color:#8b97a8;margin-top:4px'>" + cur.comment + "</div>" : "") +
      '<button type="button" id="edit-sel">Edit assignment</button>';
  } else {
    card.innerHTML = "Select a bus or add one to the roster.";
  }
}

function shown() {
  return msgs.filter(function (m) {
    if (filter === "unacked") return m.status === "pending" && m.direction === "bus_to_office";
    if (filter === "priority") return m.priority !== "normal";
    return true;
  }).sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
}

function renderFeed() {
  document.getElementById("feed").innerHTML = shown().map(function (m) {
    const canAct = m.direction === "bus_to_office" && m.status === "pending";
    const cls = m.priority === "emergency" ? "em" : m.priority === "high" ? "hi" : "nm";
    const rec = FleetStore.find(m.bus_id);
    const who = m.direction === "bus_to_office"
      ? (rec ? "Rt " + rec.route_number : "Route " + m.bus_id)
      : ("Office \u2192 " + (m.bus_id ? (rec ? "Rt " + rec.route_number : "Route " + m.bus_id) : "all"));
    return '<article class="msg ' + cls + '">' +
      '<div class="msg-top"><strong>' + who + '</strong>' +
      '<span class="pri ' + m.priority + '">' + m.priority + '</span>' +
      '<span>' + ago(m.timestamp) + '</span>' +
      '<span>' + m.category + '/' + m.type + '</span></div>' +
      '<h3>' + (m.text || m.type) + '</h3>' +
      (canAct
        ? '<div class="actions">' +
          '<button class="ack" data-act="acked" data-id="' + m.msg_id + '">Acknowledge</button>' +
          '<button class="deny" data-act="denied" data-id="' + m.msg_id + '">Deny</button>' +
          '<button data-act="dismissed" data-id="' + m.msg_id + '">Dismiss</button></div>'
        : '<div class="st ' + m.status + '">' + m.status + '</div>') +
      '</article>';
  }).join("") || '<p style="padding:16px;color:#8b97a8">No messages in this filter.</p>';
}

function toast(t) {
  const el = document.getElementById("toast");
  el.textContent = t;
  el.style.display = "block";
  setTimeout(function () { el.style.display = "none"; }, 1800);
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

document.getElementById("add-bus").addEventListener("click", function () { openEditor(null); });
document.getElementById("f-cancel").addEventListener("click", closeEditor);
document.getElementById("mask").addEventListener("click", function (e) { if (e.target.id === "mask") closeEditor(); });
document.getElementById("sel-card").addEventListener("click", function (e) {
  if (e.target.id === "edit-sel") openEditor(FleetStore.find(selected));
});
document.getElementById("f-state").addEventListener("input", function (e) {
  let v = e.target.value.replace(/[^\d]/g, "").slice(0, 7);
  if (v.length > 3) v = v.slice(0, 3) + "-" + v.slice(3);
  e.target.value = v;
});
document.getElementById("bus-form").addEventListener("submit", async function (e) {
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
  toast("Roster saved \u00b7 Rt " + res.row.route_number);
});
document.getElementById("f-del").addEventListener("click", async function () {
  const id = document.getElementById("f-id").value;
  const row = FleetStore.find(id);
  if (!row || !confirm("Remove route " + row.route_number + " from the roster?")) return;
  await FleetStore.remove(id);
  closeEditor();
  renderBuses();
  toast("Removed Rt " + row.route_number);
});

document.getElementById("buses").addEventListener("click", function (e) {
  const row = e.target.closest(".bus");
  if (!row) return;
  selected = row.dataset.id;
  renderBuses();
});
document.getElementById("buses").addEventListener("dblclick", function (e) {
  const row = e.target.closest(".bus");
  if (row) openEditor(FleetStore.find(row.dataset.id));
});
document.querySelector(".filters").addEventListener("click", function (e) {
  const btn = e.target.closest("button");
  if (!btn) return;
  filter = btn.dataset.f;
  document.querySelectorAll(".filters button").forEach(function (b) { b.classList.toggle("on", b === btn); });
  renderFeed();
});
document.getElementById("feed").addEventListener("click", function (e) {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const m = msgs.find(function (x) { return x.msg_id === btn.dataset.id; });
  if (m) m.status = btn.dataset.act;
  renderFeed();
  renderBuses();
  toast("Rt " + ((FleetStore.find(m.bus_id) || {}).route_number || m.bus_id) + " \u00b7 " + m.status);
});
document.getElementById("compose").addEventListener("submit", function (e) {
  e.preventDefault();
  const to = document.getElementById("to").value;
  const type = document.getElementById("otype").value;
  const priority = document.getElementById("opri").value;
  const rec = to === "broadcast" ? null : FleetStore.find(to);
  const text = document.getElementById("otext").value.trim() || type.replaceAll("_", " ");
  msgs.unshift({
    msg_id: "m" + Date.now(),
    timestamp: now(),
    sender: "office",
    direction: "office_to_bus",
    bus_id: to === "broadcast" ? null : to,
    priority: priority, category: "office", type: type, status: "pending", text: text,
    payload: rec ? { state_number: rec.state_number, route_number: rec.route_number, driver_name: rec.driver_name } : null
  });
  document.getElementById("otext").value = "";
  renderFeed();
  toast(to === "broadcast" ? "Broadcast sent" : "Sent to Rt " + (rec ? rec.route_number : to));
});

FleetStore.onChange(function () { renderBuses(); renderFeed(); });

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
  setInterval(function () {
    document.getElementById("clock").textContent = new Date().toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }, 1000);
}
start();
