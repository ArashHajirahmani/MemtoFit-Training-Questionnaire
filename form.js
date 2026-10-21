(function () {
  var printBtn = document.getElementById("print-btn");
  var submitBtn = document.getElementById("submit-btn");

  function radioOn(name) {
    return !!document.querySelector('input[type="radio"][name="' + name + '"]:checked');
  }

  function sessions() {
    var el = document.querySelector('input[name="nper"]:checked');
    return el && el.value ? parseInt(el.value, 10) : 0;
  }

  function dayCount() {
    return document.querySelectorAll('input[name="day"]:checked').length;
  }

  function setErr(card, msg) {
    if (!card) return;
    var p = card.querySelector(".err");
    if (msg) {
      card.classList.add("invalid");
      if (p) p.textContent = msg;
    } else {
      card.classList.remove("invalid");
      if (p) p.textContent = "";
    }
  }

  var revealed = false;

  function check(show) {
    var ok = true;
    var first = null;

    function need(card, pass, msg) {
      if (pass) {
        setErr(card, "");
        return;
      }
      ok = false;
      if (show) setErr(card, msg);
      else setErr(card, "");
      if (!first) first = card;
    }

    need(
      document.querySelector('[data-req="name"]'),
      !!(document.getElementById("name") && document.getElementById("name").value.trim()),
      "Name is needed."
    );
    need(document.querySelector('[data-req="sex"]'), radioOn("sex"), "Choose one.");
    need(document.querySelector('[data-req="goal"]'), radioOn("goal"), "Choose one.");
    need(document.querySelector('[data-req="nper"]'), radioOn("nper"), "Choose one.");

    var n = sessions();
    var d = dayCount();
    var daysCard = document.querySelector('[data-req="days"]');
    if (d === 0) need(daysCard, false, "Mark every day you can train.");
    else if (n && d < n) need(daysCard, false, "Pick at least as many days as sessions.");
    else need(daysCard, true, "");

    var m = document.querySelectorAll('input[name="muscle"]:checked').length;
    var mCard = document.querySelector('[data-req="muscles"]');
    if (m > 3) {
      ok = false;
      setErr(mCard, "Pick up to 3.");
      if (!first) first = mCard;
    } else {
      setErr(mCard, "");
    }

    need(document.querySelector('[data-req="mins"]'), radioOn("mins"), "Choose one.");
    need(document.querySelector('[data-req="gym"]'), radioOn("gym"), "Choose one.");
    need(document.querySelector('[data-req="wunit"]'), radioOn("wunit"), "Choose pounds or metric.");

    var limList = document.getElementById("lim-list");
    var limOk = true;
    if (limList) {
      var blocks = limList.querySelectorAll(".lim");
      for (var i = 0; i < blocks.length; i++) {
        var fields = blocks[i].querySelectorAll("input, select");
        var what = fields[0] && fields[0].value.trim();
        var level = fields[2] && fields[2].value.trim();
        var side = fields[1] && fields[1].value.trim();
        if (fields[2]) fields[2].required = !!what;
        if (what && !/^[1-4](?:\s|$)/.test(level)) limOk = false;
        if (!what && (side || level)) limOk = false;
      }
    }
    need(limList && limList.closest(".card"), limOk, "Enter each injury or limitation and choose a level from 1 to 4.");

    var flag = ok ? "false" : "true";
    if (printBtn) printBtn.setAttribute("aria-disabled", flag);
    if (submitBtn) submitBtn.setAttribute("aria-disabled", flag);

    return { ok: ok, first: first };
  }

  function blockIfInvalid(e) {
    revealed = true;
    var r = check(true);
    if (r.ok) return true;
    if (e) e.preventDefault();
    if (r.first) r.first.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }

  window.memtofitReady = function () {
    return blockIfInvalid();
  };

  var main = document.querySelector("main.wrap");
  if (main) {
    main.addEventListener("change", function () {
      revealed = true;
      check(true);
    });
    main.addEventListener("input", function () {
      revealed = true;
      check(true);
    });
  }

  if (printBtn) {
    printBtn.addEventListener("click", function (e) {
      if (blockIfInvalid(e)) window.print();
    });
  }

  check(false);
})();
