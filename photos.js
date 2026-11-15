/* Part 7 progress photos: tiles + GIMP-style crop/blur editor. */
(function () {
  var TAGS = [
    { id: "front", label: "Front View", help: "Arms slightly out, facing the camera", icon: "front" },
    { id: "back", label: "Back View", help: "Back to camera; hair up if that helps", icon: "back" },
    { id: "left", label: "Left Side View", help: "Standing sideways, facing right", icon: "left" },
    { id: "right", label: "Right Side View", help: "Standing sideways, facing left", icon: "right" }
  ];

  var MAX_EDGE = 1280;
  var JPEG_QUALITY = 0.92;
  var HANDLE = 18;

  function get2d(canvas, extras) {
    var opts = { alpha: false, colorSpace: "srgb" };
    if (extras) {
      for (var k in extras) {
        if (Object.prototype.hasOwnProperty.call(extras, k)) opts[k] = extras[k];
      }
    }
    try {
      return canvas.getContext("2d", opts) || canvas.getContext("2d");
    } catch (err) {
      return canvas.getContext("2d");
    }
  }
  var state = {
    locked: false,
    items: {},
    previews: {},
    busy: false,
    edit: null
  };

  function password() {
    var gate = window.memtofitGate;
    return gate && typeof gate.name === "function" ? gate.name() : "";
  }

  function session() {
    return window.memtofitSession || null;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function normalizePhotos(raw) {
    var photos = raw && typeof raw === "object" ? raw : {};
    var items = photos.items && typeof photos.items === "object" ? photos.items : {};
    return {
      locked: !!photos.locked,
      locked_at: photos.locked_at || null,
      items: items
    };
  }

  function revokePreview(tag) {
    if (state.previews[tag]) {
      try { URL.revokeObjectURL(state.previews[tag]); } catch (err) {}
      delete state.previews[tag];
    }
  }

  function silhouetteSvg(kind) {
    var file = kind === "back" || kind === "left" || kind === "right" ? kind : "front";
    return '<img src="silhouettes/' + file + '.svg" alt="" width="80" height="103">';
  }

  function tileEl(tag) {
    return document.querySelector('.photo-tile[data-tag="' + tag + '"]');
  }

  function setStatus(text, bad) {
    var el = $("photo-status");
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("bad");
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle("bad", !!bad);
  }

  function renderTile(tag) {
    var meta = TAGS.filter(function (t) { return t.id === tag; })[0];
    var tile = tileEl(tag);
    if (!tile || !meta) return;
    var item = state.items[tag];
    var filled = !!(item && (item.path || item.id));
    tile.classList.toggle("filled", filled);
    tile.classList.toggle("locked", state.locked);

    var media = tile.querySelector(".photo-media");
    var actions = tile.querySelector(".photo-actions");
    if (!media || !actions) return;

    if (filled && state.previews[tag]) {
      media.innerHTML = '<img alt="' + meta.label + '" src="' + state.previews[tag] + '">';
    } else {
      media.innerHTML = '<span class="photo-sil">' + silhouetteSvg(meta.icon) + "</span>";
    }

    var bits = [];
    if (filled) {
      bits.push('<button type="button" class="photo-act preview" data-act="preview" aria-label="Preview ' + meta.label + '">👁</button>');
      if (state.locked) {
        bits.push('<button type="button" class="photo-act update" data-act="update" aria-label="Update ' + meta.label + '">✎</button>');
      } else {
        bits.push('<button type="button" class="photo-act delete" data-act="delete" aria-label="Delete ' + meta.label + '">🗑</button>');
      }
    }
    actions.innerHTML = bits.join("");
  }

  function renderAll() {
    for (var i = 0; i < TAGS.length; i++) renderTile(TAGS[i].id);
    var root = $("photo-grid");
    if (root) root.dataset.locked = state.locked ? "1" : "0";
  }

  function loadPreview(tag) {
    var sess = session();
    var pass = password();
    if (!sess || !pass || !state.items[tag]) return Promise.resolve();
    return window.memtofitSlot.photoGet(sess, tag).then(function (cipher) {
      return window.memtofitCrypto.decryptBlob(pass, cipher, "image/jpeg");
    }).then(function (blob) {
      revokePreview(tag);
      state.previews[tag] = URL.createObjectURL(blob);
      renderTile(tag);
    }, function () {
      renderTile(tag);
    });
  }

  function loadAllPreviews() {
    var jobs = [];
    for (var i = 0; i < TAGS.length; i++) {
      var tag = TAGS[i].id;
      if (state.items[tag]) jobs.push(loadPreview(tag));
      else {
        revokePreview(tag);
        renderTile(tag);
      }
    }
    return Promise.all(jobs);
  }

  function presenceLines() {
    var lines = [];
    for (var i = 0; i < TAGS.length; i++) {
      var t = TAGS[i];
      if (state.items[t.id]) lines.push("- **" + t.label + ":** uploaded");
    }
    return lines;
  }

  window.memtofitPhotoLines = presenceLines;

  function readImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || "")) {
        reject(new Error("Choose a photo."));
        return;
      }
      /* Avoid browser color-profile conversion that shifts phone-photo colors. */
      function fromBitmap(bitmap) {
        bitmap.naturalWidth = bitmap.width;
        bitmap.naturalHeight = bitmap.height;
        resolve(bitmap);
      }
      function fromElement() {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error("Could not open that photo."));
        };
        img.src = url;
      }
      if (typeof createImageBitmap !== "function") {
        fromElement();
        return;
      }
      createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" }).then(fromBitmap, function () {
        return createImageBitmap(file).then(fromBitmap, fromElement);
      });
    });
  }

  function fitContain(imgW, imgH, boxW, boxH) {
    var scale = Math.min(boxW / imgW, boxH / imgH);
    var w = Math.round(imgW * scale);
    var h = Math.round(imgH * scale);
    return { w: w, h: h, x: Math.round((boxW - w) / 2), y: Math.round((boxH - h) / 2), scale: scale };
  }

  function setEditorMode(hasImage) {
    var empty = $("photo-edit-empty");
    var stage = $("photo-edit-stage");
    var tools = $("photo-edit-tools");
    var save = $("photo-edit-save");
    if (empty) empty.hidden = !!hasImage;
    if (stage) stage.hidden = !hasImage;
    if (tools) tools.hidden = !hasImage;
    if (save) {
      save.disabled = !hasImage;
      save.setAttribute("aria-disabled", hasImage ? "false" : "true");
    }
  }

  function openEditor(tag, existingImg) {
    var dialog = $("photo-edit-dialog");
    var canvas = $("photo-edit-canvas");
    var title = $("photo-edit-title");
    if (!dialog || !canvas) return;

    var meta = TAGS.filter(function (t) { return t.id === tag; })[0];
    if (title) title.textContent = meta ? meta.label : "Edit photo";

    var sessionEdit = {
      tag: tag,
      img: null,
      crop: null,
      blur: null,
      tool: "crop",
      blurApplied: false,
      drag: null,
      pinch: null,
      cw: 0,
      ch: 0,
      layout: null
    };
    state.edit = sessionEdit;

    function helpText() {
      var help = $("photo-edit-help");
      if (!help) return;
      if (!sessionEdit.img) {
        help.textContent = "Choose a photo, then crop the frame. Use Blur only if you want to hide your face.";
        return;
      }
      help.textContent = sessionEdit.tool === "blur"
        ? "Drag the circle onto your face. Drag the edge to change size. Only this circle is blurred."
        : "Drag inside the frame to move it. Drag a corner to resize. Colors stay as in the original.";
    }

    function syncToolButtons() {
      var cropBtn = $("photo-tool-crop");
      var blurBtn = $("photo-tool-blur");
      if (cropBtn) cropBtn.classList.toggle("on", sessionEdit.tool === "crop");
      if (blurBtn) blurBtn.classList.toggle("on", sessionEdit.tool === "blur");
      helpText();
    }

    function paintBlurPreview(ctx, crop, blur) {
      var x0 = Math.max(0, Math.floor(blur.x - blur.r));
      var y0 = Math.max(0, Math.floor(blur.y - blur.r));
      var x1 = Math.min(sessionEdit.cw, Math.ceil(blur.x + blur.r));
      var y1 = Math.min(sessionEdit.ch, Math.ceil(blur.y + blur.r));
      var tw = x1 - x0;
      var th = y1 - y0;
      if (tw < 2 || th < 2) return;
      var sample = document.createElement("canvas");
      var sw = Math.max(2, Math.round(tw / 14));
      var sh = Math.max(2, Math.round(th / 14));
      sample.width = sw;
      sample.height = sh;
      var sctx = get2d(sample);
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(ctx.canvas, x0, y0, tw, th, 0, 0, sw, sh);
      ctx.save();
      ctx.beginPath();
      ctx.arc(blur.x, blur.y, blur.r, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sample, 0, 0, sw, sh, x0, y0, tw, th);
      ctx.restore();
    }

    function paint() {
      if (!sessionEdit.img) return;
      var img = sessionEdit.img;
      var crop = sessionEdit.crop;
      var blur = sessionEdit.blur;
      var cw = sessionEdit.cw;
      var ch = sessionEdit.ch;
      var layout = sessionEdit.layout;
      var ctx = get2d(canvas);
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, layout.x, layout.y, layout.w, layout.h);

      /* Neutral dim outside crop — never tints pixels inside the frame. */
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cw, ch);
      ctx.rect(crop.x, crop.y, crop.w, crop.h);
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fill("evenodd");
      ctx.restore();

      if (sessionEdit.tool === "blur" && sessionEdit.blurApplied) {
        paintBlurPreview(ctx, crop, blur);
      }

      /* Crop frame + corner handles (GIMP-like). */
      ctx.save();
      ctx.strokeStyle = "#FAAF58";
      ctx.lineWidth = 2;
      ctx.strokeRect(crop.x + 0.5, crop.y + 0.5, crop.w - 1, crop.h - 1);
      var corners = [
        [crop.x, crop.y],
        [crop.x + crop.w, crop.y],
        [crop.x, crop.y + crop.h],
        [crop.x + crop.w, crop.y + crop.h]
      ];
      for (var i = 0; i < corners.length; i++) {
        var hx = corners[i][0];
        var hy = corners[i][1];
        ctx.fillStyle = "#FAAF58";
        ctx.fillRect(hx - 5, hy - 5, 10, 10);
        ctx.strokeStyle = "#181F17";
        ctx.lineWidth = 1;
        ctx.strokeRect(hx - 5.5, hy - 5.5, 11, 11);
      }
      ctx.restore();

      /* Blur brush outline */
      ctx.save();
      ctx.beginPath();
      ctx.arc(blur.x, blur.y, blur.r, 0, Math.PI * 2);
      ctx.strokeStyle = sessionEdit.tool === "blur" ? "#F2F2F2" : "rgba(242,242,242,0.55)";
      ctx.lineWidth = sessionEdit.tool === "blur" ? 2 : 1.5;
      ctx.setLineDash(sessionEdit.tool === "blur" ? [] : [5, 4]);
      ctx.stroke();
      if (sessionEdit.tool === "blur") {
        ctx.beginPath();
        ctx.arc(blur.x, blur.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#FAAF58";
        ctx.fill();
      }
      ctx.restore();
    }

    function clampCrop() {
      var crop = sessionEdit.crop;
      var layout = sessionEdit.layout;
      crop.w = Math.max(48, Math.min(crop.w, layout.w));
      crop.h = Math.max(48, Math.min(crop.h, layout.h));
      crop.x = Math.max(layout.x, Math.min(crop.x, layout.x + layout.w - crop.w));
      crop.y = Math.max(layout.y, Math.min(crop.y, layout.y + layout.h - crop.h));
    }

    function clampBlur() {
      var blur = sessionEdit.blur;
      var crop = sessionEdit.crop;
      var minR = 16;
      var maxR = Math.min(crop.w, crop.h) * 0.45;
      blur.r = Math.max(minR, Math.min(maxR, blur.r));
      blur.x = Math.max(crop.x + blur.r, Math.min(crop.x + crop.w - blur.r, blur.x));
      blur.y = Math.max(crop.y + blur.r, Math.min(crop.y + crop.h - blur.r, blur.y));
    }

    function hitCorner(p, crop) {
      var pts = [
        { id: "nw", x: crop.x, y: crop.y },
        { id: "ne", x: crop.x + crop.w, y: crop.y },
        { id: "sw", x: crop.x, y: crop.y + crop.h },
        { id: "se", x: crop.x + crop.w, y: crop.y + crop.h }
      ];
      for (var i = 0; i < pts.length; i++) {
        if (Math.abs(p.x - pts[i].x) <= HANDLE && Math.abs(p.y - pts[i].y) <= HANDLE) return pts[i].id;
      }
      return "";
    }

    function pointerPos(e) {
      var rect = canvas.getBoundingClientRect();
      var src = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
      return {
        x: ((src.clientX - rect.left) / rect.width) * canvas.width,
        y: ((src.clientY - rect.top) / rect.height) * canvas.height
      };
    }

    function touchDistance(e) {
      if (!e.touches || e.touches.length < 2) return 0;
      var a = e.touches[0];
      var b = e.touches[1];
      var dx = a.clientX - b.clientX;
      var dy = a.clientY - b.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onDown(e) {
      if (!sessionEdit.img) return;
      if (e.touches && e.touches.length === 2 && sessionEdit.tool === "blur") {
        sessionEdit.pinch = { start: touchDistance(e), r: sessionEdit.blur.r };
        sessionEdit.drag = null;
        return;
      }
      if (e.cancelable) e.preventDefault();
      var p = pointerPos(e);
      var crop = sessionEdit.crop;
      var blur = sessionEdit.blur;

      if (sessionEdit.tool === "blur") {
        var dist = Math.sqrt(Math.pow(p.x - blur.x, 2) + Math.pow(p.y - blur.y, 2));
        if (Math.abs(dist - blur.r) <= HANDLE) {
          sessionEdit.drag = { kind: "blur-resize", startR: blur.r, startDist: Math.max(1, dist) };
        } else {
          sessionEdit.drag = { kind: "blur-move", ox: p.x - blur.x, oy: p.y - blur.y };
        }
      } else {
        var corner = hitCorner(p, crop);
        if (corner) {
          sessionEdit.drag = {
            kind: "crop-resize",
            corner: corner,
            start: { x: crop.x, y: crop.y, w: crop.w, h: crop.h }
          };
        } else if (p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h) {
          sessionEdit.drag = { kind: "crop-move", ox: p.x - crop.x, oy: p.y - crop.y };
        }
      }
      if (e.pointerId != null && canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
    }

    function onMove(e) {
      if (!sessionEdit.img) return;
      if (sessionEdit.pinch && e.touches && e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        var dist = touchDistance(e);
        sessionEdit.blur.r = sessionEdit.pinch.r * (dist / Math.max(1, sessionEdit.pinch.start));
        clampBlur();
        paint();
        return;
      }
      if (!sessionEdit.drag) return;
      if (e.cancelable) e.preventDefault();
      var p = pointerPos(e);
      var crop = sessionEdit.crop;
      var drag = sessionEdit.drag;
      var layout = sessionEdit.layout;

      if (drag.kind === "blur-move") {
        sessionEdit.blur.x = p.x - drag.ox;
        sessionEdit.blur.y = p.y - drag.oy;
        clampBlur();
      } else if (drag.kind === "blur-resize") {
        var dist = Math.sqrt(Math.pow(p.x - sessionEdit.blur.x, 2) + Math.pow(p.y - sessionEdit.blur.y, 2));
        sessionEdit.blur.r = drag.startR * (dist / drag.startDist);
        clampBlur();
      } else if (drag.kind === "crop-move") {
        crop.x = p.x - drag.ox;
        crop.y = p.y - drag.oy;
        clampCrop();
        clampBlur();
      } else if (drag.kind === "crop-resize") {
        var s = drag.start;
        var min = 48;
        if (drag.corner.indexOf("e") !== -1) {
          crop.w = Math.max(min, Math.min(layout.x + layout.w - s.x, p.x - s.x));
          crop.x = s.x;
        }
        if (drag.corner.indexOf("s") !== -1) {
          crop.h = Math.max(min, Math.min(layout.y + layout.h - s.y, p.y - s.y));
          crop.y = s.y;
        }
        if (drag.corner.indexOf("w") !== -1) {
          var right = s.x + s.w;
          crop.x = Math.max(layout.x, Math.min(right - min, p.x));
          crop.w = right - crop.x;
        }
        if (drag.corner.indexOf("n") !== -1) {
          var bottom = s.y + s.h;
          crop.y = Math.max(layout.y, Math.min(bottom - min, p.y));
          crop.h = bottom - crop.y;
        }
        clampCrop();
        clampBlur();
      }
      paint();
    }

    function onUp() {
      sessionEdit.drag = null;
      sessionEdit.pinch = null;
    }

    function bindCanvas() {
      canvas.style.touchAction = "none";
      canvas.onpointerdown = onDown;
      canvas.onpointermove = onMove;
      canvas.onpointerup = onUp;
      canvas.onpointercancel = onUp;
      canvas.ontouchstart = onDown;
      canvas.ontouchmove = onMove;
      canvas.ontouchend = onUp;
    }

    function loadImage(img) {
      var maxW = Math.min(window.innerWidth - 40, 440);
      var maxH = Math.min(window.innerHeight * 0.5, 520);
      var layout = fitContain(img.naturalWidth, img.naturalHeight, maxW, maxH);
      var cw = Math.max(layout.w, Math.min(maxW, layout.w + 24));
      var ch = Math.max(layout.h, Math.min(maxH, layout.h + 24));
      layout = fitContain(img.naturalWidth, img.naturalHeight, cw, ch);
      canvas.width = cw;
      canvas.height = ch;
      sessionEdit.img = img;
      sessionEdit.cw = cw;
      sessionEdit.ch = ch;
      sessionEdit.layout = layout;
      sessionEdit.crop = {
        x: layout.x + Math.round(layout.w * 0.06),
        y: layout.y + Math.round(layout.h * 0.04),
        w: Math.round(layout.w * 0.88),
        h: Math.round(layout.h * 0.92)
      };
      sessionEdit.blur = {
        x: sessionEdit.crop.x + sessionEdit.crop.w * 0.5,
        y: sessionEdit.crop.y + sessionEdit.crop.h * 0.18,
        r: Math.max(28, Math.min(sessionEdit.crop.w, sessionEdit.crop.h) * 0.14)
      };
      sessionEdit.tool = "crop";
      clampCrop();
      clampBlur();
      setEditorMode(true);
      syncToolButtons();
      paint();
    }

    $("photo-tool-crop").onclick = function () {
      sessionEdit.tool = "crop";
      syncToolButtons();
      paint();
    };
    $("photo-tool-blur").onclick = function () {
      sessionEdit.tool = "blur";
      sessionEdit.blurApplied = true;
      syncToolButtons();
      paint();
    };
    $("photo-edit-choose").onclick = function () {
      pickFileIntoEditor(tag, loadImage);
    };
    $("photo-edit-discard").onclick = function () {
      state.edit = null;
      if (dialog.open) dialog.close();
    };
    $("photo-edit-save").onclick = function () {
      if (state.busy || !sessionEdit.img) return;
      exportAndUpload(
        tag,
        sessionEdit.img,
        sessionEdit.crop,
        sessionEdit.blurApplied ? sessionEdit.blur : null,
        sessionEdit.layout
      ).then(function () {
        state.edit = null;
        if (dialog.open) dialog.close();
      });
    };

    bindCanvas();
    setEditorMode(!!existingImg);
    helpText();
    syncToolButtons();
    if (existingImg) loadImage(existingImg);
    if (!dialog.open) dialog.showModal();
  }

  function pickFileIntoEditor(tag, onImage) {
    var input = $("photo-file-input");
    if (!input) return;
    input.value = "";
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      readImageFile(file).then(function (img) {
        onImage(img);
      }, function (err) {
        setStatus(err.message || "Could not open that photo.", true);
      });
    };
    input.click();
  }

  function exportAndUpload(tag, img, crop, blur, layout) {
    var sess = session();
    var pass = password();
    if (!sess || !pass) {
      setStatus("Could not save photo. Unlock the link again.", true);
      return Promise.reject(new Error("no session"));
    }
    state.busy = true;
    setStatus("Saving photo…");

    var sx = (crop.x - layout.x) / layout.scale;
    var sy = (crop.y - layout.y) / layout.scale;
    var sw = crop.w / layout.scale;
    var sh = crop.h / layout.scale;
    var scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
    var outW = Math.max(1, Math.round(sw * scale));
    var outH = Math.max(1, Math.round(sh * scale));
    var out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    var ctx = get2d(out);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    /* Crop only from the source bitmap — no overlays or color filters. */
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

    if (blur) {
      var bx = ((blur.x - crop.x) / crop.w) * outW;
      var by = ((blur.y - crop.y) / crop.h) * outH;
      var br = (blur.r / crop.w) * outW;
      applyCircleBlur(ctx, outW, outH, bx, by, br);
    }

    return canvasToBlob(out).then(function (blob) {
      return window.memtofitCrypto.encryptBlob(pass, blob).then(function (cipher) {
        return window.memtofitSlot.photoUploadUrl(sess, tag).then(function () {
          return window.memtofitSlot.photoPut(sess, tag, cipher);
        }).then(function (item) {
          return window.memtofitSlot.photoCommit(sess, tag, item.path || ("db:" + item.id)).then(function () {
            return item;
          }, function () { return item; });
        }).then(function (item) {
          state.items[tag] = item;
          if (sess.row) {
            sess.row.photos = normalizePhotos({
              locked: state.locked,
              locked_at: state.locked ? (sess.row.photos && sess.row.photos.locked_at) : null,
              items: state.items
            });
          }
          revokePreview(tag);
          state.previews[tag] = URL.createObjectURL(blob);
          renderTile(tag);
          setStatus("Photo saved.");
          state.busy = false;
        });
      });
    }).catch(function () {
      state.busy = false;
      setStatus("Could not save that photo. Try again.", true);
      throw new Error("save failed");
    });
  }

  function applyCircleBlur(ctx, w, h, cx, cy, radius) {
    var r = Math.max(8, radius);
    var x0 = Math.max(0, Math.floor(cx - r));
    var y0 = Math.max(0, Math.floor(cy - r));
    var x1 = Math.min(w, Math.ceil(cx + r));
    var y1 = Math.min(h, Math.ceil(cy + r));
    var tw = x1 - x0;
    var th = y1 - y0;
    if (tw < 2 || th < 2) return;

    /* Soften only inside the circle; leave every other pixel untouched. */
    var sample = document.createElement("canvas");
    var sw = Math.max(2, Math.round(tw / 10));
    var sh = Math.max(2, Math.round(th / 10));
    sample.width = sw;
    sample.height = sh;
    var sctx = get2d(sample);
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(ctx.canvas, x0, y0, tw, th, 0, 0, sw, sh);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sample, 0, 0, sw, sh, x0, y0, tw, th);
    ctx.restore();
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      if (!canvas.toBlob) {
        try {
          var data = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          var bin = atob(data.split(",")[1]);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: "image/jpeg" }));
        } catch (err) {
          reject(err);
        }
        return;
      }
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error("encode failed"));
        else resolve(blob);
      }, "image/jpeg", JPEG_QUALITY);
    });
  }

  function deleteTag(tag) {
    if (state.locked || state.busy) return;
    var sess = session();
    if (!sess) return;
    state.busy = true;
    setStatus("Removing photo…");
    window.memtofitSlot.photoDelete(sess, tag).then(function () {
      delete state.items[tag];
      revokePreview(tag);
      if (sess.row && sess.row.photos && sess.row.photos.items) {
        delete sess.row.photos.items[tag];
      }
      renderTile(tag);
      setStatus("Photo removed.");
      state.busy = false;
    }, function () {
      state.busy = false;
      setStatus("Could not remove that photo.", true);
    });
  }

  function previewTag(tag) {
    var url = state.previews[tag];
    var dialog = $("photo-preview-dialog");
    var img = $("photo-preview-img");
    if (!url || !dialog || !img) return;
    img.src = url;
    if (!dialog.open) dialog.showModal();
  }

  function onGridClick(e) {
    var actBtn = e.target.closest("[data-act]");
    var tile = e.target.closest(".photo-tile");
    if (!tile) return;
    var tag = tile.getAttribute("data-tag");
    if (!tag) return;

    if (actBtn) {
      e.preventDefault();
      e.stopPropagation();
      var act = actBtn.getAttribute("data-act");
      if (act === "delete") deleteTag(tag);
      else if (act === "update") openEditor(tag, null);
      else if (act === "preview") previewTag(tag);
      return;
    }

    if (state.items[tag] && !state.locked) {
      previewTag(tag);
      return;
    }
    openEditor(tag, null);
  }

  function applyPhotos(raw) {
    var photos = normalizePhotos(raw);
    state.locked = photos.locked;
    state.items = photos.items || {};
    renderAll();
    return loadAllPreviews();
  }

  window.memtofitPhotos = {
    apply: applyPhotos,
    presenceLines: presenceLines,
    isLocked: function () { return state.locked; }
  };

  function boot() {
    var grid = $("photo-grid");
    if (!grid) return;
    grid.addEventListener("click", onGridClick);
    grid.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var tile = e.target.closest(".photo-tile");
      if (!tile || e.target.closest("[data-act]")) return;
      e.preventDefault();
      tile.click();
    });
    var previewClose = $("photo-preview-close");
    if (previewClose) {
      previewClose.addEventListener("click", function () {
        var dialog = $("photo-preview-dialog");
        if (dialog && dialog.open) dialog.close();
      });
    }
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
