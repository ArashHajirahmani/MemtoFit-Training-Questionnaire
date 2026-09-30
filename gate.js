(function () {
  var LEGACY_NAME = "memtofit-name";
  var currentId = "";
  var currentName = "";

  var style = document.createElement("style");
  style.textContent = [
    "#name-gate{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:1.1rem;background:rgba(24,31,23,0.45)}",
    "#name-gate[hidden]{display:none}",
    "#name-gate form{width:min(22rem,100%);margin:0;padding:1.2rem 1.1rem 1.15rem;background:#f7f4ee;border-radius:0.8rem}",
    "#name-gate p{margin:0 0 0.75rem;font:700 1.15rem/1.3 system-ui,sans-serif;color:#181F17}",
    "#name-gate .err{margin:-0.2rem 0 0.75rem;font:600 0.92rem/1.35 system-ui,sans-serif;color:#b42318}",
    "#name-gate input{width:100%;min-height:2.75rem;padding:0.65rem 0.75rem;border:1.5px solid #c9c4b8;border-radius:0.55rem;background:#fffdf8;font:inherit}",
    "#name-gate button{width:100%;min-height:2.75rem;margin-top:0.7rem;border:0;border-radius:0.7rem;background:#2C4A27;color:#F2F2F2;font:600 0.95rem/1 system-ui,sans-serif;cursor:pointer}",
    "#name-gate button:disabled{opacity:0.6;cursor:default}"
  ].join("");
  document.head.appendChild(style);

  function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, "");
  }

  function asId(raw) {
    raw = String(raw || "").trim().split(".")[0];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return "";
    return raw.toLowerCase();
  }

  function parseId() {
    var fromQuery = "";
    try {
      fromQuery = new URLSearchParams(location.search).get("s") || "";
    } catch (err) {}
    return asId(fromQuery) || asId(location.hash.replace(/^#/, ""));
  }

  function storeKey(id) {
    return "memtofit-slot-" + id;
  }

  function savedName(id) {
    try {
      return localStorage.getItem(storeKey(id)) || "";
    } catch (err) {
      return "";
    }
  }

  function remember(id, name, token) {
    try {
      localStorage.setItem(storeKey(id), name);
      localStorage.removeItem(LEGACY_NAME);
    } catch (err) {}
    var secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = "memtofit-" + id + "=" + encodeURIComponent(token) +
      "; Path=/; Max-Age=31536000; SameSite=Lax" + secure;
  }

  function forget(id) {
    try {
      localStorage.removeItem(storeKey(id));
    } catch (err) {}
    document.cookie = "memtofit-" + id + "=; Path=/; Max-Age=0; SameSite=Lax";
  }

  function deriveToken(name) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(name)).then(function (buf) {
      var bytes = new Uint8Array(buf);
      var hex = "";
      for (var i = 0; i < bytes.length; i++) {
        var h = bytes[i].toString(16);
        if (h.length < 2) hex += "0";
        hex += h;
      }
      return hex;
    });
  }

  function useSlotUrl(id) {
    var next = location.pathname + "?s=" + id;
    if (location.pathname + location.search === next && !location.hash) return;
    history.replaceState(null, "", next);
  }

  function overlay() {
    var el = document.getElementById("name-gate");
    if (el) return el;
    el = document.createElement("div");
    el.id = "name-gate";
    el.innerHTML = '<form><p>What\u2019s your name?</p><p class="err" id="name-gate-error" hidden></p><input id="name-gate-input" type="text" autocomplete="name"><button type="submit">Continue</button></form>';
    document.body.appendChild(el);
    return el;
  }

  function showError(el, text) {
    var err = el.querySelector(".err");
    err.hidden = !text;
    err.textContent = text || "";
  }

  function openWith(id, name) {
    return deriveToken(name).then(function (token) {
      var session = { id: id, token: token, name: name };
      return window.memtofitSlot.load(session).then(function (row) {
        session.row = row;
        remember(id, name, token);
        return session;
      });
    });
  }

  function prompt(id, message) {
    var el = overlay();
    el.hidden = false;
    showError(el, message);
    var form = el.querySelector("form");
    var input = el.querySelector("input");
    var button = el.querySelector("button");
    input.value = "";
    input.focus();
    return new Promise(function (resolve) {
      function onSubmit(e) {
        e.preventDefault();
        var name = normalizeName(input.value);
        if (!name) return;
        button.disabled = true;
        openWith(id, name).then(function (session) {
          form.removeEventListener("submit", onSubmit);
          el.hidden = true;
          button.disabled = false;
          resolve(session);
        }, function (err) {
          button.disabled = false;
          if (err && err.denied) showError(el, "That name does not open this link.");
          else showError(el, "Could not reach the server. Try again.");
          input.focus();
        });
      }
      form.addEventListener("submit", onSubmit);
    });
  }

  function unlock(id) {
    var name = savedName(id);
    if (!name) return prompt(id, "");
    return openWith(id, name).catch(function (err) {
      if (err && err.denied) {
        forget(id);
        return prompt(id, "That name does not open this link.");
      }
      return prompt(id, "Could not reach the server. Try again.");
    });
  }

  function bind(session) {
    currentId = session.id;
    currentName = session.name;
    useSlotUrl(session.id);
    var home = document.getElementById("home-link");
    if (home) home.href = "./?s=" + session.id;
    if (window.memtofitSession && window.memtofitSession.id === session.id) {
      window.memtofitSession.token = session.token;
      window.memtofitSession.name = session.name;
      window.memtofitSession.row = session.row;
    }
    return session;
  }

  function start() {
    var id = parseId();
    if (!id) return Promise.resolve(null);
    try { localStorage.removeItem(LEGACY_NAME); } catch (err) {}
    return unlock(id).then(bind);
  }

  window.addEventListener("hashchange", function () {
    var id = parseId();
    if (id && id !== currentId) location.reload();
  });

  function askName(force) {
    if (!force && currentName) return Promise.resolve(currentName);
    if (!currentId) return Promise.resolve("");
    if (force) forget(currentId);
    return prompt(currentId, force ? "Type the name for this link." : "").then(function (session) {
      return bind(session).name;
    });
  }

  window.memtofitGate = {
    start: start,
    askName: askName,
    name: function () { return currentName || (currentId ? savedName(currentId) : ""); },
    normalizeName: normalizeName
  };
})();
