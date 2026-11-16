/* ZoomPro — panel. Talks to host/zoompro.jsx through CEP evalScript. */
(function () {
  var TPS = 254016000000;
  var $ = function (id) { return document.getElementById(id); };
  var STORE = "zoompro.state.v1", PSTORE = "zoompro.presets.v1";

  var DEFAULT = {
    mode: "continuo", zoom: 115, base: 100, dur: 0.6, dir: "in", at: "start",
    cont: false, drift: 5, perClip: false, mblur: false, cx: 0.5, cy: 0.5,
    curveC: { id: "linear", b: [0, 0, 1, 1] },
    curveA: { id: "forte", b: [0.83, 0, 0.17, 1] },
    aspect: 16 / 9
  };
  var S = load(STORE, DEFAULT);
  for (var k in DEFAULT) if (!(k in S)) S[k] = DEFAULT[k];

  function load(key, def) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v || JSON.parse(JSON.stringify(def)); }
    catch (e) { return JSON.parse(JSON.stringify(def)); }
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }

  // ---------- bridge to Premiere ----------
  function extPath() {
    try {
      var p = decodeURI(window.__adobe_cep__.getSystemPath("extension")).replace(/^file:\/\//, "");
      return /^\/[A-Za-z]:/.test(p) ? p.slice(1) : p; // Windows "/C:/..." -> "C:/..."; Mac keeps "/Users/..."
    }
    catch (e) { return ""; }
  }
  function host(op, args) {
    return new Promise(function (res, rej) {
      var line = "ZoomPro.run('" + op + "','" + encodeURIComponent(JSON.stringify(args || {})).replace(/'/g, "%27") + "')";
      if (!window.__adobe_cep__) return rej(new Error("Open this panel inside Premiere Pro."));
      window.__adobe_cep__.evalScript(line, function (txt) {
        var r;
        try { r = JSON.parse(txt); } catch (e) { return rej(new Error("ExtendScript: " + txt)); }
        r.ok ? res(r.result) : rej(new Error(r.error));
      });
    });
  }
  function status(t, cls) { var s = $("status"); s.textContent = t || ""; s.className = cls || ""; }

  // ---------- controls ----------
  function paint(r) {
    var p = (r.value - r.min) / (r.max - r.min) * 100;
    r.style.setProperty("--p", Math.max(0, Math.min(100, p)) + "%");
  }
  function seg(id, key, after) {
    $(id).querySelectorAll("button").forEach(function (b) {
      b.onclick = function () { S[key] = b.dataset.v; save(); refresh(); if (after) after(); };
    });
  }
  var pairs = [];
  function pair(rangeId, numId, key, decimals) {
    var r = $(rangeId), n = $(numId);
    function set(v, from) {
      v = parseFloat(v); if (isNaN(v)) return;
      S[key] = v; save();
      if (from !== r) r.value = v;
      if (from !== n) n.value = decimals ? v.toFixed(decimals) : v;
      paint(r);
      if (key === "zoom") drawCenter();
    }
    r.oninput = function () { set(r.value, r); };
    n.onchange = function () { set(n.value, n); };
    pairs.push(function () { set(S[key]); });
  }
  function check(id, key) { var c = $(id); c.onchange = function () { S[key] = c.checked; save(); refresh(); }; }

  seg("mode", "mode", function () { drawCurve(); playCurve(); });
  seg("dir", "dir");
  seg("at", "at");
  pair("zoomR", "zoom", "zoom");
  pair("baseR", "base", "base");
  pair("durR", "dur", "dur", 2);
  pair("driftR", "drift", "drift");
  check("cont", "cont");
  check("perClip", "perClip");
  check("mblur", "mblur");

  function syncInputs() {
    pairs.forEach(function (f) { f(); });
    $("cont").checked = !!S.cont; $("perClip").checked = !!S.perClip; $("mblur").checked = !!S.mblur;
  }

  function refresh() {
    ["mode", "dir", "at"].forEach(function (id) {
      $(id).querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === S[id]); });
    });
    document.querySelectorAll("[class*='only-']").forEach(function (el) {
      var vis = el.classList.contains("only-" + S.mode);
      if (vis && S.mode === "animado" && S.dir === "inout" && el.classList.contains("hide-inout")) vis = false;
      el.classList.toggle("hidden", !vis);
    });
    document.querySelectorAll(".hide-inout").forEach(function (el) {
      if (el.className.indexOf("only-") >= 0) return;
      el.classList.toggle("hidden", S.dir === "inout");
    });
    $("frame").style.aspectRatio = String(S.aspect || 16 / 9);
    document.body.className = "mode-" + S.mode;
    curveSel.value = curveObj().id;
    drawCenter();
  }

  // ---------- curve ----------
  function curveObj() { return S.mode === "continuo" ? S.curveC : S.curveA; }
  var curveSel = $("curveSel");
  ZPCurves.PRESETS.concat([{ id: "custom", name: "Custom" }]).forEach(function (p) {
    var o = document.createElement("option"); o.value = p.id; o.textContent = p.name; curveSel.appendChild(o);
  });
  curveSel.onchange = function () {
    var cur = curveObj(), p = ZPCurves.PRESETS.filter(function (q) { return q.id === curveSel.value; })[0];
    cur.id = curveSel.value;
    if (p) cur.b = p.b.slice();
    save(); drawCurve(); playCurve();
  };

  var cv = $("curve"), ctx = cv.getContext("2d");
  var YMIN = -0.42, YMAX = 1.42, PAD = 12;
  var anim = -1; // preview dot progress (0..1), -1 = stopped
  function geom() {
    var w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return {
      w: w, h: h,
      X: function (x) { return PAD + x * (w - 2 * PAD); },
      Y: function (y) { return h - PAD - (y - YMIN) / (YMAX - YMIN) * (h - 2 * PAD); },
      ix: function (px) { return (px - PAD) / (w - 2 * PAD); },
      iy: function (py) { return YMIN + (h - PAD - py) / (h - 2 * PAD) * (YMAX - YMIN); }
    };
  }
  function drawCurve() {
    if (S.mode === "abrupto" || !cv.clientWidth) return;
    var g = geom(), b = curveObj().b, f = ZPCurves.bezier(b), i;
    ctx.clearRect(0, 0, g.w, g.h);
    // grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(196,165,255,0.06)";
    ctx.beginPath();
    for (i = 1; i < 4; i++) {
      var gx = Math.round(g.X(i / 4)) + 0.5, gy = Math.round(g.Y(i / 4)) + 0.5;
      ctx.moveTo(gx, g.Y(0)); ctx.lineTo(gx, g.Y(1));
      ctx.moveTo(g.X(0), gy); ctx.lineTo(g.X(1), gy);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(196,165,255,0.16)";
    ctx.strokeRect(Math.round(g.X(0)) + 0.5, Math.round(g.Y(1)) + 0.5, Math.round(g.X(1) - g.X(0)), Math.round(g.Y(0) - g.Y(1)));
    // area under the curve
    var grad = ctx.createLinearGradient(0, g.Y(1), 0, g.Y(0));
    grad.addColorStop(0, "rgba(168,85,247,0.28)");
    grad.addColorStop(1, "rgba(168,85,247,0)");
    ctx.beginPath();
    ctx.moveTo(g.X(0), g.Y(0));
    for (i = 0; i <= 80; i++) ctx.lineTo(g.X(i / 80), g.Y(f(i / 80)));
    ctx.lineTo(g.X(1), g.Y(0));
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // handles
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(196,165,255,0.45)";
    ctx.beginPath();
    ctx.moveTo(g.X(0), g.Y(0)); ctx.lineTo(g.X(b[0]), g.Y(b[1]));
    ctx.moveTo(g.X(1), g.Y(1)); ctx.lineTo(g.X(b[2]), g.Y(b[3]));
    ctx.stroke();
    ctx.setLineDash([]);
    // curve
    var lg = ctx.createLinearGradient(g.X(0), 0, g.X(1), 0);
    lg.addColorStop(0, "#7c3aed"); lg.addColorStop(1, "#d8b4fe");
    ctx.strokeStyle = lg; ctx.lineWidth = 2.2; ctx.lineCap = "round";
    ctx.shadowColor = "rgba(168,85,247,0.6)"; ctx.shadowBlur = 8;
    ctx.beginPath();
    for (i = 0; i <= 80; i++) {
      var x = i / 80, y = f(x);
      i ? ctx.lineTo(g.X(x), g.Y(y)) : ctx.moveTo(g.X(x), g.Y(y));
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    // end points
    [[0, 0], [1, 1]].forEach(function (p) {
      ctx.fillStyle = "#c4a5ff"; ctx.beginPath(); ctx.arc(g.X(p[0]), g.Y(p[1]), 2.5, 0, 7); ctx.fill();
    });
    // draggable handles
    [[b[0], b[1]], [b[2], b[3]]].forEach(function (p) {
      ctx.fillStyle = "#14111c"; ctx.strokeStyle = "#e9ddff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(g.X(p[0]), g.Y(p[1]), 4.5, 0, 7); ctx.fill(); ctx.stroke();
    });
    // preview dot
    if (anim >= 0) {
      var ay = f(anim);
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(g.X(anim), g.Y(0)); ctx.lineTo(g.X(anim), g.Y(ay)); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.shadowColor = "#a855f7"; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(g.X(anim), g.Y(ay), 3.5, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
    }
    cv.title = "cubic-bezier(" + b.map(function (v) { return (+v).toFixed(2); }).join(", ") + ") — drag the handles to customize";
  }
  var playId = 0;
  function playCurve() {
    var id = ++playId, t0 = performance.now(), D = 900;
    function step(now) {
      if (id !== playId) return;
      var p = (now - t0) / D;
      if (p >= 1.35) { anim = -1; drawCurve(); return; }
      anim = Math.min(1, p); drawCurve();
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  cv.addEventListener("mouseenter", function () { if (drag < 0) playCurve(); });

  var drag = -1;
  cv.addEventListener("mousedown", function (e) {
    var g = geom(), b = curveObj().b, r = cv.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var d1 = Math.hypot(g.X(b[0]) - mx, g.Y(b[1]) - my), d2 = Math.hypot(g.X(b[2]) - mx, g.Y(b[3]) - my);
    drag = d1 < d2 ? 0 : 2;
    playId++; anim = -1;
    move(e);
  });
  window.addEventListener("mousemove", function (e) { if (drag >= 0) move(e); });
  window.addEventListener("mouseup", function () { if (drag >= 0) { drag = -1; save(); playCurve(); } });
  function move(e) {
    var g = geom(), r = cv.getBoundingClientRect(), cur = curveObj();
    var x = Math.min(1, Math.max(0, g.ix(e.clientX - r.left)));
    var y = Math.min(YMAX, Math.max(YMIN, g.iy(e.clientY - r.top)));
    cur.b[drag] = Math.round(x * 100) / 100; cur.b[drag + 1] = Math.round(y * 100) / 100;
    if (cur.id !== "custom") { cur.id = "custom"; curveSel.value = "custom"; }
    drawCurve();
  }
  window.addEventListener("resize", drawCurve);

  // ---------- center ----------
  var frame = $("frame");
  function setCenter(x, y) {
    S.cx = Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000;
    S.cy = Math.round(Math.min(1, Math.max(0, y)) * 1000) / 1000;
    save(); drawCenter();
  }
  // snaps to corners, midpoints, thirds and center when close
  function snap(v) {
    var pts = [0, 1 / 6, 1 / 3, 0.5, 2 / 3, 5 / 6, 1];
    for (var i = 0; i < pts.length; i++) if (Math.abs(v - pts[i]) < 0.035) return pts[i];
    return v;
  }
  var fdrag = false;
  $("square").addEventListener("mousedown", function (e) { fdrag = true; fmove(e); });
  window.addEventListener("mousemove", function (e) { if (fdrag) fmove(e); });
  window.addEventListener("mouseup", function () { fdrag = false; });
  function fmove(e) {
    var r = frame.getBoundingClientRect();
    setCenter(snap((e.clientX - r.left) / r.width), snap((e.clientY - r.top) / r.height));
  }
  function drawCenter() {
    $("dot").style.left = S.cx * 100 + "%";
    $("dot").style.top = S.cy * 100 + "%";
    $("centerTxt").textContent = Math.round(S.cx * 100) + " · " + Math.round(S.cy * 100);
    // area still visible at the final zoom (anchor = position = chosen center)
    var s = Math.max(1, (+S.zoom || 100) / 100), c = $("crop");
    c.style.width = 100 / s + "%";
    c.style.height = 100 / s + "%";
    c.style.left = (S.cx - S.cx / s) * 100 + "%";
    c.style.top = (S.cy - S.cy / s) * 100 + "%";
  }

  // ---------- presets ----------
  var PRESET_KEYS = ["mode", "zoom", "base", "dur", "dir", "at", "cont", "drift", "perClip", "mblur", "cx", "cy", "curveC", "curveA"];
  function presets() { return load(PSTORE, {}); }
  function fillPresets(sel) {
    var p = presets(), el = $("presetSel");
    el.innerHTML = '<option value="">Presets</option>';
    Object.keys(p).sort().forEach(function (n) {
      var o = document.createElement("option"); o.value = n; o.textContent = n; el.appendChild(o);
    });
    el.value = sel || "";
  }
  $("presetSel").onchange = function () {
    var p = presets()[this.value]; if (!p) return;
    PRESET_KEYS.forEach(function (k) { if (k in p) S[k] = JSON.parse(JSON.stringify(p[k])); });
    save(); syncInputs(); refresh(); drawCurve(); playCurve();
    status("Preset “" + this.value + "” loaded.");
  };
  $("presetSave").onclick = function () {
    var box = $("nameBox"), inp = $("presetName");
    box.classList.remove("hidden"); inp.value = labelFor(); inp.focus(); inp.select();
  };
  $("nameCancel").onclick = function () { $("nameBox").classList.add("hidden"); };
  $("presetName").onkeydown = function (e) { if (e.key === "Enter") $("nameOk").click(); if (e.key === "Escape") $("nameCancel").click(); };
  $("nameOk").onclick = function () {
    var name = $("presetName").value.trim();
    $("nameBox").classList.add("hidden");
    if (!name) return;
    var p = presets(), o = {};
    PRESET_KEYS.forEach(function (k) { o[k] = JSON.parse(JSON.stringify(S[k])); });
    p[name] = o;
    localStorage.setItem(PSTORE, JSON.stringify(p));
    fillPresets(name);
    status("Preset saved.", "ok");
  };
  $("presetDel").onclick = function () {
    var n = $("presetSel").value; if (!n) return;
    var p = presets(); delete p[n];
    localStorage.setItem(PSTORE, JSON.stringify(p));
    fillPresets();
    status("Preset “" + n + "” deleted.");
  };

  // ---------- apply ----------
  function fmt(n) { return String(Math.round(n * 100) / 100); }
  function labelFor() {
    var z = fmt(S.zoom) + "%";
    if (S.mode === "continuo") return z + " Continuous";
    if (S.mode === "abrupto") return z + " Punch-in" + (S.cont ? " +" + fmt(S.drift) : "");
    var d = { in: "In", out: "Out", inout: "In→Out" }[S.dir];
    return z + " " + d + " " + fmt(S.dur) + "s" + (S.cont && S.dir !== "inout" ? " +" + fmt(S.drift) : "");
  }

  async function apply() {
    var btn = $("apply");
    btn.disabled = true;
    status("Reading selection…");
    try {
      var info = await host("info", { perClip: !!S.perClip });
      if (info.width && info.height) { S.aspect = info.width / info.height; save(); refresh(); }
      var spf = info.tpf / TPS;
      var opts = {
        mode: S.mode, zoom: +S.zoom, base: +S.base, dur: +S.dur, dir: S.dir, at: S.at,
        cont: S.mode === "abrupto" || (S.mode === "animado" && S.dir !== "inout") ? !!S.cont : false,
        drift: +S.drift,
        curve: S.mode === "continuo" ? S.curveC.b : S.curveA.b
      };
      var ranges = info.ranges.map(function (r) {
        var frames = Math.max(1, Math.round((r.end - r.start) / info.tpf));
        return { start: r.start, end: r.end, top: r.top, update: r.update, keys: ZPCurves.buildKeys(opts, frames, spf) };
      });
      status(info.updating ? "Updating zoom…" : "Creating adjustment layer…");
      var res = await host("apply", {
        ranges: ranges, cx: S.cx, cy: S.cy, width: info.width, height: info.height,
        motionBlur: !!S.mblur, shutter: 180, label: labelFor(), extPath: extPath()
      });
      if (res.needTemplate) { $("tplBox").classList.remove("hidden"); status(""); return; }
      var n = res.done.length;
      var short = res.done.filter(function (d) { return Math.abs(d.end - d.wanted) > 2; }).length;
      var msg = (info.updating ? "Updated" : "Done") + ": " + n + (n > 1 ? " layers" : " layer") +
        " on V" + res.done[res.done.length - 1].track + " · " + labelFor();
      if (short) status(msg + " — heads up: " + short + " layer(s) ended up with a different length, check the timeline.", "warn");
      else status(msg, "ok");
    } catch (e) {
      status(e.message, "err");
    } finally {
      btn.disabled = false;
    }
  }
  $("apply").onclick = apply;
  $("undo").onclick = function () {
    host("undoLast", {}).then(function (r) {
      status(r.removed ? "Removed " + r.removed + " zoom layer(s)." : "Nothing to undo (use Ctrl/Cmd+Z in Premiere).", r.removed ? "ok" : "");
    }, function (e) { status(e.message, "err"); });
  };
  $("tplRetry").onclick = function () { $("tplBox").classList.add("hidden"); apply(); };
  $("tplUse").onclick = function () {
    host("useSelectedAsTemplate", {}).then(function () { $("tplBox").classList.add("hidden"); apply(); },
      function (e) { status(e.message, "err"); $("tplBox").classList.add("hidden"); });
  };

  fillPresets();
  syncInputs();
  refresh();
  requestAnimationFrame(function () { drawCurve(); playCurve(); });
})();
