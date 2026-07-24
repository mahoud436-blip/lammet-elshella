/* المحقق والمتهم — واجهة اللعبة (لمّة الشلة) — نسخة مُعاد بناؤها */
'use strict';
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const app = $('#app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
const AVATARS = ['🕵️','🔎','🧠','🎩','📎','🗂️','🧩','💡','📌','🔦','🗝️','⚖️','📖','🖇️','🧭','🪞','🎯','📝','🔬','🧵','♟️','🫖','🪄','📮'];

const Snd = {
  ctx: null, muted: LS.get('conan_mute', false),
  ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  tone(f, t0, dur, type, vol) { if (this.muted || !this.ctx) return; const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = type || 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || .18, t0 + .02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); o.connect(g).connect(this.ctx.destination); o.start(t0); o.stop(t0 + dur + .05); },
  play(name) { this.ensure(); if (!this.ctx || this.muted) return; const t = this.ctx.currentTime;
    if (name === 'pick') this.tone(440, t, .08, 'square', .1);
    if (name === 'turn') { this.tone(392, t, .1); this.tone(523, t + .1, .14); }
    if (name === 'word') this.tone(660, t, .09, 'triangle', .12);
    if (name === 'pause') { this.tone(300, t, .18, 'sawtooth', .12); this.tone(230, t + .16, .22, 'sawtooth', .1); }
    if (name === 'ok') { [523, 659, 784].forEach((f, i) => this.tone(f, t + i * .09, .14)); }
    if (name === 'win') { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, t + i * .11, .16, 'triangle', .2)); }
  },
  toggle() { this.muted = !this.muted; LS.set('conan_mute', this.muted); toast(this.muted ? 'الصوت اتقفل 🔇' : 'الصوت اتفتح 🔊'); }
};

const S = {
  save: LS.get('conan_save', null),
  name: LS.get('conan_name', LS.get('tahadi_name', '')),
  avatar: LS.get('conan_av', AVATARS[Math.floor(Math.random() * AVATARS.length)]),
  st: null, es: null, lastMsg: 0, skew: 0, sig: '', wake: null, pauseReason: '',
};

async function api(path, body) {
  try { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return await r.json(); }
  catch (e) { return { ok: false, error: 'مفيش اتصال بالسيرفر 📡' }; }
}
async function act(action, extra) {
  if (!S.save) return { ok: false };
  const r = await api('/api/conan/action', Object.assign({ code: S.save.code, token: S.save.token, action }, extra || {}));
  if (!r.ok && r.error) toast(r.error, 'err');
  return r;
}
/* قفل الزرار وقت التنفيذ — يمنع الدوس المتكرر والريس، ويرجّع يشتغل لو فشل */
function lockBtn(btn, fn) {
  if (!btn) return;
  btn.onclick = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } catch (e) {} finally { setTimeout(() => { if (btn && btn.isConnected) btn.disabled = false; }, 450); }
  };
}

function openStream() {
  if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; }
  if (!S.save) return;
  const es = new EventSource('/api/conan/stream?code=' + encodeURIComponent(S.save.code) + '&token=' + encodeURIComponent(S.save.token));
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
function leaveLocal() { if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; } S.save = null; LS.del('conan_save'); S.st = null; S.sig = ''; const po = $('#pause-ov'); if (po) po.remove(); renderHome(); }

function header(sub) {
  return `<div class="bunting"></div>
  <div class="top">
    <img src="/img/conan-sm.png" alt="" onerror="this.style.display='none'">
    <div><div class="title display" style="color:var(--brass-hi)">المحقق والمتهم</div><div class="sub">${esc(sub || 'اسأل.. حلل.. واعرف الكلمة 🔎')}</div></div>
    <button class="btn sm ghost" id="help-btn" style="margin-inline-start:auto">؟</button>
    <button class="btn sm ghost" id="home-btn">🏠</button>
    <button class="btn sm ghost" id="mute-btn">${Snd.muted ? '🔇' : '🔊'}</button>
  </div>
  ${S.save ? '<button class="leave-fab" id="leave-fab" title="اخرج من الروم">🚪</button>' : ''}
  <div id="presence-bar" class="presence-bar hidden"></div>`;
}
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
  const show = st && (st.phase === 'play' || st.phase === 'pick');
  el.classList.toggle('hidden', !show); if (!show) return;
  el.innerHTML = st.players.map(p => {
    const cls = p.left ? 'gone' : (!p.connected ? 'off' : (p.away ? 'away' : 'here'));
    const badge = p.left ? '🚪' : (!p.connected ? '⏳' : (p.away ? '❗' : ''));
    return `<span class="pv ${cls}" title="${esc(p.name)}${p.away ? ' — خرج من اللعبة!' : ''}"><span class="av">${p.avatar}</span>${badge ? `<span class="bd">${badge}</span>` : ''}</span>`;
  }).join('');
}
/* شاشة التوقف المؤقت (لو حد قطع النت) — طبقة فوق الكل، مستقلة عن الشاشة الأساسية */
function updPaused(st) {
  let ov = $('#pause-ov');
  if (!st || !st.paused) { if (ov) { ov.remove(); S.pauseReason = ''; } return; }
  if (!ov) { ov = document.createElement('div'); ov.id = 'pause-ov'; ov.className = 'pause-ov'; document.body.appendChild(ov); Snd.play('pause'); }
  if (S.pauseReason === st.paused.reason && ov.dataset.host === String(!!st.you.isHost)) return;
  S.pauseReason = st.paused.reason; ov.dataset.host = String(!!st.you.isHost);
  ov.innerHTML = `<div class="pause-card">
    <div class="pause-emoji">⏸️</div>
    <div class="pause-reason">${esc(st.paused.reason)}</div>
    <div class="pause-sub">اللعبة هتكمّل من نفس مكانها أول ما يرجع</div>
    ${st.you.isHost ? '<button class="btn coral big mt" id="pause-skip">⏭️ عدّي من غيره</button>' : ''}
  </div>`;
  const sk = $('#pause-skip'); if (sk) sk.onclick = async () => { if (await uiConfirm('تعدّي القضية من غير اللاعب ده؟', { emoji: '⏭️', okLabel: 'عدّي' })) act('forceNext'); };
}

