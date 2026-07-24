/* خليك لمَّاح — واجهة اللعبة (لمّة الشلة) */
'use strict';
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const app = $('#app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* نوافذ داخلية */
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
const AVATARS = ['🦅','🛡️','🎯','🧠','⚡','🔥','👑','🚀','💎','🏹','♟️','🎓','⚙️','🔭','📚','🧭','🥇','🗺️','🏛️','⭐','🌋','🎤','🎩','🕵️'];

const Snd = {
  ctx: null, muted: LS.get('lammaha_mute', false),
  ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  tone(f, t0, dur, type, vol) { if (this.muted || !this.ctx) return; const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = type || 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || .18, t0 + .02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); o.connect(g).connect(this.ctx.destination); o.start(t0); o.stop(t0 + dur + .05); },
  play(name) { this.ensure(); if (!this.ctx || this.muted) return; const t = this.ctx.currentTime;
    if (name === 'pick') this.tone(520, t, .09, 'square', .12);
    if (name === 'q') { this.tone(392, t, .12); this.tone(523, t + .12, .16); }
    if (name === 'ok') { [523, 659, 784].forEach((f, i) => this.tone(f, t + i * .09, .14)); }
    if (name === 'no') { this.tone(196, t, .22, 'sawtooth', .12); this.tone(147, t + .18, .3, 'sawtooth', .12); }
    if (name === 'win') { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, t + i * .11, .16, 'triangle', .2)); }
    if (name === 'clue') this.tone(660, t, .1, 'triangle', .14);
  },
  toggle() { this.muted = !this.muted; LS.set('lammaha_mute', this.muted); toast(this.muted ? 'الصوت اتقفل 🔇' : 'الصوت اتفتح 🔊'); }
};

const S = {
  save: LS.get('lammaha_save', null),
  name: LS.get('lammaha_name', LS.get('tahadi_name', '')),
  avatar: LS.get('lammaha_av', AVATARS[Math.floor(Math.random() * AVATARS.length)]),
  st: null, es: null, lastMsg: 0, skew: 0, viewKey: '', wake: null, guessedLocal: '',
};

async function api(path, body) {
  try { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return await r.json(); }
  catch (e) { return { ok: false, error: 'مفيش اتصال بالسيرفر 📡' }; }
}
async function act(action, extra) {
  if (!S.save) return { ok: false };
  const r = await api('/api/lammaha/action', Object.assign({ code: S.save.code, token: S.save.token, action }, extra || {}));
  if (!r.ok && r.error) toast(r.error, 'err');
  return r;
}

function openStream() {
  if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; }
  if (!S.save) return;
  const es = new EventSource('/api/lammaha/stream?code=' + encodeURIComponent(S.save.code) + '&token=' + encodeURIComponent(S.save.token));
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
function leaveLocal() { if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; } S.save = null; LS.del('lammaha_save'); S.st = null; S.viewKey = ''; renderHome(); }

function header(sub) {
  return `<div class="bunting"></div>
  <div class="top">
    <img src="/img/lammaha-sm.png" alt="">
    <div><div class="title display" style="color:var(--brass-hi)">خليك لمَّاح</div><div class="sub">${esc(sub || 'لمّح وخلّيهم يجيبوها 🎤')}</div></div>
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
  else if (t.id === 'leave-fab') { if (!await uiConfirm('تخرج من الروم؟ سكورك هيفضل محسوب في النتيجة', { emoji: '🚪', title: 'خروج', okLabel: 'اخرج', cancelLabel: 'استنى' })) return; await act('leave'); leaveLocal(); }
});
function updPresence(st) {
  const el = $('#presence-bar'); if (!el) return;
  const show = st && (st.phase === 'clue' || st.phase === 'reveal');
  el.classList.toggle('hidden', !show); if (!show) return;
  el.innerHTML = st.players.map(p => {
    const cls = p.left ? 'gone' : (!p.connected ? 'off' : (p.away ? 'away' : 'here'));
    const badge = p.left ? '🚪' : (!p.connected ? '⏳' : (p.away ? '❗' : ''));
    return `<span class="pv ${cls}" title="${esc(p.name)}${p.away ? ' — خرج من اللعبة!' : ''}"><span class="av">${p.avatar}</span>${badge ? `<span class="bd">${badge}</span>` : ''}</span>`;
  }).join('');
}

function renderHome(prefillCode) {
  S.viewKey = 'home'; stopTimer();
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
      <button class="btn primary big mt" id="create-btn">🎤 اعمل روم جديد</button>
      <div class="or">أو</div>
      <input class="field code-input" id="code-in" inputmode="numeric" maxlength="4" placeholder="• • • •" value="${esc(code)}">
      <button class="btn teal big mt" id="join-btn">🚪 ادخل الروم</button>
    </div>
    <div class="card tight center muted small">من 3 لـ 12 لاعب — كل واحد من متصفح موبايله 📱</div>`;
  $('#av-btn').onclick = () => { Snd.play('pick'); S.avatar = AVATARS[(AVATARS.indexOf(S.avatar) + 1) % AVATARS.length]; LS.set('lammaha_av', S.avatar); $('#av-btn').textContent = S.avatar; };
  const nameIn = $('#name-in'); nameIn.oninput = () => { S.name = nameIn.value; LS.set('lammaha_name', S.name); };
  $('#create-btn').onclick = async () => { Snd.ensure(); const name = nameIn.value.trim(); if (!name) return toast('اكتب اسمك الأول ✍️', 'err'); const r = await api('/api/lammaha/create', { name, avatar: S.avatar }); if (!r.ok) return toast(r.error || 'مشكلة', 'err'); S.save = { code: r.code, token: r.token }; LS.set('lammaha_save', S.save); openStream(); };
  $('#join-btn').onclick = async () => { Snd.ensure(); const name = nameIn.value.trim(); const c = $('#code-in').value.trim(); if (!name) return toast('اكتب اسمك الأول ✍️', 'err'); if (!/^\d{4}$/.test(c)) return toast('الكود 4 أرقام', 'err'); const r = await api('/api/lammaha/join', { code: c, name, avatar: S.avatar }); if (!r.ok) return toast(r.error || 'مشكلة', 'err'); S.save = { code: r.code, token: r.token }; LS.set('lammaha_save', S.save); openStream(); };
}

