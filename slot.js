(function () {
  function rpc(name, args) {
    var base = String(window.MEMTOFIT.url || "").replace(/\/$/, "");
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 15000);
    return fetch(base + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        apikey: window.MEMTOFIT.key,
        Authorization: "Bearer " + window.MEMTOFIT.key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(args),
      signal: ctrl.signal
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (text) {
          var err = new Error("request failed");
          err.status = res.status;
          err.denied = text.indexOf("not allowed") !== -1;
          throw err;
        });
      }
      if (res.status === 204) return null;
      return res.text().then(function (text) {
        if (!text) return null;
        return JSON.parse(text);
      });
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  window.memtofitSlot = {
    load: function (session) {
      return rpc("load_slot", { p_id: session.id, p_token: session.token });
    },
    saveAnswers: function (session, name, answers) {
      return rpc("save_answers", {
        p_id: session.id,
        p_token: session.token,
        p_name: name,
        p_answers: answers
      });
    },
    saveLog: function (session, log) {
      return rpc("save_log", {
        p_id: session.id,
        p_token: session.token,
        p_log: log
      });
    }
  };
})();
