'use strict';
/* اختبار شامل للتعديلات ٢ و٣ و٤:
   حالة حقيقية من محرك «المحقق والمتهم» → بترسمها ملفات العميل الحقيقية في jsdom */
process.env.ANSWER_HOLD_MS = '1';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const EE = require('events');
const GAME = process.env.GAME_DIR || '/home/claude/work/game';
const E = require(GAME + '/server/conan/engine.js');

const seen = new Map();
function attach(code, token) {
  const req = new EE();
  const res = { writeHead() {}, end() {}, write(c) {
    const m = String(c).match(/^data: (.*)\n\n$/s); if (!m) return;
    try { const o = JSON.parse(m[1]); if (o.t === 'state') seen.set(token, o); } catch (e) {}
  } };
  E.stream(req, res, code, token);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── متصفح وهمي بيشغّل app.js الحقيقي ── */
function browser() {
  const html = fs.readFileSync(GAME + '/public/conan/index.html', 'utf8')
    .replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: false }) });
  w.EventSource = function () { this.addEventListener = () => {}; this.close = () => {}; };
  w.qrcode = () => ({ addData() {}, make() {}, createSvgTag: () => '' });
  w.HTMLMediaElement && (w.HTMLMediaElement.prototype.play = () => Promise.resolve());
  w.AudioContext = w.webkitAudioContext = function () {
    return { createOscillator: () => ({ connect: x => x, start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {} }, type: '' }),
             createGain: () => ({ connect: x => x, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
             destination: {}, currentTime: 0, state: 'running', resume() {} };
  };
  w.onerror = () => true;
  const sc = w.document.createElement('script');
  sc.textContent = fs.readFileSync(GAME + '/public/conan/app.js', 'utf8');
  w.document.head.appendChild(sc);   /* سكربت عادي → دوال التعريف بتتعلّق في window */
  return w;
}

