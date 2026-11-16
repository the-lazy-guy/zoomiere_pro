// ZoomPro — ExtendScript side (runs inside Premiere Pro). ES3: no native JSON, no let/arrow functions.
// The panel computes the curves; here we read the selection, create the adjustment layer,
// apply the Transform effect and write the keyframes.
var ZoomPro = (function () {
  var TPS = 254016000000; // ticks per second
  var LABEL = "ZOOM";
  var DOT = String.fromCharCode(183);
  var AL_NAME = "ZoomPro - Adjustment Layer";
  var TRANSFORM_MATCH = "AE.ADBE Geometry";
  var TRANSFORM_NAMES = ["Transform", "Transformar", "Transformación", "Transformer", "Transformieren", "Trasforma"];

  // ---------- util ----------
  function quote(s) {
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), n = s.charCodeAt(i);
      if (c === '"' || c === "\\") out += "\\" + c;
      else if (n < 32) out += "\\u" + ("0000" + n.toString(16)).slice(-4);
      else out += c;
    }
    return out + '"';
  }
  function str(v) {
    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return String(v);
    if (t === "string") return quote(v);
    var parts = [], i;
    if (v instanceof Array) {
      for (i = 0; i < v.length; i++) parts.push(str(v[i]));
      return "[" + parts.join(",") + "]";
    }
    for (var k in v) if (v.hasOwnProperty(k)) parts.push(quote(k) + ":" + str(v[k]));
    return "{" + parts.join(",") + "}";
  }
  function T(ticks) { var t = new Time(); t.ticks = String(Math.round(ticks)); return t; }
  function tk(time) { return Number(time.ticks); }
  function seq() {
    var s = app.project.activeSequence;
    if (!s) throw new Error("Open a sequence in the timeline first.");
    return s;
  }
  function isZoomLayer(clip) { return clip && clip.name && clip.name.indexOf(LABEL + " " + DOT) === 0; }

  // ---------- selection ----------
  // Reads the selected video clips. If all of them are ZoomPro layers, returns them so they get updated.
  function readSelection(perClip) {
    var s = seq(), vids = [], i, j, c;
    for (i = 0; i < s.videoTracks.numTracks; i++) {
      var tr = s.videoTracks[i];
      for (j = 0; j < tr.clips.numItems; j++) {
        c = tr.clips[j];
        if (c.isSelected()) vids.push({ track: i, start: tk(c.start), end: tk(c.end), zoom: isZoomLayer(c) });
      }
    }
    if (!vids.length) {
      // only audio selected? use its range, above V1
      for (i = 0; i < s.audioTracks.numTracks; i++) {
        var at = s.audioTracks[i];
        for (j = 0; j < at.clips.numItems; j++) {
          c = at.clips[j];
          if (c.isSelected()) vids.push({ track: -1, start: tk(c.start), end: tk(c.end), zoom: false });
        }
      }
    }
    if (!vids.length) throw new Error("Select the clips in the timeline before applying.");

    var allZoom = true;
    for (i = 0; i < vids.length; i++) if (!vids[i].zoom) allZoom = false;

    var ranges = [];
    if (allZoom) {
      for (i = 0; i < vids.length; i++) ranges.push({ start: vids[i].start, end: vids[i].end, top: vids[i].track, update: true });
    } else {
      var src = [];
      for (i = 0; i < vids.length; i++) if (!vids[i].zoom) src.push(vids[i]);
      if (perClip) {
        src.sort(function (a, b) { return a.start - b.start; });
        for (i = 0; i < src.length; i++) ranges.push({ start: src[i].start, end: src[i].end, top: src[i].track, update: false });
      } else {
        var r = { start: src[0].start, end: src[0].end, top: src[0].track, update: false };
        for (i = 1; i < src.length; i++) {
          if (src[i].start < r.start) r.start = src[i].start;
          if (src[i].end > r.end) r.end = src[i].end;
          if (src[i].track > r.top) r.top = src[i].track;
        }
        ranges.push(r);
      }
    }
    var tpf = Number(s.timebase);
    var fh = 1080, fw = 1920;
    try { fh = s.frameSizeVertical; fw = s.frameSizeHorizontal; } catch (e) {}
    return { ranges: ranges, tpf: tpf, fps: TPS / tpf, width: fw, height: fh, updating: allZoom };
  }

  // ---------- adjustment layer ----------
  function walk(bin, fn) {
    for (var i = 0; i < bin.children.numItems; i++) {
      var it = bin.children[i];
      if (it.type === ProjectItemType.BIN) { var r = walk(it, fn); if (r) return r; }
      else if (fn(it)) return it;
    }
    return null;
  }
  function isAL(p) { try { return p.isAdjustmentLayer(); } catch (e) { return false; } }
  function findAdjustmentItem() {
    var root = app.project.rootItem;
    var it = walk(root, function (p) { return p.name === AL_NAME && isAL(p); });
    if (it) return it;
    return walk(root, isAL);
  }
  function allALs() {
    var out = [];
    walk(app.project.rootItem, function (p) { if (isAL(p)) out.push(p); return false; });
    return out;
  }
  // Imports the adjustment layer bundled with the plugin (assets/ZoomPro-AL.prproj).
  function importBundledAL(extPath) {
    if (!extPath) return null;
    var f = new File(extPath + "/assets/ZoomPro-AL.prproj");
    if (!f.exists) return null;
    var seen = {}, i, before = allALs();
    for (i = 0; i < before.length; i++) seen[before[i].nodeId] = true;
    try { app.project.importFiles([f.fsName], true, app.project.rootItem, false); } catch (e) { return null; }
    var it = null, now = allALs();
    for (i = 0; i < now.length; i++) if (!seen[now[i].nodeId]) { it = now[i]; break; }
    // remove the helper sequence that comes with the import
    try {
      for (i = app.project.sequences.numSequences - 1; i >= 0; i--) {
        var sq = app.project.sequences[i];
        if (sq.name !== "ZoomPro-AL-src") continue;
        if (!it) { try { var pi = sq.videoTracks[0].clips[0].projectItem; if (isAL(pi)) it = pi; } catch (e2) {} }
        app.project.deleteSequence(sq);
      }
    } catch (e) {}
    if (it && !seen[it.nodeId]) { try { it.name = AL_NAME; } catch (e) {} }
    return it;
  }
  function useSelectedAsTemplate() {
    var sel = null;
    try { sel = app.getCurrentProjectViewSelection(); } catch (e) {}
    if (!sel || !sel.length) throw new Error("Select the adjustment layer in the Project panel and click again.");
    if (!isAL(sel[0])) throw new Error("The item selected in the Project panel is not an adjustment layer.");
    sel[0].name = AL_NAME;
    return { name: AL_NAME };
  }

  // ---------- tracks ----------
  function trackFree(track, a, b) {
    for (var j = 0; j < track.clips.numItems; j++) {
      var c = track.clips[j];
      if (tk(c.start) < b - 1 && tk(c.end) > a + 1) return false;
    }
    return true;
  }
  function pickTrack(s, from, a, b) {
    for (var i = Math.max(from, 0); i < s.videoTracks.numTracks; i++) if (trackFree(s.videoTracks[i], a, b)) return i;
    app.enableQE();
    var n = s.videoTracks.numTracks;
    qe.project.getActiveSequence().addTracks(1, n, 0);
    s = app.project.activeSequence;
    if (s.videoTracks.numTracks <= n) throw new Error("Couldn't create a new video track. Add an empty track above and try again.");
    return n;
  }
  function clipAt(s, trackIdx, startTicks) {
    var tr = s.videoTracks[trackIdx];
    for (var j = 0; j < tr.clips.numItems; j++) if (Math.abs(tk(tr.clips[j].start) - startTicks) < 2) return tr.clips[j];
    return null;
  }

  // ---------- Transform ----------
  function findTransform(clip) {
    for (var i = clip.components.numItems - 1; i >= 0; i--) {
      if (clip.components[i].matchName === TRANSFORM_MATCH) return clip.components[i];
    }
    return null;
  }
  function addTransform(trackIdx, clip) {
    app.enableQE();
    // getVideoEffectByName accepts any name, so check the real list (the name depends on the UI language)
    var list = qe.project.getVideoEffectList(), eff = null, i, j;
    for (i = 0; i < TRANSFORM_NAMES.length && !eff; i++) {
      for (j = 0; j < list.length; j++) if (list[j] === TRANSFORM_NAMES[i]) { eff = qe.project.getVideoEffectByName(list[j]); break; }
    }
    if (!eff) throw new Error("Couldn't find the Transform effect in Premiere.");
    var qtr = qe.project.getActiveSequence().getVideoTrackAt(trackIdx);
    var target = tk(clip.start), qi = null;
    for (i = 0; i < qtr.numItems; i++) {
      var it = qtr.getItemAt(i);
      if (it && it.type !== "Empty" && Math.abs(Number(it.start.ticks) - target) < 2) { qi = it; break; }
    }
    if (!qi) throw new Error("Couldn't find the new layer to apply Transform to.");
    qi.addVideoEffect(eff);
  }
  function prop(comp, names, idx) {
    var i, j;
    for (i = 0; i < comp.properties.numItems; i++) {
      var dn = String(comp.properties[i].displayName).toLowerCase();
      for (j = 0; j < names.length; j++) if (dn === names[j]) return comp.properties[i];
    }
    return comp.properties.numItems > idx ? comp.properties[idx] : null;
  }

  function applyTransform(clip, o) {
    var comp = findTransform(clip);
    var anchor = prop(comp, ["anchor point", "ponto de ancoragem", "punto de anclaje"], 0);
    var pos = prop(comp, ["position", "posição", "posicion", "posición"], 1);
    var uni = prop(comp, ["uniform scale", "escala uniforme", "dimensionar uniformemente"], 2);
    var scale = prop(comp, ["scale", "scale height", "escala", "dimensionar altura", "altura da escala", "altura de escala"], 3);
    var useComp = prop(comp, ["use composition's shutter angle", "usar ângulo do obturador da composição", "usar ângulo do obturador da sequência"], 9);
    var shutter = prop(comp, ["shutter angle", "ângulo do obturador", "angulo do obturador"], 10);

    try { if (uni && uni.getValue() !== true) uni.setValue(true, true); } catch (e) {}

    // zoom point: anchor = position = chosen point -> that point stays put and the image grows around it
    var def = [0.5, 0.5];
    try { def = anchor.getValue(); } catch (e) {}
    var pixel = def && def[0] > 1.5; // some versions use pixels instead of 0..1
    var px = pixel ? o.cx * o.width : o.cx;
    var py = pixel ? o.cy * o.height : o.cy;
    try { anchor.setTimeVarying(false); } catch (e) {}
    try { pos.setTimeVarying(false); } catch (e) {}
    anchor.setValue([px, py], true);
    pos.setValue([px, py], true);

    if (o.motionBlur) {
      try { useComp.setValue(false, true); } catch (e) {}
      try { shutter.setValue(o.shutter || 180, true); } catch (e) {}
    }

    // scale
    var keys = o.keys; // [[seconds from layer start, scale %], ...]
    scale.setTimeVarying(false); // clears old keyframes
    if (keys.length === 1) {
      scale.setValue(keys[0][1], true);
      return 0;
    }
    scale.setTimeVarying(true);
    var base = clip.inPoint.seconds;
    for (var k = 0; k < keys.length; k++) {
      var t = base + keys[k][0];
      scale.addKey(t);
      scale.setValueAtKey(t, keys[k][1], k === keys.length - 1);
    }
    return keys.length;
  }

  // ---------- operations ----------
  var last = [];

  function info(a) { return readSelection(a.perClip); }

  function apply(a) {
    var s = seq();
    var done = [], i;
    last = [];
    var al = null;
    for (i = 0; i < a.ranges.length; i++) {
      var r = a.ranges[i], clip, trackIdx;
      if (r.update) {
        trackIdx = r.top;
        clip = clipAt(s, trackIdx, r.start);
        if (!clip) throw new Error("Couldn't find the selected zoom layer.");
        if (!findTransform(clip)) { addTransform(trackIdx, clip); clip = clipAt(app.project.activeSequence, trackIdx, r.start); }
      } else {
        if (!al) {
          al = findAdjustmentItem() || importBundledAL(a.extPath);
          if (!al) return { needTemplate: true };
        }
        var dur = r.end - r.start;
        try { al.setInPoint(0, 4); al.setOutPoint(dur / TPS, 4); } catch (e) {}
        var itemLen = dur;
        try { itemLen = tk(al.getOutPoint(4)) - tk(al.getInPoint(4)); } catch (e) {}
        trackIdx = pickTrack(s, r.top + 1, r.start, r.start + Math.max(dur, itemLen));
        s = app.project.activeSequence;
        s.videoTracks[trackIdx].overwriteClip(al, T(r.start));
        clip = clipAt(s, trackIdx, r.start);
        if (!clip) throw new Error("Premiere didn't insert the adjustment layer.");
        if (Math.abs(tk(clip.end) - r.end) > 2) { try { clip.end = T(r.end); } catch (e) {} }
        addTransform(trackIdx, clip);
        s = app.project.activeSequence;
        clip = clipAt(s, trackIdx, r.start);
      }
      var nk = applyTransform(clip, { keys: r.keys, cx: a.cx, cy: a.cy, width: a.width, height: a.height, motionBlur: a.motionBlur, shutter: a.shutter });
      try { clip.name = LABEL + " " + DOT + " " + a.label; } catch (e) {}
      if (!r.update) last.push({ track: trackIdx, start: r.start });
      done.push({ track: trackIdx + 1, keys: nk, end: tk(clip.end), wanted: r.end });
    }
    return { done: done };
  }

  function undoLast() {
    var s = seq(), n = 0;
    for (var i = 0; i < last.length; i++) {
      var c = clipAt(s, last[i].track, last[i].start);
      if (c && isZoomLayer(c)) { c.remove(false, false); n++; }
    }
    last = [];
    return { removed: n };
  }

  var OPS = { info: info, apply: apply, undoLast: undoLast, useSelectedAsTemplate: useSelectedAsTemplate };

  return {
    run: function (op, encoded) {
      try {
        var args = eval("(" + decodeURIComponent(encoded) + ")");
        return str({ ok: true, result: OPS[op](args) });
      } catch (e) {
        return str({ ok: false, error: String(e.message || e) + (e.line ? " (line " + e.line + ")" : "") });
      }
    }
  };
})();
