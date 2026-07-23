/* حبر سري — اختبار محاكاة كامل (نظام التخمين واحدة واحدة): node tests/sim-wisper.js */
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
  throw new Error('waitFor timeout: ' + (label || '') + ' | phase=' + (pl.last && pl.last.phase) + ' round=' + (pl.last && pl.last.round) + ' gi=' + (pl.last && pl.last.gi));
}
async function act(pl, action, extra) {
  return post('/api/wisper/action', Object.assign({ code: pl.code, token: pl.token, action }, extra || {}));
}
async function newPlayer(name, code) {
  const r = code ? await post('/api/wisper/join', { code, name, avatar: '😂' }) : await post('/api/wisper/create', { name, avatar: '😂' });
  must(r.ok, 'إنشاء/دخول ' + name + ' — ' + (r.error || ''));
  const pl = { name, code: r.code, token: r.token, id: r.id, last: null, events: [], closed: false };
  await stream(pl);
  await waitFor(pl, s => !!s, 3000, 'أول حالة ' + name);
  return pl;
}

/* التخمين التتابعي: إجابة إجابة، مع تخصيص صح أو مدوّر (غلط كله) للاعب معين */
async function seqGuess(players, roundNo, answers, opts) {
  opts = opts || {};
  const H = players[0];
  // خطة كل لاعب: الإجابات اللي مش بتاعته بالترتيب + الاسم اللي هيقوله
  const plans = new Map(); // pl.id -> Map(answerText -> ownerId)
  for (const pl of players) {
    if (opts.skipIds && opts.skipIds.includes(pl.id)) continue;
    const seq = [];
    for (const [text, owner] of answers) if (owner !== pl) seq.push([text, owner.id]);
    const m = new Map();
    if (opts.wrongFor === pl.id) {
      for (let i = 0; i < seq.length; i++) m.set(seq[i][0], seq[(i + 1) % seq.length][1]); // تدوير = كله غلط
    } else {
      for (const [t, oid] of seq) m.set(t, oid);
    }
    plans.set(pl.id, m);
  }
  let dupTested = false, orderTested = false, prevId = null;
  for (let k = 0; k < answers.length; k++) {
    const stH = await waitFor(H, s => (s.phase === 'guess' && s.gi >= k) || s.phase === 'reveal', 8000, 'إجابة ' + k);
    if (stH.phase === 'reveal') break;
    if (stH.gi > k) continue;
    ok(stH.gTotal === answers.length, 'إجمالي الإجابات مظبوط');
    // زامن الكل الأول قبل أي تخمين (عشان التقدم التلقائي ميسبقناش)
    const views = [];
    for (const pl of players) {
      const v = await waitFor(pl, s => s.phase === 'guess' && s.gi === k, 5000, 'مزامنة إجابة ' + k);
      ok(v.current && v.current.ownerName === undefined, 'anti-cheat: صاحب الإجابة مخفي');
      views.push([pl, v]);
    }
    const curId = views[0][1].current.id;
    const ownerPair = views.find(([, v]) => v.current.isYours);
    if (ownerPair) {
      const r = await act(ownerPair[0], 'guess', { answerId: curId, playerId: ownerPair[1].roster[0].id });
      ok(!r.ok, 'مينفعش أخمّن على إجابتي');
    }
    for (const [pl, v] of views) {
      if (v.current.isYours) continue;
      if (opts.skipIds && opts.skipIds.includes(pl.id)) continue;
      if (!orderTested && k >= 1 && prevId) {
        const r = await act(pl, 'guess', { answerId: prevId, playerId: v.roster[0].id });
        ok(!r.ok && /دور/.test(r.error || ''), 'مينفعش تخمّن على إجابة عدّت');
        orderTested = true;
      }
      const pick = plans.get(pl.id).get(v.current.text);
      if (!dupTested && k >= 1 && !(opts.wrongFor === pl.id)) {
        const usedBefore = Object.entries(v.yourGuesses || {}).find(([aid]) => aid !== v.current.id);
        if (usedBefore && usedBefore[1] !== pick) {
          const r = await act(pl, 'guess', { answerId: v.current.id, playerId: usedBefore[1] });
          ok(!r.ok && /مرة واحدة/.test(r.error || ''), 'نفس الاسم مرتين مرفوض');
          dupTested = true;
        }
      }
      const r = await act(pl, 'guess', { answerId: v.current.id, playerId: pick });
      must(r.ok, 'تخمينة ' + pl.name + ' على إجابة ' + k + ' — ' + (r.error || ''));
    }
    prevId = curId;
    if (opts.skipIds && opts.skipIds.length) {
      await sleep(250); // خلي التقدم التلقائي (لو حصل) يوصلنا الأول
      const cur = H.last;
      if (cur && cur.phase === 'guess' && cur.gi === k) {
        must((await act(H, 'forceContinue')).ok, 'الهوست عدّى الإجابة');
      }
      await waitFor(H, s => s.phase === 'reveal' || (s.phase === 'guess' && s.gi > k), 5000, 'تقدم بعد إجابة ' + k);
    }
  }
  return waitFor(H, s => s.phase === 'reveal' && s.round === roundNo, 8000, 'النتيجة بعد آخر إجابة');
}

