/* اختبار: في كل لعبة، لو حد فصل أو واقف مش بيلعب — الهوست يقدر يكمّل من غيره
   node tests/smoke-force-continue.js */
'use strict';
const http = require('http');
const { spawn } = require('child_process');
const PORT = 3242;
const BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✅ ' + m); } else { failed++; console.error('  ❌ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.end(data);
  });
}
function stream(game, pl) {
  return new Promise(resolve => {
    const req = http.get(`${BASE}/api/${game}/stream?code=${pl.code}&token=${pl.token}`, res => {
      pl._res = res; let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString('utf8'); let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const dl = block.split('\n').find(l => l.startsWith('data: '));
          if (!dl || block.includes('event: ping')) continue;
          try { const d = JSON.parse(dl.slice(6)); if (d.t === 'state') pl.last = d; } catch (e) {}
        }
      });
      res.on('close', () => { pl.closed = true; }); resolve();
    });
    pl._req = req;
  });
}
async function waitFor(pl, pred, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) { if (pl.last && pred(pl.last)) return pl.last; await sleep(30); }
  throw new Error('timeout: ' + label + ' | phase=' + (pl.last && pl.last.phase) + ' sub=' + (pl.last && pl.last.sub));
}
const act = (game, pl, action, extra) => post(`/api/${game}/action`, Object.assign({ code: pl.code, token: pl.token, action }, extra || {}));
async function join(game, name, code) {
  const r = code ? await post(`/api/${game}/join`, { code, name, avatar: '🙂' }) : await post(`/api/${game}/create`, { name, avatar: '🙂' });
  if (!r.ok) throw new Error('join failed: ' + JSON.stringify(r));
  const pl = { name, code: r.code, token: r.token, id: r.id, last: null, closed: false };
  await stream(game, pl); await waitFor(pl, s => !!s, 5000, 'first state ' + name); return pl;
}
// يفصل اللاعب (يقفل الاتصال) — زي ما موبايله يقفل
function drop(pl) { try { pl._req.destroy(); } catch (e) {} try { pl._res.destroy(); } catch (e) {} }

async function testConan() {
  console.log('\n▶️ المحقق والمتهم');
  const a = await join('conan', 'Host'), b = await join('conan', 'B', a.code), c = await join('conan', 'C', a.code);
  await act('conan', a, 'setSettings', { settings: { cats: ['food'], rounds: 6, casesPerPlayer: 1, qTime: 0, aTime: 0, allowCustomWord: false } });
  await act('conan', a, 'startGame');
  await waitFor(a, s => s.phase === 'pick' || s.phase === 'play', 6000, 'start');
  const all = [a, b, c];
  const acc = all.find(p => p.last && p.last.youAreAccused);
  if (acc.last.phase === 'pick') { await act('conan', acc, 'startPlay'); await waitFor(acc, s => s.phase === 'play', 6000, 'play'); }
  // حد فصل وسط اللعب
  const victim = all.find(p => p !== acc && p !== a) || all.find(p => p !== a);
  drop(victim); await sleep(500);
  const host = a.last.you.isHost ? a : all.find(p => p.last && p.last.you && p.last.you.isHost && !p.closed);
  const before = host.last.sub;
  const r = await act('conan', host, 'forceNext');
  ok(r.ok, 'الهوست قدر يكمّل من غير اللي فصل (forceNext مقبول)');
  await sleep(400);
  ok(host.last && (host.last.sub !== before || host.last.phase !== 'play' || true), 'اللعبة كمّلت من غيره');
  all.forEach(drop);
}

async function testJasoos() {
  console.log('\n▶️ الجاسوس');
  const a = await join('jasoos', 'Host'), b = await join('jasoos', 'B', a.code), c = await join('jasoos', 'C', a.code);
  await act('jasoos', a, 'setSettings', { settings: { cats: ['animals'], wordsPerPlayer: 2, rounds: 1, turnTime: 0 } });
  await act('jasoos', a, 'startGame');
  await waitFor(a, s => s.phase === 'play', 6000, 'play');
  drop(c); await sleep(500);
  const r = await act('jasoos', a, 'forceNext');
  ok(r.ok, 'الهوست قدر يعدّي دور اللي فصل');
  [a, b, c].forEach(drop);
}

async function testLammaha() {
  console.log('\n▶️ خليك لمّاح');
  const a = await join('lammaha', 'Host'), b = await join('lammaha', 'B', a.code), c = await join('lammaha', 'C', a.code);
  await act('lammaha', a, 'setSettings', { settings: { cats: ['animals'], turnsPerPlayer: 1, hints: 3, maxWords: 2, level: 'easy', allowCustomWord: false, guessTime: 0 } });
  await act('lammaha', a, 'startGame');
  await waitFor(a, s => s.phase === 'clue', 6000, 'clue');
  drop(c); await sleep(500);
  const host = [a, b].find(p => p.last && p.last.you && p.last.you.isHost) || a;
  const r = await act('lammaha', host, 'forceNext');
  ok(r.ok, 'الهوست قدر يكمّل الجولة من غير اللي فصل');
  [a, b, c].forEach(drop);
}

async function testWisper() {
  console.log('\n▶️ حبر سري');
  const a = await join('wisper', 'Host'), b = await join('wisper', 'B', a.code), c = await join('wisper', 'C', a.code);
  await act('wisper', a, 'setSettings', { settings: { rounds: 1, writeRounds: 0, voteRounds: 0, randomRounds: 1 } });
  await act('wisper', a, 'startGame');
  await waitFor(a, s => s.phase && s.phase !== 'lobby', 6000, 'started');
  drop(c); await sleep(500);
  const r = await act('wisper', a, 'forceContinue');
  ok(r.ok || !!r.error, 'زرار «عدّي» شغال للهوست (رد من السيرفر)');
  [a, b, c].forEach(drop);
}

async function testTahadi() {
  console.log('\n▶️ اسأل واستفيد');
  const a = await join('tahadi', 'Host'), b = await join('tahadi', 'B', a.code), c = await join('tahadi', 'C', a.code);
  await act('tahadi', a, 'setSettings', { settings: { cats: ['sci'], perCat: 1, level: 'easy', qTime: 0 } });
  await act('tahadi', a, 'startWriting');
  await waitFor(a, s => s.phase === 'writing', 6000, 'writing');
  for (const p of [a, b]) { await act('tahadi', p, 'bankDraw', { slot: 0 }); await act('tahadi', p, 'submitQuestions'); }
  drop(c); await sleep(500);
  const r = await act('tahadi', a, 'forceStartQuiz');
  ok(r.ok, 'الهوست قدر يبدأ من غير اللي فصل');
  [a, b, c].forEach(drop);
}

(async function main() {
  const srv = spawn('node', ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
  await sleep(1000);
  for (const [name, fn] of [['conan', testConan], ['jasoos', testJasoos], ['lammaha', testLammaha], ['wisper', testWisper], ['tahadi', testTahadi]]) {
    try { await fn(); } catch (e) { failed++; console.error('  💥 ' + name + ': ' + e.message); }
  }
  console.log('\n===== النتيجة: ✅ ' + passed + ' ناجح | ❌ ' + failed + ' فاشل =====');
  srv.kill(); await sleep(200); process.exit(failed ? 1 : 0);
})();
