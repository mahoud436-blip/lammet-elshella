/* تحدي الشلة — محرك اللعبة (موديول) */
'use strict';
const crypto = require('crypto');
const BANK = require('./bank');

const HOST_GRACE_MS = parseInt(process.env.HOST_GRACE_MS || '45000', 10);
const ROOM_TTL_MS = parseInt(process.env.ROOM_TTL_MS || String(90 * 60 * 1000), 10);
const MAX_ROOMS = 300;
const MAX_PLAYERS = 12;
const MAX_Q_PER_PLAYER = 20;
const REVEAL_GRACE = 250;
const AVATARS = ['🦅','🛡️','⚔️','🏆','🎯','🧠','⚡','🔥','👑','🚀','💎','🏹','♟️','🎓','⚙️','🔭','📚','🧭','🥇','🗺️','🏛️','⭐','🌋','🔱'];

let NET = { ips: [], port: 3000, hosted: false };

const now = () => Date.now();
const rid = () => crypto.randomBytes(16).toString('hex');
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function clampStr(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max); }

const rooms = new Map();
let playerSeq = 0;

function qTotal(room) { return room.settings.qPerCat * room.settings.cats.length; }
function makeCode() { for (let i = 0; i < 50; i++) { const c = String(1000 + Math.floor(Math.random() * 9000)); if (!rooms.has(c)) return c; } return null; }

function createRoom() {
  const code = makeCode();
  if (!code) return null;
  const room = {
    code, createdAt: now(), lastActivity: now(),
    phase: 'lobby',
    settings: { qPerCat: 1, qTime: 20, level: 'easy', cats: ['movies', 'anime', 'hist_islam', 'geo_ar', 'mix'] },
    hostToken: null, players: new Map(), order: [], ghosts: new Map(),
    bankConsumed: new Set(),
    deck: null, qIndex: 0, sub: null,
    qTimer: null, autoStartAt: null, autoStartTimer: null, hostGraceTimer: null,
    results: null,
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, name, avatar) {
  const token = rid();
  const p = { token, id: 'p' + (++playerSeq), name, avatar, connected: false, lastSeen: now(), res: null,
    score: 0, ready: false, slots: null, draws: 0, drawn: new Map(), draftSlots: null, left: false, away: false };
  room.players.set(token, p);
  room.order.push(token);
  if (!room.hostToken) room.hostToken = token;
  return p;
}

function connectedPlayers(room) { return room.order.map(t => room.players.get(t)).filter(p => p && p.connected); }
function allPlayers(room) { return room.order.map(t => room.players.get(t)).filter(Boolean); }
function isHost(room, p) { return room.hostToken === p.token; }
function nameOf(room, token) {
  const p = room.players.get(token); if (p) return { name: p.name, avatar: p.avatar, id: p.id };
  const g = room.ghosts.get(token); if (g) return { name: g.name + ' (خرج)', avatar: g.avatar, id: 'ghost' };
  return { name: 'لاعب سابق', avatar: '👻', id: 'ghost' };
}
function buildPlan(settings) { return settings.cats.map(catId => ({ cat: catId, count: settings.qPerCat })); }

function sseSend(res, obj) { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} }

