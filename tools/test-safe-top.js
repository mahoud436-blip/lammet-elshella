'use strict';
/* اختبار مسافة شريط الإشعارات على جهازين:
   - «قديم»: الجهاز مابيرجّعش env() → المفروض المسافة صفر (مفيش فراغ)
   - «جديد»: بيرجّع 44px → المفروض المسافة 44 بالظبط
   وكمان: الظبط اليدوي والحفظ على الجهاز */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const GAME = process.env.GAME_DIR || path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(GAME, 'public', 'safe-top.js'), 'utf8');

let bad = 0;
const ok = (c, m, x) => { if (!c) bad++; console.log('  ' + (c ? '✅' : '❌') + ' ' + m + (x !== undefined ? '  — ' + x : '')); };

/* جهاز وهمي: envTop = اللي الجهاز بيرجّعه من env(safe-area-inset-top) */
function device(envTop, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!DOCTYPE html><body><div id="app"></div></body>',
    { runScripts: 'dangerously', url: 'https://x.test/' + (opts.search || '') });
  const w = dom.window;
  /* jsdom مابيحسبش env() — فبنزوّده: أي عنصر ارتفاعه env(...) نرجّعله القيمة */
  const store = {};
  w.localStorage.clear();
  if (opts.saved !== undefined) w.localStorage.setItem('lamma_safe_top', String(opts.saved));
  const origGBCR = w.Element.prototype.getBoundingClientRect;
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.getAttribute && this.getAttribute('data-safe-probe')) {
      return { height: envTop, width: 1, top: 0, left: 0, right: 1, bottom: envTop };
    }
    return origGBCR.call(this);
  };
  const sc = w.document.createElement('script');
  sc.textContent = SCRIPT;
  w.document.head.appendChild(sc);
  return w;
}
const cssVar = w => w.document.documentElement.style.getPropertyValue('--safe-top').trim();

console.log('\n[جهاز قديم — الشريط مش داخل على المحتوى، env() = 0]');
{
  const w = device(0);
  ok(cssVar(w) === '0px', 'المسافة صفر — مفيش فراغ ميت', cssVar(w));
  ok(w.SafeTop.auto === 0, 'القياس التلقائي = 0');
}

console.log('\n[جهاز حديث — الصفحة بتمتد تحت الشريط، env() = 44px]');
{
  const w = device(44);
  ok(cssVar(w) === '44px', 'المسافة = القيمة الحقيقية من الجهاز', cssVar(w));
  ok(w.SafeTop.auto === 44, 'القياس التلقائي = 44');
}

console.log('\n[جهاز عنيد — بيمتد تحت الشريط بس بيرجّع صفر]');
{
  const w = device(0);
  ok(cssVar(w) === '0px', 'الأول بتبدأ من صفر', cssVar(w));
  w.SafeTop.set(40);
  ok(cssVar(w) === '40px', 'الظبط اليدوي شغال', cssVar(w));
  ok(w.localStorage.getItem('lamma_safe_top') === '40', 'القيمة اتحفظت على الجهاز');
  ok(w.SafeTop.isCustom() === true, 'النظام عارف إنها يدوي');
}

console.log('\n[الجهاز فاتح تاني بعد الظبط]');
{
  const w = device(0, { saved: 40 });
  ok(cssVar(w) === '40px', 'القيمة المحفوظة رجعت لوحدها', cssVar(w));
}

console.log('\n[لينك فيه ?top=48]');
{
  const w = device(0, { search: '?top=48' });
  ok(cssVar(w) === '48px', 'اللينك ظبط المسافة', cssVar(w));
  ok(w.localStorage.getItem('lamma_safe_top') === '48', 'واتحفظت');
}

console.log('\n[الرجوع للتلقائي]');
{
  const w = device(44, { saved: 12 });
  ok(cssVar(w) === '12px', 'المحفوظة لها الأولوية', cssVar(w));
  w.SafeTop.reset();
  ok(cssVar(w) === '44px', 'reset رجّعها للقياس الحقيقي', cssVar(w));
  ok(w.SafeTop.isCustom() === false, 'بقت تلقائي تاني');
}

console.log('\n[حدود آمنة]');
{
  const w = device(0);
  w.SafeTop.set(-20); ok(w.SafeTop.value === 0, 'مايقلّش عن صفر', w.SafeTop.value);
  w.SafeTop.set(999); ok(w.SafeTop.value === 80, 'مايزيدش عن 80', w.SafeTop.value);
}

console.log('\n' + (bad ? '⚠️  ' + bad + ' فشل' : '🎉 المسافة مظبوطة على الجهازين'));
process.exit(bad ? 1 : 0);
