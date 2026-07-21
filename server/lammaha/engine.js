/* لمّحها — محرك اللعبة (تلميح مكتوب، أونلاين بالكامل)
   الملمّح بيكتب تلميح (والنظام بيرفض أي تلميح فيه الاسم أو قريب منه).
   كل مخمّن ليه تخمينة واحدة لكل تلميحة. كل التخمينات غلط → التلميحة اللي بعدها تلقائي.
   سلم النقط: تلميحة 1 = 100 ... تلميحة 10 = 10. اللي يجيبوها كلهم ياخدوا نقط التلميحة والملمّح ياخد زيهم.
   محدش عرف بعد آخر تلميحة → محدش ياخد حاجة. */
'use strict';
const crypto = require('crypto');
const BANK = require('./bank');

const HOST_GRACE_MS = parseInt(process.env.HOST_GRACE_MS || '45000', 10);
const ROOM_TTL_MS = parseInt(process.env.ROOM_TTL_MS || String(90 * 60 * 1000), 10);
const MAX_ROOMS = 300;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const AVATARS = ['🦅','🛡️','🎯','🧠','⚡','🔥','👑','🚀','💎','🏹','♟️','🎓','⚙️','🔭','📚','🧭','🥇','🗺️','🏛️','⭐','🌋','🎤','🎩','🕵️'];

let NET = { ips: [], port: 3000, hosted: false };
const now = () => Date.now();
const rid = () => crypto.randomBytes(16).toString('hex');
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function clampStr(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max); }
const tierPoints = n => Math.max(10, 110 - 10 * n); // تلميحة 1=100 .. 10=10

const rooms = new Map();
let playerSeq = 0;
function makeCode() { for (let i = 0; i < 50; i++) { const c = String(1000 + Math.floor(Math.random() * 9000)); if (!rooms.has(c)) return c; } return null; }

