/* Moteur de gestes du CV : transforme, image après image, les mains vues par la caméra en actions sur le site.
   Logique pure, sans caméra ni DOM : testée dans scripts/tests/gestes-engine.test.mjs avec des mains simulées,
   et calibrée sur les photos de test de MediaPipe (doigts : 10–60° tendus / 85–145° pliés ; pouce : 1,8–2,5 / 0,8–0,9).

   Entrée de frame(f) : { t: ms, hands: [{ lm: 21 points image {x, y} (0..1, caméra non miroir),
                                           world: 21 points 3D {x, y, z} (repère de la main, facultatif),
                                           handed: 'Left' | 'Right' (latéralité donnée par le modèle),
                                           gesture: catégorie du modèle (Victory, Thumb_Up…), gscore }] }
   Actions émises (onAction) :
     mode {mode}            'none' | 'hand' | 'pointer' | 'grab' | 'count'
     cursor {x, y, press}   index levé : pointeur (0..1, en miroir) ; press = 0..1 pendant le clic
     click {x, y}           l'index se plie puis se déplie d'un coup sec
     grab {x, y, dx, dy}    poing fermé qu'on déplace : la page suit la main dans les deux directions
                            (x, y = position du poing ; dx, dy = défilement demandé, en fraction d'écran)
     fling {vx, vy}         élan quand on rouvre la main (fraction d'écran par seconde)
     count {n, progress}    dos de la main vers l'écran, doigts vers le haut : nombre de doigts (mains additionnées)
     page {n}               ce nombre est resté stable : aller au volet n
     spell {x, y}           cercle tracé avec l'index : Expecto Patronum
     insult                 doigt d'honneur
     theme / assistant / close   ✌️ 👍 👎 tenus un instant */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GestesEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATIC = { Victory: 'theme', Thumb_Up: 'assistant', Thumb_Down: 'close' };
  var DEFAULTS = {
    curlExt: 80,          // angle doigt / paume (degrés) en dessous duquel un doigt est tendu
    thumbExt: 1.35,       // distance bout du pouce – base de l'auriculaire, rapportée à la largeur de la paume
    side: 0.15,           // orientation en dessous de laquelle la main est vue de profil
    countSide: 0.25,      // pour compter : dos nettement tourné vers l'écran…
    upright: 45,          // …et main droite (poignet → doigts à moins de 45° de la verticale)
    poseFrames: 3,        // images consécutives avant de changer de mode (évite le clignotement)
    countHold: 600, pages: 6,
    staticHold: 6, staticCooldown: 1500, staticScore: 0.6,
    insultHold: 5, insultCooldown: 4000,
    pointerGap: 30,       // l'index doit être nettement plus tendu que les trois autres doigts
    box: { x0: 0.2, x1: 0.8, y0: 0.15, y1: 0.65 },   // zone de la caméra ramenée à tout l'écran
    euro: { minCutoff: 0.9, beta: 4, dCutoff: 1 },    // filtre « One Euro » : stable à l'arrêt, réactif en mouvement
    // clic : l'index se plie (angle +20° OU longueur à l'image −28 %) puis revient, en moins de 0,9 s
    tap: { curl: 20, len: 0.72, upCurl: 10, upLen: 0.86, freezeCurl: 8, freezeLen: 0.92, max: 900, window: 600 },
    grab: { gain: 1.6, smooth: 0.45, dead: 0.003 },
    spell: { window: 1800, turns: 0.9, minSize: 0.07, maxSize: 0.75, step: 0.012, cooldown: 3000 }
  };

  // ------------------------------------------------------------------ géométrie
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) }; }
  function len(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
  function angle(u, v) { var d = (u.x * v.x + u.y * v.y + u.z * v.z) / ((len(u) * len(v)) || 1); return Math.acos(d < -1 ? -1 : d > 1 ? 1 : d) * 180 / Math.PI; }
  function dist(a, b) { return len(sub(a, b)); }
  function d2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function mix(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b || {}) o[k] = b[k]; return o; }

  /** Lecture d'une main : doigts tendus, orientation (paume / dos / profil), repères utiles. */
  function analyse(h, o) {
    o = o || DEFAULTS;
    var w = h.world && h.world.length === 21 ? h.world : h.lm, lm = h.lm;
    var curls = [[5, 8], [9, 12], [13, 16], [17, 20]].map(function (j) { return angle(sub(w[j[0]], w[0]), sub(w[j[1]], w[j[0]])); });
    var thumb = dist(w[4], w[17]) / (dist(w[5], w[17]) || 1);
    var fingers = [thumb > o.thumbExt].concat(curls.map(function (c) { return c < o.curlExt; }));
    // orientation : sens de rotation poignet → index → auriculaire dans l'image, corrigé par la latéralité
    var a = sub(lm[5], lm[0]), b = sub(lm[17], lm[0]);
    var cross = (a.x * b.y - a.y * b.x) / ((Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)) || 1);
    var s = cross * (h.handed === 'Right' ? -1 : 1);
    var palm = { x: 0, y: 0 };
    [0, 5, 9, 13, 17].forEach(function (i) { palm.x += (1 - lm[i].x) / 5; palm.y += lm[i].y / 5; });
    var size = d2(lm[9], lm[0]) || 0.001;
    var ax = { x: lm[9].x - lm[0].x, y: lm[9].y - lm[0].y, z: 0 };
    return {
      fingers: fingers, count: fingers.filter(Boolean).length, curls: curls, thumb: thumb,
      side: s > o.side ? 'palm' : s < -o.side ? 'back' : 'side', orient: s,
      upright: angle(ax, { x: 0, y: -1, z: 0 }),              // 0° = doigts vers le haut
      ilen: d2(lm[8], lm[5]) / size,                           // longueur de l'index à l'image, rapportée à la paume
      palm: palm, tip: { x: 1 - lm[8].x, y: lm[8].y }, size: size,
      gesture: h.gesture || 'None', gscore: h.gscore == null ? 1 : h.gscore
    };
  }

  /** Filtre One Euro (Casiez et al., 2012) : peu de tremblement lent, peu de retard rapide. */
  function OneEuro(p) { this.p = p; this.x = null; this.dx = 0; this.t = 0; }
  OneEuro.prototype.f = function (x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    var dt = Math.max(0.001, (t - this.t) / 1000); this.t = t;
    var al = function (c) { var r = 2 * Math.PI * c * dt; return r / (r + 1); };
    this.dx += al(this.p.dCutoff) * ((x - this.x) / dt - this.dx);
    this.x += al(this.p.minCutoff + this.p.beta * Math.abs(this.dx)) * (x - this.x);
    return this.x;
  };

  function Engine(opts) {
    this.o = mix(DEFAULTS, opts);
    this.emit = this.o.onAction || function () {};
    this.reset();
  }

  Engine.prototype.reset = function () {
    this.mode = 'none'; this.cand = null; this.candN = 0; this.since = 0;
    this.st = { g: null, n: 0, fired: null, last: -1e9 };
    this.ins = { n: 0, last: this.ins ? this.ins.last : -1e9 };
    this.cnt = { n: -1, since: 0, fired: null };
    this.newPointer();
    this.path = []; this.lastSpell = this.lastSpell || -1e9;
    this.grb = { p: null, vx: 0, vy: 0 };
  };

  Engine.prototype.newPointer = function () {
    this.ptr = { fx: new OneEuro(this.o.euro), fy: new OneEuro(this.o.euro), trail: [], win: [], down: 0, cur: null };
  };

  Engine.prototype.setMode = function (m, t) {
    if (m === this.mode) return;
    if (this.mode === 'grab') this.endGrab();
    this.mode = m; this.since = t;
    if (m === 'pointer') { this.newPointer(); this.path = []; }
    if (m === 'grab') this.grb = { p: null, vx: 0, vy: 0 };
    if (m !== 'count') this.cnt = { n: -1, since: 0, fired: null };
    this.emit({ type: 'mode', mode: m });
  };

  /** Changement de mode après quelques images concordantes. */
  Engine.prototype.want = function (m, t) {
    if (m === this.mode) { this.cand = null; return; }
    if (this.mode === 'none') { this.setMode(m, t); return; }
    if (this.cand === m) this.candN++; else { this.cand = m; this.candN = 1; }
    if (this.candN >= this.o.poseFrames) { this.cand = null; this.setMode(m, t); }
  };

  Engine.prototype.frame = function (f) {
    var o = this.o, t = f.t;
    var hands = (f.hands || []).filter(function (h) { return h && h.lm && h.lm.length >= 21; }).map(function (h) { return analyse(h, o); });
    if (!hands.length) {
      if (this.mode === 'none') return;
      if (this.mode === 'grab') this.endGrab();
      this.reset(); this.emit({ type: 'mode', mode: 'none' }); return;
    }

    // 1. doigt d'honneur (majeur seul levé), sur n'importe quelle main
    var rude = hands.some(function (h) { var F = h.fingers; return F[2] && !F[1] && !F[3] && !F[4]; });
    if (rude) {
      this.ins.n++;
      if (this.ins.n >= o.insultHold && t - this.ins.last > o.insultCooldown) { this.ins.last = t; this.emit({ type: 'insult' }); }
      this.want('hand', t); return;
    }
    this.ins.n = 0;

    // 2. dos de la main vers l'écran, doigts vers le haut : on compte (les deux mains s'additionnent)
    var counters = hands.filter(function (h) { return h.side === 'back' && h.orient < -o.countSide && h.upright < o.upright && h.count > 0; });
    if (counters.length) { this.want('count', t); if (this.mode === 'count') this.counting(counters, t); return; }

    // la main principale : la plus proche (la plus grande à l'image)
    var h = hands.reduce(function (a, b) { return b.size > a.size ? b : a; });
    var F = h.fingers, c = h.curls;

    // 3. gestes tenus (✌️ 👍 👎), reconnus par le modèle
    var g = h.gscore >= o.staticScore ? h.gesture : 'None';
    if (STATIC[g] && this.mode !== 'grab' && !(this.mode === 'pointer' && this.ptr.down)) {
      var st = this.st;
      if (st.g === g) st.n++; else { st.g = g; st.n = 1; }
      if (st.n >= o.staticHold && st.fired !== g && t - st.last > o.staticCooldown) { st.fired = g; st.last = t; this.emit({ type: STATIC[g] }); }
      this.want('hand', t); return;
    }
    this.st.g = null; this.st.n = 0; this.st.fired = null;

    // 4. index levé (nettement plus tendu que les autres doigts) : pointeur ; un clic en cours garde le mode
    var gap = o.pointerGap;
    var pointerPose = F[1] && c[1] > c[0] + gap && c[2] > c[0] + gap && c[3] > c[0] + gap;
    var pointing = pointerPose || (this.mode === 'pointer' && this.ptr.down && t - this.ptr.down < o.tap.max);
    // 5. poing fermé (pouce compris) : on attrape la page
    var fist = !F[0] && !F[1] && !F[2] && !F[3] && !F[4];
    this.want(pointing ? 'pointer' : fist ? 'grab' : 'hand', t);
    if (this.mode === 'pointer') this.pointer(h, t);
    else if (this.mode === 'grab' && fist) this.grabMove(h, t);   // pendant la transition, on garde l'élan intact
  };

  Engine.prototype.counting = function (hands, t) {
    var n = hands.reduce(function (s, h) { return s + h.count; }, 0), c = this.cnt;
    if (n !== c.n) { c.n = n; c.since = t; }
    var progress = n >= 1 && n <= this.o.pages && c.fired !== n ? clamp01((t - c.since) / this.o.countHold) : 0;
    this.emit({ type: 'count', n: n, progress: progress });
    if (progress >= 1) { c.fired = n; this.emit({ type: 'page', n: n }); }
  };

  Engine.prototype.mapBox = function (p) {
    var b = this.o.box;
    return { x: clamp01((p.x - b.x0) / (b.x1 - b.x0)), y: clamp01((p.y - b.y0) / (b.y1 - b.y0)) };
  };

  Engine.prototype.pointer = function (h, t) {
    var tp = this.o.tap, p = this.ptr, curl = h.curls[0], il = h.ilen, raw = this.mapBox(h.tip);
    // référence : l'index le plus tendu des 600 dernières ms, hors clic (aucune dérive pendant le geste)
    if (!p.down) { p.win.push({ t: t, c: curl, l: il }); while (p.win.length > 1 && t - p.win[0].t > tp.window) p.win.shift(); }
    var baseC = Infinity, baseL = 0;
    p.win.forEach(function (s) { if (s.c < baseC) baseC = s.c; if (s.l > baseL) baseL = s.l; });
    var bend = curl - baseC, short = il / (baseL || il || 1);
    var bending = bend > tp.freezeCurl || short < tp.freezeLen;
    if (!p.down && (bend > tp.curl || short < tp.len)) {
      p.down = t; var at = p.trail[0] || p.cur || raw; p.cur = { x: at.x, y: at.y };   // là où il visait juste avant
    } else if (p.down && bend < tp.upCurl && short > tp.upLen) {
      if (t - p.down <= tp.max) this.emit({ type: 'click', x: p.cur.x, y: p.cur.y });
      p.down = 0; p.trail = []; p.win = [{ t: t, c: curl, l: il }];
    } else if (p.down && t - p.down > tp.max) {                                          // pliage tenu : pas un clic
      p.down = 0; p.win = [{ t: t, c: curl, l: il }];
    }
    if (!p.down) {
      if (!bending) {
        p.cur = { x: p.fx.f(raw.x, t), y: p.fy.f(raw.y, t) };
        p.trail.push({ t: t, x: p.cur.x, y: p.cur.y });
        while (p.trail.length && t - p.trail[0].t > 150) p.trail.shift();
      }
      this.trackSpell(h.tip, t);
    }
    var press = p.down ? 1 : clamp01(Math.max(bend / tp.curl, (1 - short) / (1 - tp.len)));
    if (p.cur) this.emit({ type: 'cursor', x: p.cur.x, y: p.cur.y, press: press });
  };

  /** Cercle tracé avec l'index (somme des virages ≥ 0,9 tour, taille raisonnable) : Expecto Patronum. */
  Engine.prototype.trackSpell = function (tip, t) {
    var s = this.o.spell, path = this.path, last = path[path.length - 1];
    if (!last || Math.hypot(tip.x - last.x, tip.y - last.y) >= s.step) path.push({ t: t, x: tip.x, y: tip.y });
    while (path.length && t - path[0].t > s.window) path.shift();
    if (path.length < 8 || t - this.lastSpell < s.cooldown) return;
    var turn = 0, x0 = 1, x1 = 0, y0 = 1, y1 = 0;
    for (var i = 0; i < path.length; i++) {
      x0 = Math.min(x0, path[i].x); x1 = Math.max(x1, path[i].x); y0 = Math.min(y0, path[i].y); y1 = Math.max(y1, path[i].y);
      if (i >= 2) {
        var ux = path[i - 1].x - path[i - 2].x, uy = path[i - 1].y - path[i - 2].y, vx = path[i].x - path[i - 1].x, vy = path[i].y - path[i - 1].y;
        turn += Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      }
    }
    var size = Math.max(x1 - x0, y1 - y0);
    if (Math.abs(turn) >= s.turns * 2 * Math.PI && size >= s.minSize && size <= s.maxSize && Math.min(x1 - x0, y1 - y0) >= size * 0.4) {
      this.lastSpell = t; this.path = [];
      var c = this.mapBox({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
      this.emit({ type: 'spell', x: c.x, y: c.y });
    }
  };

  /** Poing fermé : la page suit la main, horizontalement et verticalement. */
  Engine.prototype.grabMove = function (h, t) {
    var o = this.o.grab, g = this.grb, pos = this.mapBox(h.palm);
    var p = g.p ? { x: g.p.x + (pos.x - g.p.x) * o.smooth, y: g.p.y + (pos.y - g.p.y) * o.smooth, t: t } : { x: pos.x, y: pos.y, t: t };
    var prev = g.p; g.p = p;
    var dx = 0, dy = 0;
    if (prev) {
      var mx = p.x - prev.x, my = p.y - prev.y, dt = Math.max(1, t - prev.t) / 1000;
      if (Math.abs(mx) > o.dead) dx = -mx * o.gain;     // la page suit la main : main vers la gauche = on avance vers la droite
      if (Math.abs(my) > o.dead) dy = -my * o.gain;     // main qui monte = on descend dans la page
      g.vx = g.vx * 0.5 + (dx / dt) * 0.5; g.vy = g.vy * 0.5 + (dy / dt) * 0.5;
    }
    this.emit({ type: 'grab', x: p.x, y: p.y, dx: dx, dy: dy });
  };

  Engine.prototype.endGrab = function () {
    var g = this.grb;
    if (g && (Math.abs(g.vx) > 0.3 || Math.abs(g.vy) > 0.3)) this.emit({ type: 'fling', vx: g.vx, vy: g.vy });
    if (g) { g.vx = 0; g.vy = 0; }
  };

  Engine.analyse = function (h, o) { return analyse(h, mix(DEFAULTS, o)); };
  Engine.DEFAULTS = DEFAULTS;
  Engine.STATIC = STATIC;
  return Engine;
});
