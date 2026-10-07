(function () {
  var need = document.getElementById("need-link");
  var later = document.getElementById("later");
  var app = document.getElementById("app");
  var frame = document.getElementById("plan-frame");
  var planStatus = document.getElementById("plan-status");
  var session = null;
  var state = { unit: "lb", loads: {}, days: {} };

  function logKey(id) {
    return "memtofit-log-" + id;
  }

  function placeKey(id) {
    return "memtofit-place-" + id;
  }

  function readPlace() {
    if (!session) return { week: 0, day: 0 };
    try {
      var parsed = JSON.parse(sessionStorage.getItem(placeKey(session.id)) || "null");
      if (!parsed || typeof parsed.week !== "number" || typeof parsed.day !== "number") return { week: 0, day: 0 };
      if (parsed.week < 0 || parsed.day < 0) return { week: 0, day: 0 };
      return { week: parsed.week, day: parsed.day };
    } catch (err) {
      return { week: 0, day: 0 };
    }
  }

  function writePlace(week, day) {
    if (!session) return;
    try {
      sessionStorage.setItem(placeKey(session.id), JSON.stringify({ week: week, day: day }));
    } catch (err) {}
  }

  function readLocal(id) {
    try {
      var parsed = JSON.parse(localStorage.getItem(logKey(id)) || "null");
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writeLocal() {
    if (!session) return;
    localStorage.setItem(logKey(session.id), JSON.stringify(state));
  }

  function asObject(value) {
    if (!value) return null;
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (err) { return null; }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value;
  }

  function stamp(rec) {
    return rec && rec.at ? rec.at : "";
  }

  function score(raw) {
    var n = parseFloat(String(raw == null ? "" : raw).replace(",", "."));
    return isFinite(n) ? n : null;
  }

  function bestText(rec) {
    if (!rec) return "";
    if (rec.best != null && rec.best !== "") return String(rec.best);
    if (rec.v != null && rec.v !== "") return String(rec.v);
    return "";
  }

  function withBest(prev, value) {
    var next = score(value);
    var oldText = bestText(prev);
    var old = score(oldText);
    var best = value;
    if (old != null && (next == null || next < old)) best = oldText;
    return { v: value, at: new Date().toISOString(), best: best };
  }

  function mergeLoad(a, b) {
    var chosen = stamp(a) >= stamp(b) ? a : b;
    var out = { v: chosen.v, at: chosen.at || "" };
    var textA = bestText(a);
    var textB = bestText(b);
    var bestA = score(textA);
    var bestB = score(textB);
    if (bestA == null && bestB == null) return out;
    if (bestB == null || (bestA != null && bestA > bestB)) out.best = textA;
    else if (bestA == null || bestB > bestA) out.best = textB;
    else out.best = stamp(a) >= stamp(b) ? textA : textB;
    return out;
  }

  function mergeMaps(server, local, keepBest) {
    var out = {};
    var seen = {};
    var key;
    server = server || {};
    local = local || {};
    for (key in server) seen[key] = true;
    for (key in local) seen[key] = true;
    for (key in seen) {
      if (!server[key]) out[key] = local[key];
      else if (!local[key]) out[key] = server[key];
      else if (keepBest) out[key] = mergeLoad(server[key], local[key]);
      else out[key] = stamp(server[key]) >= stamp(local[key]) ? server[key] : local[key];
    }
    return out;
  }

  function unitFromAnswers(text) {
    var match = String(text || "").match(/\*\*Weight unit:\*\*\s*(.+)/i);
    if (!match) return "";
    var value = match[1].toLowerCase();
    if (value.indexOf("kg") !== -1 || value.indexOf("metric") !== -1) return "kg";
    if (value.indexOf("lb") !== -1 || value.indexOf("pound") !== -1) return "lb";
    return "";
  }

  function snapshot() {
    return JSON.parse(JSON.stringify({ unit: state.unit, loads: state.loads, days: state.days }));
  }

  function same(a, b) {
    return JSON.stringify(a || {}) === JSON.stringify(b || {});
  }

  var saving = false;
  var dirty = false;

  function persist() {
    writeLocal();
    dirty = true;
    if (saving) return;
    saving = true;
    function step(tries) {
      dirty = false;
      var saved = snapshot();
      return memtofitSlot.saveLog(session, saved).then(function () {
        if (dirty) return step(0);
        saving = false;
      }, function () {
        if (dirty && tries < 2) return step(tries + 1);
        saving = false;
      });
    }
    step(0);
  }

  function put(map, key, value) {
    if (!key) return;
    if (value) map[key] = { v: value, at: new Date().toISOString() };
    else delete map[key];
    persist();
  }

  function putLoad(key, value) {
    if (!key) return;
    value = String(value || "").trim();
    if (!value) return;
    state.loads[key] = withBest(state.loads[key], value);
    persist();
  }

  function sendHydrate() {
    var win = frame.contentWindow;
    if (!win) return;
    win.postMessage({ type: "memtofit-hydrate", data: snapshot(), place: readPlace() }, "*");
  }

  function onMessage(e) {
    if (!frame.contentWindow || e.source !== frame.contentWindow) return;
    var msg = e.data || {};
    if (msg.type === "memtofit-ready") sendHydrate();
    if (msg.type === "memtofit-place" && typeof msg.week === "number" && typeof msg.day === "number") {
      writePlace(msg.week, msg.day);
    }
    if (msg.type === "memtofit-save-load") putLoad(msg.key, String(msg.value || "").trim());
    if (msg.type === "memtofit-save-day") put(state.days, msg.key, String(msg.value || "").trim());
  }

  function showPlan(html) {
    if (/^\s*(<!doctype|<html)/i.test(html)) {
      document.body.classList.add("plan-doc");
      frame.classList.add("full");
    }
    frame.srcdoc = html;
  }

  function setStatus(text) {
    planStatus.hidden = false;
    planStatus.classList.add("bad");
    planStatus.textContent = text;
  }

  window.addEventListener("message", onMessage);
  frame.addEventListener("load", sendHydrate);

  memtofitGate.start().then(function (opened) {
    if (!opened) {
      need.hidden = false;
      return;
    }
    session = opened;
    var loaded = session.row ? Promise.resolve(session.row) : memtofitSlot.load(session);
    return loaded.then(function (row) {
      if (!row || !row.plan) {
        later.hidden = false;
        return;
      }
      var server = asObject(row.log) || {};
      var local = asObject(readLocal(session.id)) || {};
      var loads = mergeMaps(server.loads, local.loads, true);
      var days = mergeMaps(server.days, local.days);
      state = {
        unit: unitFromAnswers(row.answers) || (server.unit === "kg" ? "kg" : "lb"),
        loads: loads,
        days: days
      };
      writeLocal();
      if (!same(server.loads || {}, loads) || !same(server.days || {}, days)) persist();
      return memtofitCrypto.decryptPlan(session.name, row.plan).then(function (html) {
        app.hidden = false;
        showPlan(html);
      });
    }).catch(function () {
      app.hidden = false;
      setStatus("That name did not open the program.");
    });
  }).catch(function () {
    need.hidden = false;
  });
})();
