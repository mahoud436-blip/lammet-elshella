/* المحقق والمتهم — محرك اللعبة
   لاعب واحد (المتّهم) معاه كلمة سرية، والباقي (المحققين) بيسألوه أسئلة نعم/لا بالدور.
   بعد كل جولة كل محقق يختار: يسلّم إجابته (متخفية عن الكل) ولا يكمّل.
   اللي يسلّم صح بعد الجولة 1 = 100، الجولة 2 = 90 ... الجولة 10 = 10.
   المتّهم مبياخدش نقط — وبيتخصم منه 10 لكل سؤال ميردش عليه في الوقت. */
'use strict';
const crypto = require('crypto');
const BANK = require('./bank');

const HOST_GRACE_MS = parseInt(process.env.HOST_GRACE_MS || '45000', 10);
const ROOM_TTL_MS = parseInt(process.env.ROOM_TTL_MS || String(90 * 60 * 1000), 10);
const MAX_ROOMS = 300;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const MAX_Q_CHARS = 90;
const NO_ANSWER_PENALTY = 10;
const AVATARS = ['🕵️','🔎','🧠','🎩','📎','🗂️','🧩','💡','📌','🔦','🗝️','⚖️','📖','🖇️','🧭','🪞','🎯','📝','🔬','🧵','♟️','🫖','🪄','📮'];

let NET = { ips: [], port: 3000, hosted: false };
const now = () => Date.now();
const rid = () => crypto.randomBytes(16).toString('hex');
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function clampStr(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max); }
const tierPoints = n => Math.max(10, 110 - 10 * n);   // جولة 1 = 100 ... جولة 10 = 10

const rooms = new Map();
let playerSeq = 0;
function makeCode() { for (let i = 0; i < 50; i++) { const c = String(1000 + Math.floor(Math.random() * 9000)); if (!rooms.has(c)) return c; } return null; }

