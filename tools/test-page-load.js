'use strict';
/* اختبار أمين: بيحمّل الصفحات زي المتصفح بالظبط (السكربتات بترتيبها)
   من غير ما نشغّل أي حاجة بإيدينا — عشان نمسك أي حاجة مش متوصّلة. */
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const GAME = process.env.GAME_DIR || path.join(__dirname, '..');
const PUB = path.join(GAME, 'public');

let bad = 0;
const ok = (c, m, x) => { if (!c) bad++; console.log('  ' + (c ? '✅' : '❌') + ' ' + m + (x !== undefined ? '  — ' + x : '')); };

/* حمّل صفحة زي المتصفح: السكربتات الخارجية بتتحوّل لمحتواها في نفس المكان */
function load(htmlPath) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  const errs = [];
  html = html.replace(/<script src="(\/[^"]+)"><\/script>/g, (m, src) => {
    const fp = path.join(PUB, src);
    if (!fs.existsSync(fp)) { errs.push('مفقود: ' + src); return m; }
    return '<script>' + fs.readFileSync(fp, 'utf8') + '</script>';
  });
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/', virtualConsole: vc });
  return { w: dom.window, d: dom.window.document, errs };
}

/* ═══ زرار مسافة شريط الإشعارات في الصفحة الرئيسية ═══ */
console.log('\n[زرار المسافة — الصفحة الرئيسية]');
{
  const { w, d, errs } = load(path.join(PUB, 'index.html'));
  ok(errs.length === 0, 'الصفحة حمّلت من غير أخطاء', errs.join(' | ') || 'نضيفة');
  ok(!!w.SafeTop, 'safe-top.js اشتغل فعلاً');
  const b = d.querySelector('#notch-btn');
  ok(!!b, 'الزرار موجود');
  ok(!!b && typeof b.onclick === 'function', 'الزرار متوصّل بكود');
  if (b && typeof b.onclick === 'function') {
    b.click();
    const ov = d.querySelector('.notch-ov');
    ok(!!ov, 'الشاشة بتفتح لما تدوس');
    if (ov) {
      const start = w.SafeTop.value;
      ov.querySelector('[data-d="4"]').click();
      ok(w.SafeTop.value === start + 4, 'زرار + شغال', start + ' ← ' + w.SafeTop.value);
      ok(d.documentElement.style.getPropertyValue('--safe-top') === (start + 4) + 'px', 'المسافة اتغيّرت فورًا');
      ok(w.localStorage.getItem('lamma_safe_top') === String(start + 4), 'اتحفظت — هتسري على كل الألعاب');
      ov.querySelector('#nr').click();
      ok(!w.SafeTop.isCustom(), '«رجّع التلقائي» شغال');
      ov.querySelector('#nd').click();
      ok(!d.querySelector('.notch-ov'), 'بتتقفل');
    }
  }
}

/* ═══ أيقونات الباب بترسم صح ═══ */
console.log('\n[أيقونات الباب]');
for (const g of ['conan', 'jasoos', 'lammaha', 'tahadi', 'wisper']) {
  const src = fs.readFileSync(path.join(PUB, g, 'app.js'), 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><body><div id="box"></div></body>', { runScripts: 'dangerously' });
  const w = dom.window;
  const m = src.match(/const DOOR_OUT = [\s\S]*?'<\/svg>';\nconst DOOR_IN = [\s\S]*?'<\/svg>';/);
  if (!m) { ok(false, g + ': مالقيتش تعريف الأيقونات'); continue; }
  /* const مبتتعلّقش في window — فبناخد القيم من نتيجة الـeval */
  const [OUT, IN] = w.eval(m[0] + '; [DOOR_OUT, DOOR_IN];');
  const box = w.document.getElementById('box');

  box.innerHTML = '<button>' + OUT + ' اخرج</button>';
  const out = box.querySelector('svg');
  const outWood = [...box.querySelectorAll('path')].some(p => (p.getAttribute('fill') || '') === '#B5793F');
  const outArrow = [...box.querySelectorAll('path')].some(p => (p.getAttribute('stroke') || '') === '#fff' && /M8\.4 12H2\.4/.test(p.getAttribute('d') || ''));
  box.innerHTML = '<button>' + IN + ' ادخل</button>';
  const inn = box.querySelector('svg');
  const innArrow = [...box.querySelectorAll('path')].some(p => (p.getAttribute('stroke') || '') === '#fff' && /M2\.4 12h6/.test(p.getAttribute('d') || ''));

  ok(!!out && !!inn && outWood && outArrow && innArrow, g,
    'باب خشب ✔ سهم خروج لبرّه ✔ سهم دخول لجوّه ✔');
  ok(!/\$\{DOOR_/.test(box.textContent), g + ': مفيش نص حرفي في الشاشة');
}

/* ═══ الزرار العائم بيرسم أيقونة مش نص ═══ */
console.log('\n[الزرار العائم]');
for (const g of ['conan', 'jasoos', 'lammaha', 'tahadi', 'wisper']) {
  const src = fs.readFileSync(path.join(PUB, g, 'app.js'), 'utf8');
  const line = src.split('\n').find(l => l.includes('leave-fab') && l.includes('DOOR_OUT') && l.includes('<button'));
  ok(!!line && !/\$\{DOOR_OUT\}/.test(line), g, line ? 'بيتركّب بالجمع مش كنص' : 'مالقيتهوش');
}

console.log('\n' + (bad ? '⚠️  ' + bad + ' فشل' : '🎉 كله شغال'));
process.exit(bad ? 1 : 0);
