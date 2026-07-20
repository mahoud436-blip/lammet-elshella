/* حبر سري — واجهة اللعبة (لمّة الشلة) */
'use strict';

/* ======================= أدوات ======================= */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const app = $('#app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
const AVATARS = ['😂','🤣','😆','😄','😁','😜','🤪','😝','🥳','🙃','😅','🤭','😛','😋','🤩','😎','🤠','🥸','🤡','😺','😹','👽','🤖','👻'];
const SRC_TAG = { writer: '✍️ كتبه واحد غامض 🤫', vote: '🗳️ بالتصويت', random: '🎲 عنوان عشوائي' };

/* ======================= الصوت ======================= */
const Snd = {
  ctx: null, muted: LS.get('wisper_mute', false),
  ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  tone(f, t0, dur, type, vol) {
    if (this.muted || !this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || .18, t0 + .02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t0); o.stop(t0 + dur + .05);
  },
  play(name) {
    this.ensure(); if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    if (name === 'pick') this.tone(520, t, .09, 'square', .12);
    if (name === 'q') { this.tone(392, t, .12); this.tone(523, t + .12, .16); }
    if (name === 'ok') { [523, 659, 784].forEach((f, i) => this.tone(f, t + i * .09, .14)); }
    if (name === 'no') { this.tone(196, t, .22, 'sawtooth', .12); this.tone(147, t + .18, .3, 'sawtooth', .12); }
    if (name === 'win') { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, t + i * .11, .16, 'triangle', .2)); }
    if (name === 'tick') this.tone(880, t, .05, 'square', .06);
  },
  toggle() { this.muted = !this.muted; LS.set('wisper_mute', this.muted); toast(this.muted ? 'الصوت اتقفل 🔇' : 'الصوت اتفتح 🔊'); }
};

/* ======================= الحالة ======================= */
const S = {
  save: LS.get('wisper_save', null),
  name: LS.get('wisper_name', LS.get('tahadi_name', '')),
  avatar: LS.get('wisper_av', AVATARS[Math.floor(Math.random() * AVATARS.length)]),
  st: null, es: null, lastMsg: 0, skew: 0,
  viewKey: '', wake: null,
};

/* ======================= API ======================= */
async function api(path, body) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return await r.json();
  } catch (e) { return { ok: false, error: 'مفيش اتصال بالسيرفر 📡' }; }
}
async function act(action, extra) {
  if (!S.save) return { ok: false };
  const r = await api('/api/wisper/action', Object.assign({ code: S.save.code, token: S.save.token, action }, extra || {}));
  if (!r.ok && r.error) toast(r.error, 'err');
  return r;
}

/* ======================= الاتصال المستمر ======================= */
function openStream() {
  if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; }
  if (!S.save) return;
  const es = new EventSource('/api/wisper/stream?code=' + encodeURIComponent(S.save.code) + '&token=' + encodeURIComponent(S.save.token));
  S.es = es;
  es.onmessage = ev => {
    S.lastMsg = Date.now();
    $('#net-banner').classList.add('hidden');
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
  if (document.visibilityState === 'visible' && S.save) {
    if (!S.es || S.es.readyState === 2 || Date.now() - S.lastMsg > 20000) openStream();
    grabWake();
  }
});
function grabWake() {
  if (!('wakeLock' in navigator)) return;
  if (S.st && S.st.phase !== 'lobby' && S.st.phase !== 'gameover') navigator.wakeLock.request('screen').then(w => { S.wake = w; }).catch(() => {});
}
function leaveLocal() {
  if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; }
  S.save = null; LS.del('wisper_save');
  S.st = null; S.viewKey = '';
  renderHome();
}

/* ======================= هيدر ======================= */
function header(sub) {
  return `<div class="bunting"></div>
  <div class="top">
    <img src="/img/wisper-sm.png" alt="">
    <div><div class="title display" style="color:var(--teal)">حبر سري</div><div class="sub">${esc(sub || 'اكتبها في السر.. وخمّن مين كتب إيه 🕵️')}</div></div>
    <button class="btn sm ghost" id="help-btn" style="margin-inline-start:auto">؟</button>
    <button class="btn sm ghost" id="home-btn">🏠</button>
    <button class="btn sm ghost" id="mute-btn">${Snd.muted ? '🔇' : '🔊'}</button>
  </div>
  ${S.save ? '<button class="leave-fab" id="leave-fab" title="اخرج من الروم">🚪</button>' : ''}`;
}
function bindHeader() {}
/* تفويض عام: الأزرار شغالة في كل الشاشات دايمًا */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('#help-btn,#home-btn,#mute-btn,#leave-fab');
  if (!t) return;
  if (t.id === 'help-btn') { Snd.ensure(); showHelp(); }
  else if (t.id === 'home-btn') {
    if (S.save && !confirm('ترجع للمّة؟ (مكانك في الروم محفوظ وتقدر ترجعله)')) return;
    location.href = '/';
  }
  else if (t.id === 'mute-btn') { Snd.toggle(); t.textContent = Snd.muted ? '🔇' : '🔊'; }
  else if (t.id === 'leave-fab') {
    if (!confirm('تخرج من الروم؟ 🤔 سكورك هيفضل محسوب في النتيجة النهائية')) return;
    await act('leave'); leaveLocal();
  }
});

