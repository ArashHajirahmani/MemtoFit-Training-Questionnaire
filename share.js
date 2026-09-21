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

  var btn = document.getElementById("share-btn");
  if (btn) btn.addEventListener("click", shareMarkdown);
})();