/* جولة كاملة */
async function playRound(players, roundNo, opts) {
  opts = opts || {};
  const H = players[0];
  let st = await waitFor(H, s => s.round === roundNo && ['topic', 'vote', 'write'].includes(s.phase), 9000, 'بداية جولة ' + roundNo);

  if (st.phase === 'topic') {
    let writer = null;
    for (const pl of players) {
      const v = await waitFor(pl, s => s.round === roundNo && s.phase === 'topic', 5000, 'topic sync');
      ok(v.writer === undefined, 'الغموض: مفيش اسم كاتب في الحالة');
      if (v.youAreWriter) writer = pl;
    }
    must(writer, 'في كاتب متحدد (سرًا)');
    const other = players.find(p => p !== writer);
    const bad = await act(other, 'submitTopic', { text: 'محاولة مش دوري' });
    ok(!bad.ok && !(bad.error || '').includes(writer.name), 'الرفض من غير ما يكشف اسم الكاتب');
    ok(Array.isArray(writer.last.suggestions) && writer.last.suggestions.length > 0, 'الكاتب واصله اقتراحات');
    const topic = 'عنوان تجريبي رقم ' + roundNo;
    must((await act(writer, 'submitTopic', { text: topic })).ok, 'الكاتب سلّم العنوان');
    st = await waitFor(H, s => s.phase === 'write' && s.round === roundNo, 5000, 'write بعد الكتابة');
    ok(st.topic === topic && st.topicSource === 'writer', 'العنوان اتسجل ومصدره كاتب');
    ok(st.topicByName == null, 'اسم الكاتب مش بيظهر أبدًا');
  } else if (st.phase === 'vote') {
    for (const pl of players) {
      const v = await waitFor(pl, s => s.round === roundNo && s.phase === 'vote', 5000, 'vote sync');
      ok(v.voteOptions.length === 3, '3 اختيارات في التصويت');
      must((await act(pl, 'vote', { choice: 0 })).ok, 'صوّت ' + pl.name);
    }
    st = await waitFor(H, s => s.phase === 'write' && s.round === roundNo, 5000, 'التصويت اتقفل لوحده');
    ok(st.topicSource === 'vote', 'مصدر العنوان تصويت أوتوماتيك');
  } else {
    ok(st.topicSource === 'random', 'جولة عشوائية دخلت الكتابة على طول');
  }
  if (opts.collectTopics) opts.collectTopics.push(st.topic);

  // الكتابة + منع التطابق
  const answers = []; // [ [text, player] ]
  let first = null;
  for (const pl of players) {
    const text = 'إجابة ' + pl.name + ' ج' + roundNo;
    if (!first) {
      must((await act(pl, 'submitAnswer', { text })).ok, 'إجابة أولى');
      first = text;
      if (opts.dupTest) {
        const other = players.find(x => x !== pl);
        const dup = await act(other, 'submitAnswer', { text: '  ' + text.toUpperCase() + ' ' });
        ok(!dup.ok && /نفس الإجابة/.test(dup.error || ''), 'التطابق الحرفي مرفوض حتى بمسافات/كابيتال');
      }
      must((await act(pl, 'submitAnswer', { text })).ok, 'تعديل/إعادة تسليم شغالة');
    } else {
      must((await act(pl, 'submitAnswer', { text })).ok, 'إجابة ' + pl.name);
    }
    answers.push([text, pl]);
  }
  await waitFor(H, s => s.phase === 'guess' && s.round === roundNo, 5000, 'التخمين بدأ لوحده');

  await seqGuess(players, roundNo, answers, opts);

  for (const pl of players) {
    const v = await waitFor(pl, s => s.phase === 'reveal' && s.round === roundNo, 4000, 'reveal sync');
    ok(v.reveal.topicByName == null, 'الغموض مستمر في النتيجة');
    const g = (v.reveal.gains || {})[pl.id] || 0;
    if (opts.wrongFor === pl.id) ok(g === 0, 'الغلطان خد 0 (لقيت ' + g + ')');
    else if (!(opts.skipIds || []).includes(pl.id)) ok(g === (players.length - 1) * 100, 'الصح = ' + ((players.length - 1) * 100) + ' (لقيت ' + g + ')');
  }
  for (const pl of players) must((await act(pl, 'readyNext')).ok, 'التالي ' + pl.name);
}

