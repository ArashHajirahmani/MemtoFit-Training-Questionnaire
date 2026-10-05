(function () {
  var need = document.getElementById("need-link");
  var later = document.getElementById("later");
  var app = document.getElementById("app");
  var frame = document.getElementById("plan-frame");
  var planStatus = document.getElementById("plan-status");
  var logList = document.getElementById("log-list");
  var logForm = document.getElementById("log-form");
  var logStatus = document.getElementById("log-status");

  function logKey(id) {
    return "memtofit-log-" + id;
  }

  function readLocal(id) {
    try {
      var parsed = JSON.parse(localStorage.getItem(logKey(id)) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeLocal(id, entries) {
    localStorage.setItem(logKey(id), JSON.stringify(entries));
  }

  function asList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        var parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    }
    return [];
  }

  function merge(server, local) {
    var map = {};
    function add(list) {
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (!item || !item.at) continue;
        map[item.at] = item;
      }
    }
    add(server);
    add(local);
    var out = [];
    for (var key in map) out.push(map[key]);
    out.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    return out;
  }

  function line(entry) {
    var parts = [];
    if (entry.week) parts.push("Week " + entry.week);
    if (entry.weight) parts.push(entry.weight);
    if (entry.note) parts.push(entry.note);
    return parts.join(" · ");
  }

  function render(entries) {
    logList.innerHTML = "";
    entries.forEach(function (entry) {
      var li = document.createElement("li");
      li.textContent = line(entry);
      logList.appendChild(li);
    });
  }

  function fitFrame() {
    var doc = frame.contentDocument;
    if (!doc || !doc.documentElement) return;
    frame.style.height = doc.documentElement.scrollHeight + "px";
  }

  function showPlan(html) {
    if (/^\s*(<!doctype|<html)/i.test(html)) {
      document.body.classList.add("plan-doc");
      frame.classList.add("full");
      frame.srcdoc = html;
      return;
    }
    frame.addEventListener("load", fitFrame);
    frame.srcdoc = html;
  }

  function openPlan(plan, name) {
    return memtofitCrypto.decryptPlan(name, plan);
  }

  function setStatus(el, text, bad) {
    el.hidden = false;
    el.classList.toggle("bad", !!bad);
    el.textContent = text;
  }

  memtofitGate.start().then(function (session) {
    if (!session) {
      need.hidden = false;
      return;
    }
    var loaded = session.row ? Promise.resolve(session.row) : memtofitSlot.load(session);
    return loaded.then(function (row) {
      if (!row || !row.plan) {
        later.hidden = false;
        return;
      }
      return openPlan(row.plan, session.name).then(function (html) {
        app.hidden = false;
        showPlan(html);
        var entries = merge(asList(row.log), readLocal(session.id));
        writeLocal(session.id, entries);
        render(entries);
        logForm.addEventListener("submit", function (e) {
          e.preventDefault();
          var week = document.getElementById("log-week").value.trim();
          var weight = document.getElementById("log-weight").value.trim();
          var note = document.getElementById("log-note").value.trim();
          if (!week && !weight && !note) return;
          var next = entries.concat([{
            week: week,
            weight: weight,
            note: note,
            at: new Date().toISOString()
          }]);
          writeLocal(session.id, next);
          memtofitSlot.saveLog(session, next).then(function () {
            entries = next;
            render(entries);
            logForm.reset();
            setStatus(logStatus, "Saved.", false);
          }, function () {
            entries = next;
            render(entries);
            setStatus(logStatus, "Could not save. Kept on this phone.", true);
          });
        });
      }).catch(function () {
        app.hidden = false;
        document.getElementById("log-section").hidden = true;
        setStatus(planStatus, "That name did not open the program.", true);
      });
    }).catch(function () {
      need.hidden = false;
    });
  });
})();
