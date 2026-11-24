/* Intro « Rideaux » du CV de Kenza : son nom s'écrit lettre à lettre, les compteurs défilent (4 ans · 5 missions ·
   2 certifications), puis l'écran se découpe en 7 bandes — une par section du CV, numérotées — qui s'ouvrent comme
   des rideaux, en cascade, pendant que le point du nom rejoint celui de la colonne d'identité.
   Dessinée sur un canvas posé AU-DESSUS de la page déjà affichée : rien n'est caché aux moteurs de recherche.
   Démarrage décidé dans <head> (classe html.intro, robots et outils de mesure exclus ; ?intro la force).
   L'intro ne peut pas être passée : pendant ses ~3 s, clics, touches, molette et glisser sont retenus.
   « Réduire les animations » la ramène à un fondu de 0,2 s. Relecture lente : ?intro=lent. */
(function () {
  'use strict';
  var root = document.documentElement;
  if (!root.classList.contains('intro')) return;

  var LENGTH = 2900;
  var slow = /[?&]intro=lent\b/.test(location.search) ? 2 : 1;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var secs = Array.prototype.slice.call(document.querySelectorAll('.sec'));
  var target = document.querySelector('.left .top .nm .acc');
  var NAME = 'Kenza SKALLI', ROLE = 'DÉVELOPPEUSE FULL-STACK .NET / ANGULAR';
  var COUNTERS = [[4, 'ans'], [5, 'missions'], [2, 'certifications']];

  var clamp = function (x) { return Math.max(0, Math.min(1, x)); };
  var step = function (t, a, b) { return clamp((t - a) / (b - a)); };
  var ease = function (x) { return x * x * (3 - 2 * x); };
  var inOut = function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  var mix = function (a, b, u) { return a + (b - a) * u; };

  var canvas = document.createElement('canvas');
  canvas.id = 'intro-canvas'; canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  var w, h, col, dotTo, labels;

  function measure() {
    w = innerWidth; h = innerHeight;
    var scale = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    var css = getComputedStyle(root), v = function (n) { return css.getPropertyValue(n).trim(); };
    col = { bg: v('--bg'), surface: v('--surface'), ink: v('--ink'), muted: v('--muted'), line: v('--line'), acc: v('--accent'),
            disp: v('--ff-d') || 'system-ui, sans-serif', mono: v('--ff-m') || 'monospace' };
    var r = target && target.getBoundingClientRect();
    dotTo = r && r.width && r.bottom > 0 && r.top < h ? { x: r.left + r.width / 2, y: r.top + r.height * 0.72, s: Math.max(2.5, r.height * 0.11) } : null;
    labels = secs.map(function (s, i) { return '0' + (i + 1) + ' — ' + (s.getAttribute('data-t') || '').toUpperCase(); });
  }

  function scene(t) {
    var n = Math.max(secs.length, 1), bh = h / n, big = Math.min(w * 0.105, 92), cy = h * 0.42;
    // 1. Le rideau : 7 bandes jointives, puis séparées par un filet, puis ouvertes en cascade (gauche / droite).
    for (var i = 0; i < n; i++) {
      var u = inOut(step(t, 1500 + i * 70, 2350 + i * 70)), dir = i % 2 ? 1 : -1, x = dir * u * (w + 40);
      if (u >= 1) continue;
      ctx.globalAlpha = 1;
      ctx.fillStyle = col.bg; ctx.fillRect(x, i * bh, w, bh + 1);
      var seam = step(t, 1300, 1480);
      if (seam > 0 && i) { ctx.globalAlpha = seam; ctx.fillStyle = col.line; ctx.fillRect(x, i * bh, w, 1); }
      // l'étiquette de la section, sur le bord qui s'ouvre
      var la = step(t, 1350, 1550) * (1 - step(t, 2100 + i * 70, 2350 + i * 70));
      if (la > 0) {
        ctx.globalAlpha = la; ctx.fillStyle = col.muted; ctx.font = '500 11px ' + col.mono;
        ctx.textAlign = dir < 0 ? 'right' : 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(labels[i] || '', dir < 0 ? x + w - 22 : x + 22, i * bh + bh / 2);
      }
    }
    ctx.textBaseline = 'alphabetic';
    // 2. Le nom, lettre à lettre (il s'efface quand le rideau s'ouvre).
    var fade = 1 - step(t, 1350, 1650);
    if (fade > 0) {
      ctx.font = '700 ' + Math.round(big) + 'px ' + col.disp; ctx.textAlign = 'left';
      var total = ctx.measureText(NAME).width, x0 = w / 2 - total / 2 - big * 0.14, xx = x0;
      for (var k = 0; k < NAME.length; k++) {
        var ch = NAME[k], cw = ctx.measureText(ch).width, a = ease(step(t, 60 + k * 45, 420 + k * 45));
        ctx.globalAlpha = a * fade; ctx.fillStyle = col.ink;
        ctx.fillText(ch, xx, cy + (1 - a) * big * 0.35);
        xx += cw;
      }
      ctx.globalAlpha = step(t, 360, 900) * fade; ctx.fillStyle = col.muted; ctx.textAlign = 'center';
      ctx.font = '500 ' + (w < 560 ? 10 : 12) + 'px ' + col.mono;
      ctx.fillText(ROLE, w / 2, cy + big * 0.55);
      // compteurs qui roulent
      var gap = Math.min(w / 3.2, 150), ry = cy + big * 0.55 + 70;
      COUNTERS.forEach(function (c, i) {
        var x = w / 2 + (i - 1) * gap, appear = ease(step(t, 520 + i * 90, 820 + i * 90)), value = c[0] * ease(step(t, 600, 1250));
        var row = Math.floor(value), frac = value - row;
        ctx.globalAlpha = appear * fade; ctx.fillStyle = col.muted; ctx.font = '500 11px ' + col.mono; ctx.fillText(c[1], x, ry + 26);
        ctx.fillStyle = col.ink; ctx.save(); ctx.beginPath(); ctx.rect(x - 40, ry - 26, 80, 34); ctx.clip();
        ctx.font = '600 26px ' + col.mono;
        for (var j = 0; j < 2; j++) ctx.fillText(String(Math.min(c[0], row + j)).padStart(2, '0'), x, ry - (frac - j) * 34);
        ctx.restore();
      });
      // le point du nom, qui apparaît après la dernière lettre
      xx += big * 0.05;
      var pd = ease(step(t, 640, 900));
      var from = { x: xx + big * 0.09, y: cy - big * 0.04, s: big * 0.09 };
      ctx.globalAlpha = 1; ctx.fillStyle = col.acc;
      if (t < 1550) { ctx.beginPath(); ctx.arc(from.x, from.y, from.s * pd, 0, Math.PI * 2); ctx.fill(); }
      scene.from = from;
    }
    // 3. Le point rejoint celui du nom dans la colonne d'identité.
    if (t >= 1550 && scene.from) {
      var e = ease(step(t, 1550, 2450)), f = scene.from, to = dotTo || { x: f.x, y: f.y, s: 0 };
      ctx.globalAlpha = dotTo ? 1 - step(t, 2450, 2700) : 1 - e; ctx.fillStyle = col.acc; ctx.beginPath();
      ctx.arc(mix(f.x, to.x, e), mix(f.y, to.y, e) - Math.sin(e * Math.PI) * h * 0.08, mix(f.s, to.s, e), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  var ac = new AbortController(), frame = 0, timer = 0, done = false;
  function end() {
    if (done) return; done = true;
    cancelAnimationFrame(frame); clearTimeout(timer); ac.abort();
    canvas.remove(); root.classList.remove('intro', 'intro-on');
  }
  function hold(e) { if (e.cancelable) e.preventDefault(); e.stopImmediatePropagation(); }
  ['click', 'pointerdown', 'mousedown', 'keydown', 'wheel', 'touchstart', 'touchmove'].forEach(function (k) {
    addEventListener(k, hold, { capture: true, passive: false, signal: ac.signal });
  });
  addEventListener('resize', measure, { signal: ac.signal });

  measure();
  var duration = reduce ? 200 : LENGTH, start = performance.now();
  function draw(now) {
    var t = Math.max(0, now - start) / (reduce ? 1 : slow);
    if (t >= duration) return end();
    ctx.clearRect(0, 0, w, h);
    if (reduce) { ctx.globalAlpha = 1 - t / 200; ctx.fillStyle = col.bg; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
    else scene(t);
    frame = requestAnimationFrame(draw);
  }
  draw(start);
  root.classList.add('intro-on');
  timer = setTimeout(end, duration * (reduce ? 1 : slow) + 400);
  // la police du nom arrive parfois après le premier dessin : on remesure dès qu'elle est prête
  if (document.fonts && document.fonts.load) document.fonts.load('700 64px "Space Grotesk"').then(measure, function () {});
})();
