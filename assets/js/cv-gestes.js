/* Navigation aux gestes : la caméra suit les mains (MediaPipe Gesture Recognizer) et assets/js/gestes-engine.js
   traduit leurs mouvements en actions sur le CV.
   Rien n’est chargé avant que le visiteur active le bouton ✋ ; la vidéo est analysée sur l’appareil, rien n’est envoyé.
   L’analyse tourne dans un Web Worker (GPU) pour ne jamais figer la page ; repli sur le fil principal si besoin.
   Dépend de window.cvNav (page) et, s’il est là, de window.cvAgent. Le bouton est l’élément #gestBtn. */
(function () {
  'use strict';
  var btn = document.getElementById('gestBtn');
  if (!btn || !window.GestesEngine) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { var li = btn.closest('li'); if (li) li.hidden = true; }

  var MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  var MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
  var OPTS = { numHands: 2, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5 };
  var LINKS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  var HELP = [
    ['☝️', 'Index levé', 'pointeur — pliez l’index d’un coup sec pour cliquer'],
    ['✊', 'Poing fermé', 'attrapez la page et déplacez-la dans tous les sens'],
    ['🔢', 'Dos de la main vers l’écran, doigts en haut', '1 à {N} doigts (deux mains au-delà de 5) : volet correspondant'],
    ['🪄', 'Tracez un cercle avec l’index', 'Expecto Patronum'],
    ['✌️', 'Victoire, paume vers l’écran', 'thème clair / sombre'],
    ['👍 👎', 'Pouce levé / baissé', 'ouvrir l’assistant / fermer']
  ];
  var MODES = { none: 'Montrez votre main', hand: '✋ Main détectée', pointer: '☝️ Pointeur', grab: '✊ Page attrapée', count: '🔢 Dos de la main' };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var css = document.createElement('style');
  css.textContent = [
    '.gst-hud{position:fixed;right:16px;bottom:calc(var(--foot,30px) + 14px);z-index:9000;width:250px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.18);font:13px/1.45 var(--ff-body,var(--ff-b,Inter,system-ui,sans-serif));overflow:hidden}',
    '.gst-cam{position:relative;aspect-ratio:16/9;background:#000}.gst-cam video,.gst-cam canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}',
    '.gst-cam video{opacity:.7}.gst-n{position:absolute;right:8px;top:8px;min-width:42px;height:42px;border-radius:50%;display:none;place-items:center;font:700 22px var(--ff-display,var(--ff-d,system-ui,sans-serif));color:#fff;',
    'background:conic-gradient(#3b82f6 calc(var(--p,0)*1turn),rgba(255,255,255,.18) 0);box-shadow:inset 0 0 0 4px rgba(0,0,0,.55)}.gst-n.on{display:grid}',
    '.gst-bar{display:flex;align-items:center;gap:8px;padding:8px 10px}.gst-st{flex:1;min-width:0;height:20px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.gst-bar button{width:30px;height:30px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;color:var(--muted)}',
    '.gst-bar button:hover{border-color:var(--accent);color:var(--accent)}.gst-help{border-top:1px solid var(--line);padding:8px 10px 10px;display:grid;gap:6px}',
    '.gst-help[hidden]{display:none}.gst-help div{display:grid;grid-template-columns:30px 1fr;gap:6px;align-items:start}.gst-help small{display:block;color:var(--muted);font-size:11.5px;line-height:1.35}',
    '.gst-help p{color:var(--muted);font-size:11.5px;margin-top:2px}',
    '.gst-cur{position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2.5px solid var(--accent);z-index:2147483000;pointer-events:none;display:none;',
    'background:color-mix(in srgb,var(--accent) calc(var(--p,0)*70% + 12%),transparent);place-items:center;color:var(--accent);font-size:15px;will-change:transform}',
    '.gst-cur.on{display:grid}.gst-cur.grab{width:46px;height:46px;margin:-23px 0 0 -23px;border-style:dashed;background:color-mix(in srgb,var(--accent) 18%,transparent)}',
    '.gst-ring{position:fixed;width:60px;height:60px;margin:-30px 0 0 -30px;border-radius:50%;border:2px solid var(--accent);z-index:2147483000;pointer-events:none;animation:gstRing .45s ease-out forwards}',
    '@keyframes gstRing{from{transform:scale(.3);opacity:1}to{transform:scale(1.3);opacity:0}}',
    '.gst-toast{position:fixed;left:50%;bottom:calc(var(--foot,30px) + 18px);transform:translateX(-50%) translateY(12px);opacity:0;z-index:9001;background:var(--ink);color:var(--bg);',
    'padding:8px 16px;border-radius:30px;font:600 14px var(--ff-body,var(--ff-b,Inter,system-ui,sans-serif));transition:opacity .25s,transform .25s;pointer-events:none}.gst-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}',
    // sortilège : voile, incantation et lettres de code
    '.gst-veil{position:fixed;inset:0;z-index:2147481999;pointer-events:none;opacity:0;transition:opacity .45s ease;background:radial-gradient(ellipse at 50% 55%,rgba(10,24,48,.78),rgba(3,7,16,.93))}',
    '.gst-veil.on{opacity:1}.gst-fx{position:fixed;inset:0;width:100vw;height:100vh;z-index:2147482000;pointer-events:none}',
    '.gst-incant{position:fixed;left:0;right:0;top:15vh;text-align:center;z-index:2147482001;pointer-events:none;font:600 clamp(22px,4.2vw,52px)/1.1 var(--ff-mono,var(--ff-m,monospace));',
    'letter-spacing:.06em;color:#dff3ff;text-shadow:0 0 18px rgba(120,190,255,.85),0 0 2px #fff;opacity:0;transition:opacity .35s}.gst-incant.on{opacity:1}',
    // bulle de bande dessinée
    '.gst-comic{position:fixed;left:50%;top:46%;z-index:2147482002;pointer-events:none;width:min(440px,86vw);aspect-ratio:1.25;display:grid;place-items:center;text-align:center;',
    'transform:translate(-50%,-50%) rotate(-5deg) scale(0);animation:gstPop 2.6s cubic-bezier(.2,1.6,.4,1) forwards;filter:drop-shadow(6px 8px 0 #16140f)}',
    '.gst-comic::before{content:"";position:absolute;inset:0;background:#ffd23a radial-gradient(#f4a300 1.6px,transparent 1.8px) 0 0/11px 11px;',
    'clip-path:polygon(50% 0,58% 14%,72% 3%,74% 19%,92% 12%,86% 30%,100% 36%,88% 49%,100% 63%,84% 68%,90% 86%,72% 80%,66% 98%,54% 85%,42% 100%,36% 83%,18% 92%,20% 74%,2% 70%,13% 56%,0 42%,15% 34%,6% 16%,26% 20%,30% 3%,42% 15%)}',
    '.gst-comic div{position:relative;font-family:var(--ff-display,var(--ff-d,system-ui,sans-serif));color:#16140f;transform:rotate(2deg)}',
    '.gst-comic b{display:block;font-size:clamp(38px,8vw,64px);font-weight:700;letter-spacing:.02em;color:#e4482a;-webkit-text-stroke:2px #16140f;text-transform:uppercase}',
    '.gst-comic span{display:block;font-size:clamp(17px,3.4vw,24px);font-weight:700;margin-top:4px}.gst-comic small{display:block;font-size:clamp(12px,2.4vw,15px);font-weight:600;margin-top:6px}',
    '@keyframes gstPop{0%{transform:translate(-50%,-50%) rotate(-5deg) scale(0)}12%{transform:translate(-50%,-50%) rotate(-5deg) scale(1.08)}18%{transform:translate(-50%,-50%) rotate(-3deg) scale(1)}',
    '24%{transform:translate(-51%,-50%) rotate(-6deg) scale(1)}30%{transform:translate(-49%,-50%) rotate(-4deg) scale(1)}86%{transform:translate(-50%,-50%) rotate(-5deg) scale(1);opacity:1}100%{transform:translate(-50%,-50%) rotate(-5deg) scale(.6);opacity:0}}',
    '#gestBtn[aria-pressed="true"]{color:var(--accent);border-color:var(--accent)}',
    '@media (max-width:760px){.gst-hud{left:10px;right:10px;width:auto;bottom:calc(10px + env(safe-area-inset-bottom,0px));height:66px;display:flex;align-items:center;border-radius:14px}',
    '.gst-cam{flex:none;width:96px;height:54px;aspect-ratio:auto;margin-left:6px;border-radius:9px;overflow:hidden}.gst-bar{flex:1;min-width:0;padding:0 8px}',
    '.gst-n{min-width:30px;height:30px;font-size:15px;right:3px;top:3px}',
    '.gst-help{position:fixed;left:10px;right:10px;bottom:calc(84px + env(safe-area-inset-bottom,0px));max-height:46vh;overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.25)}}',
    '@media print{.gst-hud,.gst-cur,.gst-toast,.gst-fx,.gst-veil,.gst-incant,.gst-comic{display:none!important}}'
  ].join('');
  document.head.appendChild(css);

  var hud, video, canvas, ctx, status, help, badge, cursor, toast, toastT;
  var stream = null, running = false, starting = false, raf = 0, lastVideoT = -1, hoverEl = null;
  var worker = null, workerBusy = false, mainRec = null;
  // nombre de volets / sections et leurs noms : fournis par la page (window.cvNav), 6 volets par défaut
  var engine = new window.GestesEngine({ onAction: act, pages: (window.cvNav && window.cvNav.count) || 6 });

  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }

  function buildUi() {
    if (hud) return;
    hud = el('div', 'gst-hud'); hud.setAttribute('role', 'region'); hud.setAttribute('aria-label', 'Navigation aux gestes');
    var cam = el('div', 'gst-cam'); video = el('video'); video.muted = true; video.playsInline = true; video.setAttribute('aria-hidden', 'true');
    canvas = el('canvas'); ctx = canvas.getContext('2d'); badge = el('div', 'gst-n');
    cam.appendChild(video); cam.appendChild(canvas); cam.appendChild(badge);
    var bar = el('div', 'gst-bar');
    status = el('div', 'gst-st'); status.setAttribute('aria-live', 'polite');
    var hb = el('button', '', '?'); hb.type = 'button'; hb.setAttribute('aria-label', 'Afficher les gestes');
    var xb = el('button', '', '<i class="fa-solid fa-xmark" aria-hidden="true"></i>'); xb.type = 'button'; xb.setAttribute('aria-label', 'Couper la caméra');
    bar.appendChild(status); bar.appendChild(hb); bar.appendChild(xb);
    help = el('div', 'gst-help', HELP.map(function (h) { return '<div><span>' + h[0] + '</span><span>' + h[1] + '<small>' + h[2].replace('{N}', engine.o.pages) + '</small></span></div>'; }).join('')
      + '<p>La vidéo est analysée sur votre appareil : rien n’est enregistré ni envoyé.</p>');
    hud.appendChild(cam); hud.appendChild(bar); hud.appendChild(help);
    hb.addEventListener('click', function () { help.hidden = !help.hidden; });
    xb.addEventListener('click', stop);
    cursor = el('div', 'gst-cur'); cursor.setAttribute('aria-hidden', 'true');
    toast = el('div', 'gst-toast'); toast.setAttribute('role', 'status');
    document.body.appendChild(hud); document.body.appendChild(cursor); document.body.appendChild(toast);
  }

  function say(text) { if (status) status.innerHTML = text; }
  function flash(text) {
    if (!toast) { buildUi(); hud.hidden = true; }
    toast.textContent = text; toast.classList.add('on'); clearTimeout(toastT);
    toastT = setTimeout(function () { toast.classList.remove('on'); }, 1400);
  }

  // ------------------------------------------------------------------ analyse dans un worker (classique : MediaPipe utilise importScripts)
  var WORKER_SRC = [
    'var rec = null;',
    'self.exports = {}; self.module = { exports: self.exports };',
    // les traces internes de MediaPipe (I1124…, W1124…, « Graph successfully… ») ne doivent pas encombrer la console
    'var NOISE = /^(?:[IWE]\\d{4} |INFO:|Graph successfully|Created TensorFlow)/;',
    "['log', 'info', 'warn', 'error', 'debug'].forEach(function (k) { var f = console[k]; console[k] = function (m) { if (NOISE.test(String(m))) return; f.apply(console, arguments); }; });",
    'self.onmessage = function (e) {',
    '  var m = e.data;',
    "  if (m.type === 'init') {",
    '    fetch(m.mp + "/vision_bundle.cjs").then(function (r) { return r.text(); }).then(function (code) {',
    "      importScripts(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));",
    '      var v = self.module.exports;',
    '      return v.FilesetResolver.forVisionTasks(m.mp + "/wasm").then(function (files) {',
    '        var make = function (d) { return v.GestureRecognizer.createFromOptions(files, Object.assign({ baseOptions: { modelAssetPath: m.model, delegate: d }, runningMode: "VIDEO" }, m.opts)); };',
    '        return make("GPU").catch(function () { return make("CPU"); });',
    '      });',
    "    }).then(function (r) { rec = r; self.postMessage({ type: 'ready' }); })",
    "      .catch(function (err) { self.postMessage({ type: 'fail', message: String(err && err.message || err) }); });",
    "  } else if (m.type === 'frame') {",
    '    var res = null;',
    '    try { res = rec.recognizeForVideo(m.bitmap, m.t); } catch (err) { res = null; }',
    '    m.bitmap.close();',
    '    var hands = !res ? [] : res.landmarks.map(function (lm, i) {',
    '      var g = res.gestures[i] && res.gestures[i][0], hd = res.handedness[i] && res.handedness[i][0];',
    '      return { lm: lm, world: res.worldLandmarks[i], handed: hd ? hd.categoryName : "Right", gesture: g ? g.categoryName : "None", gscore: g ? g.score : 0 };',
    '    });',
    "    self.postMessage({ type: 'result', t: m.t, hands: hands });",
    '  }',
    '};'
  ].join('\n');

  function startWorker() {
    return new Promise(function (resolve, reject) {
      var w;
      try { w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))); } catch (e) { reject(e); return; }
      var timer = setTimeout(function () { w.terminate(); reject(new Error('délai dépassé')); }, 60000);
      w.onmessage = function (e) {
        if (e.data.type === 'ready') { clearTimeout(timer); w.onmessage = onWorker; resolve(w); }
        else if (e.data.type === 'fail') { clearTimeout(timer); w.terminate(); reject(new Error(e.data.message)); }
      };
      w.onerror = function (e) { e.preventDefault(); clearTimeout(timer); w.terminate(); reject(new Error('worker')); };
      w.postMessage({ type: 'init', mp: MP, model: MODEL, opts: OPTS });
    });
  }

  async function startMain() {          // repli : même modèle sur le fil principal
    var vision = await import(MP + '/vision_bundle.mjs');
    var files = await vision.FilesetResolver.forVisionTasks(MP + '/wasm');
    var make = function (d) { return vision.GestureRecognizer.createFromOptions(files, Object.assign({ baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: 'VIDEO' }, OPTS)); };
    try { return await make('GPU'); } catch (e) { return await make('CPU'); }
  }

  function onWorker(e) {
    if (e.data.type !== 'result') return;
    workerBusy = false;
    if (!running) return;
    draw(e.data.hands);
    engine.frame({ t: e.data.t, hands: e.data.hands });
  }

  async function start() {
    if (running || starting) return;
    starting = true; buildUi(); hud.hidden = false;
    try { help.hidden = localStorage.getItem('gestes.vu') === '1'; localStorage.setItem('gestes.vu', '1'); } catch (e) { help.hidden = false; }
    btn.setAttribute('aria-pressed', 'true');
    say('Autorisez la caméra…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
    } catch (e) {
      starting = false; say('<b>Caméra indisponible.</b> Autorisez-la dans le navigateur pour naviguer aux gestes.'); btn.setAttribute('aria-pressed', 'false');
      return;
    }
    video.srcObject = stream;
    try { await video.play(); } catch (e) {}
    if (!worker && !mainRec) {
      say('Chargement du modèle de la main (≈ 18 Mo la première fois)…');
      try { worker = await startWorker(); } catch (e) {
        try { mainRec = await startMain(); } catch (e2) {
          starting = false; stopStream(); say('<b>Le modèle n’a pas pu être chargé.</b> Vérifiez la connexion et réessayez.'); btn.setAttribute('aria-pressed', 'false');
          return;
        }
      }
    }
    if (!stream) { starting = false; return; }      // coupé pendant le chargement
    starting = false; running = true; workerBusy = false; engine.reset(); say(MODES.none);
    raf = requestAnimationFrame(loop);
  }

  function stopStream() { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; if (video) video.srcObject = null; }

  function stop() {
    running = false; starting = false; cancelAnimationFrame(raf); stopStream();
    if (hud) hud.hidden = true; if (cursor) cursor.classList.remove('on', 'grab');
    btn.setAttribute('aria-pressed', 'false'); engine.reset();
  }

  // chaque nouvelle image de la caméra part à l’analyse dès que la précédente est traitée
  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden || video.readyState < 2 || video.currentTime === lastVideoT) return;
    if (worker) {
      if (workerBusy) return;
      lastVideoT = video.currentTime; workerBusy = true;
      createImageBitmap(video).then(function (bmp) {
        if (!running) { bmp.close(); workerBusy = false; return; }
        worker.postMessage({ type: 'frame', bitmap: bmp, t: performance.now() }, [bmp]);
      }, function () { workerBusy = false; });
    } else if (mainRec) {
      lastVideoT = video.currentTime;
      var res;
      try { res = mainRec.recognizeForVideo(video, now); } catch (e) { return; }
      var hands = (res.landmarks || []).map(function (lm, i) {
        var g = res.gestures[i] && res.gestures[i][0], hd = res.handedness[i] && res.handedness[i][0];
        return { lm: lm, world: res.worldLandmarks[i], handed: hd ? hd.categoryName : 'Right', gesture: g ? g.categoryName : 'None', gscore: g ? g.score : 0 };
      });
      draw(hands);
      engine.frame({ t: now, hands: hands });
    }
  }

  function draw(hands) {
    var w = video.videoWidth, h = video.videoHeight;
    if (!w) return;
    if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e4482a';
    hands.forEach(function (hd) {
      var a = window.GestesEngine.analyse(hd), lm = hd.lm;
      var col = a.side === 'back' ? '#3b82f6' : a.side === 'palm' ? accent : '#d6d3cc';
      ctx.lineWidth = Math.max(2, w / 220); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.fillStyle = col;
      LINKS.forEach(function (l) { ctx.beginPath(); ctx.moveTo(lm[l[0]].x * w, lm[l[0]].y * h); ctx.lineTo(lm[l[1]].x * w, lm[l[1]].y * h); ctx.stroke(); });
      lm.forEach(function (p) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, Math.max(3, w / 150), 0, 7); ctx.fill(); });
      [4, 8, 12, 16, 20].forEach(function (i, k) {   // bouts des doigts tendus soulignés
        if (!a.fingers[k]) return;
        ctx.beginPath(); ctx.arc(lm[i].x * w, lm[i].y * h, Math.max(6, w / 70), 0, 7); ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, w / 260); ctx.stroke();
      });
    });
  }

  // ------------------------------------------------------------------ actions sur la page
  function panelName(i) {
    if (window.cvNav && window.cvNav.name) return window.cvNav.name(i) || '';
    var n = document.querySelectorAll('.pn .tab .t')[i]; return n ? n.textContent : '';
  }

  /** Conteneurs qui défilent sous un point, pour chaque axe (autant de directions que les barres de défilement le permettent). */
  function scrollersAt(x, y) {
    var n = document.elementFromPoint(x, y), sx = null, sy = null, frise = null;
    for (; n && n !== document.documentElement; n = n.parentElement) {
      if (n.id === 'fz') frise = n;
      var cs = getComputedStyle(n);
      if (!sy && /(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 2) sy = n;
      if (!sx && /(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 2) sx = n;
    }
    if (!sy && document.scrollingElement.scrollHeight > innerHeight + 2 && getComputedStyle(document.body).overflowY !== 'hidden') sy = document.scrollingElement;
    // la frise du parcours avance quand son volet défile verticalement : le geste horizontal la pilote aussi
    if (frise && sy && !sx) sx = { frise: sy };
    return { x: sx, y: sy };
  }

  function scrollBoth(t, dxPx, dyPx) {
    if (t.y) t.y.scrollTop += dyPx;
    if (t.x) { if (t.x.frise) t.x.frise.scrollTop += dxPx; else t.x.scrollLeft += dxPx; }
  }

  var flingRaf = 0, grabTargets = null;
  function fling(vx, vy) {
    cancelAnimationFrame(flingRaf);
    var t = grabTargets, last = performance.now();
    if (!t) return;
    (function step(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) return;
      scrollBoth(t, vx * innerWidth * dt, vy * innerHeight * dt);
      var k = Math.pow(0.9, dt * 60); vx *= k; vy *= k;
      flingRaf = requestAnimationFrame(step);
    })(last);
  }

  function fire(target, type, x, y) {
    var Ctor = type.indexOf('pointer') === 0 && window.PointerEvent ? PointerEvent : MouseEvent;
    target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  }

  function place(x, y, scale) { cursor.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)' + (scale ? ' scale(' + scale + ')' : ''); }

  function act(a) {
    var nav = window.cvNav;
    switch (a.type) {
      case 'mode':
        say(MODES[a.mode] || MODES.none);
        cursor.classList.toggle('grab', a.mode === 'grab');
        cursor.innerHTML = a.mode === 'grab' ? '<i class="fa-solid fa-hand-back-fist" aria-hidden="true"></i>' : '';
        if (a.mode !== 'pointer' && a.mode !== 'grab') cursor.classList.remove('on');
        if (a.mode !== 'count') badge.classList.remove('on');
        if (a.mode === 'grab') { cancelAnimationFrame(flingRaf); grabTargets = null; }
        break;
      case 'cursor':
        var x = a.x * innerWidth, y = a.y * innerHeight;
        cursor.classList.add('on'); cursor.style.setProperty('--p', a.press || 0); place(x, y, 1 - 0.35 * (a.press || 0));
        var over = document.elementFromPoint(x, y);
        if (over) { fire(over, 'pointermove', x, y); fire(over, 'mousemove', x, y); }
        if (over !== hoverEl) { if (hoverEl) fire(hoverEl, 'mouseout', x, y); if (over) fire(over, 'mouseover', x, y); hoverEl = over; }
        break;
      case 'click':
        var cx = a.x * innerWidth, cy = a.y * innerHeight, tg = document.elementFromPoint(cx, cy);
        var ring = el('div', 'gst-ring'); ring.style.left = cx + 'px'; ring.style.top = cy + 'px'; document.body.appendChild(ring); setTimeout(function () { ring.remove(); }, 500);
        if (!tg || hud.contains(tg)) break;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (k) { fire(tg, k, cx, cy); });
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) tg.focus(); else fire(tg, 'click', cx, cy);
        break;
      case 'grab':
        var gx = a.x * innerWidth, gy = a.y * innerHeight;
        cursor.classList.add('on'); place(gx, gy);
        if (!grabTargets) grabTargets = scrollersAt(gx, gy);
        if (a.dx || a.dy) scrollBoth(grabTargets, a.dx * innerWidth, a.dy * innerHeight);
        break;
      case 'fling': fling(a.vx, a.vy); break;
      case 'count':
        badge.classList.toggle('on', a.n > 0); badge.textContent = a.n; badge.style.setProperty('--p', a.progress);
        say(a.n >= 1 && a.n <= engine.o.pages ? '🔢 ' + a.n + ' → ' + panelName(a.n - 1) : MODES.count);
        break;
      case 'page': if (nav) { nav.open(a.n - 1); flash(a.n + ' · ' + panelName(a.n - 1)); } break;
      case 'spell': patronus(a.x * innerWidth, a.y * innerHeight); break;
      case 'insult': comic(); break;
      case 'theme': if (nav) { nav.theme(); flash('✌️ Thème ' + (document.documentElement.getAttribute('data-theme') === 'dark' ? 'sombre' : 'clair')); } break;
      case 'assistant': if (window.cvAgent) { window.cvAgent.open(); flash('👍 Assistant'); } break;
      case 'close':
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        document.querySelectorAll('dialog[open]').forEach(function (d) { try { d.close(); } catch (e) {} });
        if (window.cvAgent && window.cvAgent.close) window.cvAgent.close();
        flash('👎 Fermé');
        break;
    }
  }

  // ------------------------------------------------------------------ doigt d’honneur : bulle de BD
  var comicOn = false;
  function comic() {
    if (comicOn) return; comicOn = true;
    var c = el('div', 'gst-comic', '<div><b>Hé&nbsp;!</b><span>C’est pas gentil, ça&nbsp;😤</span><small>On se serre plutôt la main&nbsp;? 🤝</small></div>');
    c.setAttribute('role', 'status');
    if (reduce) c.style.animation = 'none', c.style.transform = 'translate(-50%,-50%) rotate(-5deg)';
    document.body.appendChild(c);
    setTimeout(function () { c.remove(); comicOn = false; }, 2650);
  }

  // ------------------------------------------------------------------ Expecto Patronum : un cerf écrit en code
  var CODE = 'const patronus = invoquer({ forme: "cerf", lumière: 1.0, garde: true }); patronus.galoper(écran); ';
  var NOISE_CH = '01<>{}[]()/=+*;:#$%&@λΣΔ∂∫≈≠→⇒|~^!?';
  var spelling = false, atlas = null, stagCells = null;

  function buildAtlas(fontPx) {
    var chars = Array.from(new Set((CODE + NOISE_CH).split(''))), cw = Math.ceil(fontPx * 0.62) + 8, ch = fontPx + 10;
    var c = document.createElement('canvas'); c.width = cw * chars.length; c.height = ch * 2;
    var g = c.getContext('2d'); g.textBaseline = 'middle'; g.textAlign = 'center';
    g.font = '600 ' + fontPx + 'px "JetBrains Mono", ui-monospace, monospace';
    var idx = {};
    chars.forEach(function (k, i) {
      idx[k] = i;
      g.shadowColor = 'rgba(110,190,255,.95)'; g.shadowBlur = 7;
      g.fillStyle = '#e6f6ff'; g.fillText(k, i * cw + cw / 2, ch / 2);           // ligne 0 : lettre fixée, lumineuse
      g.shadowBlur = 4; g.fillStyle = '#7fc4ff'; g.fillText(k, i * cw + cw / 2, ch + ch / 2);  // ligne 1 : lettre qui s’écrit
    });
    return { c: c, cw: cw, ch: ch, idx: idx };
  }

  function stagShape() {
    var c = document.createElement('canvas'); c.width = 320; c.height = 260;
    var g = c.getContext('2d'); g.fillStyle = g.strokeStyle = '#fff'; g.lineCap = g.lineJoin = 'round';
    g.beginPath(); g.ellipse(150, 140, 78, 36, -0.05, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(198, 116); g.lineTo(222, 62); g.lineTo(242, 64); g.lineTo(234, 128); g.lineTo(212, 152); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(246, 64, 22, 12, 0.35, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(264, 75, 10, 7, 0.4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(234, 56); g.lineTo(220, 44); g.lineTo(240, 50); g.closePath(); g.fill();
    g.lineWidth = 7; g.beginPath();
    g.moveTo(238, 54); g.quadraticCurveTo(228, 30, 212, 14); g.moveTo(228, 34); g.lineTo(208, 32); g.moveTo(221, 23); g.lineTo(228, 6);
    g.moveTo(248, 52); g.quadraticCurveTo(254, 28, 274, 14); g.moveTo(256, 33); g.lineTo(276, 32); g.moveTo(264, 22); g.lineTo(260, 4); g.stroke();
    g.lineWidth = 12; g.beginPath();
    g.moveTo(205, 158); g.lineTo(216, 204); g.lineTo(210, 248); g.moveTo(188, 165); g.lineTo(182, 208); g.lineTo(192, 248);
    g.moveTo(102, 160); g.lineTo(86, 200); g.lineTo(94, 248); g.moveTo(120, 166); g.lineTo(124, 206); g.lineTo(114, 248);
    g.moveTo(76, 128); g.lineTo(60, 114); g.stroke();
    return g.getImageData(0, 0, 320, 260).data;
  }

  function cells(scale, cw, ch) {
    var d = stagShape(), out = [], k = 0;
    for (var y = 0; y * ch < 260 * scale; y++) for (var x = 0; x * cw < 320 * scale; x++) {
      var sx = Math.floor((x * cw + cw / 2) / scale), sy = Math.floor((y * ch + ch / 2) / scale);
      if (sx < 320 && sy < 260 && d[(sy * 320 + sx) * 4 + 3] > 128) out.push({ x: x * cw - 160 * scale, y: y * ch - 130 * scale, ch: CODE[k++ % CODE.length] });
    }
    return out;
  }

  function hash(i, s) { var x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); }
  function smooth(k) { k = k < 0 ? 0 : k > 1 ? 1 : k; return k * k * (3 - 2 * k); }
  function outCubic(k) { k = k < 0 ? 0 : k > 1 ? 1 : k; return 1 - Math.pow(1 - k, 3); }

  function patronus(ox, oy) {
    if (spelling) return; spelling = true;
    var W = innerWidth, H = innerHeight, dpr = Math.min(1.5, window.devicePixelRatio || 1);
    var veil = el('div', 'gst-veil'), title = el('div', 'gst-incant'), fx = el('canvas', 'gst-fx');
    document.body.appendChild(veil); document.body.appendChild(fx); document.body.appendChild(title);
    requestAnimationFrame(function () { veil.classList.add('on'); title.classList.add('on'); });
    var words = 'Expecto Patronum', t0 = performance.now();
    // incantation qui se « décode » lettre à lettre
    var titleTimer = setInterval(function () {
      var k = (performance.now() - t0) / 900, n = Math.floor(k * words.length);
      title.textContent = words.split('').map(function (c, i) { return i < n || c === ' ' ? c : NOISE_CH[Math.floor(Math.random() * NOISE_CH.length)]; }).join('');
      if (k >= 1) { clearInterval(titleTimer); title.textContent = words; }
    }, 45);
    var end = function () { clearInterval(titleTimer); veil.classList.remove('on'); title.classList.remove('on'); setTimeout(function () { veil.remove(); title.remove(); fx.remove(); spelling = false; }, 500); };
    if (reduce) { setTimeout(end, 1600); return; }

    fx.width = Math.round(W * dpr); fx.height = Math.round(H * dpr);
    var g = fx.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var fontPx = W < 700 ? 9 : 11;
    if (!atlas || atlas.font !== fontPx) { atlas = buildAtlas(fontPx); atlas.font = fontPx; stagCells = null; }
    var scale = Math.min(W * 0.4, 560) / 320, cw = Math.round(fontPx * 0.7), chh = Math.round(fontPx * 1.15);
    if (!stagCells || stagCells.scale !== scale) { stagCells = cells(scale, cw, chh); stagCells.scale = scale; }
    var list = stagCells, n = list.length, A = atlas;
    var S0 = { x: W * 0.3, y: H * 0.56 }, S1x = W * 1.25;
    // chaque lettre part de la baguette, avec un départ échelonné selon sa distance
    var meta = list.map(function (c, i) {
      var tx = S0.x + c.x, ty = S0.y + c.y, d = Math.hypot(tx - ox, ty - oy);
      return { start: 120 + d * 0.55 + hash(i, 1) * 260, bend: (hash(i, 2) - 0.5) * 260, flick: hash(i, 3) * 1400 };
    });
    var trail = [], lastTrail = 0, T = 4400;
    var xs = list.map(function (c) { return c.x; }), minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);

    function glyph(chr, row, x, y, alpha) {
      var i = A.idx[chr]; if (i === undefined || alpha <= 0.01) return;
      g.globalAlpha = alpha > 1 ? 1 : alpha;
      g.drawImage(A.c, i * A.cw, row * A.ch, A.cw, A.ch, x - A.cw / 2, y - A.ch / 2, A.cw, A.ch);
    }
    function noise(i, t) { return NOISE_CH[Math.floor(hash(i, Math.floor(t / 55)) * NOISE_CH.length)]; }

    (function frame(now) {
      var t = now - t0;
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      var run = smooth((t - 1900) / 2100);                                           // galop
      var sx = S0.x + run * (S1x - S0.x), sy = S0.y - Math.abs(Math.sin(t / 140)) * 12 * (t > 1900 ? 1 : 0);
      for (var i = 0; i < n; i++) {
        var c = list[i], m = meta[i], k = (t - m.start) / 650;
        if (k <= 0) continue;
        var x, y, chr, row, alpha;
        if (k < 1) {                                                                  // la lettre vole vers sa place en s’écrivant
          var e = outCubic(k), tx = S0.x + c.x, ty = S0.y + c.y, mx = (ox + tx) / 2 + m.bend, my = (oy + ty) / 2 - Math.abs(m.bend) * 0.6;
          x = (1 - e) * (1 - e) * ox + 2 * (1 - e) * e * mx + e * e * tx; y = (1 - e) * (1 - e) * oy + 2 * (1 - e) * e * my + e * e * ty;
          chr = noise(i, t); row = 1; alpha = 0.25 + k * 0.75;
        } else {
          x = sx + c.x; y = sy + c.y;
          var locked = k > 1.25, flick = ((t + m.flick) % 1400) < 90;                // la lettre se fige, puis scintille parfois
          chr = locked && !flick ? c.ch : noise(i, t); row = locked && !flick ? 0 : 1; alpha = 1;
        }
        // dissolution de la queue vers la tête
        var dz = (t - 3500 - ((c.x - minX) / ((maxX - minX) || 1)) * 450) / 380;
        if (dz > 0) { chr = noise(i, t); row = 1; alpha *= 1 - dz; y -= dz * 14; }
        glyph(chr, row, x, y, alpha);
      }
      if (t > 1900 && t < 3700 && now - lastTrail > 30) {                           // pluie de code derrière le cerf
        lastTrail = now;
        for (var j = 0; j < 3; j++) { var src = list[Math.floor(Math.random() * n)]; trail.push({ x: sx + src.x, y: sy + src.y, born: t, i: Math.floor(Math.random() * 999) }); }
      }
      trail = trail.filter(function (q) { return t - q.born < 700; });
      trail.forEach(function (q) { var a = 1 - (t - q.born) / 700; glyph(noise(q.i, t), 1, q.x - (t - q.born) * 0.05, q.y + (t - q.born) * 0.06, a * 0.6); });
      g.globalAlpha = 1;
      if (t < T) requestAnimationFrame(frame); else end();
    })(t0);
  }

  btn.addEventListener('click', function () { if (running || starting) stop(); else start(); });
  window.cvGestes = {
    start: start, stop: stop, engine: engine,
    spell: function (x, y) { patronus(x == null ? innerWidth / 2 : x, y == null ? innerHeight / 2 : y); },
    comic: comic
  };
})();
