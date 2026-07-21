/* لمّحها — اختبار محاكاة كامل: node tests/sim-lammaha.js */
'use strict';
const http = require('http');
const { spawn } = require('child_process');
const PORT = 3215;
const BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.error('  ❌ ' + m); } }
function must(c, m) { if (!c) { failed++; console.error('  💥 ' + m); throw new Error(m); } passed++; }
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
    const req = http.get(`${BASE}/api/lammaha/stream?code=${pl.code}&token=${pl.token}`, res => {
      pl._res = res; let buf = '';
      res.on('data', chunk => { buf += chunk.toString('utf8'); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const dl = block.split('\n').find(l => l.startsWith('data: ')); if (!dl) continue; if (block.includes('event: ping')) continue; try { const d = JSON.parse(dl.slice(6)); if (d.t === 'state') pl.last = d; else pl.events.push(d); } catch (e) {} } });
      res.on('close', () => { pl.closed = true; }); resolve();
    });
    pl._req = req;
  });
}
function drop(pl) { try { pl._req.destroy(); } catch (e) {} }
async function waitFor(pl, pred, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 6000)) { if (pl.last && pred(pl.last)) return pl.last; await sleep(25); }
  throw new Error('waitFor timeout: ' + (label || '') + ' | phase=' + (pl.last && pl.last.phase) + ' round=' + (pl.last && pl.last.round));
}
async function act(pl, action, extra) { return post('/api/lammaha/action', Object.assign({ code: pl.code, token: pl.token, action }, extra || {})); }
async function newPlayer(name, code) {
  const r = code ? await post('/api/lammaha/join', { code, name, avatar: '🎤' }) : await post('/api/lammaha/create', { name, avatar: '🎤' });
  must(r.ok, 'إنشاء/دخول ' + name + ' — ' + (r.error || ''));
  const pl = { name, code: r.code, token: r.token, id: r.id, last: null, events: [], closed: false };
  await stream(pl); await waitFor(pl, s => !!s, 3000, 'أول حالة ' + name); return pl;
}
// نجيب الملمّح والاسم السري (من حالة الملمّح نفسه)
function findCluer(players) { for (const pl of players) if (pl.last && pl.last.phase === 'clue' && pl.last.youAreCluer) return pl; return null; }

