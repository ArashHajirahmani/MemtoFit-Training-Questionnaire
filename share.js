(function () {
  function compact(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function optionLabel(input) {
    var label = input.closest("label");
    if (!label) return "";
    var span = label.querySelector("span");
    var node = (span || label).cloneNode(true);
    var smalls = node.querySelectorAll("small");
    for (var i = 0; i < smalls.length; i++) smalls[i].remove();
    return compact(node.textContent);
  }

  function addLine(lines, label, value) {
    value = compact(value);
    if (!value) return;
    lines.push("- **" + label + ":** " + value);
  }

  function addBlock(lines, label, value) {
    value = (value || "").trim();
    if (!value) return;
    lines.push("- **" + label + ":**");
    lines.push("");
    lines.push(value);
    lines.push("");
  }

  function radioIn(card) {
    var names = [];
    var seen = {};
    var radios = card.querySelectorAll('input[type="radio"]');
    for (var i = 0; i < radios.length; i++) {
      var name = radios[i].name;
      if (!name || seen[name]) continue;
      seen[name] = true;
      names.push(name);
    }
    var out = [];
    for (var n = 0; n < names.length; n++) {
      var el = card.querySelector('input[type="radio"][name="' + names[n] + '"]:checked');
      if (el) out.push(optionLabel(el));
    }
    return out.join(", ");
  }

  function checksIn(card) {
    var out = [];
    var boxes = card.querySelectorAll('input[type="checkbox"]:checked');
    for (var i = 0; i < boxes.length; i++) out.push(optionLabel(boxes[i]));
    return out.join(", ");
  }

  function labeledFields(card, lines) {
    var labels = card.querySelectorAll("label.field");
    for (var i = 0; i < labels.length; i++) {
      var lab = labels[i];
      if (lab.closest(".lim")) continue;
      var id = lab.getAttribute("for");
      var input = id ? document.getElementById(id) : null;
      if (!input) continue;
      if (input.id === "birth-month") {
        var month = compact(input.value);
        var yearEl = document.getElementById("birth-year");
        var year = compact(yearEl && yearEl.value);
        addLine(lines, compact(lab.textContent), compact([month, year].filter(Boolean).join(" ")));
        continue;
      }
      var val = compact(input.value);
      if (!val) continue;
      var unit = document.getElementById(input.id + "-unit");
      if (unit && unit.selectedIndex >= 0) {
        val += " " + compact(unit.options[unit.selectedIndex].text);
      }
      if (input.tagName === "TEXTAREA") addBlock(lines, compact(lab.textContent), val);
      else addLine(lines, compact(lab.textContent), val);
    }
  }

  function limitations() {
    var rows = [];
    var blocks = document.querySelectorAll("#lim-list .lim");
    for (var i = 0; i < blocks.length; i++) {
      var inputs = blocks[i].querySelectorAll("input, select");
      var what = compact(inputs[0] && inputs[0].value);
      var side = compact(inputs[1] && inputs[1].value);
      var level = compact(inputs[2] && inputs[2].value);
      if (!what && !side && !level) continue;
      var parts = [what || "(not specified)"];
      if (side) parts.push(side);
      if (level) parts.push(level);
      rows.push(parts.join("; "));
    }
    return rows;
  }

  function buildMarkdown() {
    var lines = ["# MemtoFit training profile", ""];
    var kids = document.querySelector("main.wrap").children;

    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.tagName === "H2") {
        lines.push("## " + compact(el.textContent).replace(/^Part \d+ - /, ""));
        lines.push("");
        continue;
      }
      if (!el.classList || !el.classList.contains("card")) continue;

      var title = el.querySelector(".q");
      var titleText = title ? compact(title.textContent) : "";
      var choice = radioIn(el) || checksIn(el);
      if (titleText && choice) addLine(lines, titleText, choice);

      if (el.querySelector("#lim-list")) {
        var lims = limitations();
        for (var L = 0; L < lims.length; L++) lines.push("- " + lims[L]);
      }

      labeledFields(el, lines);
      lines.push("");
    }

    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push("");
    return lines.join("\n");
  }

  var saving = false;

  function submitAnswers() {
    if (saving) return;
    if (window.memtofitReady && !window.memtofitReady()) return;
    var text = buildMarkdown();
    var status = document.getElementById("save-status");
    var btn = document.getElementById("submit-btn");

    function mark(ok) {
      if (ok) {
        if (status) {
          status.hidden = true;
          status.textContent = "";
          status.classList.remove("bad");
        }
        var dialog = document.getElementById("saved-dialog");
        if (dialog && !dialog.open) dialog.showModal();
        return;
      }
      if (!status) return;
      status.hidden = false;
      status.classList.add("bad");
      status.textContent = "Could not submit. Try again.";
    }

    function done() {
      saving = false;
      if (btn) btn.disabled = false;
    }

    var session = window.memtofitSession;
    if (!session || !window.memtofitSlot || !window.memtofitGate) {
      mark(false);
      return;
    }
    saving = true;
    if (btn) btn.disabled = true;
    window.memtofitSlot.saveAnswers(session, window.memtofitGate.name(), text).then(function () {
      mark(true);
      done();
    }, function () {
      mark(false);
      done();
    });
  }

  var aliases = {
    "Date of birth": "Birth month and year",
    "Weight unit": "Gym weight units",
    "Hypertrophy": "Build muscle",
    "Recomposition": "Build muscle and lose fat",
    "Metric (kg)": "Kilograms (kg)",
    "About 45 min": "About 45 minutes",
    "60-75 minutes": "60–75 minutes",
    "1h–1h 15 min": "60–75 minutes",
    "75-90 minutes": "75–90 minutes",
    "1h 15 min–1h 30 min": "75–90 minutes",
    "90-110 minutes": "90–110 minutes",
    "1h 30 min–1h 50 min": "90–110 minutes",
    "1 Mild: prefer supported versions, train normally": "1 Mild: A little uncomfortable, and I can still train",
    "2 Mild–Moderate: constrain load, range, placement; prefer machines": "2 Mild–Moderate: Some exercises bother me. Lighter weight or a machine feels better",
    "3 Moderate: skip borderline lifts, keep volume modest": "3 Moderate: It limits what I can do. Skip the painful exercises and do a bit less",
    "4 Severe: no plan until cleared": "4 Severe: I need a doctor or physio to clear me before I train this"
  };

  function canon(value) {
    value = compact(value);
    return aliases[value] || value;
  }

  function setSelect(select, value) {
    value = canon(value);
    for (var i = 0; i < select.options.length; i++) {
      if (compact(select.options[i].text) === value || select.options[i].value === value) {
        select.selectedIndex = i;
        return true;
      }
    }
    return false;
  }

  function labelText(el) {
    return compact(el.textContent).replace(/\s*\*$/, "");
  }

  function clearForm() {
    var fields = document.querySelectorAll("main.wrap input, main.wrap textarea, main.wrap select");
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (field.type === "radio" || field.type === "checkbox") field.checked = false;
      else if (field.tagName === "SELECT") field.selectedIndex = 0;
      else field.value = "";
    }
    var list = document.getElementById("lim-list");
    if (!list) return;
    var blocks = list.querySelectorAll(".lim");
    for (var b = blocks.length - 1; b > 0; b--) blocks[b].remove();
  }

  function setLabeled(label, value) {
    label = canon(label);
    var labels = document.querySelectorAll("label.field");
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].closest(".lim")) continue;
      if (labelText(labels[i]) !== label) continue;
      var id = labels[i].getAttribute("for");
      var input = id ? document.getElementById(id) : null;
      if (!input) continue;
      if (input.id === "birth-month") {
        var born = value.split(" ");
        var bornMonth = "";
        var bornYear = "";
        for (var b = 0; b < born.length; b++) {
          if (/^\d{4}$/.test(born[b])) bornYear = born[b];
          else bornMonth = born[b];
        }
        if (bornMonth) setSelect(input, bornMonth);
        var yearSelect = document.getElementById("birth-year");
        if (bornYear && yearSelect) setSelect(yearSelect, bornYear);
        return;
      }
      if (input.tagName === "SELECT") {
        setSelect(input, value);
        return;
      }
      var unit = document.getElementById(input.id + "-unit");
      if (unit) {
        var bits = value.split(" ");
        var unitText = bits.length > 1 ? bits.pop() : "";
        input.value = bits.join(" ");
        if (unitText) setSelect(unit, unitText);
      } else {
        input.value = value;
      }
      return;
    }
  }

  function setChoice(label, value) {
    label = canon(label);
    value = canon(value);
    var titles = document.querySelectorAll(".q");
    for (var i = 0; i < titles.length; i++) {
      if (labelText(titles[i]) !== label) continue;
      var card = titles[i].closest(".card");
      if (!card) return;
      var inputs = card.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      var wanted = [value];
      var exact = false;
      for (var j = 0; j < inputs.length; j++) {
        if (optionLabel(inputs[j]) === value) exact = true;
      }
      if (!exact) wanted = value.split(", ");
      for (var k = 0; k < inputs.length; k++) {
        var text = optionLabel(inputs[k]);
        for (var w = 0; w < wanted.length; w++) {
          if (text === wanted[w]) inputs[k].checked = true;
        }
      }
      return;
    }
  }

  function addLimitation(line) {
    var list = document.getElementById("lim-list");
    var add = document.getElementById("add-lim");
    if (!list) return;
    var blocks = list.querySelectorAll(".lim");
    var block = blocks[blocks.length - 1];
    var inputs = block.querySelectorAll("input, select");
    if (inputs[0].value && add) {
      add.click();
      blocks = list.querySelectorAll(".lim");
      block = blocks[blocks.length - 1];
      inputs = block.querySelectorAll("input, select");
    }
    var parts = line.split("; ");
    inputs[0].value = parts[0] === "(not specified)" ? "" : parts[0];
    if (parts.length >= 3) {
      setSelect(inputs[1], parts[1]);
      setSelect(inputs[2], parts.slice(2).join("; "));
    } else if (parts.length === 2) {
      if (!setSelect(inputs[1], parts[1])) setSelect(inputs[2], parts[1]);
    }
  }

  function fillAnswers(markdown) {
    clearForm();
    var lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var match = line.match(/^- \*\*(.+?):\*\*(?: (.*))?$/);
      if (match) {
        var label = canon(match[1]);
        var value = match[2];
        if (!value) {
          var buf = [];
          i += 1;
          if (lines[i] === "") i += 1;
          while (i < lines.length && lines[i] !== "" && lines[i].indexOf("- **") !== 0 && lines[i].indexOf("## ") !== 0) {
            buf.push(lines[i]);
            i += 1;
          }
          i -= 1;
          setLabeled(label, buf.join("\n"));
        } else {
          var labels = document.querySelectorAll("label.field");
          var labeled = false;
          for (var L = 0; L < labels.length; L++) {
            if (!labels[L].closest(".lim") && labelText(labels[L]) === label) labeled = true;
          }
          if (labeled) setLabeled(label, value);
          else setChoice(label, value);
        }
        continue;
      }
      if (line.indexOf("- ") === 0) addLimitation(line.slice(2));
    }
    var main = document.querySelector("main.wrap");
    if (main) main.dispatchEvent(new Event("change", { bubbles: true }));
  }

  window.memtofitFill = fillAnswers;

  var savedOk = document.getElementById("saved-ok");
  if (savedOk) {
    savedOk.addEventListener("click", function () {
      var dialog = document.getElementById("saved-dialog");
      if (dialog && dialog.open) dialog.close();
    });
  }

  var btn = document.getElementById("submit-btn");
  if (btn) btn.addEventListener("click", submitAnswers);
})();