/* ======================= شاشة البداية ======================= */
function renderHome(prefillCode) {
  S.viewKey = 'home';
  stopTimer();
  const urlRoom = new URLSearchParams(location.search).get('room') || '';
  const code = prefillCode || urlRoom;
  app.innerHTML = `
    ${header('اعمل روم أو ادخل مع صحابك بكود')}
    <div class="card">
      <div class="row">
        <button class="avatar-big" id="av-btn" title="غيّر الشكل">${S.avatar}</button>
        <div class="grow">
          <label class="muted small">اسمك في اللعبة</label>
          <input class="field" id="name-in" maxlength="16" placeholder="مثلًا: ميدو 😎" value="${esc(S.name)}">
        </div>
      </div>
      <button class="btn primary big mt" id="create-btn">🖋️ اعمل روم جديد</button>
      <div class="or">أو</div>
      <input class="field code-input" id="code-in" inputmode="numeric" maxlength="4" placeholder="• • • •" value="${esc(code)}">
      <button class="btn teal big mt" id="join-btn">🚪 ادخل الروم</button>
    </div>
    <div class="card tight center muted small">من 3 لـ 15 لاعب — كل واحد من متصفح موبايله 📱</div>`;
  bindHeader();
  $('#av-btn').onclick = () => {
    Snd.play('pick');
    S.avatar = AVATARS[(AVATARS.indexOf(S.avatar) + 1) % AVATARS.length];
    LS.set('wisper_av', S.avatar);
    $('#av-btn').textContent = S.avatar;
  };
  const nameIn = $('#name-in');
  nameIn.oninput = () => { S.name = nameIn.value; LS.set('wisper_name', S.name); };
  $('#create-btn').onclick = async () => {
    Snd.ensure();
    const name = nameIn.value.trim();
    if (!name) return toast('اكتب اسمك الأول ✍️', 'err');
    const r = await api('/api/wisper/create', { name, avatar: S.avatar });
    if (!r.ok) return toast(r.error || 'مشكلة', 'err');
    S.save = { code: r.code, token: r.token }; LS.set('wisper_save', S.save);
    openStream();
  };
  $('#join-btn').onclick = async () => {
    Snd.ensure();
    const name = nameIn.value.trim();
    const c = $('#code-in').value.trim();
    if (!name) return toast('اكتب اسمك الأول ✍️', 'err');
    if (!/^\d{4}$/.test(c)) return toast('الكود 4 أرقام', 'err');
    const r = await api('/api/wisper/join', { code: c, name, avatar: S.avatar });
    if (!r.ok) return toast(r.error || 'مشكلة', 'err');
    S.save = { code: r.code, token: r.token }; LS.set('wisper_save', S.save);
    openStream();
  };
}

/* ======================= الراوتر ======================= */
function render() {
  const st = S.st;
  if (!st) return;
  const q = st.phase === 'write' ? (st.yourAnswer != null ? 'a' : 'n') : '';
  const key = st.phase + '|' + st.round + '|' + q + '|' + (st.youReady ? 'r' : '') + '|' + (st.gi != null ? st.gi : '');
  if (key === S.viewKey) {
    if (st.phase === 'lobby') return renderLobby(st);
    if (st.phase === 'topic') return patchTopic(st);
    if (st.phase === 'vote') return patchVote(st);
    if (st.phase === 'write') return patchWrite(st);
    if (st.phase === 'guess') return patchGuess(st);
    if (st.phase === 'reveal') return patchReveal(st);
    return;
  }
  S.viewKey = key;
  if (st.phase === 'lobby') renderLobby(st);
  else if (st.phase === 'topic') renderTopic(st);
  else if (st.phase === 'vote') renderVote(st);
  else if (st.phase === 'write') renderWrite(st);
  else if (st.phase === 'guess') renderGuess(st);
  else if (st.phase === 'reveal') renderReveal(st);
  else if (st.phase === 'gameover') renderGameover(st);
}

