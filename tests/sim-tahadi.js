/* تحدي الشلة — اختبار محاكاة كامل: node tests/sim.js */
'use strict';
const http = require('http');
const { spawn } = require('child_process');

const PORT = 3213;
const BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ❌ ' + msg); } }
function must(cond, msg) { if (!cond) { failed++; console.error('  💥 ' + msg); throw new Error(msg); } passed++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end(data);
  });
}

function stream(pl) {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/tahadi/stream?code=${pl.code}&token=${pl.token}`, res => {
      pl._res = res;
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const dataLine = block.split('\n').find(l => l.startsWith('data: '));
          if (!dataLine) continue;
          if (block.includes('event: ping')) continue;
          try {
            const d = JSON.parse(dataLine.slice(6));
            if (d.t === 'state') pl.last = d;
            else pl.events.push(d);
          } catch (e) {}
        }
      });
      res.on('close', () => { pl.closed = true; });
      resolve();
    });
    pl._req = req;
  });
}
function drop(pl) { try { pl._req.destroy(); } catch (e) {} }
async function waitFor(pl, pred, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 5000)) {
    if (pl.last && pred(pl.last)) return pl.last;
    await sleep(25);
  }
  throw new Error('waitFor timeout: ' + (label || pred.toString().slice(0, 60)) + ' | phase=' + (pl.last && pl.last.phase) + ' sub=' + (pl.last && pl.last.question && pl.last.question.sub));
}
async function act(pl, action, extra) {
  return post('/api/tahadi/action', Object.assign({ code: pl.code, token: pl.token, action }, extra || {}));
}

const CATS5 = ['movies', 'anime', 'geo_ar', 'sports', 'mix'];
const correctByText = new Map();
function selfSlot(cat, tag, n) {
  const q = `سؤال ${tag} رقم ${n} في ${cat}?`;
  const choices = [`صح-${tag}-${n}`, `غلط1-${tag}-${n}`, `غلط2-${tag}-${n}`];
  correctByText.set(q, choices[0]);
  return { cat, source: 'self', q, choices, a: 0 };
}
function buildSelfSlots(plan, tag) {
  const out = [];
  let n = 0;
  for (const c of plan) for (let i = 0; i < c.count; i++) out.push(selfSlot(c.id, tag, ++n));
  return out;
}
async function newPlayer(name, code) {
  const r = code ? await post('/api/tahadi/join', { code, name, avatar: '🦁' }) : await post('/api/tahadi/create', { name, avatar: '🦁' });
  must(r.ok, 'إنشاء/دخول ' + name + ' — ' + (r.error || ''));
  const pl = { name, code: r.code, token: r.token, id: r.id, last: null, events: [], closed: false };
  await stream(pl);
  await waitFor(pl, s => !!s, 3000, 'أول حالة لـ' + name);
  return pl;
}
async function answerRound(players, opts) {
  opts = opts || {};
  const host = players[0];
  const st = await waitFor(host, s => s.phase === 'quiz' && s.question && s.question.sub === 'answering', 8000, 'answering');
  const qText = st.question.text;
  const ct = correctByText.get(qText);
  const views = [];
  for (const pl of players) {
    const v = await waitFor(pl, s => s.question && s.question.i === st.question.i && s.question.sub === 'answering', 4000, 'sync q');
    ok(v.question.correct === undefined, 'anti-cheat: مفيش correct وقت الإجابة');
    ok(v.question.picks === undefined, 'anti-cheat: مفيش picks وقت الإجابة');
    views.push([pl, v]);
  }
  const ownerPair = views.find(([, v]) => v.question.isYours);
  if (ownerPair) {
    const r = await act(ownerPair[0], 'answer', { choice: 0 });
    ok(!r.ok, 'صاحب السؤال ميقدرش يجاوب');
  }
  for (const [pl, v] of views) {
    if (v.question.isYours) continue;
    let idx = v.question.choices.indexOf(ct);
    must(idx >= 0, 'الإجابة الصح موجودة ضمن الاختيارات');
    if (opts.wrong && opts.wrong.includes(pl.id)) idx = (idx + 1) % 3;
    if (opts.skipAnswer && opts.skipAnswer.includes(pl.id)) continue;
    if (opts.delayMs && opts.delayMs[pl.id]) await sleep(opts.delayMs[pl.id]);
    const r = await act(pl, 'answer', { choice: idx });
    ok(r.ok, 'إجابة اتقبلت لـ' + pl.name + ' — ' + (r.error || ''));
  }
  const rev = await waitFor(host, s => s.question && s.question.i === st.question.i && s.question.sub === 'reveal', 9000, 'reveal');
  return rev;
}

/* ============================================================ */
async function scenario1_full4players() {
  console.log('▶️ سيناريو 1: أربع لاعيبة — النظام الجديد (سؤال × كاتيجوري) + جولة كاملة');
  const A = await newPlayer('Adam');
  const code = A.code;
  const B = await newPlayer('Basma', code);
  const C = await newPlayer('Cima', code);
  const D = await newPlayer('Dodo', code);
  const all = [A, B, C, D];

  let r = await act(B, 'setSettings', { settings: { qTime: 0 } });
  ok(!r.ok, 'غير الهوست ميظبطش الإعدادات');

  // مستويات البنك: سهل / متوسط / صعب
  ok(A.last.settings.level === 'easy', 'المستوى الافتراضي سهل');
  ok(Array.isArray(A.last.levels) && A.last.levels.length === 3, 'التلات مستويات بتوصل للواجهة');
  must((await act(A, 'setSettings', { settings: { level: 'hard' } })).ok, 'الهوست اختار صعب');
  await waitFor(A, s => s.settings.level === 'hard', 3000, 'المستوى اتحدد');
  ok(!(await act(B, 'setSettings', { settings: { level: 'easy' } })).ok, 'غير الهوست ميغيرش المستوى');
  await act(A, 'setSettings', { settings: { level: 'مستحيل' } });
  await sleep(150);
  ok(A.last.settings.level === 'hard', 'مستوى غلط بيتتجاهل');
  must((await act(A, 'setSettings', { settings: { level: 'easy' } })).ok, 'رجوع للسهل');
  await waitFor(A, s => s.settings.level === 'easy', 3000);

  // الحد الأقصى 20: 7 في الكاتيجوري × 5 كاتيجوري = 35 → البدء يترفض
  must((await act(A, 'setSettings', { settings: { qPerCat: 7, qTime: 0, cats: CATS5 } })).ok, 'إعدادات 7×5');
  await waitFor(A, s => s.qTotal === 35);
  r = await act(A, 'startWriting');
  ok(!r.ok && /20/.test(r.error || ''), 'إجمالي فوق 20 مرفوض');

  // معادلات مختلفة: 2×5=10 ثم كاتيجوري واحدة ×10=10 ثم نرجع 1×5=5
  must((await act(A, 'setSettings', { settings: { qPerCat: 2 } })).ok, '2 لكل كاتيجوري');
  await waitFor(A, s => s.qTotal === 10);
  ok(A.last.plan.every(c => c.count === 2), 'الخطة: 2 في كل كاتيجوري');
  must((await act(A, 'setSettings', { settings: { qPerCat: 10, cats: ['mix'] } })).ok, '10 في كاتيجوري واحدة');
  await waitFor(A, s => s.qTotal === 10 && s.settings.cats.length === 1);
  must((await act(A, 'setSettings', { settings: { qPerCat: 1, cats: CATS5 } })).ok, 'رجوع 1×5');
  await waitFor(A, s => s.qTotal === 5 && s.settings.cats.length === 5);

  r = await post('/api/tahadi/join', { code, name: 'Adam', avatar: '🐼' });
  ok(!r.ok, 'الاسم المكرر مرفوض');
  r = await post('/api/tahadi/join', { code: '0001', name: 'X' });
  ok(!r.ok, 'روم غلط مرفوض');

  ok((await act(A, 'startWriting')).ok, 'بدء مرحلة الكتابة');
  const st = await waitFor(A, s => s.phase === 'writing');
  ok(st.drawsLeft === 15, 'رصيد السحب = 3 محاولات × عدد الأسئلة');

  for (const pl of all) {
    const slots = buildSelfSlots(st.plan, pl.name);
    const rr = await act(pl, 'submitQuestions', { slots });
    must(rr.ok, 'تسليم أسئلة ' + pl.name + ' — ' + (rr.error || ''));
  }
  await waitFor(A, s => s.autoStartAt != null, 3000, 'autoStartAt ظهر');
  await waitFor(A, s => s.phase === 'quiz', 6000, 'البدء التلقائي اشتغل');
  must(A.last.question.total === 20, 'الدِك = 20 سؤال (4×5) — لقيت ' + A.last.question.total);

  for (let i = 0; i < 20; i++) {
    const rev = await answerRound(all, { wrong: [D.id] });
    for (const p of rev.question.picks) {
      if (p.id === D.id) ok(p.gained === 0, 'الغلطان ياخد 0');
      else ok(p.gained === 100, 'من غير تايمر: الصح = 100 بالظبط (لقيت ' + p.gained + ')');
    }
    ok((await act(A, 'next')).ok, 'التالي/إنهاء');
  }
  const res = await waitFor(A, s => s.phase === 'results', 5000, 'النتايج');
  const R = res.results;
  must(R.ranking.length === 4, 'الترتيب فيه 4');
  const dRow = R.ranking.find(x => x.id === D.id);
  ok(dRow.score === 0 && dRow.rank === 4, 'Dodo آخر واحد بصفر');
  for (const row of R.ranking) if (row.id !== D.id) ok(row.score === 1500, 'كل صح = 15×100 = 1500 (لقيت ' + row.score + ')');
  ok(R.awards.some(a => a.title === 'بطل الشلة'), 'جايزة البطل موجودة');
  ok(R.awards.some(a => a.title === 'القنّاص'), 'جايزة القناص موجودة');
  ok(R.awards.some(a => a.title === 'المُحيِّر'), 'جايزة المحيّر موجودة');
  ok(!R.awards.some(a => a.title === 'الصاروخ'), 'من غير تايمر مفيش صاروخ');
  ok(R.review.length === 20, 'المراجعة فيها 20 سؤال');
  ok(R.review.every(q => Array.isArray(q.picks) && q.picks.every(p => typeof p.ok === 'boolean')), 'كل سؤال في المراجعة فيه مين صح ومين غلط');
  const dBest = R.bestSource.find(b => b.id === D.id);
  ok(/ولا إجابة/.test(dBest.text), 'أفضل مصدر للغلطان = ولا إجابة');

  ok((await act(A, 'playAgain')).ok, 'نلعب تاني');
  const lb = await waitFor(A, s => s.phase === 'lobby');
  ok(lb.players.every(p => p.score === 0), 'النقط اتصفرت');
  console.log('  ✅ سيناريو 1 تمام');
}

/* ============================================================ */
async function scenario2_timer() {
  console.log('▶️ سيناريو 2: التايمر وبونص السرعة');
  const A = await newPlayer('Timo');
  const code = A.code;
  const B = await newPlayer('Bara', code);
  const C = await newPlayer('Cika', code);
  const all = [A, B, C];
  must((await act(A, 'setSettings', { settings: { qPerCat: 1, qTime: 5, cats: CATS5 } })).ok, 'إعدادات تايمر');
  must((await act(A, 'startWriting')).ok, 'كتابة');
  const st = await waitFor(A, s => s.phase === 'writing');
  for (const pl of all) must((await act(pl, 'submitQuestions', { slots: buildSelfSlots(st.plan, pl.name) })).ok, 'تسليم ' + pl.name);
  await waitFor(A, s => s.phase === 'quiz', 6000);
  must(A.last.question.total === 15, 'الدِك 15');

  {
    const stq = await waitFor(A, s => s.question && s.question.sub === 'answering');
    const ct = correctByText.get(stq.question.text);
    const eligible = [];
    for (const pl of all) { const v = await waitFor(pl, s => s.question && s.question.i === stq.question.i); if (!v.question.isYours) eligible.push(pl); }
    const fast = eligible[0], silent = eligible[1];
    const t0 = Date.now();
    must((await act(fast, 'answer', { choice: fast.last.question.choices.indexOf(ct) })).ok, 'السريع جاوب');
    const rev = await waitFor(A, s => s.question && s.question.i === stq.question.i && s.question.sub === 'reveal', 9000, 'reveal بالوقت');
    ok(Date.now() - t0 >= 4200, 'الكشف حصل بعد انتهاء الوقت مش قبله');
    const pf = rev.question.picks.find(p => p.id === fast.id);
    ok(pf.gained > 100 && pf.gained <= 150, 'بونص السرعة بين 100 و150 (لقيت ' + pf.gained + ')');
    ok(!rev.question.picks.some(p => p.id === silent.id), 'الساكت مش في الإجابات');
    ok(rev.players.find(p => p.id === silent.id).score === 0, 'الساكت رصيده 0');
    must((await act(A, 'next')).ok, 'التالي');
  }
  {
    const stq = await waitFor(A, s => s.question && s.question.sub === 'answering');
    const ct = correctByText.get(stq.question.text);
    const eligible = [];
    for (const pl of all) { const v = await waitFor(pl, s => s.question && s.question.i === stq.question.i); if (!v.question.isYours) eligible.push(pl); }
    const [e1, e2] = eligible;
    must((await act(e1, 'answer', { choice: e1.last.question.choices.indexOf(ct) })).ok, 'الأول جاوب');
    await sleep(1600);
    must((await act(e2, 'answer', { choice: e2.last.question.choices.indexOf(ct) })).ok, 'التاني جاوب');
    const rev = await waitFor(A, s => s.question && s.question.i === stq.question.i && s.question.sub === 'reveal', 9000);
    const g1 = rev.question.picks.find(p => p.id === e1.id).gained;
    const g2 = rev.question.picks.find(p => p.id === e2.id).gained;
    ok(g1 > g2, 'الأسرع خد بونص أكبر (' + g1 + ' > ' + g2 + ')');
    must((await act(A, 'next')).ok, 'التالي');
  }
  for (let i = 2; i < 15; i++) {
    await answerRound(all, {});
    must((await act(A, 'next')).ok, 'التالي/إنهاء');
  }
  const res = await waitFor(A, s => s.phase === 'results', 6000);
  ok(res.results.awards.some(a => a.title === 'الصاروخ'), 'جايزة الصاروخ ظهرت مع التايمر');
  console.log('  ✅ سيناريو 2 تمام');
}

/* ============================================================ */
async function scenario3_bank_forced() {
  console.log('▶️ سيناريو 3: البنك الإجباري — سحب نهائي بالإجابة + حذف فوري + رصيد + عدم تكرار');
  const H = await newPlayer('Host3');
  const code = H.code;
  const P = await newPlayer('Player3', code);
  must((await act(H, 'setSettings', { settings: { qPerCat: 1, qTime: 0, cats: CATS5 } })).ok, 'إعدادات');
  must((await act(H, 'startWriting')).ok, 'كتابة');
  let st = await waitFor(H, s => s.phase === 'writing' && s.bankLeft);
  ok(st.bankLeft.mix === 100, 'العداد = أسئلة المستوى المختار بس (100 من 300) — لقيت ' + st.bankLeft.mix);
  ok(st.bankLeft.mix === 100, 'البنك كامل في mix = 100');

  // سحب H: بيرجع السؤال + الإجابة فورًا، وبينحذف من البنك في نفس اللحظة
  const d1 = await act(H, 'bankDraw', { cat: 'mix' });
  must(d1.ok, 'سحب H');
  ok(Number.isInteger(d1.item.a) && d1.item.a >= 0 && d1.item.a <= 2, 'السحب بيرجع الإجابة على طول (إجباري)');
  ok(Array.isArray(d1.item.choices) && d1.item.choices.length === 3, 'ومعاه الـ3 اختيارات');
  const bid = d1.item.bankId;
  correctByText.set(d1.item.q, d1.item.choices[d1.item.a]);
  await waitFor(H, s => s.bankLeft.mix === 99, 3000, 'اتحذف من البنك فورًا (99)');
  await waitFor(P, s => s.bankLeft && s.bankLeft.mix === 99, 3000, 'العداد نقص عند التاني كمان');

  // سحوبات P: عمرها ما تجيب سؤال H + كل سحبة بتنقص البنك + الرصيد بيخلص
  const pDrawn = [];
  for (let i = 0; i < 5; i++) {
    const dd = await act(P, 'bankDraw', { cat: 'mix' });
    must(dd.ok, 'سحبة P رقم ' + (i + 1));
    ok(dd.item.bankId !== bid, 'سؤال H عمره ما يطلع لحد تاني');
    ok(!pDrawn.includes(dd.item.bankId), 'ولا سحبة بتتكرر');
    pDrawn.push(dd.item.bankId);
  }
  await waitFor(H, s => s.bankLeft.mix === 94, 3000, 'بعد 1+5 سحبات: فاضل 94');
  for (let i = 5; i < 15; i++) {
    const dd = await act(P, 'bankDraw', { cat: 'mix' });
    must(dd.ok, 'سحبة تبديل رقم ' + (i + 1));
    ok(!pDrawn.includes(dd.item.bankId) && dd.item.bankId !== bid, 'التبديل بيجيب جديد دايمًا');
    pDrawn.push(dd.item.bankId);
  }
  await waitFor(H, s => s.bankLeft.mix === 84, 3000, 'بعد 1+15 سحبة: فاضل 84');
  const over = await act(P, 'bankDraw', { cat: 'mix' });
  ok(!over.ok && /محاولات/.test(over.error || ''), 'رصيد السحب = 3× أسئلته (15) وبعدها يترفض');

  // P ميقدرش يسلّم سؤال اتسحب لـ H
  const stealSlots = buildSelfSlots(st.plan, 'P3x');
  const mi = stealSlots.findIndex(s => s.cat === 'mix');
  stealSlots[mi] = { cat: 'mix', source: 'bank', bankId: bid };
  const steal = await act(P, 'submitQuestions', { slots: stealSlots });
  ok(!steal.ok, 'مينفعش تسلّم سؤال مش طالعلك انت');

  // تسليم مخالف للخطة مرفوض
  const hSlots = buildSelfSlots(st.plan, 'H3');
  const hmi = hSlots.findIndex(s => s.cat === 'mix');
  hSlots[hmi] = { cat: 'mix', source: 'bank', bankId: bid };
  const badSlots = hSlots.map(s => ({ ...s }));
  badSlots[0] = { ...badSlots[0], cat: 'anime' };
  ok(!(await act(H, 'submitQuestions', { slots: badSlots })).ok, 'تسليم مخالف للتوزيع مرفوض');

  must((await act(H, 'submitQuestions', { slots: hSlots })).ok, 'تسليم H مع سؤال البنك بتاعه');
  must((await act(P, 'submitQuestions', { slots: buildSelfSlots(st.plan, 'P3') })).ok, 'تسليم P');
  await waitFor(H, s => s.phase === 'quiz', 6000);
  must(H.last.question.total === 10, 'الدِك 10');
  for (let i = 0; i < 10; i++) {
    await answerRound([H, P], {});
    must((await act(H, 'next')).ok, 'التالي');
  }
  await waitFor(H, s => s.phase === 'results', 5000);
  ok(H.last.results.review.some(q => q.fromBank), 'سؤال البنك ظهر في المراجعة');

  // جولة تانية في نفس الروم: المحذوف مايرجعش أبدًا
  must((await act(H, 'playAgain')).ok, 'نلعب تاني');
  await waitFor(H, s => s.phase === 'lobby');
  must((await act(H, 'startWriting')).ok, 'كتابة تاني');
  st = await waitFor(H, s => s.phase === 'writing' && s.bankLeft);
  ok(st.bankLeft.mix === 84, 'المحذوف (16) فاضل محذوف بين الجولات — ' + st.bankLeft.mix);
  const seen = new Set([bid, ...pDrawn]);
  for (let i = 0; i < 5; i++) {
    const dd = await act(H, 'bankDraw', { cat: 'mix' });
    must(dd.ok, 'سحبة جولة 2 رقم ' + (i + 1));
    ok(!seen.has(dd.item.bankId), 'ولا سؤال قديم رجع تاني');
  }
  await waitFor(H, s => s.bankLeft.mix === 79, 3000, 'استمرارية العداد: 79');
  console.log('  ✅ سيناريو 3 تمام');
}

/* ============================================================ */
async function scenario4_reconnect_kick_migrate() {
  console.log('▶️ سيناريو 4: إعادة اتصال + طرد + انتقال الهوست');
  const H = await newPlayer('Host4');
  const code = H.code;
  const P = await newPlayer('Ply4', code);
  const K = await newPlayer('Kick4', code);
  must((await act(H, 'setSettings', { settings: { qPerCat: 1, qTime: 0, cats: CATS5 } })).ok, 'إعدادات');
  must((await act(H, 'startWriting')).ok, 'كتابة');
  const st = await waitFor(H, s => s.phase === 'writing' && s.bankLeft);

  // K يسحب سؤال (اتحذف من البنك) وبعدين يتطرد → يفضل محذوف (وصل لحد = خلاص)
  const dk = await act(K, 'bankDraw', { cat: 'mix' });
  must(dk.ok, 'K سحب');
  await waitFor(H, s => s.bankLeft.mix === 99, 3000, 'العداد 99 بعد سحبة K');
  must((await act(H, 'kick', { playerId: K.id })).ok, 'طرد K');
  await waitFor(H, s => s.players.length === 2, 3000, 'K اتشال');
  await sleep(300);
  ok(H.last.bankLeft.mix === 99, 'سؤال K فاضل محذوف حتى بعد طرده');
  ok(K.events.some(e => e.t === 'kicked'), 'K وصله إشعار الطرد');

  for (const pl of [H, P]) must((await act(pl, 'submitQuestions', { slots: buildSelfSlots(st.plan, pl.name) })).ok, 'تسليم ' + pl.name);
  await waitFor(H, s => s.phase === 'quiz', 6000);

  drop(P);
  await sleep(400);
  const rj = await post('/api/tahadi/join', { code, token: P.token });
  ok(rj.ok && rj.resumed, 'الرجوع بنفس التوكن');
  await stream(P);
  const back = await waitFor(P, s => s.phase === 'quiz' && s.question, 4000, 'استئناف الحالة');
  ok(back.question.sub === 'answering' || back.question.sub === 'reveal', 'رجع لنفس السؤال');

  for (let guard = 0; guard < 30; guard++) {
    const cur = await waitFor(H, s => s.phase === 'results' || (s.question && (s.question.sub === 'answering' || s.question.sub === 'reveal')), 9000, 'حالة لعب');
    if (cur.phase === 'results') break;
    const qi = cur.question.i;
    if (cur.question.sub === 'answering') await answerRound([H, P], {});
    must((await act(H, 'next')).ok, 'التالي');
    await waitFor(H, s => s.phase === 'results' || (s.question && s.question.i > qi), 8000, 'تقدم السؤال');
  }
  await waitFor(H, s => s.phase === 'results', 6000);

  must((await act(H, 'leave')).ok, 'الهوست خرج');
  const mg = await waitFor(P, s => s.you && s.you.isHost, 4000, 'انتقال الهوست');
  const hRow = mg.players.find(x => x.id === H.id);
  ok(mg.players.length === 2 && hRow && hRow.left === true, 'الهوست الخارج فاضل بسكوره ومتعلم عليه 🚪');
  await sleep(150);
  ok(H.events.some(e => e.t === 'left') || H.closed, 'الهوست القديم اتقفل عنده الستريم');
  console.log('  ✅ سيناريو 4 تمام');
}

/* ============================================================ */
async function blindRound(players) {
  const host = players[0];
  const st = await waitFor(host, s => s.phase === 'quiz' && s.question && s.question.sub === 'answering', 8000, 'answering');
  const views = [];
  for (const pl of players) {
    const v = await waitFor(pl, s => s.question && s.question.i === st.question.i && s.question.sub === 'answering', 4000, 'sync q');
    views.push([pl, v]);
  }
  const ownerPair = views.find(([, v]) => v.question.isYours);
  if (ownerPair) ok(!(await act(ownerPair[0], 'answer', { choice: 0 })).ok, 'صاحب السؤال ميجاوبش');
  for (const [pl, v] of views) {
    if (v.question.isYours) continue;
    must((await act(pl, 'answer', { choice: 0 })).ok, 'إجابة عمياء ' + pl.name);
  }
  await waitFor(host, s => s.question && s.question.i === st.question.i && s.question.sub === 'reveal', 8000, 'reveal');
  return st.question.i;
}

async function scenario5_forceComplete() {
  console.log('▶️ سيناريو 5: الهوست بدأ واللي متأخر اتحسبله اللي خلصه واتكمّل من البنك');
  const H = await newPlayer('Hf5');
  const code = H.code;
  const P = await newPlayer('Pf5', code);
  must((await act(H, 'setSettings', { settings: { qPerCat: 1, qTime: 0, cats: CATS5 } })).ok, 'إعدادات');
  must((await act(H, 'startWriting')).ok, 'كتابة');
  const st = await waitFor(H, s => s.phase === 'writing' && s.bankLeft);

  must((await act(H, 'submitQuestions', { slots: buildSelfSlots(st.plan, 'Hf5') })).ok, 'تسليم الهوست');

  // P كتب سؤالين بنفسه وسحب واحد من البنك.. ومسلّمش
  const dP = await act(P, 'bankDraw', { cat: 'mix' });
  must(dP.ok, 'P سحب من البنك');
  const s1 = selfSlot('movies', 'Pf5', 1);
  const s2 = selfSlot('anime', 'Pf5', 2);
  must((await act(P, 'syncDraft', { slots: [s1, s2, { cat: 'mix', source: 'bank', bankId: dP.item.bankId }, null, null] })).ok, 'مزامنة المسودة');

  must((await act(H, 'forceStartQuiz')).ok, 'الهوست بدأ باللي جاهز');
  await waitFor(H, s => s.phase === 'quiz', 6000, 'الكويز بدأ');
  must(H.last.question.total === 10, 'الدِك كامل 10 (اتكمّلت أسئلة المتأخر) — لقيت ' + H.last.question.total);

  for (let guard = 0; guard < 12 && H.last.phase !== 'results'; guard++) {
    const qi = await blindRound([H, P]);
    must((await act(H, 'next')).ok, 'التالي');
    await waitFor(H, s => s.phase === 'results' || (s.question && s.question.i > qi), 8000, 'تقدم');
  }
  const res = await waitFor(H, s => s.phase === 'results', 6000, 'النتايج');
  const pRows = res.results.review.filter(q => q.ownerName === 'Pf5');
  must(pRows.length === 5, 'أسئلة المتأخر = 5 كاملة (لقيت ' + pRows.length + ')');
  ok(pRows.some(q => q.text === s1.q && !q.fromBank), 'سؤاله المكتوب 1 اتحسب');
  ok(pRows.some(q => q.text === s2.q && !q.fromBank), 'سؤاله المكتوب 2 اتحسب');
  ok(pRows.filter(q => q.fromBank).length === 3, 'الباقي (3) اتكمّل من البنك');
  console.log('  ✅ سيناريو 5 تمام');
}

/* ============================================================ */
(async () => {
  console.log('🚀 بنشغّل السيرفر للاختبار...');
  const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORT), NODE_ENV: 'test', ROOM_TTL_MS: '600000' }), stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { await post('/api/tahadi/join', {}); up = true; } catch (e) { await sleep(120); } }
  must(up, 'السيرفر قام');
  try {
    await scenario1_full4players();
    await scenario2_timer();
    await scenario3_bank_forced();
    await scenario4_reconnect_kick_migrate();
    await scenario5_forceComplete();
  } catch (e) {
    failed++;
    console.error('💥 خطأ في الاختبار:', e.message);
  }
  srv.kill();
  console.log(`\n===== النتيجة: ✅ ${passed} ناجح | ❌ ${failed} فاشل =====`);
  process.exit(failed ? 1 : 0);
})();
