// Animation curves and keyframe generation (runs in the panel, modern JS).
var ZPCurves = (function () {
  var PRESETS = [
    { id: "linear", name: "Linear", b: [0, 0, 1, 1] },
    { id: "suave", name: "Smooth", b: [0.25, 0.1, 0.25, 1] },
    { id: "inout", name: "Ease In-Out", b: [0.42, 0, 0.58, 1] },
    { id: "forte", name: "Strong", b: [0.83, 0, 0.17, 1] },
    { id: "expo", name: "Expo", b: [0.87, 0, 0.13, 1] },
    { id: "in", name: "Ease In", b: [0.42, 0, 1, 1] },
    { id: "out", name: "Ease Out", b: [0, 0, 0.58, 1] },
    { id: "expoOut", name: "Expo Out", b: [0.16, 1, 0.3, 1] },
    { id: "snap", name: "Snap", b: [0.05, 0.7, 0.1, 1] },
    { id: "s40", name: "40 / 100", b: [0.4, 0, 0, 1] },
    { id: "s60", name: "60 / 80", b: [0.6, 0, 0.2, 1] },
    { id: "back", name: "Back", b: [0.34, 1.56, 0.64, 1] }
  ];

  // cubic-bezier(x1,y1,x2,y2) -> function u(0..1) -> progress
  function bezier(b) {
    var x1 = b[0], y1 = b[1], x2 = b[2], y2 = b[3];
    if (x1 === y1 && x2 === y2) return function (u) { return u; };
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    function solve(x) {
      var t = x, i;
      for (i = 0; i < 8; i++) {
        var e = sx(t) - x, d = dx(t);
        if (Math.abs(e) < 1e-7) return t;
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      var lo = 0, hi = 1; t = x;
      for (i = 0; i < 40; i++) {
        var v = sx(t);
        if (Math.abs(v - x) < 1e-7) return t;
        if (x > v) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return t;
    }
    return function (u) {
      if (u <= 0) return 0;
      if (u >= 1) return 1;
      return sy(solve(u));
    };
  }

  // Ramer–Douglas–Peucker: drops redundant keyframes (straight stretches become 2 keys)
  function simplify(pts, eps) {
    if (pts.length < 3) return pts.slice();
    var keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    var stack = [[0, pts.length - 1]];
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1];
      var ta = pts[a][0], va = pts[a][1], tb = pts[b][0], vb = pts[b][1];
      var worst = -1, wi = -1;
      for (var i = a + 1; i < b; i++) {
        var lin = va + (vb - va) * (pts[i][0] - ta) / (tb - ta);
        var d = Math.abs(pts[i][1] - lin);
        if (d > worst) { worst = d; wi = i; }
      }
      if (worst > eps) { keep[wi] = true; stack.push([a, wi], [wi, b]); }
    }
    return pts.filter(function (_, i) { return keep[i]; });
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Builds [[seconds, scale %], ...] for a layer that is 'frames' frames long.
  // o: {mode, zoom, base, dur, dir, at, cont, drift, curve}
  function buildKeys(o, frames, secPerFrame) {
    var E = bezier(o.curve);
    if (frames < 2) {
      var fin = o.mode === "animado" ? (o.dir === "in" ? o.zoom : o.base) : o.zoom;
      return [[0, fin]];
    }
    var L = Math.max(frames - 1, 1);
    var Z = o.zoom, B = o.base, drift = o.cont ? o.drift : 0;
    var Dn = clamp(Math.round(o.dur / secPerFrame), 1, L);
    var a = o.at === "end" ? L - Dn : 0;
    if (o.dir === "inout") Dn = clamp(Dn, 1, Math.max(1, Math.floor(L / 2)));
    var pts = [];
    for (var k = 0; k <= L; k++) {
      var v, p = k / L;
      if (o.mode === "continuo") {
        v = B + (Z - B) * E(p);
      } else if (o.mode === "abrupto") {
        v = Z + drift * p;
      } else if (o.dir === "in") {
        v = B + (Z - B) * E(clamp((k - a) / Dn, 0, 1)) + drift * p;
      } else if (o.dir === "out") {
        v = Z + (B + drift - Z) * E(clamp((k - a) / Dn, 0, 1)) - drift * p;
      } else { // in -> out
        v = B + (Z - B) * (E(clamp(k / Dn, 0, 1)) - E(clamp((k - (L - Dn)) / Dn, 0, 1)));
      }
      pts.push([k * secPerFrame, Math.round(v * 1000) / 1000]);
    }
    var out = simplify(pts, 0.01);
    var same = out.every(function (q) { return Math.abs(q[1] - out[0][1]) < 1e-6; });
    return same ? [[0, out[0][1]]] : out;
  }

  return { PRESETS: PRESETS, bezier: bezier, buildKeys: buildKeys, simplify: simplify };
})();
if (typeof module !== "undefined") module.exports = ZPCurves;