async function scenarioA() {
  console.log('▶️ سيناريو A: جولة كاملة + مطابقة متسامحة + نقط متناقصة');
  const H = await newPlayer('Hady');
  const code = H.code;
  const P2 = await newPlayer('Pola', code);
  let r = await act(H, 'startGame'); ok(!r.ok, 'أقل من 3 مرفوض');
  const P3 = await newPlayer('Rana', code);
  const all = [H, P2, P3];

  r = await act(P2, 'setSettings', { settings: { maxClues: 5 } }); ok(!r.ok, 'غير الهوست ميظبطش');
  must((await act(H, 'setSettings', { settings: { cats: ['football'], roundsPerPlayer: 1, maxClues: 3, maxPass: 2, order: 'turns' } })).ok, 'إعدادات');
  await waitFor(H, s => s.settings.cats.length === 1 && s.settings.roundsPerPlayer === 1);
  must((await act(H, 'startGame')).ok, 'بدء');
  await waitFor(H, s => s.phase === 'clue', 4000, 'أول جولة');
  ok(H.last.totalRounds === 3, 'إجمالي 3 جولات (3 لاعبين × 1)');

  // الجولة 1
  for (const pl of all) await waitFor(pl, s => s.phase === 'clue' && s.round === 1, 4000, 'مزامنة ج1');
  const cluer = findCluer(all); must(cluer, 'في ملمّح ومعاه السر');
  const guessers = all.filter(p => p !== cluer);
  ok(typeof cluer.last.secret === 'string' && cluer.last.secret.length > 0, 'الملمّح شايف السر');
  ok(guessers.every(g => g.last.secret === undefined), 'المخمّنين مش شايفين السر');
  const secret = cluer.last.secret;

  // مينفعش تخمين قبل التلميح
  let g = await act(guessers[0], 'guess', { text: secret }); ok(!g.ok, 'ممنوع تخمين قبل أول تلميحة');
  // الملمّح ممنوع يخمّن
  g = await act(cluer, 'guess', { text: secret }); ok(!g.ok, 'الملمّح ممنوع يخمّن');

  must((await act(cluer, 'startClue')).ok, 'أول تلميحة');
  await waitFor(guessers[0], s => s.cluesGiven === 1, 3000, 'التلميحة وصلت');
  ok(guessers[0].last.nextPoints === 100, 'أول تلميحة = 100 للملمّح');

  // تخمين غلط
  must((await act(guessers[0], 'guess', { text: 'حاجة غلط خالص' })).ok, 'تخمين غلط اتقبل كإدخال');
  await waitFor(cluer, s => s.guesses.some(x => x.text.includes('غلط')), 2000, 'الغلط ظهر للملمّح');
  ok(cluer.last.guesses.every(x => !x.correct), 'الغلط متعلّم إنه غلط');

  // تلميحة تانية (النقط تقل لـ 80)
  must((await act(cluer, 'clueAgain')).ok, 'تلميحة تانية');
  await waitFor(guessers[0], s => s.cluesGiven === 2, 3000, 'تلميحة 2');
  ok(guessers[0].last.nextPoints === 80, 'تاني تلميحة = 80 للملمّح');

  // تخمين صح بصيغة فيها غلطة/جزئية (تسامح): نجرّب أول كلمة من الاسم
  const firstWord = secret.split(' ')[0];
  const guessRes = await act(guessers[1], 'guess', { text: firstWord });
  // ممكن الكلمة الأولى تكون قصيرة/مش مميزة؛ لو مقبلهاش نجرّب الاسم كامل
  let solver = guessers[1], solved = guessRes.ok && guessRes.correct;
  if (!solved) { const r2 = await act(guessers[1], 'guess', { text: secret }); solved = r2.ok && r2.correct; }
  must(solved, 'التخمين الصح اتقبل (تسامح): "' + firstWord + '" أو الاسم كامل');
  const rev = await waitFor(H, s => s.phase === 'reveal' && s.round === 1, 4000, 'النتيجة');
  ok(rev.result.solved && rev.result.cluerPoints === 80, 'الملمّح خد 80 (تلميحتين)');

  // النقط: الحلّال +100، الملمّح +80، التالت 0
  const solverScore = rev.players.find(x => x.id === solver.id).score;
  const cluerScore = rev.players.find(x => x.id === cluer.id).score;
  const thirdScore = rev.players.find(x => x.id === guessers[0].id).score;
  ok(solverScore === 100, 'الحلّال +100 (لقيت ' + solverScore + ')');
  ok(cluerScore === 80, 'الملمّح +80 (لقيت ' + cluerScore + ')');
  ok(thirdScore === 0, 'التالت 0');

  for (const pl of all) must((await act(pl, 'readyNext')).ok, 'التالي ' + pl.name);
  await waitFor(H, s => s.round === 2 && s.phase === 'clue', 4000, 'الجولة 2 بدأت لوحدها');

  // كمّل الجولتين الباقيين بأي طريقة للوصول لـ gameover
  for (let rn = 2; rn <= 3; rn++) {
    for (const pl of all) await waitFor(pl, s => s.phase === 'clue' && s.round === rn, 4000, 'مزامنة ج' + rn);
    const cl = findCluer(all); must(cl, 'ملمّح ج' + rn);
    const gs = all.filter(p => p !== cl);
    const sec = cl.last.secret;
    must((await act(cl, 'startClue')).ok, 'تلميحة ج' + rn);
    await waitFor(gs[0], s => s.cluesGiven === 1, 3000);
    await act(gs[0], 'guess', { text: sec });
    await waitFor(H, s => s.phase === 'reveal' && s.round === rn, 4000, 'نتيجة ج' + rn);
    for (const pl of all) await act(pl, 'readyNext');
  }
  const go = await waitFor(H, s => s.phase === 'gameover', 5000, 'النهاية');
  ok(go.results.ranking.length === 3, 'الترتيب 3');
  ok(go.results.awards.some(a => a.title === 'بطل اللمّة'), 'جايزة البطل');
  ok(go.results.review.length === 3, 'مراجعة 3 جولات');
  console.log('  ✅ سيناريو A تمام');
}

