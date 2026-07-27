'use strict';
/* لما اللاعب يطلع من التطبيق، المتصفح بيجمّد الصفحة وبيلغي fetch.
   الاختبار ده بيتأكد إن الإشارة بتتبعت بـsendBeacon اللي بيوصل في الحالة دي. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const GAME = process.env.GAME_DIR || path.join(__dirname, '..');
const GAMES = ['conan', 'jasoos', 'lammaha', 'tahadi', 'wisper'];

let bad = 0;
const ok = (c, m, x) => { if (!c) bad++; console.log('  ' + (c ? '✅' : '❌') + ' ' + m + (x !== undefined ? '  — ' + x : '')); };

for (const g of GAMES) {
  console.log('\n[' + g + ']');
  const src = fs.readFileSync(path.join(GAME, 'public', g, 'app.js'), 'utf8');

  /* الدالة موجودة وبتستخدم sendBeacon */
  const m = src.match(/function sendAway\(away\) \{[\s\S]*?\n\}/);
  ok(!!m, 'sendAway متعرّفة');
  ok(!!m && /navigator\.sendBeacon/.test(m[0]), 'بتستخدم sendBeacon');
  ok(!!m && /act\('presence'/.test(m[0]), 'وفيها بديل لو sendBeacon مش متاح');

  /* كل مواضع الخروج بتنادي عليها */
  for (const h of ['visibilitychange', 'blur', 'pagehide', 'focus']) {
    /* ممكن يكون فيه أكتر من مستمع لنفس الحدث — يكفي إن واحد فيهم مربوط */
    let i = -1, hit = false, count = 0;
    while ((i = src.indexOf("addEventListener('" + h + "'", i + 1)) >= 0) {
      count++;
      if (/sendAway|sendPresence/.test(src.slice(i, i + 400))) hit = true;
    }
    ok(count > 0 && hit, 'مربوط بـ' + h, count > 1 ? count + ' مستمعين' : undefined);
  }

  /* شغّلها فعلاً وشوف بتبعت إيه */
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'dangerously' });
  const w = dom.window;
  const beacons = [], fetches = [];
  w.navigator.sendBeacon = (url, blob) => { beacons.push({ url, blob }); return true; };
  const fn = new Function('S', 'API_BASE', 'act', 'navigator', 'Blob',
    m[0] + '; return sendAway;')(
    { save: { code: '1234', token: 'TOK' } }, '/api/' + g, (a, b) => fetches.push([a, b]), w.navigator, w.Blob);

  fn(true);
  ok(beacons.length === 1 && fetches.length === 0, 'الخروج بيتبعت بـsendBeacon مش fetch',
    'beacon=' + beacons.length + ' fetch=' + fetches.length);
  ok(beacons.length === 1 && beacons[0].url === '/api/' + g + '/action', 'على المسار الصح', beacons[0] && beacons[0].url);
  ok(beacons.length === 1 && beacons[0].blob.type === 'application/json', 'النوع application/json');

  fn(false);
  ok(fetches.length === 1, 'الرجوع بيتبعت عادي', 'fetch=' + fetches.length);

  /* لو sendBeacon مش موجود → يرجع للـfetch */
  const beacons2 = [], fetches2 = [];
  const nav2 = { };
  const fn2 = new Function('S', 'API_BASE', 'act', 'navigator', 'Blob',
    m[0] + '; return sendAway;')(
    { save: { code: '1', token: 'T' } }, '/api/' + g, (a, b) => fetches2.push([a, b]), nav2, w.Blob);
  fn2(true);
  ok(fetches2.length === 1, 'لو sendBeacon مش متاح بيرجع للـfetch');

  /* ما يبعتش وإحنا مش في روم */
  const fetches3 = [];
  const fn3 = new Function('S', 'API_BASE', 'act', 'navigator', 'Blob',
    m[0] + '; return sendAway;')({ save: null }, '/api/' + g, () => fetches3.push(1), w.navigator, w.Blob);
  fn3(true);
  ok(fetches3.length === 0, 'مبيبعتش وإحنا برّه روم');

  /* النبض الأصلي رجع */
  const css = fs.readFileSync(path.join(GAME, 'public', g, 'style.css'), 'utf8');
  const dup = /\.presence-bar \.pv\.away\{animation:pvPulse/.test(css);
  ok(!dup, 'مفيش قاعدة بتلغي نبض الأفاتار الأصلي');
  if (g !== 'wisper') ok(/\.pv\.away\{[^}]*var\(--coral\)/.test(css), 'الأفاتار الخارج لونه أحمر');
}

console.log('\n' + (bad ? '⚠️  ' + bad + ' فشل' : '🎉 إشارة الخروج بتوصل السيرفر'));
process.exit(bad ? 1 : 0);
