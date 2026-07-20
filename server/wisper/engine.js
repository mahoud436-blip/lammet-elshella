/* حبر سري — محرك اللعبة (موديول)
   النظام: الهوست بيحدد عدد جولات كل نوع بس (✍️ كتابة لاعب / 🗳️ تصويت / 🎲 عشوائي)
   وبعدها كل حاجة أوتوماتيك: الترتيب متخلط، كاتب العنوان بيتاخد بالعدل عشوائيًا،
   الكل يجاوب → التخمين يبدأ، الكل يخلص تخمين → النتيجة، الكل يدوس التالي → الجولة الجاية. */
'use strict';
const crypto = require('crypto');
const TOPICS = require('./topics');

const HOST_GRACE_MS = parseInt(process.env.HOST_GRACE_MS || '45000', 10);
const ROOM_TTL_MS = parseInt(process.env.ROOM_TTL_MS || String(90 * 60 * 1000), 10);
const MAX_ROOMS = 300;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 15;
const VOTE_SECONDS = 45;
const TOPIC_SECONDS = 90;
const AVATARS = ['😂','🤣','😆','😄','😁','😜','🤪','😝','🥳','🙃','😅','🤭','😛','😋','🤩','😎','🤠','🥸','🤡','😺','😹','👽','🤖','👻'];

let NET = { ips: [], port: 3000, hosted: false };
const now = () => Date.now();
const rid = () => crypto.randomBytes(16).toString('hex');
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function clampStr(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max); }

const rooms = new Map();
let playerSeq = 0;

function makeCode() { for (let i = 0; i < 50; i++) { const c = String(1000 + Math.floor(Math.random() * 9000)); if (!rooms.has(c)) return c; } return null; }

