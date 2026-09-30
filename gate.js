(function () {
  var NAME_KEY = "memtofit-name";

  var style = document.createElement("style");
  style.textContent = [
    "#name-gate{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:1.1rem;background:rgba(24,31,23,0.45)}",
    "#name-gate[hidden]{display:none}",
    "#name-gate form{width:min(22rem,100%);margin:0;padding:1.2rem 1.1rem 1.15rem;background:#f7f4ee;border-radius:0.8rem}",
    "#name-gate p{margin:0 0 0.75rem;font:700 1.15rem/1.3 system-ui,sans-serif;color:#181F17}",
    "#name-gate input{width:100%;min-height:2.75rem;padding:0.65rem 0.75rem;border:1.5px solid #c9c4b8;border-radius:0.55rem;background:#fffdf8;font:inherit}",
    "#name-gate button{width:100%;min-height:2.75rem;margin-top:0.7rem;border:0;border-radius:0.7rem;background:#2C4A27;color:#F2F2F2;font:600 0.95rem/1 system-ui,sans-serif;cursor:pointer}"
  ].join("");
  document.head.appendChild(style);

  function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, "");
  }

  function parseHash() {
    var raw = location.hash.replace(/^#/, "").trim();
    var dot = raw.indexOf(".");
    if (dot < 1) return null;
    var id = raw.slice(0, dot);
    var token = raw.slice(dot + 1);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    if (!/^[0-9a-f]{16,}$/i.test(token)) return null;
    return { id: id, token: token };
  }

  function savedName() {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function storeName(name) {
    localStorage.setItem(NAME_KEY, name);
  }

  var pending = null;

  function askName(force) {
    if (!force && savedName()) return Promise.resolve(savedName());
    if (pending) return pending;
    pending = new Promise(function (resolve) {
      var overlay = document.getElementById("name-gate");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "name-gate";
        overlay.innerHTML = '<form><p>What\u2019s your name?</p><input id="name-gate-input" type="text" autocomplete="name"><button type="submit">Continue</button></form>';
        document.body.appendChild(overlay);
      }
      overlay.hidden = false;
      var form = overlay.querySelector("form");
      var input = overlay.querySelector("input");
      input.value = "";
      function onSubmit(e) {
        e.preventDefault();
        var name = normalizeName(input.value);
        if (!name) return;
        storeName(name);
        overlay.hidden = true;
        form.removeEventListener("submit", onSubmit);
        pending = null;
        resolve(name);
      }
      form.addEventListener("submit", onSubmit);
      input.focus();
    });
    return pending;
  }

  function start() {
    var slot = parseHash();
    if (!slot) return Promise.resolve(null);
    return askName(false).then(function (name) {
      var home = document.getElementById("home-link");
      if (home) home.hash = location.hash;
      return { id: slot.id, token: slot.token, name: name };
    });
  }

  window.memtofitGate = {
    start: start,
    askName: askName,
    name: savedName,
    normalizeName: normalizeName
  };
})();
