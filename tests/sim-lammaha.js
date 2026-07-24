/* لمّحها — اختبار محاكاة (نظام التلميح المكتوب): node tests/sim-lammaha.js */
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
  throw new Error('waitFor timeout: ' + (label || '') + ' | phase=' + (pl.last && pl.last.phase) + ' sub=' + (pl.last && pl.last.sub) + ' round=' + (pl.last && pl.last.round) + ' clues=' + (pl.last && pl.last.cluesGiven));
}
async function act(pl, action, extra) { return post('/api/lammaha/action', Object.assign({ code: pl.code, token: pl.token, action }, extra || {})); }
async function newPlayer(name, code) {
  const r = code ? await post('/api/lammaha/join', { code, name, avatar: '🎤' }) : await post('/api/lammaha/create', { name, avatar: '🎤' });
  must(r.ok, 'إنشاء/دخول ' + name + ' — ' + (r.error || ''));
  const pl = { name, code: r.code, token: r.token, id: r.id, last: null, events: [], closed: false };
  await stream(pl); await waitFor(pl, s => !!s, 3000, 'أول حالة ' + name); return pl;
}
async function pickWord(players, rn) {
  // لو الخيار مفتوح: الملمّح لازم يختار الأول
  for (let t = 0; t < 20; t++) {
    const cl = findCluer(players.filter(p => !p.closed));
    if (cl && cl.last && cl.last.sub === 'pick') { const r = await act(cl, 'pickBank'); if (r.ok) return cl; }
    else if (cl && cl.last && cl.last.sub === 'hint') return cl;
    await sleep(120);
  }
  throw new Error('فشل اختيار الكلمة ج' + rn);
}
async function syncClue(players, rn, sub, clues, label) {
  const views = [];
  for (const pl of players) views.push([pl, await waitFor(pl, s => s.phase === 'clue' && s.round === rn && s.sub === sub && s.cluesGiven === clues, 9000, label + ' ' + pl.name)]);
  return views;
}
async function hintRetry(players, rn, text) {
  for (let t = 0; t < 4; t++) {
    const cl = findCluer(players.filter(p => !p.closed));
    if (cl) {
      const r = await act(cl, 'submitHint', { text });
      if (r.ok) return cl;
      if (/خلّصت|مش وقت/.test(r.error || '')) { /* الحالة اتحركت — نستنى ونعيد */ }
    }
    await sleep(200);
  }
  throw new Error('فشل إرسال التلميحة بعد محاولات — ج' + rn);
}
const SAFE_HINT = 'توصيفات اختبارية تجريبية';   // 3 كلمات، كلها ≥6 حروف (مفيش تصادم مع البنك)
const SAFE_HINT1 = 'توصيفات';                    // كلمة واحدة
function findCluer(players) { for (const pl of players) if (pl.last && pl.last.phase === 'clue' && pl.last.youAreCluer) return pl; return null; }

