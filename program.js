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

  function mergeMaps(server, local) {
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

  function sendHydrate() {
    var win = frame.contentWindow;
    if (!win) return;
    win.postMessage({ type: "memtofit-hydrate", data: snapshot() }, "*");
  }

  function onMessage(e) {
    if (!frame.contentWindow || e.source !== frame.contentWindow) return;
    var msg = e.data || {};
    if (msg.type === "memtofit-ready") sendHydrate();
    if (msg.type === "memtofit-save-load") put(state.loads, msg.key, String(msg.value || "").trim());
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
      var loads = mergeMaps(server.loads, local.loads);
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
