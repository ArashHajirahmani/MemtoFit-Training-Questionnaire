(function (root) {
  function sectionBody(text, marker) {
    var lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    var buf = [];
    var on = false;
    var fence = "<!-- " + marker + " -->";
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] === fence) {
        on = true;
        buf = [];
        continue;
      }
      if (on && (lines[i].indexOf("## ") === 0 || lines[i].indexOf("<!-- ") === 0)) break;
      if (on) buf.push(lines[i]);
    }
    return buf.join("\n").trim();
  }

  function bullets(body) {
    var lines = String(body || "").split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(/^- \*\*([a-z0-9-]+):\*\*(?: (.*))?$/);
      if (!match) continue;
      var value = match[2];
      if (value == null || value === "") {
        var buf = [];
        i += 1;
        if (lines[i] === "") i += 1;
        while (i < lines.length && lines[i].indexOf("- **") !== 0) {
          buf.push(lines[i]);
          i += 1;
        }
        i -= 1;
        value = buf.join("\n").replace(/\n+$/, "");
      }
      out.push({ id: match[1], value: value || "" });
    }
    return out;
  }

  function questionsIn(text) {
    var items = bullets(sectionBody(text, "questions"));
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var prompt = String(items[i].value || "").replace(/\s+/g, " ").trim();
      if (!prompt) continue;
      out.push({ id: items[i].id, prompt: prompt });
    }
    return out;
  }

  function answersIn(text) {
    var items = bullets(sectionBody(text, "answers"));
    var out = {};
    for (var i = 0; i < items.length; i++) out[items[i].id] = items[i].value;
    return out;
  }

  function build(prompts) {
    var lines = ["# Follow-up", "", "## Questions", "<!-- questions -->", ""];
    var n = 0;
    for (var i = 0; i < prompts.length; i++) {
      var text = String(prompts[i] || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      n += 1;
      lines.push("- **q" + n + ":** " + text);
    }
    lines.push("");
    return lines.join("\n");
  }

  function answerLines(id, value) {
    value = String(value || "").trim();
    if (!value) return [];
    if (value.indexOf("\n") === -1) return ["- **" + id + ":** " + value];
    return ["- **" + id + ":**", "", value, ""];
  }

  function withAnswers(existing, updates) {
    var questions = questionsIn(existing);
    var answers = answersIn(existing);
    var ids = Object.keys(updates || {});
    for (var u = 0; u < ids.length; u++) answers[ids[u]] = updates[ids[u]];
    var lines = ["# Follow-up", "", "## Questions", "<!-- questions -->", ""];
    for (var q = 0; q < questions.length; q++) {
      lines.push("- **" + questions[q].id + ":** " + questions[q].prompt);
    }
    lines.push("", "## Answers", "<!-- answers -->", "");
    for (var a = 0; a < questions.length; a++) {
      var written = answerLines(questions[a].id, answers[questions[a].id]);
      for (var w = 0; w < written.length; w++) lines.push(written[w]);
    }
    return lines.join("\n").replace(/\n+$/, "") + "\n";
  }

  root.MEMTOFIT_FOLLOWUPS = {
    questionsIn: questionsIn,
    answersIn: answersIn,
    build: build,
    withAnswers: withAnswers
  };
})(typeof window !== "undefined" ? window : this);