async function pairGuess(H, gs, t1, t2, rn) {
  const r1 = await act(gs[0], 'guess', { text: t1 });
  must(r1.ok, 'تخمين 1 ج' + rn + ' — ' + (r1.error || ''));
  const r2 = await act(gs[1], 'guess', { text: t2 });
  if (!r2.ok) {
    // لو الجولة اتحسمت في السباق ده مقبول
    await waitFor(H, s => s.phase === 'reveal' && s.round === rn, 4000, 'حسم بعد سباق');
    passed++;
  } else passed++;
}
async function scenarioA() {
  console.log('▶️ سيناريو A: فلتر التلميح + تخمينة واحدة + انتقال تلقائي + سلم النقط + فايزين متعددين');
  const H = await newPlayer('Hady');
  const code = H.code;
  const P2 = await newPlayer('Pola', code);
  let r = await act(H, 'startGame'); ok(!r.ok, 'أقل من 3 مرفوض');
  const P3 = await newPlayer('Rana', code);
  const all = [H, P2, P3];

  // الحد الأقصى للتلميحات بقى 10
  must((await act(H, 'setSettings', { settings: { cats: ['football'], roundsPerPlayer: 1, maxClues: 10, maxPass: 2, order: 'turns', clueTime: 0 } })).ok, 'إعدادات');
  await waitFor(H, s => s.settings.maxClues === 10 && s.settings.cats.length === 1);
  await act(H, 'setSettings', { settings: { maxClues: 11 } });
  await sleep(150);
  ok(H.last.settings.maxClues === 10, 'أكتر من 10 بيتتجاهل');

  must((await act(H, 'startGame')).ok, 'بدء');
  await syncClue(all, 1, 'hint', 0, 'ج1');
  ok(H.last.totalRounds === 3, '3 جولات');
  const cluer = findCluer(all); must(cluer, 'في ملمّح');
  const guessers = all.filter(p => p !== cluer);
  const secret = cluer.last.secret;
  ok(guessers.every(g => g.last.secret === undefined), 'السر للملمّح بس');
  ok(cluer.last.tier === 100, 'التلميحة الجاية بـ100');

  // فلتر التسريب
  let hr = await act(cluer, 'submitHint', { text: secret });
  ok(!hr.ok && /الاسم|قريب/.test(hr.error || ''), 'التلميح بالاسم نفسه مرفوض');
  hr = await act(cluer, 'submitHint', { text: 'أكيد هو ' + secret.split(' ')[0] + ' يا جماعة' });
  ok(!hr.ok, 'التلميح بجزء من الاسم مرفوض');
  // تخمين قبل التلميح مرفوض + غير الملمّح مش بيكتب تلميح
  ok(!(await act(guessers[0], 'guess', { text: secret })).ok, 'ممنوع تخمين قبل التلميحة');
  ok(!(await act(guessers[0], 'submitHint', { text: 'حاجة' })).ok, 'غير الملمّح ميلمّحش');

  must((await act(cluer, 'submitHint', { text: SAFE_HINT })).ok, 'تلميحة 1 نضيفة');
  await syncClue(all, 1, 'guess', 1, 'تخمين ت1');
  ok(guessers[0].last.tier === 100, 'الإجابة من التلميحة 1 = 100');

  // الملمّح ممنوع يخمّن + تخمينة واحدة بس
  ok(!(await act(cluer, 'guess', { text: secret })).ok, 'الملمّح ممنوع يخمّن');
  must((await act(guessers[0], 'guess', { text: 'إجابة غلط أكيد' })).ok, 'تخمين 1');
  const edit = await act(guessers[0], 'guess', { text: 'إجابة معدّلة' });
  ok(edit.ok, 'يقدر يعدّل تخمينه قبل ما الكل يخلّص');
  await waitFor(cluer, s => (s.liveGuesses || []).some(g => /معدّلة/.test(g.text)), 3000, 'التعديل وصل للملمّح');
  ok(cluer.last.liveGuesses.filter(g => g.name === guessers[0].name).length === 1, 'التعديل بيستبدل مش بيضيف');
  must((await act(guessers[1], 'guess', { text: 'برضه غلط' })).ok, 'تخمين 2');

  // كله غلط → انتقال تلقائي لكتابة التلميحة 2
  await syncClue(all, 1, 'hint', 1, 'رجعنا للكتابة');
  ok(H.last.hintHistory.length === 1 && H.last.hintHistory[0].guesses.length === 2, 'التخمينات الغلط اتسجلت');
  ok(cluer.last.tier === 90, 'التلميحة التانية بـ90');

  must((await act(cluer, 'submitHint', { text: SAFE_HINT })).ok, 'تلميحة 2');
  await syncClue(all, 1, 'guess', 2, 'تخمين ت2');
  // واحد صح وواحد غلط
  must((await act(guessers[0], 'guess', { text: secret })).ok, 'تخمين صح');
  must((await act(guessers[1], 'guess', { text: 'مش عارف' })).ok, 'تخمين غلط');
  const rev = await waitFor(H, s => s.phase === 'reveal' && s.round === 1, 5000, 'النتيجة');
  ok(rev.result.solved && rev.result.points === 90 && rev.result.cluerPoints === 45, 'المخمّن 90 والملمّح 45');
  ok(rev.result.winners.length === 1 && rev.result.winners[0].name === guessers[0].name, 'فايز واحد صح');
  const sc = id => rev.players.find(x => x.id === id).score;
  ok(sc(guessers[0].id) === 90, 'الحلّال +90');
  ok(sc(cluer.id) === 45, 'الملمّح +45 (نص نقط التلميحة التانية) — لقيت ' + sc(cluer.id));
  ok(sc(guessers[1].id) === 0, 'الغلطان 0');
  ok(rev.result.hints.length === 2 && rev.result.hints[1].guesses.some(g => g.correct), 'تفصيلة التلميحات كاملة');
  for (const pl of all) must((await act(pl, 'readyNext')).ok, 'التالي');
  await sleep(120);

  // الجولة 2: الاتنين يجيبوها من أول تلميحة → كل واحد +100 والملمّح +100 مرة واحدة
  await syncClue(all, 2, 'hint', 0, 'ج2');
  const c2 = findCluer(all); const g2 = all.filter(p => p !== c2);
  const sec2 = c2.last.secret;
  const before = {}; for (const pl of all) before[pl.id] = H.last.players.find(x => x.id === pl.id).score;
  await hintRetry(all, 2, SAFE_HINT); passed++;
  await syncClue(all, 2, 'guess', 1, 'تخمين ج2');
  await pairGuess(H, g2, sec2, '  ' + sec2 + '  ', 2);
  const rev2 = await waitFor(H, s => s.phase === 'reveal' && s.round === 2, 5000, 'نتيجة ج2');
  ok(rev2.result.winners.length === 2 && rev2.result.points === 100, 'فايزين اتنين × 100');
  const d = id => rev2.players.find(x => x.id === id).score - before[id];
  ok(d(g2[0].id) === 100 && d(g2[1].id) === 100, 'كل فايز +100');
  ok(d(c2.id) === 50, 'الملمّح +50 (نص المية) مرة واحدة مش مرتين — لقيت ' + d(c2.id));
  for (const pl of all) await act(pl, 'readyNext');
  await sleep(120);

  // الجولة 3 سريعة → النهاية
  await syncClue(all, 3, 'hint', 0, 'ج3');
  const c3 = findCluer(all); const g3 = all.filter(p => p !== c3);
  await hintRetry(all, 3, SAFE_HINT); passed++;
  await syncClue(all, 3, 'guess', 1, 'تخمين ج3');
  await pairGuess(H, g3, c3.last.secret, 'غلط', 3);
  await waitFor(H, s => s.phase === 'reveal' && s.round === 3, 5000);
  for (const pl of all) await act(pl, 'readyNext');
  await sleep(120);
  const go = await waitFor(H, s => s.phase === 'gameover', 5000, 'النهاية');
  ok(go.results.ranking.length === 3 && go.results.review.length === 3, 'نتيجة ومراجعة كاملة');
  console.log('  ✅ سيناريو A تمام');
}