function createRoom() {
  const code = makeCode();
  if (!code) return null;
  const room = {
    code, createdAt: now(), lastActivity: now(),
    phase: 'lobby',   // lobby | pick | play | reveal | gameover
    sub: 'ask',       // ask | answer | decide
    settings: { cats: ['living', 'food', 'things', 'places'], rounds: 6, casesPerPlayer: 1, askOrder: 'turns', accusedOrder: 'turns',
                allowCustomWord: false, maxPass: 2, qTime: 0, aTime: 0 },
    hostToken: null, players: new Map(), order: [], ghosts: new Map(),
    usedItems: new Set(), plan: [], caseIdx: 0,
    accused: null, item: null, pickMode: null, passesUsed: 0,
    round: 0, askOrder: [], askIdx: 0,
    curQ: null,          // {token, text, at, answer}
    history: [],         // كل الأسئلة والإجابات (للكشف في الآخر بس)
    submissions: new Map(),  // token -> {text, round, correct, points}
    decided: new Set(),
    penalty: 0,
    turnDeadline: null, turnTimer: null,
    lastResult: null, readyNext: new Set(),
    results: null,
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, name, avatar) {
  const token = rid();
  const p = { token, id: 'c' + (++playerSeq), name, avatar, connected: false, away: false, left: false, lastSeen: now(), res: null,
    score: 0, stat: { solved: 0, accusedTimes: 0, penalties: 0 } };
  room.players.set(token, p);
  room.order.push(token);
  if (!room.hostToken) room.hostToken = token;
  return p;
}
function connectedPlayers(room) { return room.order.map(t => room.players.get(t)).filter(p => p && p.connected); }
function activePlayers(room) { return room.order.map(t => room.players.get(t)).filter(p => p && !p.left); }
function allPlayers(room) { return room.order.map(t => room.players.get(t)).filter(Boolean); }
function isHost(room, p) { return room.hostToken === p.token; }
function byId(room, id) { return allPlayers(room).find(x => x.id === String(id)); }
function nameOf(room, token) {
  const p = room.players.get(token); if (p) return { name: p.name, avatar: p.avatar, id: p.id };
  const g = room.ghosts.get(token); if (g) return { name: g.name + ' (خرج)', avatar: g.avatar, id: 'ghost' };
  return { name: 'لاعب سابق', avatar: '👻', id: 'ghost' };
}
/* المحققين اللي لسه بيلعبوا (مسلّموش) */
function activeDetectives(room) {
  return connectedPlayers(room).filter(p => p.token !== room.accused && !room.submissions.has(p.token));
}

function freeItems(room, catId) { return BANK.catItems(catId).filter(it => !room.usedItems.has(it.id)); }
function pickItem(room) {
  const pool = [];
  for (const c of room.settings.cats) for (const it of freeItems(room, c)) pool.push(it);
  if (!pool.length) for (const c of BANK.cats()) for (const it of freeItems(room, c.id)) pool.push(it);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ============ SSE ============ */
function sseSend(res, obj) { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} }
function viewFor(room, p) {
  const st = {
    t: 'state', serverNow: now(), code: room.code, phase: room.phase,
    settings: room.settings, net: NET,
    allCats: BANK.cats(),
    round: room.round, totalRounds: room.settings.rounds,
    caseNo: room.caseIdx + 1, totalCases: room.plan.length || 0,
    players: allPlayers(room).map(x => ({ id: x.id, name: x.name, avatar: x.avatar, isHost: isHost(room, x),
      connected: x.connected, away: !!x.away, left: !!x.left, score: x.score,
      submitted: room.submissions.has(x.token), isAccused: x.token === room.accused })),
    you: { id: p.id, isHost: isHost(room, p), score: p.score },
  };
  const inGame = room.phase === 'pick' || room.phase === 'play' || room.phase === 'reveal';
  if (inGame) {
    const acc = room.accused ? nameOf(room, room.accused) : null;
    st.accused = acc;
    st.youAreAccused = room.accused === p.token;
    st.cat = room.item ? BANK.catMeta(room.item.cat) : null;
    if (st.youAreAccused && room.item) st.secret = room.item.title;
  }
  if (room.phase === 'pick') {
    st.pickMode = room.pickMode;
    st.passesLeft = Math.max(0, room.settings.maxPass - room.passesUsed);
    st.catOptions = room.settings.cats.map(c => BANK.catMeta(c));
    st.allowCustomWord = room.settings.allowCustomWord;
  }
  if (room.phase === 'play') {
    st.sub = room.sub;
    st.tier = tierPoints(room.round);
    st.nextTier = room.round < room.settings.rounds ? tierPoints(room.round + 1) : null;
    st.deadline = room.turnDeadline;
    st.youSubmitted = room.submissions.has(p.token);
    st.yourSubmission = room.submissions.has(p.token) ? room.submissions.get(p.token).text : null;
    st.askersLeft = activeDetectives(room).length;
    st.penalty = room.penalty;
    st.maxQChars = MAX_Q_CHARS;
    if (room.sub === 'ask' || room.sub === 'answer') {
      const curTok = room.askOrder[room.askIdx];
      const cur = curTok ? nameOf(room, curTok) : null;
      st.asker = cur;
      st.yourTurnToAsk = curTok === p.token && room.sub === 'ask';
      st.askIdx = room.askIdx + 1;
      st.askTotal = room.askOrder.length;
      st.curQ = room.curQ ? { asker: nameOf(room, room.curQ.token), text: room.curQ.text, answer: room.curQ.answer || null } : null;
    }
    if (room.sub === 'decide') {
      st.youDecided = room.decided.has(p.token) || room.submissions.has(p.token);
      st.decidedCount = [...room.decided].filter(t => room.players.has(t)).length + [...room.submissions.keys()].filter(t => room.players.has(t)).length;
      st.decideTotal = connectedPlayers(room).filter(x => x.token !== room.accused).length;
      st.mustSubmit = room.round >= room.settings.rounds;   // آخر جولة: لازم يسلّم
    }
  }
  if (room.phase === 'reveal') {
    st.result = room.lastResult;
    st.readyIds = [...room.readyNext].map(t => (room.players.get(t) || {}).id).filter(Boolean);
    st.youReady = room.readyNext.has(p.token);
  }
  if (room.phase === 'gameover') st.results = room.results;
  return st;
}
function broadcast(room) { room.lastActivity = now(); for (const p of allPlayers(room)) if (p.res) sseSend(p.res, viewFor(room, p)); }

/* ============ سير اللعبة ============ */
function clearTimer(room) { if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; } room.turnDeadline = null; }

/* خطة القضايا: كل لاعب بيبقى متّهم نفس عدد المرات بالظبط.
   «عشوائي» بيخلط الترتيب جوه كل لفة بس — مش بيغيّر الأعداد. */
