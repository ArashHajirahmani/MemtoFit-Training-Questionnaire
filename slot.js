(function () {
  function rpc(name, args) {
    var base = String(window.MEMTOFIT.url || "").replace(/\/$/, "");
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 45000);
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
    },
    savePlan: function (session, plan) {
      return rpc("save_plan", {
        p_id: session.id,
        p_token: session.token,
        p_plan: plan
      });
    },
    saveFollowup: function (session, followup) {
      return rpc("save_followup", {
        p_id: session.id,
        p_token: session.token,
        p_followup: followup
      });
    },
    resetPlanProgress: function (session) {
      return rpc("reset_plan_progress", {
        p_id: session.id,
        p_token: session.token
      });
    },
    photoUploadUrl: function (session, tag) {
      return rpc("photo_upload_url", {
        p_id: session.id,
        p_token: session.token,
        p_tag: tag
      });
    },
    photoDownloadUrl: function (session, tag) {
      return rpc("photo_download_url", {
        p_id: session.id,
        p_token: session.token,
        p_tag: tag
      });
    },
    photoPut: function (session, tag, cipher) {
      return rpc("photo_put", {
        p_id: session.id,
        p_token: session.token,
        p_tag: tag,
        p_cipher: cipher
      });
    },
    photoGet: function (session, tag) {
      return rpc("photo_get", {
        p_id: session.id,
        p_token: session.token,
        p_tag: tag
      });
    },
    photoCommit: function (session, tag, path) {
      return rpc("photo_commit", {
        p_id: session.id,
        p_token: session.token,
        p_tag: tag,
        p_path: path
      });
    },
    photoDelete: function (session, tag) {
      return rpc("photo_delete", {
        p_id: session.id,
        p_token: session.token,
        p_tag: tag
      });
    },
    lockPhotos: function (session) {
      return rpc("lock_slot_photos", {
        p_id: session.id,
        p_token: session.token
      });
    }
  };
})();
