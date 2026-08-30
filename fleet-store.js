/* Shared FleetCom roster. Office writes; bus reads.
   Prefers /api/roster (serve.py). Falls back to localStorage so two tabs
   on the same origin still share a list without the custom server. */
(function (global) {
  const KEY = "fleetcom.roster";
  const SEL = "fleetcom.selected_bus";
  const CHANNEL = "fleetcom-roster";
  const SC_BUS = /^\d{3}-\d{4}$/;

  const seed = [
    { id: "42", state_number: "508-6238", route_number: "42", driver_name: "M. Hayes", comment: "Seneca HS AM" },
    { id: "17", state_number: "508-6104", route_number: "17", driver_name: "R. Owens", comment: "Walhalla ES" },
    { id: "08", state_number: "508-5881", route_number: "8", driver_name: "T. Cannon", comment: "West-Oak MS — spare radio 2" },
    { id: "23", state_number: "508-6019", route_number: "23", driver_name: "L. Grant", comment: "Tamassee-Salem" },
    { id: "31", state_number: "508-6144", route_number: "31", driver_name: "C. Briggs", comment: "Ravenel ES" },
    { id: "05", state_number: "508-5722", route_number: "5", driver_name: "A. Pruitt", comment: "Blue Ridge" }
  ];

  const listeners = new Set();
  let roster = [];
  let backend = false;
  let bc = null;

  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (ev) => {
      if (ev.data && ev.data.type === "roster") {
        roster = ev.data.list;
        localStorage.setItem(KEY, JSON.stringify(roster));
        listeners.forEach((fn) => fn(roster));
      }
    };
  } catch (_) {}

  function normalize(row) {
    return {
      id: String(row.id || "").trim(),
      state_number: String(row.state_number || "").trim(),
      route_number: String(row.route_number || "").trim(),
      driver_name: String(row.driver_name || "").trim(),
      comment: String(row.comment || "").trim()
    };
  }

  function validate(row, list, editingId) {
    const r = normalize(row);
    if (!SC_BUS.test(r.state_number)) {
      return { ok: false, error: "State bus number must look like 508-6238 (3 digits, hyphen, 4 digits)." };
    }
    if (!r.route_number) return { ok: false, error: "Route number is required." };
    const clashState = list.find((b) => b.state_number === r.state_number && b.id !== editingId);
    if (clashState) return { ok: false, error: "That state bus number is already on the roster." };
    const clashRoute = list.find((b) => b.route_number === r.route_number && b.id !== editingId);
    if (clashRoute) return { ok: false, error: "That route number is already assigned." };
    return { ok: true, row: r };
  }

  function newId(row, list) {
    const base = String(row.route_number || "").replace(/\s+/g, "");
    if (base && !list.some((b) => b.id === base)) return base;
    return "b-" + Date.now().toString(36);
  }

  async function pullApi() {
    const res = await fetch("/api/roster", { cache: "no-store" });
    if (!res.ok) throw new Error("api");
    return res.json();
  }

  async function pushApi(list) {
    const res = await fetch("/api/roster", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(list)
    });
    if (!res.ok) throw new Error("api");
  }

  function persistLocal(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
    try { if (bc) bc.postMessage({ type: "roster", list }); } catch (_) {}
  }

  const Store = {
    SC_BUS,
    hasBackend() { return backend; },
    get() { return roster.slice(); },
    find(id) { return roster.find((b) => b.id === id) || null; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async load() {
      try {
        const list = await pullApi();
        backend = true;
        roster = Array.isArray(list) ? list.map(normalize) : [];
        persistLocal(roster);
      } catch (_) {
        backend = false;
        try {
          const raw = localStorage.getItem(KEY);
          roster = raw ? JSON.parse(raw).map(normalize) : seed.map(normalize);
        } catch {
          roster = seed.map(normalize);
        }
      }
      listeners.forEach((fn) => fn(roster));
      return roster.slice();
    },

    async save(list) {
      roster = list.map(normalize);
      persistLocal(roster);
      if (backend) {
        try { await pushApi(roster); } catch (_) {}
      }
      listeners.forEach((fn) => fn(roster));
      return roster.slice();
    },

    async upsert(input) {
      const editingId = input.id || null;
      const check = validate(input, roster, editingId);
      if (!check.ok) return check;
      const row = check.row;
      if (editingId && roster.some((b) => b.id === editingId)) {
        row.id = editingId;
        roster = roster.map((b) => (b.id === editingId ? row : b));
      } else {
        row.id = newId(row, roster);
        roster = roster.concat([row]);
      }
      await Store.save(roster);
      return { ok: true, row };
    },

    async remove(id) {
      roster = roster.filter((b) => b.id !== id);
      if (Store.getSelectedId() === id) Store.setSelectedId(null);
      await Store.save(roster);
    },

    getSelectedId() { return localStorage.getItem(SEL); },
    setSelectedId(id) {
      if (!id) localStorage.removeItem(SEL);
      else localStorage.setItem(SEL, id);
    },
    getSelected() {
      const id = Store.getSelectedId();
      return id ? Store.find(id) : null;
    }
  };

  window.addEventListener("storage", (ev) => {
    if (ev.key === KEY && ev.newValue) {
      try {
        roster = JSON.parse(ev.newValue);
        listeners.forEach((fn) => fn(roster));
      } catch (_) {}
    }
  });

  global.FleetStore = Store;
})(window);
