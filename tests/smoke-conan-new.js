/* اختبار سريع للسلوك الجديد للمحقق — node tests/smoke-conan-new.js */
'use strict';
const http = require('http');
const { spawn } = require('child_process');
const PORT = 3219;
const BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✅ ' + m); } else { failed++; console.error('  ❌ ' + m); } };
const must = (c, m) => { if (!c) { failed++; console.error('  💥 ' + m); throw new Error(m); } passed++; console.log('  ✅ ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.end(data);
  });
}
function stream(pl) {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/conan/stream?code=${pl.code}&token=${pl.token}`, res => {
      pl._res = res; let buf = '';
      res.on('data', chunk => { buf += chunk.toString('utf8'); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const dl = block.split('\n').find(l => l.startsWith('data: ')); if (!dl) continue; if (block.includes('event: ping')) continue; try { const d = JSON.parse(dl.slice(6)); if (d.t === 'state') pl.last = d; else pl.events.push(d); } catch (e) {} } });
      res.on('close', () => { pl.closed = true; }); resolve();
    });
    pl._req = req;
  });
}
const drop = pl => { try { pl._req.destroy(); } catch (e) {} pl.closed = true; };
async function waitFor(pl, pred, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 6000)) { if (pl.last && pred(pl.last)) return pl.last; await sleep(25); }
  throw new Error('waitFor timeout: ' + (label || '') + ' | phase=' + (pl.last && pl.last.phase) + ' sub=' + (pl.last && pl.last.sub));
}
const act = (pl, action, extra) => post('/api/conan/action', Object.assign({ code: pl.code, token: pl.token, action }, extra || {}));
async function newPlayer(name, code) {
  const r = code ? await post('/api/conan/join', { code, name, avatar: '🕵️' }) : await post('/api/conan/create', { name, avatar: '🕵️' });
  must(r.ok, 'دخول ' + name);
  const pl = { name, code: r.code, token: r.token, id: r.id, last: null, events: [], closed: false };
  await stream(pl); await waitFor(pl, s => !!s, 3000, 'أول حالة ' + name); return pl;
}
const accusedOf = all => all.find(p => p.last && p.last.youAreAccused && !p.closed);
const detsOf = all => all.filter(p => p.last && !p.last.youAreAccused && !p.closed);
function askerOf(all) { const st = all.find(p => !p.closed).last; if (!st || !st.asker) return null; return all.find(p => p.id === st.asker.id); }
let qc = 0; const nextQ = () => 'هل هو حاجة رقم ' + (++qc) + '؟';

async function playCase(all, no) {
  const acc = accusedOf(all); must(acc, `قضية ${no}: في متّهم`);
  const secret = acc.last.secret;
  must((await act(acc, 'startPlay')).ok, `قضية ${no}: بدأ اللعب`);
  await waitFor(all[0], s => s.phase === 'play' && s.round === 1, 5000, 'الجولة 1 ق' + no);
  for (let g = 0; g < 300; g++) {
    const st = all.find(p => !p.closed).last;
    if (st.phase !== 'play') break;
    if (st.sub === 'ask') { const a = askerOf(all); if (a) await act(a, 'ask', { text: nextQ() }); await sleep(50); }
    else if (st.sub === 'answer') { if (st.curQ && !st.curQ.answer) await act(accusedOf(all), 'answer', { value: 'yes' }); await sleep(140); }
    else if (st.sub === 'decide') {
      const last = st.round >= st.totalRounds;
      for (const d of detsOf(all)) { if (last) await act(d, 'submitAnswer', { text: secret }); else await act(d, 'keepGoing'); await sleep(35); }
      await sleep(140);
    } else await sleep(50);
  }
  return secret;
}

async function scenarioMain() {
  console.log('\n▶️ السلوك الأساسي الجديد');
  const H = await newPlayer('Hani'); const code = H.code;
  const P2 = await newPlayer('Pola', code), P3 = await newPlayer('Rasha', code), P4 = await newPlayer('Samy', code);
  const all = [H, P2, P3, P4];
  must((await act(H, 'setSettings', { settings: { cats: ['jobs'], rounds: 2, casesPerPlayer: 1, askOrder: 'turns', accusedOrder: 'turns', allowCustomWord: false, qTime: 0, aTime: 0, maxPass: 5 } })).ok, 'إعدادات');
  await sleep(150);
  must((await act(H, 'startGame')).ok, 'بدء اللعبة');
  for (const p of all) await waitFor(p, s => s.phase === 'pick', 5000, 'مرحلة الكلمة');
  ok(H.last.totalCases === 4, 'إجمالي القضايا = 4');
  // النقط ظاهرة أثناء اللعب (كشف بعد كل قضية)
  ok(typeof H.last.you.score === 'number' && H.last.players.every(x => typeof x.score === 'number'), 'النقط ظاهرة أثناء اللعب ✅');

  // التبديل اتلغى خالص
  const acc = accusedOf(all);
  ok(!(await act(acc, 'rerollWord')).ok, 'التبديل اتلغى — الأكشن مرفوض ✅');

  // نلعب كل القضايا الأربعة
  for (let c = 1; c <= 4; c++) {
    await playCase(all, c);
    const st = await waitFor(H, s => s.phase === 'caseEnd', 8000, 'نهاية القضية ' + c);
    ok(st.phase === 'caseEnd', `القضية ${c} وصلت لشاشة الكشف`);
    // الكشف بعد كل قضية: الكلمة + الإجابات + النقط ظاهرة
    ok(st.result && typeof st.result.secret === 'string' && st.result.secret.length, `ق${c}: الكلمة اتكشفت بعد القضية`);
    ok(Array.isArray(st.result.answers), `ق${c}: إجابات المحققين ظاهرة في الكشف`);
    ok(typeof st.you.score === 'number', `ق${c}: النقط ظاهرة في الكشف`);
    for (const p of all) await act(p, 'readyNext');
    await sleep(200);
  }

  // النهاية: كشف كل القضايا + النقط بتظهر + الترتيب
  const go = await waitFor(H, s => s.phase === 'gameover', 8000, 'شاشة النهاية');
  ok(go.results.review.length === 4, 'الكشف النهائي فيه كل الـ4 قضايا (لقيت ' + go.results.review.length + ')');
  ok(go.results.review.every(r => typeof r.secret === 'string' && r.secret.length), 'كل قضية ليها كلمتها في الكشف');
  ok(go.results.ranking.length === 4, 'الترتيب فيه كل اللاعبين');
  ok(go.results.ranking.every(r => typeof r.score === 'number'), 'النقط ظاهرة بأرقام في النهاية');
  ok(go.players.some(x => x.score !== null), 'النقط اتكشفت في النهاية');
  const total = go.results.ranking.reduce((s, r) => s + r.score, 0);
  ok(total > 0, 'في نقط اتحسبت (المجموع ' + total + ')');
  console.log('  ✅ السلوك الأساسي تمام');
}

async function scenarioGrace() {
  console.log('\n▶️ فترة السماحية لما المتّهم يقطع النت');
  const H = await newPlayer('Adel'); const code = H.code;
  const P2 = await newPlayer('Bassem', code), P3 = await newPlayer('Karim', code), P4 = await newPlayer('Nour', code);
  const all = [H, P2, P3, P4];
  must((await act(H, 'setSettings', { settings: { cats: ['jobs'], rounds: 3, casesPerPlayer: 1, qTime: 0, aTime: 0, allowCustomWord: false } })).ok, 'إعدادات');
  must((await act(H, 'startGame')).ok, 'بدء');
  for (const p of all) await waitFor(p, s => s.phase === 'pick', 5000, 'كلمة');
  const acc = accusedOf(all);
  must((await act(acc, 'startPlay')).ok, 'بدأ اللعب');
  await waitFor(H, s => s.phase === 'play', 5000, 'لعب');
  const watcher = detsOf(all)[0];

  // المتّهم يقطع النت
  drop(acc);
  await waitFor(watcher, s => !!s.paused, 6000, 'اللعبة وقفت مؤقتًا');
  ok(watcher.last.paused && /المتّهم/.test(watcher.last.paused.reason), 'اتوقفت وبتقول مستنيين المتّهم يرجع ⏸️');
  ok(watcher.last.phase === 'play', 'القضية ماتلغتش — لسه في اللعب');
  // محاولة سؤال أثناء التوقف مرفوضة
  const a = askerOf(all);
  if (a && a.id !== acc.id) ok(!(await act(a, 'ask', { text: 'سؤال وقت التوقف' })).ok, 'مفيش أكشن أثناء التوقف');

  // المتّهم يرجع
  acc.closed = false; acc.last = null; await stream(acc);
  await waitFor(watcher, s => !s.paused, 8000, 'رجعت اللعبة');
  ok(!watcher.last.paused && watcher.last.phase === 'play', 'رجع المتّهم واللعبة كمّلت من مكانها ✅');
  console.log('  ✅ السماحية تمام');
}

(async () => {
  console.log('🚀 بنشغّل السيرفر للاختبار...');
  const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORT), NODE_ENV: 'test', ROOM_TTL_MS: '600000', ANSWER_HOLD_MS: '120' }), stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { await post('/api/conan/join', {}); up = true; } catch (e) { await sleep(120); } }
  must(up, 'السيرفر قام');
  try { await scenarioMain(); await scenarioGrace(); }
  catch (e) { failed++; console.error('💥 خطأ:', e.message); }
  srv.kill();
  console.log(`\n===== النتيجة: ✅ ${passed} | ❌ ${failed} =====`);
  process.exit(failed ? 1 : 0);
})();