function createRoom() {
  const code = makeCode();
  if (!code) return null;
  const room = {
    code, createdAt: now(), lastActivity: now(),
    phase: 'lobby', // lobby | clue | reveal | gameover
    settings: { cats: ['football', 'places', 'animals', 'food'], roundsPerPlayer: 2, maxClues: 4, maxPass: 2, clueTime: 0, order: 'random' },
    hostToken: null, players: new Map(), order: [], ghosts: new Map(),
    usedItems: new Set(),          // الأسماء اللي اتلعبت في الروم — عمرها ما بتتصفر
    plan: [], roundIdx: 0,
    cluer: null, item: null,
    sub: 'hint',                   // hint: الملمّح بيكتب | guess: الكل بيخمّن التلميحة الحالية
    cluesGiven: 0, passesUsed: 0,
    hints: [],                     // التلميحات المنشورة [{n,text}]
    hintGuesses: new Map(),        // تخمينات التلميحة الحالية token->text
    hintHistory: [],               // التلميحات اللي عدّت بدون حل [{n,text,guesses:[{token,text}]}]
    guessDeadline: null, guessTimer: null,
    lastResult: null, readyNext: new Set(), roundHistory: [],
    results: null,
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, name, avatar) {
  const token = rid();
  const p = { token, id: 'l' + (++playerSeq), name, avatar, connected: false, away: false, left: false, lastSeen: now(), res: null,
    score: 0, stat: { solved: 0, cluedSuccess: 0, cluedTotal: 0 } };
  room.players.set(token, p);
  room.order.push(token);
  if (!room.hostToken) room.hostToken = token;
  return p;
}
function connectedPlayers(room) { return room.order.map(t => room.players.get(t)).filter(p => p && p.connected); }
function allPlayers(room) { return room.order.map(t => room.players.get(t)).filter(Boolean); }
function isHost(room, p) { return room.hostToken === p.token; }
function byId(room, id) { return allPlayers(room).find(x => x.id === String(id)); }
function nameOf(room, token) {
  const p = room.players.get(token); if (p) return { name: p.name, avatar: p.avatar, id: p.id };
  const g = room.ghosts.get(token); if (g) return { name: g.name + ' (خرج)', avatar: g.avatar, id: 'ghost' };
  return { name: 'لاعب سابق', avatar: '👻', id: 'ghost' };
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
    round: room.roundIdx + 1, totalRounds: room.plan.length || 0,
    players: allPlayers(room).map(x => ({ id: x.id, name: x.name, avatar: x.avatar, isHost: isHost(room, x),
      connected: x.connected, away: !!x.away, left: !!x.left, score: x.score })),
    you: { id: p.id, isHost: isHost(room, p), score: p.score },
  };
  if (room.phase === 'clue' || room.phase === 'reveal') {
    const cluer = room.players.get(room.cluer);
    st.cluer = cluer ? { id: cluer.id, name: cluer.name, avatar: cluer.avatar } : nameOf(room, room.cluer);
    st.youAreCluer = room.cluer === p.token;
    st.cat = room.item ? BANK.catMeta(room.item.cat) : null;
  }
  if (room.phase === 'clue') {
    st.sub = room.sub;
    st.cluesGiven = room.cluesGiven;
    st.maxClues = room.settings.maxClues;
    st.cluesLeft = Math.max(0, room.settings.maxClues - room.cluesGiven);
    st.passesLeft = Math.max(0, room.settings.maxPass - room.passesUsed);
    st.tier = tierPoints(room.sub === 'guess' ? room.cluesGiven : room.cluesGiven + 1);
    st.hints = room.hints.slice();
    st.hintHistory = room.hintHistory.map(h => ({ n: h.n, text: h.text, guesses: h.guesses.map(g => { const w = nameOf(room, g.token); return { name: w.name, avatar: w.avatar, text: g.text }; }) }));
    if (st.youAreCluer) st.secret = room.item ? room.item.title : null;
    if (room.sub === 'guess') {
      st.deadline = room.guessDeadline;
      st.youGuessed = room.hintGuesses.has(p.token);
      st.yourGuessText = room.hintGuesses.get(p.token) || null;
      st.guessedIds = [...room.hintGuesses.keys()].map(t => (room.players.get(t) || {}).id).filter(Boolean);
      st.eligibleCount = connectedPlayers(room).filter(x => x.token !== room.cluer).length;
      // الملمّح بيتفرج على التخمينات لايف (من غير علامة صح/غلط — التشويق للنهاية)
      if (st.youAreCluer) st.liveGuesses = [...room.hintGuesses.entries()].map(([t, txt]) => { const w = nameOf(room, t); return { name: w.name, avatar: w.avatar, text: txt }; });
    }
  }
  if (room.phase === 'reveal') {
    st.result = room.lastResult;
    st.readyIds = [...room.readyNext].map(t => (room.players.get(t) || {}).id).filter(Boolean);
    st.youReady = room.readyNext.has(p.token);
    st.isLastRound = room.roundIdx + 1 >= room.plan.length;
  }
  if (room.phase === 'gameover') st.results = room.results;
  return st;
}
function broadcast(room) { room.lastActivity = now(); for (const p of allPlayers(room)) if (p.res) sseSend(p.res, viewFor(room, p)); }

/* ============ سير اللعبة ============ */
function clearGuessTimer(room) { if (room.guessTimer) { clearTimeout(room.guessTimer); room.guessTimer = null; } room.guessDeadline = null; }

function buildPlan(room) {
  const base = room.order.slice();
  const seq = [];
  for (let r = 0; r < room.settings.roundsPerPlayer; r++) seq.push(...base);
  room.plan = (room.settings.order === 'random' ? shuffle(seq) : seq).map(tok => ({ cluer: tok }));
}

function startGame(room) {
  buildPlan(room);
  room.roundIdx = 0;
  room.roundHistory = [];
  // usedItems متصفرش أبدًا — الاسم اللي اتقال في الروم مبيرجعش حتى في «نلعب تاني»
  for (const p of allPlayers(room)) { p.score = 0; p.stat = { solved: 0, cluedSuccess: 0, cluedTotal: 0 }; }
  startRound(room);
}