function createRoom() {
  const code = makeCode();
  if (!code) return null;
  const room = {
    code, createdAt: now(), lastActivity: now(),
    phase: 'lobby', // lobby | topic | vote | write | guess | reveal | gameover
    settings: { writerRounds: 1, voteRounds: 1, randomRounds: 1 },
    hostToken: null, players: new Map(), order: [], ghosts: new Map(),
    topicsConsumed: new Set(),          // عناوين اتلعبت في الروم ده (متتكررش حتى في "نلعب تاني")
    plan: [], roundIdx: 0,
    topic: '', topicBy: null, topicSource: null, suggestions: [],
    voteOptions: [], votes: new Map(), voteDeadline: null, voteTimer: null,
    guessIdx: 0,
    topicDeadline: null, topicTimer: null,
    writeSet: new Map(),
    answers: [], guesses: new Map(),    // token -> Map(answerId -> ownerToken)
    readyNext: new Set(),
    lastReveal: null,
    roundHistory: [],
    results: null,
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, name, avatar) {
  const token = rid();
  const p = { token, id: 'w' + (++playerSeq), name, avatar, connected: false, lastSeen: now(), res: null,
    score: 0, left: false, stat: { correct: 0, myAnswersGuessed: 0, myAnswersChances: 0, answers: 0 } };
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
function totalRounds(s) { return (s.writerRounds || 0) + (s.voteRounds || 0) + (s.randomRounds || 0); }

/* ============ عناوين ============ */
function freeTopicIdxs(room) { const out = []; for (let i = 0; i < TOPICS.length; i++) if (!room.topicsConsumed.has(i)) out.push(i); return out; }
function pickTopicIdx(room) { const pool = freeTopicIdxs(room); if (!pool.length) return -1; return pool[Math.floor(Math.random() * pool.length)]; }
function consumeTopicText(room, text) { const i = TOPICS.indexOf(text); if (i >= 0) room.topicsConsumed.add(i); }

/* ============ SSE ============ */
function sseSend(res, obj) { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} }
function viewFor(room, p) {
  const st = {
    t: 'state', serverNow: now(), code: room.code, phase: room.phase,
    settings: room.settings, net: NET,
    round: room.roundIdx + 1, totalRounds: room.plan.length || totalRounds(room.settings),
    roundType: room.plan[room.roundIdx] ? room.plan[room.roundIdx].type : null,
    topic: (room.phase === 'write' || room.phase === 'guess' || room.phase === 'reveal') ? room.topic : '',
    topicSource: room.topicSource,
    topicByName: null,
    players: allPlayers(room).map(x => ({ id: x.id, name: x.name, avatar: x.avatar, isHost: isHost(room, x),
      connected: x.connected, left: !!x.left, score: x.score })),
    you: { id: p.id, isHost: isHost(room, p), score: p.score },
  };
  if (room.phase === 'topic') {
    st.youAreWriter = room.topicBy === p.token;
    st.deadline = room.topicDeadline;
    if (st.youAreWriter) st.suggestions = room.suggestions;
  }
  if (room.phase === 'vote') {
    st.voteOptions = room.voteOptions.map(i => TOPICS[i]);
    st.deadline = room.voteDeadline;
    st.yourVote = room.votes.has(p.token) ? room.votes.get(p.token) : null;
    st.votedIds = [...room.votes.keys()].map(t => (room.players.get(t) || {}).id).filter(Boolean);
    st.votedCount = [...room.votes.keys()].filter(t => room.players.has(t)).length;
  }
  if (room.phase === 'write') {
    st.yourAnswer = room.writeSet.has(p.token) ? room.writeSet.get(p.token) : null;
    st.submittedIds = [...room.writeSet.keys()].map(t => (room.players.get(t) || {}).id).filter(Boolean);
  }
  if (room.phase === 'guess') {
    const mine = room.guesses.get(p.token) || new Map();
    const cur = room.answers[room.guessIdx];
    st.gi = room.guessIdx;
    st.gTotal = room.answers.length;
    st.current = cur ? { id: cur.id, text: cur.text, isYours: cur.owner === p.token } : null;
    st.roster = room.answers.map(a => nameOf(room, a.owner)).filter(w => w.id !== p.id)
      .map(w => ({ id: w.id, name: w.name, avatar: w.avatar }));
    st.yourGuesses = {};
    for (const [aid, tok] of mine) { const w = nameOf(room, tok); st.yourGuesses[aid] = w.id; }
    st.yourPick = cur && mine.has(cur.id) ? (nameOf(room, mine.get(cur.id)) || {}).id : null;
    st.pickedIds = cur ? allPlayers(room).filter(x => x.token !== cur.owner && (room.guesses.get(x.token) || new Map()).has(cur.id)).map(x => x.id) : [];
    st.eligibleCount = cur ? allPlayers(room).filter(x => x.token !== cur.owner).length : 0;
    st.needCount = room.answers.filter(a => a.owner !== p.token).length;
  }
  if (room.phase === 'reveal') {
    st.reveal = room.lastReveal;
    st.readyIds = [...room.readyNext].map(t => (room.players.get(t) || {}).id).filter(Boolean);
    st.youReady = room.readyNext.has(p.token);
    st.isLastRound = room.roundIdx + 1 >= room.plan.length;
  }
  if (room.phase === 'gameover') st.results = room.results;
  return st;
}
function broadcast(room) { room.lastActivity = now(); for (const p of allPlayers(room)) if (p.res) sseSend(p.res, viewFor(room, p)); }

/* ============ سير اللعبة ============ */
function clearTimers(room) {
  if (room.voteTimer) { clearTimeout(room.voteTimer); room.voteTimer = null; }
  if (room.topicTimer) { clearTimeout(room.topicTimer); room.topicTimer = null; }
  room.voteDeadline = null; room.topicDeadline = null;
}

function buildPlan(room) {
  const s = room.settings;
  const types = [];
  for (let i = 0; i < s.writerRounds; i++) types.push('writer');
  for (let i = 0; i < s.voteRounds; i++) types.push('vote');
  for (let i = 0; i < s.randomRounds; i++) types.push('random');
  const plan = shuffle(types).map(type => ({ type, writer: null }));
  // توزيع كتابة العنوان بالعدل: دورة عشوائية على اللاعيبة
  const cycle = shuffle(room.order.slice());
  let ci = 0;
  for (const r of plan) if (r.type === 'writer') { r.writer = cycle[ci % cycle.length]; ci++; }
  room.plan = plan;
}

function startGame(room) {
  buildPlan(room);
  room.roundIdx = 0;
  room.roundHistory = [];
  for (const p of allPlayers(room)) { p.score = 0; p.stat = { correct: 0, myAnswersGuessed: 0, myAnswersChances: 0, answers: 0 }; }
  startRound(room);
}

function startRound(room) {
  clearTimers(room);
  room.topic = ''; room.topicBy = null; room.topicSource = null; room.suggestions = [];
  room.voteOptions = []; room.votes = new Map();
  room.writeSet = new Map(); room.answers = []; room.guesses = new Map();
  room.guessIdx = 0;
  room.readyNext = new Set(); room.lastReveal = null;
  const r = room.plan[room.roundIdx];
  if (!r) return finishGame(room);
  if (r.type === 'random') {
    const i = pickTopicIdx(room);
    if (i < 0) { r.type = 'writer'; } // البنك خلص (بعيد) → حوّلها كتابة
    else {
      room.topicsConsumed.add(i);
      room.topic = TOPICS[i];
      room.topicSource = 'random';
      room.phase = 'write';
      return broadcast(room);
    }
  }
  if (r.type === 'vote') {
    const pool = shuffle(freeTopicIdxs(room));
    if (pool.length < 3) { r.type = 'writer'; }
    else {
      room.voteOptions = pool.slice(0, 3);
      room.phase = 'vote';
      room.voteDeadline = now() + VOTE_SECONDS * 1000;
      room.voteTimer = setTimeout(() => { room.voteTimer = null; closeVote(room); }, VOTE_SECONDS * 1000 + 200);
      return broadcast(room);
    }
  }
  // writer
  let writer = room.players.get(r.writer);
  if (!writer || !writer.connected) {
    const conn = connectedPlayers(room);
    writer = conn.length ? conn[Math.floor(Math.random() * conn.length)] : allPlayers(room)[0];
  }
  if (!writer) return; // روم فاضي
  room.topicBy = writer.token;
  room.topicSource = 'writer';
  room.suggestions = shuffle(freeTopicIdxs(room)).slice(0, 6).map(i => TOPICS[i]);
  room.phase = 'topic';
  room.topicDeadline = now() + TOPIC_SECONDS * 1000;
  room.topicTimer = setTimeout(() => { room.topicTimer = null; fallbackRandomTopic(room); }, TOPIC_SECONDS * 1000 + 200);
  broadcast(room);
}

function fallbackRandomTopic(room) {
  if (room.phase !== 'topic') return;
  clearTimers(room);
  const i = pickTopicIdx(room);
  room.topic = i >= 0 ? TOPICS[i] : 'أكتر حاجة نفسك تعملها مع الشلة';
  if (i >= 0) room.topicsConsumed.add(i);
  room.topicSource = 'random';
  room.phase = 'write';
  broadcast(room);
}

function closeVote(room) {
  if (room.phase !== 'vote') return;
  clearTimers(room);
  const counts = [0, 0, 0];
  for (const [tok, v] of room.votes) if (room.players.has(tok) && v >= 0 && v <= 2) counts[v]++;
  const max = Math.max(...counts);
  let winners = [0, 1, 2].filter(i => counts[i] === max);
  if (max === 0) winners = [0, 1, 2];
  const wi = winners[Math.floor(Math.random() * winners.length)]; // التعادل بالقرعة مش أول واحد
  const topicIdx = room.voteOptions[wi];
  room.topicsConsumed.add(topicIdx);
  room.topic = TOPICS[topicIdx];
  room.topicSource = 'vote';
  room.phase = 'write';
  broadcast(room);
}

function maybeCloseVote(room) {
  if (room.phase !== 'vote') return;
  const conn = connectedPlayers(room);
  if (conn.length && conn.every(p => room.votes.has(p.token))) closeVote(room);
}

function maybeStartGuess(room) {
  if (room.phase !== 'write') return;
  const conn = connectedPlayers(room);
  if (conn.length && conn.every(p => room.writeSet.has(p.token)) && room.writeSet.size >= 2) startGuess(room);
}

function startGuess(room) {
  if (room.phase !== 'write') return;
  const entries = shuffle([...room.writeSet.entries()]);
  room.answers = entries.map(([owner, text], i) => ({ id: 'a' + i, owner, text }));
  room.guesses = new Map();
  room.guessIdx = 0;
  for (const [owner] of entries) { const p = room.players.get(owner); if (p) p.stat.answers++; }
  room.phase = 'guess';
  broadcast(room);
}

function maybeReveal(room) {
  if (room.phase !== 'guess') return;
  const cur = room.answers[room.guessIdx];
  if (!cur) { scoreAndReveal(room); return; }
  const eligible = connectedPlayers(room).filter(p => p.token !== cur.owner);
  const allPicked = eligible.every(p => (room.guesses.get(p.token) || new Map()).has(cur.id));
  if (!allPicked) return;
  advanceGuess(room);
}
function advanceGuess(room) {
  if (room.phase !== 'guess') return;
  room.guessIdx++;
  if (room.guessIdx >= room.answers.length) scoreAndReveal(room);
  else broadcast(room);
}

function scoreAndReveal(room) {
  if (room.phase !== 'guess') return;
  const gains = new Map();
  const answersOut = room.answers.map(a => {
    const owner = nameOf(room, a.owner);
    const picks = [];
    for (const [gTok, gMap] of room.guesses) {
      if (gTok === a.owner) continue;
      if (!gMap.has(a.id)) continue;
      const pickTok = gMap.get(a.id);
      const ok = pickTok === a.owner;
      const g = room.players.get(gTok);
      const who = nameOf(room, gTok);
      const pickWho = nameOf(room, pickTok);
      if (ok && g) { g.score += 100; g.stat.correct++; gains.set(gTok, (gains.get(gTok) || 0) + 100); }
      if (g) { g.stat.myAnswersChances += 0; }
      const ownerP = room.players.get(a.owner);
      if (ownerP) { ownerP.stat.myAnswersChances++; if (ok) ownerP.stat.myAnswersGuessed++; }
      picks.push({ name: who.name, avatar: who.avatar, pickName: pickWho.name, pickAvatar: pickWho.avatar, ok });
    }
    return { id: a.id, text: a.text, ownerName: owner.name, ownerAvatar: owner.avatar, picks };
  });
  const yourGainById = {};
  for (const [tok, g] of gains) { const w = nameOf(room, tok); if (w.id !== 'ghost') yourGainById[w.id] = g; }
  room.lastReveal = {
    topic: room.topic, topicSource: room.topicSource,
    topicByName: null,
    answers: answersOut, gains: yourGainById,
  };
  room.roundHistory.push({
    round: room.roundIdx + 1, topic: room.topic, source: room.topicSource,
    byName: null,
    answers: answersOut,
  });
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
  clearTimers(room);
  const players = allPlayers(room);
  const ranking = players.slice().sort((a, b) => b.score - a.score).map((p, i) => ({
    rank: i + 1, id: p.id, name: p.name, avatar: p.avatar, score: p.score,
    correct: p.stat.correct, connected: p.connected, left: !!p.left,
  }));
  const awards = [];
  if (ranking.length) awards.push({ icon: '🏆', title: 'بطل اللمّة', who: ranking[0].name, detail: ranking[0].score + ' نقطة' });
  let sleuth = null;
  for (const p of players) if (!sleuth || p.stat.correct > sleuth.stat.correct) sleuth = p;
  if (sleuth && sleuth.stat.correct > 0) awards.push({ icon: '🕵️', title: 'المخبر', who: sleuth.name, detail: `خمّن صح ${sleuth.stat.correct} مرة` });
  let ink = null, open = null;
  for (const p of players) {
    if (p.stat.myAnswersChances >= 2) {
      const rate = p.stat.myAnswersGuessed / p.stat.myAnswersChances;
      if (!ink || rate < ink.rate) ink = { p, rate };
      if (!open || rate > open.rate) open = { p, rate };
    }
  }
  if (ink) awards.push({ icon: '🎭', title: 'الحبر السري', who: ink.p.name, detail: `محدش عرفه غير ${ink.p.stat.myAnswersGuessed} من ${ink.p.stat.myAnswersChances}` });
  if (open && (!ink || open.p.token !== ink.p.token)) awards.push({ icon: '📖', title: 'الكتاب المفتوح', who: open.p.name, detail: `اتعرف ${open.p.stat.myAnswersGuessed} من ${open.p.stat.myAnswersChances}` });
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
  for (const p of allPlayers(room)) { p.score = 0; p.stat = { correct: 0, myAnswersGuessed: 0, myAnswersChances: 0, answers: 0 }; }
  clearTimers(room);
  room.plan = []; room.roundIdx = 0; room.roundHistory = []; room.results = null;
  room.topic = ''; room.topicBy = null; room.answers = []; room.writeSet = new Map(); room.guesses = new Map();
  room.phase = 'lobby';
  broadcast(room);
}

function recheckGates(room) {
  if (room.phase === 'topic' && room.topicBy) {
    const w = room.players.get(room.topicBy);
    if (!w || !w.connected) {
      const conn = connectedPlayers(room);
      if (conn.length) {
        const nw = conn[Math.floor(Math.random() * conn.length)];
        room.topicBy = nw.token;
        room.suggestions = shuffle(freeTopicIdxs(room)).slice(0, 6).map(i => TOPICS[i]);
      }
    }
  }
  if (room.phase === 'vote') maybeCloseVote(room);
  if (room.phase === 'write') maybeStartGuess(room);
  if (room.phase === 'guess') maybeReveal(room);
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
  room.votes.delete(p.token);
  room.readyNext.delete(p.token);
  if (room.phase === 'write') room.writeSet.delete(p.token);
  room.guesses.delete(p.token);
  if (room.hostToken === p.token) migrateHost(room);
  if (!room.players.size) { destroyRoom(room); return; }
  // لو كاتب العنوان الحالي هو اللي خرج
  if (room.phase === 'topic' && room.topicBy === p.token) {
    const conn = connectedPlayers(room);
    if (conn.length) {
      const w = conn[Math.floor(Math.random() * conn.length)];
      room.topicBy = w.token;
      room.suggestions = shuffle(freeTopicIdxs(room)).slice(0, 6).map(i => TOPICS[i]);
    } else fallbackRandomTopic(room);
  }
  if (room.phase === 'vote') maybeCloseVote(room);
  if (room.phase === 'write') maybeStartGuess(room);
  if (room.phase === 'guess') maybeReveal(room);
  if (room.phase === 'reveal') maybeAdvance(room);
  broadcast(room);
}
function migrateHost(room) { const conn = connectedPlayers(room); room.hostToken = (conn[0] || allPlayers(room)[0] || {}).token || null; }
function destroyRoom(room) { clearTimers(room); rooms.delete(room.code); }

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
  id: 'wisper',
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
    if (room.players.size >= MAX_PLAYERS) return R(403, { ok: false, error: 'الروم مليان (' + MAX_PLAYERS + ' لاعب)' });
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
    p.res = res; p.connected = true; p.lastSeen = now(); p.left = false;
    broadcast(room);
    req.on('close', () => {
      if (p.res === res) { p.res = null; p.connected = false; p.lastSeen = now(); }
      if (!rooms.has(room.code)) return;
      if (room.hostToken === p.token) {
        setTimeout(() => {
          if (!rooms.has(room.code)) return;
          const hp = room.players.get(room.hostToken);
          if (hp && !hp.connected) { migrateHost(room); broadcast(room); }
        }, HOST_GRACE_MS);
      }
      if (room.phase === 'vote') maybeCloseVote(room);
      if (room.phase === 'write') maybeStartGuess(room);
      if (room.phase === 'guess') maybeReveal(room);
      if (room.phase === 'reveal') maybeAdvance(room);
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
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس اللي يظبط الجولات' });
      if (room.phase !== 'lobby') return R(400, { ok: false, error: 'الإعدادات في اللوبي بس' });
      const s = b.settings || {};
      for (const k of ['writerRounds', 'voteRounds', 'randomRounds']) {
        const v = parseInt(s[k], 10);
        if (Number.isInteger(v) && v >= 0 && v <= 10) room.settings[k] = v;
      }
      broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'startGame') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس اللي يبدأ' });
      if (room.phase !== 'lobby') return R(400, { ok: false, error: 'مش في اللوبي' });
      if (connectedPlayers(room).length < MIN_PLAYERS) return R(400, { ok: false, error: `محتاجين ${MIN_PLAYERS} على الأقل — التخمين بين اتنين مش لعبة 😄` });
      const tr = totalRounds(room.settings);
      if (tr < 1) return R(400, { ok: false, error: 'حدد جولة واحدة على الأقل' });
      if (tr > 15) return R(400, { ok: false, error: 'أقصى حاجة 15 جولة — هتناموا هنا؟ 😅' });
      startGame(room);
      return R(200, { ok: true });
    }
    if (A === 'submitTopic') {
      if (room.phase !== 'topic') return R(400, { ok: false, error: 'مش وقت كتابة العنوان' });
      if (room.topicBy !== p.token) return R(403, { ok: false, error: 'مش دورك المرة دي 🤫' });
      const text = clampStr(b.text, 80);
      if (text.length < 3) return R(400, { ok: false, error: 'اكتب عنوان أطول شوية' });
      clearTimers(room);
      room.topic = text;
      consumeTopicText(room, text);
      room.phase = 'write';
      broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'topicRandom') {
      if (room.phase !== 'topic') return R(400, { ok: false, error: 'مش وقتها' });
      if (room.topicBy !== p.token && !isHost(room, p)) return R(403, { ok: false, error: 'دي لكاتب العنوان أو الهوست' });
      fallbackRandomTopic(room);
      return R(200, { ok: true });
    }
    if (A === 'vote') {
      if (room.phase !== 'vote') return R(400, { ok: false, error: 'مش وقت التصويت' });
      const v = parseInt(b.choice, 10);
      if (!(Number.isInteger(v) && v >= 0 && v <= 2)) return R(400, { ok: false, error: 'اختيار غلط' });
      room.votes.set(p.token, v);
      maybeCloseVote(room);
      if (room.phase === 'vote') broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'submitAnswer') {
      if (room.phase !== 'write') return R(400, { ok: false, error: 'مش وقت الإجابة' });
      const text = clampStr(b.text, 140);
      if (!text) return R(400, { ok: false, error: 'اكتب إجابتك الأول' });
      const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
      for (const [tok, other] of room.writeSet) {
        if (tok === p.token) continue;
        if (other.toLowerCase().replace(/\s+/g, ' ').trim() === norm)
          return R(400, { ok: false, error: 'في حد كتب نفس الإجابة بالظبط! 😅 غيّر الصياغة شوية' });
      }
      room.writeSet.set(p.token, text); // ممكن يعدلها طول ما لسه في ناس بتكتب
      maybeStartGuess(room);
      if (room.phase === 'write') broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'guess') {
      if (room.phase !== 'guess') return R(400, { ok: false, error: 'مش وقت التخمين' });
      const ans = room.answers.find(a => a.id === String(b.answerId || ''));
      if (!ans) return R(400, { ok: false, error: 'إجابة مش موجودة' });
      const curA = room.answers[room.guessIdx];
      if (!curA || ans.id !== curA.id) return R(400, { ok: false, error: 'مش دور الإجابة دي' });
      if (ans.owner === p.token) return R(400, { ok: false, error: 'دي إجابتك انت 😉' });
      let mine = room.guesses.get(p.token);
      if (!mine) { mine = new Map(); room.guesses.set(p.token, mine); }
      if (b.playerId == null || b.playerId === '') { mine.delete(ans.id); broadcast(room); return R(200, { ok: true }); }
      const target = byId(room, b.playerId);
      const targetTok = target ? target.token : null;
      const validOwner = targetTok && room.answers.some(a => a.owner === targetTok);
      if (!validOwner) return R(400, { ok: false, error: 'اختار من أصحاب الإجابات' });
      if (targetTok === p.token) return R(400, { ok: false, error: 'مينفعش تختار نفسك' });
      for (const [aid, tok] of mine) if (aid !== ans.id && tok === targetTok) return R(400, { ok: false, error: 'استخدمت الاسم ده في إجابة تانية — كل اسم مرة واحدة' });
      mine.set(ans.id, targetTok);
      maybeReveal(room);
      if (room.phase === 'guess') broadcast(room);
      return R(200, { ok: true });
    }
    if (A === 'readyNext') {
      if (room.phase !== 'reveal') return R(400, { ok: false, error: 'مش وقتها' });
      room.readyNext.add(p.token);
      maybeAdvance(room);
      if (room.phase === 'reveal') broadcast(room);
      return R(200, { ok: true });
    }
    /* أزرار أمان للهوست (مش أساسية للسير — بس عشان حد نايم) */
    if (A === 'forceContinue') {
      if (!isHost(room, p)) return R(403, { ok: false, error: 'الهوست بس' });
      if (room.phase === 'vote') closeVote(room);
      else if (room.phase === 'topic') fallbackRandomTopic(room);
      else if (room.phase === 'write') { if (room.writeSet.size >= 2) startGuess(room); else return R(400, { ok: false, error: 'محتاجين إجابتين على الأقل' }); }
      else if (room.phase === 'guess') advanceGuess(room);
      else if (room.phase === 'reveal') advanceRound(room);
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
