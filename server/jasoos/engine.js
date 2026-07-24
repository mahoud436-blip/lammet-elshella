/* الجاسوس — محرك اللعبة
   الكل شايف الكاتيجوري والكلمة، ما عدا الجاسوس (شايف الكاتيجوري بس).
   بالدور كل واحد بيكتب كلمة واحدة توصف الكلمة السرية — وبتظهر 7 ثواني وتختفي.
   الترتيب بيتخلط كل جولة والجاسوس عمره ما ييجي أول واحد.
   الآخر: الأبرياء بيصوّتوا (والجاسوس بيمثّل)، وبعدين الجاسوس بيخمّن الكلمة، وبعدين الكشف. */
'use strict';
const crypto = require('crypto');
const BANK = require('./bank');

const HOST_GRACE_MS = parseInt(process.env.HOST_GRACE_MS || '45000', 10);
const ROOM_TTL_MS = parseInt(process.env.ROOM_TTL_MS || String(90 * 60 * 1000), 10);
const MAX_ROOMS = 300;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const WORD_SHOW_MS = 10000;      // الكلمة بتظهر 7 ثواني وتختفي
const MAX_WORD_CHARS = 16;      // أقصى طول للكلمة الواحدة
const AVATARS = ['🕵️','🎩','🔍','🧠','🦊','🐺','🎭','👤','🃏','🔦','🗝️','🧩','⚡','🌑','🎯','🪤','📡','🧿','♠️','🖤','🔮','🚬','🎲','🧊'];

let NET = { ips: [], port: 3000, hosted: false };
const now = () => Date.now();
const rid = () => crypto.randomBytes(16).toString('hex');
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function clampStr(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max); }

/* أقصى عدد جواسيس مسموح حسب عدد اللاعيبة */
function maxSpiesFor(n) { return n >= 7 ? 3 : n >= 4 ? 2 : 1; }

const rooms = new Map();
let playerSeq = 0;
function makeCode() { for (let i = 0; i < 50; i++) { const c = String(1000 + Math.floor(Math.random() * 9000)); if (!rooms.has(c)) return c; } return null; }