(async () => {
  let pass = 0, fail = 0;
  const chk = (ok, label, extra) => { ok ? pass++ : fail++; console.log('  ' + (ok ? '✅' : '❌') + ' ' + label + (extra ? '  — ' + extra : '')); };

  /* ══════ تجهيز روم ووصول لمرحلة القرار ══════ */
  const c = E.create({ name: 'هوست', avatar: '🕵️' }).body;
  const CODE = c.code, H = c.token;
  const p2 = E.join({ code: CODE, name: 'Hossa', avatar: '🧔' }).body;
  const p3 = E.join({ code: CODE, name: 'سالي', avatar: '👩' }).body;
  const ALL = [H, p2.token, p3.token];
  ALL.forEach(t => attach(CODE, t));
  const A = (tok, action, body) => E.action(Object.assign({ code: CODE, token: tok, action }, body || {})).body;
  const st = t => seen.get(t);

  A(H, 'setSettings', { settings: { cats: ['things'], rounds: 6 } });
  A(H, 'startGame');
  const acc = ALL.find(t => st(t) && st(t).youAreAccused);
  const dets = ALL.filter(t => t !== acc);

  /* ══════ ④ تبديل الكلمة — سيرفر + شاشة ══════ */
  console.log('\n④ تبديل الكلمة من البنك');
  const pickState = st(acc);
  chk(pickState.swapsLeft === 2, 'السيرفر بيبعت swapsLeft = 2', 'القيمة: ' + pickState.swapsLeft);

  const w1 = browser();
  w1.buildPick(pickState);
  const swapBtn = w1.document.querySelector('#swap-btn');
  chk(!!swapBtn, 'زرار «بدّلها» ظاهر في شاشة المتّهم', swapBtn ? '«' + swapBtn.textContent.trim() + '»' : 'مش موجود');
  chk(!!swapBtn && /فاضل 2/.test(swapBtn.textContent), 'الزرار بيعرض عدد المرات الفاضلة');

  const w1d = browser();
  w1d.buildPick(st(dets[0]));
  chk(!w1d.document.querySelector('#swap-btn'), 'المحقق مش شايف زرار التبديل');

  const before = st(acc).secret;
  A(acc, 'swapWord'); A(acc, 'swapWord');
  const third = A(acc, 'swapWord');
  chk(st(acc).secret !== before, 'الكلمة اتغيّرت فعلاً', before + ' ← ' + st(acc).secret);
  chk(st(acc).swapsLeft === 0 && !third.ok, 'التبديل التالت اترفض', third.error);

  const w1z = browser();
  w1z.buildPick(st(acc));
  chk(!w1z.document.querySelector('#swap-btn'), 'الزرار اختفى بعد ما المرات خلصت');

  /* ══════ الوصول لمرحلة القرار ══════ */
  A(acc, 'startPlay');
  let qn = 0;
  for (let i = 0; i < 40 && st(dets[0]).sub !== 'decide'; i++) {
    const asker = ALL.find(t => st(t) && st(t).sub === 'ask' && st(t).yourTurnToAsk);
    if (asker) { A(asker, 'ask', { text: 'سؤال رقم ' + (++qn) + ' — هي حاجة كبيرة؟' }); await sleep(3); continue; }
    if (st(acc).sub === 'answer') { A(acc, 'answer', { value: 'yes' }); await sleep(15); continue; }
    await sleep(10);
  }
  const sd = st(dets[0]);

  /* ══════ ③ زرار التسليم المنفصل ══════ */
  console.log('\n③ زرار التسليم المنفصل');
  chk(sd.sub === 'decide', 'وصلنا مرحلة القرار', 'sub=' + sd.sub);
  if (sd.sub === 'decide') {
    const w2 = browser();
    w2.buildPlay(sd);
    const d = w2.document;
    const subRow = d.querySelector('#sub-row');
    chk(!d.querySelector('#sub-in') || (subRow && subRow.className.includes('hidden')),
      'خانة الكتابة مخفية في الأول');
    chk(!!d.querySelector('#open-sub'), 'زرار «سلّم دلوقتي» موجود ومنفصل');
    const ob = d.querySelector('#open-sub');
    chk(!!ob && ob.className.includes('danger'), 'لونه أحمر (danger)');
    chk(!!d.querySelector('#keep-btn'), 'زرار «هكمّل تحقيق» هو الأساسي');
    chk(!!d.querySelector('.submit-zone'), 'منطقة التسليم مفصولة بخط');

    /* دوس على «سلّم دلوقتي» → لازم يطلع تأكيد */
    ob.click();
    await sleep(30);
    const modal = d.querySelector('.ui-modal');
    chk(!!modal, 'التأكيد بيظهر قبل ما تسلّم',
      modal ? '«' + (modal.textContent.match(/متأكد[^؟]*؟/) || [''])[0] + '»' : 'مافيش');
    if (modal) {
      const okBtn = [...modal.querySelectorAll('button')].find(b => /هسلّم/.test(b.textContent));
      chk(!!okBtn, 'فيه زرار موافقة واضح', okBtn ? '«' + okBtn.textContent.trim() + '»' : '');
      if (okBtn) {
        okBtn.click(); await sleep(30);
        const row = d.querySelector('#sub-row');
        chk(!!row && !row.className.includes('hidden'), 'خانة الكتابة بانت بعد الموافقة');
        chk(!!d.querySelector('#keep-btn') === false || d.querySelector('#keep-btn').className.includes('hidden'),
          '«هكمّل تحقيق» اتخفى عشان محدش يلخبط');
      }
    }
  }

  /* ══════ ② مطابقة الجملة الناقصة (من جوه اللعبة) ══════ */
  console.log('\n② مطابقة الجملة الناقصة — لحد التسجيل');
  const BANK = require(GAME + '/server/conan/bank/index.js');
  const secret = st(acc).secret;
  const words = secret.trim().split(/\s+/);
  let guess = null;
  if (words.length >= 3) guess = words.slice(0, 2).join(' ');
  const multi = BANK.catItems('things').filter(x => x.title.trim().split(/\s+/).length >= 3);
  chk(multi.length > 0, 'في كلمات من 3 كلمات في الكاتيجوري', multi.length + ' كلمة');

  if (guess) {
    const r = A(dets[1], 'submitAnswer', { text: guess });
    chk(r.ok, 'التسليم اتقبل');
    await sleep(5);
    console.log('     الكلمة السرية: «' + secret + '» | التخمين: «' + guess + '»');
  } else {
    /* الكلمة الحالية كلمة واحدة — نتأكد من المنطق مباشرة على كلمة مركّبة */
    const it = multi[0];
    const part = it.title.trim().split(/\s+/).slice(0, 2).join(' ');
    chk(BANK.isMatch(it, part), 'التخمين الناقص بيتقبل: «' + it.title + '» ← «' + part + '»');
    const whole = BANK.catItems('things').find(x => !x.title.includes(' '));
    chk(!BANK.isMatch(it, whole.title), 'كلمة تانية مستقلة لسه بتترفض: «' + it.title + '» ← «' + whole.title + '»');
  }

  console.log('\n' + (fail ? '⚠️  ' + fail + ' فشل' : '🎉 كله عدّى') + '  (' + pass + '/' + (pass + fail) + ')');
  process.exit(fail ? 1 : 0);
})();