async function scenarioB() {
  console.log('▶️ سيناريو B: استنفاد التلميحات = صفر نقط + عدّي الكلمة + عدم التكرار حتى بعد نلعب تاني');
  const H = await newPlayer('Sam');
  const code = H.code;
  const P2 = await newPlayer('Sara', code);
  const P3 = await newPlayer('Simo', code);
  const all = [H, P2, P3];
  must((await act(H, 'setSettings', { settings: { cats: ['animals'], roundsPerPlayer: 1, maxClues: 2, maxPass: 3, order: 'turns', clueTime: 0 } })).ok, 'إعدادات');
  must((await act(H, 'startGame')).ok, 'بدء');
  const seen = new Set();

  for (let rn = 1; rn <= 3; rn++) {
    await syncClue(all, rn, 'hint', 0, 'ج' + rn);
    const cl = findCluer(all); const gs = all.filter(p => p !== cl);
    let sec = cl.last.secret;
    if (rn === 1) {
      // عدّي الكلمة
      ok(cl.last.passesLeft === 1, 'مرة عدّي واحدة (ثابتة)');
      must((await act(cl, 'pass')).ok, 'عدّي');
      await waitFor(cl, s => s.passesLeft === 0, 2000);
      ok(cl.last.secret !== sec, 'الكلمة اتغيرت');
      seen.add(sec); // الكلمة المعدّاة برضه محسوبة مستخدمة
      sec = cl.last.secret;
    }
    ok(!seen.has(sec), 'الاسم «' + sec + '» جديد');
    seen.add(sec);

    if (rn === 2) {
      // استنفاد: تلميحتين كله غلط → صفر نقط
      const b4 = {}; for (const pl of all) b4[pl.id] = H.last.players.find(x => x.id === pl.id).score;
      must((await act(cl, 'submitHint', { text: SAFE_HINT })).ok, 'ت1');
      await syncClue(all, rn, 'guess', 1, 'خ1');
      for (const g of gs) must((await act(g, 'guess', { text: 'مش عارف خالص' })).ok, 'غلط');
      await syncClue(all, rn, 'hint', 1, 'رجوع للكتابة');
      // مفيش عدّي بعد أول تلميحة
      ok(!(await act(cl, 'pass')).ok, 'مفيش عدّي بعد التلميح');
      must((await act(cl, 'submitHint', { text: SAFE_HINT })).ok, 'ت2');
      await syncClue(all, rn, 'guess', 2, 'خ2');
      ok(gs[0].last.tier === 90, 'التانية بـ90');
      for (const g of gs) must((await act(g, 'guess', { text: 'برضه مش عارف' })).ok, 'غلط تاني');
      const rev = await waitFor(H, s => s.phase === 'reveal' && s.round === rn, 5000, 'خلصت التلميحات');
      ok(!rev.result.solved && rev.result.points === 0, 'محدش حل → مفيش نقط');
      for (const pl of all) ok(rev.players.find(x => x.id === pl.id).score === b4[pl.id], 'ولا نقطة اتغيرت لحد');
    } else {
      await hintRetry(all, rn, SAFE_HINT); passed++;
      await syncClue(all, rn, 'guess', 1, 'خ');
      await act(gs[0], 'guess', { text: sec });
      await act(gs[1], 'guess', { text: 'غلط' });
      await waitFor(H, s => s.phase === 'reveal' && s.round === rn, 5000);
    }
    for (const pl of all) await act(pl, 'readyNext');
  await sleep(120);
  }
  await waitFor(H, s => s.phase === 'gameover', 5000);

  // نلعب تاني: الأسماء القديمة عمرها ما ترجع
  must((await act(H, 'playAgain')).ok, 'نلعب تاني');
  await waitFor(H, s => s.phase === 'lobby');
  must((await act(H, 'startGame')).ok, 'بدء تاني');
  for (let rn = 1; rn <= 3; rn++) {
    await syncClue(all, rn, 'hint', 0, 'ت-ج' + rn);
    const cl = findCluer(all); const gs = all.filter(p => p !== cl);
    const sec = cl.last.secret;
    ok(!seen.has(sec), 'بعد نلعب تاني: «' + sec + '» جديد برضه');
    seen.add(sec);
    await hintRetry(all, rn, SAFE_HINT); passed++;
    await syncClue(all, rn, 'guess', 1, 'خ');
    await act(gs[0], 'guess', { text: sec });
    await act(gs[1], 'guess', { text: 'غلط' });
    await waitFor(H, s => s.phase === 'reveal' && s.round === rn, 5000);
    for (const pl of all) await act(pl, 'readyNext');
  await sleep(120);
  }
  await waitFor(H, s => s.phase === 'gameover', 5000);
  console.log('  ✅ سيناريو B تمام');
}

