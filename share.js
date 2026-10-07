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

  function fileSlug() {
    var name = compact(document.getElementById("name") && document.getElementById("name").value);
    name = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return name || "profile";
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

  function downloadMarkdown(filename, text) {
    var blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function shareMarkdown() {
    if (window.memtofitReady && !window.memtofitReady()) return;
    var text = buildMarkdown();
    var status = document.getElementById("save-status");
    var filename = "MemtoFit-" + fileSlug() + ".md";
    var title = "MemtoFit questionnaire";
    var file = null;
    try {
      file = new File([text], filename, { type: "text/plain" });
    } catch (err) {}

    function download() {
      downloadMarkdown(filename, text);
    }

    function mailTo() {
      var href = "mailto:?subject=" + encodeURIComponent(title) +
        "&body=" + encodeURIComponent(text);
      if (href.length > 8000) {
        download();
        return;
      }
      window.location.href = href;
    }

    function shareText() {
      if (!navigator.share) {
        mailTo();
        return;
      }
      navigator.share({ title: title, text: text }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        mailTo();
      });
    }

    function mark(ok) {
      if (!status) return;
      status.hidden = false;
      status.classList.toggle("bad", !ok);
      status.textContent = ok ? "Saved." : "Could not save. Try Share again.";
    }

    function continueShare() {
      if (file && navigator.canShare) {
        var withFile = { title: title, files: [file] };
        if (navigator.canShare(withFile)) {
          navigator.share(withFile).catch(function (err) {
            if (err && err.name === "AbortError") return;
            shareText();
          });
          return;
        }
      }
      shareText();
    }

    var session = window.memtofitSession;
    if (!session || !window.memtofitSlot || !window.memtofitGate) {
      mark(false);
      continueShare();
      return;
    }
    window.memtofitSlot.saveAnswers(session, window.memtofitGate.name(), text).then(function () {
      mark(true);
      continueShare();
    }, function () {
      mark(false);
      continueShare();
    });
  }

  function setSelect(select, value) {
    value = compact(value);
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
    var labels = document.querySelectorAll("label.field");
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].closest(".lim")) continue;
      if (labelText(labels[i]) !== label) continue;
      var id = labels[i].getAttribute("for");
      var input = id ? document.getElementById(id) : null;
      if (!input) continue;
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
    if (parts.length === 3) {
      setSelect(inputs[1], parts[1]);
      setSelect(inputs[2], parts[2]);
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
        var label = match[1];
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

  var btn = document.getElementById("share-btn");
  if (btn) btn.addEventListener("click", shareMarkdown);
})();