function startRound(room) {
  clearGuessTimer(room);
  const r = room.plan[room.roundIdx];
  if (!r) return finishGame(room);
  let cluerTok = r.cluer;
  let cl = room.players.get(cluerTok);
  if (!cl || !cl.connected) {
    const conn = connectedPlayers(room);
    if (!conn.length) return;
    cl = conn[room.roundIdx % conn.length];
    cluerTok = cl.token;
  }
  room.cluer = cluerTok;
  room.item = pickItem(room);
  if (room.item) room.usedItems.add(room.item.id);
  room.sub = 'hint';
  room.cluesGiven = 0; room.passesUsed = 0;
  room.hints = []; room.hintGuesses = new Map(); room.hintHistory = [];
  room.readyNext = new Set(); room.lastResult = null;
  room.phase = 'clue';
  broadcast(room);
}

function publishHint(room, text) {
  room.hints.push({ n: room.cluesGiven + 1, text });
  room.cluesGiven++;
  room.sub = 'guess';
  room.hintGuesses = new Map();
  clearGuessTimer(room);
  if (room.settings.clueTime > 0) {
    room.guessDeadline = now() + room.settings.clueTime * 1000;
    room.guessTimer = setTimeout(() => { room.guessTimer = null; resolveHint(room); }, room.settings.clueTime * 1000 + 200);
  }
  broadcast(room);
}

function maybeResolve(room) {
  if (room.phase !== 'clue' || room.sub !== 'guess') return;
  const eligible = connectedPlayers(room).filter(x => x.token !== room.cluer);
  if (!eligible.length) { resolveHint(room); return; }
  if (eligible.every(x => room.hintGuesses.has(x.token))) resolveHint(room);
}

function resolveHint(room) {
  if (room.phase !== 'clue' || room.sub !== 'guess') return;
  clearGuessTimer(room);
  const entries = [...room.hintGuesses.entries()].map(([token, text]) => ({ token, text, correct: BANK.isMatch(room.item, text) }));
  const winners = entries.filter(e => e.correct).map(e => e.token);
  if (winners.length) return endRound(room, winners, entries);
  // كله غلط → سجّل التلميحة وتخميناتها، وشوف لو في تلميحات فاضلة
  room.hintHistory.push({ n: room.cluesGiven, text: (room.hints[room.hints.length - 1] || {}).text || '', guesses: entries });
  room.hintGuesses = new Map();
  if (room.cluesGiven >= room.settings.maxClues) return endRound(room, [], null);
  room.sub = 'hint';
  broadcast(room);
}

function endRound(room, winnersTokens, finalEntries) {
  if (room.phase !== 'clue') return;
  clearGuessTimer(room);
  const pts = room.cluesGiven > 0 ? tierPoints(room.cluesGiven) : 0;
  const cluer = room.players.get(room.cluer);
  if (cluer) cluer.stat.cluedTotal++;
  const solved = winnersTokens && winnersTokens.length > 0;
  if (solved) {
    for (const t of winnersTokens) { const w = room.players.get(t); if (w) { w.score += pts; w.stat.solved++; } }
    if (cluer) { cluer.score += pts; cluer.stat.cluedSuccess++; }
  }
  // تجميع كل التلميحات بتخميناتها للعرض
  const breakdown = room.hintHistory.map(h => ({ n: h.n, text: h.text, guesses: h.guesses.map(g => { const w = nameOf(room, g.token); return { name: w.name, avatar: w.avatar, text: g.text, correct: false }; }) }));
  if (solved && finalEntries) {
    breakdown.push({ n: room.cluesGiven, text: (room.hints[room.hints.length - 1] || {}).text || '', guesses: finalEntries.map(g => { const w = nameOf(room, g.token); return { name: w.name, avatar: w.avatar, text: g.text, correct: g.correct }; }) });
  }
  room.lastResult = {
    secret: room.item ? room.item.title : '',
    cat: room.item ? BANK.catMeta(room.item.cat) : null,
    cluerName: nameOf(room, room.cluer).name, cluerAvatar: nameOf(room, room.cluer).avatar,
    solved,
    winners: solved ? winnersTokens.map(t => { const w = nameOf(room, t); return { name: w.name, avatar: w.avatar }; }) : [],
    points: solved ? pts : 0,
    hintsUsed: room.cluesGiven,
    hints: breakdown,
  };
  room.roundHistory.push({ round: room.roundIdx + 1, ...room.lastResult });
  room.readyNext = new Set();
  room.phase = 'reveal';
  broadcast(room);
}