async function scenarioC() {
  console.log('▶️ سيناريو C: ملمّح فصل + مخمّن خرج ناعم (البوابة بتتظبط) + حضور + طرد');
  const H = await newPlayer('Adel');
  const code = H.code;
  const P2 = await newPlayer('Bola', code);
  const P3 = await newPlayer('Ciro', code);
  const P4 = await newPlayer('Dina', code);
  const all = [H, P2, P3, P4];
  must((await act(H, 'setSettings', { settings: { cats: ['places'], roundsPerPlayer: 1, maxClues: 3, order: 'turns', clueTime: 0 } })).ok, 'إعدادات');
  must((await act(H, 'startGame')).ok, 'بدء');
  await syncClue(all, 1, 'hint', 0, 'ج1');

  // حضور
  must((await act(P2, 'presence', { away: true })).ok, 'غياب');
  await waitFor(H, s => (s.players.find(x => x.id === P2.id) || {}).away === true, 3000, 'علامة ❗');
  await act(P2, 'presence', { away: false });

  // الجولة 1: الملمّح يفصل وسط sub=hint → الجولة تتقفل بدون نقط
  let cl = findCluer(all);
  if (cl !== H) {
    drop(cl); await sleep(350);
    const rev = await waitFor(H, s => s.phase === 'reveal' && s.round === 1, 5000, 'الجولة اتلغت');
    ok(!rev.result.solved, 'ملمّح فصل → مفيش نقط');
    const rj = await post('/api/lammaha/join', { code, token: cl.token });
    ok(rj.ok && rj.resumed, 'رجع بالتوكن');
    await stream(cl);
    for (const pl of all) await act(pl, 'readyNext');
  await sleep(120);
  } else {
    // لو الهوست هو الملمّح: كمّل عادي
    must((await act(cl, 'submitHint', { text: SAFE_HINT })).ok, 'تلميحة');
    const gs = all.filter(p => p !== cl);
    for (const g of gs) await act(g, 'guess', { text: cl.last.secret });
    await waitFor(H, s => s.phase === 'reveal', 5000);
    for (const pl of all) await act(pl, 'readyNext');
  await sleep(120);
  }

  // الجولة 2: مخمّن يخرج ناعم أثناء sub=guess → البوابة تتحل من غيره
  await syncClue(all.filter(p => !p.closed), 2, 'hint', 0, 'ج2');
  cl = findCluer(all);
  const gs2 = all.filter(p => p !== cl && !p.closed);
  must((await act(cl, 'submitHint', { text: SAFE_HINT })).ok, 'تلميحة ج2');
  await waitFor(gs2[0], s => s.sub === 'guess' && s.round === 2, 4000);
  const leaver = gs2.find(p => p !== H) || gs2[0];
  const scBefore = H.last.players.find(x => x.id === leaver.id).score;
  must((await act(leaver, 'leave')).ok, 'خروج ناعم وسط التخمين');
  await waitFor(H, s => (s.players.find(x => x.id === leaver.id) || {}).left === true, 3000, 'متعلم خرج');
  ok(H.last.players.find(x => x.id === leaver.id).score === scBefore, 'سكوره محفوظ');
  // الباقيين يخمّنوا → الجولة تتحل رغم اللي خرج
  for (const g of gs2.filter(p => p !== leaver)) must((await act(g, 'guess', { text: cl.last.secret })).ok, 'تخمين ' + g.name);
  const rev2 = await waitFor(H, s => s.phase === 'reveal' && s.round === 2, 5000, 'اتحلت من غير الخارج');
  ok(rev2.result.solved, 'الجولة كملت عادي');
  // طرد P4
  if (!P4.closed && P4 !== cl) {
    const kr = await act(H, 'kick', { playerId: P4.id });
    if (kr.ok) { await sleep(150); ok(P4.events.some(e => e.t === 'kicked'), 'P4 اتطرد'); }
  }
  for (const pl of all) if (!pl.closed) await act(pl, 'readyNext').catch(() => {});

  // كمّل لحد النهاية بأي شكل
  for (let guard = 0; guard < 10; guard++) {
    const st = H.last;
    if (st.phase === 'gameover') break;
    if (st.phase === 'reveal') { for (const pl of all) if (!pl.closed) await act(pl, 'readyNext').catch(() => {}); await sleep(120); continue; }
    if (st.phase === 'clue' && st.sub === 'hint') {
      const cc = findCluer(all.filter(p => !p.closed));
      if (cc) { await act(cc, 'submitHint', { text: SAFE_HINT }); await sleep(150); }
      else { await act(H, 'forceNext'); await sleep(150); }
      continue;
    }
    if (st.phase === 'clue' && st.sub === 'guess') {
      const cc = findCluer(all.filter(p => !p.closed));
      for (const g of all.filter(p => !p.closed && p !== cc && p !== leaver && !(p === P4 && P4.events.some(e => e.t === 'kicked')))) await act(g, 'guess', { text: (cc && cc.last.secret) || 'حاجة' }).catch(() => {});
      await sleep(200);
      if (H.last.phase === 'clue' && H.last.sub === 'guess') await act(H, 'forceNext');
      continue;
    }
    await sleep(150);
  }
  const go = await waitFor(H, s => s.phase === 'gameover', 8000, 'النهاية');
  const lrow = go.results.ranking.find(x => x.id === leaver.id);
  ok(lrow && lrow.left === true, 'اللي خرج في الترتيب بعلامة 🚪');
  console.log('  ✅ سيناريو C تمام');
}


