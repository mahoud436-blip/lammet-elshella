/* الجاسوس — واجهة اللعبة (لمّة الشلة) */
'use strict';
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const app = $('#app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function uiModal(opts) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'ui-modal-ov';
    ov.innerHTML = `<div class="ui-modal">
      ${opts.emoji ? `<div class="ui-modal-emoji">${opts.emoji}</div>` : ''}
      ${opts.title ? `<h3 class="ui-modal-title">${esc(opts.title)}</h3>` : ''}
      <div class="ui-modal-body">${esc(opts.message || '')}</div>
      <div class="ui-modal-actions">
        ${opts.cancel === false ? '' : `<button class="btn ghost big ui-cancel">${esc(opts.cancelLabel || 'إلغاء')}</button>`}
        <button class="btn ${opts.danger ? 'coral' : 'primary'} big ui-ok">${esc(opts.okLabel || 'تمام')}</button>
      </div></div>`;
    document.body.appendChild(ov);
    const done = v => { ov.remove(); resolve(v); };
    ov.querySelector('.ui-ok').onclick = () => done(true);
    const cx = ov.querySelector('.ui-cancel'); if (cx) cx.onclick = () => done(false);
    ov.onclick = e => { if (e.target === ov && opts.cancel !== false) done(false); };
    requestAnimationFrame(() => ov.classList.add('show'));
  });
}
const uiConfirm = (m, o) => uiModal(Object.assign({ message: m, danger: true }, o || {}));

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}
const AVATARS = ['🕵️','🎩','🔍','🧠','🦊','🐺','🎭','👤','🃏','🔦','🗝️','🧩','⚡','🌑','🎯','🪤','📡','🧿','♠️','🖤','🔮','🚬','🎲','🧊'];

const Snd = {
  ctx: null, muted: LS.get('jasoos_mute', false),
  ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  tone(f, t0, dur, type, vol) { if (this.muted || !this.ctx) return; const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = type || 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || .18, t0 + .02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); o.connect(g).connect(this.ctx.destination); o.start(t0); o.stop(t0 + dur + .05); },
  play(name) { this.ensure(); if (!this.ctx || this.muted) return; const t = this.ctx.currentTime;
    if (name === 'pick') this.tone(440, t, .08, 'square', .1);
    if (name === 'turn') { this.tone(392, t, .1); this.tone(523, t + .1, .14); }
    if (name === 'word') this.tone(660, t, .09, 'triangle', .12);
    if (name === 'spy') { this.tone(180, t, .3, 'sawtooth', .14); this.tone(140, t + .25, .4, 'sawtooth', .12); }
    if (name === 'ok') { [523, 659, 784].forEach((f, i) => this.tone(f, t + i * .09, .14)); }
    if (name === 'win') { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, t + i * .11, .16, 'triangle', .2)); }
  },
  toggle() { this.muted = !this.muted; LS.set('jasoos_mute', this.muted); toast(this.muted ? 'الصوت اتقفل 🔇' : 'الصوت اتفتح 🔊'); }
};

const S = {
  save: LS.get('jasoos_save', null),
  name: LS.get('jasoos_name', LS.get('tahadi_name', '')),
  avatar: LS.get('jasoos_av', AVATARS[Math.floor(Math.random() * AVATARS.length)]),
  st: null, es: null, lastMsg: 0, skew: 0, viewKey: '', wake: null, votePicks: [],
};

async function api(path, body) {
  try { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return await r.json(); }
  catch (e) { return { ok: false, error: 'مفيش اتصال بالسيرفر 📡' }; }
}
async function act(action, extra) {
  if (!S.save) return { ok: false };
  const r = await api('/api/jasoos/action', Object.assign({ code: S.save.code, token: S.save.token, action }, extra || {}));
  if (!r.ok && r.error) toast(r.error, 'err');
  return r;
}

function openStream() {
  if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; }
  if (!S.save) return;
  const es = new EventSource('/api/jasoos/stream?code=' + encodeURIComponent(S.save.code) + '&token=' + encodeURIComponent(S.save.token));
  S.es = es;
  es.onmessage = ev => {
    S.lastMsg = Date.now(); $('#net-banner').classList.add('hidden');
    let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
    if (d.t === 'state') { S.skew = d.serverNow - Date.now(); S.st = d; render(); }
    else if (d.t === 'kicked') { leaveLocal(); toast('الهوست طردك من الروم 😬', 'err'); }
    else if (d.t === 'left') { leaveLocal(); }
  };
  es.addEventListener('ping', () => { S.lastMsg = Date.now(); $('#net-banner').classList.add('hidden'); });
  es.onerror = () => { setTimeout(() => { if (S.es === es && es.readyState !== 1) $('#net-banner').classList.remove('hidden'); }, 1500); };
  S.lastMsg = Date.now();
}
setInterval(() => { if (S.save && S.es && Date.now() - S.lastMsg > 40000) openStream(); }, 10000);
document.addEventListener('visibilitychange', () => {
  const away = document.visibilityState !== 'visible';
  if (S.save) act('presence', { away });
  if (!away && S.save) { if (!S.es || S.es.readyState === 2 || Date.now() - S.lastMsg > 20000) openStream(); grabWake(); }
});
window.addEventListener('blur', () => { if (S.save) act('presence', { away: true }); });
window.addEventListener('focus', () => { if (S.save) act('presence', { away: false }); });
function grabWake() { if (!('wakeLock' in navigator)) return; if (S.st && S.st.phase !== 'lobby' && S.st.phase !== 'gameover') navigator.wakeLock.request('screen').then(w => { S.wake = w; }).catch(() => {}); }
function leaveLocal() { if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; } S.save = null; LS.del('jasoos_save'); S.st = null; S.viewKey = ''; renderHome(); }