function maybeAdvance(room) {
  if (room.phase !== 'reveal') return;
  const conn = connectedPlayers(room);
  if (conn.length && conn.every(p => room.readyNext.has(p.token))) advanceRound(room);
}
function advanceRound(room) {
  if (room.phase !== 'reveal') return;
  room.roundIdx++;
  if (room.roundIdx >= room.plan.length) finishGame(room);
  else startRound(room);
}

function finishGame(room) {
  clearGuessTimer(room);
  const players = allPlayers(room);
  const ranking = players.slice().sort((a, b) => b.score - a.score).map((p, i) => ({
    rank: i + 1, id: p.id, name: p.name, avatar: p.avatar, score: p.score,
    solved: p.stat.solved, cluedSuccess: p.stat.cluedSuccess, connected: p.connected, left: !!p.left,
  }));
  const awards = [];
  if (ranking.length) awards.push({ icon: '🏆', title: 'بطل اللمّة', who: ranking[0].name, detail: ranking[0].score + ' نقطة' });
  let bestCluer = null;
  for (const p of players) if (!bestCluer || p.stat.cluedSuccess > bestCluer.stat.cluedSuccess) bestCluer = p;
  if (bestCluer && bestCluer.stat.cluedSuccess > 0) awards.push({ icon: '🎤', title: 'أحسن ملمّح', who: bestCluer.name, detail: `وصّل ${bestCluer.stat.cluedSuccess} مرة` });
  let bestGuesser = null;
  for (const p of players) if (!bestGuesser || p.stat.solved > bestGuesser.stat.solved) bestGuesser = p;
  if (bestGuesser && bestGuesser.stat.solved > 0) awards.push({ icon: '🧠', title: 'الفكّيك', who: bestGuesser.name, detail: `خمّن صح ${bestGuesser.stat.solved} مرة` });
  room.results = { ranking, awards, review: room.roundHistory };
  room.phase = 'gameover';
  broadcast(room);
}

function playAgain(room) {
  for (const tok of [...room.order]) {
    const p = room.players.get(tok);
    if (!p || !p.connected) { if (p) room.ghosts.set(tok, { name: p.name, avatar: p.avatar }); room.players.delete(tok); room.order = room.order.filter(t => t !== tok); }
  }
  if (!room.players.has(room.hostToken)) room.hostToken = room.order[0] || null;
  for (const p of allPlayers(room)) { p.score = 0; p.left = false; p.away = false; p.stat = { solved: 0, cluedSuccess: 0, cluedTotal: 0 }; }
  clearGuessTimer(room);
  room.plan = []; room.roundIdx = 0; room.roundHistory = []; room.results = null;
  room.item = null; room.cluer = null; room.hints = []; room.hintGuesses = new Map(); room.hintHistory = [];
  room.phase = 'lobby';
  broadcast(room);
}