function buildPlan(room) {
  const base = connectedPlayers(room).map(p => p.token);
  const seq = [];
  for (let r = 0; r < room.settings.casesPerPlayer; r++) {
    seq.push(...(room.settings.accusedOrder === 'random' ? shuffle(base) : base));
  }
  room.plan = seq;
}

function startGame(room) {
  for (const p of allPlayers(room)) { p.score = 0; p.stat = { solved: 0, accusedTimes: 0, penalties: 0 }; }
  buildPlan(room);
  room.caseIdx = 0;
  startCase(room);
}

function startCase(room) {
  clearTimer(room);
  if (room.caseIdx >= room.plan.length) return finishGame(room);
  let tok = room.plan[room.caseIdx];
  let acc = room.players.get(tok);
  if (!acc || !acc.connected) {
    const conn = connectedPlayers(room);
    if (!conn.length) return finishGame(room);
    acc = conn[room.caseIdx % conn.length];
    tok = acc.token;
  }
  room.accused = tok;
  acc.stat.accusedTimes++;
  room.round = 0; room.history = []; room.submissions = new Map(); room.decided = new Set();
  room.penalty = 0; room.curQ = null; room.item = null; room.pickMode = null; room.passesUsed = 0;
  if (!room.settings.allowCustomWord) {
    const it = pickItem(room);
    if (it) { room.item = it; room.usedItems.add(it.id); }
    room.pickMode = 'bank';
  }
  room.phase = 'pick';
  broadcast(room);
}

function beginPlay(room) {
  room.round = 0;
  startRound(room);
}

function buildAskOrder(room) {
  const dets = activeDetectives(room).map(p => p.token);
  room.askOrder = room.settings.askOrder === 'random' ? shuffle(dets) : dets;
  room.askIdx = 0;
}

function startRound(room) {
  clearTimer(room);
  room.round++;
  if (room.round > room.settings.rounds) return finishCase(room);
  buildAskOrder(room);
  if (!room.askOrder.length) return finishCase(room);
  room.sub = 'ask';
  room.curQ = null;
  room.phase = 'play';
  armAsk(room);
  broadcast(room);
}

function armAsk(room) {
  clearTimer(room);
  if (room.settings.qTime > 0) {
    room.turnDeadline = now() + room.settings.qTime * 1000;
    room.turnTimer = setTimeout(() => { room.turnTimer = null; skipAsk(room); }, room.settings.qTime * 1000 + 200);
  }
}
function armAnswer(room) {
  clearTimer(room);
  if (room.settings.aTime > 0) {
    room.turnDeadline = now() + room.settings.aTime * 1000;
    room.turnTimer = setTimeout(() => { room.turnTimer = null; timeoutAnswer(room); }, room.settings.aTime * 1000 + 200);
  }
}

function skipAsk(room) {
  if (room.phase !== 'play' || room.sub !== 'ask') return;
  const tok = room.askOrder[room.askIdx];
  if (tok) room.history.push({ round: room.round, token: tok, text: '— معدّاش سؤاله ⏰', answer: null, skipped: true });
  nextAsker(room);
}

function timeoutAnswer(room) {
  if (room.phase !== 'play' || room.sub !== 'answer' || !room.curQ) return;
  // المتّهم مردش → خصم
  const acc = room.players.get(room.accused);
  if (acc) { acc.score -= NO_ANSWER_PENALTY; acc.stat.penalties++; }
  room.penalty += NO_ANSWER_PENALTY;
  room.curQ.answer = 'none';
  room.history.push({ round: room.round, token: room.curQ.token, text: room.curQ.text, answer: 'none', penalty: true });
  nextAsker(room);
}

function nextAsker(room) {
  room.curQ = null;
  room.askIdx++;
  if (room.askIdx >= room.askOrder.length) { startDecide(room); return; }
  room.sub = 'ask';
  armAsk(room);
  broadcast(room);
}

function startDecide(room) {
  clearTimer(room);
  room.decided = new Set();
  room.sub = 'decide';
  broadcast(room);
  maybeCloseDecide(room);
}

function maybeCloseDecide(room) {
  if (room.phase !== 'play' || room.sub !== 'decide') return;
  const dets = connectedPlayers(room).filter(x => x.token !== room.accused);
  const pending = dets.filter(x => !room.submissions.has(x.token) && !room.decided.has(x.token));
  if (pending.length) return;
  // خلاص كله قرر
  if (!activeDetectives(room).length) return finishCase(room);       // كله سلّم
  if (room.round >= room.settings.rounds) return finishCase(room);   // خلصت الجولات
  startRound(room);
}