function header(sub) {
  return `<div class="bunting"></div>
  <div class="top">
    <img src="/img/jasoos-sm.png" alt="">
    <div><div class="title display" style="color:var(--brass-hi)">الجاسوس</div><div class="sub">${esc(sub || 'مين فيكم مش عارف الكلمة؟ 🕵️')}</div></div>
    <button class="btn sm ghost" id="help-btn" style="margin-inline-start:auto">؟</button>
    <button class="btn sm ghost" id="home-btn">🏠</button>
    <button class="btn sm ghost" id="mute-btn">${Snd.muted ? '🔇' : '🔊'}</button>
  </div>
  ${S.save ? '<button class="leave-fab" id="leave-fab" title="اخرج من الروم">🚪</button>' : ''}
  <div id="presence-bar" class="presence-bar hidden"></div>`;
}
function bindHeader() {}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('#help-btn,#home-btn,#mute-btn,#leave-fab');
  if (!t) return;
  if (t.id === 'help-btn') { Snd.ensure(); showHelp(); }
  else if (t.id === 'home-btn') { if (S.save && !await uiConfirm('ترجع للمّة؟ مكانك في الروم محفوظ', { emoji: '🏠', okLabel: 'ارجع', cancelLabel: 'فضّل هنا' })) return; location.href = '/'; }
  else if (t.id === 'mute-btn') { Snd.toggle(); t.textContent = Snd.muted ? '🔇' : '🔊'; }
  else if (t.id === 'leave-fab') { if (!await uiConfirm('تخرج من الروم؟ سكورك هيفضل محسوب', { emoji: '🚪', title: 'خروج', okLabel: 'اخرج', cancelLabel: 'استنى' })) return; await act('leave'); leaveLocal(); }
});
function updPresence(st) {
  const el = $('#presence-bar'); if (!el) return;
  const show = st && (st.phase === 'play' || st.phase === 'vote' || st.phase === 'spyGuess');
  el.classList.toggle('hidden', !show); if (!show) return;
  el.innerHTML = st.players.map(p => {
    const cls = p.left ? 'gone' : (!p.connected ? 'off' : (p.away ? 'away' : 'here'));
    const badge = p.left ? '🚪' : (!p.connected ? '⏳' : (p.away ? '❗' : ''));
    return `<span class="pv ${cls}" title="${esc(p.name)}${p.away ? ' — خرج من اللعبة!' : ''}"><span class="av">${p.avatar}</span>${badge ? `<span class="bd">${badge}</span>` : ''}</span>`;
  }).join('');
}

function renderHome(prefillCode) {
  S.viewKey = 'home'; stopTimers();
  const urlRoom = new URLSearchParams(location.search).get('room') || '';
  const code = prefillCode || urlRoom;
  app.innerHTML = `
    ${header('اعمل روم أو ادخل مع صحابك بكود')}
    <div class="card">
      <div class="row">
        <button class="avatar-big" id="av-btn">${S.avatar}</button>
        <div class="grow">
          <label class="muted small">اسمك في اللعبة</label>
          <input class="field" id="name-in" maxlength="16" placeholder="مثلًا: ميدو 😎" value="${esc(S.name)}">
        </div>
      </div>
      <button class="btn primary big mt" id="create-btn">🕵️ اعمل روم جديد</button>
      <div class="or">أو</div>
      <input class="field code-input" id="code-in" inputmode="numeric" maxlength="4" placeholder="• • • •" value="${esc(code)}">
      <button class="btn teal big mt" id="join-btn">🚪 ادخل الروم</button>
    </div>
    <div class="card tight center muted small">من 3 لـ 12 لاعب — كل واحد من متصفح موبايله 📱</div>`;
  $('#av-btn').onclick = () => { Snd.play('pick'); S.avatar = AVATARS[(AVATARS.indexOf(S.avatar) + 1) % AVATARS.length]; LS.set('jasoos_av', S.avatar); $('#av-btn').textContent = S.avatar; };
  const nameIn = $('#name-in'); nameIn.oninput = () => { S.name = nameIn.value; LS.set('jasoos_name', S.name); };
  $('#create-btn').onclick = async () => { Snd.ensure(); const name = nameIn.value.trim(); if (!name) return toast('اكتب اسمك الأول ✍️', 'err'); const r = await api('/api/jasoos/create', { name, avatar: S.avatar }); if (!r.ok) return toast(r.error || 'مشكلة', 'err'); S.save = { code: r.code, token: r.token }; LS.set('jasoos_save', S.save); openStream(); };
  $('#join-btn').onclick = async () => { Snd.ensure(); const name = nameIn.value.trim(); const c = $('#code-in').value.trim(); if (!name) return toast('اكتب اسمك الأول ✍️', 'err'); if (!/^\d{4}$/.test(c)) return toast('الكود 4 أرقام', 'err'); const r = await api('/api/jasoos/join', { code: c, name, avatar: S.avatar }); if (!r.ok) return toast(r.error || 'مشكلة', 'err'); S.save = { code: r.code, token: r.token }; LS.set('jasoos_save', S.save); openStream(); };
}