function viewFor(room, p) {
  const st = {
    t: 'state', serverNow: now(), code: room.code, phase: room.phase,
    settings: room.settings, qTotal: qTotal(room),
    plan: buildPlan(room.settings).map(x => ({ ...BANK.catMeta(x.cat), count: x.count })),
    net: NET, autoStartAt: room.autoStartAt,
    players: allPlayers(room).map(x => ({ id: x.id, name: x.name, avatar: x.avatar, isHost: isHost(room, x),
      connected: x.connected, left: !!x.left, away: !!x.away, score: x.score, ready: x.ready, qDone: x.slots ? x.slots.length : 0 })),
    you: { id: p.id, isHost: isHost(room, p), ready: p.ready, score: p.score },
    levels: BANK.LEVELS,
  };
  if (room.phase === 'writing') {
    st.bankLeft = {};
    for (const c of room.settings.cats) { let free = 0; for (const id of BANK.catIds(c, room.settings.level)) if (!room.bankConsumed.has(id)) free++; st.bankLeft[c] = free; }
    st.drawsLeft = Math.max(0, qTotal(room) * 3 - p.draws);
    st.yourSlots = p.slots;
    st.yourDrawn = [...p.drawn.values()];
  }
  if (room.phase === 'quiz' && room.deck) {
    const q = room.deck[room.qIndex];
    const author = nameOf(room, q.owner);
    const base = {
      i: room.qIndex, total: room.deck.length, sub: room.sub,
      cat: BANK.catMeta(q.cat), fromBank: q.fromBank,
      authorId: author.id, authorName: author.name, authorAvatar: author.avatar,
      text: q.text, choices: q.choices,
      qTime: room.settings.qTime, startedAt: q.startedAt, deadline: q.deadline || null,
      isYours: q.owner === p.token,
      answeredIds: [...q.picks.keys()].map(t => (room.players.get(t) || {}).id).filter(Boolean),
      eligible: allPlayers(room).filter(x => x.token !== q.owner).length,
      yourChoice: q.picks.has(p.token) ? q.picks.get(p.token).c : null,
    };
    if (room.sub === 'reveal') {
      base.correct = q.correct;
      base.picks = [...q.picks.entries()].map(([tok, pk]) => { const who = nameOf(room, tok);
        return { id: who.id, name: who.name, avatar: who.avatar, choice: pk.c, ms: pk.ms, gained: q.gains.get(tok) || 0 }; });
    }
    st.question = base;
  }
  if (room.phase === 'results') st.results = room.results;
  return st;
}
function broadcast(room) { room.lastActivity = now(); for (const p of allPlayers(room)) if (p.res) sseSend(p.res, viewFor(room, p)); }

