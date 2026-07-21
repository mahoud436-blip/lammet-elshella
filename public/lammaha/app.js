/* لمّحها — واجهة اللعبة (لمّة الشلة) */
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
    <div><div class="title display" style="color:var(--brass-hi)">لمّحها</div><div class="sub">${esc(sub || 'لمّح وخلّيهم يجيبوها 🎤')}</div></div>
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
  const key = st.phase + '|' + st.round + '|' + (st.phase === 'clue' ? (st.youAreCluer ? 'c' : 'g') + st.cluesGiven : '') + '|' + (st.youReady ? 'r' : '');
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
        ['maxClues', 'عدد التلميحات المسموحة في الجولة', 1, 6],
        ['maxPass', 'كام مرة يعدّي كلمة صعبة؟', 0, 5],
      ].map(([k, label, mn, mx]) => `
        <div class="mt center muted small">${label}</div>
        <div class="stepper">
          <button class="btn" data-min="${k}" ${isHost ? '' : 'disabled'}>−</button>
          <div class="val" style="color:var(--brass-hi)">${s[k]}</div>
          <button class="btn" data-plus="${k}" data-mn="${mn}" data-mx="${mx}" ${isHost ? '' : 'disabled'}>+</button>
        </div>`).join('')}
      <div class="mt center muted small">ترتيب الملمّح</div>
      <div class="row" style="justify-content:center">
        <span class="chip click ${s.order === 'random' ? 'on' : ''}" data-order="random">🎲 عشوائي</span>
        <span class="chip click ${s.order === 'turns' ? 'on' : ''}" data-order="turns">➡️ بالدور</span>
      </div>
      <div class="mt center muted small">وقت الجولة (اختياري)</div>
      <div class="row wrap" style="justify-content:center">
        ${[0, 60, 90, 120].map(t => `<span class="chip click ${s.clueTime === t ? 'on' : ''}" data-time="${t}">${t === 0 ? 'مفتوح ♾️' : t + ' ث'}</span>`).join('')}
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

function guessList(st) {
  if (!st.guesses.length) return '<div class="muted small center">لسه محدش خمّن...</div>';
  return st.guesses.map(g => `<div class="guess-item ${g.correct ? 'correct' : ''}"><span class="who">${g.avatar} <b>${esc(g.name)}</b></span><span class="gtext">${esc(g.text)}${g.correct ? ' ✅' : ''}</span></div>`).join('');
}