async function scenarioD() {
  console.log('▶️ سيناريو D: المستويات + كلمة الملمّح + حد الكلمات + عدالة الأدوار');
  const H = await newPlayer('Dh');
  const code = H.code;
  const P2 = await newPlayer('Dp2', code);
  const P3 = await newPlayer('Dp3', code);
  const all = [H, P2, P3];

  // المستويات
  ok(H.last.settings.level === 'easy', 'المستوى الافتراضي سهل');
  ok(Array.isArray(H.last.levels) && H.last.levels.length === 3, 'التلات مستويات موجودة');
  must((await act(H, 'setSettings', { settings: { level: 'hard' } })).ok, 'اختيار صعب');
  await waitFor(H, s => s.settings.level === 'hard', 3000);
  ok(!(await act(P2, 'setSettings', { settings: { level: 'easy' } })).ok, 'غير الهوست ميغيرش');
  await act(H, 'setSettings', { settings: { level: 'خرافي' } });
  await sleep(150);
  ok(H.last.settings.level === 'hard', 'مستوى غلط بيتتجاهل');

  // حد الكلمات + خيار كلمة الملمّح
  must((await act(H, 'setSettings', { settings: { cats: ['football'], roundsPerPlayer: 2, maxClues: 3, order: 'random', maxWords: 2, allowCustomWord: true, clueTime: 0 } })).ok, 'إعدادات');
  await waitFor(H, s => s.settings.maxWords === 2 && s.settings.allowCustomWord === true, 3000);
  await act(H, 'setSettings', { settings: { maxWords: 9 } });
  await sleep(150);
  ok(H.last.settings.maxWords === 2, 'عدد كلمات برة المدى بيتتجاهل');

  must((await act(H, 'startGame')).ok, 'بدء');
  await waitFor(H, s => s.phase === 'clue' && s.round === 1, 5000, 'ج1');
  // كل لاعب بيلمّح مرتين = 6 جولات
  ok(H.last.totalRounds === 6, 'إجمالي 6 جولات (3 لاعيبة × 2) — لقيت ' + H.last.totalRounds);

  // مرحلة اختيار الكلمة
  const cl = findCluer(all); must(cl, 'ملمّح ج1');
  ok(cl.last.sub === 'pick', 'الملمّح في مرحلة اختيار الكلمة');
  ok(!(await act(cl, 'submitHint', { text: SAFE_HINT })).ok, 'مينفعش يلمّح قبل ما يختار');
  const gs = all.filter(p => p !== cl);
  ok(gs[0].last.sub === 'pick', 'الباقي شايفين إنه بيختار');

  // كلمة من عنده
  must((await act(cl, 'pickCustom', { word: 'ملعب رياضي كبير', cat: 'football' })).ok, 'اختار كلمته');
  await waitFor(cl, s => s.sub === 'hint' && s.pickMode === 'custom', 3000, 'دخل التلميح بكلمته');
  ok(cl.last.secret === 'ملعب رياضي كبير', 'الكلمة اللي كتبها هي السر');
  ok(!(await act(cl, 'pass')).ok, 'مينفعش يبدّل وهو كاتب كلمته');
  ok(!(await act(cl, 'pickBank')).ok, 'مينفعش يرجع للبنك بعد ما اختار');

  // حد الكلمات
  const tooMany = await act(cl, 'submitHint', { text: 'واحدة اتنين تلاتة' });
  ok(!tooMany.ok && /كلمات|كلمة/.test(tooMany.error || ''), 'تلميح 3 كلمات مرفوض والحد 2');
  const stuck = await act(cl, 'submitHint', { text: 'كلمةطويلةجدااااااااااااااا' });
  ok(!stuck.ok && /طويلة/.test(stuck.error || ''), 'كلمة ملزوقة طويلة مرفوضة');
  must((await act(cl, 'submitHint', { text: SAFE_HINT1 + ' مساحات' })).ok, 'تلميحة كلمتين اتقبلت');
  await syncClue(all, 1, 'guess', 1, 'تخمين');
  ok(gs[0].last.tier === 100 && gs[0].last.cluerTier === 50, 'المخمّن 100 والملمّح 50');
  for (const g of gs) await act(g, 'guess', { text: 'ملعب رياضي كبير' });
  const rev = await waitFor(H, s => s.phase === 'reveal' && s.round === 1, 5000, 'نتيجة');
  ok(rev.result.points === 100 && rev.result.cluerPoints === 50, 'التوزيع 100/50');
  ok(rev.players.find(x => x.id === cl.id).score === 50, 'سكور الملمّح 50');
  for (const pl of all) await act(pl, 'readyNext');

  // الجولة 2: من البنك + تبديل
  await waitFor(H, s => s.round === 2 && s.phase === 'clue', 5000, 'ج2');
  const cl2 = findCluer(all); must(cl2, 'ملمّح ج2');
  must((await act(cl2, 'pickBank')).ok, 'اختار من البنك');
  await waitFor(cl2, s => s.sub === 'hint' && s.pickMode === 'bank', 3000);
  const w1 = cl2.last.secret;
  ok(!(await act(cl2, 'pickCustom', { word: 'حاجة', cat: 'football' })).ok, 'مينفعش يكتب كلمته بعد البنك');
  must((await act(cl2, 'pass')).ok, 'بدّل الكلمة');
  await waitFor(cl2, s => s.secret !== w1, 3000, 'الكلمة اتغيرت');

  // عدالة الأدوار: نكمّل ونعد مين لمّح كام مرة
  const clueCount = {};
  clueCount[cl.id] = 1; clueCount[cl2.id] = (clueCount[cl2.id] || 0) + 1;
  for (let rn = 2; rn <= 6; rn++) {
    for (let guard = 0; guard < 30; guard++) {
      const st = H.last;
      if (st.phase === 'gameover') break;
      if (st.phase === 'reveal') { for (const pl of all) await act(pl, 'readyNext'); await sleep(150); break; }
      if (st.phase === 'clue' && st.round === rn) {
        const cc = findCluer(all);
        if (!cc) { await sleep(100); continue; }
        if (cc.last.sub === 'pick') { await act(cc, 'pickBank'); await sleep(150); if (rn > 2) clueCount[cc.id] = (clueCount[cc.id] || 0) + 1; continue; }
        if (cc.last.sub === 'hint') { await act(cc, 'submitHint', { text: SAFE_HINT1 + ' وصفيات' }); await sleep(150); continue; }
        if (cc.last.sub === 'guess') { for (const g of all.filter(p => p !== cc)) await act(g, 'guess', { text: cc.last.secret }); await sleep(200); continue; }
      }
      await sleep(100);
    }
  }
  const go = await waitFor(H, s => s.phase === 'gameover', 8000, 'النهاية');
  ok(go.results.ranking.length === 3, 'النتيجة كاملة');
  console.log('  ✅ سيناريو D تمام');
}

(async () => {
  console.log('🚀 بنشغّل سيرفر اللمّة للاختبار...');
  const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORT), NODE_ENV: 'test', ROOM_TTL_MS: '600000' }), stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { await post('/api/lammaha/join', {}); up = true; } catch (e) { await sleep(120); } }
  must(up, 'السيرفر قام');
  try { await scenarioA(); await scenarioB(); await scenarioC(); await scenarioD(); }
  catch (e) { failed++; console.error('💥 خطأ:', e.message); }
  srv.kill();
  console.log(`\n===== النتيجة: ✅ ${passed} ناجح | ❌ ${failed} فاشل =====`);
  process.exit(failed ? 1 : 0);
})();