function cancelAutoStart(room) { room.autoStartAt = null; if (room.autoStartTimer) { clearTimeout(room.autoStartTimer); room.autoStartTimer = null; } }
function totalSubmitted(room) { let n = 0; for (const p of allPlayers(room)) if (p.ready && p.slots) n += p.slots.length; return n; }
function checkAutoStart(room) {
  if (room.phase !== 'writing') return;
  const conn = connectedPlayers(room);
  const ready = conn.filter(p => p.ready);
  if (conn.length >= 2 && ready.length === conn.length && totalSubmitted(room) >= 2) {
    if (!room.autoStartAt) {
      room.autoStartAt = now() + 3000;
      room.autoStartTimer = setTimeout(() => { room.autoStartTimer = null; startQuiz(room); }, 3100);
      broadcast(room);
    }
  } else cancelAutoStart(room);
}
function startWriting(room) {
  room.phase = 'writing';
  for (const p of allPlayers(room)) { p.ready = false; p.slots = null; p.draws = 0; p.drawn = new Map(); p.draftSlots = null; }
  cancelAutoStart(room);
  broadcast(room);
}
function startQuiz(room) {
  if (room.phase !== 'writing') return;
  cancelAutoStart(room);
  const contributors = allPlayers(room).filter(p => p.ready && p.slots && p.slots.length);
  const items = [];
  for (const p of shuffle(contributors)) for (const s of shuffle(p.slots)) items.push({ owner: p.token, ...s });
  if (items.length < 2) return;
  const byOwner = new Map();
  for (const it of items) { if (!byOwner.has(it.owner)) byOwner.set(it.owner, []); byOwner.get(it.owner).push(it); }
  const deck = [];
  let remaining = items.length;
  const ownerKeys = shuffle([...byOwner.keys()]);
  while (remaining > 0) for (const o of ownerKeys) { const list = byOwner.get(o); if (list && list.length) { deck.push(list.shift()); remaining--; } }
  room.deck = deck.map((it, idx) => {
    const order = shuffle([0, 1, 2]);
    return { id: idx, owner: it.owner, cat: it.cat, fromBank: it.source === 'bank', bankId: it.bankId || null,
      text: it.q, choices: order.map(i => it.choices[i]), correct: order.indexOf(it.a),
      picks: new Map(), gains: new Map(), startedAt: null, deadline: null };
  });
  room.qIndex = 0;
  room.phase = 'quiz';
  startQuestion(room);
}
function startQuestion(room) {
  const q = room.deck[room.qIndex];
  room.sub = 'answering';
  q.startedAt = now();
  if (room.qTimer) { clearTimeout(room.qTimer); room.qTimer = null; }
  if (room.settings.qTime > 0) {
    q.deadline = q.startedAt + room.settings.qTime * 1000;
    room.qTimer = setTimeout(() => reveal(room), room.settings.qTime * 1000 + REVEAL_GRACE);
  } else q.deadline = null;
  broadcast(room);
  maybeComplete(room);
}
function maybeComplete(room) {
  if (room.phase !== 'quiz' || room.sub !== 'answering') return;
  const q = room.deck[room.qIndex];
  const eligibleConn = connectedPlayers(room).filter(p => p.token !== q.owner);
  if (eligibleConn.length === 0 || eligibleConn.every(p => q.picks.has(p.token))) reveal(room);
}
function reveal(room) {
  if (room.phase !== 'quiz' || room.sub !== 'answering') return;
  if (room.qTimer) { clearTimeout(room.qTimer); room.qTimer = null; }
  const q = room.deck[room.qIndex];
  const T = room.settings.qTime * 1000;
  for (const [tok, pk] of q.picks) {
    let pts = 0;
    if (pk.c === q.correct) {
      pts = 100;
      if (T > 0) pts += Math.round(50 * Math.max(0, (T - pk.ms)) / T);
      const p = room.players.get(tok);
      if (p) p.score += pts;
    }
    q.gains.set(tok, pts);
  }
  room.sub = 'reveal';
  broadcast(room);
}
function nextQuestion(room) {
  if (room.phase !== 'quiz' || room.sub !== 'reveal') return;
  room.qIndex++;
  if (room.qIndex >= room.deck.length) finish(room);
  else startQuestion(room);
}
function finish(room) {
  room.phase = 'results';
  room.sub = null;
  const players = allPlayers(room);
  const stats = new Map();
  for (const p of players) stats.set(p.token, { correct: 0, answered: 0, eligible: 0, msSum: 0, msCount: 0, byAuthor: new Map() });
  const authorStats = new Map();
  for (const q of room.deck) {
    if (!authorStats.has(q.owner)) authorStats.set(q.owner, { qCount: 0, picks: 0, correctPicks: 0 });
    const as = authorStats.get(q.owner); as.qCount++;
    for (const p of players) if (p.token !== q.owner) { const s = stats.get(p.token); if (s) s.eligible++; }
    for (const [tok, pk] of q.picks) {
      const s = stats.get(tok); if (!s) continue;
      s.answered++; as.picks++;
      if (pk.c === q.correct) { s.correct++; s.msSum += pk.ms; s.msCount++; as.correctPicks++;
        s.byAuthor.set(q.owner, (s.byAuthor.get(q.owner) || 0) + 1); }
    }
  }
  const ranking = players.slice().sort((a, b) => b.score - a.score).map((p, i) => {
    const s = stats.get(p.token);
    return { rank: i + 1, id: p.id, name: p.name, avatar: p.avatar, score: p.score, correct: s.correct, eligible: s.eligible, connected: p.connected, left: !!p.left };
  });
  const awards = [];
  if (ranking.length) awards.push({ icon: '🏆', title: 'بطل الشلة', who: ranking[0].name, detail: ranking[0].score + ' نقطة' });
  let sniper = null;
  for (const p of players) { const s = stats.get(p.token); if (s.eligible >= 2) { const acc = s.correct / s.eligible; if (!sniper || acc > sniper.acc) sniper = { p, acc, s }; } }
  if (sniper && sniper.s.correct > 0) awards.push({ icon: '🎯', title: 'القنّاص', who: sniper.p.name, detail: `جاوب صح ${sniper.s.correct} من ${sniper.s.eligible}` });
  let rocket = null;
  for (const p of players) { const s = stats.get(p.token); if (s.msCount >= 2) { const avg = s.msSum / s.msCount; if (!rocket || avg < rocket.avg) rocket = { p, avg }; } }
  if (rocket && room.settings.qTime > 0) awards.push({ icon: '⚡', title: 'الصاروخ', who: rocket.p.name, detail: 'متوسط إجابته الصح ' + (rocket.avg / 1000).toFixed(1) + ' ثانية' });
  let trickster = null;
  for (const [tok, as] of authorStats) if (as.picks >= 2) { const rate = as.correctPicks / as.picks; if (!trickster || rate < trickster.rate) trickster = { tok, rate, as }; }
  if (trickster) { const who = nameOf(room, trickster.tok); awards.push({ icon: '🃏', title: 'المُحيِّر', who: who.name, detail: `أسئلته اتجاوبت صح ${trickster.as.correctPicks} من ${trickster.as.picks} بس` }); }
  const bestSource = players.map(p => {
    const s = stats.get(p.token);
    let best = null;
    for (const [authTok, cnt] of s.byAuthor) if (!best || cnt > best.cnt) best = { authTok, cnt };
    if (!best) return { id: p.id, name: p.name, avatar: p.avatar, text: 'ولا إجابة صح 😅' };
    const total = room.deck.filter(q => q.owner === best.authTok).length;
    const who = nameOf(room, best.authTok);
    return { id: p.id, name: p.name, avatar: p.avatar, text: `أشطر في أسئلة ${who.name} (${best.cnt}/${total})` };
  });
  let hardest = null;
  for (const q of room.deck) {
    if (!q.picks.size) continue;
    let c = 0; for (const [, pk] of q.picks) if (pk.c === q.correct) c++;
    const rate = c / q.picks.size;
    if (!hardest || rate < hardest.rate) hardest = { q, rate, c, n: q.picks.size };
  }
  const review = room.deck.map(q => {
    const owner = nameOf(room, q.owner);
    return { cat: BANK.catMeta(q.cat), fromBank: q.fromBank, ownerName: owner.name, ownerAvatar: owner.avatar,
      text: q.text, choices: q.choices, correct: q.correct,
      picks: [...q.picks.entries()].map(([tok, pk]) => { const w = nameOf(room, tok); return { name: w.name, avatar: w.avatar, choice: pk.c, ok: pk.c === q.correct }; }) };
  });
  room.results = { ranking, awards, bestSource, review,
    hardest: hardest ? { text: hardest.q.text, owner: nameOf(room, hardest.q.owner).name, detail: `${hardest.c} بس من ${hardest.n} جاوبوه صح` } : null };
  broadcast(room);
}
function playAgain(room) {
  for (const tok of [...room.order]) {
    const p = room.players.get(tok);
    if (!p || !p.connected) { if (p) room.ghosts.set(tok, { name: p.name, avatar: p.avatar }); room.players.delete(tok); room.order = room.order.filter(t => t !== tok); }
  }
  if (!room.players.has(room.hostToken)) room.hostToken = room.order[0] || null;
  for (const p of allPlayers(room)) { p.score = 0; p.ready = false; p.slots = null; p.draws = 0; p.drawn = new Map(); p.draftSlots = null; }
  room.deck = null; room.qIndex = 0; room.sub = null; room.results = null;
  if (room.qTimer) { clearTimeout(room.qTimer); room.qTimer = null; }
  cancelAutoStart(room);
  room.phase = 'lobby';
  broadcast(room);
}
function softLeave(room, p) {
  p.left = true;
  if (p.res) { try { sseSend(p.res, { t: 'left' }); p.res.end(); } catch (e) {} }
  p.res = null; p.connected = false;
  if (room.hostToken === p.token) { migrateHost(room); }
  maybeComplete(room);
  if (room.phase === 'writing') checkAutoStart(room);
  broadcast(room);
}