function recheckGates(room) {
  if (room.phase === 'clue') {
    const cl = room.players.get(room.cluer);
    if (!cl || !cl.connected) { endRound(room, [], null); return; }
    if (room.sub === 'guess') maybeResolve(room);
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
  room.readyNext.delete(p.token);
  room.hintGuesses.delete(p.token);
  if (room.hostToken === p.token) migrateHost(room);
  if (!room.players.size) { destroyRoom(room); return; }
  recheckGates(room);
  broadcast(room);
}
function migrateHost(room) { const conn = connectedPlayers(room); room.hostToken = (conn[0] || allPlayers(room)[0] || {}).token || null; }
function destroyRoom(room) { clearGuessTimer(room); rooms.delete(room.code); }

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
  id: 'lammaha',
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
      const rp = parseInt(s.roundsPerPlayer, 10); if (Number.isInteger(rp) && rp >= 1 && rp <= 5) room.settings.roundsPerPlayer = rp;
      const mc = parseInt(s.maxClues, 10); if (Number.isInteger(mc) && mc >= 1 && mc <= 10) room.settings.maxClues = mc;
      const mp = parseInt(s.maxPass, 10); if (Number.isInteger(mp) && mp >= 0 && mp <= 5) room.settings.maxPass = mp;
      const ct = parseInt(s.clueTime, 10); if (Number.isInteger(ct) && (ct === 0 || (ct >= 15 && ct <= 180))) room.settings.clueTime = ct;
      if (s.order === 'random' || s.order === 'turns') room.settings.order = s.order;
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
    if (A === 'submitHint') {
      if (room.phase !== 'clue' || room.sub !== 'hint') return R(400, { ok: false, error: 'مش وقت كتابة تلميح' });
      if (room.cluer !== p.token) return R(403, { ok: false, error: 'الملمّح بس اللي يكتب التلميح' });
      if (room.cluesGiven >= room.settings.maxClues) return R(400, { ok: false, error: 'خلّصت التلميحات' });
      const text = clampStr(b.text, 120);
      if (text.length < 2) return R(400, { ok: false, error: 'اكتب تلميح أطول شوية' });
      if (BANK.hintLeaks(room.item, text)) return R(400, { ok: false, error: 'التلميح فيه الاسم نفسه أو حاجة قريبة منه أوي! 😅 لمّح من بعيد' });
      publishHint(room, text);
      return R(200, { ok: true });
    }
    if (A === 'guess') {
      if (room.phase !== 'clue' || room.sub !== 'guess') return R(400, { ok: false, error: 'استنى التلميحة الأول' });
      if (room.cluer === p.token) return R(400, { ok: false, error: 'انت الملمّح! 😏' });
      if (room.hintGuesses.has(p.token)) return R(400, { ok: false, error: 'ليك تخمينة واحدة بس للتلميحة دي — استنى اللي بعدها' });
      const g = clampStr(b.text, 60);
      if (!g) return R(400, { ok: false, error: 'اكتب تخمينك' });
      room.hintGuesses.set(p.token, g);
      broadcast(room);
      maybeResolve(room);
      return R(200, { ok: true });
    }
    if (A === 'giveUp') {
      if (room.phase !== 'clue') return R(400, { ok: false, error: 'مش وقتها' });
      if (room.cluer !== p.token) return R(403, { ok: false, error: 'الملمّح بس' });
      if (room.sub === 'guess') return R(400, { ok: false, error: 'استنى تخميناتهم على التلميحة دي الأول' });
      endRound(room, [], null);
      return R(200, { ok: true });
    }
    if (A === 'pass') {
      if (room.phase !== 'clue' || room.sub !== 'hint') return R(400, { ok: false, error: 'مش وقتها' });
      if (room.cluer !== p.token) return R(403, { ok: false, error: 'الملمّح بس' });
      if (room.cluesGiven > 0) return R(400, { ok: false, error: 'مينفعش تعدّي بعد ما لمّحت' });
      if (room.passesUsed >= room.settings.maxPass) return R(400, { ok: false, error: 'خلّصت مرات العدّي' });
      room.passesUsed++;
      const next = pickItem(room);
      if (next) { room.item = next; room.usedItems.add(next.id); }
      broadcast(room);
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
      if (room.phase === 'reveal') advanceRound(room);
      else if (room.phase === 'clue') { if (room.sub === 'guess') resolveHint(room); else endRound(room, [], null); }
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
