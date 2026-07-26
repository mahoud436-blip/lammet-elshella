'use strict';
/* اختبار: مفتاح المسافة في الهوم + التصحيح اليدوي في لمّاح + الأيقونات */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const EE = require('events');
const GAME = process.env.GAME_DIR || path.join(__dirname, '..');

let bad = 0;
const ok = (c, m, x) => { if (!c) bad++; console.log('  ' + (c ? '✅' : '❌') + ' ' + m + (x !== undefined ? '  — ' + x : '')); };

/* ═══ (5) مفتاح المسافة في الصفحة الرئيسية ═══ */
console.log('\n[مفتاح المسافة — الصفحة الرئيسية]');
{
  const html = fs.readFileSync(path.join(GAME, 'public', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' });
  const w = dom.window, d = w.document;
  const sc = d.createElement('script');
  sc.textContent = fs.readFileSync(path.join(GAME, 'public', 'safe-top.js'), 'utf8');
  d.head.appendChild(sc);
  /* شغّل السكربت اللي جوه الصفحة */
  [...d.querySelectorAll('script')].forEach(s => { if (s.textContent.includes('notch-btn')) w.eval(s.textContent); });

  const btn = d.querySelector('#notch-btn');
  ok(!!btn, 'الزرار موجود في الهوم');
  ok(!!btn && /مسافة شريط الإشعارات/.test(btn.textContent), 'نصه واضح');
  btn && btn.click();
  const ovl = d.querySelector('.notch-ov');
  ok(!!ovl, 'الشاشة بتفتح');
  if (ovl) {
    const start = w.SafeTop.value;
    ovl.querySelector('[data-d="4"]').click();
    ok(w.SafeTop.value === start + 4, 'زرار + بيزوّد', start + ' ← ' + w.SafeTop.value);
    ok(d.documentElement.style.getPropertyValue('--safe-top') === (start + 4) + 'px', 'الصفحة اتغيّرت فورًا');
    ok(w.localStorage.getItem('lamma_safe_top') === String(start + 4), 'اتحفظت للجهاز — فهتسري على كل الألعاب');
    ovl.querySelector('#nr').click();
    ok(!w.SafeTop.isCustom(), '«رجّع التلقائي» شغال');
    ovl.querySelector('#nd').click();
    ok(!d.querySelector('.notch-ov'), 'بتتقفل');
  }
}

/* ═══ (5) المفتاح اتشال من الألعاب ═══ */
console.log('\n[المفتاح اتشال من جوه الألعاب]');
for (const g of ['conan', 'jasoos', 'lammaha', 'tahadi', 'wisper']) {
  const s = fs.readFileSync(path.join(GAME, 'public', g, 'app.js'), 'utf8');
  ok(!s.includes('safe-val') && !s.includes('safe-row'), g);
}

/* ═══ (8/9) أيقونات الباب ═══ */
console.log('\n[أيقونات الباب]');
for (const g of ['conan', 'jasoos', 'lammaha', 'tahadi', 'wisper']) {
  const s = fs.readFileSync(path.join(GAME, 'public', g, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(GAME, 'public', g, 'style.css'), 'utf8');
  ok(!/\u{1F6AA}/u.test(s) && s.includes('DOOR_OUT') && s.includes('DOOR_IN') && css.includes('.ico-door'),
    g, 'خروج ✔ دخول ✔ صفر إيموجي');
}

/* ═══ (2/3) التصحيح اليدوي في لمّاح ═══ */
console.log('\n[التصحيح اليدوي — خليك لمّاح]');
(async () => {
  const E = require(path.join(GAME, 'server', 'lammaha', 'engine.js'));
  const seen = new Map();
  const at = (code, tok) => E.stream(new EE(), { writeHead() {}, end() {}, write(c) {
    const m = String(c).match(/^data: (.*)\n\n$/s); if (!m) return;
    try { const o = JSON.parse(m[1]); if (o.t === 'state') seen.set(tok, o); } catch (e) {} } }, code, tok);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const c = E.create({ name: 'محمود', avatar: '🦅' }).body;
  const CODE = c.code, H = c.token;
  const p2 = E.join({ code: CODE, name: 'ميدو', avatar: '🎯' }).body;
  const p3 = E.join({ code: CODE, name: 'حسام', avatar: '🧠' }).body;
  const ALL = [H, p2.token, p3.token]; ALL.forEach(t => at(CODE, t));
  const A = (t, a, b) => E.action(Object.assign({ code: CODE, token: t, action: a }, b || {})).body;
  const st = t => seen.get(t);

  A(H, 'setSettings', { settings: { cats: ['animals'], maxClues: 1 } });
  A(H, 'startGame');
  const cluer = ALL.find(t => st(t) && st(t).youAreCluer);
  const guessers = ALL.filter(t => t !== cluer);
  A(cluer, 'submitHint', { text: 'حيوان' });
  await sleep(10);
  guessers.forEach(t => A(t, 'guess', { text: 'اجابة مرفوضة خالص' }));
  await sleep(60);

  const sc = st(cluer);
  ok(sc.phase === 'reveal', 'وصلنا الكشف', sc.phase);
  ok(sc.canCredit === true, 'الملمّح بيشوف الزرار');
  ok((sc.creditList || []).length === 2, 'القايمة فيها المخمّنين', (sc.creditList || []).length);
  ok(!guessers.some(t => st(t).canCredit), 'المخمّنين مش شايفينه');

  const target = sc.creditList[0];
  const tok = ALL.find(t => st(t).you.id === target.id);
  const before = st(tok).players.find(x => x.id === target.id).score;
  const key0 = st(tok).creditCount;
  const r = A(cluer, 'creditGuess', { target: target.id });
  ok(r.ok, 'الملمّح حسبها', r.error || '');
  await sleep(10);
  const after = st(tok).players.find(x => x.id === target.id).score;
  ok(after > before, 'النقط زادت فورًا', before + ' ← ' + after);
  ok(st(tok).creditCount === key0 + 1, 'العدّاد وصل لكل اللاعبين — الشاشة هتتحدّث فورًا',
    key0 + ' ← ' + st(tok).creditCount);
  ok(!A(guessers[0], 'creditGuess', { target: target.id }).ok, 'مخمّن مش بيقدر يحسب');

  console.log('\n' + (bad ? '⚠️  ' + bad + ' فشل' : '🎉 كله عدّى'));
  process.exit(bad ? 1 : 0);
})();