/* ======================= اللوبي ======================= */
function joinUrl(st) {
  const loc = location;
  if ((loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') && st.net && !st.net.hosted && st.net.ips && st.net.ips.length)
    return 'http://' + st.net.ips[0] + ':' + st.net.port + '/wisper/?room=' + st.code;
  return loc.origin + '/wisper/?room=' + st.code;
}
function renderLobby(st) {
  stopTimer();
  const me = st.you, isHost = me.isHost;
  const url = joinUrl(st);
  const hostName = (st.players.find(p => p.isHost) || {}).name || '';
  const s = st.settings;
  const total = (s.writerRounds || 0) + (s.voteRounds || 0) + (s.randomRounds || 0);
  const canStart = st.players.length >= 3 && total >= 1 && total <= 15;
  app.innerHTML = `
    ${header('ابعت الكود لصحابك وكل واحد يدخل من موبايله')}
    <div class="card center">
      <div class="muted">كود الروم</div>
      <div class="room-code" id="code-copy" title="دوس للنسخ" style="color:var(--teal)">${st.code}</div>
      <div class="join-url mt" id="url-copy" title="دوس للنسخ">${esc(url)}</div>
      <div class="qr-wrap" id="qr"></div>
      <div class="muted small">صوّر الكود بكاميرا الموبايل وهتدخل على طول 📸</div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:10px">اللاعيبة (${st.players.length}/15)</h3>
      <div class="players-grid">${st.players.map(p => `
        <div class="p-tile ${p.connected ? '' : 'off'}">
          ${p.isHost ? '<span class="crown">👑</span>' : ''}
          ${isHost && !p.isHost ? `<button class="kick" data-kick="${p.id}">✕</button>` : ''}
          <div class="av">${p.avatar}</div>
          <div class="nm">${esc(p.name)}${p.id === me.id ? ' (انت)' : ''}</div>
          <div class="st">${p.left ? 'خرج 🚪' : (p.connected ? 'موجود ✅' : 'اتفصل ⏳')}</div>
        </div>`).join('')}
      </div>
      ${st.players.length < 3 ? '<div class="center muted small mt">محتاجين 3 على الأقل — التخمين بين اتنين مش لعبة 😄</div>' : ''}
    </div>
    <div class="card">
      <h3>جولات اللعبة ${isHost ? '' : '<span class="muted small">(بيظبطها ' + esc(hostName) + ' 👑)</span>'}</h3>
      <div class="muted small center mt">حدد عدد الجولات من كل نوع — والترتيب هيتخلط عشوائي 🎲</div>
      ${[
        ['writerRounds', '✍️ لاعب عشوائي يكتب العنوان'],
        ['voteRounds', '🗳️ تصويت بين 3 عناوين'],
        ['randomRounds', '🎲 عنوان عشوائي من البنك'],
      ].map(([k, label]) => `
        <div class="mt center muted small">${label}</div>
        <div class="stepper">
          <button class="btn" data-min="${k}" ${isHost ? '' : 'disabled'}>−</button>
          <div class="val" style="color:var(--teal)">${s[k]}</div>
          <button class="btn" data-plus="${k}" ${isHost ? '' : 'disabled'}>+</button>
        </div>`).join('')}
      <div class="count-note mt" style="font-size:17px">الإجمالي: <b style="color:var(--brass-hi)">${total}</b> جولة</div>
      ${total > 15 ? '<div class="center" style="color:var(--coral);font-weight:800">أقصى حاجة 15 جولة!</div>' : ''}
      ${total < 1 ? '<div class="center muted small">حدد جولة واحدة على الأقل</div>' : ''}
    </div>
    ${isHost
      ? `<button class="btn primary big" id="start-btn" ${canStart ? '' : 'disabled'}>🚀 يلا نبدأ</button>`
      : `<div class="card tight center">مستنيين <b>${esc(hostName)}</b> 👑 يدوس بدء 🚀</div>`}
    <button class="btn ghost big mt" id="leave-btn">🚪 اخرج من الروم</button>`;
  bindHeader();
  try {
    const q = window.qrcode(0, 'M'); q.addData(url); q.make();
    let svg = '';
    try { svg = q.createSvgTag({ cellSize: 4, margin: 2 }); } catch (e) { svg = q.createSvgTag(4, 2); }
    $('#qr').innerHTML = svg;
  } catch (e) { $('#qr').classList.add('hidden'); }
  const copy = txt => { (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('اتنسخ ✅', 'ok')).catch(() => {}); };
  $('#code-copy').onclick = () => copy(st.code);
  $('#url-copy').onclick = () => copy(url);
  if (isHost) {
    $$('[data-plus]').forEach(b => b.onclick = () => { const k = b.dataset.plus; act('setSettings', { settings: { [k]: Math.min(10, st.settings[k] + 1) } }); });
    $$('[data-min]').forEach(b => b.onclick = () => { const k = b.dataset.min; act('setSettings', { settings: { [k]: Math.max(0, st.settings[k] - 1) } }); });
    $('#start-btn').onclick = () => { Snd.play('q'); act('startGame'); };
    $$('.kick').forEach(b => b.onclick = () => { if (confirm('متأكد عايز تطرده؟')) act('kick', { playerId: b.dataset.kick }); });
  }
  $('#leave-btn').onclick = async () => { if (confirm('تخرج من الروم؟')) { await act('leave'); leaveLocal(); } };
}

/* ======================= عناصر مشتركة ======================= */
function roundBadge(st) {
  const t = { writer: '✍️ جولة كتابة', vote: '🗳️ جولة تصويت', random: '🎲 جولة عشوائية' }[st.roundType] || '';
  return `<div class="center mb"><span class="chip on">الجولة ${st.round} من ${st.totalRounds}</span> <span class="chip">${t}</span></div>`;
}
function topicBanner(st) {
  const src = SRC_TAG[st.topicSource] || '';
  return `<div class="topic-banner"><div class="tl">عنوان الجولة ${src ? '· ' + src : ''}</div><div class="tx">${esc(st.topic)}</div></div>`;
}
function avatarsOf(st, ids) {
  return (ids || []).map(id => { const p = st.players.find(x => x.id === id); return p ? `<span class="a" title="${esc(p.name)}">${p.avatar}</span>` : ''; }).join('');
}
function hostForce(st, label) {
  return st.you.isHost ? `<button class="btn sm ghost mt" id="force-btn" style="width:100%">⏭️ ${label}</button>` : '';
}
function bindForce() { const f = $('#force-btn'); if (f) f.onclick = () => { if (confirm('تعدّي المرحلة دي؟ (للطوارئ لو حد نايم 😴)')) act('forceContinue'); }; }

let timerRAF = null;
function stopTimer() { if (timerRAF) cancelAnimationFrame(timerRAF); timerRAF = null; }
function startCountdown(deadline, startedApprox) {
  const el = $('#cbar'); if (!el || !deadline) return;
  const fill = $('.fill', el);
  const total = deadline - (startedApprox || (Date.now() + S.skew));
  const loop = () => {
    const remain = deadline - (Date.now() + S.skew);
    const pct = Math.max(0, Math.min(100, remain / Math.max(total, 1) * 100));
    fill.style.width = pct + '%';
    el.classList.toggle('low', pct < 25);
    if (remain > 0) timerRAF = requestAnimationFrame(loop);
  };
  stopTimer();
  timerRAF = requestAnimationFrame(loop);
}

/* ======================= مرحلة العنوان (كاتب عشوائي) ======================= */
function renderTopic(st) {
  Snd.play('q');
  grabWake();
  if (st.youAreWriter) {
    app.innerHTML = `
      ${header('')}
      ${roundBadge(st)}
      <div class="card">
        <div class="center" style="font-size:44px">✍️</div>
        <h2 class="display center">دورك! اكتب عنوان الجولة</h2>
        <div class="center"><span class="chip">🤫 محدش عارف إنك انت اللي بتكتب</span></div>
        <div class="center muted small mb">اكتب سؤال أو عنوان الكل هيجاوب عليه في السر</div>
        <div class="timer" id="cbar"><div class="fill" style="width:100%"></div></div>
        <input class="field" id="topic-in" maxlength="80" placeholder="مثلًا: أكتر حاجة نفسك تشتريها دلوقتي">
        <div class="muted small mt">اقتراحات من البنك (دوس تتحط في الخانة):</div>
        <div class="row wrap mt" id="sugg">${(st.suggestions || []).map(t => `<span class="chip click" data-s="${esc(t)}">${esc(t)}</span>`).join('')}</div>
        <button class="btn primary big mt" id="topic-ok">تأكيد العنوان ✅</button>
        <button class="btn teal big mt" id="topic-rand">🎲 مش عارف؟ هات عشوائي</button>
      </div>`;
    bindHeader();
    startCountdown(st.deadline);
    $$('#sugg .chip').forEach(c => c.onclick = () => { $('#topic-in').value = c.dataset.s; Snd.play('pick'); });
    $('#topic-ok').onclick = async () => {
      const text = $('#topic-in').value.trim();
      if (text.length < 3) return toast('اكتب عنوان أطول شوية', 'err');
      const r = await act('submitTopic', { text });
      if (r.ok) Snd.play('ok');
    };
    $('#topic-rand').onclick = () => act('topicRandom');
    return;
  }
  app.innerHTML = `
    ${header('')}
    ${roundBadge(st)}
    <div class="card center">
      <div class="timer" id="cbar"><div class="fill" style="width:100%"></div></div>
      <div class="writer-line"><span style="font-size:38px">🤫</span> <b>حد من الشلة</b> بيكتب عنوان الجولة...</div>
      <div class="answered-strip"><span class="a">🖋️</span><span class="a">❓</span><span class="a">✨</span></div>
      <div class="muted small">مين؟ محدش عارف 😏 — أول ما يكتب، الكل هيجاوب في السر</div>
    </div>
    ${hostForce(st, 'عدّيها بعنوان عشوائي')}`;
  bindHeader(); bindForce();
  startCountdown(st.deadline);
}
function patchTopic(st) { /* الاسم والوقت ثابتين — مفيش حاجة تتحدث لايف */ }

/* ======================= التصويت ======================= */
function renderVote(st) {
  Snd.play('q');
  grabWake();
  app.innerHTML = `
    ${header('')}
    ${roundBadge(st)}
    <div class="card">
      <h3 class="center mb">🗳️ صوّتوا على عنوان الجولة</h3>
      <div class="timer" id="cbar"><div class="fill" style="width:100%"></div></div>
      <div id="vote-list">
        ${st.voteOptions.map((t, i) => `<button class="vote-opt ${st.yourVote === i ? 'on' : ''}" data-v="${i}">${esc(t)}</button>`).join('')}
      </div>
      <div class="center muted small mt">صوّت <b id="v-count">${st.votedCount}</b> من ${st.players.filter(p => p.connected).length}</div>
      <div class="answered-strip" id="v-strip">${avatarsOf(st, st.votedIds)}</div>
      <div class="center muted small">تقدر تغيّر صوتك لحد ما الكل يصوّت — والتعادل بالقرعة 🎲</div>
    </div>
    ${hostForce(st, 'اقفل التصويت')}`;
  bindHeader(); bindForce();
  startCountdown(st.deadline);
  $$('#vote-list .vote-opt').forEach(b => b.onclick = async () => {
    Snd.play('pick');
    $$('#vote-list .vote-opt').forEach(x => x.classList.toggle('on', x === b));
    await act('vote', { choice: parseInt(b.dataset.v, 10) });
  });
}
function patchVote(st) {
  const c = $('#v-count'); if (c) c.textContent = st.votedCount;
  const s = $('#v-strip'); if (s) s.innerHTML = avatarsOf(st, st.votedIds);
  $$('#vote-list .vote-opt').forEach((x, i) => x.classList.toggle('on', st.yourVote === i));
}

/* ======================= كتابة الإجابة ======================= */
function renderWrite(st) {
  Snd.play('q');
  grabWake();
  stopTimer();
  const submitted = st.yourAnswer != null;
  app.innerHTML = `
    ${header('')}
    ${roundBadge(st)}
    ${topicBanner(st)}
    <div class="card">
      <label class="muted small">إجابتك (في السر 🤫)</label>
      <textarea class="field mt" id="ans-in" maxlength="140" placeholder="اكتب إجابتك هنا...">${esc(st.yourAnswer || '')}</textarea>
      <button class="btn primary big mt" id="ans-ok">${submitted ? '🔁 عدّل وسلّم تاني' : '✅ سلّم إجابتي'}</button>
      <div class="center muted small mt" id="w-status">${submitted ? 'اتسلمت ✅ — تقدر تعدلها لحد ما الكل يخلص' : 'محدش هيشوف إجابتك غير وقت التخمين'}</div>
    </div>
    <div class="card tight center">
      <div class="muted small">سلّم <b id="w-count">${st.submittedIds.length}</b> من ${st.players.filter(p => p.connected).length}</div>
      <div class="answered-strip" id="w-strip">${avatarsOf(st, st.submittedIds)}</div>
    </div>
    ${hostForce(st, 'كفاية كده وابدأوا التخمين')}`;
  bindHeader(); bindForce();
  $('#ans-ok').onclick = async () => {
    const text = $('#ans-in').value.trim();
    if (!text) return toast('اكتب إجابتك الأول', 'err');
    const r = await act('submitAnswer', { text });
    if (r.ok) { Snd.play('ok'); const b = $('#ans-ok'); if (b) b.textContent = '🔁 عدّل وسلّم تاني'; const ws = $('#w-status'); if (ws) ws.textContent = 'اتسلمت ✅ — تقدر تعدلها لحد ما الكل يخلص'; }
  };
}
function patchWrite(st) {
  const c = $('#w-count'); if (c) c.textContent = st.submittedIds.length;
  const s = $('#w-strip'); if (s) s.innerHTML = avatarsOf(st, st.submittedIds);
  if (st.yourAnswer != null) {
    const b = $('#ans-ok'); if (b) b.textContent = '🔁 عدّل وسلّم تاني';
    const ws = $('#w-status'); if (ws) ws.textContent = 'اتسلمت ✅ — تقدر تعدلها لحد ما الكل يخلص';
    const ta = $('#ans-in'); if (ta && document.activeElement !== ta && !ta.value) ta.value = st.yourAnswer;
  }
}

/* ======================= التخمين (إجابة واحدة كل مرة) ======================= */
const OWNER_WAIT_LINES = [
  'دي إجابتك انت! استنى وشوفهم محتارين 😏',
  'إجابتك بتلعب بيهم دلوقتي.. اتفرج 🎭',
  'خليك كول 😎 دي بتاعتك وهما مش واخدين بالهم',
  'اقعد اتفرج عليهم وهما بيغرقوا في التخمين 🤿',
];
function renderGuess(st) {
  grabWake();
  stopTimer();
  const cur = st.current;
  if (!cur) { app.innerHTML = header(''); return; }
  const usedElsewhere = new Set(Object.entries(st.yourGuesses || {}).filter(([aid]) => aid !== cur.id).map(([, pid]) => pid));
  app.innerHTML = `
    ${header('')}
    ${roundBadge(st)}
    ${topicBanner(st)}
    <div class="card tight center">
      <span class="chip on">🕵️ الإجابة ${st.gi + 1} من ${st.gTotal}</span>
    </div>
    <div class="card">
      <div class="ansmatch ${cur.isYours ? 'yours' : ''}" style="margin-bottom:0">
        <div class="atx" style="font-size:20px">«${esc(cur.text)}»</div>
        ${cur.isYours ? `
          <div class="center mt" style="font-weight:900;color:var(--teal);font-size:16px">${OWNER_WAIT_LINES[st.gi % OWNER_WAIT_LINES.length]}</div>
        ` : `
          <div class="muted small mt mb">مين اللي كتبها؟ — كل اسم ينفع مرة واحدة في الجولة</div>
          <div class="roster-grid" id="roster">
            ${st.roster.map(r => `
              <button class="roster-btn ${st.yourPick === r.id ? 'on' : ''}" data-r="${r.id}" ${usedElsewhere.has(r.id) ? 'disabled' : ''}>
                <span style="font-size:22px">${r.avatar}</span><span>${esc(r.name)}</span>
                ${usedElsewhere.has(r.id) ? '<span class="hint">اتقفل مع إجابة فاتت</span>' : ''}
              </button>`).join('')}
          </div>
          <div class="center muted small mt" id="g-status">${st.yourPick ? 'اختيارك اتسجل ✅ — تقدر تغيّره لحد ما الكل يختار' : 'دوس على اسم'}</div>
        `}
      </div>
    </div>
    <div class="card tight center">
      <div class="muted small">اختاروا: <span id="g-n">${st.pickedIds.length}</span>/${st.eligibleCount}</div>
      <div class="answered-strip" id="g-strip">${avatarsOf(st, st.pickedIds)}</div>
      <div class="muted small">أول ما الكل يختار → الإجابة اللي بعدها لوحدها ⬅️</div>
    </div>
    ${hostForce(st, 'عدّي الإجابة دي')}`;
  bindHeader(); bindForce();
  $$('#roster .roster-btn').forEach(b => b.onclick = async () => {
    Snd.play('pick');
    $$('#roster .roster-btn').forEach(x => x.classList.toggle('on', x === b));
    const gs = $('#g-status'); if (gs) gs.textContent = 'اختيارك اتسجل ✅ — تقدر تغيّره لحد ما الكل يختار';
    await act('guess', { answerId: cur.id, playerId: b.dataset.r });
  });
}
function patchGuess(st) {
  const n = $('#g-n'); if (n) n.textContent = st.pickedIds.length;
  const s = $('#g-strip'); if (s) s.innerHTML = avatarsOf(st, st.pickedIds);
  $$('#roster .roster-btn').forEach(x => x.classList.toggle('on', st.yourPick === x.dataset.r));
}

/* ======================= النتيجة (Reveal) ======================= */
function renderReveal(st) {
  grabWake();
  stopTimer();
  const R = st.reveal || { answers: [], gains: {} };
  const myGain = R.gains[st.you.id] || 0;
  if (myGain > 0) Snd.play('ok'); else Snd.play('no');
  const board = st.players.slice().sort((a, b) => b.score - a.score);
  app.innerHTML = `
    ${header('')}
    ${roundBadge(st)}
    ${topicBanner({ topic: R.topic, topicSource: R.topicSource, topicByName: R.topicByName })}
    <div class="card center tight">
      <div style="font-family:'Lalezar';font-size:26px;color:${myGain > 0 ? 'var(--brass-hi)' : 'var(--ink-dim)'}">
        ${myGain > 0 ? `+${myGain} 🎉 الجولة دي` : 'ولا تخمينة صح المرة دي 😅'}
      </div>
    </div>
    ${R.answers.map(a => `
      <div class="ansmatch">
        <div class="atx">«${esc(a.text)}»</div>
        <div><span class="owner-chip">${a.ownerAvatar} كتبها: ${esc(a.ownerName)}</span></div>
        ${a.picks.map(pk => `
          <div class="pick-row ${pk.ok ? 'ok' : 'bad'}">
            <span>${pk.avatar}</span><span><b>${esc(pk.name)}</b></span>
            ${pk.ok ? '<span>جابها صح ✅ +100</span>' : `<span>فكرها بتاعة ${esc(pk.pickName)} ❌</span>`}
          </div>`).join('') || '<div class="muted small mt">محدش خمّن عليها</div>'}
      </div>`).join('')}
    <div class="card">
      <h3 class="mb">📊 النقط دلوقتي</h3>
      ${board.map((p, i) => `<div class="rank-row ${p.id === st.you.id ? 'me' : ''}"><span class="pos">${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</span><span>${p.avatar}</span><span>${esc(p.name)}</span><span class="sc">${p.score}</span></div>`).join('')}
    </div>
    <div class="card tight center">
      ${st.youReady
        ? `<div style="font-weight:900;color:var(--teal)">تمام ✅ مستنيين الباقي يدوسوا</div>`
        : `<button class="btn primary big" id="ready-btn">${st.isLastRound ? '🏁 النتيجة النهائية' : '⬅️ التالي'}</button>`}
      <div class="muted small mt">جاهزين: <span id="r-n">${st.readyIds.length}</span>/${st.players.filter(p => p.connected).length}</div>
      <div class="answered-strip" id="r-strip">${avatarsOf(st, st.readyIds)}</div>
    </div>
    ${hostForce(st, 'كمّلوا من غير المتأخرين')}`;
  bindHeader(); bindForce();
  const rb = $('#ready-btn');
  if (rb) rb.onclick = async () => { Snd.play('pick'); const r = await act('readyNext'); if (r.ok) { rb.outerHTML = '<div style="font-weight:900;color:var(--teal)">تمام ✅ مستنيين الباقي يدوسوا</div>'; } };
}
function patchReveal(st) {
  const n = $('#r-n'); if (n) n.textContent = st.readyIds.length;
  const s = $('#r-strip'); if (s) s.innerHTML = avatarsOf(st, st.readyIds);
}

/* ======================= نهاية اللعبة ======================= */
function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#e8b86d', '#c084fc', '#2FC6B0', '#f6cd8a', '#F4EDDF'];
  for (let i = 0; i < 90; i++) {
    const s = document.createElement('i');
    s.style.left = Math.random() * 100 + 'vw';
    s.style.background = colors[i % colors.length];
    s.style.animationDuration = (2.2 + Math.random() * 2) + 's';
    s.style.animationDelay = (Math.random() * .8) + 's';
    s.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 5200);
}
function renderGameover(st) {
  stopTimer();
  const R = st.results, me = st.you;
  const hostP = st.players.find(p => p.isHost) || {};
  Snd.play('win'); confetti();
  const top3 = R.ranking.slice(0, 3);
  const pod = i => top3[i] ? `
    <div class="pod p${i + 1}">
      <div class="pav">${top3[i].avatar}</div>
      <div class="pnm">${esc(top3[i].name)}</div>
      <div class="psc">${top3[i].score}</div>
      <div class="bar">${i + 1}</div>
    </div>` : '';
  app.innerHTML = `${header('خلصت اللعبة! 🎉')}
    <div class="bunting teal"></div>
    <div class="card center">
      <h2 class="display" style="font-size:30px">🏆 نتيجة السهرة</h2>
      <div class="podium">${pod(1)}${pod(0)}${pod(2)}</div>
    </div>
    <div class="card">
      <h3 class="mb">🎖️ الجوايز</h3>
      ${R.awards.map(a => `<div class="award"><span class="aic">${a.icon}</span><div><div class="at">${esc(a.title)}: ${esc(a.who)}</div><div class="ad">${esc(a.detail)}</div></div></div>`).join('')}
    </div>
    <div class="card">
      <h3 class="mb">📊 الترتيب</h3>
      ${R.ranking.map(p => `<div class="rank-row ${p.id === me.id ? 'me' : ''}"><span class="pos">#${p.rank}</span><span>${p.avatar}</span><span>${esc(p.name)}${p.left ? ' <span class="muted small">🚪 خرج</span>' : ''}</span><span class="muted small">(${p.correct} تخمينة صح)</span><span class="sc">${p.score}</span></div>`).join('')}
    </div>
    <div class="card">
      <h3 class="mb">📚 مراجعة الجولات — مين خمّن صح ومين غلط</h3>
      ${R.review.map(rd => {
        return `
        <details class="review">
          <summary><span>${{ writer: '✍️', vote: '🗳️', random: '🎲' }[rd.source] || '🖋️'}</span><span>الجولة ${rd.round}: ${esc(rd.topic.slice(0, 38))}${rd.topic.length > 38 ? '…' : ''}</span></summary>
          <div class="rv-body">
            ${rd.source === 'writer' ? `<div class="muted small mt">✍️ العنوان كتبه واحد غامض من الشلة 🤫</div>` : ''}
            ${rd.answers.map(a => `
              <div class="ansmatch" style="margin-top:8px">
                <div class="atx" style="font-size:15px">«${esc(a.text)}»</div>
                <div><span class="owner-chip" style="font-size:13px">${a.ownerAvatar} ${esc(a.ownerName)}</span></div>
                ${a.picks.map(pk => `<div class="pick-row ${pk.ok ? 'ok' : 'bad'}" style="font-size:12px"><span>${pk.avatar}</span><span>${esc(pk.name)}</span><span>${pk.ok ? '✅' : '❌ (قال ' + esc(pk.pickName) + ')'}</span></div>`).join('')}
              </div>`).join('')}
          </div>
        </details>`;
      }).join('')}
    </div>
    ${me.isHost
      ? `<button class="btn primary big" id="again-btn">🔄 نلعب تاني (عناوين جديدة)</button>`
      : `<div class="card tight center">عايزين جولة تانية؟ <b>${esc(hostP.name || '')}</b> 👑 يدوس</div>`}
    <button class="btn ghost big mt" id="leave-btn">🏠 نهاية السهرة (خروج)</button>`;
  bindHeader();
  const ab = $('#again-btn');
  if (ab) ab.onclick = () => act('playAgain');
  $('#leave-btn').onclick = async () => { if (confirm('تخرج من الروم؟')) { await act('leave'); leaveLocal(); } };
}

/* ======================= الهيلب ======================= */
const WISPER_HELP = `
<div style="text-align:start">
  <div class="center"><img src="/img/wisper.webp" alt="" style="width:110px;height:auto;filter:drop-shadow(0 6px 14px #0009)"></div>
  <h2 class="display" style="color:var(--teal);text-align:center;margin:6px 0 2px">حبر سري</h2>
  <div class="center muted small" style="margin-bottom:14px">إزاي بنلعب؟</div>
  <p style="margin:0 0 10px"><b>1️⃣ الروم:</b> من 3 لـ 15 لاعب — كود أو QR.</p>
  <p style="margin:0 0 10px"><b>2️⃣ الهوست بيظبط بس:</b> عدد الجولات من كل نوع — ✍️ واحد يكتب العنوان، 🗳️ تصويت بين 3، 🎲 عشوائي من بنك 200 — والترتيب بيتخلط لوحده. <b style="color:var(--teal)">ومفيش هوست بيدوس حاجة بعد كده.</b></p>
  <p style="margin:0 0 10px"><b>3️⃣ جولات الكتابة سرّية:</b> لاعب عشوائي بيكتب العنوان و<b style="color:var(--brass-hi)">محدش عارف مين هو</b> 🤫</p>
  <p style="margin:0 0 10px"><b>4️⃣ كل جولة:</b> الكل يكتب إجابته في السر — <b>ومينفعش اتنين يكتبوا نفس الكلام بالظبط</b>.</p>
  <p style="margin:0 0 10px"><b>5️⃣ التخمين واحدة واحدة:</b> إجابة تظهر → الكل يخمّن مين كتبها → أول ما الكل يختار تيجي اللي بعدها لوحدها. لو الإجابة بتاعتك؟ استنى وشوفهم محتارين 😏. <b>كل اسم ينفع مرة واحدة</b> في الجولة.</p>
  <p style="margin:0"><b>6️⃣ النقط والنهاية:</b> تخمينة صح = 100. وفي الآخر جوايز 🏆🕵️🎭 ومراجعة كل الجولات ✅❌.</p>
</div>`;
function showHelp() {
  let ov = $('#help-ov');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'help-ov';
    ov.style.cssText = 'position:fixed;inset:0;background:#000c;z-index:200;display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="card" style="max-width:520px;width:100%;max-height:92vh;overflow:auto">
    ${WISPER_HELP}
    <label class="row mt muted small" style="gap:8px;cursor:pointer"><input type="checkbox" id="help-off" style="width:18px;height:18px"> متظهرش تاني</label>
    <button class="btn primary big mt" id="help-ok">تمام، يلا نلعب 🚀</button>
    <button class="btn ghost big mt" id="help-skip">تخطي</button>
  </div>`;
  const close = () => { if ($('#help-off') && $('#help-off').checked) LS.set('lamma_help_off_wisper', true); ov.remove(); };
  $('#help-ok').onclick = close;
  $('#help-skip').onclick = close;
}

/* ======================= البداية ======================= */
(async function boot() {
  document.body.addEventListener('pointerdown', () => Snd.ensure(), { once: true });
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (S.save && S.save.code && S.save.token) {
    const r = await api('/api/wisper/join', { code: S.save.code, token: S.save.token });
    if (r.ok) { openStream(); return; }
    LS.del('wisper_save'); S.save = null;
    if (r.gone) toast('الروم القديم خلص', 'err');
  }
  renderHome(urlRoom || '');
  if (!LS.get('lamma_help_off_wisper', false)) setTimeout(showHelp, 350);
})();
