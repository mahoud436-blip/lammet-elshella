'use strict';
/* إثبات إن التخمين الناقص بيتحسب صح في تسجيل النقط الفعلي —
   مش في البنك بس. بنلعب قضايا لحد ما تيجي كلمة من 3 كلمات. */
process.env.ANSWER_HOLD_MS = '1';
const EE = require('events');
const GAME = process.env.GAME_DIR || '/home/claude/work/game';
const E = require(GAME + '/server/conan/engine.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function attempt() {
  const seen = new Map();
  const at = (code, tok) => { const req = new EE(); E.stream(req, { writeHead(){}, end(){}, write(c){
    const m = String(c).match(/^data: (.*)\n\n$/s); if (!m) return;
    try { const o = JSON.parse(m[1]); if (o.t === 'state') seen.set(tok, o); } catch (e) {} } }, code, tok); };

  const c = E.create({ name: 'هوست', avatar: '🕵️' }).body;
  const CODE = c.code, H = c.token;
  const p2 = E.join({ code: CODE, name: 'Hossa', avatar: '🧔' }).body;
  const p3 = E.join({ code: CODE, name: 'سالي', avatar: '👩' }).body;
  const ALL = [H, p2.token, p3.token]; ALL.forEach(t => at(CODE, t));
  const A = (t, a, b) => E.action(Object.assign({ code: CODE, token: t, action: a }, b || {})).body;
  const st = t => seen.get(t);

  A(H, 'setSettings', { settings: { cats: ['people'], rounds: 3 } });
  A(H, 'startGame');
  const acc = ALL.find(t => st(t) && st(t).youAreAccused);
  const dets = ALL.filter(t => t !== acc);

  /* دوّر على كلمة من 3 كلمات — عندنا تبديلين */
  let secret = st(acc).secret;
  for (let i = 0; i < 2 && secret.trim().split(/\s+/).length < 3; i++) { A(acc, 'swapWord'); secret = st(acc).secret; }
  const BANK = require(GAME + '/server/conan/bank/index.js');
  const item = BANK.catItems('people').find(x => x.title === secret);
  const ws = secret.trim().split(/\s+/);
  if (ws.length < 3 || !item || !BANK.isMatch(item, ws.slice(0, ws.length - 1).join(' '))) { A(H, 'leave'); return null; }

  A(acc, 'startPlay');
  let qn = 0;
  for (let i = 0; i < 40 && st(dets[0]).sub !== 'decide'; i++) {
    const asker = ALL.find(t => st(t) && st(t).sub === 'ask' && st(t).yourTurnToAsk);
    if (asker) { A(asker, 'ask', { text: 'سؤال ' + (++qn) + '؟' }); await sleep(3); continue; }
    if (st(acc).sub === 'answer') { A(acc, 'answer', { value: 'yes' }); await sleep(15); continue; }
    await sleep(10);
  }
  if (st(dets[0]).sub !== 'decide') return null;

  const w = secret.trim().split(/\s+/);
  const partial = w.slice(0, w.length - 1).join(' ');     /* ناقص آخر كلمة */
  A(dets[0], 'submitAnswer', { text: partial });          /* التخمين الناقص */
  A(dets[1], 'submitAnswer', { text: 'كلمة غلط خالص' });  /* تخمين غلط للمقارنة */
  await sleep(30);

  /* استنى لحد ما القضية تتقفل وتظهر النتايج */
  for (let i = 0; i < 60; i++) { if (st(dets[0]).phase === 'caseEnd') break; await sleep(30); }
  const res = st(dets[0]);
  const answers = (res.caseResult && res.caseResult.answers) || (res.result && res.result.answers) || null;
  return { secret, partial, phase: res.phase, answers, raw: res };
}

(async () => {
  let r = null;
  for (let i = 0; i < 60 && !r; i++) r = await attempt();
  if (!r) { console.log('❌ مقدرتش أوصل لكلمة مركّبة'); process.exit(1); }
  console.log('الكلمة السرية : «' + r.secret + '»');
  console.log('التخمين الناقص: «' + r.partial + '»');
  if (!r.answers) { console.log('phase=' + r.phase + ' — مفاتيح النتيجة:', Object.keys(r.raw).filter(k => /case|result|answers/i.test(k)).join(', ')); process.exit(1); }
  for (const a of r.answers) console.log('  ' + (a.correct ? '✅' : '❌') + ' ' + a.name + ': «' + (a.answer || '—') + '»' + (a.correct ? '  +' + a.points : ''));
  const good = r.answers.find(a => a.answer === r.partial);
  const bad = r.answers.find(a => a.answer === 'كلمة غلط خالص');
  const ok = good && good.correct && good.points > 0 && bad && !bad.correct;
  console.log('\n' + (ok ? '🎉 التخمين الناقص اتحسب صح وأخد ' + good.points + ' نقطة فعلاً في تسجيل النقط' : '⚠️ في مشكلة'));
  process.exit(ok ? 0 : 1);
})();