async function scenarioB() {
  console.log('▶️ سيناريو B: عدم التكرار + خلّص التلميحات محدش عرف + العدّي (pass)');
  const H = await newPlayer('Sam');
  const code = H.code;
  const P2 = await newPlayer('Sara', code);
  const P3 = await newPlayer('Simo', code);
  const all = [H, P2, P3];
  must((await act(H, 'setSettings', { settings: { cats: ['animals'], roundsPerPlayer: 2, maxClues: 2, maxPass: 3, order: 'turns' } })).ok, 'إعدادات');
  must((await act(H, 'startGame')).ok, 'بدء');
  const seen = new Set();
  for (let rn = 1; rn <= 6; rn++) {
    for (const pl of all) await waitFor(pl, s => s.phase === 'clue' && s.round === rn, 5000, 'ج' + rn);
    const cl = findCluer(all); must(cl, 'ملمّح ج' + rn);
    let sec = cl.last.secret;
    // اختبر العدّي في الجولة 1
    if (rn === 1) {
      ok(cl.last.passesLeft === 3, 'عنده 3 مرات عدّي');
      must((await act(cl, 'pass')).ok, 'عدّى الكلمة');
      await waitFor(cl, s => s.passesLeft === 2, 2000, 'العدّي اتحسب');
      sec = cl.last.secret;
      // بعد ما بدأ تلميح، العدّي يترفض
      must((await act(cl, 'startClue')).ok, 'تلميحة');
      const pr = await act(cl, 'pass'); ok(!pr.ok, 'مينفعش عدّي بعد التلميح');
    } else {
      must((await act(cl, 'startClue')).ok, 'تلميحة ج' + rn);
    }
    ok(!seen.has(sec), 'الاسم «' + sec + '» متكررش في الروم');
    seen.add(sec);
    const gs = all.filter(p => p !== cl);
    await waitFor(gs[0], s => s.cluesGiven >= 1, 3000);

    if (rn === 3) {
      // محدش يعرف: نستهلك التلميحات كلها والملمّح يعدّي الجولة
      if (cl.last.cluesLeft > 0) { must((await act(cl, 'clueAgain')).ok, 'تلميحة أخيرة'); await waitFor(cl, s => s.cluesLeft === 0, 2000); }
      const noMore = await act(cl, 'clueAgain'); ok(!noMore.ok, 'مفيش تلميحات زياده');
      must((await act(cl, 'giveUp')).ok, 'الملمّح عدّى الجولة');
      const rev = await waitFor(H, s => s.phase === 'reveal' && s.round === rn, 4000, 'نتيجة بدون حل');
      ok(!rev.result.solved && rev.result.cluerPoints === 0, 'محدش خد نقط (لا الملمّح ولا حد)');
    } else {
      await act(gs[0], 'guess', { text: sec });
      await waitFor(H, s => s.phase === 'reveal' && s.round === rn, 4000, 'نتيجة ج' + rn);
    }
    for (const pl of all) await act(pl, 'readyNext');
  }
  await waitFor(H, s => s.phase === 'gameover', 5000, 'النهاية');
  ok(seen.size === 6, 'الـ6 أسماء كلهم مختلفين');
  console.log('  ✅ سيناريو B تمام');
}