function removePlayer(room, p, kicked) {
  room.ghosts.set(p.token, { name: p.name, avatar: p.avatar });
  if (p.res) { try { sseSend(p.res, { t: kicked ? 'kicked' : 'left' }); p.res.end(); } catch (e) {} }
  room.players.delete(p.token);
  room.order = room.order.filter(t => t !== p.token);
  if (room.phase === 'quiz' && room.deck) {
    const cur = room.deck[room.qIndex];
    room.deck = room.deck.filter((q, i) => i <= room.qIndex || q.owner !== p.token);
    if (cur.owner === p.token && room.sub === 'answering') reveal(room);
    else maybeComplete(room);
  }
  if (room.hostToken === p.token) migrateHost(room);
  if (!room.players.size) { destroyRoom(room); return; }
  if (room.phase === 'writing') checkAutoStart(room);
  broadcast(room);
}
function migrateHost(room) { const conn = connectedPlayers(room); room.hostToken = (conn[0] || allPlayers(room)[0] || {}).token || null; }
function destroyRoom(room) {
  if (room.qTimer) clearTimeout(room.qTimer);
  cancelAutoStart(room);
  if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
  rooms.delete(room.code);
}
function autoCompleteSlots(room, p) {
  const plan = buildPlan(room.settings);
  const out = [];
  const usedB = new Set();
  const drafts = Array.isArray(p.draftSlots) ? p.draftSlots : [];
  for (const { cat, count } of plan) {
    const have = [];
    for (const d of drafts) {
      if (have.length >= count) break;
      if (!d || d.cat !== cat) continue;
      if (d.source === 'bank') {
        const bid = String(d.bankId || '');
        const item = p.drawn.get(bid);
        if (item && item.cat === cat && !usedB.has(bid)) { usedB.add(bid); have.push({ cat, source: 'bank', bankId: bid, q: item.q, choices: item.choices.slice(), a: item.a }); }
      } else if (d.source === 'self') {
        const q = clampStr(d.q, 200);
        const ch = Array.isArray(d.choices) ? d.choices.map(c => clampStr(c, 90)) : [];
        if (q && ch.length === 3 && ch.every(c => c) && new Set(ch.map(c => c.toLowerCase())).size === 3 && Number.isInteger(d.a) && d.a >= 0 && d.a <= 2)
          have.push({ cat, source: 'self', q, choices: ch, a: d.a });
      }
    }
    while (have.length < count) {
      const pool = BANK.catIds(cat, room.settings.level).filter(id => !room.bankConsumed.has(id));
      if (!pool.length) break;
      const bid = pool[Math.floor(Math.random() * pool.length)];
      const bq = BANK.get(bid);
      room.bankConsumed.add(bid);
      have.push({ cat, source: 'bank', bankId: bid, q: bq.q, choices: bq.choices.slice(), a: bq.a });
    }
    out.push(...have.slice(0, count));
  }
  return out;
}