function finishCase(room) {
  clearTimer(room);
  // اللي مسلّمش لسه (خرج/اتفصل) بيتحسب صفر
  const rows = [];
  for (const p of activePlayers(room)) {
    if (p.token === room.accused) continue;
    const sub = room.submissions.get(p.token);
    rows.push({
      name: p.name, avatar: p.avatar,
      answer: sub ? sub.text : null,
      round: sub ? sub.round : null,
      correct: sub ? sub.correct : false,
      points: sub ? sub.points : 0,
    });
  }
  const accName = room.accused ? nameOf(room, room.accused) : { name: '—', avatar: '👤' };
  room.lastResult = {
    secret: room.item ? room.item.title : '—',
    cat: room.item ? BANK.catMeta(room.item.cat) : null,
    fromCustom: room.pickMode === 'custom',
    accusedName: accName.name, accusedAvatar: accName.avatar,
    accusedPenalty: room.penalty,
    answers: rows.sort((a, b) => (b.points - a.points)),
    history: room.history.map(h => { const w = nameOf(room, h.token); return { name: w.name, avatar: w.avatar, text: h.text, answer: h.answer, round: h.round }; }),
  };
  room.readyNext = new Set();
  room.phase = 'reveal';
  broadcast(room);
}

function maybeAdvance(room) {
  if (room.phase !== 'reveal') return;
  const conn = connectedPlayers(room);
  if (!conn.length || !conn.every(p => room.readyNext.has(p.token))) return;
  advanceCase(room);
}
function advanceCase(room) {
  if (room.phase !== 'reveal') return;
  room.caseIdx++;
  if (room.caseIdx >= room.plan.length) finishGame(room);
  else startCase(room);
}

function finishGame(room) {
  clearTimer(room);
  const players = allPlayers(room);
  const ranking = players.slice().sort((a, b) => b.score - a.score).map((p, i) => ({
    rank: i + 1, id: p.id, name: p.name, avatar: p.avatar, score: p.score,
    solved: p.stat.solved, connected: p.connected, left: !!p.left,
  }));
  const awards = [];
  if (ranking.length) awards.push({ icon: '🏆', title: 'بطل اللمّة', who: ranking[0].name, detail: ranking[0].score + ' نقطة' });
  let best = null;
  for (const p of players) if (p.stat.solved > 0 && (!best || p.stat.solved > best.stat.solved)) best = p;
  if (best) awards.push({ icon: '⚡', title: 'أشطر محقق', who: best.name, detail: `عرفها ${best.stat.solved} مرة` });
  let bestAccused = null;
  for (const p of players) if (p.stat.accusedTimes > 0 && (!bestAccused || p.stat.penalties < bestAccused.stat.penalties)) bestAccused = p;
  if (bestAccused) awards.push({ icon: '🎭', title: 'أنضف متّهم', who: bestAccused.name, detail: bestAccused.stat.penalties ? `فاته ${bestAccused.stat.penalties} سؤال` : 'رد على كل الأسئلة 👏' });
  room.results = { ranking, awards, review: room.lastResult ? [room.lastResult] : [] };
  room.phase = 'gameover';
  broadcast(room);
}

function playAgain(room) {
  for (const tok of [...room.order]) {
    const p = room.players.get(tok);
    if (!p || !p.connected) { if (p) room.ghosts.set(tok, { name: p.name, avatar: p.avatar }); room.players.delete(tok); room.order = room.order.filter(t => t !== tok); }
  }
  if (!room.players.has(room.hostToken)) room.hostToken = room.order[0] || null;
  for (const p of allPlayers(room)) { p.score = 0; p.left = false; p.away = false; p.stat = { solved: 0, accusedTimes: 0, penalties: 0 }; }
  clearTimer(room);
  room.plan = []; room.caseIdx = 0;
  room.round = 0; room.history = []; room.submissions = new Map(); room.decided = new Set();
  room.accused = null; room.item = null; room.curQ = null; room.penalty = 0;
  room.results = null; room.lastResult = null;
  room.phase = 'lobby';
  broadcast(room);
}