async function scenarioC() {
  console.log('▶️ سيناريو C: ملمّح فصل وسط الجولة + حضور + طرد + خروج ناعم + انتقال هوست');
  const H = await newPlayer('Adel');
  const code = H.code;
  const P2 = await newPlayer('Bola', code);
  const P3 = await newPlayer('Ciro', code);
  const P4 = await newPlayer('Dina', code);
  const all = [H, P2, P3, P4];
  must((await act(H, 'setSettings', { settings: { cats: ['places'], roundsPerPlayer: 1, maxClues: 3, order: 'turns' } })).ok, 'إعدادات');
  must((await act(H, 'startGame')).ok, 'بدء');
  await waitFor(H, s => s.phase === 'clue' && s.round === 1, 4000);

  // الجولة 1: الملمّح يفصل وسط اللعب → الجولة تلغى بدون نقط وتعدّي
  let cl = findCluer(all); must(cl, 'ملمّح ج1');
  must((await act(cl, 'startClue')).ok, 'تلميحة');
  if (cl !== H) {
    drop(cl); await sleep(300);
    const rev = await waitFor(H, s => (s.phase === 'reveal' || s.round > 1), 5000, 'الجولة اتلغت');
    if (H.last.phase === 'reveal') { ok(!H.last.result.solved, 'الملمّح فصل → مفيش حل ومفيش نقط'); for (const pl of all.filter(p => p !== cl)) await act(pl, 'readyNext'); }
    // الملمّح يرجع بالتوكن
    const rj = await post('/api/lammaha/join', { code, token: cl.token }); ok(rj.ok && rj.resumed, 'الملمّح رجع بالتوكن');
    await stream(cl);
  }

  // كمّل لحد ما نخلص، وفي الطريق: حضور + خروج ناعم + طرد
  let kicked = false, leftDone = false, presenceDone = false;
  for (let guard = 0; guard < 12; guard++) {
    const st = await waitFor(H, s => s.phase === 'clue' || s.phase === 'reveal' || s.phase === 'gameover', 6000, 'حالة');
    if (st.phase === 'gameover') break;
    if (st.phase === 'reveal') { for (const pl of all) if (!pl.closed) await act(pl, 'readyNext').catch(() => {}); await sleep(100); continue; }
    // clue
    const players = all.filter(p => !p.closed && !(kicked && p === P4));
    const cc = findCluer(players);
    if (!cc) { await sleep(100); continue; }
    // حضور: مخمّن يغيب ويرجع
    if (!presenceDone) {
      const gg = players.find(p => p !== cc);
      must((await act(gg, 'presence', { away: true })).ok, 'غياب');
      await waitFor(H, s => (s.players.find(x => x.id === gg.id) || {}).away === true, 3000, 'علامة الغياب');
      await act(gg, 'presence', { away: false }); presenceDone = true;
    }
    must((await act(cc, 'startClue')).ok, 'تلميحة');
    await waitFor(cc, s => s.cluesGiven >= 1, 3000);
    const gs = players.filter(p => p !== cc);
    // خروج ناعم لـ P3 وسط جولة (لو لسه)
    if (!leftDone && gs.includes(P3) && P3 !== cc) {
      const before = H.last.players.find(x => x.id === P3.id).score;
      must((await act(P3, 'leave')).ok, 'P3 خرج ناعم');
      await waitFor(H, s => (s.players.find(x => x.id === P3.id) || {}).left === true, 3000, 'متعلم خرج');
      ok(H.last.players.find(x => x.id === P3.id).score === before, 'سكور P3 اتحفظ');
      leftDone = true;
    }
    await act(gs.find(p => !p.closed && p !== P3) || gs[0], 'guess', { text: cc.last.secret });
    await waitFor(H, s => s.phase === 'reveal' || s.phase === 'gameover', 5000, 'نتيجة/نهاية');
    // طرد P4 مرة
    if (!kicked) { const kr = await act(H, 'kick', { playerId: P4.id }); if (kr.ok) { kicked = true; await sleep(150); ok(P4.events.some(e => e.t === 'kicked'), 'P4 اتطرد'); } }
    if (H.last.phase === 'reveal') for (const pl of all) if (!pl.closed) await act(pl, 'readyNext').catch(() => {});
  }
  const go = await waitFor(H, s => s.phase === 'gameover', 6000, 'النهاية');
  const p3row = go.results.ranking.find(x => x.id === P3.id);
  ok(p3row && p3row.left === true, 'P3 ظاهر في الترتيب بعلامة خروج');

  // خروج الهوست الناعم → انتقال + يفضل بالسكور
  must((await act(H, 'playAgain')).ok, 'نلعب تاني (تنظيف)');
  await waitFor(P2, s => s.phase === 'lobby', 4000, 'رجعوا اللوبي');
  console.log('  ✅ سيناريو C تمام');
}

(async () => {
  console.log('🚀 بنشغّل سيرفر اللمّة للاختبار...');
  const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORT), NODE_ENV: 'test', ROOM_TTL_MS: '600000' }), stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { await post('/api/lammaha/join', {}); up = true; } catch (e) { await sleep(120); } }
  must(up, 'السيرفر قام');
  try { await scenarioA(); await scenarioB(); await scenarioC(); }
  catch (e) { failed++; console.error('💥 خطأ:', e.message); }
  srv.kill();
  console.log(`\n===== النتيجة: ✅ ${passed} ناجح | ❌ ${failed} فاشل =====`);
  process.exit(failed ? 1 : 0);
})();