/* ============================================================ */
async function scenarioA_fullflow() {
  console.log('▶️ سيناريو A: السير الأوتوماتيكي + التخمين واحدة واحدة + الغموض');
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
    await playRound(all, rn, { collectTopics: topics, wrongFor: rn === 2 ? P3.id : null, dupTest: rn === 1 });
  }
  ok(seenTypes.has('writer') && seenTypes.has('vote') && seenTypes.has('random'), 'التلات أنواع ظهروا');

  const go = await waitFor(H, s => s.phase === 'gameover', 6000, 'النهاية');
  const R = go.results;
  must(R.ranking.length === 3, 'الترتيب فيه 3');
  const p3row = R.ranking.find(x => x.id === P3.id);
  ok(p3row.score === 400 && p3row.rank === 3, 'اللي غلط جولة = 400 وآخر الترتيب');
  for (const row of R.ranking) if (row.id !== P3.id) ok(row.score === 600, 'الصح كله = 600 (لقيت ' + row.score + ')');
  ok(R.awards.some(a => a.title === 'بطل اللمّة'), 'جايزة البطل');
  ok(R.awards.some(a => a.title === 'المخبر'), 'جايزة المخبر');
  must(R.review.length === 3, 'المراجعة 3 جولات');
  ok(R.review.every(rd => rd.byName == null), 'الكاتب فاضل غامض حتى في المراجعة');
  ok(R.review.map(x => x.topic).join('|') === topics.join('|'), 'عناوين المراجعة بالترتيب');
  console.log('  ✅ سيناريو A تمام');
}

/* ============================================================ */
async function scenarioB_noTopicRepeat() {
  console.log('▶️ سيناريو B: العناوين متتكررش أبدًا (حتى بعد نلعب تاني)');
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
  ok(t2.every(t => !t1.includes(t)), 'ولا عنوان قديم رجع');
  console.log('  ✅ سيناريو B تمام');
}

/* ============================================================ */
async function scenarioC_resilience() {
  console.log('▶️ سيناريو C: كاتب مفصول + تصويت صامت + تعدية إجابة إجابة + طرد + انتقال هوست');
  const H = await newPlayer('Samy');
  const code = H.code;
  const P2 = await newPlayer('Sara', code);
  const P3 = await newPlayer('Simo', code);
  must((await act(H, 'setSettings', { settings: { writerRounds: 1, voteRounds: 1, randomRounds: 1 } })).ok, 'إعدادات');
  must((await act(H, 'startGame')).ok, 'بدء');

  let kicked = false;
  for (let rn = 1; rn <= 3; rn++) {
    const players = kicked ? [H, P2] : [H, P2, P3];
    let st = await waitFor(H, s => s.round === rn && ['topic', 'vote', 'write'].includes(s.phase), 9000, 'جولة ' + rn);

    if (st.phase === 'topic') {
      let writerPl = null;
      for (const pl of players) { const v = await waitFor(pl, s => s.round === rn, 4000); if (v.phase === 'topic' && v.youAreWriter) writerPl = pl; }
      if (writerPl && writerPl !== H && !kicked) {
        drop(writerPl);
        await sleep(300);
        must((await act(H, 'forceContinue')).ok, 'الهوست عدّى الكاتب المفصول');
        st = await waitFor(H, s => s.phase === 'write' && s.round === rn, 5000, 'كتابة بعد التعدية');
        ok(st.topicSource === 'random', 'العنوان بقى عشوائي');
        const rj = await post('/api/wisper/join', { code, token: writerPl.token });
        ok(rj.ok && rj.resumed, 'الكاتب رجع بنفس التوكن');
        await stream(writerPl);
        await waitFor(writerPl, s => s.phase === 'write' && s.round === rn, 4000, 'استئناف');
      } else if (writerPl) {
        must((await act(writerPl, 'submitTopic', { text: 'عنوان سي ' + rn })).ok, 'الكاتب كتب');
        await waitFor(H, s => s.phase === 'write' && s.round === rn, 5000);
      }
    } else if (st.phase === 'vote') {
      must((await act(H, 'forceContinue')).ok, 'قفل تصويت من غير أصوات');
      st = await waitFor(H, s => s.phase === 'write' && s.round === rn, 5000);
      ok(st.topicSource === 'vote', 'عنوان بالقرعة رغم الصمت');
    }

    const answers = [];
    for (const pl of players) {
      must((await act(pl, 'submitAnswer', { text: 'جواب ' + pl.name + rn })).ok, 'إجابة ' + pl.name);
      answers.push(['جواب ' + pl.name + rn, pl]);
    }
    await waitFor(H, s => s.phase === 'guess' && s.round === rn, 5000, 'تخمين ج' + rn);

    // الجولة 2: الهوست مش بيخمّن — وبيعدّي كل إجابة بنفسه (اختبار force التتابعي)
    await seqGuess(players, rn, answers, rn === 2 ? { skipIds: [H.id] } : {});
    await waitFor(H, s => s.phase === 'reveal' && s.round === rn, 6000, 'نتيجة ج' + rn);

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
  ok(mg.players.length === 2, 'الهوست الخارج فاضل في القايمة بسكوره');
  const hRow = mg.players.find(x => x.id === H.id);
  ok(hRow && hRow.left === true && !hRow.connected, 'ومتعلم عليه إنه خرج 🚪');
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
