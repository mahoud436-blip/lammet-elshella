/* اختبار عدّاد «قرروا X من Y» في مرحلة القرار — node tests/smoke-conan-decide-count.js
   السيناريو المبلّغ عنه: محقق واحد سلّم والتاني لسه بيفكر → لازم يبان «1 من 2» مش «2 من 2». */
'use strict';
const http = require('http');
const { spawn } = require('child_process');
const PORT = 3231;
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
async function waitFor(pl, pred, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) { if (pl.last && pred(pl.last)) return pl.last; await sleep(25); }
  throw new Error('waitFor timeout: ' + (label || '') + ' | phase=' + (pl.last && pl.last.phase) + ' sub=' + (pl.last && pl.last.sub));
}
const act = (pl, action, extra) => post('/api/conan/action', Object.assign({ code: pl.code, token: pl.token, action }, extra || {}));
async function newPlayer(name, code) {
  const r = code ? await post('/api/conan/join', { code, name, avatar: '🕵️' }) : await post('/api/conan/create', { name, avatar: '🕵️' });
  must(r.ok, 'دخول ' + name);
  const pl = { name, code: r.code, token: r.token, id: r.id, last: null, events: [], closed: false };
  await stream(pl); await waitFor(pl, s => !!s, 4000, 'أول حالة ' + name); return pl;
}

(async function main() {
  const srv = spawn('node', ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
  await sleep(900);
  try {
    console.log('▶️ عدّاد القرار: واحد سلّم والتاني لسه بيفكر');
    const host = await newPlayer('Mahmoud');
    const p2 = await newPlayer('Menna', host.code);
    const p3 = await newPlayer('Lamar', host.code);

    // أسئلة قليلة عشان نوصل لمرحلة القرار بسرعة، ومن غير وقت محدد
    await act(host, 'setSettings', { settings: { cats: ['food'], rounds: 6, casesPerPlayer: 1, qTime: 0, aTime: 0, allowCustomWord: false } });
    must((await act(host, 'startGame')).ok, 'بدء اللعبة');
    await waitFor(host, s => s.phase === 'pick' || s.phase === 'play', 6000, 'بدأت');

    // المتّهم يبدأ اللعب
    const accused = [host, p2, p3].find(p => p.last && p.last.youAreAccused);
    must(!!accused, 'فيه متّهم');
    const dets = [host, p2, p3].filter(p => p !== accused);
    if (accused.last.phase === 'pick') {
      must((await act(accused, 'startPlay')).ok, 'المتّهم بدأ اللعب');
      await waitFor(accused, s => s.phase === 'play', 6000, 'بدأ اللعب');
    }

    // كل محقق يسأل سؤاله والمتّهم يرد — لحد ما نوصل لمرحلة القرار
    const all = [host, p2, p3];
    let qc = 0;
    for (let guard = 0; guard < 60; guard++) {
      const st = all.find(p => !p.closed).last;
      if (st && st.sub === 'decide') break;
      if (st && st.sub === 'ask' && st.asker) {
        const a = all.find(p => p.id === st.asker.id);
        if (a) { await act(a, 'ask', { text: 'هل هو حاجة رقم ' + (++qc) + '؟' }); }
        await sleep(90);
      } else if (st && st.sub === 'answer') {
        if (st.curQ && !st.curQ.answer) await act(accused, 'answer', { value: 'yes' });
        await sleep(260);
      } else { await sleep(90); }
    }
    const atDecide = await waitFor(dets[0], s => s.sub === 'decide', 8000, 'مرحلة القرار');
    must(!!atDecide, 'وصلنا مرحلة القرار');
    ok(atDecide.decideTotal === 2, 'إجمالي المحققين = 2 (فعليًا ' + atDecide.decideTotal + ')');
    ok(atDecide.decidedCount === 0, 'قبل ما حد يقرر: 0 من 2 (فعليًا ' + atDecide.decidedCount + ')');

    // 🔴 جوهر الباج: محقق واحد بس يسلّم — لازم يبقى «1 من 2»
    await act(dets[0], 'submitAnswer', { text: 'طماطم' });
    await sleep(400);
    const after1 = dets[1].last;
    ok(after1.decidedCount === 1, 'بعد ما واحد سلّم: 1 من 2 (فعليًا ' + after1.decidedCount + ') ← ده كان بيطلع 2 قبل التصليح');
    ok(after1.decidedCount <= after1.decideTotal, 'العدّاد عمره ما يعدّي الإجمالي');
    ok(after1.sub === 'decide', 'الجولة لسه مقفلتش لإن التاني مقررش');

    // التاني يقرر يكمّل تحقيق → 2 من 2 والجولة تقفل
    await act(dets[1], 'keepGoing');
    await sleep(500);
    const after2 = dets[1].last;
    ok(after2.sub !== 'decide' || after2.decidedCount === 2, 'بعد ما الاتنين قرروا: العدّاد 2 من 2 والجولة كمّلت');
    ok(!(after2.sub === 'decide' && after2.decidedCount > after2.decideTotal), 'مفيش «3 من 2» أبدًا');

    console.log('\n===== النتيجة: ✅ ' + passed + ' ناجح | ❌ ' + failed + ' فاشل =====');
  } catch (e) {
    failed++; console.error('💥 ' + e.message);
    console.log('\n===== النتيجة: ✅ ' + passed + ' ناجح | ❌ ' + failed + ' فاشل =====');
  } finally {
    srv.kill(); await sleep(200); process.exit(failed ? 1 : 0);
  }
})();
