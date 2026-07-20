/* حبر سري — اختبار محاكاة كامل: node tests/sim-wisper.js */
'use strict';
const http = require('http');
const { spawn } = require('child_process');

const PORT = 3214;
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
    const req = http.get(`${BASE}/api/wisper/stream?code=${pl.code}&token=${pl.token}`, res => {
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
  while (Date.now() - t0 < (ms || 6000)) {
    if (pl.last && pred(pl.last)) return pl.last;
    await sleep(25);
  }
  throw new Error('waitFor timeout: ' + (label || '') + ' | phase=' + (pl.last && pl.last.phase) + ' round=' + (pl.last && pl.last.round));
}
async function act(pl, action, extra) {
  return post('/api/wisper/action', Object.assign({ code: pl.code, token: pl.token, action }, extra || {}));
}
async function newPlayer(name, code) {
  const r = code ? await post('/api/wisper/join', { code, name, avatar: '🖋️' }) : await post('/api/wisper/create', { name, avatar: '🖋️' });
  must(r.ok, 'إنشاء/دخول ' + name + ' — ' + (r.error || ''));
  const pl = { name, code: r.code, token: r.token, id: r.id, last: null, events: [], closed: false };
  await stream(pl);
  await waitFor(pl, s => !!s, 3000, 'أول حالة ' + name);
  return pl;
}

/* يلعب جولة كاملة بإجابات وتخمينات صح؛ wrongFor: id لاعب يخمّن غلط (سواب) */
async function playRound(players, roundNo, opts) {
  opts = opts || {};
  const H = players[0];
  let st = await waitFor(H, s => s.round === roundNo && ['topic', 'vote', 'write'].includes(s.phase), 8000, 'بداية جولة ' + roundNo);

  if (st.phase === 'topic') {
    // مين الكاتب؟
    let writer = null;
    for (const pl of players) {
      const v = await waitFor(pl, s => s.round === roundNo && (s.phase !== 'topic' || s.writer), 5000, 'topic sync');
      if (v.phase === 'topic' && v.youAreWriter) writer = pl;
    }
    must(writer, 'في كاتب متحدد للجولة');
    const other = players.find(p => p !== writer);
    const bad = await act(other, 'submitTopic', { text: 'محاولة مش دوري' });
    ok(!bad.ok, 'غير الكاتب مش بيقدر يكتب العنوان');
    const wv = writer.last;
    ok(Array.isArray(wv.suggestions) && wv.suggestions.length > 0, 'الكاتب واصله اقتراحات من البنك');
    const topic = 'عنوان تجريبي رقم ' + roundNo;
    must((await act(writer, 'submitTopic', { text: topic })).ok, 'الكاتب سلّم العنوان');
    st = await waitFor(H, s => s.phase === 'write' && s.round === roundNo, 5000, 'write بعد الكتابة');
    ok(st.topic === topic && st.topicSource === 'writer', 'العنوان اتسجل ومصدره كاتب');
  } else if (st.phase === 'vote') {
    for (const pl of players) {
      const v = await waitFor(pl, s => s.round === roundNo && s.phase === 'vote', 5000, 'vote sync');
      ok(v.voteOptions.length === 3, '3 اختيارات في التصويت');
      must((await act(pl, 'vote', { choice: 0 })).ok, 'صوّت ' + pl.name);
    }
    st = await waitFor(H, s => s.phase === 'write' && s.round === roundNo, 5000, 'التصويت اتقفل لوحده');
    ok(st.topicSource === 'vote', 'مصدر العنوان تصويت — ومن غير أي زرار من الهوست');
  } else {
    ok(st.topicSource === 'random', 'جولة عشوائية دخلت الكتابة على طول');
  }
  if (opts.collectTopics) opts.collectTopics.push(st.topic);

  // الكتابة: الكل يسلّم (مع اختبار التعديل)
  const answers = {}; // text -> player
  let first = true;
  for (const pl of players) {
    const text = 'إجابة ' + pl.name + ' ج' + roundNo;
    if (first) {
      must((await act(pl, 'submitAnswer', { text: 'مسودة' })).ok, 'تسليم أولي');
      must((await act(pl, 'submitAnswer', { text })).ok, 'تعديل الإجابة قبل ما الكل يخلص');
      first = false;
    } else {
      must((await act(pl, 'submitAnswer', { text })).ok, 'إجابة ' + pl.name);
    }
    answers[text] = pl;
  }
  st = await waitFor(H, s => s.phase === 'guess' && s.round === roundNo, 5000, 'التخمين بدأ لوحده لما الكل سلّم');

  // التخمين
  for (const pl of players) {
    const v = await waitFor(pl, s => s.phase === 'guess' && s.round === roundNo, 5000, 'guess sync');
    ok(v.answers.length === players.length, 'عدد الإجابات = عدد اللاعيبة');
    ok(v.answers.every(a => a.owner === undefined && a.ownerName === undefined), 'anti-cheat: مفيش أصحاب الإجابات وقت التخمين');
    const mine = v.answers.find(a => a.isYours);
    ok(mine && answers[mine.text] === pl, 'إجابتي متعلمة صح');
    ok(v.roster.length === players.length - 1 && !v.roster.some(r => r.id === pl.id), 'الطاقم من غيري');
    const own = await act(pl, 'guess', { answerId: mine.id, playerId: v.roster[0].id });
    ok(!own.ok, 'مينفعش أخمّن على إجابتي');
    // تخصيص صحيح مع اختبار تكرار الاسم
    const others = v.answers.filter(a => !a.isYours);
    const firstOwnerId = v.roster.find(r => r.name === answers[others[0].text].name).id;
    must((await act(pl, 'guess', { answerId: others[0].id, playerId: firstOwnerId })).ok, 'تخمينة أولى');
    if (others.length > 1) {
      const dup = await act(pl, 'guess', { answerId: others[1].id, playerId: firstOwnerId });
      ok(!dup.ok && /مرة واحدة/.test(dup.error || ''), 'نفس الاسم مرتين مرفوض');
    }
    for (let i = 1; i < others.length; i++) {
      let ownerP = answers[others[i].text];
      let pid = v.roster.find(r => r.name === ownerP.name).id;
      if (opts.wrongFor === pl.id) {
        // سواب بين آخر اتنين → غلطتين
        const swapWith = answers[others[i - 1].text];
        pid = v.roster.find(r => r.name === (i === others.length - 1 ? answers[others[0].text] : swapWith).name).id;
        // بس الاسم ممكن يكون مستخدم — نظّف الأول
        await act(pl, 'guess', { answerId: others[i].id, playerId: '' });
        // استخدم اسم لسه متستخدمش: هنبني تخصيص غلط كامل بدل جزئي
      }
      const r = await act(pl, 'guess', { answerId: others[i].id, playerId: pid });
      if (!(opts.wrongFor === pl.id)) must(r.ok, 'تخمينة ' + pl.name);
    }
    if (opts.wrongFor === pl.id) {
      // ابنيله تخصيص غلط كامل: دوّر الأسماء (كل واحدة على اللي بعدها)
      for (const a of others) await act(pl, 'guess', { answerId: a.id, playerId: '' });
      const ownerIds = others.map(a => v.roster.find(r => r.name === answers[a.text].name).id);
      for (let i = 0; i < others.length; i++) {
        const wrongPid = ownerIds[(i + 1) % ownerIds.length];
        must((await act(pl, 'guess', { answerId: others[i].id, playerId: wrongPid })).ok, 'تخمينة غلط مقصودة');
      }
    }
  }
  st = await waitFor(H, s => s.phase === 'reveal' && s.round === roundNo, 6000, 'النتيجة ظهرت لوحدها لما الكل خلص');

  // تحقق النقط
  for (const pl of players) {
    const v = await waitFor(pl, s => s.phase === 'reveal' && s.round === roundNo, 4000, 'reveal sync');
    const g = (v.reveal.gains || {})[pl.id] || 0;
    if (opts.wrongFor === pl.id) ok(g === 0, 'الغلطان خد 0 (لقيت ' + g + ')');
    else ok(g === (players.length - 1) * 100, 'الصح = ' + ((players.length - 1) * 100) + ' (لقيت ' + g + ')');
  }
  // الكل يدوس التالي → الجولة الجاية لوحدها
  for (const pl of players) must((await act(pl, 'readyNext')).ok, 'التالي ' + pl.name);
  return st;
}

/* ============================================================ */
async function scenarioA_fullflow() {
  console.log('▶️ سيناريو A: السير الأوتوماتيكي الكامل (كتابة + تصويت + عشوائي)');
  const H = await newPlayer('Hoda');
  const code = H.code;
  const P2 = await newPlayer('Peter', code);
  let r = await act(H, 'startGame');
  ok(!r.ok, 'أقل من 3 مرفوض');
  const P3 = await newPlayer('Pola', code);
  const all = [H, P2, P3];

  r = await act(P2, 'setSettings', { settings: { writerRounds: 5 } });
  ok(!r.ok, 'غير الهوست ميظبطش الجولات');
  must((await act(H, 'setSettings', { settings: { writerRounds: 1, voteRounds: 1, randomRounds: 1 } })).ok, 'إعدادات 1+1+1');
  await waitFor(H, s => s.settings.writerRounds === 1 && s.settings.voteRounds === 1 && s.settings.randomRounds === 1);
  must((await act(H, 'startGame')).ok, 'بدء اللعبة');
  await waitFor(H, s => s.phase !== 'lobby', 4000, 'اللعبة بدأت');
  ok(H.last.totalRounds === 3, 'إجمالي 3 جولات');

  const topics = [];
  const seenTypes = new Set();
  for (let rn = 1; rn <= 3; rn++) {
    const before = await waitFor(H, s => s.round === rn && ['topic', 'vote', 'write'].includes(s.phase), 8000, 'نوع الجولة ' + rn);
    seenTypes.add(before.roundType);
    await playRound(all, rn, { collectTopics: topics, wrongFor: rn === 2 ? P3.id : null });
  }
  ok(seenTypes.has('writer') && seenTypes.has('vote') && seenTypes.has('random'), 'التلات أنواع ظهروا (بترتيب متخلط)');

  const go = await waitFor(H, s => s.phase === 'gameover', 6000, 'النهاية');
  const R = go.results;
  must(R.ranking.length === 3, 'الترتيب فيه 3');
  const p3row = R.ranking.find(x => x.id === P3.id);
  ok(p3row.score === 400 && p3row.rank === 3, 'اللي غلط جولة = 400 وآخر الترتيب');
  for (const row of R.ranking) if (row.id !== P3.id) ok(row.score === 600, 'الصح كله = 600 (لقيت ' + row.score + ')');
  ok(R.awards.some(a => a.title === 'بطل اللمّة'), 'جايزة البطل');
  ok(R.awards.some(a => a.title === 'المخبر'), 'جايزة المخبر');
  ok(R.awards.some(a => a.title === 'الحبر السري' || a.title === 'الكتاب المفتوح'), 'جوايز الغموض');
  must(R.review.length === 3, 'المراجعة 3 جولات');
  ok(R.review.map(x => x.topic).join('|') === topics.join('|'), 'عناوين المراجعة زي ما اتلعبت بالترتيب');
  ok(R.review.every(rd => rd.answers.every(a => a.picks.every(p => typeof p.ok === 'boolean'))), 'كل تخمينة متعلمة صح/غلط');
  console.log('  ✅ سيناريو A تمام');
}

/* ============================================================ */
async function scenarioB_noTopicRepeat() {
  console.log('▶️ سيناريو B: العناوين متتكررش أبدًا في نفس الروم (حتى بعد نلعب تاني)');
  const H = await newPlayer('Rami');
  const code = H.code;
  const P2 = await newPlayer('Rana', code);
  const P3 = await newPlayer('Rody', code);
  const all = [H, P2, P3];
  must((await act(H, 'setSettings', { settings: { writerRounds: 0, voteRounds: 0, randomRounds: 3 } })).ok, 'إعدادات 3 عشوائي');
  must((await act(H, 'startGame')).ok, 'بدء');
  const t1 = [];
  for (let rn = 1; rn <= 3; rn++) await playRound(all, rn, { collectTopics: t1 });
  await waitFor(H, s => s.phase === 'gameover', 6000);
  ok(new Set(t1).size === 3, 'التلات عناوين مختلفين');

  must((await act(H, 'playAgain')).ok, 'نلعب تاني');
  await waitFor(H, s => s.phase === 'lobby');
  must((await act(H, 'setSettings', { settings: { randomRounds: 3 } })).ok, 'إعدادات تاني');
  must((await act(H, 'startGame')).ok, 'بدء تاني');
  const t2 = [];
  for (let rn = 1; rn <= 3; rn++) await playRound(all, rn, { collectTopics: t2 });
  await waitFor(H, s => s.phase === 'gameover', 6000);
  ok(t2.every(t => !t1.includes(t)), 'ولا عنوان قديم رجع بعد نلعب تاني');
  console.log('  ✅ سيناريو B تمام');
}

/* ============================================================ */
async function scenarioC_resilience() {
  console.log('▶️ سيناريو C: انقطاع الكاتب + تصويت صامت + رجوع بالتوكن + طرد + انتقال هوست');
  const H = await newPlayer('Samy');
  const code = H.code;
  const P2 = await newPlayer('Sara', code);
  const P3 = await newPlayer('Simo', code);
  must((await act(H, 'setSettings', { settings: { writerRounds: 1, voteRounds: 1, randomRounds: 1 } })).ok, 'إعدادات');
  must((await act(H, 'startGame')).ok, 'بدء');

  let kicked = false;
  for (let rn = 1; rn <= 3; rn++) {
    const players = kicked ? [H, P2] : [H, P2, P3];
    let st = await waitFor(H, s => s.round === rn && ['topic', 'vote', 'write'].includes(s.phase), 8000, 'جولة ' + rn);

    if (st.phase === 'topic') {
      // لو الكاتب P3 والوقت مناسب: نفصله ونخلي الهوست يعدّي بعشوائي
      let writerPl = null;
      for (const pl of players) { const v = await waitFor(pl, s => s.round === rn, 4000); if (v.phase === 'topic' && v.youAreWriter) writerPl = pl; }
      if (writerPl && writerPl !== H && !kicked) {
        drop(writerPl);
        await sleep(300);
        must((await act(H, 'forceContinue')).ok, 'الهوست عدّى الكاتب المفصول');
        st = await waitFor(H, s => s.phase === 'write' && s.round === rn, 5000, 'كتابة بعد التعدية');
        ok(st.topicSource === 'random', 'العنوان بقى عشوائي بعد التعدية');
        const rj = await post('/api/wisper/join', { code, token: writerPl.token });
        ok(rj.ok && rj.resumed, 'الكاتب رجع بنفس التوكن');
        await stream(writerPl);
        await waitFor(writerPl, s => s.phase === 'write' && s.round === rn, 4000, 'استئناف');
      } else if (writerPl) {
        must((await act(writerPl, 'submitTopic', { text: 'عنوان سي ' + rn })).ok, 'الكاتب كتب');
        await waitFor(H, s => s.phase === 'write' && s.round === rn, 5000);
      }
    } else if (st.phase === 'vote') {
      // محدش يصوت → الهوست يعدّي → فايز بالقرعة
      must((await act(H, 'forceContinue')).ok, 'قفل تصويت من غير أصوات');
      st = await waitFor(H, s => s.phase === 'write' && s.round === rn, 5000);
      ok(st.topicSource === 'vote', 'عنوان بالتصويت رغم الصمت (قرعة)');
    }

    // الكتابة
    for (const pl of players) must((await act(pl, 'submitAnswer', { text: 'جواب ' + pl.name + rn })).ok, 'إجابة ' + pl.name);
    await waitFor(H, s => s.phase === 'guess' && s.round === rn, 5000, 'تخمين ج' + rn);

    // في الجولة 2: H مش هيخمّن — الهوست يعدّي بنفسه (بيختبر force في التخمين)
    const doers = rn === 2 ? players.filter(p => p !== H) : players;
    for (const pl of doers) {
      const v = await waitFor(pl, s => s.phase === 'guess' && s.round === rn, 4000);
      const others = v.answers.filter(a => !a.isYours);
      // تخصيص أي أسماء فريدة (مش مهم الصح هنا)
      const ids = v.roster.map(r => r.id);
      for (let i = 0; i < others.length; i++) must((await act(pl, 'guess', { answerId: others[i].id, playerId: ids[i % ids.length] })).ok, 'تخمين ' + pl.name);
    }
    if (rn === 2) {
      must((await act(H, 'forceContinue')).ok, 'الهوست كشف باللي خلصوا');
    }
    await waitFor(H, s => s.phase === 'reveal' && s.round === rn, 6000, 'نتيجة ج' + rn);

    // بعد نتيجة الجولة 2: اطرد P3
    if (rn === 2 && !kicked) {
      must((await act(H, 'kick', { playerId: P3.id })).ok, 'طرد P3');
      await sleep(250);
      ok(P3.events.some(e => e.t === 'kicked'), 'P3 وصله إشعار الطرد');
      kicked = true;
    }
    const ready = kicked ? [H, P2] : players;
    for (const pl of ready) must((await act(pl, 'readyNext')).ok, 'التالي ' + pl.name);
  }
  const go = await waitFor(H, s => s.phase === 'gameover', 8000, 'النهاية');
  ok(go.results.ranking.length === 2, 'المطرود مش في الترتيب النهائي');

  must((await act(H, 'leave')).ok, 'الهوست خرج');
  const mg = await waitFor(P2, s => s.you && s.you.isHost, 5000, 'انتقال الهوست');
  ok(mg.players.length === 1, 'فاضل لاعب واحد');
  console.log('  ✅ سيناريو C تمام');
}

/* ============================================================ */
(async () => {
  console.log('🚀 بنشغّل سيرفر اللمّة للاختبار...');
  const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORT), NODE_ENV: 'test', ROOM_TTL_MS: '600000' }), stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { await post('/api/wisper/join', {}); up = true; } catch (e) { await sleep(120); } }
  must(up, 'السيرفر قام');
  try {
    await scenarioA_fullflow();
    await scenarioB_noTopicRepeat();
    await scenarioC_resilience();
  } catch (e) {
    failed++;
    console.error('💥 خطأ في الاختبار:', e.message);
  }
  srv.kill();
  console.log(`\n===== النتيجة: ✅ ${passed} ناجح | ❌ ${failed} فاشل =====`);
  process.exit(failed ? 1 : 0);
})();