function recheckGates(room) {
  if (room.phase === 'pick') {
    const acc = room.players.get(room.accused);
    if (!acc || !acc.connected) { room.item = room.item || pickItem(room); finishCase(room); }
    return;
  }
  if (room.phase === 'play') {
    const acc = room.players.get(room.accused);
    if (!acc || !acc.connected) { finishCase(room); return; }     // المتّهم خرج → الجولة تتلغي
    if (room.sub === 'ask') {
      const curTok = room.askOrder[room.askIdx];
      const cur = curTok ? room.players.get(curTok) : null;
      if (!cur || !cur.connected) skipAsk(room);
    }
    if (room.sub === 'decide') maybeCloseDecide(room);
    // لو كل المحققين خرجوا
    if (!connectedPlayers(room).filter(x => x.token !== room.accused).length) finishCase(room);
  }
  if (room.phase === 'reveal') maybeAdvance(room);
}

function softLeave(room, p) {
  p.left = true;
  if (p.res) { try { sseSend(p.res, { t: 'left' }); p.res.end(); } catch (e) {} }
  p.res = null; p.connected = false;
  if (room.hostToken === p.token) migrateHost(room);
  recheckGates(room);
  broadcast(room);
}
function removePlayer(room, p, kicked) {
  room.ghosts.set(p.token, { name: p.name, avatar: p.avatar });
  if (p.res) { try { sseSend(p.res, { t: kicked ? 'kicked' : 'left' }); p.res.end(); } catch (e) {} }
  room.players.delete(p.token);
  room.order = room.order.filter(t => t !== p.token);
  room.readyNext.delete(p.token); room.decided.delete(p.token);
  if (room.hostToken === p.token) migrateHost(room);
  if (!room.players.size) { destroyRoom(room); return; }
  recheckGates(room);
  broadcast(room);
}
function migrateHost(room) { const conn = connectedPlayers(room); room.hostToken = (conn[0] || allPlayers(room)[0] || {}).token || null; }
function destroyRoom(room) { clearTimer(room); rooms.delete(room.code); }

/* ============ الواجهة العامة ============ */
function R(status, body) { return { status, body }; }
function findRoomPlayer(body) {
  const room = rooms.get(String(body.code || ''));
  if (!room) return { err: 'الروم ده مش موجود 🤔' };
  const p = room.players.get(String(body.token || ''));
  if (!p) return { err: 'انت مش في الروم ده' };
  return { room, p };
}

