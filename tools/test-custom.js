'use strict';
/* لعبة حقيقية: المتّهم بيكتب كلمته بنفسه، ومحقق بيخمّن جزء منها */
process.env.ANSWER_HOLD_MS = '1';
const EE = require('events');
const GAME = process.env.GAME_DIR || '/home/claude/work/game';
const E = require(GAME + '/server/conan/engine.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const seen = new Map();
  const at = (code, tok) => E.stream(new EE(), { writeHead(){}, end(){}, write(c){
    const m = String(c).match(/^data: (.*)\n\n$/s); if (!m) return;
    try { const o = JSON.parse(m[1]); if (o.t === 'state') seen.set(tok, o); } catch (e) {} } }, code, tok);

  const c = E.create({ name: 'محمود', avatar: '🕵️' }).body;
  const CODE = c.code, H = c.token;
  const p2 = E.join({ code: CODE, name: 'ميدو', avatar: '🧔' }).body;
  const p3 = E.join({ code: CODE, name: 'حسام', avatar: '🐊' }).body;
  const ALL = [H, p2.token, p3.token]; ALL.forEach(t => at(CODE, t));
  const A = (t, a, b) => E.action(Object.assign({ code: CODE, token: t, action: a }, b || {})).body;
  const st = t => seen.get(t);

  A(H, 'setSettings', { settings: { cats: ['living'], rounds: 3, allowCustomWord: true } });
  A(H, 'startGame');
  const acc = ALL.find(t => st(t) && st(t).youAreAccused);
  const dets = ALL.filter(t => t !== acc);

  const WORD = 'فريق الاتحاد الاوروبي';
  const r0 = A(acc, 'pickCustom', { word: WORD, cat: 'living' });
  console.log('المتّهم كتب كلمته: ' + (r0.ok ? '✅ «' + st(acc).secret + '»' : '❌ ' + r0.error));

  A(acc, 'startPlay');
  let qn = 0;
  for (let i = 0; i < 40 && st(dets[0]).sub !== 'decide'; i++) {
    const asker = ALL.find(t => st(t) && st(t).sub === 'ask' && st(t).yourTurnToAsk);
    if (asker) { A(asker, 'ask', { text: 'سؤال ' + (++qn) + '؟' }); await sleep(3); continue; }
    if (st(acc).sub === 'answer') { A(acc, 'answer', { value: 'yes' }); await sleep(15); continue; }
    await sleep(10);
  }
  console.log('وصلنا مرحلة القرار: ' + (st(dets[0]).sub === 'decide' ? '✅' : '❌'));

  A(dets[0], 'submitAnswer', { text: 'الاتحاد الاوروبي' });
  A(dets[1], 'submitAnswer', { text: 'هلهل' });
  await sleep(20);
  for (let i = 0; i < 80 && st(dets[0]).phase !== 'caseEnd'; i++) await sleep(30);

  const res = st(dets[0]);
  const ans = (res.caseResult && res.caseResult.answers) || (res.result && res.result.answers) || [];
  console.log('\nالكلمة كانت: «' + WORD + '»');
  for (const a of ans) console.log('  ' + (a.correct ? '✅' : '❌') + ' ' + a.name + ': «' + a.answer + '»' + (a.correct ? '  +' + a.points : ''));
  const good = ans.find(a => a.answer === 'الاتحاد الاوروبي');
  const bad = ans.find(a => a.answer === 'هلهل');
  const ok = good && good.correct && good.points > 0 && bad && !bad.correct;
  console.log('\n' + (ok ? '🎉 اتحسبت صح وأخدت ' + good.points + ' نقطة' : '⚠️ لسه في مشكلة'));
  process.exit(ok ? 0 : 1);
})();