function validateSlots(room, p, slots) {
  if (!Array.isArray(slots)) return { err: 'صيغة غلط' };
  const plan = buildPlan(room.settings);
  const need = new Map(plan.map(x => [x.cat, x.count]));
  const got = new Map();
  const out = [];
  const usedBankIds = new Set();
  const seenTexts = new Set();
  if (slots.length !== qTotal(room)) return { err: 'لازم تكمّل كل الأسئلة المطلوبة' };
  for (const s of slots) {
    const cat = s && s.cat;
    if (!need.has(cat)) return { err: 'كاتيجوري مش من المختارين' };
    got.set(cat, (got.get(cat) || 0) + 1);
    if (s.source === 'bank') {
      const bid = String(s.bankId || '');
      const item = p.drawn.get(bid);
      if (!item || item.cat !== cat) return { err: 'ده مش سؤال طلعلك من البنك' };
      if (usedBankIds.has(bid)) return { err: 'سؤال بنك متكرر' };
      usedBankIds.add(bid);
      out.push({ cat, source: 'bank', bankId: bid, q: item.q, choices: item.choices.slice(), a: item.a });
    } else if (s.source === 'self') {
      const q = clampStr(s.q, 200);
      const choices = Array.isArray(s.choices) ? s.choices.map(c => clampStr(c, 90)) : [];
      const a = s.a;
      if (!q) return { err: 'في سؤال فاضي' };
      if (choices.length !== 3 || choices.some(c => !c)) return { err: 'كل سؤال لازم 3 اختيارات متكتبين' };
      if (new Set(choices.map(c => c.toLowerCase())).size !== 3) return { err: 'في اختيارات مكررة في نفس السؤال' };
      if (!(Number.isInteger(a) && a >= 0 && a <= 2)) return { err: 'علّم الإجابة الصح في كل سؤال' };
      const key = q.toLowerCase();
      if (seenTexts.has(key)) return { err: 'في سؤال مكرر عندك' };
      seenTexts.add(key);
      out.push({ cat, source: 'self', q, choices, a });
    } else return { err: 'نوع سؤال غير معروف' };
  }
  for (const [cat, cnt] of need) if ((got.get(cat) || 0) !== cnt) return { err: 'وزّع الأسئلة على الكاتيجوريز زي الخطة' };
  return { slots: out };
}