function renderHome(prefillCode) {
  S.sig = 'home'; stopTimers();
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
  $('#av-btn').onclick = () => { Snd.play('pick'); S.avatar = AVATARS[(AVATARS.indexOf(S.avatar) + 1) % AVATARS.length]; LS.set('conan_av', S.avatar); $('#av-btn').textContent = S.avatar; };
  const nameIn = $('#name-in'); nameIn.oninput = () => { S.name = nameIn.value; LS.set('conan_name', S.name); };
  $('#create-btn').onclick = async () => { Snd.ensure(); const name = nameIn.value.trim(); if (!name) return toast('اكتب اسمك الأول ✍️', 'err'); const r = await api('/api/conan/create', { name, avatar: S.avatar }); if (!r.ok) return toast(r.error || 'مشكلة', 'err'); S.save = { code: r.code, token: r.token }; LS.set('conan_save', S.save); openStream(); };
  $('#join-btn').onclick = async () => { Snd.ensure(); const name = nameIn.value.trim(); const c = $('#code-in').value.trim(); if (!name) return toast('اكتب اسمك الأول ✍️', 'err'); if (!/^\d{4}$/.test(c)) return toast('الكود 4 أرقام', 'err'); const r = await api('/api/conan/join', { code: c, name, avatar: S.avatar }); if (!r.ok) return toast(r.error || 'مشكلة', 'err'); S.save = { code: r.code, token: r.token }; LS.set('conan_save', S.save); openStream(); };
}

/* ============ موزّع العرض: يبني الشاشة لما «التوقيع» يتغير، ويرقّع بس لما يفضل زيّه ============ */
function sigOf(st) {
  const P = st.phase;
  if (P === 'lobby') return 'L|' + st.players.map(p => p.id + (p.connected ? 1 : 0) + (p.isHost ? 1 : 0)).join(',') + '|' + JSON.stringify(st.settings);
  if (P === 'pick') return 'K|' + st.caseNo + '|' + (st.youAreAccused ? 'a' : 'd') + '|' + (st.pickMode || '') + '|' + (st.allowCustomWord ? 1 : 0) + '|' + (st.secret ? 1 : 0);
  if (P === 'play') {
    let s = 'P|' + st.caseNo + '|' + st.round + '|' + st.sub + '|' + (st.youAreAccused ? 'a' : 'd') + '|' + (st.youSubmitted ? 'S' : '');
    if (st.sub === 'ask' || st.sub === 'answer') s += '|' + (st.yourTurnToAsk ? 'me' : 'x') + (st.curQ ? (st.curQ.answer ? 'QA' : 'Q') : 'NQ');
    if (st.sub === 'decide') s += '|' + (st.youSubmitted ? 's' : '') + (st.youDecided ? 'd' : '') + (st.mustSubmit ? 'm' : '');
    return s;
  }
  if (P === 'caseEnd') return 'E|' + st.caseNo + '|' + (st.youReady ? 'r' : '');
  if (P === 'gameover') return 'G';
  return P;
}
function render() {
  const st = S.st; if (!st) return;
  updPresence(st);
  updPaused(st);
  const sig = sigOf(st);
  if (sig !== S.sig) {
    S.sig = sig; stopTimers();
    const b = BUILD[st.phase]; if (b) b(st);
  } else {
    const p = PATCH[st.phase]; if (p) p(st);
  }
}

