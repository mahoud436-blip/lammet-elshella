/* تحدي الشلة — واجهة اللعبة */
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
const SHAPES = ['▲', '◆', '●'];
const CH_CLASS = ['cA', 'cB', 'cC'];
const AVATARS = ['🦅','🛡️','⚔️','🏆','🎯','🧠','⚡','🔥','👑','🚀','💎','🏹','♟️','🎓','⚙️','🔭','📚','🧭','🥇','🗺️','🏛️','⭐','🌋','🔱'];
const ALL_CATS = [
  ['movies', '🎬', 'أفلام ومسلسلات'], ['anime', '🍥', 'أنمي وكرتون'], ['hist_islam', '🕌', 'تاريخ إسلامي'],
  ['hist_ar', '🏺', 'تاريخ مصر والعرب'], ['geo_ar', '🗺️', 'جغرافيا عربية'], ['geo_world', '🌍', 'جغرافيا العالم'],
  ['religion', '📿', 'معلومات دينية'], ['sports', '⚽', 'رياضة'], ['sci', '🔬', 'علوم وتكنولوجيا'], ['mix', '🎲', 'منوعات ومكس'],
];

/* ======================= الصوت ======================= */
const Snd = {
  ctx: null, muted: LS.get('tahadi_mute', false),
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
  toggle() { this.muted = !this.muted; LS.set('tahadi_mute', this.muted); toast(this.muted ? 'الصوت اتقفل 🔇' : 'الصوت اتفتح 🔊'); }
};

/* ======================= الحالة ======================= */
const S = {
  save: LS.get('tahadi_save', null),
  name: LS.get('tahadi_name', ''),
  avatar: LS.get('tahadi_av', AVATARS[Math.floor(Math.random() * AVATARS.length)]),
  st: null,
  es: null, lastMsg: 0, skew: 0,
  viewKey: '',
  editorOpen: false, editorSlot: -1, editBuf: null,
  slots: [], slotsSig: '',
  answeredLocal: false,
  wake: null,
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
  const r = await api('/api/tahadi/action', Object.assign({ code: S.save.code, token: S.save.token, action }, extra || {}));
  if (!r.ok && r.error) toast(r.error, 'err');
  return r;
}

/* ======================= الاتصال المستمر ======================= */
function openStream() {
  if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; }
  if (!S.save) return;
  const es = new EventSource('/api/tahadi/stream?code=' + encodeURIComponent(S.save.code) + '&token=' + encodeURIComponent(S.save.token));
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
setInterval(() => {
  if (!S.save || !S.es) return;
  if (Date.now() - S.lastMsg > 40000) { openStream(); }
}, 10000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.save) {
    if (!S.es || S.es.readyState === 2 || Date.now() - S.lastMsg > 20000) openStream();
    grabWake();
  }
});
function grabWake() {
  if (!('wakeLock' in navigator)) return;
  if (S.st && (S.st.phase === 'quiz' || S.st.phase === 'writing')) {
    navigator.wakeLock.request('screen').then(w => { S.wake = w; }).catch(() => {});
  }
}
function leaveLocal() {
  if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; }
  if (S.save) LS.del('tahadi_slots_' + S.save.code);
  S.save = null; LS.del('tahadi_save');
  S.st = null; S.viewKey = ''; S.editorOpen = false; S.slots = [];
  renderHome();
}

/* ======================= هيدر عام ======================= */
function header(sub) {
  return `<div class="bunting"></div>
  <div class="top">
    <img src="/img/asal-sm.png" alt="">
    <div><div class="title display">اسأل واستفيد</div><div class="sub">${esc(sub || 'اسأل.. جاوب.. واطلع من كل جولة بمعلومة 💡')}</div></div>
    <button class="btn sm ghost" id="help-btn" style="margin-inline-start:auto">؟</button>
    <button class="btn sm ghost" id="home-btn">🏠</button>
    <button class="btn sm ghost" id="mute-btn">${Snd.muted ? '🔇' : '🔊'}</button>
  </div>
  ${S.save ? '<button class="leave-fab" id="leave-fab" title="اخرج من الروم">🚪</button>' : ''}
  <div id="presence-bar" class="presence-bar hidden"></div>`;
}
function bindHeader() {}
/* تفويض عام: الأزرار دي شغالة في كل الشاشات مهما كان ترتيب التحميل */
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
/* مراقبة الحضور: لو حد نزّل اللعبة تحت أو فتح حاجة تانية — الكل يشوف ❗ */
function sendPresence(away) { if (S.save) act('presence', { away: !!away }); }
document.addEventListener('visibilitychange', () => sendPresence(document.visibilityState !== 'visible'));
window.addEventListener('blur', () => sendPresence(true));
window.addEventListener('focus', () => sendPresence(false));
function updPresence(st) {
  const el = $('#presence-bar');
  if (!el) return;
  const show = st && (st.phase === 'writing' || st.phase === 'quiz');
  el.classList.toggle('hidden', !show);
  if (!show) return;
  el.innerHTML = st.players.map(p => {
    const cls = p.left ? 'gone' : (!p.connected ? 'off' : (p.away ? 'away' : 'here'));
    const badge = p.left ? '🚪' : (!p.connected ? '⏳' : (p.away ? '❗' : ''));
    return `<span class="pv ${cls}" title="${esc(p.name)}${p.away ? ' — خرج من اللعبة!' : ''}"><span class="av">${p.avatar}</span>${badge ? `<span class="bd">${badge}</span>` : ''}</span>`;
  }).join('');
}

