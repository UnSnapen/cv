/* Agent du CV : conversation, orientation du visiteur et prise de rendez-vous.
   Usage : <script src="assets/js/cv-agent.js" data-site="nabil" data-first="Nabil" data-api="https://…" defer></script>
   API : window.cvAgent.open() · .close() · .book() · .ask("question")
   Partagé par les CV de Nabil et de Kenza ; les couleurs viennent des variables CSS de chaque page. */
(function () {
  'use strict';
  var script = document.currentScript;
  var SITE = script.getAttribute('data-site');
  var FIRST = script.getAttribute('data-first') || '';
  var API = script.getAttribute('data-api') || (window.PORTFOLIO_INSIGHTS && window.PORTFOLIO_INSIGHTS.apiBase) || '';
  // Tests en local uniquement : ?agentApi=http://127.0.0.1:8787
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) API = new URLSearchParams(location.search).get('agentApi') || API;
  var PRIVACY = script.getAttribute('data-privacy') || 'confidentialite.html';
  var LAUNCHER = script.getAttribute('data-launcher') || 'always'; // always | mobile
  var SUGGEST = (script.getAttribute('data-suggestions') || 'Est-il disponible ?|Ses projets phares ?|Son stack technique ?').split('|');
  if (!SITE || !API) return;

  var css = '.cva{--a:var(--accent-ink,var(--accent,#c63f22));--bg2:var(--surface,#fff);--fg:var(--ink,#16140f);--mu:var(--muted,#6b655a);--ln:var(--line,#ddd8cd);--pg:var(--bg,#f7f5f0);font-family:var(--ff-body,var(--ff-b,system-ui,sans-serif))}' +
    '.cva-launch{position:fixed;right:20px;bottom:20px;z-index:2600;display:inline-flex;align-items:center;gap:.55rem;min-height:48px;padding:.75rem 1.15rem;border-radius:40px;border:0;background:var(--fg);color:var(--pg);font:500 .84rem var(--ff-mono,var(--ff-m,monospace));cursor:pointer;box-shadow:0 12px 32px rgba(0,0,0,.22);transition:transform .2s}' +
    '.cva-launch:hover{transform:translateY(-2px)}.cva-launch i{font-size:1rem}' +
    (LAUNCHER === 'mobile' ? '@media (min-width:901px){.cva-launch{display:none}}' : '') +
    '.cva.open .cva-launch{display:none}' +
    '.cva-panel{position:fixed;right:16px;bottom:16px;z-index:2601;width:min(400px,calc(100vw - 24px));height:min(620px,calc(100dvh - 32px));display:flex;flex-direction:column;background:var(--bg2);color:var(--fg);border:1px solid var(--ln);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.3);overflow:hidden;opacity:0;transform:translateY(16px) scale(.98);pointer-events:none;transition:opacity .25s,transform .3s cubic-bezier(.22,1,.36,1)}' +
    '.cva.open .cva-panel{opacity:1;transform:none;pointer-events:auto}' +
    '.cva-head{display:flex;align-items:center;gap:.75rem;padding:.85rem 1rem;border-bottom:1px solid var(--ln)}' +
    '.cva-ava{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--fg);color:var(--pg);font:700 .95rem var(--ff-display,var(--ff-d,sans-serif))}' +
    '.cva-head b{display:block;font:600 .95rem var(--ff-display,var(--ff-d,sans-serif))}.cva-head small{font:.72rem var(--ff-mono,var(--ff-m,monospace));color:var(--mu);display:flex;align-items:center;gap:.4rem}' +
    '.cva-head small i{width:7px;height:7px;border-radius:50%;background:#19b36b;display:inline-block}' +
    '.cva-x{margin-left:auto;width:44px;height:44px;border:0;background:none;color:var(--fg);font-size:1.25rem;cursor:pointer;border-radius:10px}.cva-x:hover{color:var(--a)}' +
    '.cva-msgs{flex:1;overflow:auto;padding:1rem;display:flex;flex-direction:column;gap:.65rem;scrollbar-width:thin}' +
    '.cva-m{max-width:88%;padding:.6rem .8rem;border-radius:14px;font-size:.9rem;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
    '.cva-m.bot{background:var(--pg);border:1px solid var(--ln);border-bottom-left-radius:4px;align-self:flex-start}' +
    '.cva-m.me{background:var(--fg);color:var(--pg);border-bottom-right-radius:4px;align-self:flex-end}' +
    '.cva-row{display:flex;flex-wrap:wrap;gap:.4rem;align-self:flex-start;max-width:100%}' +
    '.cva-chip{min-height:36px;padding:.4rem .75rem;border-radius:40px;border:1px solid var(--ln);background:var(--bg2);color:var(--fg);font:.78rem var(--ff-mono,var(--ff-m,monospace));cursor:pointer}' +
    '.cva-chip:hover,.cva-chip:focus-visible{border-color:var(--a);color:var(--a)}.cva-chip.pri{background:var(--fg);color:var(--pg);border-color:var(--fg)}' +
    '.cva-slots{display:flex;flex-direction:column;gap:.5rem;align-self:stretch}.cva-day{font:.72rem var(--ff-mono,var(--ff-m,monospace));color:var(--mu);margin-top:.2rem}.cva-day::first-letter{text-transform:uppercase}' +
    '.cva-typing{align-self:flex-start;display:flex;gap:4px;padding:.7rem .8rem}.cva-typing span{width:6px;height:6px;border-radius:50%;background:var(--mu);animation:cvab 1s infinite}.cva-typing span:nth-child(2){animation-delay:.15s}.cva-typing span:nth-child(3){animation-delay:.3s}' +
    '@keyframes cvab{50%{transform:translateY(-4px);opacity:.5}}' +
    '.cva-form{align-self:stretch;border:1px solid var(--ln);border-radius:14px;padding:.85rem;display:flex;flex-direction:column;gap:.55rem;background:var(--bg2)}' +
    '.cva-form b{font:600 .9rem var(--ff-display,var(--ff-d,sans-serif))}.cva-form label{font:.74rem var(--ff-mono,var(--ff-m,monospace));color:var(--mu);display:flex;flex-direction:column;gap:.25rem}' +
    '.cva-form input,.cva-form textarea{font:inherit;font-size:.9rem;color:var(--fg);background:var(--pg);border:1px solid var(--ln);border-radius:10px;padding:.55rem .65rem;min-height:42px}' +
    '.cva-form textarea{min-height:64px;resize:vertical}.cva-form input:focus,.cva-form textarea:focus,.cva-in input:focus{outline:2px solid var(--a);outline-offset:1px}' +
    '.cva-form [aria-invalid=true]{border-color:#c0392b}.cva-err{color:#b3261e;font-size:.76rem}.cva-form .ck{flex-direction:row;align-items:flex-start;gap:.5rem;font-size:.74rem;line-height:1.4}' +
    '.cva-form .ck input{min-height:auto;width:18px;height:18px;margin-top:2px;flex-shrink:0}.cva-form .ck a{color:var(--a)}' +
    '.cva-send{min-height:44px;border:0;border-radius:40px;background:var(--fg);color:var(--pg);font-weight:600;cursor:pointer}.cva-send:hover{background:var(--a);color:#fff}.cva-send[disabled]{opacity:.5;cursor:wait}' +
    '.cva-in{display:flex;gap:.5rem;padding:.7rem .8rem;border-top:1px solid var(--ln)}' +
    '.cva-in input{flex:1;min-width:0;min-height:44px;border:1px solid var(--ln);border-radius:40px;padding:0 1rem;font:inherit;font-size:.9rem;background:var(--pg);color:var(--fg)}' +
    '.cva-in button{width:44px;height:44px;border-radius:50%;border:0;background:var(--fg);color:var(--pg);cursor:pointer;font-size:1rem}' +
    '.cva-note{font:.74rem/1.4 var(--ff-mono,var(--ff-m,monospace));color:var(--mu);padding:0 1rem .7rem}.cva-note a{color:var(--mu)}' +
    '.cva-bar-err{color:#b3261e;font-size:.76rem;padding:0 1rem .3rem}' +
    '.cva-hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;opacity:0}' +
    '.cva-ok a{color:var(--a)}' +
    '@media (max-width:600px){.cva-panel{right:0;bottom:0;width:100vw;height:88dvh;border-radius:18px 18px 0 0}.cva-launch{right:14px;bottom:14px}}' +
    '@media print{.cva{display:none!important}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var root = document.createElement('div');
  root.className = 'cva';
  root.innerHTML =
    '<section class="cva-panel" role="dialog" aria-label="Assistant de ' + esc(FIRST) + '">' +
    '<div class="cva-head"><span class="cva-ava" aria-hidden="true">' + esc(FIRST.charAt(0)) + '</span><div><b>Assistant de ' + esc(FIRST) + '</b><small><i></i>Répond en quelques secondes · IA</small></div>' +
    '<button class="cva-x" type="button" aria-label="Fermer l’assistant">×</button></div>' +
    '<div class="cva-msgs" aria-live="polite"></div>' +
    '<p class="cva-bar-err" role="alert" hidden></p>' +
    '<form class="cva-in" novalidate><label class="cva-hp" aria-hidden="true">Site web<input name="website" tabindex="-1" autocomplete="off"></label>' +
    '<input name="q" maxlength="800" autocomplete="off" placeholder="Posez votre question…" aria-label="Votre question"><button type="submit" aria-label="Envoyer">↑</button></form>' +
    '<p class="cva-note">Réponses générées par IA à partir du CV ; questions conservées 90 jours, sans données personnelles. <a href="' + PRIVACY + '#assistant">En savoir plus</a></p></section>' +
    '<button class="cva-launch" type="button" aria-label="Une question ? Ouvrir l’assistant"><i aria-hidden="true">💬</i><span>Une question ?</span></button>';
  document.body.appendChild(root);

  var panel = root.querySelector('.cva-panel'), msgs = root.querySelector('.cva-msgs'), form = root.querySelector('.cva-in'), input = form.q, barErr = root.querySelector('.cva-bar-err');
  var history = [], greeted = false, busy = false, lastSent = 0, sent = 0, lastFocus = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function scroll() { msgs.scrollTop = msgs.scrollHeight; }
  function add(html, cls) { var d = document.createElement('div'); d.className = cls; d.innerHTML = html; msgs.appendChild(d); scroll(); return d; }
  function say(text, who) { return add(esc(text), 'cva-m ' + (who || 'bot')); }
  function showErr(m) { barErr.textContent = m || ''; barErr.hidden = !m; }
  function typing() { return add('<span></span><span></span><span></span>', 'cva-typing'); }
  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.__status = r.status; return j; }); });
  }
  function go(url) {
    if (url.charAt(0) === '#') { if (window.cvGoTo && window.cvGoTo(url)) { if (window.innerWidth < 900) close(); return; } location.hash = url; return; }
    window.open(url, '_blank', 'noopener');
  }
  function chips(list) {
    var row = add('', 'cva-row');
    list.forEach(function (c) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'cva-chip' + (c.pri ? ' pri' : ''); b.textContent = c.label;
      b.addEventListener('click', c.run); row.appendChild(b);
    });
    return row;
  }
  function greet() {
    if (greeted) return; greeted = true;
    say('Bonjour 👋 Je suis l’assistant de ' + FIRST + '. Posez-moi vos questions sur son parcours, ou réservez directement un échange de 30 minutes.');
    chips(SUGGEST.map(function (q) { return { label: q, run: function () { ask(q); } }; }).concat([{ label: 'Réserver un échange', pri: true, run: function () { book(); } }]));
  }

  function ask(text) {
    text = String(text || '').trim();
    if (busy) return;
    if (text.length < 2) { showErr('Écrivez au moins 2 caractères.'); return; }
    if (text.length > 800) { showErr('800 caractères maximum.'); return; }
    var now = Date.now();
    if (now - lastSent < 1500 || sent >= 30) { showErr('Doucement : réessayez dans quelques secondes.'); return; }
    lastSent = now; sent++; showErr(''); busy = true;
    say(text, 'me'); history.push({ role: 'user', content: text });
    var t = typing();
    post('/api/agent', { site: SITE, messages: history.slice(-12), website: form.website.value })
      .then(function (r) {
        t.remove(); busy = false;
        if (r.__status !== 200 || !r.reply) { fallback(r.error); history.pop(); return; }
        history.push({ role: 'assistant', content: r.reply });
        say(r.reply);
        if (r.links && r.links.length) chips(r.links.map(function (l) { return { label: l.label + ' ↗', run: function () { go(l.url); } }; }));
        if (r.booking) slots(r.slots || []);
      })
      .catch(function () { t.remove(); busy = false; history.pop(); fallback(); });
  }
  function fallback(msg) {
    say((msg && msg.length < 140 ? msg + ' ' : 'L’assistant est momentanément indisponible. ') + 'Vous pouvez écrire à ' + FIRST + ' depuis la section Contact.');
    chips([{ label: 'Aller au contact ↗', run: function () { go('#contact'); } }]);
  }

  function slots(list) {
    if (!list.length) { form_(null); return; }
    var box = add('', 'cva-slots'), day = '';
    var row = null;
    list.forEach(function (s) {
      if (s.day !== day) { day = s.day; var h = document.createElement('div'); h.className = 'cva-day'; h.textContent = s.day; box.appendChild(h); row = document.createElement('div'); row.className = 'cva-row'; box.appendChild(row); }
      var b = document.createElement('button'); b.type = 'button'; b.className = 'cva-chip'; b.textContent = s.time;
      b.setAttribute('aria-label', 'Choisir le ' + s.label);
      b.addEventListener('click', function () { form_(s); }); row.appendChild(b);
    });
    chips([{ label: 'Aucun ne convient : laisser un message', run: function () { form_(null); } }]);
  }
  function book(moment) {
    open();
    if (busy) return;
    busy = true; var t = typing();
    fetch(API + '/api/slots?site=' + encodeURIComponent(SITE) + '&moment=' + encodeURIComponent(moment || 'indifferent'))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (r) { t.remove(); busy = false; say(r.slots && r.slots.length ? 'Voici les prochains créneaux libres de ' + FIRST + ' (heure de Paris). Choisissez celui qui vous convient :' : 'Pas de créneau libre ces prochains jours : laissez un message, ' + FIRST + ' vous recontacte.'); slots(r.slots || []); })
      .catch(function () { t.remove(); busy = false; fallback(); });
  }

  function form_(slot) {
    var firstUser = (history.filter(function (m) { return m.role === 'user'; })[0] || {}).content || '';
    var f = document.createElement('form'); f.className = 'cva-form'; f.noValidate = true;
    var id = 'cvf' + Date.now();
    f.innerHTML = '<b>' + (slot ? 'Échange le ' + esc(slot.label) : 'Laisser un message à ' + esc(FIRST)) + '</b>' +
      field('fullname', 'Nom et prénom *', 'text', 'name') + field('email', 'E-mail professionnel *', 'email', 'email') + field('company', 'Entreprise', 'text', 'organization') +
      field('topic', 'Objet de l’échange *', 'text', 'off', firstUser.slice(0, 120)) +
      '<label for="' + id + 'message">Message (facultatif)<textarea id="' + id + 'message" name="message" maxlength="1000"></textarea></label>' +
      '<label class="cva-hp" aria-hidden="true">Site<input name="website" tabindex="-1" autocomplete="off"></label>' +
      '<label class="ck"><input type="checkbox" name="consent"> <span>J’accepte que ces informations servent uniquement à organiser cet échange (<a href="' + PRIVACY + '#rendez-vous" target="_blank" rel="noopener">confidentialité</a>). *</span></label>' +
      '<span class="cva-err" data-for="consent"></span>' +
      '<button class="cva-send" type="submit">' + (slot ? 'Envoyer la demande de rendez-vous' : 'Envoyer le message') + '</button>';
    function field(name, label, type, ac, value) {
      return '<label for="' + id + name + '">' + label + '<input id="' + id + name + '" name="' + name + '" type="' + type + '" autocomplete="' + ac + '" maxlength="' + (name === 'email' ? 120 : name === 'topic' ? 200 : name === 'company' ? 120 : 80) + '"' +
        (value ? ' value="' + esc(value) + '"' : '') + ' aria-describedby="' + id + name + 'e"></label><span class="cva-err" id="' + id + name + 'e" data-for="' + name + '"></span>';
    }
    msgs.appendChild(f); scroll(); f.fullname.focus();
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = { name: f.fullname.value.trim(), email: f.email.value.trim(), company: f.company.value.trim(), topic: f.topic.value.trim(), message: f.message.value.trim() };
      var errs = {};
      if (v.name.length < 2) errs.fullname = 'Indiquez votre nom.';
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.email)) errs.email = 'Adresse e-mail invalide.';
      if (v.topic.length < 3) errs.topic = 'Précisez l’objet de l’échange.';
      if (!f.consent.checked) errs.consent = 'Cochez la case pour continuer.';
      if (!mark(errs)) return;
      var btn = f.querySelector('.cva-send'); btn.disabled = true; btn.textContent = 'Envoi…';
      var transcript = history.map(function (m) { return (m.role === 'user' ? 'Visiteur : ' : 'Assistant : ') + m.content; }).join('\n').slice(-3000);
      post('/api/book', { site: SITE, start: slot ? slot.start : null, name: v.name, email: v.email, company: v.company, topic: v.topic, message: v.message, consent: true, website: f.website.value, transcript: transcript })
        .then(function (r) {
          if (r.__status === 200 && r.ok) { f.remove(); done(slot, v); return; }
          btn.disabled = false; btn.textContent = 'Réessayer';
          if (r.errors) mark(r.errors);
          if (r.__status === 409) { say(r.error || 'Ce créneau n’est plus disponible.'); f.remove(); book(); return; }
          showErr(r.error || 'L’envoi a échoué. Réessayez.');
        })
        .catch(function () { btn.disabled = false; btn.textContent = 'Réessayer'; showErr('Connexion impossible. Réessayez dans un instant.'); });
    });
    function mark(errs) {
      var ok = true;
      f.querySelectorAll('.cva-err').forEach(function (el) {
        var k = el.getAttribute('data-for'), m = errs[k] || (k === 'fullname' && errs.name) || ''; el.textContent = m;
        var inp = f.querySelector('[name="' + k + '"]'); if (inp) inp.setAttribute('aria-invalid', m ? 'true' : 'false');
        if (m && ok) { ok = false; if (inp) inp.focus(); }
      });
      return ok;
    }
  }

  function done(slot, v) {
    var html = '<strong>C’est envoyé ✓</strong><br>' + (slot
      ? esc(FIRST) + ' a reçu votre demande pour le ' + esc(slot.label) + ' (heure de Paris) et vous confirmera par e-mail. Un récapitulatif vient de vous être envoyé à ' + esc(v.email) + '.'
      : esc(FIRST) + ' a bien reçu votre message et vous répondra à ' + esc(v.email) + '.');
    var d = add(html, 'cva-m bot cva-ok');
    if (slot) {
      var title = 'Échange avec ' + FIRST, stamp = function (ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
      var gcal = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + stamp(slot.start) + '/' + stamp(slot.end) + '&details=' + encodeURIComponent('Objet : ' + v.topic);
      var ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//cv-agent//FR\r\nMETHOD:PUBLISH\r\nBEGIN:VEVENT\r\nUID:' + SITE + '-' + slot.start + '@my-officeapps.com\r\nDTSTAMP:' + stamp(Date.now()) + '\r\nDTSTART:' + stamp(slot.start) + '\r\nDTEND:' + stamp(slot.end) + '\r\nSUMMARY:' + title + '\r\nSTATUS:TENTATIVE\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
      d.insertAdjacentHTML('beforeend', '<br><a href="' + gcal + '" target="_blank" rel="noopener">Ajouter à Google Agenda</a> · <a href="data:text/calendar;charset=utf-8,' + encodeURIComponent(ics) + '" download="rendez-vous.ics">Fichier agenda (.ics)</a>');
    }
    history.push({ role: 'assistant', content: slot ? 'Demande de rendez-vous envoyée pour le ' + slot.label + '.' : 'Message envoyé.' });
  }

  function open() { if (root.classList.contains('open')) return; lastFocus = document.activeElement; root.classList.add('open'); greet(); setTimeout(function () { input.focus(); }, 250); }
  function close() { root.classList.remove('open'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  root.querySelector('.cva-launch').addEventListener('click', open);
  root.querySelector('.cva-x').addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('open')) close(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); if (form.website.value) return; var v = input.value; input.value = ''; ask(v); });
  input.addEventListener('input', function () { showErr(''); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-agent-open],[data-agent-book]');
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute('data-agent-book')) book(); else open();
  });
  window.cvAgent = { open: open, close: close, book: book, ask: function (q) { open(); ask(q); } };
})();