function render() {
  const st = S.st; if (!st) return;
  updPresence(st);
  const key = st.phase + '|' + st.round + '|' + (st.phase === 'play' ? (st.yourTurn ? 'me' : 'x') + st.turnInRound : '') + '|' + (st.youVoted ? 'v' : '') + (st.youGuessed ? 'g' : '') + (st.youReady ? 'r' : '');
  if (key === S.viewKey) {
    if (st.phase === 'lobby') return renderLobby(st);
    if (st.phase === 'play') return patchPlay(st);
    if (st.phase === 'vote') return patchVote(st);
    if (st.phase === 'spyGuess') return patchSpyGuess(st);
    if (st.phase === 'reveal') return patchReveal(st);
    return;
  }
  S.viewKey = key;
  if (st.phase === 'vote') S.votePicks = (st.yourVotes || []).slice();
  if (st.phase === 'lobby') renderLobby(st);
  else if (st.phase === 'play') renderPlay(st);
  else if (st.phase === 'vote') renderVote(st);
  else if (st.phase === 'spyGuess') renderSpyGuess(st);
  else if (st.phase === 'reveal') renderReveal(st);
  else if (st.phase === 'gameover') renderGameover(st);
}

function joinUrl(st) {
  const loc = location;
  if ((loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') && st.net && !st.net.hosted && st.net.ips && st.net.ips.length)
    return 'http://' + st.net.ips[0] + ':' + st.net.port + '/jasoos/?room=' + st.code;
  return loc.origin + '/jasoos/?room=' + st.code;
}
function renderLobby(st) {
  stopTimers();
  const me = st.you, isHost = me.isHost;
  const url = joinUrl(st);
  const hostName = (st.players.find(p => p.isHost) || {}).name || '';
  const s = st.settings;
  app.innerHTML = `
    ${header('ابعت الكود لصحابك')}
    <div class="card center">
      <div class="muted">كود الروم</div>
      <div class="room-code" id="code-copy" title="دوس للنسخ" style="color:var(--brass-hi)">${st.code}</div>
      <div class="join-url mt" id="url-copy" title="دوس للنسخ">${esc(url)}</div>
      <div class="qr-wrap" id="qr"></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:10px">اللاعيبة (${st.players.length}/12)</h3>
      <div class="players-grid">${st.players.map(p => `
        <div class="p-tile ${p.connected ? '' : 'off'}">
          ${p.isHost ? '<span class="crown">👑</span>' : ''}
          ${isHost && !p.isHost ? `<button class="kick" data-kick="${p.id}">✕</button>` : ''}
          <div class="av">${p.avatar}</div>
          <div class="nm">${esc(p.name)}${p.id === me.id ? ' (انت)' : ''}</div>
          <div class="st">${p.left ? 'خرج 🚪' : (p.connected ? 'موجود ✅' : 'اتفصل ⏳')}</div>
        </div>`).join('')}
      </div>
      ${st.players.length < 3 ? '<div class="center muted small mt">محتاجين 3 على الأقل 🙂</div>' : ''}
    </div>
    <div class="card">
      <h3>الإعدادات ${isHost ? '' : '<span class="muted small">(بيظبطها ' + esc(hostName) + ' 👑)</span>'}</h3>
      <div class="mt center muted small">الكاتيجوريز الداخلة</div>
      <div class="count-note">مختار <b id="cat-count">${s.cats.length}</b></div>
      <div class="cats-grid mt" id="cats-grid"></div>

      <div class="mt center muted small">كل لاعب هيكتب كام كلمة؟</div>
      <div class="stepper">
        <button class="btn" data-min="rounds" ${isHost ? '' : 'disabled'}>−</button>
        <div class="val" style="color:var(--brass-hi)">${s.rounds}</div>
        <button class="btn" data-plus="rounds" data-mn="2" data-mx="6" ${isHost ? '' : 'disabled'}>+</button>
      </div>

      <div class="mt center muted small">عدد الجواسيس</div>
      <div class="row" style="justify-content:center">
        <span class="chip click ${s.spyMode === 'random' ? 'on' : ''} ${isHost ? '' : 'locked'}" data-spymode="random">🎲 عشوائي (سري)</span>
        <span class="chip click ${s.spyMode === 'fixed' ? 'on' : ''} ${isHost ? '' : 'locked'}" data-spymode="fixed">✋ أحدده</span>
      </div>
      ${s.spyMode === 'fixed' ? `
        <div class="row wrap mt" style="justify-content:center">
          ${[1, 2, 3].map(n => `<span class="chip click ${s.spyCount === n ? 'on' : ''} ${n > st.maxSpies ? 'locked' : ''} ${isHost ? '' : 'locked'}" data-spycount="${n}">${n} ${n === 1 ? 'جاسوس' : 'جواسيس'}</span>`).join('')}
        </div>
        <div class="center muted small" style="font-size:12px;margin-top:4px">بعدد اللاعيبة الحالي: أقصى ${st.maxSpies}</div>`
        : '<div class="center muted small" style="font-size:12px;margin-top:4px">العدد هيتحدد عشوائي ومحدش هيعرفه غير في النهاية 🤫</div>'}

      <div class="mt center muted small">وقت الدور</div>
      <div class="row wrap" style="justify-content:center">
        ${[0, 10, 20, 30].map(t => `<span class="chip click ${s.turnTime === t ? 'on' : ''} ${isHost ? '' : 'locked'}" data-time="${t}">${t === 0 ? 'مفتوح ♾️' : t + ' ث'}</span>`).join('')}
      </div>
    </div>
    ${isHost
      ? `<button class="btn primary big" id="start-btn" ${st.players.length >= 3 ? '' : 'disabled'}>🚀 يلا نبدأ</button>`
      : `<div class="card tight center">مستنيين <b>${esc(hostName)}</b> 👑 يبدأ 🚀</div>`}
    <button class="btn ghost big mt" id="leave-btn">🚪 اخرج من الروم</button>`;
  try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); let svg = ''; try { svg = q.createSvgTag({ cellSize: 4, margin: 2 }); } catch (e) { svg = q.createSvgTag(4, 2); } $('#qr').innerHTML = svg; } catch (e) { $('#qr').classList.add('hidden'); }
  const copy = txt => { (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('اتنسخ ✅', 'ok')).catch(() => {}); };
  $('#code-copy').onclick = () => copy(st.code); $('#url-copy').onclick = () => copy(url);
  const grid = $('#cats-grid');
  grid.innerHTML = st.allCats.map(c => `<div class="cat-chip ${s.cats.includes(c.id) ? 'on' : ''} ${isHost ? '' : 'locked'}" data-cat="${c.id}"><span class="ic">${c.icon}</span><span>${esc(c.name)}</span></div>`).join('');
  if (isHost) {
    let cats = s.cats.slice();
    $$('.cat-chip', grid).forEach(el => el.onclick = () => { const id = el.dataset.cat; if (cats.includes(id)) { if (cats.length === 1) return toast('لازم كاتيجوري واحدة على الأقل', 'err'); cats = cats.filter(c => c !== id); } else cats.push(id); el.classList.toggle('on'); $('#cat-count').textContent = cats.length; act('setSettings', { settings: { cats } }); });
    $$('[data-plus]').forEach(b => b.onclick = () => act('setSettings', { settings: { rounds: Math.min(+b.dataset.mx, s.rounds + 1) } }));
    $$('[data-min]').forEach(b => b.onclick = () => act('setSettings', { settings: { rounds: Math.max(2, s.rounds - 1) } }));
    $$('[data-spymode]').forEach(el => el.onclick = () => act('setSettings', { settings: { spyMode: el.dataset.spymode } }));
    $$('[data-spycount]').forEach(el => el.onclick = () => { const n = parseInt(el.dataset.spycount, 10); if (n > st.maxSpies) return toast(`بعدد اللاعيبة ده أقصى ${st.maxSpies}`, 'err'); act('setSettings', { settings: { spyCount: n } }); });
    $$('[data-time]').forEach(el => el.onclick = () => act('setSettings', { settings: { turnTime: parseInt(el.dataset.time, 10) } }));
    $('#start-btn').onclick = () => { Snd.play('turn'); act('startGame'); };
    $$('.kick').forEach(b => b.onclick = async () => { if (await uiConfirm('تطرده من الروم؟', { emoji: '👋', okLabel: 'اطرده' })) act('kick', { playerId: b.dataset.kick }); });
  }
  $('#leave-btn').onclick = async () => { if (await uiConfirm('تخرج من الروم؟', { emoji: '🚪', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
}

/* ===== شاشة اللعب ===== */
let timerRAF = null, wordTimers = [];
function stopTimers() { if (timerRAF) cancelAnimationFrame(timerRAF); timerRAF = null; wordTimers.forEach(t => clearTimeout(t)); wordTimers = []; }
function startCountdown(deadline) {
  const el = $('#tbar'); if (!el || !deadline) return;
  const fill = $('.fill', el); const total = deadline - (Date.now() + S.skew);
  const loop = () => { const remain = deadline - (Date.now() + S.skew); const pct = Math.max(0, Math.min(100, remain / Math.max(total, 1) * 100)); fill.style.width = pct + '%'; el.classList.toggle('low', pct < 30); if (remain > 0) timerRAF = requestAnimationFrame(loop); };
  if (timerRAF) cancelAnimationFrame(timerRAF);
  timerRAF = requestAnimationFrame(loop);
}
function secretBox(st) {
  if (st.youAreSpy) {
    return `<div class="spy-box">
      <div class="lbl">🤫 انت الجاسوس!</div>
      <div class="word">مش شايف الكلمة 🕵️</div>
      <div class="muted small mt">اسمع كلامهم واتصرف كأنك عارف — ولو عرفت الكلمة هتاخد نقط زيادة في الآخر</div>
    </div>`;
  }
  return `<div class="secret-box">
    <div class="lbl">الكلمة السرية</div>
    <div class="word">${esc(st.secret || '')}</div>
    <div class="cat mt"><span class="chip">${st.cat ? st.cat.icon + ' ' + st.cat.name : ''}</span></div>
  </div>`;
}
function wordCards(st) {
  const ws = st.wordsShown || [];
  if (!ws.length) return '<div class="muted small center" style="padding:14px">مفيش كلمات ظاهرة دلوقتي — ركّز 👀</div>';
  return ws.map((w, i) => `
    <div class="word-card" data-wi="${i}">
      <div class="who">${w.avatar} <b>${esc(w.name)}</b></div>
      <div class="w">${esc(w.word)}</div>
      <div class="bar" style="width:${Math.round(w.expiresIn / (st.wordShowMs || 10000) * 100)}%"></div>
    </div>`).join('');
}
function armWordTimers(st) {
  wordTimers.forEach(t => clearTimeout(t)); wordTimers = [];
  (st.wordsShown || []).forEach((w, i) => {
    const el = document.querySelector(`.word-card[data-wi="${i}"]`);
    if (!el) return;
    const bar = $('.bar', el);
    const t0 = Date.now(), dur = w.expiresIn, total = st.wordShowMs || 10000;
    const tick = () => {
      const remain = dur - (Date.now() - t0);
      if (remain <= 0) { el.classList.add('gone'); bar.style.width = '0%'; return; }
      bar.style.width = Math.round(remain / total * 100) + '%';
      wordTimers.push(setTimeout(tick, 100));
    };
    tick();
  });
}
function turnStrip(st) {
  return `<div class="turn-strip">${(st.turnOrderIds || []).map((id, i) => {
    const p = st.players.find(x => x.id === id) || {};
    const cls = i < st.turnInRound - 1 ? 'done' : (i === st.turnInRound - 1 ? 'now' : '');
    return `<span class="turn-dot ${cls}" title="${esc(p.name || '')}">${p.avatar || '👤'}</span>`;
  }).join('')}</div>`;
}
function renderPlay(st) {
  grabWake(); stopTimers();
  if (st.yourTurn) Snd.play('turn');
  const bottomLeave = ''; // الخروج أثناء اللعب من زر الباب فوق
  app.innerHTML = `
    ${header('')}
    <div class="center mb"><span class="chip on">اللفة ${st.round} من ${st.totalRounds}</span> <span class="chip">دور ${st.turnInRound}/${st.turnsPerRound}</span></div>
    ${secretBox(st)}
    ${turnStrip(st)}
    ${st.turnDeadline ? '<div class="timer" id="tbar"><div class="fill" style="width:100%"></div></div>' : ''}
    <div class="card">
      ${st.yourTurn
        ? `<div class="center" style="font-weight:900;font-size:17px;color:var(--brass-hi)">دورك! اكتب كلمة واحدة 👇</div>
           <div class="center muted small mb">توصف الكلمة من غير ما تقولها — والكلمة اللي اتقالت قبل كده مترجعش</div>
           <div class="row mt">
             <input class="field grow" id="word-in" maxlength="${st.maxWordChars}" placeholder="كلمة واحدة بس...">
             <button class="btn primary" id="word-btn">ابعت</button>
           </div>`
        : `<div class="center" style="font-weight:900">${(st.current && st.current.avatar) || '👤'} <b>${esc((st.current && st.current.name) || '')}</b> بيكتب دلوقتي...</div>
           <div class="center muted small mt">الكلمة بتظهر ${Math.round((st.wordShowMs || 10000) / 1000)} ثواني بس — ركّز واحفظ 🧠</div>`}
    </div>
    <div id="words">${wordCards(st)}</div>
    ${bottomLeave}`;
  startCountdown(st.turnDeadline);
  armWordTimers(st);
  if (st.yourTurn) {
    const inp = $('#word-in');
    const send = async () => {
      const v = inp.value.trim();
      if (!v) return;
      const r = await act('sayWord', { word: v });
      if (r.ok) { Snd.play('word'); inp.value = ''; }
    };
    $('#word-btn').onclick = send;
    inp.onkeydown = e => { if (e.key === 'Enter') send(); };
    setTimeout(() => inp.focus(), 100);
  }
  const lb = $('#leave-btn2'); if (lb) lb.onclick = async () => { if (await uiConfirm('تخرج من الروم؟ سكورك هيفضل محسوب', { emoji: '🚪', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
}
function patchPlay(st) {
  const w = $('#words');
  if (w) { w.innerHTML = wordCards(st); armWordTimers(st); }
  const strip = $('.turn-strip'); if (strip) strip.outerHTML = turnStrip(st);
}

/* ===== التصويت ===== */
function renderVote(st) {
  grabWake(); stopTimers();
  Snd.play('spy');
  const bottomLeave = ''; // الخروج أثناء اللعب من زر الباب فوق
  if (st.youAreSpy) {
    app.innerHTML = `
      ${header('')}
      <div class="card center">
        <div class="big-emoji">🤫</div>
        <h2 class="display" style="color:var(--coral)">انت الجاسوس!</h2>
        <div class="act-natural mt">
          بيصوّتوا دلوقتي عشان يقفشوك 😬<br>
          <b>مثّل إنك بتصوّت زيهم ومتلفتش الانتباه!</b><br>
          <span class="muted small">بص في موبايلك وحرّك صوابعك عادي 😏</span>
        </div>
        <div class="muted small mt">صوّتوا <b id="v-n">${st.votedCount}</b> من ${st.voteTotal}</div>
      </div>
      ${bottomLeave}`;
  } else {
    const n = st.picksNeeded;
    app.innerHTML = `
      ${header('')}
      <div class="card center">
        <div class="big-emoji">🔍</div>
        <h2 class="display">مين الجاسوس؟</h2>
        <div class="muted">${st.spyCountHidden ? 'العدد كان سري — اختار <b>' + n + '</b> ' + (n === 1 ? 'لاعب' : 'لاعيبة') : 'اختار <b>' + n + '</b> ' + (n === 1 ? 'لاعب' : 'لاعيبة')}</div>
      </div>
      <div class="card">
        <div id="picks">${st.candidates.map(c => `
          <div class="vote-pick ${S.votePicks.includes(c.id) ? 'on' : ''}" data-pick="${c.id}">
            <span class="av">${c.avatar}</span><span>${esc(c.name)}</span><span class="tick">✅</span>
          </div>`).join('')}
        </div>
        <div class="center muted small mt">اخترت <b id="p-n">${S.votePicks.length}</b> من ${n}</div>
        ${st.youVoted ? '<div class="center mt" style="font-weight:900;color:var(--brass-hi)">تصويتك اتسجل ✅ تقدر تغيّره</div>' : ''}
        <button class="btn primary big mt" id="vote-btn">🗳️ ${st.youVoted ? 'عدّل تصويتي' : 'صوّت'}</button>
        <div class="center muted small mt">صوّتوا <b id="v-n">${st.votedCount}</b> من ${st.voteTotal}</div>
      </div>
      ${bottomLeave}`;
    $$('[data-pick]').forEach(el => el.onclick = () => {
      const id = el.dataset.pick;
      if (S.votePicks.includes(id)) S.votePicks = S.votePicks.filter(x => x !== id);
      else { if (S.votePicks.length >= n) { toast(`اختار ${n} بس — شيل واحد الأول`, 'err'); return; } S.votePicks.push(id); }
      el.classList.toggle('on');
      $('#p-n').textContent = S.votePicks.length;
      Snd.play('pick');
    });
    $('#vote-btn').onclick = async () => {
      if (S.votePicks.length !== n) return toast(`لازم تختار ${n}`, 'err');
      const r = await act('vote', { playerIds: S.votePicks });
      if (r.ok) Snd.play('ok');
    };
  }
  const lb = $('#leave-btn2'); if (lb) lb.onclick = async () => { if (await uiConfirm('تخرج من الروم؟ سكورك هيفضل محسوب', { emoji: '🚪', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
}
function patchVote(st) { const v = $('#v-n'); if (v) v.textContent = st.votedCount; }

/* ===== تخمين الجاسوس ===== */
function renderSpyGuess(st) {
  stopTimers();
  const bottomLeave = ''; // الخروج أثناء اللعب من زر الباب فوق
  if (st.youAreSpy) {
    app.innerHTML = `
      ${header('')}
      <div class="card center">
        <div class="big-emoji">🎯</div>
        <h2 class="display" style="color:var(--coral)">فرصتك الأخيرة!</h2>
        <div class="muted">خلّصوا تصويت. لو عرفت الكلمة اللي كانوا بيتكلموا عنها هتاخد <b style="color:var(--brass-hi)">100 نقطة زيادة</b></div>
        <div class="chip mt">${st.cat ? st.cat.icon + ' ' + st.cat.name : ''}</div>
        ${st.youGuessed
          ? '<div class="mt" style="font-weight:900;color:var(--brass-hi)">تخمينك اتسجل ✅</div>'
          : `<div class="row mt">
               <input class="field grow" id="sg-in" maxlength="60" placeholder="إيه الكلمة؟">
               <button class="btn primary" id="sg-btn">خمّن</button>
             </div>`}
      </div>
      ${bottomLeave}`;
    const b = $('#sg-btn');
    if (b) {
      const send = async () => { const v = $('#sg-in').value.trim(); if (!v) return; const r = await act('spyGuess', { text: v }); if (r.ok) Snd.play('ok'); };
      b.onclick = send;
      $('#sg-in').onkeydown = e => { if (e.key === 'Enter') send(); };
    }
  } else {
    app.innerHTML = `
      ${header('')}
      <div class="card center">
        <div class="big-emoji">⏳</div>
        <h2 class="display">خلص التصويت!</h2>
        <div class="muted mt">الجاسوس بيحاول يخمّن الكلمة دلوقتي...<br>لو عرفها هياخد نقط زيادة 😬</div>
        <div class="muted small mt">خمّن <b id="sg-n">${st.spyGuessCount}</b> من ${st.spyTotal}</div>
      </div>
      ${bottomLeave}`;
  }
  const lb = $('#leave-btn2'); if (lb) lb.onclick = async () => { if (await uiConfirm('تخرج من الروم؟ سكورك هيفضل محسوب', { emoji: '🚪', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
}
function patchSpyGuess(st) { const n = $('#sg-n'); if (n) n.textContent = st.spyGuessCount; }

/* ===== الكشف ===== */
function renderReveal(st) {
  stopTimers();
  const R = st.result || {};
  Snd.play('win');
  const board = st.players.slice().sort((a, b) => b.score - a.score);
  app.innerHTML = `
    ${header('')}
    <div class="card center">
      <div class="secret-box" style="margin-bottom:12px">
        <div class="lbl">الكلمة كانت</div>
        <div class="word">${esc(R.secret)}</div>
        <div class="cat mt"><span class="chip">${R.cat ? R.cat.icon + ' ' + R.cat.name : ''}</span></div>
      </div>
      <div style="font-weight:900;font-size:17px">كان فيه <span style="color:var(--coral)">${R.spyCount}</span> ${R.spyCount === 1 ? 'جاسوس' : 'جواسيس'} 🕵️</div>
    </div>
    <div class="card">
      <h3 class="mb">🕵️ الجواسيس</h3>
      ${(R.spies || []).map(s => `
        <div class="guess-item" style="flex-direction:column;align-items:stretch;gap:6px;background:#3b1220;border-color:#7f2d42">
          <div style="font-weight:900;font-size:17px">${s.avatar} ${esc(s.name)}</div>
          <div class="muted small">${s.caughtByCount === 0 ? '🎉 فلت من الكل! +' + s.escapePoints : (s.caughtByCount >= s.votersCount ? '😬 الكل قفشه — مفيش نقط' : `قفشه ${s.caughtByCount} من ${s.votersCount} → +${s.escapePoints}`)}</div>
          ${s.caughtByNames && s.caughtByNames.length ? `<div class="muted small">قفشوه: ${s.caughtByNames.map(esc).join('، ')}</div>` : ''}
          <div class="muted small">تخمينه للكلمة: ${s.guess ? `«${esc(s.guess)}» ${s.guessedRight ? '✅ +' + s.wordPoints : '❌'}` : '— مخمّنش'}</div>
          <div style="font-weight:900;color:var(--brass-hi)">المجموع: +${s.total}</div>
        </div>`).join('')}
    </div>
    <div class="card">
      <h3 class="mb">🗳️ تصويت الأبرياء</h3>
      ${(R.voters || []).map(v => `
        <div class="guess-item ${v.correctCount ? 'correct' : ''}">
          <span class="who">${v.avatar} ${esc(v.name)}</span>
          <span class="gtext">${v.picked.map(esc).join('، ')} ${v.correctCount ? '✅ +' + v.gained : '❌'}</span>
        </div>`).join('')}
    </div>
    <div class="card">
      <h3 class="mb">📝 الكلمات اللي اتقالت</h3>
      ${(R.words || []).map(w => `<div class="guess-item ${w.wasSpy ? '' : ''}" style="${w.wasSpy ? 'border-color:var(--coral)' : ''}"><span class="who">${w.avatar} ${esc(w.name)}${w.wasSpy ? ' 🕵️' : ''}</span><span class="gtext">${esc(w.word)}</span></div>`).join('')}
    </div>
    <div class="card">
      <h3 class="mb">📊 النقط</h3>
      ${board.map((p, i) => `<div class="rank-row ${p.id === st.you.id ? 'me' : ''}"><span class="pos">${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</span><span>${p.avatar}</span><span>${esc(p.name)}${p.left ? ' 🚪' : ''}</span><span class="sc">${p.score}</span></div>`).join('')}
    </div>
    <div class="card tight center">
      ${st.youReady ? '<div style="font-weight:900;color:var(--brass-hi)">تمام ✅ مستنيين الباقي</div>' : '<button class="btn primary big" id="ready-btn">🏁 النتيجة النهائية</button>'}
      <div class="muted small mt">جاهزين: <span id="r-n">${st.readyIds.length}</span>/${st.players.filter(p => p.connected).length}</div>
      ${st.you.isHost ? '<button class="btn sm ghost mt" id="force-btn" style="width:100%">⏭️ كمّلوا من غير المتأخرين</button>' : ''}
    </div>`;
  const rb = $('#ready-btn'); if (rb) rb.onclick = async () => { Snd.play('pick'); const r = await act('readyNext'); if (r.ok) rb.outerHTML = '<div style="font-weight:900;color:var(--brass-hi)">تمام ✅ مستنيين الباقي</div>'; };
  const fb = $('#force-btn'); if (fb) fb.onclick = async () => { if (await uiConfirm('تكمّلوا من غير المتأخرين؟', { emoji: '⏭️', okLabel: 'كمّل', danger: false })) act('forceNext'); };
}
function patchReveal(st) { const n = $('#r-n'); if (n) n.textContent = st.readyIds.length; }

function confetti() {
  const box = document.createElement('div'); box.className = 'confetti';
  const colors = ['#7c5cff', '#a78bfa', '#22d3ee', '#fb7185', '#F4EDDF'];
  for (let i = 0; i < 90; i++) { const s = document.createElement('i'); s.style.left = Math.random() * 100 + 'vw'; s.style.background = colors[i % colors.length]; s.style.animationDuration = (2.2 + Math.random() * 2) + 's'; s.style.animationDelay = (Math.random() * .8) + 's'; s.style.transform = 'rotate(' + Math.random() * 360 + 'deg)'; box.appendChild(s); }
  document.body.appendChild(box); setTimeout(() => box.remove(), 5200);
}
function renderGameover(st) {
  stopTimers(); const R = st.results, me = st.you; const hostP = st.players.find(p => p.isHost) || {};
  Snd.play('win'); confetti();
  const top3 = R.ranking.slice(0, 3);
  const pod = i => top3[i] ? `<div class="pod p${i + 1}"><div class="pav">${top3[i].avatar}</div><div class="pnm">${esc(top3[i].name)}</div><div class="psc">${top3[i].score}</div><div class="bar">${i + 1}</div></div>` : '';
  app.innerHTML = `${header('خلصت اللعبة! 🎉')}
    <div class="bunting teal"></div>
    <div class="card center"><h2 class="display" style="font-size:30px">🏆 نتيجة السهرة</h2><div class="podium">${pod(1)}${pod(0)}${pod(2)}</div></div>
    <div class="card"><h3 class="mb">🎖️ الجوايز</h3>${R.awards.map(a => `<div class="award"><span class="aic">${a.icon}</span><div><div class="at">${esc(a.title)}: ${esc(a.who)}</div><div class="ad">${esc(a.detail)}</div></div></div>`).join('')}</div>
    <div class="card"><h3 class="mb">📊 الترتيب</h3>${R.ranking.map(p => `<div class="rank-row ${p.id === me.id ? 'me' : ''}"><span class="pos">#${p.rank}</span><span>${p.avatar}</span><span>${esc(p.name)}${p.left ? ' <span class="muted small">🚪</span>' : ''}</span><span class="muted small">(${p.caught} قفشه · ${p.escaped} فلت)</span><span class="sc">${p.score}</span></div>`).join('')}</div>
    ${me.isHost ? '<button class="btn primary big" id="again-btn">🔄 نلعب تاني</button>' : `<div class="card tight center">جولة تانية؟ <b>${esc(hostP.name || '')}</b> 👑</div>`}
    <button class="btn ghost big mt" id="leave-btn">🏠 خروج</button>`;
  const ab = $('#again-btn'); if (ab) ab.onclick = () => act('playAgain');
  $('#leave-btn').onclick = async () => { if (await uiConfirm('تخرج من الروم؟', { emoji: '🏠', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
}

const JASOOS_STEPS = [
  ['🎯', 'اللعبة إيه؟', 'الكل شايف <span class="hl">كلمة سرية</span> ما عدا الجاسوس — هو شايف الكاتيجوري بس. بالدور كل واحد بيكتب <span class="hl">كلمة واحدة</span> توصف الكلمة، والجاسوس بيحاول يمثّل إنه عارف. وفي الآخر تصوّتوا مين هو.'],
  ['⚙️', 'الهوست بيحدد', 'الكاتيجوريز، <span class="hl">كام كلمة يكتب كل لاعب</span> (2–6)، عدد الجواسيس (عشوائي سري ولا يحدده)، ووقت الدور.'],
  ['🎲', 'عدد الجواسيس', '3 لاعيبة → جاسوس واحد. من 4 لـ 6 → لحد 2. من 7 وفوق → لحد 3. ولو اخترتوا <span class="hl">عشوائي</span>، محدش يعرف كانوا كام غير في النهاية 🤫'],
  ['✍️', 'دورك', 'تكتب <span class="hl">كلمة واحدة</span> بس توصف الكلمة السرية. <span class="warn">ممنوع تكتب الكلمة نفسها أو حاجة قريبة منها</span>، وممنوع تكرر كلمة اتقالت قبل كده.'],
  ['⏱️', 'الكلمة بتختفي!', 'كل كلمة بتظهر <span class="hl">10 ثواني بس</span> وبعدين تختفي. ركّز واحفظ — مفيش سجل ترجعله.'],
  ['🤔', 'اللعبة الحقيقية', 'لو وصفت الكلمة بدقة زيادة، الجاسوس هيعرفها ويكسب. ولو غمّضت أوي، صحابك هيشكّوا فيك انت. <span class="hl">لازم توازن</span>.'],
  ['🗳️', 'التصويت', 'بعد ما الكل يخلّص كلماته، كل برئ بيختار <span class="hl">بعدد الجواسيس</span> وياخد <span class="hl">100 نقطة عن كل واحد يصيبه</span>. الجاسوس مبيصوّتش — بيمثّل إنه بيصوّت 😏'],
  ['💯', 'نقط الجاسوس', 'فلت من الكل = <span class="hl">100</span>. فلت من بعضهم بس = <span class="hl">50</span>. قفشوه كلهم = صفر. وبعد التصويت بيخمّن الكلمة — لو عرفها <span class="hl">+100 كمان</span>.'],
  ['🚪', 'حاجات مهمة', 'الكلمات متتكرر في الروم أبدًا. ولو خرجت سكورك بيفضل محسوب. وفوق شريط بيوضّح لو حد خرج من اللعبة وهو بيلعب ❗'],
];
function showHelp() {
  const ov = document.createElement('div'); ov.className = 'help-ov';
  ov.innerHTML = `<div class="help-card">
    <div class="help-hero"><img src="/img/jasoos.webp" alt=""><h2>الجاسوس</h2><div class="sub">مين فيكم مش عارف الكلمة؟ 🕵️</div></div>
    <div class="help-body">${JASOOS_STEPS.map(([e, t, d]) => `<div class="help-step"><div class="help-num">${e}</div><div><h4>${t}</h4><p>${d}</p></div></div>`).join('')}</div>
    <div class="help-foot"><label class="help-chk"><input type="checkbox" id="help-off"> متظهرش تاني في الجهاز ده</label><button class="btn primary big" id="help-ok">تمام، يلا نلعب 🚀</button></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { if ($('#help-off') && $('#help-off').checked) LS.set('lamma_help_off_jasoos', true); ov.remove(); };
  $('#help-ok').onclick = close; ov.onclick = e => { if (e.target === ov) close(); };
}

(async function boot() {
  document.body.addEventListener('pointerdown', () => Snd.ensure(), { once: true });
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (S.save && S.save.code && S.save.token) {
    const r = await api('/api/jasoos/join', { code: S.save.code, token: S.save.token });
    if (r.ok) { openStream(); return; }
    LS.del('jasoos_save'); S.save = null;
    if (r.gone) toast('الروم القديم خلص', 'err');
  }
  renderHome(urlRoom || '');
  if (!LS.get('lamma_help_off_jasoos', false)) setTimeout(showHelp, 350);
})();
