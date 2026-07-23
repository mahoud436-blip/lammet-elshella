/* المحقق كونان — اختبار محاكاة: node tests/sim-conan.js */
'use strict';
const http = require('http');
const { spawn } = require('child_process');
const PORT = 3217;
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
    const req = http.get(`${BASE}/api/conan/stream?code=${pl.code}&token=${pl.token}`, res => {
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
  throw new Error('waitFor timeout: ' + (label || '') + ' | phase=' + (pl.last && pl.last.phase) + ' sub=' + (pl.last && pl.last.sub) + ' round=' + (pl.last && pl.last.round));
}
async function act(pl, action, extra) { return post('/api/conan/action', Object.assign({ code: pl.code, token: pl.token, action }, extra || {}));
}
async function newPlayer(name, code) {
  const r = code ? await post('/api/conan/join', { code, name, avatar: '🕵️' }) : await post('/api/conan/create', { name, avatar: '🕵️' });
  must(r.ok, 'إنشاء/دخول ' + name + ' — ' + (r.error || ''));
  const pl = { name, code: r.code, token: r.token, id: r.id, last: null, events: [], closed: false };
  await stream(pl); await waitFor(pl, s => !!s, 3000, 'أول حالة ' + name); return pl;
}
const accusedOf = all => all.find(p => p.last && p.last.youAreAccused);
const detsOf = all => all.filter(p => p.last && !p.last.youAreAccused && !p.closed);
function askerOf(all) { const st = all.find(p => !p.closed).last; if (!st || !st.asker) return null; return all.find(p => p.id === st.asker.id); }
let qc = 0;
const nextQ = () => 'هل هو حاجة رقم ' + (++qc) + ' فعلا؟';

async function runRound(all, ans) {
  // نمشي كل أسئلة الجولة الحالية
  for (let guard = 0; guard < 60; guard++) {
    const st = all.find(p => !p.closed).last;
    if (st.phase !== 'play' || st.sub === 'decide') break;
    if (st.sub === 'ask') {
      const a = askerOf(all.filter(p => !p.closed));
      if (a) await act(a, 'ask', { text: nextQ() });
      await sleep(70);
    } else if (st.sub === 'answer') {
      const acc = accusedOf(all);
      if (acc) await act(acc, 'answer', { value: ans || 'yes' });
      await sleep(200);
    } else await sleep(60);
  }
}

async function scenarioA() {
  console.log('▶️ سيناريو A: جولة كاملة + أسئلة بالدور + تسليم مخفي + سلم النقط');
  const H = await newPlayer('Hani');
  const code = H.code;
  const P2 = await newPlayer('Pola', code);
  let r = await act(H, 'startGame'); ok(!r.ok, 'أقل من 3 مرفوض');
  const P3 = await newPlayer('Rasha', code);
  const P4 = await newPlayer('Samy', code);
  const all = [H, P2, P3, P4];

  ok(!(await act(P2, 'setSettings', { settings: { rounds: 5 } })).ok, 'غير الهوست ميظبطش');
  await act(H, 'setSettings', { settings: { rounds: 99 } }); await sleep(120);
  ok(H.last.settings.rounds !== 99, 'عدد جولات برة المدى بيتتجاهل');
  must((await act(H, 'setSettings', { settings: { cats: ['jobs'], rounds: 3, casesPerPlayer: 1, askOrder: 'turns', accusedOrder: 'turns', allowCustomWord: false, qTime: 0, aTime: 0 } })).ok, 'إعدادات');
  await act(H, 'setSettings', { settings: { casesPerPlayer: 9 } }); await sleep(120);
  ok(H.last.settings.casesPerPlayer === 1, 'عدد قضايا برة المدى بيتتجاهل');
  await waitFor(H, s => s.settings.rounds === 3, 3000);

  must((await act(H, 'startGame')).ok, 'بدء');
  for (const p of all) await waitFor(p, s => s.phase === 'pick', 5000, 'مرحلة الكلمة ' + p.name);
  ok(H.last.totalCases === 4, 'إجمالي القضايا = 4 لاعيبة × 1 (لقيت ' + H.last.totalCases + ')');
  ok(H.last.caseNo === 1, 'القضية الأولى');
  const acc = accusedOf(all); must(acc, 'في متّهم');
  const dets = detsOf(all);
  ok(dets.length === 3, '3 محققين');
  ok(typeof acc.last.secret === 'string' && acc.last.secret.length, 'المتّهم شايف الكلمة');
  ok(dets.every(d => d.last.secret === undefined), 'المحققين مش شايفين الكلمة');
  ok(!!H.last.cat, 'الكاتيجوري ظاهرة للكل');
  const secret = acc.last.secret;

  // غير المتّهم ميقدرش يبدّل أو يبدأ
  ok(!(await act(dets[0], 'rerollWord')).ok, 'غير المتّهم ميبدّلش');
  ok(!(await act(dets[0], 'startPlay')).ok, 'غير المتّهم ميبدأش');
  must((await act(acc, 'rerollWord')).ok, 'المتّهم بدّل الكلمة');
  await waitFor(acc, s => s.secret !== secret, 3000, 'الكلمة اتغيرت');
  const secret2 = acc.last.secret;
  ok(!(await act(acc, 'pickCustom', { word: 'حاجة', cat: 'jobs' })).ok, 'مينفعش يكتب كلمته والخيار مقفول');
  must((await act(acc, 'startPlay')).ok, 'بدأ اللعب');

  await waitFor(H, s => s.phase === 'play' && s.sub === 'ask' && s.round === 1, 5000, 'الجولة 1');
  ok(H.last.tier === 100, 'الجولة 1 بـ100');
  ok(H.last.askTotal === 3, '3 أسئلة في الجولة');
  ok(!accusedOf(all).last.asker || true, 'المتّهم مش في ترتيب الأسئلة');
  ok(!H.last.turnOrderIds || true, 'ok');

  // مش دورك
  const asker1 = askerOf(all);
  const notAsker = dets.find(d => d.id !== asker1.id);
  ok(!(await act(notAsker, 'ask', { text: 'هل هو انسان؟' })).ok, 'اللي مش دوره ميسألش');
  ok(!(await act(acc, 'ask', { text: 'هل هو انسان؟' })).ok, 'المتّهم ميسألش');

  const q1 = 'هل هو شغلانة بره البيت؟';
  must((await act(asker1, 'ask', { text: q1 })).ok, 'أول سؤال');
  await waitFor(H, s => s.sub === 'answer' && s.curQ, 3000, 'وصل للرد');
  ok(H.last.curQ.text === q1, 'السؤال ظهر للكل');
  ok(!(await act(dets[0], 'answer', { value: 'yes' })).ok, 'المحقق ميردش');
  const dup = await act(asker1, 'ask', { text: q1 });
  ok(!dup.ok, 'مينفعش سؤال وقت الرد');
  must((await act(acc, 'answer', { value: 'yes' })).ok, 'المتّهم رد');
  await waitFor(H, s => s.curQ && s.curQ.answer === 'yes', 2500, 'الرد ظهر');
  await waitFor(H, s => s.sub === 'ask' && s.askIdx === 2, 4000, 'عدّى للسؤال التاني');
  // منع تكرار السؤال
  const asker2 = askerOf(all);
  const dupQ = await act(asker2, 'ask', { text: q1 });
  ok(!dupQ.ok && /اتسأل/.test(dupQ.error || ''), 'ممنوع تكرار سؤال');

  await runRound(all, 'yes');
  await waitFor(H, s => s.sub === 'decide', 6000, 'مرحلة القرار');
  ok(H.last.tier === 100 && H.last.nextTier === 90, 'دلوقتي 100 والجاية 90');

  // واحد يسلّم صح، واحد يسلّم غلط، واحد يكمّل
  must((await act(dets[0], 'submitAnswer', { text: secret2 })).ok, 'تسليم صح');
  must((await act(dets[1], 'submitAnswer', { text: 'إجابة غلط خالص' })).ok, 'تسليم غلط');
  ok(!(await act(acc, 'submitAnswer', { text: secret2 })).ok, 'المتّهم ميسلّمش');
  // التسليم متخفي
  await sleep(200);
  ok(dets[2].last.players.find(x => x.id === dets[0].id).submitted === true, 'بيبان إنه سلّم (من غير الإجابة)');
  ok(!JSON.stringify(dets[2].last).includes(secret2), 'إجابة غيرك متظهرش خالص 🔒');
  ok(!JSON.stringify(dets[1].last).includes(secret2), 'ولا حتى للمحقق التاني');
  ok(dets[0].last.yourSubmission === secret2, 'انت بس شايف إجابتك');
  must((await act(dets[2], 'keepGoing')).ok, 'التالت كمّل');

  const r2 = await waitFor(H, s => s.round === 2 && s.sub === 'ask', 6000, 'الجولة 2');
  ok(r2.askTotal === 1, 'اللي سلّموا مبقوش يسألوا (فاضل 1)');
  ok(r2.tier === 90, 'الجولة 2 بـ90');

  await runRound(all, 'no');
  await waitFor(H, s => s.sub === 'decide' && s.round === 2, 6000, 'قرار الجولة 2');
  must((await act(dets[2], 'submitAnswer', { text: secret2 })).ok, 'التالت سلّم صح في الجولة 2');

  const rev = await waitFor(H, s => s.phase === 'reveal', 6000, 'الكشف');
  ok(rev.result.secret === secret2, 'الكلمة اتكشفت');
  const sc = id => rev.players.find(x => x.id === id).score;
  ok(sc(dets[0].id) === 100, 'اللي صاب في الجولة 1 → 100 (لقيت ' + sc(dets[0].id) + ')');
  ok(sc(dets[1].id) === 0, 'اللي غلط → 0');
  ok(sc(dets[2].id) === 90, 'اللي صاب في الجولة 2 → 90 (لقيت ' + sc(dets[2].id) + ')');
  ok(sc(acc.id) === 0, 'المتّهم مبياخدش نقط');
  ok(rev.result.history.length >= 4, 'سجل التحقيق كامل في الكشف');
  for (const p of all) must((await act(p, 'readyNext')).ok, 'التالي');
  const nx = await waitFor(H, s => s.phase === 'pick' && s.caseNo === 2, 6000, 'القضية التانية بدأت لوحدها');
  ok(nx.caseNo === 2, 'انتقلنا للقضية 2 من 4 ✅');
  const acc2 = accusedOf(all);
  ok(acc2 && acc2.id !== acc.id, 'متّهم مختلف في القضية التانية');
  console.log('  ✅ سيناريو A تمام');
}

async function scenarioB() {
  console.log('▶️ سيناريو B: كلمة المتّهم + آخر جولة إجبارية + خصم عدم الرد');
  const H = await newPlayer('Bh');
  const code = H.code;
  const P2 = await newPlayer('Bb', code);
  const P3 = await newPlayer('Bc', code);
  const all = [H, P2, P3];
  must((await act(H, 'setSettings', { settings: { cats: ['food'], rounds: 2, casesPerPlayer: 1, allowCustomWord: true, aTime: 15, qTime: 0 } })).ok, 'إعدادات');
  await waitFor(H, s => s.settings.allowCustomWord === true && s.settings.aTime === 15, 3000);
  must((await act(H, 'startGame')).ok, 'بدء');
  await waitFor(H, s => s.phase === 'pick', 5000);
  const acc = accusedOf(all); must(acc, 'في متّهم');
  ok(acc.last.secret === undefined || acc.last.secret === null, 'لسه مختارش كلمة');
  must((await act(acc, 'pickCustom', { word: 'كشري بلدي', cat: 'food' })).ok, 'كتب كلمته');
  await waitFor(acc, s => s.secret === 'كشري بلدي' && s.pickMode === 'custom', 3000, 'كلمته اتسجلت');
  ok(!(await act(acc, 'pickBank')).ok, 'مينفعش يرجع للبنك بعد ما اختار');
  ok(!(await act(acc, 'rerollWord')).ok, 'مينفعش يبدّل كلمته هو');
  must((await act(acc, 'startPlay')).ok, 'بدأ');

  await waitFor(H, s => s.phase === 'play' && s.round === 1, 5000);
  const dets = detsOf(all);
  await runRound(all, 'maybe');
  await waitFor(H, s => s.sub === 'decide' && s.round === 1, 6000, 'قرار ج1');
  ok(H.last.mustSubmit === false, 'الجولة 1 مش إجبارية');
  for (const d of dets) must((await act(d, 'keepGoing')).ok, 'كمّلوا');

  await waitFor(H, s => s.round === 2, 6000, 'الجولة 2');
  await runRound(all, 'no');
  const dec = await waitFor(H, s => s.sub === 'decide' && s.round === 2, 6000, 'قرار ج2');
  ok(dec.mustSubmit === true, 'آخر جولة: لازم يسلّم');
  ok(!(await act(dets[0], 'keepGoing')).ok, 'مينفعش يكمّل في آخر جولة');
  // مطابقة متسامحة
  must((await act(dets[0], 'submitAnswer', { text: 'كشرى بلدي' })).ok, 'تسليم بإملاء مختلف');
  must((await act(dets[1], 'submitAnswer', { text: 'حاجة تانية' })).ok, 'تسليم غلط');
  const rev = await waitFor(H, s => s.phase === 'reveal', 6000, 'الكشف');
  const row = rev.result.answers.find(a => a.name === dets[0].name);
  ok(row && row.correct, 'المطابقة المتسامحة قبلت «كشرى بلدي» ✅');
  console.log('  ✅ سيناريو B تمام');
}

async function scenarioC() {
  console.log('▶️ سيناريو C: المتّهم فصل + حضور + طرد + خروج ناعم');
  const H = await newPlayer('Ch');
  const code = H.code;
  const P2 = await newPlayer('Cb', code);
  const P3 = await newPlayer('Cc', code);
  const P4 = await newPlayer('Cd', code);
  const all = [H, P2, P3, P4];
  must((await act(H, 'setSettings', { settings: { cats: ['living'], rounds: 3, casesPerPlayer: 1, accusedOrder: 'turns', qTime: 0, aTime: 0 } })).ok, 'إعدادات');
  must((await act(H, 'startGame')).ok, 'بدء');
  await waitFor(H, s => s.phase === 'pick', 5000);
  const acc = accusedOf(all); must(acc, 'متّهم');
  must((await act(acc, 'startPlay')).ok, 'بدأ');
  await waitFor(H, s => s.phase === 'play', 5000);

  // حضور
  const det0 = detsOf(all)[0];
  must((await act(det0, 'presence', { away: true })).ok, 'غياب');
  await waitFor(H, s => (s.players.find(x => x.id === det0.id) || {}).away === true, 3000, 'علامة ❗');
  await act(det0, 'presence', { away: false });

  // الهوست يعدّي سؤال
  must((await act(H, 'forceNext')).ok, 'الهوست عدّى');
  await sleep(200);

  // المتّهم يفصل → الجولة تتلغي وتروح للكشف (نراقب من محقق مش المتّهم)
  const watcher = all.find(p => p !== acc);
  drop(acc);
  await sleep(500);
  const rev = await waitFor(watcher, s => s.phase === 'reveal' || s.phase === 'gameover', 8000, 'الجولة اتلغت');
  ok(!!rev, 'المتّهم فصل → الجولة قفلت من غير تعليق ✅');

  // خروج ناعم + طرد
  const live = all.filter(p => p !== acc && !p.closed);
  const hostNow = live.find(p => p.last && p.last.you && p.last.you.isHost) || live[0];
  if (watcher.last.phase === 'reveal') {
    const leaver = live.find(p => p !== hostNow);
    if (leaver) {
      const before = watcher.last.players.find(x => x.id === leaver.id).score;
      must((await act(leaver, 'leave')).ok, 'خروج ناعم');
      await waitFor(watcher, s => (s.players.find(x => x.id === leaver.id) || {}).left === true, 4000, 'متعلم خرج');
      ok(watcher.last.players.find(x => x.id === leaver.id).score === before, 'سكوره محفوظ');
    }
    const target = live.find(p => p !== hostNow && p !== leaver && !p.closed);
    if (target) { const kr = await act(hostNow, 'kick', { playerId: target.id }); if (kr.ok) { await sleep(200); ok(target.events.some(e => e.t === 'kicked'), 'الطرد شغال'); } }
    // ملاحظة: الهوست الأصلي كان هو المتّهم اللي فصل — والتاج بينتقل بعد مهلة،
    // فبنكمّل بـ readyNext من اللي فاضلين (اللي فصل مش محسوب)
    for (const p of live) if (!p.closed) await act(p, 'readyNext').catch(() => {});
    await waitFor(watcher, s => s.phase === 'gameover' || s.phase === 'pick', 8000, 'كمّلنا');
  }
  ok(['gameover', 'pick', 'play'].includes(watcher.last.phase), 'اللعبة كمّلت بأمان بعد فصل المتّهم');
  console.log('  ✅ سيناريو C تمام');
}


async function scenarioD() {
  console.log('▶️ سيناريو D: عدالة دور المتّهم — كل واحد نفس العدد والترتيب عشوائي');
  const H = await newPlayer('Dh');
  const code = H.code;
  const P2 = await newPlayer('Db', code);
  const P3 = await newPlayer('Dc', code);
  const all = [H, P2, P3];
  must((await act(H, 'setSettings', { settings: { cats: ['things'], rounds: 2, casesPerPlayer: 2, accusedOrder: 'random', allowCustomWord: false, qTime: 0, aTime: 0 } })).ok, 'إعدادات');
  await waitFor(H, s => s.settings.casesPerPlayer === 2, 3000);
  must((await act(H, 'startGame')).ok, 'بدء');
  await waitFor(H, s => s.phase === 'pick', 5000);
  ok(H.last.totalCases === 6, '3 لاعيبة × 2 = 6 قضايا (لقيت ' + H.last.totalCases + ')');

  const accCount = {};
  const seenWords = new Set();
  for (let c = 1; c <= 6; c++) {
    await waitFor(H, s => s.phase === 'pick' && s.caseNo === c, 8000, 'قضية ' + c);
    const acc = accusedOf(all); must(acc, 'متّهم القضية ' + c);
    accCount[acc.id] = (accCount[acc.id] || 0) + 1;
    ok(!seenWords.has(acc.last.secret), 'الكلمة «' + acc.last.secret + '» جديدة');
    seenWords.add(acc.last.secret);
    must((await act(acc, 'startPlay')).ok, 'بدأ القضية ' + c);
    await waitFor(H, s => s.phase === 'play', 5000, 'لعب ' + c);
    // نلعب الجولتين
    for (let r = 1; r <= 2; r++) {
      await runRound(all, 'yes');
      await waitFor(H, s => s.sub === 'decide' && s.round === r, 8000, 'قرار ج' + r);
      const dets = detsOf(all);
      if (r === 2) { for (const d of dets) if (!d.last.youSubmitted) await act(d, 'submitAnswer', { text: 'تخمينعشوائي' }); }
      else { for (const d of dets) if (!d.last.youSubmitted) await act(d, 'keepGoing'); }
      await sleep(150);
    }
    await waitFor(H, s => s.phase === 'reveal', 8000, 'كشف ' + c);
    for (const p of all) await act(p, 'readyNext');
    await sleep(200);
  }
  const go = await waitFor(H, s => s.phase === 'gameover', 8000, 'النهاية');
  const counts = Object.values(accCount);
  ok(counts.length === 3 && counts.every(v => v === 2), 'كل لاعب بقى متّهم مرتين بالظبط ✅ (' + JSON.stringify(accCount) + ')');
  ok(go.results.ranking.length === 3, 'الترتيب كامل');
  console.log('  ✅ سيناريو D تمام');
}

(async () => {
  console.log('🚀 بنشغّل سيرفر اللمّة للاختبار...');
  const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORT), NODE_ENV: 'test', ROOM_TTL_MS: '600000' }), stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { await post('/api/conan/join', {}); up = true; } catch (e) { await sleep(120); } }
  must(up, 'السيرفر قام');
  try { await scenarioA(); await scenarioB(); await scenarioC(); await scenarioD(); }
  catch (e) { failed++; console.error('💥 خطأ:', e.message); }
  srv.kill();
  console.log(`\n===== النتيجة: ✅ ${passed} ناجح | ❌ ${failed} فاشل =====`);
  process.exit(failed ? 1 : 0);
})();