function createRoom() {
  const code = makeCode();
  if (!code) return null;
  const room = {
    code, createdAt: now(), lastActivity: now(),
    phase: 'lobby',   // lobby | play | vote | spyGuess | reveal | gameover
    settings: { cats: ['sports', 'geo', 'food', 'animals'], rounds: 3, gameRounds: 3, spyMode: 'random', spyCount: 1, turnTime: 20 },
    hostToken: null, players: new Map(), order: [], ghosts: new Map(),
    usedItems: new Set(),
    item: null, spies: new Set(), spyCountActual: 0,
    gameRound: 0, round: 0, turnOrder: [], turnIdx: 0, guessOpen: false, roundResults: [],
    words: [],            // [{token, word, round, at}]
    turnDeadline: null, turnTimer: null,
    votes: new Map(),     // token -> [ids]
    spyGuesses: new Map(),// token -> text
    lastResult: null, readyNext: new Set(),
    results: null,
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, name, avatar) {
  const token = rid();
  const p = { token, id: 'j' + (++playerSeq), name, avatar, connected: false, away: false, left: false, lastSeen: now(), res: null,
    score: 0, stat: { caught: 0, escaped: 0, wordsGuessed: 0, spyTimes: 0, caughtAsSpy: 0 } };
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

function publicWords(room, viewer) {
  // الكلمات بتظهر 7 ثواني بس من وقت كتابتها
  const t = now();
  return room.words.filter(w => t - w.at < WORD_SHOW_MS).map(w => {
    const who = nameOf(room, w.token);
    return { id: who.id, name: who.name, avatar: who.avatar, word: w.word, expiresIn: Math.max(0, WORD_SHOW_MS - (t - w.at)) };
  });
}

function viewFor(room, p) {
  const st = {
    t: 'state', serverNow: now(), code: room.code, phase: room.phase,
    settings: room.settings, net: NET,
    allCats: BANK.cats(),
    maxSpies: maxSpiesFor(connectedPlayers(room).length || room.players.size),
    gameRound: room.gameRound, totalGameRounds: room.settings.gameRounds,
    round: room.round, totalRounds: room.settings.rounds,
    players: allPlayers(room).map(x => ({ id: x.id, name: x.name, avatar: x.avatar, isHost: isHost(room, x),
      connected: x.connected, away: !!x.away, left: !!x.left, score: x.score })),
    you: { id: p.id, isHost: isHost(room, p), score: p.score },
  };
  const inGame = room.phase === 'play' || room.phase === 'vote' || room.phase === 'reveal';
  if (inGame) {
    st.cat = room.item ? BANK.catMeta(room.item.cat) : null;
    st.youAreSpy = room.spies.has(p.token);
    // الكلمة للأبرياء بس
    if (!st.youAreSpy && room.item) st.secret = room.item.title;
  }
  if (room.phase === 'play') {
    st.turnOrderIds = room.turnOrder.map(t => (room.players.get(t) || {}).id).filter(Boolean);
    const curTok = room.turnOrder[room.turnIdx];
    const cur = curTok ? nameOf(room, curTok) : null;
    st.current = cur ? { id: cur.id, name: cur.name, avatar: cur.avatar } : null;
    st.yourTurn = curTok === p.token;
    st.turnDeadline = room.turnDeadline;
    st.wordsShown = publicWords(room, p);
    st.wordsCount = room.words.length;
    st.turnInRound = room.turnIdx + 1;
    st.turnsPerRound = room.turnOrder.length;
    st.maxWordChars = MAX_WORD_CHARS;
    st.wordShowMs = WORD_SHOW_MS;
  }
  if (room.phase === 'vote') {
    st.spyCountHidden = room.settings.spyMode === 'random';
    st.spyCount = room.settings.spyMode === 'random' ? null : room.spyCountActual;
    st.picksNeeded = room.spyCountActual;
    st.youVoted = room.votes.has(p.token);
    st.yourVotes = room.votes.get(p.token) || [];
    st.votedCount = [...room.votes.keys()].filter(t => room.players.has(t)).length;
    st.voteTotal = connectedPlayers(room).filter(x => !room.spies.has(x.token)).length;
    st.candidates = activePlayers(room).filter(x => x.token !== p.token).map(x => ({ id: x.id, name: x.name, avatar: x.avatar }));
  }
  if (room.phase === 'reveal') {
    st.result = room.lastResult;
    st.guessOpen = !!room.guessOpen;
    st.youAreSpy = room.spies.has(p.token);
    st.youGuessed = room.spyGuesses.has(p.token);
    st.spyGuessCount = room.spyGuesses.size;
    st.spyTotal = [...room.spies].filter(t => { const q = room.players.get(t); return q && q.connected; }).length;
    st.readyIds = [...room.readyNext].map(t => (room.players.get(t) || {}).id).filter(Boolean);
    st.youReady = room.readyNext.has(p.token);
    st.isLastRound = room.gameRound >= room.settings.gameRounds;
  }
  if (room.phase === 'gameover') st.results = room.results;
  return st;
}
function broadcast(room) { room.lastActivity = now(); for (const p of allPlayers(room)) if (p.res) sseSend(p.res, viewFor(room, p)); }

/* ============ سير اللعبة ============ */
function clearTurnTimer(room) { if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; } room.turnDeadline = null; }

function startGame(room) {
  room.gameRound = 0;
  room.roundResults = [];
  room.usedItems = room.usedItems || new Set();
  for (const p of allPlayers(room)) { p.score = 0; p.stat = { caught: 0, escaped: 0, wordsGuessed: 0, spyTimes: 0, caughtAsSpy: 0 }; }
  startMiniGame(room);
}

// جولة جديدة (جيم كامل) — جاسوس عشوائي جديد وكلمة جديدة، والنقط تراكمية
function startMiniGame(room) {
  clearTurnTimer(room);
  room.gameRound++;
  if (room.gameRound > room.settings.gameRounds) return finishGame(room);
  room.round = 0;
  room.words = [];
  room.votes = new Map();
  room.spyGuesses = new Map();
  room.readyNext = new Set();
  room.guessOpen = false;
  room.item = pickItem(room);
  if (room.item) room.usedItems.add(room.item.id);
  chooseSpies(room);
  startRound(room);
}

function chooseSpies(room) {
  const pool = connectedPlayers(room).map(p => p.token);
  const maxAllowed = maxSpiesFor(pool.length);
  let n;
  if (room.settings.spyMode === 'random') n = 1 + Math.floor(Math.random() * maxAllowed);
  else n = Math.min(room.settings.spyCount, maxAllowed);
  n = Math.max(1, Math.min(n, maxAllowed, pool.length - 1));
  room.spies = new Set(shuffle(pool).slice(0, n));
  room.spyCountActual = n;
  for (const t of room.spies) { const p = room.players.get(t); if (p) p.stat.spyTimes++; }
}

function buildTurnOrder(room) {
  // الترتيب بيتخلط كل جولة — والجاسوس عمره ما ييجي أول واحد
  const pool = connectedPlayers(room).map(p => p.token);
  for (let attempt = 0; attempt < 60; attempt++) {
    const o = shuffle(pool);
    if (o.length && !room.spies.has(o[0])) { room.turnOrder = o; return; }
  }
  // احتياطي: لو كل المتصلين جواسيس (نادر جدًا) — نسيب الترتيب زي ما هو
  room.turnOrder = shuffle(pool);
}

function startRound(room) {
  clearTurnTimer(room);
  room.round++;
  if (room.round > room.settings.rounds) return startVote(room);
  buildTurnOrder(room);
  room.turnIdx = 0;
  room.phase = 'play';
  armTurn(room);
  broadcast(room);
}

function armTurn(room) {
  clearTurnTimer(room);
  if (room.settings.turnTime > 0) {
    room.turnDeadline = now() + room.settings.turnTime * 1000;
    room.turnTimer = setTimeout(() => { room.turnTimer = null; skipTurn(room); }, room.settings.turnTime * 1000 + 200);
  }
}

function skipTurn(room) {
  if (room.phase !== 'play') return;
  const tok = room.turnOrder[room.turnIdx];
  if (tok) room.words.push({ token: tok, word: '— عدّى دوره ⏰', round: room.round, at: now(), skipped: true });
  advanceTurn(room);
}

function advanceTurn(room) {
  room.turnIdx++;
  if (room.turnIdx >= room.turnOrder.length) {
    // خلصت اللفة
    if (room.round >= room.settings.rounds) { startVote(room); return; }
    startRound(room);
    return;
  }
  armTurn(room);
  broadcast(room);
}

function startVote(room) {
  clearTurnTimer(room);
  room.votes = new Map();
  room.phase = 'vote';
  broadcast(room);
}

function maybeCloseVote(room) {
  if (room.phase !== 'vote') return;
  const voters = connectedPlayers(room).filter(x => !room.spies.has(x.token));
  if (voters.length && voters.every(x => room.votes.has(x.token))) startReveal(room);
}

// كشف النتيجة أول (مين الجاسوس + مين قفشه + نقط الهروب) — التخمين بيتفتح بعدها
function startReveal(room) {
  if (room.phase !== 'vote') return;
  clearTurnTimer(room);
  const spyList = [...room.spies];
  const voters = activePlayers(room).filter(x => !room.spies.has(x.token));

  const voterRows = [];
  for (const v of voters) {
    const picks = room.votes.get(v.token) || [];
    const pickedTokens = picks.map(id => (activePlayers(room).find(x => x.id === id) || {}).token).filter(Boolean);
    const correct = pickedTokens.filter(t => room.spies.has(t));
    v.score += correct.length * 100;
    v.stat.caught += correct.length;
    voterRows.push({ name: v.name, avatar: v.avatar, picked: pickedTokens.map(t => nameOf(room, t).name), correctCount: correct.length, gained: correct.length * 100 });
  }

  const spyRows = [];
  for (const stok of spyList) {
    const sp = room.players.get(stok);
    const spyName = nameOf(room, stok);
    const caughtBy = voters.filter(v => (room.votes.get(v.token) || []).some(id => (activePlayers(room).find(x => x.id === id) || {}).token === stok));
    let escapePts = 0;
    if (voters.length) { if (caughtBy.length === 0) escapePts = 100; else if (caughtBy.length < voters.length) escapePts = 50; }
    if (sp) { sp.score += escapePts; if (caughtBy.length === 0) sp.stat.escaped++; if (caughtBy.length > 0) sp.stat.caughtAsSpy++; }
    spyRows.push({ name: spyName.name, avatar: spyName.avatar, caughtByCount: caughtBy.length, votersCount: voters.length, caughtByNames: caughtBy.map(v => v.name), escapePoints: escapePts, guess: null, guessedRight: false, wordPoints: 0, total: escapePts });
  }

  const nspy = spyList.length;
  const spyMsg = nspy >= 2
    ? `أوبس! كان فيه ${nspy === 2 ? 'جاسوسين' : nspy + ' جواسيس'} 😱 قفشتوهم كلهم ولا فلتوا؟`
    : 'كان فيه جاسوس واحد بس 🕵️ اتقفش ولا فلت؟';

  room.lastResult = {
    secret: room.item ? room.item.title : '',
    cat: room.item ? BANK.catMeta(room.item.cat) : null,
    spyCount: nspy, spyMsg, spies: spyRows, voters: voterRows,
    words: room.words.map(w => { const who = nameOf(room, w.token); return { name: who.name, avatar: who.avatar, word: w.word, wasSpy: room.spies.has(w.token) }; }),
    guessDone: false,
  };
  room.spyGuesses = new Map();
  const liveSpies = spyList.filter(t => { const q = room.players.get(t); return q && q.connected; });
  room.guessOpen = liveSpies.length > 0;
  room.readyNext = new Set();
  room.phase = 'reveal';
  broadcast(room);
  if (!room.guessOpen) finalizeGuess(room);
}

function maybeCloseGuess(room) {
  if (room.phase !== 'reveal' || !room.guessOpen) return;
  const liveSpies = [...room.spies].filter(t => { const q = room.players.get(t); return q && q.connected; });
  if (!liveSpies.length || liveSpies.every(t => room.spyGuesses.has(t))) finalizeGuess(room);
}

// بعد ما الجواسيس يخمنوا الكلمة — بونس التخمين وتحديث النتيجة
function finalizeGuess(room) {
  if (!room.lastResult) return;
  const spyList = [...room.spies];
  for (let i = 0; i < spyList.length; i++) {
    const stok = spyList[i];
    const sp = room.players.get(stok);
    const guess = room.spyGuesses.get(stok) || null;
    const guessedRight = !!(guess && room.item && BANK.isMatch(room.item, guess));
    const wordPts = guessedRight ? 100 : 0;
    if (sp && guessedRight) { sp.score += wordPts; sp.stat.wordsGuessed++; }
    const row = room.lastResult.spies[i];
    if (row) { row.guess = guess; row.guessedRight = guessedRight; row.wordPoints = wordPts; row.total = row.escapePoints + wordPts; }
  }
  room.guessOpen = false;
  room.lastResult.guessDone = true;
  room.roundResults = room.roundResults || [];
  room.roundResults.push(room.lastResult);
  room.readyNext = new Set();
  broadcast(room);
}

function maybeAdvance(room) {
  if (room.phase !== 'reveal' || room.guessOpen) return;
  const conn = connectedPlayers(room);
  if (conn.length && conn.every(p => room.readyNext.has(p.token))) advanceMiniGame(room);
}
function advanceMiniGame(room) {
  if (room.gameRound >= room.settings.gameRounds) finishGame(room);
  else startMiniGame(room);
}

function finishGame(room) {
  clearTurnTimer(room);
  const players = allPlayers(room);
  const ranking = players.slice().sort((a, b) => b.score - a.score).map((p, i) => ({
    rank: i + 1, id: p.id, name: p.name, avatar: p.avatar, score: p.score,
    caught: p.stat.caught, escaped: p.stat.escaped, connected: p.connected, left: !!p.left,
  }));
  const awards = [];
  if (ranking.length) awards.push({ icon: '🏆', title: 'بطل اللمّة', who: ranking[0].name, detail: ranking[0].score + ' نقطة' });
  let bestDetective = null;
  for (const p of players) if (!bestDetective || p.stat.caught > bestDetective.stat.caught) bestDetective = p;
  if (bestDetective && bestDetective.stat.caught > 0) awards.push({ icon: '🔍', title: 'المخبر', who: bestDetective.name, detail: `قفش ${bestDetective.stat.caught} جاسوس` });
  let bestSpy = null;
  for (const p of players) if (p.stat.spyTimes > 0 && (!bestSpy || p.stat.escaped > bestSpy.stat.escaped)) bestSpy = p;
  if (bestSpy && bestSpy.stat.escaped > 0) awards.push({ icon: '🕵️', title: 'الجاسوس المحترف', who: bestSpy.name, detail: `فلت ${bestSpy.stat.escaped} مرة` });
  let mostGuessed = null;
  for (const p of players) if (p.stat.wordsGuessed > 0 && (!mostGuessed || p.stat.wordsGuessed > mostGuessed.stat.wordsGuessed)) mostGuessed = p;
  if (mostGuessed) awards.push({ icon: '🎯', title: 'قارئ الأفكار', who: mostGuessed.name, detail: `خمّن الكلمة ${mostGuessed.stat.wordsGuessed} مرة وهو جاسوس` });
  let mostCaughtSpy = null;
  for (const p of players) if (p.stat.caughtAsSpy > 0 && (!mostCaughtSpy || p.stat.caughtAsSpy > mostCaughtSpy.stat.caughtAsSpy)) mostCaughtSpy = p;
  if (mostCaughtSpy) awards.push({ icon: '🥴', title: 'الجاسوس الفاشوش', who: mostCaughtSpy.name, detail: `اتقفش ${mostCaughtSpy.stat.caughtAsSpy} مرة` });
  room.results = { ranking, awards, review: (room.roundResults || []).slice() };
  room.phase = 'gameover';
  broadcast(room);
}

function playAgain(room) {
  for (const tok of [...room.order]) {
    const p = room.players.get(tok);
    if (!p || !p.connected) { if (p) room.ghosts.set(tok, { name: p.name, avatar: p.avatar }); room.players.delete(tok); room.order = room.order.filter(t => t !== tok); }
  }
  if (!room.players.has(room.hostToken)) room.hostToken = room.order[0] || null;
  for (const p of allPlayers(room)) { p.score = 0; p.left = false; p.away = false; p.stat = { caught: 0, escaped: 0, wordsGuessed: 0, spyTimes: 0 }; }
  clearTurnTimer(room);
  room.gameRound = 0; room.round = 0; room.words = []; room.spies = new Set(); room.item = null; room.roundResults = []; room.guessOpen = false;
  room.votes = new Map(); room.spyGuesses = new Map(); room.results = null; room.lastResult = null;
  room.phase = 'lobby';
  broadcast(room);
}

function recheckGates(room) {
  if (room.phase === 'play') {
    const curTok = room.turnOrder[room.turnIdx];
    const cur = curTok ? room.players.get(curTok) : null;
    if (!cur || !cur.connected) skipTurn(room);
  }
  if (room.phase === 'vote') maybeCloseVote(room);
  if (room.phase === 'reveal') { maybeCloseGuess(room); maybeAdvance(room); }
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
  room.readyNext.delete(p.token); room.votes.delete(p.token); room.spyGuesses.delete(p.token);
  if (room.hostToken === p.token) migrateHost(room);
  if (!room.players.size) { destroyRoom(room); return; }
  recheckGates(room);
  broadcast(room);
}
function migrateHost(room) { const conn = connectedPlayers(room); room.hostToken = (conn[0] || allPlayers(room)[0] || {}).token || null; }
function destroyRoom(room) { clearTurnTimer(room); rooms.delete(room.code); }

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
  id: 'jasoos',
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
      const rr = parseInt(s.rounds, 10); if (Number.isInteger(rr) && rr >= 2 && rr <= 6) room.settings.rounds = rr;
      const gr = parseInt(s.gameRounds, 10); if (Number.isInteger(gr) && gr >= 1 && gr <= 10) room.settings.gameRounds = gr;
      if (s.spyMode === 'random' || s.spyMode === 'fixed') room.settings.spyMode = s.spyMode;
      const sc = parseInt(s.spyCount, 10);
      if (Number.isInteger(sc) && sc >= 1 && sc <= 3) room.settings.spyCount = Math.min(sc, maxSpiesFor(room.players.size));
      const tt = parseInt(s.turnTime, 10); if (tt === 0 || tt === 10 || tt === 20 || tt === 30) room.settings.turnTime = tt;
      broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'startGame') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس اللي يبدأ' });
      if (room.phase !== 'lobby') return R(400, { ok: false, error: 'مش في اللوبي' });
      const n = connectedPlayers(room).length;
      if (n < MIN_PLAYERS) return R(400, { ok: false, error: `محتاجين ${MIN_PLAYERS} على الأقل` });
      if (room.settings.spyMode === 'fixed' && room.settings.spyCount > maxSpiesFor(n))
        return R(400, { ok: false, error: `بعدد اللاعيبة ده أقصى عدد جواسيس ${maxSpiesFor(n)}` });
      startGame(room);
      return R(200, { ok: true });
    }
    if (A === 'sayWord') {
      if (room.phase !== 'play') return R(400, { ok: false, error: 'مش وقت الكلمات' });
      const curTok = room.turnOrder[room.turnIdx];
      if (curTok !== p.token) return R(400, { ok: false, error: 'مش دورك دلوقتي ⏳' });
      const w = clampStr(b.word, MAX_WORD_CHARS + 4);
      if (!w) return R(400, { ok: false, error: 'اكتب كلمة' });
      if (/\s/.test(w)) return R(400, { ok: false, error: 'كلمة واحدة بس — من غير مسافات' });
      if (w.length > MAX_WORD_CHARS) return R(400, { ok: false, error: `الكلمة طويلة أوي — أقصى ${MAX_WORD_CHARS} حرف` });
      if (room.item && BANK.leaksSecret(room.item, w)) return R(400, { ok: false, error: 'مينفعش تكتب الكلمة نفسها أو حاجة قريبة منها! 😅' });
      for (const prev of room.words) if (!prev.skipped && BANK.sameWord(prev.word, w)) return R(400, { ok: false, error: 'الكلمة دي اتقالت قبل كده — هات غيرها' });
      room.words.push({ token: p.token, word: w, round: room.round, at: now() });
      advanceTurn(room);
      if (room.phase === 'play') broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'vote') {
      if (room.phase !== 'vote') return R(400, { ok: false, error: 'مش وقت التصويت' });
      if (room.spies.has(p.token)) return R(400, { ok: false, error: 'انت الجاسوس 🤫 مثّل إنك بتصوّت' });
      const ids = Array.isArray(b.playerIds) ? [...new Set(b.playerIds.map(String))] : [];
      if (ids.length !== room.spyCountActual) return R(400, { ok: false, error: `اختار ${room.spyCountActual} ${room.spyCountActual === 1 ? 'لاعب' : 'لاعيبة'}` });
      for (const id of ids) { const t = byId(room, id); if (!t || t.token === p.token) return R(400, { ok: false, error: 'اختيار غلط' }); }
      room.votes.set(p.token, ids);
      broadcast(room);
      maybeCloseVote(room);
      return R(200, { ok: true });
    }
    if (A === 'spyGuess') {
      if (room.phase !== 'reveal' || !room.guessOpen) return R(400, { ok: false, error: 'مش وقتها' });
      if (!room.spies.has(p.token)) return R(400, { ok: false, error: 'انت مش الجاسوس' });
      const g = clampStr(b.text, 60);
      if (!g) return R(400, { ok: false, error: 'اكتب تخمينك' });
      room.spyGuesses.set(p.token, g);
      broadcast(room);
      maybeCloseGuess(room);
      return R(200, { ok: true });
    }
    if (A === 'readyNext') {
      if (room.phase !== 'reveal' || room.guessOpen) return R(400, { ok: false, error: 'مش وقتها — الجاسوس لسه بيخمن' });
      room.readyNext.add(p.token);
      maybeAdvance(room);
      if (room.phase === 'reveal') broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'forceNext') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس' });
      if (room.phase === 'play') skipTurn(room);
      else if (room.phase === 'vote') startReveal(room);
      else if (room.phase === 'reveal') { if (room.guessOpen) finalizeGuess(room); else advanceMiniGame(room); }
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
      // تحديث دوري وقت اللعب عشان الكلمات تختفي عند الكل
      if (room.phase === 'play' && room.words.length) broadcast(room);
      if (connectedPlayers(room).length === 0 && now() - room.lastActivity > ROOM_TTL_MS) destroyRoom(room);
    }
  },
};
