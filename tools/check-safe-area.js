'use strict';
/* فاحص مسافة شريط إشعارات الموبايل — بيتأكد إن كل صفحة بتنزّل محتواها تحت الشريط */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..', 'public');
const GAMES = ['conan', 'jasoos', 'lammaha', 'tahadi', 'wisper'];

let bad = 0;
const ok = (c, m, x) => { if (!c) bad++; console.log('   ' + (c ? '✅' : '❌') + ' ' + m + (x ? '  — ' + x : '')); };

function checkPage(label, html, css) {
  console.log('\n[' + label + ']');
  ok(/viewport-fit=cover/.test(html), 'viewport-fit=cover موجود');
  ok(/--safe-top:\s*env\(safe-area-inset-top/.test(css), '--safe-top متعرّفة من env()');
  const floor = css.match(/--safe-top:\s*max\(env\(safe-area-inset-top,\s*0px\),\s*(\d+)px\)/);
  ok(!!floor && +floor[1] >= 40, 'حد أدنى للموبايل ≥ 40px', floor ? floor[1] + 'px' : 'مافيش');
  ok(/padding:\s*(calc\([^)]*var\(--safe-top\)|var\(--safe-top\))/.test(css) || /padding-top:[^;]*var\(--safe-top\)/.test(css),
    'الحاوية الرئيسية بتنزّل بمقدار المسافة');
  ok(/body::before[\s\S]{0,200}var\(--safe-top\)/.test(css), 'خلفية صلبة ورا الشريط');

  /* أي عنصر ثابت قريب من فوق لازم يحسب المسافة */
  const offenders = [];
  const re = /\.([\w-]+)\s*\{([^}]*position:\s*fixed[^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const body = m[2];
    const t = body.match(/top:\s*([^;}]+)/);
    if (!t) continue;
    const v = t[1].trim();
    if (/safe-top|safe-area-inset-top/.test(v)) continue;
    const px = parseInt(v, 10);
    if (v === '0' || (Number.isFinite(px) && px < 60)) {
      /* ممكن يكون متغطّى بقاعدة أحدث — نشوف آخر قاعدة للعنصر */
      /* مقبول كمان لو المسافة محسوبة في الـpadding أو في قاعدة أحدث */
      const inPad = /padding[^;}]*var\(--safe-top\)/.test(body);
      const later = new RegExp('\\.' + m[1] + '\\s*\\{[^}]*(top|padding)[^;}]*safe-top').test(css);
      if (!inPad && !later) offenders.push(m[1] + ' (top:' + v + ')');
    }
  }
  ok(offenders.length === 0, 'كل العناصر الثابتة فوق بتحسب المسافة', offenders.join(', ') || 'كلها مظبوطة');
}

for (const g of GAMES) {
  checkPage(g,
    fs.readFileSync(path.join(ROOT, g, 'index.html'), 'utf8'),
    fs.readFileSync(path.join(ROOT, g, 'style.css'), 'utf8'));
}
const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
checkPage('الصفحة الرئيسية', home, home);

console.log('\n' + (bad ? '⚠️  ' + bad + ' مشكلة' : '🎉 كل الصفحات بتنزّل محتواها تحت شريط الإشعارات'));
process.exit(bad ? 1 : 0);