/* =============== الواجهة العامة للموديول =============== */
function R(status, body) { return { status, body }; }
function findRoomPlayer(body) {
  const room = rooms.get(String(body.code || ''));
  if (!room) return { err: 'الروم ده مش موجود 🤔' };
  const p = room.players.get(String(body.token || ''));
  if (!p) return { err: 'انت مش في الروم ده' };
  return { room, p };
}

module.exports = {
  id: 'tahadi',
  setNet(net) { NET = net; },

  create(b) {
    const name = clampStr(b.name, 16);
    if (!name) return R(400, { ok: false, error: 'اكتب اسمك الأول' });
    if (rooms.size >= MAX_ROOMS) return R(503, { ok: false, error: 'السيرفر زحمة دلوقتي، جرب كمان شوية' });
    const room = createRoom();
    if (!room) return R(503, { ok: false, error: 'مفيش أكواد متاحة' });
    const avatar = AVATARS.includes(b.avatar) ? b.avatar : AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const p = addPlayer(room, name, avatar);
    return R(200, { ok: true, code: room.code, token: p.token, id: p.id });
  },

  join(b) {
    const room = rooms.get(clampStr(b.code, 8));
    if (!room) return R(404, { ok: false, error: 'الروم ده مش موجود 🤔', gone: true });
    if (b.token && room.players.has(String(b.token))) {
      const p = room.players.get(String(b.token));
      return R(200, { ok: true, code: room.code, token: p.token, id: p.id, resumed: true });
    }
    if (room.phase !== 'lobby') return R(403, { ok: false, error: 'اللعبة بدأت خلاص 🙈 استنى الجولة الجاية' });
    if (room.players.size >= MAX_PLAYERS) return R(403, { ok: false, error: 'الروم مليان (' + MAX_PLAYERS + ' لاعيبة)' });
    const name = clampStr(b.name, 16);
    if (!name) return R(400, { ok: false, error: 'اكتب اسمك الأول' });
    for (const x of allPlayers(room)) if (x.name.toLowerCase() === name.toLowerCase()) return R(409, { ok: false, error: 'الاسم ده متاخد في الروم، اختار غيره' });
    let avatar = AVATARS.includes(b.avatar) ? b.avatar : null;
    const usedAv = new Set(allPlayers(room).map(x => x.avatar));
    if (!avatar || usedAv.has(avatar)) avatar = AVATARS.find(a => !usedAv.has(a)) || AVATARS[0];
    const p = addPlayer(room, name, avatar);
    broadcast(room);
    return R(200, { ok: true, code: room.code, token: p.token, id: p.id });
  },

  stream(req, res, code, token) {
    const room = rooms.get(code || '');
    const p = room && room.players.get(token || '');
    if (!room || !p) { res.writeHead(404); res.end(); return true; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    if (p.res && p.res !== res) { try { p.res.end(); } catch (e) {} }
    p.res = res; p.connected = true; p.lastSeen = now(); p.left = false; p.away = false;
    if (room.hostGraceTimer && room.hostToken === p.token) { clearTimeout(room.hostGraceTimer); room.hostGraceTimer = null; }
    broadcast(room);
    req.on('close', () => {
      if (p.res === res) { p.res = null; p.connected = false; p.lastSeen = now(); }
      if (!rooms.has(room.code)) return;
      if (room.hostToken === p.token && !room.hostGraceTimer) {
        room.hostGraceTimer = setTimeout(() => {
          room.hostGraceTimer = null;
          const hp = room.players.get(room.hostToken);
          if (hp && !hp.connected) { migrateHost(room); broadcast(room); }
        }, HOST_GRACE_MS);
      }
      maybeComplete(room);
      if (room.phase === 'writing') checkAutoStart(room);
      broadcast(room);
    });
    return true;
  },

  action(b) {
    const f = findRoomPlayer(b);
    if (f.err) return R(400, { ok: false, error: f.err });
    const { room, p } = f;
    const A = String(b.action || '');
    room.lastActivity = now();

    if (A === 'setSettings') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس اللي يغيّر الإعدادات' });
      if (room.phase !== 'lobby') return R(400, { ok: false, error: 'الإعدادات بتتغير في اللوبي بس' });
      const s = b.settings || {};
      const qpc = parseInt(s.qPerCat, 10);
      if (Number.isInteger(qpc) && qpc >= 1 && qpc <= 10) room.settings.qPerCat = qpc;
      if (typeof s.level === 'string' && BANK.isLevel(s.level)) room.settings.level = s.level;
      const qt = parseInt(s.qTime, 10);
      if (Number.isInteger(qt) && (qt === 0 || (qt >= 5 && qt <= 120))) room.settings.qTime = qt;
      if (Array.isArray(s.cats)) {
        const valid = [...new Set(s.cats.filter(c => BANK.catMeta(c)))];
        if (valid.length >= 1 && valid.length <= 10) room.settings.cats = valid;
      }
      broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'startWriting') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس اللي يبدأ' });
      if (room.phase !== 'lobby') return R(400, { ok: false, error: 'مش في اللوبي' });
      if (connectedPlayers(room).length < 2) return R(400, { ok: false, error: 'محتاجين لاعبين على الأقل' });
      if (room.settings.cats.length < 1) return R(400, { ok: false, error: 'اختار كاتيجوري واحدة على الأقل' });
      if (qTotal(room) > MAX_Q_PER_PLAYER) return R(400, { ok: false, error: `كتير أوي! أقصى حاجة ${MAX_Q_PER_PLAYER} سؤال للاعب — قلل العدد أو الكاتيجوريز` });
      startWriting(room);
      return R(200, { ok: true });
    }
    if (A === 'bankDraw') {
      if (room.phase !== 'writing') return R(400, { ok: false, error: 'مش وقت السحب' });
      const catId = String(b.cat || '');
      if (!room.settings.cats.includes(catId)) return R(400, { ok: false, error: 'كاتيجوري غلط' });
      if (p.draws >= qTotal(room) * 3) return R(400, { ok: false, error: 'خلّصت كل محاولات السحب — اكتب الباقي بنفسك ✍️' });
      const pool = BANK.catIds(catId, room.settings.level).filter(id => !room.bankConsumed.has(id));
      if (!pool.length) return R(200, { ok: false, empty: true, error: 'البنك خلص في الكاتيجوري دي! اكتب بنفسك 😉' });
      const bankId = pool[Math.floor(Math.random() * pool.length)];
      const bq = BANK.get(bankId);
      room.bankConsumed.add(bankId);
      p.draws++;
      const item = { bankId, cat: bq.cat, q: bq.q, choices: bq.choices.slice(), a: bq.a };
      p.drawn.set(bankId, item);
      broadcast(room);
      return R(200, { ok: true, item });
    }
    if (A === 'submitQuestions') {
      if (room.phase !== 'writing') return R(400, { ok: false, error: 'مش وقت التسليم' });
      const v = validateSlots(room, p, b.slots);
      if (v.err) return R(400, { ok: false, error: v.err });
      p.slots = v.slots; p.ready = true;
      checkAutoStart(room);
      broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'editQuestions') {
      if (room.phase !== 'writing') return R(400, { ok: false, error: 'مش وقت التعديل' });
      p.ready = false;
      cancelAutoStart(room);
      broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'syncDraft') {
      if (room.phase === 'writing' && !p.ready) p.draftSlots = Array.isArray(b.slots) ? b.slots.slice(0, 40) : null;
      return R(200, { ok: true });
    }
    if (A === 'forceStartQuiz') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس' });
      if (room.phase !== 'writing') return R(400, { ok: false, error: 'مش في مرحلة الكتابة' });
      // اللي متأخر: نكمّله — اللي خلصه عنده يتحسب والباقي عشوائي من البنك
      for (const x of allPlayers(room)) {
        if (x.ready) continue;
        const slots = autoCompleteSlots(room, x);
        if (slots.length) { x.slots = slots; x.ready = true; }
      }
      if (totalSubmitted(room) < 2) return R(400, { ok: false, error: 'محتاجين على الأقل سؤالين جاهزين' });
      startQuiz(room);
      return R(200, { ok: true });
    }
    if (A === 'answer') {
      if (room.phase !== 'quiz' || room.sub !== 'answering') return R(400, { ok: false, error: 'مش وقت الإجابة' });
      const q = room.deck[room.qIndex];
      if (q.owner === p.token) return R(400, { ok: false, error: 'ده سؤالك انت! 😏' });
      const c = parseInt(b.choice, 10);
      if (!(Number.isInteger(c) && c >= 0 && c <= 2)) return R(400, { ok: false, error: 'اختيار غلط' });
      if (q.deadline && now() > q.deadline + REVEAL_GRACE) return R(400, { ok: false, error: 'الوقت خلص!' });
      // تقدر تعدّل إجابتك طول ما السؤال لسه مفتوح — بس البونص بيتحسب من وقت آخر تعديل
      q.picks.set(p.token, { c, ms: now() - q.startedAt });
      maybeComplete(room);
      if (room.sub === 'answering') broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'skipQuestion') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس' });
      if (room.phase === 'quiz' && room.sub === 'answering') reveal(room);
      return R(200, { ok: true });
    }
    if (A === 'next') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس' });
      nextQuestion(room);
      return R(200, { ok: true });
    }
    if (A === 'kick') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس' });
      const target = allPlayers(room).find(x => x.id === String(b.playerId || ''));
      if (!target || target.token === p.token) return R(400, { ok: false, error: 'مينفعش' });
      removePlayer(room, target, true);
      return R(200, { ok: true });
    }
    if (A === 'playAgain') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس' });
      if (room.phase !== 'results') return R(400, { ok: false, error: 'الجولة لسه مخلصتش' });
      playAgain(room);
      return R(200, { ok: true });
    }
    if (A === 'leave') {
      if (room.phase === 'lobby') removePlayer(room, p, false);
      else softLeave(room, p);
      return R(200, { ok: true });
    }
    if (A === 'presence') {
      const away = !!b.away;
      if (p.away !== away) { p.away = away; broadcast(room); }
      return R(200, { ok: true });
    }
    return R(400, { ok: false, error: 'أكشن غير معروف' });
  },

  tick() {
    for (const [, room] of rooms) {
      for (const p of allPlayers(room)) if (p.res) { try { p.res.write('event: ping\ndata: 1\n\n'); } catch (e) {} }
      if (connectedPlayers(room).length === 0 && now() - room.lastActivity > ROOM_TTL_MS) destroyRoom(room);
    }
  },
};