/* ======================= شاشة البداية ======================= */
function renderHome(prefillCode) {
  S.viewKey = 'home';
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
      <button class="btn primary big mt" id="create-btn">💡 اعمل روم جديد</button>
      <div class="or">أو</div>
      <input class="field code-input" id="code-in" inputmode="numeric" maxlength="4" placeholder="• • • •" value="${esc(code)}">
      <button class="btn teal big mt" id="join-btn">🚪 ادخل الروم</button>
    </div>
    <div class="card tight center muted small">
      اللعبة شغالة من المتصفح على أي موبايل 📱 — من غير ما حد ينزّل حاجة.
    </div>`;
  bindHeader();
  $('#av-btn').onclick = () => {
    Snd.play('pick');
    S.avatar = AVATARS[(AVATARS.indexOf(S.avatar) + 1) % AVATARS.length];
    LS.set('tahadi_av', S.avatar);
    $('#av-btn').textContent = S.avatar;
  };
  const nameIn = $('#name-in');
  nameIn.oninput = () => { S.name = nameIn.value; LS.set('tahadi_name', S.name); };
  $('#create-btn').onclick = async () => {
    Snd.ensure();
    const name = nameIn.value.trim();
    if (!name) return toast('اكتب اسمك الأول ✍️', 'err');
    const r = await api('/api/tahadi/create', { name, avatar: S.avatar });
    if (!r.ok) return toast(r.error || 'مشكلة', 'err');
    S.save = { code: r.code, token: r.token }; LS.set('tahadi_save', S.save);
    openStream();
  };
  $('#join-btn').onclick = async () => {
    Snd.ensure();
    const name = nameIn.value.trim();
    const c = $('#code-in').value.trim();
    if (!name) return toast('اكتب اسمك الأول ✍️', 'err');
    if (!/^\d{4}$/.test(c)) return toast('الكود 4 أرقام', 'err');
    const r = await api('/api/tahadi/join', { code: c, name, avatar: S.avatar });
    if (!r.ok) return toast(r.error || 'مشكلة', 'err');
    S.save = { code: r.code, token: r.token }; LS.set('tahadi_save', S.save);
    openStream();
  };
}

/* ======================= الراوتر ======================= */
function render() {
  const st = S.st;
  if (!st) return;
  updPresence(st);
  const key = st.phase + '|' + (st.question ? st.question.sub + '|' + st.question.i : '') + '|' + (st.you.ready ? 'r' : 'w');
  if (st.phase === 'writing') {
    ensureSlots(st);
    if (S.editorOpen) { patchWritingLive(st); return; }
  }
  if (key === S.viewKey) {
    if (st.phase === 'lobby') return renderLobby(st);
    if (st.phase === 'writing') return renderWriting(st);
    if (st.phase === 'quiz' && st.question && st.question.sub === 'answering') return patchQuiz(st);
    return;
  }
  S.viewKey = key;
  if (st.phase === 'lobby') renderLobby(st);
  else if (st.phase === 'writing') renderWriting(st);
  else if (st.phase === 'quiz') renderQuiz(st);
  else if (st.phase === 'results') renderResults(st);
}

/* ======================= اللوبي ======================= */
function joinUrl(st) {
  const loc = location;
  if ((loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') && st.net && !st.net.hosted && st.net.ips && st.net.ips.length)
    return 'http://' + st.net.ips[0] + ':' + st.net.port + '/tahadi/?room=' + st.code;
  return loc.origin + '/tahadi/?room=' + st.code;
}
function renderLobby(st) {
  const me = st.you, isHost = me.isHost;
  const url = joinUrl(st);
  const hostName = (st.players.find(p => p.isHost) || {}).name || '';
  const total = st.qTotal;
  const tooMany = total > 20;
  app.innerHTML = `
    ${header('ابعت الكود لصحابك وكل واحد يدخل من موبايله')}
    <div class="card center">
      <div class="muted">كود الروم</div>
      <div class="room-code" id="code-copy" title="دوس للنسخ">${st.code}</div>
      <div class="join-url mt" id="url-copy" title="دوس للنسخ">${esc(url)}</div>
      <div class="qr-wrap" id="qr"></div>
      <div class="muted small">صوّر الكود بكاميرا الموبايل وهتدخل على طول 📸</div>
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
    </div>

    <div class="card">
      <h3>إعدادات الجولة ${isHost ? '' : '<span class="muted small">(بيظبطها ' + esc(hostName) + ' 👑)</span>'}</h3>

      <div class="mt center muted small">كل لاعب هيجهّز كام سؤال <b>في كل كاتيجوري</b>؟</div>
      <div class="stepper">
        <button class="btn" id="qpc-minus" ${isHost ? '' : 'disabled'}>−</button>
        <div class="val">${st.settings.qPerCat}</div>
        <button class="btn" id="qpc-plus" ${isHost ? '' : 'disabled'}>+</button>
      </div>

      <div class="mt center muted small">اختاروا الكاتيجوريز (من 1 لـ 10)</div>
      <div class="count-note">مختار <b id="cat-count">${st.settings.cats.length}</b> كاتيجوري</div>
      <div class="cats-grid mt" id="cats-grid"></div>

      <div class="count-note mt" style="font-size:17px">
        الإجمالي: كل لاعب هيجهّز <b>${total}</b> سؤال
        <span class="muted small">(${st.settings.qPerCat} × ${st.settings.cats.length})</span>
      </div>
      ${tooMany ? '<div class="center" style="color:var(--coral);font-weight:800">كتير أوي! أقصى حاجة 20 سؤال للاعب — قلل العدد أو الكاتيجوريز</div>' : ''}

      <div class="mt center muted small">وقت السؤال</div>
      <div class="row wrap" style="justify-content:center">
        ${[0, 10, 15, 20, 30].map(t => `<span class="chip click ${st.settings.qTime === t ? 'on' : ''}" data-time="${t}">${t === 0 ? 'من غير وقت ♾️' : t + ' ثانية'}</span>`).join('')}
      </div>
    </div>

    ${isHost
      ? `<button class="btn primary big" id="start-btn" ${st.players.length >= 2 && !tooMany && st.settings.cats.length >= 1 ? '' : 'disabled'}>🚀 يلا نبدأ تجهيز الأسئلة</button>
         ${st.players.length < 2 ? '<div class="center muted small mt">مستنيين حد تاني يدخل عشان نبدأ</div>' : ''}`
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

  let cats = st.settings.cats.slice();
  const grid = $('#cats-grid');
  grid.innerHTML = ALL_CATS.map(([id, ic, nm]) => `
    <div class="cat-chip ${cats.includes(id) ? 'on' : ''} ${isHost ? '' : 'locked'}" data-cat="${id}">
      <span class="ic">${ic}</span><span>${nm}</span>
    </div>`).join('');
  if (isHost) {
    $$('.cat-chip', grid).forEach(el => el.onclick = () => {
      const id = el.dataset.cat;
      if (cats.includes(id)) {
        if (cats.length === 1) return toast('لازم كاتيجوري واحدة على الأقل', 'err');
        cats = cats.filter(c => c !== id);
      } else cats.push(id);
      el.classList.toggle('on');
      $('#cat-count').textContent = cats.length;
      act('setSettings', { settings: { cats } });
    });
    $('#qpc-minus').onclick = () => act('setSettings', { settings: { qPerCat: Math.max(1, st.settings.qPerCat - 1) } });
    $('#qpc-plus').onclick = () => act('setSettings', { settings: { qPerCat: Math.min(10, st.settings.qPerCat + 1) } });
    $$('.chip[data-time]').forEach(el => el.onclick = () => act('setSettings', { settings: { qTime: parseInt(el.dataset.time, 10) } }));
    $('#start-btn').onclick = () => { Snd.play('q'); act('startWriting'); };
    $$('.kick').forEach(b => b.onclick = () => { if (confirm('متأكد عايز تطرده؟')) act('kick', { playerId: b.dataset.kick }); });
  }
  $('#leave-btn').onclick = async () => { if (confirm('تخرج من الروم؟')) { await act('leave'); leaveLocal(); } };
}

/* ======================= مرحلة تجهيز الأسئلة ======================= */
function planSlots(st) {
  const out = [];
  for (const c of st.plan) for (let i = 0; i < c.count; i++) out.push({ cat: c.id, catName: c.name, icon: c.icon });
  return out;
}
function slotsSig(st) { return st.plan.map(c => c.id + ':' + c.count).join(','); }
function ensureSlots(st) {
  const sig = slotsSig(st);
  const key = 'tahadi_slots_' + st.code;
  if (S.slotsSig !== sig || S.slots.length !== st.qTotal) {
    const saved = LS.get(key, null);
    const tmpl = planSlots(st);
    S.slots = tmpl.map((t, i) => {
      const sv = saved && saved.sig === sig && saved.slots[i];
      return Object.assign({}, t, { filled: sv ? sv.filled : null, dr: sv ? (sv.dr || 0) : 0 });
    });
    S.slotsSig = sig;
  }
  // أي سؤال طلعلك من البنك (حتى بعد ريفريش) يرجع مكانه
  if (st.yourDrawn && st.yourDrawn.length && !st.you.ready) {
    for (const d of st.yourDrawn) {
      const already = S.slots.some(s => s.filled && s.filled.source === 'bank' && s.filled.bankId === d.bankId);
      if (already) continue;
      const empty = S.slots.find(s => s.cat === d.cat && !s.filled);
      if (empty) { empty.filled = { source: 'bank', bankId: d.bankId, q: d.q, choices: d.choices, a: d.a }; if (!empty.dr) empty.dr = 1; }
    }
  }
  // بعد "أعدّل": رجّع الأسئلة المتسلّمة من السيرفر
  if (!st.you.ready && st.yourSlots && st.yourSlots.length && S.slots.every(s => !s.filled)) {
    const pool = st.yourSlots.slice();
    for (const s of S.slots) {
      const idx = pool.findIndex(x => x.cat === s.cat);
      if (idx >= 0) { const it = pool.splice(idx, 1)[0]; s.filled = { source: it.source, bankId: it.bankId, q: it.q, choices: it.choices.slice(), a: it.a }; }
    }
  }
  saveSlots(st);
}
let draftT = null;
function pushDraft() {
  clearTimeout(draftT);
  draftT = setTimeout(() => {
    if (!S.save || !S.st || S.st.phase !== 'writing') return;
    act('syncDraft', { slots: S.slots.map(s => s.filled ? Object.assign({ cat: s.cat }, s.filled) : null) });
  }, 400);
}
function saveSlots(st) { LS.set('tahadi_slots_' + st.code, { sig: S.slotsSig, slots: S.slots.map(s => ({ filled: s.filled, dr: s.dr || 0 })) }); pushDraft(); }
function filledCount() { return S.slots.filter(s => s.filled).length; }

function renderWriting(st) {
  if (st.you.ready) return renderWaiting(st);
  if (S.editorOpen) return renderEditor(st);
  const total = st.qTotal, done = filledCount();
  const byCat = {};
  S.slots.forEach((s, i) => { (byCat[s.cat] = byCat[s.cat] || []).push([s, i]); });
  app.innerHTML = `
    ${header('اكتب بنفسك ✍️ أو اسحب سؤال عشوائي نهائي 🎲')}
    <div class="card tight center">
      <h2 class="display">أسئلتك <span style="color:var(--brass-hi)">${done}/${total}</span></h2>
      <div class="progress-cats mt">
        ${st.plan.map(c => { const g = (byCat[c.id] || []); const d = g.filter(x => x[0].filled).length; return `<span class="chip ${d === c.count ? 'on' : ''}">${c.icon} ${esc(c.name)} ${d}/${c.count}</span>`; }).join('')}
      </div>
      <div class="muted small mt">🎲 السحب بيجيب سؤال عشوائي <b>بإجابته</b> — مش عاجبك؟ <b>بدّله لحد 3 محاولات للخانة</b>. وأي سؤال يظهر بيتحذف من بنك الروم نهائي.</div>
      <div class="muted small" id="live-note"></div>
    </div>
    ${st.plan.map(c => `
      <div class="card">
        <h3>${c.icon} ${esc(c.name)} <span class="muted small">(فاضل في البنك: <b data-bankleft="${c.id}">${st.bankLeft ? st.bankLeft[c.id] : '—'}</b>)</span></h3>
        ${(byCat[c.id] || []).map(([s, i]) => s.filled ? `
          <div class="slot done">
            <div class="src-tag">${s.filled.source === 'bank' ? '🎲 من البنك' + ((s.dr || 1) >= 3 ? ' — خلصت المحاولات 🔒' : ' — محاولة ' + (s.dr || 1) + ' من 3') : '✍️ من دماغك'}</div>
            <div class="qtext">${esc(s.filled.q)}</div>
            <div class="mini-ch">${s.filled.choices.map((ch, ci) => `<span class="${ci === s.filled.a ? 'ok' : ''}">${SHAPES[ci]} ${esc(ch)} ${ci === s.filled.a ? '✅' : ''}</span>`).join('')}</div>
            <div class="row mt">
              ${s.filled.source === 'self'
                ? `<button class="btn sm" data-edit="${i}">✏️ تعديل</button>
                   <button class="btn sm ghost" data-del="${i}">🗑️ حذف</button>`
                : `${(s.dr || 1) < 3 ? `<button class="btn sm teal" data-swap="${i}">🎲 بدّله (فاضل ${3 - (s.dr || 1)})</button>` : ''}
                   <button class="btn sm ghost" data-burn="${i}">✍️ اكتب بدال منه</button>`}
            </div>
          </div>` : `
          <div class="slot">
            <div class="muted small">${(s.dr || 0) >= 3 ? 'خلصت محاولات البنك للخانة دي — اكتب بنفسك ✍️' : 'خانة فاضية'}</div>
            <div class="row mt">
              ${(s.dr || 0) >= 3 ? '' : `<button class="btn teal grow" data-bank="${i}">🎲 من البنك${s.dr ? ' (فاضل ' + (3 - s.dr) + ')' : ''}</button>`}
              <button class="btn coral grow" data-self="${i}">✍️ اكتب بنفسك</button>
            </div>
          </div>`).join('')}
      </div>`).join('')}
    <button class="btn primary big" id="done-btn" ${done === total ? '' : 'disabled'}>${done === total ? 'خلصت ✅ سلّم أسئلتك' : `كمّل الأسئلة الأول (${done}/${total})`}</button>
    <button class="btn ghost big mt" id="leave-btn">🚪 اخرج من الروم</button>`;
  bindHeader();
  $$('[data-bank]').forEach(b => b.onclick = () => drawInto(parseInt(b.dataset.bank, 10)));
  $$('[data-self]').forEach(b => b.onclick = () => openSelf(st, parseInt(b.dataset.self, 10), null));
  $$('[data-edit]').forEach(b => b.onclick = () => {
    const i = parseInt(b.dataset.edit, 10);
    openSelf(st, i, S.slots[i].filled);
  });
  $$('[data-del]').forEach(b => b.onclick = () => {
    const i = parseInt(b.dataset.del, 10);
    S.slots[i].filled = null; saveSlots(S.st); renderWriting(S.st);
  });
  $$('[data-swap]').forEach(b => b.onclick = () => drawInto(parseInt(b.dataset.swap, 10)));
  $$('[data-burn]').forEach(b => b.onclick = () => {
    const i = parseInt(b.dataset.burn, 10);
    if (!confirm('السؤال ده محسوب من البنك ومش هيرجع. هتكتب سؤال بنفسك بداله؟')) return;
    S.slots[i].filled = null; saveSlots(S.st);
    openSelf(S.st, i, null);
  });
  $('#done-btn').onclick = submitAll;
  $('#leave-btn').onclick = async () => { if (confirm('تخرج؟ أسئلتك هتضيع')) { await act('leave'); leaveLocal(); } };
}

function patchWritingLive(st) {
  $$('[data-bankleft]').forEach(el => { if (st.bankLeft) el.textContent = st.bankLeft[el.dataset.bankleft]; });
  const note = $('#live-note');
  if (note) {
    const ready = st.players.filter(p => p.ready).length;
    note.textContent = ready ? `جهّز خلاص: ${ready}/${st.players.length} 🏃` : '';
  }
}

/* السحب الإجباري: سؤال عشوائي بإجابته — نهائي */
async function drawInto(slotIdx) {
  const slot = S.slots[slotIdx];
  const used = slot.dr || 0;
  if (used >= 3) return toast('خلصت الـ3 محاولات للخانة دي ✍️', 'err');
  const left = 3 - used;
  if (!used && !confirm(`🎲 هيطلعلك سؤال عشوائي من «${slot.catName}» بإجابته. ليك ${left} محاولات للخانة دي، وأي سؤال يظهر بيتحذف من بنك الروم. نسحب؟`)) return;
  const r = await act('bankDraw', { cat: slot.cat });
  if (r.ok) {
    Snd.play('ok');
    slot.dr = used + 1;
    slot.filled = { source: 'bank', bankId: r.item.bankId, q: r.item.q, choices: r.item.choices, a: r.item.a };
    saveSlots(S.st);
    toast(slot.dr >= 3 ? 'دي آخر محاولة — السؤال ده ثابت خلاص 🔒' : `تمام! لو مش عاجبك تقدر تبدّله (فاضل ${3 - slot.dr}) 🎲`, 'ok');
    renderWriting(S.st);
  }
}

function openSelf(st, slotIdx, prefill) {
  S.editorOpen = true; S.editorSlot = slotIdx;
  S.editBuf = prefill ? { q: prefill.q, choices: prefill.choices.slice(), a: prefill.a } : { q: '', choices: ['', '', ''], a: -1 };
  renderEditor(st);
}
function closeEditor() { S.editorOpen = false; S.editBuf = null; renderWriting(S.st); }

function renderEditor(st) {
  const slot = S.slots[S.editorSlot];
  const catLabel = `${slot.icon} ${esc(slot.catName)}`;
  const b = S.editBuf;
  app.innerHTML = `
    ${header('اكتب سؤالك بنفسك ✍️')}
    <div class="card">
      <span class="chip on">${catLabel}</span>
      <div class="mt"><label class="muted small">السؤال</label>
        <textarea class="field" id="q-in" maxlength="200" placeholder="مثال: إيه أكبر كوكب في المجموعة الشمسية؟">${esc(b.q)}</textarea></div>
      <div class="muted small mt">الاختيارات التلاتة — ودوس على الشكل عشان تعلّم الإجابة الصح</div>
      ${[0, 1, 2].map(i => `
        <div class="choice-edit">
          <button class="mark ${b.a === i ? 'on' : ''}" data-mark="${i}">${b.a === i ? '✅' : SHAPES[i]}</button>
          <input class="field grow" data-ch="${i}" maxlength="90" placeholder="اختيار ${i + 1}" value="${esc(b.choices[i])}">
        </div>`).join('')}
      <button class="btn primary big mt" id="save-q">💾 حفظ السؤال</button>
      <button class="btn ghost big mt" id="back-btn">↩️ رجوع من غير حفظ</button>
    </div>`;
  bindHeader();
  $('#q-in').oninput = e => b.q = e.target.value;
  $$('[data-ch]').forEach(inp => inp.oninput = () => b.choices[parseInt(inp.dataset.ch, 10)] = inp.value);
  $$('[data-mark]').forEach(btn => btn.onclick = () => {
    b.a = parseInt(btn.dataset.mark, 10); Snd.play('pick');
    $$('[data-mark]').forEach(x => { const i = parseInt(x.dataset.mark, 10); x.classList.toggle('on', i === b.a); x.textContent = i === b.a ? '✅' : SHAPES[i]; });
  });
  $('#back-btn').onclick = closeEditor;
  $('#save-q').onclick = () => {
    const q = b.q.trim(), chs = b.choices.map(c => c.trim());
    if (!q) return toast('اكتب السؤال الأول', 'err');
    if (chs.some(c => !c)) return toast('كمّل التلات اختيارات', 'err');
    if (new Set(chs.map(c => c.toLowerCase())).size !== 3) return toast('في اختيارين زي بعض!', 'err');
    if (b.a < 0) return toast('علّم الإجابة الصح ✅', 'err');
    S.slots[S.editorSlot].filled = { source: 'self', q, choices: chs, a: b.a };
    saveSlots(S.st); Snd.play('ok'); closeEditor();
  };
}

async function submitAll() {
  const slots = S.slots.map(s => {
    const f = s.filled;
    return f.source === 'bank'
      ? { cat: s.cat, source: 'bank', bankId: f.bankId }
      : { cat: s.cat, source: 'self', q: f.q, choices: f.choices, a: f.a };
  });
  const r = await act('submitQuestions', { slots });
  if (r.ok) Snd.play('ok');
}

function renderWaiting(st) {
  const me = st.you;
  const readyCount = st.players.filter(p => p.ready).length;
  const auto = st.autoStartAt ? Math.max(0, Math.ceil((st.autoStartAt - (Date.now() + S.skew)) / 1000)) : null;
  app.innerHTML = `
    ${header('استنى باقي الشلة يخلصوا أسئلتهم')}
    <div class="card center">
      <div style="font-size:54px">📨</div>
      <h2 class="display">أسئلتك اتسلّمت!</h2>
      <div class="muted">جاهز: ${readyCount}/${st.players.length}</div>
      ${auto != null ? `<h3 class="display mt" style="color:var(--brass-hi)">الكل جاهز! هنبدأ خلال ${auto}.. 🚦</h3>` : ''}
    </div>
    <div class="card">
      <div class="waiting-list">
        ${st.players.map(p => `
          <div class="wrow"><span>${p.avatar}</span><span>${esc(p.name)}${p.id === me.id ? ' (انت)' : ''}</span>
            ${p.left ? '<span class="wr">خرج 🚪</span>' : (p.ready ? '<span class="ok">جاهز ✅</span>' : (p.connected ? '<span class="wr">بيكتب ✍️</span>' : '<span class="wr">اتفصل ⏳</span>'))}
          </div>`).join('')}
      </div>
    </div>
    <button class="btn teal big" id="edit-btn">✏️ أعدّل أسئلتي</button>
    ${me.isHost ? `<button class="btn primary big mt" id="force-btn">🚀 ابدأ دلوقتي</button>
    <div class="center muted small mt">اللي لسه بيكتب: اللي خلّصه هيتحسب والباقي هيتكمّل من البنك تلقائي — محدش بياخد ميزة 😉</div>` : ''}
    `;
  bindHeader();
  $('#edit-btn').onclick = async () => { const r = await act('editQuestions'); if (r.ok) { S.viewKey = ''; render(); } };
  const fb = $('#force-btn');
  if (fb) fb.onclick = () => act('forceStartQuiz');
}

/* ======================= الكويز ======================= */
let timerRAF = null;
function stopTimer() { if (timerRAF) cancelAnimationFrame(timerRAF); timerRAF = null; }

function renderQuiz(st) {
  stopTimer();
  const q = st.question, me = st.you;
  S.answeredLocal = q.yourChoice != null;
  if (q.sub === 'answering') Snd.play('q');
  grabWake();

  const srcTag = q.fromBank ? '🎲 من البنك' : '✍️ من دماغه';
  const headHtml = `
    <div class="q-head">
      <div class="q-idx">سؤال ${q.i + 1}/${q.total}</div>
      <span class="chip">${q.cat.icon} ${esc(q.cat.name)}</span>
      ${me.isHost && q.sub === 'answering' ? '<button class="btn sm" id="skip-btn">⏭️ تخطي</button>' : ''}
    </div>
    <div class="author-line">السؤال ده من عند <b>${q.authorAvatar} ${esc(q.authorName)}</b> <span class="chip">${srcTag}</span></div>`;

  if (q.sub === 'answering' && q.isYours) {
    app.innerHTML = `${header('')}
      <div class="card owner-view">
        ${headHtml}
        <div class="big-emoji">😏</div>
        <h2 class="display">ده سؤالك انت!</h2>
        <div class="muted">اقعد اتفرج عليهم وهما بيتعذبوا 🍿</div>
        <div class="q-text mt">${esc(q.text)}</div>
        <div class="answered-strip" id="answered">${answeredAvatars(st)}</div>
        <div class="muted small">جاوبوا <b id="ans-count">${q.answeredIds.length}</b> من ${q.eligible}</div>
      </div>`;
    bindHeader(); bindSkip();
    return;
  }

  if (q.sub === 'answering') {
    app.innerHTML = `${header('')}
      <div class="card">
        ${headHtml}
        ${st.settings.qTime > 0 ? '<div class="timer" id="timer"><div class="fill" style="width:100%"></div></div>' : ''}
        <div class="q-text">${esc(q.text)}</div>
        <div class="choices">
          ${q.choices.map((c, i) => `
            <button class="choice ${CH_CLASS[i]} ${q.yourChoice === i ? 'picked' : ''}" data-c="${i}" ${S.answeredLocal ? 'disabled' : ''}>
              <span class="shape">${SHAPES[i]}</span><span>${esc(c)}</span>
            </button>`).join('')}
        </div>
        <div class="answered-strip" id="answered">${answeredAvatars(st)}</div>
        <div class="center muted small">جاوبوا <b id="ans-count">${q.answeredIds.length}</b> من ${q.eligible} ${S.answeredLocal ? '— إجابتك اتسجلت 🔒' : ''}</div>
      </div>`;
    bindHeader(); bindSkip();
    $$('.choice').forEach(btn => btn.onclick = async () => {
      if (S.answeredLocal) return;
      S.answeredLocal = true; Snd.play('pick');
      $$('.choice').forEach(b => { b.disabled = true; if (b === btn) b.classList.add('picked'); });
      const r = await act('answer', { choice: parseInt(btn.dataset.c, 10) });
      if (!r.ok && !/جاوبت/.test(r.error || '')) { S.answeredLocal = false; $$('.choice').forEach(b => { b.disabled = false; b.classList.remove('picked'); }); }
    });
    if (st.settings.qTime > 0 && q.deadline) startTimer(q);
    return;
  }

  /* الكشف */
  const mine = (q.picks || []).find(p => p.id === me.id);
  const gained = mine ? mine.gained : null;
  if (!q.isYours) Snd.play(mine && mine.choice === q.correct ? 'ok' : 'no');
  const byChoice = [[], [], []];
  (q.picks || []).forEach(p => byChoice[p.choice] && byChoice[p.choice].push(p));
  const board = st.players.slice().sort((a, b) => b.score - a.score);
  const myRank = board.findIndex(p => p.id === me.id) + 1;
  const isLast = q.i + 1 >= q.total;
  app.innerHTML = `${header('')}
    <div class="card">
      ${headHtml}
      <div class="q-text">${esc(q.text)}</div>
      <div class="choices">
        ${q.choices.map((c, i) => `
          <div class="choice ${CH_CLASS[i]} ${i === q.correct ? 'correct' : (mine && mine.choice === i ? 'wrong-pick' : 'dim')}" style="cursor:default">
            <span class="shape">${i === q.correct ? '✅' : SHAPES[i]}</span><span>${esc(c)}</span>
            <span class="voters">${byChoice[i].map(p => `<span title="${esc(p.name)}">${p.avatar}</span>`).join('')}</span>
          </div>`).join('')}
      </div>
      <div class="center mt" style="font-weight:900;font-size:18px">
        ${q.isYours ? 'سؤالك خلص! شوف مين وقع 😈'
          : gained ? `جبته صح! <span style="color:var(--brass-hi)">+${gained}</span> 🎉`
          : mine ? 'معلش.. جاتك غلط 😅' : 'مجاوبتش المرة دي 🙈'}
      </div>
      <div class="mini-board">
        ${board.slice(0, 3).map((p, i) => `<div class="mrow ${p.id === me.id ? 'me' : ''}"><span>${['🥇', '🥈', '🥉'][i]}</span><span>${p.avatar} ${esc(p.name)}</span><span class="sc">${p.score}</span></div>`).join('')}
        ${myRank > 3 ? `<div class="mrow me"><span>#${myRank}</span><span>${(st.players.find(p => p.id === me.id) || {}).avatar || ''} انت</span><span class="sc">${(st.players.find(p => p.id === me.id) || {}).score || 0}</span></div>` : ''}
      </div>
      ${me.isHost
        ? `<button class="btn primary big mt" id="next-btn">${isLast ? '🏁 شوف النتايج' : '⬅️ السؤال الجاي'}</button>`
        : `<div class="center muted mt">مستنيين <b>${esc((st.players.find(p => p.isHost) || {}).name || 'الهوست')}</b> 👑 يكمّل</div>`}
    </div>`;
  bindHeader();
  const nb = $('#next-btn');
  if (nb) nb.onclick = () => act('next');
}
function bindSkip() { const sb = $('#skip-btn'); if (sb) sb.onclick = () => { if (confirm('تخطي السؤال ده وكشف الإجابة؟')) act('skipQuestion'); }; }
function answeredAvatars(st) {
  const q = st.question;
  return q.answeredIds.map(id => { const p = st.players.find(x => x.id === id); return p ? `<span class="a" title="${esc(p.name)}">${p.avatar}</span>` : ''; }).join('');
}
function patchQuiz(st) {
  const q = st.question;
  const a = $('#answered'); if (a) a.innerHTML = answeredAvatars(st);
  const c = $('#ans-count'); if (c) c.textContent = q.answeredIds.length;
}
function startTimer(q) {
  const el = $('#timer'); if (!el) return;
  const fill = $('.fill', el);
  const total = q.deadline - q.startedAt;
  let lastTickSec = -1;
  const loop = () => {
    const remain = q.deadline - (Date.now() + S.skew);
    const pct = Math.max(0, Math.min(100, remain / total * 100));
    fill.style.width = pct + '%';
    el.classList.toggle('low', pct < 25);
    const sec = Math.ceil(remain / 1000);
    if (pct < 25 && sec !== lastTickSec && sec > 0 && !S.answeredLocal) { Snd.play('tick'); lastTickSec = sec; }
    if (remain > 0) timerRAF = requestAnimationFrame(loop);
  };
  timerRAF = requestAnimationFrame(loop);
}

/* ======================= النتايج ======================= */
function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#F2A31B', '#FF6D5A', '#2FC6B0', '#2F86EB', '#F4EDDF'];
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
function renderResults(st) {
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
  app.innerHTML = `${header('خلصت الجولة! 🎉')}
    <div class="bunting teal"></div>
    <div class="card center">
      <h2 class="display" style="font-size:30px">🏆 نتيجة السهرة</h2>
      <div class="podium">${pod(1)}${pod(0)}${pod(2)}</div>
    </div>
    <div class="card">
      <h3 class="mb">🎖️ الجوايز</h3>
      ${R.awards.map(a => `<div class="award"><span class="aic">${a.icon}</span><div><div class="at">${esc(a.title)}: ${esc(a.who)}</div><div class="ad">${esc(a.detail)}</div></div></div>`).join('')}
      ${R.hardest ? `<div class="award"><span class="aic">🧱</span><div><div class="at">أصعب سؤال (من عند ${esc(R.hardest.owner)})</div><div class="ad">«${esc(R.hardest.text)}» — ${esc(R.hardest.detail)}</div></div></div>` : ''}
    </div>
    <div class="card">
      <h3 class="mb">📊 الترتيب</h3>
      ${R.ranking.map(p => `<div class="rank-row ${p.id === me.id ? 'me' : ''}"><span class="pos">#${p.rank}</span><span>${p.avatar}</span><span>${esc(p.name)}${p.left ? ' <span class="muted small">🚪 خرج</span>' : ''}</span><span class="muted small">(${p.correct}/${p.eligible} صح)</span><span class="sc">${p.score}</span></div>`).join('')}
    </div>
    <div class="card">
      <h3 class="mb">🔍 مين شاطر في مين؟</h3>
      ${R.bestSource.map(b => `<div class="rank-row"><span>${b.avatar}</span><span>${esc(b.name)}:</span><span class="muted">${esc(b.text)}</span></div>`).join('')}
    </div>
    <div class="card">
      <h3 class="mb">📚 مراجعة كل الأسئلة — مين جاوب صح ومين غلط</h3>
      ${R.review.map((q, i) => {
        const okN = q.picks.filter(p => p.ok).length, badN = q.picks.length - okN;
        return `
        <details class="review">
          <summary><span>${q.cat.icon}</span><span>${i + 1}. ${esc(q.text.slice(0, 40))}${q.text.length > 40 ? '…' : ''}</span><span class="muted small" style="margin-inline-start:auto">${okN}✅ ${badN}❌</span></summary>
          <div class="rv-body">
            <div class="muted small mt">من عند ${q.ownerAvatar} ${esc(q.ownerName)} ${q.fromBank ? '🎲' : '✍️'}</div>
            ${q.choices.map((c, ci) => `
              <div class="rv-ch ${ci === q.correct ? 'ok' : ''}">
                <span>${ci === q.correct ? '✅' : SHAPES[ci]}</span><span>${esc(c)}</span>
                <span class="who">${q.picks.filter(p => p.choice === ci).map(p => `<span title="${esc(p.name)}">${p.avatar}</span>`).join('')}</span>
              </div>`).join('')}
          </div>
        </details>`;
      }).join('')}
    </div>
    ${me.isHost
      ? `<button class="btn primary big" id="again-btn">🔄 نلعب تاني (أسئلة جديدة)</button>`
      : `<div class="card tight center">عايزين جولة تانية؟ <b>${esc(hostP.name || '')}</b> 👑 يدوس</div>`}
    <button class="btn ghost big mt" id="leave-btn">🏠 نهاية السهرة (خروج)</button>`;
  bindHeader();
  const ab = $('#again-btn');
  if (ab) ab.onclick = () => { LS.del('tahadi_slots_' + st.code); S.slots = []; S.slotsSig = ''; act('playAgain'); };
  $('#leave-btn').onclick = async () => { if (confirm('تخرج من الروم؟')) { await act('leave'); leaveLocal(); } };
}

/* ======================= البداية ======================= */
(async function boot() {
  document.body.addEventListener('pointerdown', () => Snd.ensure(), { once: true });
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (S.save && S.save.code && S.save.token) {
    const r = await api('/api/tahadi/join', { code: S.save.code, token: S.save.token });
    if (r.ok) { openStream(); return; }
    LS.del('tahadi_save'); S.save = null;
    if (r.gone) toast('الروم القديم خلص', 'err');
  }
  renderHome(urlRoom || '');
})();

/* ======================= هيلب اللعبة + زرار اللمّة ======================= */
const TAHADI_HELP = `
<div style="text-align:start">
  <div class="center"><img src="/img/asal.webp" alt="" style="width:100px;height:auto;filter:drop-shadow(0 6px 14px #0009)"></div>
  <h2 class="display" style="color:var(--brass-hi);text-align:center;margin:6px 0 2px">اسأل واستفيد</h2>
  <div class="center muted small" style="margin-bottom:14px">كل جولة بتطلع منها بمعلومات جديدة 💡</div>
  <p style="margin:0 0 10px"><b>1️⃣ الروم:</b> واحد يعمل روم والباقي يدخلوا بالكود أو الـQR (من 2 لـ 12).</p>
  <p style="margin:0 0 10px"><b>2️⃣ الهوست بيظبط بس:</b> كام سؤال في كل كاتيجوري × أنهي كاتيجوريز (مثلاً 2×5 = 10 لكل لاعب) ووقت السؤال.</p>
  <p style="margin:0 0 10px"><b>3️⃣ كل واحد يجهّز أسئلته:</b> يكتب سؤال معلومات + 3 اختيارات ويعلّم الصح — <b style="color:var(--coral)">والتزم بنفس الكاتيجوري اللي انت فيها</b> — أو 🎲 يسحب من بنك الـ1000 سؤال <b>بإجابته</b>.</p>
  <p style="margin:0 0 10px"><b>🎲 مش عاجبك السؤال؟</b> بدّله لحد <b>3 محاولات للخانة</b>. وأي سؤال يظهر لأي حد بيتحذف من بنك الروم نهائي — مفيش تكرار.</p>
  <p style="margin:0 0 10px"><b>4️⃣ اللعب:</b> السؤال بيظهر للكل ما عدا صاحبه. صح = 100 نقطة + لحد 50 بونص سرعة.</p>
  <p style="margin:0 0 10px"><b>⏱️ حد اتأخر؟</b> الهوست يقدر يبدأ — واللي المتأخر خلّصه بيتحسب والباقي بيتكمّل من البنك تلقائي.</p>
  <p style="margin:0"><b>5️⃣ النهاية:</b> بوديوم وجوايز 🏆🎯⚡🃏 ومراجعة كل سؤال: مين جاوب صح ✅ ومين غلط ❌.</p>
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
    ${TAHADI_HELP}
    <label class="row mt muted small" style="gap:8px;cursor:pointer"><input type="checkbox" id="help-off" style="width:18px;height:18px"> متظهرش تاني</label>
    <button class="btn primary big mt" id="help-ok">تمام، يلا نلعب 🚀</button>
    <button class="btn ghost big mt" id="help-skip">تخطي</button>
  </div>`;
  const close = () => { if ($('#help-off') && $('#help-off').checked) LS.set('lamma_help_off_tahadi', true); ov.remove(); };
  $('#help-ok').onclick = close;
  $('#help-skip').onclick = close;
}
setTimeout(() => { if (!S.save && !LS.get('lamma_help_off_tahadi', false)) showHelp(); }, 350);