module.exports = {
  id: 'conan',
  setNet(net) { NET = net; },

  create(b) {
    const name = clampStr(b.name, 16);
    if (!name) return R(400, { ok: false, error: 'اكتب اسمك الأول' });
    if (rooms.size >= MAX_ROOMS) return R(503, { ok: false, error: 'السيرفر زحمة دلوقتي' });
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
    if (room.players.size >= MAX_PLAYERS) return R(403, { ok: false, error: 'الروم مليان (' + MAX_PLAYERS + ')' });
    const name = clampStr(b.name, 16);
    if (!name) return R(400, { ok: false, error: 'اكتب اسمك الأول' });
    for (const x of allPlayers(room)) if (x.name.toLowerCase() === name.toLowerCase()) return R(409, { ok: false, error: 'الاسم متاخد، اختار غيره' });
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
    broadcast(room);
    req.on('close', () => {
      if (p.res === res) { p.res = null; p.connected = false; p.lastSeen = now(); }
      if (!rooms.has(room.code)) return;
      if (room.hostToken === p.token) setTimeout(() => {
        if (!rooms.has(room.code)) return;
        const hp = room.players.get(room.hostToken);
        if (hp && !hp.connected) { migrateHost(room); broadcast(room); }
      }, HOST_GRACE_MS);
      recheckGates(room);
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
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس اللي يظبط' });
      if (room.phase !== 'lobby') return R(400, { ok: false, error: 'الإعدادات في اللوبي بس' });
      const s = b.settings || {};
      if (Array.isArray(s.cats)) { const v = [...new Set(s.cats.filter(c => BANK.catMeta(c)))]; if (v.length >= 1) room.settings.cats = v; }
      const rr = parseInt(s.rounds, 10); if (Number.isInteger(rr) && rr >= 2 && rr <= 10) room.settings.rounds = rr;
      const cp = parseInt(s.casesPerPlayer, 10); if (Number.isInteger(cp) && cp >= 1 && cp <= 5) room.settings.casesPerPlayer = cp;
      if (s.askOrder === 'random' || s.askOrder === 'turns') room.settings.askOrder = s.askOrder;
      if (s.accusedOrder === 'random' || s.accusedOrder === 'turns') room.settings.accusedOrder = s.accusedOrder;
      if (typeof s.allowCustomWord === 'boolean') room.settings.allowCustomWord = s.allowCustomWord;
      const mp = parseInt(s.maxPass, 10); if (Number.isInteger(mp) && mp >= 0 && mp <= 5) room.settings.maxPass = mp;
      const qt = parseInt(s.qTime, 10); if (qt === 0 || qt === 15 || qt === 30 || qt === 45) room.settings.qTime = qt;
      const at = parseInt(s.aTime, 10); if (at === 0 || at === 15 || at === 30) room.settings.aTime = at;
      broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'startGame') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس اللي يبدأ' });
      if (room.phase !== 'lobby') return R(400, { ok: false, error: 'مش في اللوبي' });
      if (connectedPlayers(room).length < MIN_PLAYERS) return R(400, { ok: false, error: `محتاجين ${MIN_PLAYERS} على الأقل` });
      startGame(room);
      return R(200, { ok: true });
    }
    /* ===== اختيار الكلمة ===== */
    if (A === 'pickBank') {
      if (room.phase !== 'pick') return R(400, { ok: false, error: 'مش وقتها' });
      if (room.accused !== p.token) return R(403, { ok: false, error: 'المتّهم بس' });
      if (room.pickMode === 'custom') return R(400, { ok: false, error: 'انت اخترت تكتب كلمتك — كمّل بيها' });
      const it = pickItem(room);
      if (!it) return R(400, { ok: false, error: 'البنك خلص' });
      room.item = it; room.usedItems.add(it.id);
      room.pickMode = 'bank';
      broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'pickCustom') {
      if (room.phase !== 'pick') return R(400, { ok: false, error: 'مش وقتها' });
      if (room.accused !== p.token) return R(403, { ok: false, error: 'المتّهم بس' });
      if (!room.settings.allowCustomWord) return R(400, { ok: false, error: 'الخيار ده مقفول' });
      if (room.pickMode === 'bank') return R(400, { ok: false, error: 'انت اخترت من البنك — كمّل بيه' });
      const word = clampStr(b.word, 40);
      if (word.length < 2) return R(400, { ok: false, error: 'اكتب كلمة صح' });
      const cat = String(b.cat || room.settings.cats[0]);
      if (!room.settings.cats.includes(cat)) return R(400, { ok: false, error: 'اختار كاتيجوري من اللي في اللعبة' });
      room.item = { id: 'custom_' + rid().slice(0, 8), cat, title: word, accepts: [BANK.normalize(word)].filter(Boolean) };
      room.pickMode = 'custom';
      broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'rerollWord') {
      if (room.phase !== 'pick') return R(400, { ok: false, error: 'مش وقتها' });
      if (room.accused !== p.token) return R(403, { ok: false, error: 'المتّهم بس' });
      if (room.pickMode !== 'bank') return R(400, { ok: false, error: 'التبديل من البنك بس' });
      if (room.passesUsed >= room.settings.maxPass) return R(400, { ok: false, error: 'خلّصت مرات التبديل' });
      const it = pickItem(room);
      if (!it) return R(400, { ok: false, error: 'البنك خلص' });
      room.passesUsed++;
      room.item = it; room.usedItems.add(it.id);
      broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'startPlay') {
      if (room.phase !== 'pick') return R(400, { ok: false, error: 'مش وقتها' });
      if (room.accused !== p.token) return R(403, { ok: false, error: 'المتّهم بس' });
      if (!room.item) return R(400, { ok: false, error: 'اختار الكلمة الأول' });
      beginPlay(room);
      return R(200, { ok: true });
    }
    /* ===== الأسئلة والإجابات ===== */
    if (A === 'ask') {
      if (room.phase !== 'play' || room.sub !== 'ask') return R(400, { ok: false, error: 'مش وقت الأسئلة' });
      const curTok = room.askOrder[room.askIdx];
      if (curTok !== p.token) return R(400, { ok: false, error: 'مش دورك دلوقتي ⏳' });
      const q = clampStr(b.text, MAX_Q_CHARS);
      if (q.length < 3) return R(400, { ok: false, error: 'اكتب سؤال أوضح' });
      for (const h of room.history) if (!h.skipped && BANK.sameWord(h.text, q)) return R(400, { ok: false, error: 'السؤال ده اتسأل قبل كده — غيّره' });
      room.curQ = { token: p.token, text: q, at: now(), answer: null };
      room.sub = 'answer';
      armAnswer(room);
      broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'answer') {
      if (room.phase !== 'play' || room.sub !== 'answer') return R(400, { ok: false, error: 'مش وقت الرد' });
      if (room.accused !== p.token) return R(403, { ok: false, error: 'المتّهم بس اللي يرد' });
      const v = String(b.value || '');
      if (!['yes', 'no', 'maybe'].includes(v)) return R(400, { ok: false, error: 'رد غلط' });
      room.curQ.answer = v;
      room.history.push({ round: room.round, token: room.curQ.token, text: room.curQ.text, answer: v });
      clearTimer(room);
      broadcast(room);
      setTimeout(() => { if (room.phase === 'play' && room.sub === 'answer') nextAsker(room); }, 1200);
      return R(200, { ok: true });
    }
    /* ===== التسليم أو الاستمرار ===== */
    if (A === 'submitAnswer') {
      if (room.phase !== 'play') return R(400, { ok: false, error: 'مش وقتها' });
      if (room.accused === p.token) return R(400, { ok: false, error: 'انت المتّهم 😄' });
      if (room.submissions.has(p.token)) return R(400, { ok: false, error: 'انت سلّمت خلاص' });
      const g = clampStr(b.text, 60);
      if (!g) return R(400, { ok: false, error: 'اكتب إجابتك' });
      const correct = !!(room.item && BANK.isMatch(room.item, g));
      const pts = correct ? tierPoints(room.round) : 0;
      room.submissions.set(p.token, { text: g, round: room.round, correct, points: pts });
      if (correct) { p.score += pts; p.stat.solved++; }
      room.decided.add(p.token);
      broadcast(room);
      if (room.sub === 'decide') maybeCloseDecide(room);
      return R(200, { ok: true, locked: true });
    }
    if (A === 'keepGoing') {
      if (room.phase !== 'play' || room.sub !== 'decide') return R(400, { ok: false, error: 'مش وقتها' });
      if (room.accused === p.token) return R(400, { ok: false, error: 'انت المتّهم' });
      if (room.round >= room.settings.rounds) return R(400, { ok: false, error: 'دي آخر جولة — لازم تسلّم إجابتك' });
      room.decided.add(p.token);
      broadcast(room);
      maybeCloseDecide(room);
      return R(200, { ok: true });
    }
    if (A === 'readyNext') {
      if (room.phase !== 'reveal') return R(400, { ok: false, error: 'مش وقتها' });
      room.readyNext.add(p.token);
      maybeAdvance(room);
      if (room.phase === 'reveal') broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'forceNext') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس' });
      if (room.phase === 'pick') { if (!room.item) { const it = pickItem(room); if (it) { room.item = it; room.usedItems.add(it.id); room.pickMode = 'bank'; } } beginPlay(room); }
      else if (room.phase === 'play' && room.sub === 'ask') skipAsk(room);
      else if (room.phase === 'play' && room.sub === 'answer') timeoutAnswer(room);
      else if (room.phase === 'play' && room.sub === 'decide') { for (const d of connectedPlayers(room)) if (d.token !== room.accused && !room.submissions.has(d.token)) room.decided.add(d.token); maybeCloseDecide(room); }
      else if (room.phase === 'reveal') advanceCase(room);
      return R(200, { ok: true });
    }
    if (A === 'presence') {
      const away = !!b.away;
      if (p.away !== away) { p.away = away; broadcast(room); }
      return R(200, { ok: true });
    }
    if (A === 'kick') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس' });
      const target = byId(room, b.playerId);
      if (!target || target.token === p.token) return R(400, { ok: false, error: 'مينفعش' });
      removePlayer(room, target, true);
      return R(200, { ok: true });
    }
    if (A === 'playAgain') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس' });
      if (room.phase !== 'gameover') return R(400, { ok: false, error: 'اللعبة لسه مخلصتش' });
      playAgain(room);
      return R(200, { ok: true });
    }
    if (A === 'leave') {
      if (room.phase === 'lobby') removePlayer(room, p, false);
      else softLeave(room, p);
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