function renderClue(st) {
  Snd.play('q'); grabWake(); stopTimer();
  if (st.youAreCluer) {
    app.innerHTML = `
      ${header('')}
      ${roundBadge(st)}
      ${st.deadline ? '<div class="timer" id="cbar"><div class="fill" style="width:100%"></div></div>' : ''}
      <div class="secret-box">
        <div class="lbl">🤫 الكلمة السرية (انت بس شايفها)</div>
        <div class="word">${esc(st.secret)}</div>
        <div class="cat"><span class="chip">${st.cat ? st.cat.icon + ' ' + st.cat.name : ''}</span></div>
      </div>
      <div class="card">
        ${st.cluesGiven === 0 ? `
          <div class="center muted small mb">وصّفها لصحابك بصوتك من غير ما تقول الاسم — وأول ما تبدأ دوس تلميحة 💡</div>
          ${st.passesLeft > 0 ? `<button class="btn ghost big" id="pass-btn">🔀 الكلمة صعبة، عدّيها (فاضل ${st.passesLeft})</button>` : ''}
          <button class="btn primary big mt" id="clue-btn">💡 بدأت ألمّح — التلميحة الأولى</button>
        ` : `
          <div class="clue-status">لمّحت <b>${st.cluesGiven}</b> من ${st.maxClues} <span class="pts-chip">اللي يجيبها دلوقتي = ${st.nextPoints} ليك</span></div>
          <div id="glist" class="mt">${guessList(st)}</div>
          ${st.cluesLeft > 0
            ? `<button class="btn teal big mt" id="clue-btn">💡 محدش صح — لمّح تاني (${st.cluesLeft} فاضل)</button>`
            : '<div class="center muted small mt">خلّصت التلميحات! لو محدش عرف، عدّي الجولة</div>'}
          <button class="btn ghost big mt" id="giveup-btn">🏳️ محدش عرف — عدّي الجولة</button>
        `}
      </div>`;
    startCountdown(st.deadline);
    const pb = $('#pass-btn'); if (pb) pb.onclick = () => act('pass');
    const cb = $('#clue-btn'); if (cb) cb.onclick = () => { Snd.play('clue'); act(st.cluesGiven === 0 ? 'startClue' : 'clueAgain'); };
    const gb = $('#giveup-btn'); if (gb) gb.onclick = async () => { if (await uiConfirm('تعدّي الجولة من غير حد ياخد نقط؟', { emoji: '🏳️', okLabel: 'عدّي' })) act('giveUp'); };
    return;
  }
  // مخمّن
  const cluer = st.cluer || {};
  app.innerHTML = `
    ${header('')}
    ${roundBadge(st)}
    ${st.deadline ? '<div class="timer" id="cbar"><div class="fill" style="width:100%"></div></div>' : ''}
    <div class="card">
      <div class="clue-status"><span style="font-size:26px">${cluer.avatar || '🎤'}</span> <b>${esc(cluer.name || '')}</b> بيلمّح — <span class="chip">${st.cat ? st.cat.icon + ' ' + st.cat.name : ''}</span></div>
      ${st.cluesGiven === 0
        ? '<div class="cluer-hero"><div class="big">👂</div><div class="muted">جهّز نفسك.. سمّع كويس وأول ما يبدأ اكتب تخمينك</div></div>'
        : `<div class="clue-status"><span class="pts-chip">اللي يجيبها = 100 نقطة</span></div>`}
      <div class="row mt">
        <input class="field grow" id="guess-in" maxlength="60" placeholder="اكتب تخمينك..." ${st.cluesGiven === 0 ? 'disabled' : ''}>
        <button class="btn primary" id="guess-btn" ${st.cluesGiven === 0 ? 'disabled' : ''}>خمّن</button>
      </div>
      <div id="glist" class="mt">${guessList(st)}</div>
    </div>`;
  startCountdown(st.deadline);
  const send = async () => {
    const inp = $('#guess-in'); const v = inp.value.trim();
    if (!v) return;
    inp.value = '';
    const r = await act('guess', { text: v });
    if (r.ok && r.correct) Snd.play('ok');
    else if (r.ok) Snd.play('pick');
  };
  const gb = $('#guess-btn'); if (gb) gb.onclick = send;
  const gi = $('#guess-in'); if (gi) gi.onkeydown = e => { if (e.key === 'Enter') send(); };
}
function patchClue(st) {
  const gl = $('#glist'); if (gl) gl.innerHTML = guessList(st);
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
        ? `<div style="font-weight:900;font-size:18px"><span style="color:var(--brass-hi)">${R.solverAvatar} ${esc(R.solverName)}</span> جابها! 🎉 <span style="color:var(--brass-hi)">+100</span></div>
           <div class="muted mt">و<b>${R.cluerAvatar} ${esc(R.cluerName)}</b> الملمّح خد <b style="color:var(--brass-hi)">+${R.cluerPoints}</b> (بعد ${R.cluesUsed} تلميحة)</div>`
        : `<div style="font-weight:900;font-size:17px">محدش عرف يجيبها 😅 مفيش نقط الجولة دي</div>
           <div class="muted mt">الملمّح كان <b>${R.cluerAvatar} ${esc(R.cluerName)}</b></div>`}
    </div>
    ${R.guesses && R.guesses.length ? `<div class="card"><h3 class="mb">التخمينات</h3>${R.guesses.map(g => `<div class="guess-item ${g.correct ? 'correct' : ''}"><span class="who">${g.avatar} ${esc(g.name)}</span><span class="gtext">${esc(g.text)}${g.correct ? ' ✅' : ''}</span></div>`).join('')}</div>` : ''}
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
  ['🏠', 'اعملوا روم', 'واحد يعمل روم والباقي (من 3 لـ 12) يدخلوا بالكود أو الـQR من موبايلهم.'],
  ['⚙️', 'الهوست يظبّط', 'بيختار <span class="hl">الكاتيجوريز</span> (كورة، بلاد، حيوانات، أكل، شخصيات...)، <span class="hl">كام دور يلمّح كل لاعب</span>، <span class="hl">عدد التلميحات</span> المسموحة، ومرات «عدّي الكلمة الصعبة»، والترتيب عشوائي ولا بالدور.'],
  ['🤫', 'كلمة سرية للملمّح', 'كل جولة، لاعب واحد بس بيشوف <span class="hl">اسم سري</span> (لاعب كورة/بلد/حاجة). الباقي مش شايفينه.'],
  ['🎤', 'لمّح بصوتك', 'الملمّح بيوصّف الاسم لصحابه بصوته (انتوا قاعدين مع بعض) <span class="warn">من غير ما يقول الاسم نفسه</span>. صعبة أوي؟ يقدر يعدّيها قبل ما يبدأ.'],
  ['⌨️', 'الباقي يخمّنوا', 'كل واحد بيكتب تخمينه، والتخمينات بتظهر للكل. النظام بيطابق بذكاء — <span class="hl">حتى لو فيه غلطة إملائية بسيطة أو كتبت بالإنجليزي</span> بيقبلها.'],
  ['🏆', 'النقط', 'أول واحد يجيبها صح: <span class="hl">هو ياخد 100 والملمّح ياخد نقط كمان</span> (بتقل كل ما ياخد تلميحات أكتر — لمّح بأقل تلميح تكسب أكتر). لو التلميحات خلصت ومحدش عرف؟ محدش ياخد نقط.'],
  ['👀', 'نضيف وآمن', 'شريط فوق بأيقونة كل لاعب — اللي يطلّع الشاشة يدوّر على الإجابة بتنوّر عليه ❗ قدام الكل. وتقدر تخرج بـ 🚪 أي وقت وسكورك محفوظ.'],
];
function showHelp() {
  const ov = document.createElement('div'); ov.className = 'help-ov';
  ov.innerHTML = `<div class="help-card">
    <div class="help-hero"><img src="/img/lammaha.webp" alt=""><h2>لمّحها</h2><div class="sub">لمّح وخلّيهم يجيبوها 🎤</div></div>
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
