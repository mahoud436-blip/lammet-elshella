'use strict';
/* اختبار «حد جاوب صح ومتحسبتش؟» في المحقق والمتهم:
   محقق بيكتب إجابة غلط (النظام يرفضها) → المتّهم يحسبها له → النقط تتحرّك */
process.env.ANSWER_HOLD_MS = '1';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const EE = require('events');
const GAME = process.env.GAME_DIR || path.join(__dirname, '..');
const E = require(GAME + '/server/conan/engine.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let bad = 0;
const ok = (c, m, x) => { if (!c) bad++; console.log('  ' + (c ? '✅' : '❌') + ' ' + m + (x !== undefined ? '  — ' + x : '')); };

function browser() {
  const html = fs.readFileSync(GAME + '/public/conan/index.html', 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.onerror = () => true;
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: false }) });
  w.EventSource = function () { this.addEventListener = () => {}; this.close = () => {}; };
  w.qrcode = () => ({ addData() {}, make() {}, createSvgTag: () => '' });
  w.AudioContext = w.webkitAudioContext = function () {
    return { createOscillator: () => ({ connect: x => x, start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {} }, type: '' }),
             createGain: () => ({ connect: x => x, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
             destination: {}, currentTime: 0, state: 'running', resume() {} };
  };
  const sc = w.document.createElement('script');
  sc.textContent = fs.readFileSync(GAME + '/public/conan/app.js', 'utf8');
  w.document.head.appendChild(sc);
  return w;
}

(async () => {
  const seen = new Map();
  const at = (code, tok) => E.stream(new EE(), { writeHead() {}, end() {}, write(c) {
    const m = String(c).match(/^data: (.*)\n\n$/s); if (!m) return;
    try { const o = JSON.parse(m[1]); if (o.t === 'state') seen.set(tok, o); } catch (e) {} } }, code, tok);

  const c = E.create({ name: 'محمود', avatar: '🕵️' }).body;
  const CODE = c.code, H = c.token;
  const p2 = E.join({ code: CODE, name: 'ميدو', avatar: '🧔' }).body;
  const p3 = E.join({ code: CODE, name: 'حسام', avatar: '🐊' }).body;
  const ALL = [H, p2.token, p3.token]; ALL.forEach(t => at(CODE, t));
  const A = (t, a, b) => E.action(Object.assign({ code: CODE, token: t, action: a }, b || {})).body;
  const st = t => seen.get(t);

  A(H, 'setSettings', { settings: { cats: ['things'], rounds: 3 } });
  A(H, 'startGame');
  const acc = ALL.find(t => st(t) && st(t).youAreAccused);
  const dets = ALL.filter(t => t !== acc);
  A(acc, 'startPlay');

  let qn = 0;
  for (let i = 0; i < 40 && st(dets[0]).sub !== 'decide'; i++) {
    const asker = ALL.find(t => st(t) && st(t).sub === 'ask' && st(t).yourTurnToAsk);
    if (asker) { A(asker, 'ask', { text: 'سؤال ' + (++qn) + '؟' }); await sleep(3); continue; }
    if (st(acc).sub === 'answer') { A(acc, 'answer', { value: 'yes' }); await sleep(15); continue; }
    await sleep(10);
  }

  const before = st(dets[0]).players.find(x => x.id === st(dets[0]).you.id).score;
  A(dets[0], 'submitAnswer', { text: 'اجابة قريبة بس مترفوضة' });
  A(dets[1], 'submitAnswer', { text: 'حاجة تانية خالص' });
  await sleep(20);
  for (let i = 0; i < 80 && st(acc).phase !== 'caseEnd'; i++) await sleep(30);

  console.log('\n[السيرفر]');
  const sa = st(acc);
  ok(sa.phase === 'caseEnd', 'وصلنا نهاية القضية', sa.phase);
  ok(sa.canCredit === true, 'المتّهم بيشوف زرار التصحيح');
  ok((sa.creditList || []).length === 2, 'القايمة فيها اللي جاوبوا غلط', (sa.creditList || []).length + ' لاعب');
  ok(!ALL.some(t => t !== acc && st(t).canCredit), 'المحققين مش شايفين الزرار');
  ok(!JSON.stringify(sa.result).includes('token'), 'مفيش توكنات بتتسرّب للعميل');

  console.log('\n[الشاشة]');
  const w = browser();
  w.buildCaseEnd ? w.buildCaseEnd(sa) : (w.BUILD && w.BUILD.caseEnd && w.BUILD.caseEnd(sa));
  const d = w.document;
  const rows = [...d.querySelectorAll('[data-credit]')];
  ok(!!d.querySelector('.credit-card'), 'الكارت ظاهر للمتّهم');
  ok(rows.length === 2, 'صف لكل إجابة', rows.length);
  ok(/حد جاوب صح ومتحسبتش/.test(d.body.textContent), 'العنوان واضح');
  const w2 = browser();
  w2.buildCaseEnd ? w2.buildCaseEnd(st(dets[0])) : (w2.BUILD && w2.BUILD.caseEnd && w2.BUILD.caseEnd(st(dets[0])));
  ok(!w2.document.querySelector('.credit-card'), 'المحقق مش شايف الكارت');

  console.log('\n[التصحيح]');
  const target = sa.creditList[0];
  const r1 = A(acc, 'creditGuess', { target: target.id });
  ok(r1.ok, 'المتّهم حسبها', r1.error || '');
  await sleep(10);
  const meTok = ALL.find(t => st(t).you.id === target.id);
  const after = st(meTok).players.find(x => x.id === target.id).score;
  ok(after > before, 'النقط زادت', before + ' ← ' + after);
  ok((st(acc).creditList || []).some(x => x.id === target.id && x.done), 'الصف اتعلّم «اتحسبت»');
  const r2 = A(acc, 'creditGuess', { target: target.id });
  ok(!r2.ok, 'مش بتتحسب مرتين', r2.error);
  const r3 = A(dets[1], 'creditGuess', { target: target.id });
  ok(!r3.ok, 'محقق مش بيقدر يحسب', r3.error);

  console.log('\n' + (bad ? '⚠️  ' + bad + ' فشل' : '🎉 التصحيح اليدوي شغال'));
  process.exit(bad ? 1 : 0);
})();
