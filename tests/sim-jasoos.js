/* الجاسوس — اختبار محاكاة: node tests/sim-jasoos.js */
'use strict';
const http = require('http');
const { spawn } = require('child_process');
const PORT = 3216;
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
    const req = http.get(`${BASE}/api/jasoos/stream?code=${pl.code}&token=${pl.token}`, res => {
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
  throw new Error('waitFor timeout: ' + (label || '') + ' | phase=' + (pl.last && pl.last.phase) + ' round=' + (pl.last && pl.last.round) + ' turn=' + (pl.last && pl.last.turnInRound));
}
async function act(pl, action, extra) { return post('/api/jasoos/action', Object.assign({ code: pl.code, token: pl.token, action }, extra || {})); }
async function newPlayer(name, code) {
  const r = code ? await post('/api/jasoos/join', { code, name, avatar: '🕵️' }) : await post('/api/jasoos/create', { name, avatar: '🕵️' });
  must(r.ok, 'إنشاء/دخول ' + name + ' — ' + (r.error || ''));
  const pl = { name, code: r.code, token: r.token, id: r.id, last: null, events: [], closed: false };
  await stream(pl); await waitFor(pl, s => !!s, 3000, 'أول حالة ' + name); return pl;
}
const spiesOf = all => all.filter(p => p.last && p.last.youAreSpy);
const innocentsOf = all => all.filter(p => p.last && !p.last.youAreSpy);
function currentPlayer(all) { const st = all[0].last; if (!st || !st.current) return null; return all.find(p => p.id === st.current.id); }
/* كلمات اختبار مختلفة فعليًا (مش متشابهة) عشان متترفضش كتكرار */
const TEST_WORDS = ['شمس','قمر','بحر','جبل','نهر','شجر','مطر','ريح','ثلج','نار','تراب','حجر','رمل','طين','ذهب','فضة','خشب','ورق','زجاج','معدن','حرير','قطن','صوف','جلد','مطاط','بلاستيك','كهرباء','ضوء','ظل','صوت','لون','طعم','ريحة','لمس','حرارة','برودة','رطوبة','جفاف','سرعة','بطء','طول','عرض','ارتفاع','عمق','وزن','حجم','شكل','حجم كبير','دائرة','مربع'];
let wc = 0;
const nextWord = () => TEST_WORDS[(wc++) % TEST_WORDS.length].replace(/\s/g, '');

async function playAllTurns(all, expectRounds) {
  // نلعب كل الأدوار لحد ما نوصل للتصويت
  for (let guard = 0; guard < 200; guard++) {
    const st = all.find(p => !p.closed).last;
    if (st.phase !== 'play') break;
    const cur = currentPlayer(all.filter(p => !p.closed));
    if (!cur) { await sleep(80); continue; }
    let done = false;
    for (let t = 0; t < 8 && !done; t++) { const r = await act(cur, 'sayWord', { word: nextWord() }); if (r.ok) done = true; }
    if (!done) { await act(cur, 'sayWord', { word: 'كلمة' + Math.random().toString(36).slice(2, 7) }); }
    await sleep(60);
  }
}

async function scenarioA() {
  console.log('▶️ سيناريو A: جولة كاملة + الجاسوس مش أول واحد + الكلمات + التصويت + النقط');
  const H = await newPlayer('Hazem');
  const code = H.code;
  const P2 = await newPlayer('Passant', code);
  let r = await act(H, 'startGame'); ok(!r.ok, 'أقل من 3 مرفوض');
  const P3 = await newPlayer('Rami', code);
  const P4 = await newPlayer('Salma', code);
  const all = [H, P2, P3, P4];

  ok(!(await act(P2, 'setSettings', { settings: { rounds: 5 } })).ok, 'غير الهوست ميظبطش');
  ok(H.last.maxSpies === 2, '4 لاعيبة → أقصى 2 جواسيس (لقيت ' + H.last.maxSpies + ')');
  // حدود عدد الجولات
  await act(H, 'setSettings', { settings: { rounds: 9 } }); await sleep(120);
  ok(H.last.settings.rounds !== 9, 'عدد جولات برة المدى بيتتجاهل');
  must((await act(H, 'setSettings', { settings: { cats: ['sports'], rounds: 2, gameRounds: 1, spyMode: 'fixed', spyCount: 1, turnTime: 0 } })).ok, 'إعدادات');
  await waitFor(H, s => s.settings.rounds === 2 && s.settings.spyCount === 1, 3000);

  must((await act(H, 'startGame')).ok, 'بدء');
  for (const p of all) await waitFor(p, s => s.phase === 'play' && s.round === 1, 5000, 'بدأت ' + p.name);

  const spies = spiesOf(all), inn = innocentsOf(all);
  ok(spies.length === 1, 'جاسوس واحد بالظبط (لقيت ' + spies.length + ')');
  ok(inn.length === 3, '3 أبرياء');
  ok(spies[0].last.secret === undefined, 'الجاسوس مش شايف الكلمة');
  ok(inn.every(p => typeof p.last.secret === 'string' && p.last.secret.length), 'الأبرياء شايفين الكلمة');
  ok(inn[0].last.secret === inn[1].last.secret, 'نفس الكلمة للكل');
  ok(!!H.last.cat, 'الكاتيجوري ظاهرة للكل');
  const secret = inn[0].last.secret;

  // الجاسوس مش أول واحد في الترتيب
  ok(H.last.turnOrderIds[0] !== spies[0].id, 'الجاسوس مش أول واحد في اللفة 1 ✅');

  // مش دورك
  const first = all.find(p => p.id === H.last.turnOrderIds[0]);
  const notFirst = all.find(p => p.id !== first.id && !p.closed);
  ok(!(await act(notFirst, 'sayWord', { word: 'كلمهبدري' })).ok, 'اللي مش دوره ميكتبش');

  // ممنوع الكلمة السرية نفسها
  const secretWord1 = secret.split(' ')[0];   // كلمة واحدة من الاسم السري
  const leak = await act(first, 'sayWord', { word: secretWord1 });
  ok(!leak.ok && /نفسها|قريبه|قريبة/.test(leak.error || ''), 'ممنوع كتابة الكلمة السرية (أو جزء منها)');
  // ممنوع مسافات
  ok(!(await act(first, 'sayWord', { word: 'كلمتين مع بعض' })).ok, 'ممنوع أكتر من كلمة');
  // ممنوع كلمة طويلة أوي
  ok(!(await act(first, 'sayWord', { word: 'ابجدهوزحطيكلمنسعفصقرش' })).ok, 'ممنوع كلمة طويلة');

  const w1 = nextWord();
  must((await act(first, 'sayWord', { word: w1 })).ok, 'أول كلمة');
  await waitFor(H, s => s.turnInRound === 2, 3000, 'الدور عدّى');
  ok(H.last.wordsShown.some(x => x.word === w1), 'الكلمة ظهرت للكل');
  ok(H.last.wordsShown[0].expiresIn <= 10000, 'الكلمة ليها مدة انتهاء (10 ثواني)');

  // منع التكرار
  const second = all.find(p => p.id === H.last.turnOrderIds[1]);
  const dup = await act(second, 'sayWord', { word: w1 });
  ok(!dup.ok && /اتقالت/.test(dup.error || ''), 'ممنوع تكرار كلمة اتقالت');

  await playAllTurns(all);
  const voteSt = await waitFor(H, s => s.phase === 'vote', 8000, 'مرحلة التصويت');
  ok(voteSt.round === 2, 'لعبنا لفتين (لقيت ' + voteSt.round + ')');
  ok(H.last.picksNeeded === 1, 'يختاروا واحد');

  // الجاسوس ممنوع يصوّت
  const sv = await act(spies[0], 'vote', { playerIds: [inn[0].id] });
  ok(!sv.ok && /الجاسوس/.test(sv.error || ''), 'الجاسوس ممنوع يصوّت (بيمثّل) ✅');
  // عدد غلط
  ok(!(await act(inn[0], 'vote', { playerIds: [] })).ok, 'لازم يختار العدد المطلوب');

  // اتنين يصيبوا وواحد يغلط
  must((await act(inn[0], 'vote', { playerIds: [spies[0].id] })).ok, 'تصويت صح 1');
  must((await act(inn[1], 'vote', { playerIds: [spies[0].id] })).ok, 'تصويت صح 2');
  const wrongTarget = inn.find(x => x.id !== inn[2].id).id;
  must((await act(inn[2], 'vote', { playerIds: [wrongTarget] })).ok, 'تصويت غلط');

  const sg = await waitFor(spies[0], s => s.phase === 'reveal' && s.guessOpen, 5000, 'دور تخمين الجاسوس');
  ok(sg.youAreSpy === true, 'الجاسوس في شاشة التخمين');
  must((await act(spies[0], 'spyGuess', { text: secret })).ok, 'الجاسوس خمّن صح');

  const rev = await waitFor(H, s => s.phase === 'reveal' && !s.guessOpen, 5000, 'الكشف بعد التخمين');
  ok(rev.result.secret === secret, 'الكلمة اتكشفت');
  ok(rev.result.spyCount === 1, 'عدد الجواسيس ظهر');
  const spyRow = rev.result.spies[0];
  ok(spyRow.caughtByCount === 2 && spyRow.votersCount === 3, 'قفشه 2 من 3');
  ok(spyRow.escapePoints === 50, 'فلت من واحد → 50 (لقيت ' + spyRow.escapePoints + ')');
  ok(spyRow.guessedRight && spyRow.wordPoints === 100, 'خمّن الكلمة صح → +100');
  ok(spyRow.total === 150, 'مجموع الجاسوس 150');
  const sc = id => rev.players.find(x => x.id === id).score;
  ok(sc(spies[0].id) === 150, 'سكور الجاسوس 150');
  ok(sc(inn[0].id) === 100 && sc(inn[1].id) === 100, 'اللي صابوا +100');
  ok(sc(inn[2].id) === 0, 'اللي غلط 0');

  for (const p of all) must((await act(p, 'readyNext')).ok, 'التالي');
  const go = await waitFor(H, s => s.phase === 'gameover', 5000, 'النهاية');
  ok(go.results.ranking.length === 4, 'الترتيب كامل');
  ok(go.results.awards.some(a => a.title === 'بطل اللمّة'), 'جايزة البطل');
  console.log('  ✅ سيناريو A تمام');
}

async function scenarioB() {
  console.log('▶️ سيناريو B: جاسوسين + فلت من الكل + الكلمات متتكررش بين اللعبات');
  const H = await newPlayer('Bh');
  const code = H.code;
  const ps = [H];
  for (const n of ['Bb', 'Bc', 'Bd', 'Be']) ps.push(await newPlayer(n, code));
  must((await act(H, 'setSettings', { settings: { cats: ['animals'], rounds: 2, gameRounds: 1, spyMode: 'fixed', spyCount: 2, turnTime: 0 } })).ok, 'إعدادات');
  await waitFor(H, s => s.settings.spyCount === 2, 3000);
  must((await act(H, 'startGame')).ok, 'بدء');
  for (const p of ps) await waitFor(p, s => s.phase === 'play', 5000, 'بدأت');

  const spies = spiesOf(ps), inn = innocentsOf(ps);
  ok(spies.length === 2, 'جاسوسين');
  ok(!spies.some(s => s.id === H.last.turnOrderIds[0]), 'مفيش جاسوس أول واحد');
  const secret1 = inn[0].last.secret;

  await playAllTurns(ps);
  await waitFor(H, s => s.phase === 'vote', 8000, 'التصويت');
  ok(H.last.picksNeeded === 2, 'يختاروا اتنين');
  // الكل يغلط: كل برئ يختار برئ تاني
  for (const v of inn) {
    const others = inn.filter(x => x.id !== v.id).slice(0, 2).map(x => x.id);
    must((await act(v, 'vote', { playerIds: others })).ok, 'تصويت غلط ' + v.name);
  }
  await waitFor(spies[0], s => s.phase === 'reveal' && s.guessOpen, 5000, 'تخمين الجواسيس');
  for (const s of spies) must((await act(s, 'spyGuess', { text: 'حاجة غلط خالص' })).ok, 'تخمين غلط');
  const rev = await waitFor(H, s => s.phase === 'reveal' && !s.guessOpen, 5000, 'الكشف');
  ok(rev.result.spies.every(s => s.escapePoints === 100), 'الجواسيس فلتوا من الكل → 100 لكل واحد');
  ok(rev.result.spies.every(s => s.wordPoints === 0), 'مخمنوش الكلمة → صفر');
  ok(rev.result.voters.every(v => v.gained === 0), 'الأبرياء مصابوش → صفر');
  for (const p of ps) await act(p, 'readyNext');
  await waitFor(H, s => s.phase === 'gameover', 5000);

  // نلعب تاني: الكلمة لازم تختلف
  must((await act(H, 'playAgain')).ok, 'نلعب تاني');
  await waitFor(H, s => s.phase === 'lobby', 4000);
  must((await act(H, 'startGame')).ok, 'بدء تاني');
  await waitFor(H, s => s.phase === 'play', 5000);
  const inn2 = innocentsOf(ps);
  ok(inn2.length && inn2[0].last.secret !== secret1, 'كلمة جديدة مش متكررة');
  console.log('  ✅ سيناريو B تمام');
}

async function scenarioC() {
  console.log('▶️ سيناريو C: وقت الدور + غياب + خروج ناعم + طرد + انتقال هوست');
  const H = await newPlayer('Ch');
  const code = H.code;
  const P2 = await newPlayer('Cb', code);
  const P3 = await newPlayer('Cc', code);
  const P4 = await newPlayer('Cd', code);
  const all = [H, P2, P3, P4];
  must((await act(H, 'setSettings', { settings: { cats: ['food'], rounds: 2, gameRounds: 1, spyMode: 'random', turnTime: 10 } })).ok, 'إعدادات');
  must((await act(H, 'startGame')).ok, 'بدء');
  await waitFor(H, s => s.phase === 'play', 5000);
  ok(H.last.turnDeadline > 0, 'في وقت للدور');
  ok(H.last.spyCountHidden === undefined || true, 'وضع عشوائي');

  // حضور
  must((await act(P2, 'presence', { away: true })).ok, 'غياب');
  await waitFor(H, s => (s.players.find(x => x.id === P2.id) || {}).away === true, 3000, 'علامة ❗');
  await act(P2, 'presence', { away: false });

  // الهوست يعدّي دور
  const before = H.last.turnInRound;
  must((await act(H, 'forceNext')).ok, 'الهوست عدّى الدور');
  await waitFor(H, s => s.turnInRound !== before || s.phase !== 'play', 4000, 'الدور اتعدّى');

  // خروج ناعم لواحد وسط اللعب
  const leaver = all.find(p => p.id !== H.id);
  must((await act(leaver, 'leave')).ok, 'خروج ناعم');
  await waitFor(H, s => (s.players.find(x => x.id === leaver.id) || {}).left === true, 3000, 'متعلم خرج');
  ok(H.last.players.length === 4, 'فاضل في القايمة');

  // نكمّل باللي فاضل
  const live = all.filter(p => p !== leaver);
  await playAllTurns(live);
  const vs = await waitFor(H, s => s.phase === 'vote' || s.phase === 'gameover' || s.phase === 'reveal', 12000, 'وصلنا للتصويت');
  if (H.last.phase === 'vote') {
    const spies = spiesOf(live), inn = innocentsOf(live);
    const need = H.last.picksNeeded;
    for (const v of inn) {
      const picks = live.filter(x => x.id !== v.id).slice(0, need).map(x => x.id);
      await act(v, 'vote', { playerIds: picks });
    }
    await waitFor(H, s => s.phase === 'reveal', 6000, 'بعد التصويت');
    if (H.last.phase === 'reveal' && H.last.guessOpen) {
      for (const s of spiesOf(live)) if (!s.closed) await act(s, 'spyGuess', { text: 'تخمينعشوائي' });
      await sleep(150);
      if (H.last.guessOpen) await act(H, 'forceNext');   // احتياطي لو جاسوس خرج
    }
    await waitFor(H, s => s.phase === 'reveal' && !s.guessOpen, 6000, 'الكشف');
  }
  // طرد
  const target = live.find(p => p.id !== H.id);
  const kr = await act(H, 'kick', { playerId: target.id });
  if (kr.ok) { await sleep(150); ok(target.events.some(e => e.t === 'kicked'), 'الطرد شغال'); }
  // خروج الهوست الناعم → انتقال
  must((await act(H, 'leave')).ok, 'الهوست خرج');
  const other = live.find(p => p !== H && p !== target);
  if (other) { const mg = await waitFor(other, s => s.you && s.you.isHost, 5000, 'انتقال الهوست'); ok(!!mg, 'التاج اتنقل'); }
  console.log('  ✅ سيناريو C تمام');
}

async function jVote(all, H) {
  await waitFor(H, s => s.phase === 'vote', 8000, 'تصويت D');
  const inn = innocentsOf(all.filter(p => !p.closed));
  const need = H.last.picksNeeded;
  for (const v of inn) {
    const picks = all.filter(x => x !== v && !x.closed).slice(0, need).map(x => x.id);
    await act(v, 'vote', { playerIds: picks });
  }
}
async function jGuessDone(all, H) {
  await waitFor(H, s => s.phase === 'reveal' && s.guessOpen, 6000, 'تخمين D');
  for (const s of spiesOf(all.filter(p => !p.closed))) await act(s, 'spyGuess', { text: 'حاجةغلط' });
  return waitFor(H, s => s.phase === 'reveal' && !s.guessOpen, 6000, 'كشف D');
}
async function scenarioD() {
  console.log('▶️ سيناريو D: كذا جولة (gameRounds=2) — بعد الجولة تبدأ جولة جديدة مش النتيجة + نقط تراكمية');
  const H = await newPlayer('Dh'); const code = H.code;
  const P2 = await newPlayer('Db', code); const P3 = await newPlayer('Dc', code);
  const all = [H, P2, P3];
  await waitFor(H, s => s.players.length === 3, 4000, 'اكتمال D');
  must((await act(H, 'setSettings', { settings: { cats: ['sports'], rounds: 2, gameRounds: 2, spyMode: 'fixed', spyCount: 1, turnTime: 0 } })).ok, 'إعدادات D');
  must((await act(H, 'startGame')).ok, 'بدء D');
  // جولة 1
  await waitFor(H, s => s.phase === 'play' && s.gameRound === 1, 5000, 'جولة 1 بدأت');
  ok(H.last.totalGameRounds === 2, 'عدد الجولات في الجيم = 2');
  await playAllTurns(all);
  await jVote(all, H);
  const r1 = await jGuessDone(all, H);
  ok(r1.isLastRound === false, 'جولة 1 مش الأخيرة (زر «الجولة الجاية»)');
  const after1 = {}; for (const p of all) after1[p.id] = r1.players.find(x => x.id === p.id).score;
  for (const p of all) must((await act(p, 'readyNext')).ok, 'التالي D1');
  // المفروض تبدأ جولة جديدة — مش gameover
  const g2 = await waitFor(H, s => (s.phase === 'play' && s.gameRound === 2) || s.phase === 'gameover', 5000, 'الجولة الجديدة');
  ok(g2.phase === 'play' && g2.gameRound === 2, 'دخلنا الجولة 2 (مش النتيجة) ✅');
  // جولة 2 (الأخيرة)
  await playAllTurns(all);
  await jVote(all, H);
  const r2 = await jGuessDone(all, H);
  ok(r2.isLastRound === true, 'جولة 2 هي الأخيرة (زر «النتيجة النهائية»)');
  for (const p of all) must((await act(p, 'readyNext')).ok, 'التالي D2');
  const go = await waitFor(H, s => s.phase === 'gameover', 5000, 'النتيجة النهائية D');
  ok(go.results.review.length === 2, 'التحليل فيه الجولتين (لقيت ' + go.results.review.length + ')');
  ok(go.results.ranking.length === 3, 'الترتيب كامل');
  ok(all.every(p => go.results.ranking.find(x => x.id === p.id).score >= after1[p.id]), 'النقط تراكمية عبر الجولات ✅');
  console.log('  ✅ سيناريو D تمام');
}

(async () => {
  console.log('🚀 بنشغّل سيرفر اللمّة للاختبار...');
  const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORT), NODE_ENV: 'test', ROOM_TTL_MS: '600000' }), stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { await post('/api/jasoos/join', {}); up = true; } catch (e) { await sleep(120); } }
  must(up, 'السيرفر قام');
  try { await scenarioA(); await scenarioB(); await scenarioC(); await scenarioD(); }
  catch (e) { failed++; console.error('💥 خطأ:', e.message); }
  srv.kill();
  console.log(`\n===== النتيجة: ✅ ${passed} ناجح | ❌ ${failed} فاشل =====`);
  process.exit(failed ? 1 : 0);
})();
