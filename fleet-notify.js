/* Short Web Audio dings. Unlock on first tap so tablets allow sound. */
(function (global) {
  let ctx = null;

  function ac() {
    const C = global.AudioContext || global.webkitAudioContext;
    if (!C) return null;
    if (!ctx) ctx = new C();
    if (ctx.state === "suspended") ctx.resume().catch(function () {});
    return ctx;
  }

  ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
    document.addEventListener(ev, function () { ac(); }, { once: true, passive: true });
  });

  function beep(freq, dur, type, gain, delay) {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  global.FleetNotify = {
    unlock: ac,
    incoming: function (priority) {
      if (priority === "emergency") {
        beep(880, 0.12, "square", 0.16, 0);
        beep(660, 0.12, "square", 0.16, 0.15);
        beep(880, 0.2, "square", 0.16, 0.3);
      } else if (priority === "high") {
        beep(740, 0.12, "triangle", 0.12, 0);
        beep(980, 0.16, "triangle", 0.12, 0.14);
      } else {
        beep(880, 0.08, "sine", 0.1, 0);
        beep(1174, 0.12, "sine", 0.1, 0.1);
      }
    },
    reply: function (status) {
      if (status === "acked") {
        beep(523, 0.08, "sine", 0.1, 0);
        beep(784, 0.14, "sine", 0.1, 0.1);
      } else if (status === "denied") {
        beep(392, 0.18, "sawtooth", 0.08, 0);
      } else {
        beep(494, 0.08, "sine", 0.06, 0);
      }
    },
    link: function (online) {
      if (online) {
        beep(660, 0.08, "sine", 0.1, 0);
        beep(880, 0.16, "sine", 0.1, 0.1);
      } else {
        beep(494, 0.1, "triangle", 0.09, 0);
        beep(330, 0.2, "triangle", 0.09, 0.12);
      }
    }
  };
})(window);