function render() {
  const st = S.st; if (!st) return;
  updPresence(st);
  const key = st.phase + '|' + st.round + '|' + (st.phase === 'clue' ? (st.youAreCluer ? 'c' : 'g') + st.sub + st.cluesGiven + (st.pickMode || '') + (st.youGuessed ? 'y' : '') : '') + '|' + (st.youReady ? 'r' : '');
  if (key === S.viewKey) {
    if (st.phase === 'lobby') return renderLobby(st);
    if (st.phase === 'clue') return patchClue(st);
    if (st.phase === 'reveal') return patchReveal(st);
    return;
  }
  S.viewKey = key;
  if (st.phase === 'clue') S.guessedLocal = '';
  if (st.phase === 'lobby') renderLobby(st);
  else if (st.phase === 'clue') renderClue(st);
  else if (st.phase === 'reveal') renderReveal(st);
  else if (st.phase === 'gameover') renderGameover(st);
}

function joinUrl(st) {
  const loc = location;
  if ((loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') && st.net && !st.net.hosted && st.net.ips && st.net.ips.length)
    return 'http://' + st.net.ips[0] + ':' + st.net.port + '/lammaha/?room=' + st.code;
  return loc.origin + '/lammaha/?room=' + st.code;
}
function renderLobby(st) {
  stopTimer();
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
      <h3>إعدادات اللعبة ${isHost ? '' : '<span class="muted small">(بيظبطها ' + esc(hostName) + ' 👑)</span>'}</h3>
      <div class="mt center muted small">الكاتيجوريز الداخلة اللعبة</div>
      <div class="count-note">مختار <b id="cat-count">${s.cats.length}</b></div>
      <div class="cats-grid mt" id="cats-grid"></div>
      ${[
        ['roundsPerPlayer', 'كام دور يلمّح كل لاعب؟', 1, 5],
        ['maxClues', 'عدد التلميحات المسموحة في الجولة (1–10)', 1, 10],
      ].map(([k, label, mn, mx]) => `
        <div class="mt center muted small">${label}</div>
        <div class="stepper">
          <button class="btn" data-min="${k}" ${isHost ? '' : 'disabled'}>−</button>
          <div class="val" style="color:var(--brass-hi)">${s[k]}</div>
          <button class="btn" data-plus="${k}" data-mn="${mn}" data-mx="${mx}" ${isHost ? '' : 'disabled'}>+</button>
        </div>`).join('')}
      <div class="mt center muted small">مستوى الأسماء 🎚️</div>
      <div class="row wrap" style="justify-content:center">
        ${(st.levels || []).map(l => `<span class="chip click ${s.level === l.id ? 'on' : ''} ${isHost ? '' : 'locked'}" data-level="${l.id}">${l.icon} ${l.name}</span>`).join('')}
      </div>
      <div class="center muted small" style="margin-top:4px;font-size:12px">كل كاتيجوري فيها 100 اسم لكل مستوى</div>

      <div class="mt center muted small">أقصى عدد كلمات في التلميحة ✍️</div>
      <div class="row" style="justify-content:center">
        ${[1, 2, 3].map(n => `<span class="chip click ${s.maxWords === n ? 'on' : ''} ${isHost ? '' : 'locked'}" data-words="${n}">${n === 1 ? 'كلمة واحدة' : n + ' كلمات'}</span>`).join('')}
      </div>

      <div class="mt center muted small">الملمّح يكتب الكلمة بنفسه؟</div>
      <div class="row" style="justify-content:center">
        <span class="chip click ${!s.allowCustomWord ? 'on' : ''} ${isHost ? '' : 'locked'}" data-custom="0">🔒 لأ (من البنك بس)</span>
        <span class="chip click ${s.allowCustomWord ? 'on' : ''} ${isHost ? '' : 'locked'}" data-custom="1">✍️ أيوة (يختار)</span>
      </div>

      <div class="mt center muted small">ترتيب الملمّح</div>
      <div class="row" style="justify-content:center">
        <span class="chip click ${s.order === 'random' ? 'on' : ''}" data-order="random">🎲 عشوائي</span>
        <span class="chip click ${s.order === 'turns' ? 'on' : ''}" data-order="turns">➡️ بالدور</span>
      </div>
      <div class="center muted small" style="margin-top:4px;font-size:12px">الترتيب بس — كل لاعب بيلمّح نفس عدد المرات</div>
      <div class="mt center muted small">وقت التخمين لكل تلميحة (اختياري)</div>
      <div class="row wrap" style="justify-content:center">
        ${[0, 30, 60, 90].map(t => `<span class="chip click ${s.clueTime === t ? 'on' : ''}" data-time="${t}">${t === 0 ? 'مفتوح ♾️' : t + ' ث'}</span>`).join('')}
      </div>
    </div>
    ${isHost
      ? `<button class="btn primary big" id="start-btn" ${st.players.length >= 3 && s.cats.length >= 1 ? '' : 'disabled'}>🚀 يلا نبدأ</button>`
      : `<div class="card tight center">مستنيين <b>${esc(hostName)}</b> 👑 يبدأ 🚀</div>`}
    <button class="btn ghost big mt" id="leave-btn">🚪 اخرج من الروم</button>`;
  try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); let svg=''; try { svg = q.createSvgTag({ cellSize: 4, margin: 2 }); } catch(e){ svg=q.createSvgTag(4,2);} $('#qr').innerHTML = svg; } catch (e) { $('#qr').classList.add('hidden'); }
  const copy = txt => { (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('اتنسخ ✅', 'ok')).catch(() => {}); };
  $('#code-copy').onclick = () => copy(st.code); $('#url-copy').onclick = () => copy(url);
  const grid = $('#cats-grid');
  grid.innerHTML = st.allCats.map(c => `<div class="cat-chip ${st.settings.cats.includes(c.id) ? 'on' : ''} ${isHost ? '' : 'locked'}" data-cat="${c.id}"><span class="ic">${c.icon}</span><span>${esc(c.name)}</span></div>`).join('');
  if (isHost) {
    let cats = st.settings.cats.slice();
    $$('.cat-chip', grid).forEach(el => el.onclick = () => { const id = el.dataset.cat; if (cats.includes(id)) { if (cats.length === 1) return toast('لازم كاتيجوري واحدة على الأقل', 'err'); cats = cats.filter(c => c !== id); } else cats.push(id); el.classList.toggle('on'); $('#cat-count').textContent = cats.length; act('setSettings', { settings: { cats } }); });
    $$('[data-plus]').forEach(b => b.onclick = () => { const k = b.dataset.plus; act('setSettings', { settings: { [k]: Math.min(+b.dataset.mx, st.settings[k] + 1) } }); });
    $$('[data-min]').forEach(b => b.onclick = () => { const k = b.dataset.min; const mn = k === 'maxPass' ? 0 : 1; act('setSettings', { settings: { [k]: Math.max(mn, st.settings[k] - 1) } }); });
    $$('[data-order]').forEach(el => el.onclick = () => act('setSettings', { settings: { order: el.dataset.order } }));
    $$('[data-level]').forEach(el => el.onclick = () => act('setSettings', { settings: { level: el.dataset.level } }));
    $$('[data-words]').forEach(el => el.onclick = () => act('setSettings', { settings: { maxWords: parseInt(el.dataset.words, 10) } }));
    $$('[data-custom]').forEach(el => el.onclick = () => act('setSettings', { settings: { allowCustomWord: el.dataset.custom === '1' } }));
    $$('[data-time]').forEach(el => el.onclick = () => act('setSettings', { settings: { clueTime: parseInt(el.dataset.time, 10) } }));
    $('#start-btn').onclick = () => { Snd.play('q'); act('startGame'); };
    $$('.kick').forEach(b => b.onclick = async () => { if (await uiConfirm('تطرده من الروم؟', { emoji: '👋', okLabel: 'اطرده' })) act('kick', { playerId: b.dataset.kick }); });
  }
  $('#leave-btn').onclick = async () => { if (await uiConfirm('تخرج من الروم؟', { emoji: '🚪', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
}

function roundBadge(st) { return `<div class="center mb"><span class="chip on">الجولة ${st.round} من ${st.totalRounds}</span></div>`; }

let timerRAF = null;
function stopTimer() { if (timerRAF) cancelAnimationFrame(timerRAF); timerRAF = null; }
function startCountdown(deadline) {
  const el = $('#cbar'); if (!el || !deadline) return;
  const fill = $('.fill', el); const total = deadline - (Date.now() + S.skew);
  const loop = () => { const remain = deadline - (Date.now() + S.skew); const pct = Math.max(0, Math.min(100, remain / Math.max(total, 1) * 100)); fill.style.width = pct + '%'; el.classList.toggle('low', pct < 25); if (remain > 0) timerRAF = requestAnimationFrame(loop); };
  stopTimer(); timerRAF = requestAnimationFrame(loop);
}

function hintsPanel(st, highlightLatest) {
  if (!st.hints.length) return '';
  return `<div class="card tight">
    <div class="muted small mb">التلميحات لحد دلوقتي</div>
    ${st.hints.map((h, i) => `<div class="guess-item ${highlightLatest && i === st.hints.length - 1 ? 'correct' : ''}" style="background:${highlightLatest && i === st.hints.length - 1 ? '#123a2e' : ''}">
      <span class="who">💡 <b>تلميحة ${h.n}</b></span><span class="gtext">${esc(h.text)}</span></div>`).join('')}
  </div>`;
}
function historyPanel(st) {
  if (!st.hintHistory || !st.hintHistory.length) return '';
  return `<div class="card tight">
    <div class="muted small mb">تخمينات عدّت (كلها غلط ❌)</div>
    ${st.hintHistory.map(h => h.guesses.map(g => `<div class="guess-item"><span class="who">${g.avatar} ${esc(g.name)}</span><span class="gtext">${esc(g.text)} ❌</span></div>`).join('')).join('')}
  </div>`;
}
function renderClue(st) {
  Snd.play('q'); grabWake(); stopTimer();
  const cluer = st.cluer || {};
  const bottomLeave = ''; // الخروج أثناء اللعب من زر الباب فوق
  if (st.youAreCluer) {
    if (st.sub === 'pick') {
      const locked = st.pickMode;
      app.innerHTML = `
        ${header('')}
        ${roundBadge(st)}
        <div class="card center">
          <div class="cluer-hero"><div class="big">🎯</div>
          <h3>دورك تلمّح!</h3>
          <div class="muted small">اختار تجيب كلمة من البنك ولا تكتب واحدة بنفسك — <b>ولازم تكمّل باللي اخترته</b></div></div>
        </div>
        <div class="card">
          <button class="btn primary big" id="pick-bank" ${locked === 'custom' ? 'disabled' : ''}>🎲 هات كلمة من البنك</button>
          <div class="center muted small mt" style="font-size:12px">تقدر تبدّلها لو صعبة (فاضل ${st.passesLeft})</div>
          <div class="or">أو</div>
          <div class="muted small mb">اكتب كلمتك انت واختار كاتيجوريتها</div>
          <input class="field" id="own-word" maxlength="40" placeholder="اكتب الاسم/الكلمة السرية..." ${locked === 'bank' ? 'disabled' : ''}>
          <div class="row wrap mt" style="justify-content:center">
            ${(st.catOptions || []).map((c, i) => `<span class="chip click cat-pick ${i === 0 ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${esc(c.name)}</span>`).join('')}
          </div>
          <button class="btn teal big mt" id="pick-own" ${locked === 'bank' ? 'disabled' : ''}>✍️ استخدم كلمتي</button>
        </div>`;
      $('#pick-bank').onclick = () => act('pickBank');
      let chosenCat = (st.catOptions && st.catOptions[0]) ? st.catOptions[0].id : null;
      $$('.cat-pick').forEach(el => el.onclick = () => { $$('.cat-pick').forEach(x => x.classList.remove('on')); el.classList.add('on'); chosenCat = el.dataset.cat; });
      $('#pick-own').onclick = async () => {
        const w = $('#own-word').value.trim();
        if (w.length < 2) return toast('اكتب كلمة صح', 'err');
        await act('pickCustom', { word: w, cat: chosenCat });
      };
      const lb0 = $('#leave-btn2'); if (lb0) lb0.onclick = async () => { if (await uiConfirm('تخرج من الروم؟ سكورك هيفضل محسوب', { emoji: '🚪', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
      return;
    }
    if (st.sub === 'hint') {
      app.innerHTML = `
        ${header('')}
        ${roundBadge(st)}
        <div class="secret-box">
          <div class="lbl">🤫 الكلمة السرية (انت بس شايفها)</div>
          <div class="word">${esc(st.secret)}</div>
          <div class="cat"><span class="chip">${st.cat ? st.cat.icon + ' ' + st.cat.name : ''}</span></div>
        </div>
        ${hintsPanel(st)}
        ${historyPanel(st)}
        <div class="card">
          <div class="clue-status">✍️ التلميحة <b>${st.cluesGiven + 1}</b> من ${st.maxClues} <span class="pts-chip">هم ${st.tier} · انت ${st.cluerTier}</span></div>
          <div class="center muted small mb">وصّف الكلمة من غير ما تكتبها — <b>${st.maxWords === 1 ? 'كلمة واحدة' : st.maxWords + ' كلمات'} كحد أقصى</b> (لحد ${st.hintLimits.perWord} حرف للكلمة)</div>
          <textarea class="field" id="hint-in" maxlength="${st.hintLimits.total}" placeholder="${st.maxWords === 1 ? 'كلمة واحدة توصّفها...' : 'وصّفها في ' + st.maxWords + ' كلمات...'}"></textarea>
          <div class="center muted small" id="wc" style="font-size:12px;margin-top:4px"></div>
          <button class="btn primary big mt" id="hint-ok">📤 ابعت التلميحة</button>
          ${st.cluesGiven === 0 && st.passesLeft > 0 ? `<button class="btn ghost big mt" id="pass-btn">🔀 الكلمة صعبة، بدّلها (فاضل ${st.passesLeft})</button>` : ''}
          ${st.cluesGiven > 0 ? '<button class="btn ghost big mt" id="giveup-btn">🏳️ مش عارف ألمّح تاني — اقفل الجولة</button>' : ''}
        </div>
        ${bottomLeave}`;
      const hi = $('#hint-in'), wc = $('#wc');
      const updWc = () => { const n = hi.value.trim().split(/\s+/).filter(Boolean).length; wc.textContent = n + '/' + st.maxWords + ' كلمة'; wc.style.color = n > st.maxWords ? 'var(--coral)' : ''; };
      hi.oninput = updWc; updWc();
      $('#hint-ok').onclick = async () => {
        const text = hi.value.trim();
        if (text.length < 2) return toast('اكتب تلميح أطول شوية', 'err');
        const r = await act('submitHint', { text });
        if (r.ok) Snd.play('clue');
      };
      const pb = $('#pass-btn'); if (pb) pb.onclick = () => act('pass');
      const gb = $('#giveup-btn'); if (gb) gb.onclick = async () => { if (await uiConfirm('تقفل الجولة من غير ما حد ياخد نقط؟', { emoji: '🏳️', okLabel: 'اقفل' })) act('giveUp'); };
    } else {
      app.innerHTML = `
        ${header('')}
        ${roundBadge(st)}
        ${st.deadline ? '<div class="timer" id="cbar"><div class="fill" style="width:100%"></div></div>' : ''}
        <div class="secret-box">
          <div class="lbl">🤫 الكلمة السرية</div>
          <div class="word">${esc(st.secret)}</div>
        </div>
        ${hintsPanel(st, true)}
        <div class="card">
          <div class="clue-status">👀 بيخمّنوا على تلميحتك رقم ${st.cluesGiven} <span class="pts-chip">هم ${st.tier} · انت ${st.cluerTier}</span></div>
          <div class="center muted small">خمّن <b id="g-n">${st.guessedIds.length}</b> من ${st.eligibleCount} — أول ما الكل يخمّن النتيجة تظهر لوحدها</div>
          <div class="answered-strip" id="g-strip">${avatarsOf(st, st.guessedIds)}</div>
          <div id="live-g" class="mt">${(st.liveGuesses || []).map(g => `<div class="guess-item"><span class="who">${g.avatar} ${esc(g.name)}</span><span class="gtext">${esc(g.text)}</span></div>`).join('') || '<div class="muted small center">لسه محدش خمّن...</div>'}</div>
        </div>
        ${bottomLeave}`;
      startCountdown(st.deadline);
    }
  } else {
    // مخمّن
    if (st.sub === 'pick') {
      app.innerHTML = `
        ${header('')}
        ${roundBadge(st)}
        <div class="card center">
          <div class="cluer-hero"><div class="big">🎯</div>
          <div class="clue-status"><span style="font-size:26px">${cluer.avatar || '🎤'}</span> <b>${esc(cluer.name || '')}</b> بيختار الكلمة...</div>
          <div class="muted small">جهّز نفسك 👀</div></div>
        </div>`;
      const lb1 = $('#leave-btn2'); if (lb1) lb1.onclick = async () => { if (await uiConfirm('تخرج من الروم؟ سكورك هيفضل محسوب', { emoji: '🚪', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
      return;
    }
    if (st.sub === 'hint') {
      app.innerHTML = `
        ${header('')}
        ${roundBadge(st)}
        <div class="card center">
          <div class="cluer-hero"><div class="big">✍️</div>
          <div class="clue-status"><span style="font-size:26px">${cluer.avatar || '🎤'}</span> <b>${esc(cluer.name || '')}</b> بيكتب التلميحة ${st.cluesGiven + 1}...</div>
          <div class="muted small">الكاتيجوري: <span class="chip">${st.cat ? st.cat.icon + ' ' + st.cat.name : ''}</span></div></div>
        </div>
        ${hintsPanel(st)}
        ${historyPanel(st)}
        ${bottomLeave}`;
    } else {
      app.innerHTML = `
        ${header('')}
        ${roundBadge(st)}
        ${st.deadline ? '<div class="timer" id="cbar"><div class="fill" style="width:100%"></div></div>' : ''}
        ${hintsPanel(st, true)}
        <div class="card">
          <div class="clue-status"><span class="pts-chip">جاوب صح دلوقتي = ${st.tier} نقطة</span> <span class="chip">${st.cat ? st.cat.icon + ' ' + st.cat.name : ''}</span></div>
          ${st.youGuessed
            ? `<div class="center mt" style="font-weight:900;color:var(--brass-hi)">تخمينك: «${esc(st.yourGuessText)}»</div>
               <div class="center muted small mt">تقدر تعدّله طول ما فيه حد لسه بيخمّن ✏️</div>
               <div class="row mt">
                 <input class="field grow" id="guess-in" maxlength="60" value="${esc(st.yourGuessText)}">
                 <button class="btn teal" id="guess-btn">✏️ عدّل</button>
               </div>`
            : `<div class="center muted small mb">⚠️ ليك تخمينة <b>واحدة</b> على التلميحة دي (تقدر تعدّلها قبل ما الكل يخلّص)</div>
               <div class="row mt">
                 <input class="field grow" id="guess-in" maxlength="60" placeholder="اكتب تخمينك...">
                 <button class="btn primary" id="guess-btn">🔒 خمّن</button>
               </div>`}
          <div class="center muted small mt">خمّن <b id="g-n">${st.guessedIds.length}</b> من ${st.eligibleCount}</div>
          <div class="answered-strip" id="g-strip">${avatarsOf(st, st.guessedIds)}</div>
        </div>
        ${historyPanel(st)}
        ${bottomLeave}`;
      startCountdown(st.deadline);
      const send = async () => {
        const inp = $('#guess-in'); if (!inp) return;
        const v = inp.value.trim(); if (!v) return;
        const r = await act('guess', { text: v });
        if (r.ok) Snd.play('pick');
      };
      const gb = $('#guess-btn'); if (gb) gb.onclick = send;
      const gi = $('#guess-in'); if (gi) gi.onkeydown = e => { if (e.key === 'Enter') send(); };
    }
  }
  const lb = $('#leave-btn2'); if (lb) lb.onclick = async () => { if (await uiConfirm('تخرج من الروم؟ سكورك هيفضل محسوب', { emoji: '🚪', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
}
function avatarsOf(st, ids) {
  return (ids || []).map(id => { const p = st.players.find(x => x.id === id); return p ? `<span class="a" title="${esc(p.name)}">${p.avatar}</span>` : ''; }).join('');
}
function patchClue(st) {
  const n = $('#g-n'); if (n) n.textContent = (st.guessedIds || []).length;
  const gs = $('#g-strip'); if (gs) gs.innerHTML = avatarsOf(st, st.guessedIds);
  const lg = $('#live-g'); if (lg && st.liveGuesses) lg.innerHTML = st.liveGuesses.map(g => `<div class="guess-item"><span class="who">${g.avatar} ${esc(g.name)}</span><span class="gtext">${esc(g.text)}</span></div>`).join('') || '<div class="muted small center">لسه محدش خمّن...</div>';
}

function renderReveal(st) {
  grabWake(); stopTimer();
  const R = st.result || {};
  if (R.solved) Snd.play('win'); else Snd.play('no');
  const board = st.players.slice().sort((a, b) => b.score - a.score);
  app.innerHTML = `
    ${header('')}
    ${roundBadge(st)}
    <div class="card center">
      <div class="secret-box" style="margin-bottom:12px">
        <div class="lbl">الكلمة كانت</div>
        <div class="word">${esc(R.secret)}</div>
        <div class="cat"><span class="chip">${R.cat ? R.cat.icon + ' ' + R.cat.name : ''}</span></div>
      </div>
      ${R.solved
        ? `<div style="font-weight:900;font-size:18px">${R.winners.map(w => `<div>${w.avatar} <span style="color:var(--brass-hi)">${esc(w.name)}</span> جابها! +${R.points}</div>`).join('')}</div>
           <div class="muted mt">و<b>${R.cluerAvatar} ${esc(R.cluerName)}</b> الملمّح خد <b style="color:var(--brass-hi)">+${R.cluerPoints}</b> (نص نقط التلميحة — وصّلها في ${R.hintsUsed})</div>`
        : `<div style="font-weight:900;font-size:17px">محدش عرف يجيبها 😅 مفيش نقط الجولة دي</div>
           <div class="muted mt">الملمّح كان <b>${R.cluerAvatar} ${esc(R.cluerName)}</b> — استهلك ${R.hintsUsed} تلميحة</div>`}
    </div>
    ${(R.hints || []).length ? `<div class="card"><h3 class="mb">التلميحات والتخمينات</h3>${R.hints.map(h => `
      <div class="guess-item" style="background:#123a2e"><span class="who">💡 تلميحة ${h.n}</span><span class="gtext">${esc(h.text)}</span></div>
      ${h.guesses.map(g => `<div class="guess-item ${g.correct ? 'correct' : ''}"><span class="who">${g.avatar} ${esc(g.name)}</span><span class="gtext">${esc(g.text)} ${g.correct ? '✅' : '❌'}</span></div>`).join('')}
    `).join('')}</div>` : ''}
    <div class="card">
      <h3 class="mb">📊 النقط دلوقتي</h3>
      ${board.map((p, i) => `<div class="rank-row ${p.id === st.you.id ? 'me' : ''}"><span class="pos">${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</span><span>${p.avatar}</span><span>${esc(p.name)}${p.left ? ' 🚪' : ''}</span><span class="sc">${p.score}</span></div>`).join('')}
    </div>
    <div class="card tight center">
      ${st.youReady ? '<div style="font-weight:900;color:var(--brass-hi)">تمام ✅ مستنيين الباقي</div>' : `<button class="btn primary big" id="ready-btn">${st.isLastRound ? '🏁 النتيجة النهائية' : '⬅️ الجولة الجاية'}</button>`}
      <div class="muted small mt">جاهزين: <span id="r-n">${st.readyIds.length}</span>/${st.players.filter(p => p.connected).length}</div>
      ${st.you.isHost ? '<button class="btn sm ghost mt" id="force-btn" style="width:100%">⏭️ كمّلوا من غير المتأخرين</button>' : ''}
    </div>`;
  const rb = $('#ready-btn'); if (rb) rb.onclick = async () => { Snd.play('pick'); const r = await act('readyNext'); if (r.ok) rb.outerHTML = '<div style="font-weight:900;color:var(--brass-hi)">تمام ✅ مستنيين الباقي</div>'; };
  const fb = $('#force-btn'); if (fb) fb.onclick = async () => { if (await uiConfirm('تكمّلوا من غير المتأخرين؟', { emoji: '⏭️', okLabel: 'كمّل', danger: false })) act('forceNext'); };
  const lb = $('#leave-btn2'); if (lb) lb.onclick = async () => { if (await uiConfirm('تخرج من الروم؟ سكورك هيفضل محسوب', { emoji: '🚪', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
}
function patchReveal(st) { const n = $('#r-n'); if (n) n.textContent = st.readyIds.length; }

function confetti() {
  const box = document.createElement('div'); box.className = 'confetti';
  const colors = ['#12b981', '#34e0a8', '#22d3ee', '#fbbf24', '#F4EDDF'];
  for (let i = 0; i < 90; i++) { const s = document.createElement('i'); s.style.left = Math.random() * 100 + 'vw'; s.style.background = colors[i % colors.length]; s.style.animationDuration = (2.2 + Math.random() * 2) + 's'; s.style.animationDelay = (Math.random() * .8) + 's'; s.style.transform = 'rotate(' + Math.random() * 360 + 'deg)'; box.appendChild(s); }
  document.body.appendChild(box); setTimeout(() => box.remove(), 5200);
}
function renderGameover(st) {
  stopTimer(); const R = st.results, me = st.you; const hostP = st.players.find(p => p.isHost) || {};
  Snd.play('win'); confetti();
  const top3 = R.ranking.slice(0, 3);
  const pod = i => top3[i] ? `<div class="pod p${i + 1}"><div class="pav">${top3[i].avatar}</div><div class="pnm">${esc(top3[i].name)}</div><div class="psc">${top3[i].score}</div><div class="bar">${i + 1}</div></div>` : '';
  app.innerHTML = `${header('خلصت اللعبة! 🎉')}
    <div class="bunting teal"></div>
    <div class="card center"><h2 class="display" style="font-size:30px">🏆 نتيجة السهرة</h2><div class="podium">${pod(1)}${pod(0)}${pod(2)}</div></div>
    <div class="card"><h3 class="mb">🎖️ الجوايز</h3>${R.awards.map(a => `<div class="award"><span class="aic">${a.icon}</span><div><div class="at">${esc(a.title)}: ${esc(a.who)}</div><div class="ad">${esc(a.detail)}</div></div></div>`).join('')}</div>
    <div class="card"><h3 class="mb">📊 الترتيب</h3>${R.ranking.map(p => `<div class="rank-row ${p.id === me.id ? 'me' : ''}"><span class="pos">#${p.rank}</span><span>${p.avatar}</span><span>${esc(p.name)}${p.left ? ' <span class="muted small">🚪</span>' : ''}</span><span class="muted small">(${p.solved} جابها · ${p.cluedSuccess} وصّل)</span><span class="sc">${p.score}</span></div>`).join('')}</div>
    <div class="card"><h3 class="mb">📚 مراجعة الجولات</h3>${R.review.map(rd => `
      <details class="review"><summary><span>${rd.cat ? rd.cat.icon : '🎤'}</span><span>ج${rd.round}: ${esc(rd.secret)}</span><span class="muted small" style="margin-inline-start:auto">${rd.solved ? '✅' : '❌'}</span></summary>
      <div class="rv-body"><div class="muted small mt">الملمّح: ${rd.cluerAvatar} ${esc(rd.cluerName)} — ${rd.solved ? 'وصّلها لـ ' + esc(rd.solverName) + ' (' + rd.cluesUsed + ' تلميحة)' : 'محدش عرف'}</div></div></details>`).join('')}</div>
    ${me.isHost ? `<button class="btn primary big" id="again-btn">🔄 نلعب تاني</button>` : `<div class="card tight center">جولة تانية؟ <b>${esc(hostP.name || '')}</b> 👑</div>`}
    <button class="btn ghost big mt" id="leave-btn">🏠 خروج</button>`;
  const ab = $('#again-btn'); if (ab) ab.onclick = () => act('playAgain');
  $('#leave-btn').onclick = async () => { if (await uiConfirm('تخرج من الروم؟', { emoji: '🏠', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
}

const LAMMAHA_STEPS = [
  ['🎯', 'اللعبة إيه؟', 'كل جولة، لاعب بيشوف اسم سري و<span class="hl">بيكتب تلميح</span> يوصّفه. الباقي بيقروا التلميح ويحاولوا يجيبوا الاسم. كله بالكتابة جوه اللعبة — مش لازم تكونوا مع بعض.'],
  ['⚙️', 'الهوست بيحدد', 'الكاتيجوريز، <span class="hl">المستوى</span> (🟢/🟡/🔴)، كام دور لكل لاعب، عدد التلميحات (1–10)، <span class="hl">وأقصى عدد كلمات في التلميحة</span>، وهل الملمّح مسموح يكتب الكلمة بنفسه.'],
  ['🎲', 'الملمّح بيختار الكلمة', 'لو الخيار مفتوح: <span class="hl">يا ياخد من البنك يا يكتب كلمة بنفسه</span> — ولازم يكمّل باللي اختاره. كلمة البنك يقدر يبدّلها لو صعبة، وكلمته هو مش بتتبدّل.'],
  ['✍️', 'التلميح', 'يوصّف الكلمة بكلامه في <span class="hl">حدود عدد الكلمات المسموح</span>. <span class="warn">النظام بيرفض أي تلميح فيه الاسم أو حاجة قريبة منه</span> — ومفيش لزق كلمات في بعض، فيه حد لطول الكلمة.'],
  ['🔒', 'التخمين', 'كل واحد ليه <span class="hl">تخمينة واحدة</span> على كل تلميحة، ومخفية عن الباقي. تقدر تعدّلها طول ما فيه حد لسه بيخمّن.'],
  ['🔁', 'كله غلط؟', 'التلميحة اللي بعدها بتيجي <span class="hl">تلقائي</span> والملمّح يكتب واحدة أوضح — لحد ما حد يجيبها أو التلميحات تخلص.'],
  ['💯', 'النقط', 'المخمّن بياخد حسب رقم التلميحة: <b>100 · 90 · 80 · 70 · 60 · 50 · 40 · 30 · 20 · 10</b>. <span class="hl">وكل اللي جابوها صح بياخدوا نفس النقط — مش بالأسرع</span>. والملمّح بياخد <span class="hl">نص النقط دي</span> (50 · 45 · 40 ...). ولو محدش عرف خالص، محدش بياخد حاجة.'],
  ['🧠', 'النظام هو الحَكَم', 'بيقبل تخمينك حتى لو فيه <span class="hl">غلطة إملائية بسيطة أو مكتوب إنجليزي أو مرادف معروف</span>. مفيش تحكيم بشري.'],
  ['🚪', 'حاجات مهمة', 'كل لاعب بيلمّح نفس عدد المرات (العشوائي بيغيّر الترتيب بس). الأسماء متتكررش في الروم أبدًا. وفوق شريط بيوضّح لو حد خرج من اللعبة وهو بيلعب ❗'],
];
function showHelp() {
  const ov = document.createElement('div'); ov.className = 'help-ov';
  ov.innerHTML = `<div class="help-card">
    <div class="help-hero"><img src="/img/lammaha.webp" alt=""><h2>خليك لمَّاح</h2><div class="sub">لمّح وخلّيهم يجيبوها 🎤</div></div>
    <div class="help-body">${LAMMAHA_STEPS.map(([e, t, d]) => `<div class="help-step"><div class="help-num">${e}</div><div><h4>${t}</h4><p>${d}</p></div></div>`).join('')}</div>
    <div class="help-foot"><label class="help-chk"><input type="checkbox" id="help-off"> متظهرش تاني في الجهاز ده</label><button class="btn primary big" id="help-ok">تمام، يلا نلعب 🚀</button></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { if ($('#help-off') && $('#help-off').checked) LS.set('lamma_help_off_lammaha', true); ov.remove(); };
  $('#help-ok').onclick = close; ov.onclick = e => { if (e.target === ov) close(); };
}

(async function boot() {
  document.body.addEventListener('pointerdown', () => Snd.ensure(), { once: true });
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (S.save && S.save.code && S.save.token) {
    const r = await api('/api/lammaha/join', { code: S.save.code, token: S.save.token });
    if (r.ok) { openStream(); return; }
    LS.del('lammaha_save'); S.save = null;
    if (r.gone) toast('الروم القديم خلص', 'err');
  }
  renderHome(urlRoom || '');
  if (!LS.get('lamma_help_off_lammaha', false)) setTimeout(showHelp, 350);
})();