function joinUrl(st) {
  const loc = location;
  if ((loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') && st.net && !st.net.hosted && st.net.ips && st.net.ips.length)
    return 'http://' + st.net.ips[0] + ':' + st.net.port + '/conan/?room=' + st.code;
  return loc.origin + '/conan/?room=' + st.code;
}

/* ===== اللوبي ===== */
function buildLobby(st) {
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

      <div class="mt center muted small">عدد أسئلة كل محقق في القضية (= عدد الجولات)</div>
      <div class="stepper">
        <button class="btn" data-min="rounds" ${isHost ? '' : 'disabled'}>−</button>
        <div class="val" style="color:var(--brass-hi)">${s.rounds}</div>
        <button class="btn" data-plus="rounds" data-mn="2" data-mx="10" ${isHost ? '' : 'disabled'}>+</button>
      </div>

      <div class="mt center muted small">كل لاعب يبقى المتّهم كام مرة؟</div>
      <div class="stepper">
        <button class="btn" data-min="cases" ${isHost ? '' : 'disabled'}>−</button>
        <div class="val" style="color:var(--brass-hi)">${s.casesPerPlayer}</div>
        <button class="btn" data-plus="cases" data-mn="1" data-mx="5" ${isHost ? '' : 'disabled'}>+</button>
      </div>
      <div class="center muted small" style="font-size:12px">يعني ${s.casesPerPlayer * st.players.length} قضية إجمالي</div>

      <div class="mt center muted small">ترتيب أسئلة المحققين</div>
      <div class="row" style="justify-content:center">
        <span class="chip click ${s.askOrder === 'turns' ? 'on' : ''} ${isHost ? '' : 'locked'}" data-askorder="turns">➡️ بالدور</span>
        <span class="chip click ${s.askOrder === 'random' ? 'on' : ''} ${isHost ? '' : 'locked'}" data-askorder="random">🎲 عشوائي</span>
      </div>

      <div class="mt center muted small">ترتيب مين يبقى المتّهم</div>
      <div class="row" style="justify-content:center">
        <span class="chip click ${s.accusedOrder === 'turns' ? 'on' : ''} ${isHost ? '' : 'locked'}" data-accorder="turns">➡️ بالدور</span>
        <span class="chip click ${s.accusedOrder === 'random' ? 'on' : ''} ${isHost ? '' : 'locked'}" data-accorder="random">🎲 عشوائي</span>
      </div>

      <div class="mt center muted small">المتّهم يكتب الكلمة بنفسه؟</div>
      <div class="row" style="justify-content:center">
        <span class="chip click ${!s.allowCustomWord ? 'on' : ''} ${isHost ? '' : 'locked'}" data-custom="0">🔒 من البنك بس</span>
        <span class="chip click ${s.allowCustomWord ? 'on' : ''} ${isHost ? '' : 'locked'}" data-custom="1">✍️ يختار</span>
      </div>

      <div class="mt center muted small">وقت كتابة السؤال</div>
      <div class="row wrap" style="justify-content:center">
        ${[0, 15, 30, 45].map(t => `<span class="chip click ${s.qTime === t ? 'on' : ''} ${isHost ? '' : 'locked'}" data-qtime="${t}">${t === 0 ? 'مفتوح ♾️' : t + ' ث'}</span>`).join('')}
      </div>

      <div class="mt center muted small">وقت رد المتّهم</div>
      <div class="row wrap" style="justify-content:center">
        ${[0, 15, 30].map(t => `<span class="chip click ${s.aTime === t ? 'on' : ''} ${isHost ? '' : 'locked'}" data-atime="${t}">${t === 0 ? 'مفتوح ♾️' : t + ' ث'}</span>`).join('')}
      </div>
      ${s.aTime > 0 ? '<div class="center muted small" style="font-size:12px;color:var(--coral)">لو المتّهم مردش في الوقت بيتخصم منه 10 نقط ⚠️</div>' : ''}
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
    $$('[data-plus]').forEach(b => b.onclick = () => {
      if (b.dataset.plus === 'cases') act('setSettings', { settings: { casesPerPlayer: Math.min(5, s.casesPerPlayer + 1) } });
      
      else act('setSettings', { settings: { rounds: Math.min(10, s.rounds + 1) } });
    });
    $$('[data-min]').forEach(b => b.onclick = () => {
      if (b.dataset.min === 'cases') act('setSettings', { settings: { casesPerPlayer: Math.max(1, s.casesPerPlayer - 1) } });
      
      else act('setSettings', { settings: { rounds: Math.max(2, s.rounds - 1) } });
    });
    $$('[data-askorder]').forEach(el => el.onclick = () => act('setSettings', { settings: { askOrder: el.dataset.askorder } }));
    $$('[data-accorder]').forEach(el => el.onclick = () => act('setSettings', { settings: { accusedOrder: el.dataset.accorder } }));
    $$('[data-custom]').forEach(el => el.onclick = () => act('setSettings', { settings: { allowCustomWord: el.dataset.custom === '1' } }));
    $$('[data-qtime]').forEach(el => el.onclick = () => act('setSettings', { settings: { qTime: parseInt(el.dataset.qtime, 10) } }));
    $$('[data-atime]').forEach(el => el.onclick = () => act('setSettings', { settings: { aTime: parseInt(el.dataset.atime, 10) } }));
    lockBtn($('#start-btn'), () => { Snd.play('turn'); return act('startGame'); });
    $$('.kick').forEach(b => b.onclick = async () => { if (await uiConfirm('تطرده من الروم؟', { emoji: '👋', okLabel: 'اطرده' })) act('kick', { playerId: b.dataset.kick }); });
  }
  $('#leave-btn').onclick = async () => { if (await uiConfirm('تخرج من الروم؟', { emoji: '🚪', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
}

/* ===== مؤقتات ===== */
let timerRAF = null;
function stopTimers() { if (timerRAF) cancelAnimationFrame(timerRAF); timerRAF = null; }
function startCountdown(deadline) {
  const el = $('#tbar'); if (!el || !deadline) return;
  const fill = $('.fill', el); const total = deadline - (Date.now() + S.skew);
  const loop = () => { const remain = deadline - (Date.now() + S.skew); const pct = Math.max(0, Math.min(100, remain / Math.max(total, 1) * 100)); fill.style.width = pct + '%'; el.classList.toggle('low', pct < 30); if (remain > 0) timerRAF = requestAnimationFrame(loop); };
  if (timerRAF) cancelAnimationFrame(timerRAF);
  timerRAF = requestAnimationFrame(loop);
}
const LEAVE_BTN = '';
const ACC_LINES = ['النهاردة انت المتّهم! 🎭', 'وقعت في الفخ — انت المتّهم 😅', 'الكرسي الساخن ليك 🔥', 'كلهم هيحققوا معاك دلوقتي 😬'];
const DET_LINES = ['انت محقق 🔎 شمّر عن دراعك', 'دورك تحقق وتكتشف 🕵️', 'المحقق الذكي.. ابدأ اسأل 🧠', 'عينك على الكلمة يا محقق 👀'];
function roleBanner(st) {
  const seed = (st.caseNo || 1) + (st.you && st.you.id ? st.you.id.length : 0);
  const line = st.youAreAccused ? ACC_LINES[seed % ACC_LINES.length] : DET_LINES[seed % DET_LINES.length];
  return `<div class="role-banner ${st.youAreAccused ? 'acc' : 'det'}">
    <div class="rb-q">انا محقق ولا متهم؟</div>
    <div class="rb-a">${st.youAreAccused ? '🎭 انت المتّهم' : '🔎 انت محقق'}</div>
    <div class="rb-s">${line}</div>
  </div>`;
}
function caseBadge(st) {
  return `<div class="center mb"><span class="chip on">القضية ${st.caseNo} من ${st.totalCases}</span></div>`;
}
function bindLeave2() { const lb = $('#leave-btn2'); if (lb) lb.onclick = async () => { if (await uiConfirm('تخرج من الروم؟ سكورك هيفضل محسوب', { emoji: '🚪', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } }; }

/* ===== اختيار الكلمة (المتّهم) ===== */
function buildPick(st) {
  stopTimers(); grabWake();
  if (!st.youAreAccused) {
    app.innerHTML = `${header('')}${caseBadge(st)}${roleBanner(st)}
      <div class="card center">
        <div class="cluer-hero"><div class="big">🎭</div>
        <h2 class="display">${st.accused ? st.accused.avatar + ' ' + esc(st.accused.name) : ''} هو المتّهم!</h2>
        <div class="muted mt">بيجهّز الكلمة السرية دلوقتي... جهّزوا أسئلتكم 🔎</div></div>
      </div>
      ${LEAVE_BTN}`;
    bindLeave2(); return;
  }
  const locked = st.pickMode;
  app.innerHTML = `${header('')}${caseBadge(st)}${roleBanner(st)}
    <div class="card center"><div class="cluer-hero"><div class="big">🎭</div><h3>جهّز كلمتك</h3>
      <div class="muted small">${st.allowCustomWord ? 'اختار كلمة من البنك أو اكتب واحدة بنفسك — ولازم تكمّل باللي تختاره' : 'دي كلمتك السرية — جهّز نفسك للأسئلة'}</div></div>
    </div>
    ${st.secret ? `<div class="secret-box"><div class="lbl">🤫 الكلمة السرية (انت بس شايفها)</div><div class="word" id="secret-word">${esc(st.secret)}</div><div class="cat mt"><span class="chip" id="secret-cat">${st.cat ? st.cat.icon + ' ' + st.cat.name : ''}</span></div></div>` : ''}
    <div class="card">
      ${st.allowCustomWord && !locked ? `
        <button class="btn primary big" id="pick-bank">🎲 هات كلمة من البنك</button>
        <div class="or">أو</div>
        <input class="field" id="own-word" maxlength="40" placeholder="اكتب كلمتك السرية...">
        <div class="row wrap mt" style="justify-content:center">
          ${(st.catOptions || []).map((c, i) => `<span class="chip click cat-pick ${i === 0 ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${esc(c.name)}</span>`).join('')}
        </div>
        <button class="btn teal big mt" id="pick-own">✍️ استخدم كلمتي</button>
      ` : ''}
      ${st.secret ? '<button class="btn primary big mt" id="start-play">🔎 يلا يسألوني</button>' : ''}
    </div>
    ${LEAVE_BTN}`;
  const pb = $('#pick-bank'); if (pb) lockBtn(pb, () => act('pickBank'));
  let chosenCat = (st.catOptions && st.catOptions[0]) ? st.catOptions[0].id : null;
  $$('.cat-pick').forEach(el => el.onclick = () => { $$('.cat-pick').forEach(x => x.classList.remove('on')); el.classList.add('on'); chosenCat = el.dataset.cat; });
  const po = $('#pick-own'); if (po) lockBtn(po, async () => { const w = $('#own-word').value.trim(); if (w.length < 2) return toast('اكتب كلمة صح', 'err'); await act('pickCustom', { word: w, cat: chosenCat }); });
  const sp = $('#start-play'); if (sp) lockBtn(sp, () => { Snd.play('turn'); return act('startPlay'); });
  bindLeave2();
}
function patchPick(st) {
  const w = $('#secret-word'); if (w && st.secret != null) w.textContent = st.secret;
  const c = $('#secret-cat'); if (c && st.cat) c.textContent = st.cat.icon + ' ' + st.cat.name;
}

/* ===== اللعب ===== */
const ANS_TXT = { yes: 'أه ✅', no: 'لا ❌', maybe: 'مش قادر أحدد 🤷', none: 'مردّش ⏰' };
function counters(st) {
  let third = '';
  if (st.sub === 'ask' || st.sub === 'answer') third = `<span class="chip" id="dor">الدور ${st.askIdx}/${st.askTotal}</span>`;
  else if (st.sub === 'decide') third = `<span class="chip">القرار 🤔</span>`;
  return `<div class="counters">
    <span class="chip">القضية ${st.caseNo}/${st.totalCases}</span>
    <span class="chip on">الجولة ${st.round}/${st.totalRounds}</span>
    ${third}
  </div>`;
}
function accBox(st) {
  return st.youAreAccused
    ? `<div class="secret-box"><div class="lbl">🤫 كلمتك السرية</div><div class="word">${esc(st.secret || '')}</div><div class="cat mt"><span class="chip">${st.cat ? st.cat.icon + ' ' + st.cat.name : ''}</span></div>${st.penalty ? `<div class="penalty-note">⚠️ اتخصم منك ${st.penalty} نقاط (أسئلة مردّتش عليها)</div>` : ''}</div>`
    : `<div class="card tight center"><div class="muted small">المتّهم</div><div style="font-weight:900;font-size:18px">${st.accused ? st.accused.avatar + ' ' + esc(st.accused.name) : ''}</div><div class="chip mt">${st.cat ? st.cat.icon + ' ' + st.cat.name : ''}</div></div>`;
}
function detStrip(st) {
  return `<div class="det-strip">${st.players.filter(p => !p.isAccused && !p.left).map(p => {
    const isNow = st.asker && st.asker.id === p.id;
    const cls = p.submitted ? 'sub' : (isNow ? 'now' : 'done');
    return `<span class="det-dot ${cls}" title="${esc(p.name)}">${p.avatar}${p.submitted ? '<span class="lock">🔒</span>' : ''}</span>`;
  }).join('')}</div>`;
}
function buildPlay(st) {
  grabWake(); stopTimers();

  /* --- القرار: تسلّم ولا تكمّل --- */
  if (st.sub === 'decide') {
    app.innerHTML = `${header('')}${counters(st)}${accBox(st)}
      ${st.youAreAccused
        ? `<div class="card center"><div class="big-emoji">⏳</div><div class="muted">المحققين بيقرروا... مين هيسلّم ومين هيكمّل</div>
           <div class="muted small mt">قرروا <b id="d-n">${st.decidedCount}</b> من ${st.decideTotal}</div></div>`
        : (st.youSubmitted
          ? `<div class="card center"><div class="big-emoji">🔒</div><h3>إجابتك اتقفلت</h3>
             <div class="muted mt">«${esc(st.yourSubmission || '')}»</div>
             <div class="muted small mt">محدش هيعرف صح ولا غلط غير لما القضية تتقفل</div>
             <div class="muted small mt">قرروا <b id="d-n">${st.decidedCount}</b> من ${st.decideTotal}</div></div>`
          : (st.youDecided
            ? `<div class="card center"><div class="big-emoji">👍</div><h3>هتكمّل التحقيق</h3><div class="muted small mt">مستنيين الباقي — قرروا <b id="d-n">${st.decidedCount}</b> من ${st.decideTotal}</div></div>`
            : `<div class="card">
                <div class="center" style="font-weight:900;font-size:18px">عرفتها؟ 🤔</div>
                <div class="center muted small mb">لو سلّمت دلوقتي وطلعت صح هتاخد <b style="color:var(--brass-hi)">${st.tier}</b>${st.nextTier ? ` — ولو كمّلت الجولة الجاية تبقى <b>${st.nextTier}</b>` : ''}</div>
                ${st.mustSubmit ? '<div class="penalty-note">دي آخر جولة — لازم تسلّم إجابتك دلوقتي!</div>' : ''}
                <div class="row mt">
                  <input class="field grow" id="sub-in" maxlength="60" placeholder="اكتب إجابتك...">
                  <button class="btn primary" id="sub-btn">🔒 سلّم</button>
                </div>
                ${st.mustSubmit ? '' : '<button class="btn ghost big mt" id="keep-btn">🔎 لأ، هكمّل تحقيق</button>'}
                <div class="center muted small mt">قرروا <b id="d-n">${st.decidedCount}</b> من ${st.decideTotal}</div>
              </div>`))}
      ${LEAVE_BTN}`;
    const sb = $('#sub-btn');
    if (sb) {
      const send = async () => { const v = $('#sub-in').value.trim(); if (!v) return toast('اكتب إجابتك', 'err'); const r = await act('submitAnswer', { text: v }); if (r.ok) Snd.play('ok'); };
      lockBtn(sb, send);
      $('#sub-in').onkeydown = e => { if (e.key === 'Enter' && !sb.disabled) sb.click(); };
    }
    const kb = $('#keep-btn'); if (kb) lockBtn(kb, () => { Snd.play('pick'); return act('keepGoing'); });
    bindLeave2(); return;
  }

  /* --- السؤال / الرد --- */
  const q = st.curQ;
  app.innerHTML = `${header('')}${counters(st)}${accBox(st)}
    ${detStrip(st)}
    ${st.deadline ? '<div class="timer" id="tbar"><div class="fill" style="width:100%"></div></div>' : ''}
    <div class="card">
      <div class="center muted small mb">سؤال ${st.askIdx} من ${st.askTotal} في الجولة دي</div>
      ${q
        ? `<div class="q-card">
             <div class="who">${q.asker.avatar} <b>${esc(q.asker.name)}</b> بيسأل:</div>
             <div class="qt">${esc(q.text)}</div>
           </div>
           ${q.answer
             ? `<div class="center"><span class="ans-badge ${q.answer}">${ANS_TXT[q.answer]}</span></div>`
             : (st.youAreAccused
               ? `<div class="center muted small">ردّك؟ (لازم تكون صادق — الكلمة قدامك)</div>
                  <div class="ans-row">
                    <button class="ans-btn yes" data-ans="yes">أه</button>
                    <button class="ans-btn no" data-ans="no">لا</button>
                    <button class="ans-btn maybe" data-ans="maybe">مش قادر أحدد</button>
                  </div>`
               : `<div class="center muted">مستنيين رد المتّهم... 👀</div>`)}`
        : (st.yourTurnToAsk
          ? `<div class="center" style="font-weight:900;font-size:17px;color:var(--brass-hi)">دورك! اسأل سؤال إجابته أه أو لا 👇</div>
             <div class="center muted small mb">مثال: هو حاجة بناكلها؟ · بيتحرك؟ · موجود في البيت؟</div>
             <div class="row mt">
               <input class="field grow" id="q-in" maxlength="${st.maxQChars}" placeholder="اكتب سؤالك...">
               <button class="btn primary" id="q-btn">اسأل</button>
             </div>`
          : `<div class="center" style="font-weight:900">${st.asker ? st.asker.avatar + ' ' + esc(st.asker.name) : ''} بيكتب سؤاله...</div>`)}
    </div>
    ${st.youSubmitted ? `<div class="card tight center"><span class="muted small">🔒 انت سلّمت إجابتك — بتتفرج بس</span></div>` : ''}
    ${LEAVE_BTN}`;
  startCountdown(st.deadline);
  const qb = $('#q-btn');
  if (qb) {
    const send = async () => { const v = $('#q-in').value.trim(); if (v.length < 3) return toast('اكتب سؤال أوضح', 'err'); const r = await act('ask', { text: v }); if (r.ok) Snd.play('word'); };
    lockBtn(qb, send);
    $('#q-in').onkeydown = e => { if (e.key === 'Enter' && !qb.disabled) qb.click(); };
    setTimeout(() => { const el = $('#q-in'); if (el) el.focus(); }, 100);
  }
  $$('[data-ans]').forEach(b => lockBtn(b, async () => { const r = await act('answer', { value: b.dataset.ans }); if (r.ok) Snd.play('ok'); }));
  bindLeave2();
}
function patchPlay(st) {
  const d = $('#d-n'); if (d) d.textContent = st.decidedCount;
  const dor = $('#dor'); if (dor && (st.sub === 'ask' || st.sub === 'answer')) dor.textContent = `الدور ${st.askIdx}/${st.askTotal}`;
  const strip = $('.det-strip'); if (strip) strip.outerHTML = detStrip(st);
}

/* ===== نهاية القضية (محايدة — مفيش كشف) ===== */
function buildCaseEnd(st) {
  stopTimers(); Snd.play('ok');
  const r = st.result || {};
  const ce = st.caseEnd || {};
  const readyTotal = st.readyTotal || st.players.filter(p => p.connected).length;
  const solvers = (r.answers || []).filter(a => a.correct).length;
  const ranking = st.players.slice().sort((a, b) => b.score - a.score);
  app.innerHTML = `${header('')}
    <div class="counters"><span class="chip on">القضية ${st.caseNo}/${st.totalCases} — الكشف 🔓</span></div>
    <div class="secret-box">
      <div class="lbl">🔓 الكلمة كانت</div>
      <div class="word">${esc(r.secret || '')}</div>
      <div class="cat mt"><span class="chip">${r.cat ? r.cat.icon + ' ' + r.cat.name : ''}</span></div>
      <div class="muted small mt">المتّهم كان ${r.accusedAvatar || ''} <b>${esc(r.accusedName || '')}</b></div>
      ${r.accusedPenalty ? `<div class="penalty-note">المتّهم اتخصم منه ${r.accusedPenalty} نقاط</div>` : ''}
    </div>
    <div class="card">
      <h3 class="mb">🔐 إجابات المحققين ${solvers ? `— عرفوها ${solvers}` : '— محدش عرفها 😮'}</h3>
      ${(r.answers || []).map(a => `<div class="guess-item ${a.correct ? 'correct' : ''}"><span class="who">${a.avatar} ${esc(a.name)}</span><span class="gtext">${a.answer ? `«${esc(a.answer)}»` : '— مسلّمش'} ${a.correct ? `✅ ج${a.round} <b>+${a.points}</b>` : '❌'}</span></div>`).join('')}
    </div>
    <details class="case-rev"><summary><span class="cr-w">📜 سجل التحقيق</span></summary><div class="cr-body">
      ${(r.history || []).length ? (r.history || []).map(h => `<div class="log-item"><div class="muted small">ج${h.round} · ${h.avatar} ${esc(h.name)}</div><div style="font-weight:800">${esc(h.text)}</div>${h.answer ? `<span class="ans-badge ${h.answer}" style="font-size:14px;padding:2px 10px">${ANS_TXT[h.answer]}</span>` : ''}</div>`).join('') : '<div class="muted small">مفيش أسئلة</div>'}
    </div></details>
    <div class="card"><h3 class="mb">📊 الترتيب لحد دلوقتي</h3>${ranking.map((p, i) => `<div class="rank-row ${p.id === st.you.id ? 'me' : ''}"><span class="pos">#${i + 1}</span><span>${p.avatar}</span><span>${esc(p.name)}</span><span class="sc">${p.score}</span></div>`).join('')}</div>
    <div class="card tight center">
      ${st.youReady
        ? '<div style="font-weight:900;color:var(--brass-hi)">تمام ✅ مستنيين الباقي</div>'
        : `<button class="btn primary big" id="ready-btn">${ce.isLast ? '🏁 النتيجة النهائية' : '⬅️ القضية الجاية'}</button>`}
      <div class="muted small mt">جاهزين: <span id="r-n">${(st.readyIds || []).length}</span>/${readyTotal}</div>
      ${st.you.isHost ? '<button class="btn sm ghost mt" id="force-btn" style="width:100%">⏭️ كمّلوا من غير المتأخرين</button>' : ''}
    </div>`;
  lockBtn($('#ready-btn'), () => { Snd.play('pick'); return act('readyNext'); });
  const fb = $('#force-btn'); if (fb) fb.onclick = async () => { if (await uiConfirm('تكمّلوا من غير المتأخرين؟', { emoji: '⏭️', okLabel: 'كمّل', danger: false })) act('forceNext'); };
}
function patchCaseEnd(st) { const n = $('#r-n'); if (n) n.textContent = (st.readyIds || []).length; }

/* ===== النهاية — الكشف الكامل ===== */
function confetti() {
  const box = document.createElement('div'); box.className = 'confetti';
  const colors = ['#2563eb', '#60a5fa', '#22d3ee', '#fbbf24', '#F4EDDF'];
  for (let i = 0; i < 90; i++) { const s = document.createElement('i'); s.style.left = Math.random() * 100 + 'vw'; s.style.background = colors[i % colors.length]; s.style.animationDuration = (2.2 + Math.random() * 2) + 's'; s.style.animationDelay = (Math.random() * .8) + 's'; s.style.transform = 'rotate(' + Math.random() * 360 + 'deg)'; box.appendChild(s); }
  document.body.appendChild(box); setTimeout(() => box.remove(), 5200);
}
function buildGameover(st) {
  stopTimers(); const R = st.results, me = st.you; const hostP = st.players.find(p => p.isHost) || {};
  Snd.play('win'); confetti();
  const top3 = R.ranking.slice(0, 3);
  const pod = i => top3[i] ? `<div class="pod p${i + 1}"><div class="pav">${top3[i].avatar}</div><div class="pnm">${esc(top3[i].name)}</div><div class="psc">${top3[i].score}</div><div class="bar">${i + 1}</div></div>` : '';
  const caseCard = (c, i) => `
    <details class="case-rev">
      <summary>
        <span class="cr-n">القضية ${i + 1}</span>
        <span class="cr-w">🔓 «${esc(c.secret)}»</span>
        <span class="cr-cat">${c.cat ? c.cat.icon : ''}</span>
        <span class="cr-acc">${c.accusedAvatar} ${esc(c.accusedName)}</span>
      </summary>
      <div class="cr-body">
        ${c.accusedPenalty ? `<div class="penalty-note">المتّهم اتخصم منه ${c.accusedPenalty} نقاط</div>` : ''}
        <div class="cr-sec">🔐 إجابات المحققين</div>
        ${(c.answers || []).map(a => `<div class="guess-item ${a.correct ? 'correct' : ''}"><span class="who">${a.avatar} ${esc(a.name)}</span><span class="gtext">${a.answer ? `«${esc(a.answer)}»` : '— مسلّمش'} ${a.correct ? `✅ ج${a.round} +${a.points}` : '❌'}</span></div>`).join('')}
        <div class="cr-sec" style="margin-top:10px">📜 سجل التحقيق</div>
        ${(c.history || []).length ? (c.history || []).map(h => `<div class="log-item"><div class="muted small">ج${h.round} · ${h.avatar} ${esc(h.name)}</div><div style="font-weight:800">${esc(h.text)}</div>${h.answer ? `<span class="ans-badge ${h.answer}" style="font-size:14px;padding:2px 10px">${ANS_TXT[h.answer]}</span>` : ''}</div>`).join('') : '<div class="muted small">مفيش أسئلة اتسألت</div>'}
      </div>
    </details>`;
  app.innerHTML = `${header('خلصت اللعبة! 🎉')}
    <div class="bunting teal"></div>
    <div class="card center"><h2 class="display" style="font-size:30px">🏆 نتيجة السهرة</h2><div class="podium">${pod(1)}${pod(0)}${pod(2)}</div></div>
    <div class="card"><h3 class="mb">🎖️ الجوايز</h3>${R.awards.map(a => `<div class="award"><span class="aic">${a.icon}</span><div><div class="at">${esc(a.title)}: ${esc(a.who)}</div><div class="ad">${esc(a.detail)}</div></div></div>`).join('')}</div>
    <div class="card"><h3 class="mb">📊 الترتيب النهائي</h3>${R.ranking.map(p => `<div class="rank-row ${p.id === me.id ? 'me' : ''}"><span class="pos">#${p.rank}</span><span>${p.avatar}</span><span>${esc(p.name)}${p.left ? ' <span class="muted small">🚪</span>' : ''}</span><span class="sc">${p.score}</span></div>`).join('')}</div>
    <div class="card"><h3 class="mb">🗂️ ملف القضايا — اكشف كل حاجة</h3><div class="muted small mb">دوس على أي قضية تشوف كلمتها، وكل التخمينات، ومين عرفها 👇</div>${(R.review || []).map(caseCard).join('')}</div>
    ${me.isHost ? '<button class="btn primary big" id="again-btn">🔄 نلعب تاني (متّهم جديد)</button>' : `<div class="card tight center">جولة تانية؟ <b>${esc(hostP.name || '')}</b> 👑</div>`}
    <button class="btn ghost big mt" id="leave-btn">🏠 خروج</button>`;
  const ab = $('#again-btn'); if (ab) lockBtn(ab, () => act('playAgain'));
  $('#leave-btn').onclick = async () => { if (await uiConfirm('تخرج من الروم؟', { emoji: '🏠', okLabel: 'اخرج' })) { await act('leave'); leaveLocal(); } };
}

const BUILD = { lobby: buildLobby, pick: buildPick, play: buildPlay, caseEnd: buildCaseEnd, gameover: buildGameover };
const PATCH = { lobby: () => {}, pick: patchPick, play: patchPlay, caseEnd: patchCaseEnd, gameover: () => {} };

/* ===== التعليمات ===== */
const CONAN_STEPS = [
  ['🎯', 'اللعبة إيه؟', 'لاعب واحد (<span class="hl">المتّهم</span>) معاه كلمة سرية، والباقي (<span class="hl">المحققين</span>) بيسألوه أسئلة إجابتها <b>أه / لا / مش قادر أحدد</b> — واللي يعرف الكلمة الأول يكسب أكتر.'],
  ['🔒', 'الكشف بعد كل قضية', 'وانت بتلعب القضية، لو سلّمت إجابتك بتتقفل و<span class="warn">محدش يعرف صح ولا غلط غير لما القضية تخلص</span>. أول ما القضية تتقفل بتتكشف الكلمة وكل التخمينات ومين عرفها، وتتحسب النقط ويتحدّث الترتيب.'],
  ['🔄', 'الأدوار بالعدل', '<span class="hl">كل لاعب هيبقى المتّهم نفس عدد المرات</span> — الهوست بيحدد كام مرة. و«عشوائي» بيخلط <b>الترتيب بس</b>، فمحدش ياخد الدور أكتر من غيره.'],
  ['⚙️', 'الهوست بيحدد', 'الكاتيجوريز، كام مرة كل لاعب يبقى متّهم، <span class="hl">عدد أسئلة كل محقق (2–10)</span>، الترتيب، وهل المتّهم يكتب كلمته، ووقت السؤال والرد.'],
  ['🎭', 'المتّهم', 'بياخد كلمة من البنك، أو يكتب واحدة بنفسه لو الهوست سامح بكده. <span class="warn">لازم يرد بصدق</span> — الكلمة قدامه طول الوقت.'],
  ['🔎', 'الأسئلة بالدور', 'كل جولة = <span class="hl">سؤال واحد من كل محقق</span>. السؤال والرد بيظهروا للكل. وممنوع تكرار سؤال اتسأل قبل كده.'],
  ['🧠', 'ركّز واحفظ', '<span class="warn">مفيش سجل للأسئلة القديمة</span> — كل سؤال بيظهر في وقته وبعدين يعدّي. اللي بيفتكر أكتر بيكسب.'],
  ['💯', 'سلّم ولا تكمّل؟ والنقط', 'آخر كل جولة تختار: تسلّم إجابتك (وتتقفل) ولا تكمّل تحقيق. إجابة صح بعد الجولة 1 = <span class="hl">100</span>، الجولة 2 = <span class="hl">90</span>، وهكذا لحد <span class="hl">10</span>. <b>كل ما تتأخر تقل نقطك</b> — وآخر جولة لازم تسلّم.'],
  ['⚠️', 'عقوبة المتّهم', 'المتّهم <span class="hl">مبياخدش نقط خالص</span>. ولو الهوست حط وقت للرد ومردّش في الوقت، <span class="warn">بيتخصم منه 10 نقط عن كل سؤال</span>.'],
  ['🚪', 'قطع النت وحاجات', 'لو حد قطع النت اللعبة <span class="hl">بتقف وتستنّاه</span> مبتتلغيش، وترجع أول ما يرجع. الكلمات متتكررش في الروم. ولو خرجت سكورك بيفضل محسوب.'],
];
function showHelp() {
  const ov = document.createElement('div'); ov.className = 'help-ov';
  ov.innerHTML = `<div class="help-card">
    <div class="help-hero"><img src="/img/conan.png" alt="" onerror="this.style.display='none'"><h2>المحقق والمتهم</h2><div class="sub">اسأل.. حلل.. واعرف الكلمة 🔎</div></div>
    <div class="help-body">${CONAN_STEPS.map(([e, t, d]) => `<div class="help-step"><div class="help-num">${e}</div><div><h4>${t}</h4><p>${d}</p></div></div>`).join('')}</div>
    <div class="help-foot"><label class="help-chk"><input type="checkbox" id="help-off"> متظهرش تاني في الجهاز ده</label><button class="btn primary big" id="help-ok">تمام، يلا نلعب 🚀</button></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { if ($('#help-off') && $('#help-off').checked) LS.set('lamma_help_off_conan', true); ov.remove(); };
  $('#help-ok').onclick = close; ov.onclick = e => { if (e.target === ov) close(); };
}

(async function boot() {
  document.body.addEventListener('pointerdown', () => Snd.ensure(), { once: true });
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (S.save && S.save.code && S.save.token) {
    const r = await api('/api/conan/join', { code: S.save.code, token: S.save.token });
    if (r.ok) { openStream(); return; }
    LS.del('conan_save'); S.save = null;
    if (r.gone) toast('الروم القديم خلص', 'err');
  }
  renderHome(urlRoom || '');
  if (!LS.get('lamma_help_off_conan', false)) setTimeout(showHelp, 350);
})();
