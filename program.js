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

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function localDay(date) {
    var d = date || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function canonicalKey(key) {
    return String(key || "").replace(/^\d+:/, "");
  }

  function entryScore(text, unit) {
    var raw = String(text == null ? "" : text).trim().toLowerCase().replace(",", ".");
    var clock = raw.match(/^(\d+):(\d{1,2})$/);
    if (clock) return (Number(clock[1]) * 60) + Number(clock[2]);
    var minutes = raw.match(/^(\d+(?:\.\d+)?)\s*(?:min|m)$/);
    if (minutes) return Math.round(parseFloat(minutes[1]) * 60);
    var seconds = raw.match(/^(\d+(?:\.\d+)?)\s*(?:sec|s)$/);
    if (seconds) return parseFloat(seconds[1]);
    var n = parseFloat(raw);
    if (!isFinite(n)) return null;
    if (unit === "min") return Math.round(n * 60);
    return n;
  }

  function asDays(rec) {
    var days = {};
    var kind = rec && rec.kind === "time" ? "time" : "load";
    var unit = rec && rec.unit === "min" ? "min" : (kind === "time" ? "sec" : "lb");
    if (rec && rec.days && typeof rec.days === "object" && !Array.isArray(rec.days)) {
      var day;
      for (day in rec.days) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        var item = rec.days[day];
        var text = item && typeof item === "object" ? item.v : item;
        text = String(text == null ? "" : text).trim();
        if (!text) continue;
        days[day] = { v: text, at: item && item.at ? item.at : "" };
      }
    }
    if (!Object.keys(days).length && rec && rec.v) {
      var when = "";
      if (rec.at) {
        var parsed = new Date(rec.at);
        if (!isNaN(parsed.getTime())) when = localDay(parsed);
      }
      if (!when) when = localDay();
      days[when] = { v: String(rec.v).trim(), at: rec.at || "" };
    }
    return { kind: kind, unit: unit, days: days };
  }

  function finish(kind, unit, days, extras) {
    var dates = Object.keys(days);
    if (!dates.length) return null;
    var scoreUnit = kind === "time" ? (unit === "min" ? "min" : "sec") : "lb";
    var bestText = "";
    var bestN = null;
    function consider(text) {
      if (text == null || text === "") return;
      var n = entryScore(text, scoreUnit);
      if (n == null) return;
      if (bestN == null || n > bestN) {
        bestN = n;
        bestText = String(text);
      }
    }
    dates.forEach(function (day) { consider(days[day].v); });
    (extras || []).forEach(function (rec) {
      if (!rec) return;
      consider(rec.best);
    });
    dates.sort();
    var last = days[dates[dates.length - 1]];
    var out = { kind: kind, unit: scoreUnit, days: days, v: last.v, at: last.at || "" };
    if (bestText) out.best = bestText;
    return out;
  }

  function mergeSeries(a, b) {
    var left = asDays(a);
    var right = asDays(b);
    var kind = left.kind === "time" || right.kind === "time" ? "time" : "load";
    var unit = left.unit === "min" || right.unit === "min" ? "min" : (kind === "time" ? "sec" : "lb");
    var days = {};
    [left, right].forEach(function (src) {
      var day;
      for (day in src.days) {
        if (!days[day] || stamp(src.days[day]) >= stamp(days[day])) days[day] = src.days[day];
      }
    });
    return finish(kind, unit, days, [a, b]);
  }

  function foldLoads(map) {
    var grouped = {};
    var key;
    map = map || {};
    for (key in map) {
      if (!map[key] || typeof map[key] !== "object") continue;
      var canon = canonicalKey(key);
      if (!canon) continue;
      var parsed = asDays(map[key]);
      var packed = finish(parsed.kind, parsed.unit, parsed.days, [map[key]]);
      grouped[canon] = grouped[canon] && packed ? mergeSeries(grouped[canon], packed) : (packed || grouped[canon]);
    }
    var out = {};
    for (key in grouped) if (grouped[key]) out[key] = grouped[key];
    return out;
  }

  function mergeLoadMaps(server, local) {
    var folded = foldLoads(server);
    var extra = foldLoads(local);
    var key;
    for (key in extra) folded[key] = folded[key] ? mergeSeries(folded[key], extra[key]) : extra[key];
    return folded;
  }

  function presentLoads(loads) {
    var out = {};
    var key;
    var i;
    for (key in loads) {
      out[key] = loads[key];
      if (/^\d+:/.test(key)) continue;
      for (i = 0; i < 7; i++) out[i + ":" + key] = loads[key];
    }
    return out;
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
    var match = String(text || "").match(/\*\*(?:Gym weight units|Weight unit):\*\*\s*(.+)/i);
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

  function putLoad(key, value, kind, unit) {
    var canon = canonicalKey(key);
    if (!canon) return;
    value = String(value || "").trim();
    var prev = state.loads[canon];
    var parsed = asDays(prev);
    if (kind === "time") parsed.kind = "time";
    if (parsed.kind === "time") parsed.unit = unit === "min" || parsed.unit === "min" ? "min" : "sec";
    var day = localDay();
    if (value) parsed.days[day] = { v: value, at: new Date().toISOString() };
    else delete parsed.days[day];
    var packed = finish(parsed.kind, parsed.unit, parsed.days, [prev]);
    if (packed) state.loads[canon] = packed;
    else delete state.loads[canon];
    persist();
  }

  function sendHydrate() {
    var win = frame.contentWindow;
    if (!win) return;
    var data = snapshot();
    data.loads = presentLoads(data.loads);
    win.postMessage({ type: "memtofit-hydrate", data: data, place: readPlace() }, "*");
  }

  function onMessage(e) {
    if (!frame.contentWindow || e.source !== frame.contentWindow) return;
    var msg = e.data || {};
    if (msg.type === "memtofit-ready") sendHydrate();
    if (msg.type === "memtofit-place" && typeof msg.week === "number" && typeof msg.day === "number") {
      writePlace(msg.week, msg.day);
    }
    if (msg.type === "memtofit-save-load") putLoad(msg.key, String(msg.value || "").trim(), msg.kind, msg.unit);
    if (msg.type === "memtofit-save-day") put(state.days, msg.key, String(msg.value || "").trim());
  }

  function preparePlan(html) {
    html = String(html || "").replace(
      "if (focus) load.focus();",
      "if (focus) { load.blur(); setTimeout(function () { if (document.activeElement === load) load.blur(); }, 0); }"
    );
    if (html.indexOf("site-foot") === -1 && html.indexOf("</body>") !== -1) {
      var css = ".site-foot{margin:0;padding:8px 14px calc(18px + env(safe-area-inset-bottom,0px));text-align:center;color:#667061;font-size:12px;line-height:1.4}.site-foot p{margin:0}";
      var foot = '<footer class="site-foot"><p>v2.1 · © 2026 memtoria.com</p></footer>';
      if (html.indexOf("</style>") !== -1) html = html.replace("</style>", css + "</style>");
      html = html.replace("</body>", foot + "</body>");
    }
    return html;
  }

  function showPlan(html) {
    html = preparePlan(html);
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
      var loads = mergeLoadMaps(server.loads, local.loads);
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
