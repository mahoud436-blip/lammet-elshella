'use strict';
const path = require('path');
const ROOT = process.argv[2] || require('path').join(__dirname, '..', 'server');
const GAMES = {
  lammaha: ['football', 'islamic', 'history', 'places', 'celebs', 'animals', 'food', 'things'],
  conan: ['living', 'food', 'things', 'places', 'people', 'jobs', 'sports', 'art'],
  jasoos: ['sports', 'geo', 'food', 'animals', 'celebs', 'things', 'landmarks'],
};
const AR = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';

function items(B, cats) { const o = []; for (const c of cats) o.push(...B.catItems(c)); return o; }
/* بدّل حرف واحد في نص الكلمة — محاكاة لمحاولة تسريب */
function mutate(s) {
  const i = Math.floor(s.length / 2);
  const ch = s[i] === AR[3] ? AR[5] : AR[3];
  return s.slice(0, i) + ch + s.slice(i + 1);
}

for (const [g, cats] of Object.entries(GAMES)) {
  const B = require(path.join(ROOT, g, 'bank', 'index.js'));
  const list = items(B, cats);
  console.log('\n══════ ' + g + ' ══════');

  /* 1) صحة أساسية */
  let selfFail = [], synFail = [];
  for (const it of list) {
    if (!B.isMatch(it, it.title)) selfFail.push(it.title);
    for (const a of it.accepts) if (!B.isMatch(it, a)) synFail.push(it.title + ' ← ' + a);
  }
  console.log('العنوان يطابق نفسه      : ' + (list.length - selfFail.length) + '/' + list.length + (selfFail.length ? '  ❌ ' + selfFail.slice(0, 5).join(' | ') : '  ✅'));
  console.log('المرادفات تتقبل         : ' + (synFail.length ? '❌ ' + synFail.length + ' فشل → ' + synFail.slice(0, 5).join(' | ') : '✅ كلها'));

  /* 2) «ال» التعريف */
  let alT = 0, alF = [];
  for (const it of list) {
    const t = it.title.trim();
    if (!/^ال/.test(t) || t.includes(' ')) continue;
    alT++;
    if (!B.isMatch(it, t.replace(/^ال/, ''))) alF.push(t);
  }
  console.log('تخمين من غير «ال»       : ' + (alT - alF.length) + '/' + alT + (alF.length ? '  ❌ ' + alF.slice(0, 6).join(' | ') : '  ✅'));

  /* 3) تداخل */
  let coll = 0; const aff = new Set();
  for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
    if (i === j) continue;
    if (B.isMatch(list[i], list[j].title)) { coll++; aff.add(list[i].id); }
  }
  console.log('تداخل (إجابة غلط تتقبل) : ' + coll + ' حالة — ' + aff.size + ' كلمة (' + (100 * aff.size / list.length).toFixed(1) + '%)');

  /* 4) فلتر التسريب لسه ماسك؟ */
  const leakFn = g === 'lammaha' ? 'hintLeaks' : 'leaksSecret';
  let lkT = 0, lkMiss = 0, lkExact = 0;
  for (const it of list) {
    lkT++;
    if (!B[leakFn](it, it.title)) lkExact++;              // الكلمة نفسها لازم تتمسك
    if (!B[leakFn](it, mutate(it.title))) lkMiss++;       // نسخة بحرف مغيّر
  }
  console.log('فلتر التسريب (' + leakFn + ')' + (leakFn === 'hintLeaks' ? '  ' : '') + ': الكلمة نفسها ' + (lkExact ? '❌ فاتت ' + lkExact : '✅ اتمسكت 100%') + ' | بحرف مغيّر: اتمسك ' + (100 * (lkT - lkMiss) / lkT).toFixed(1) + '%');
}

/* 5) الإنجنات بتحمّل؟ */
console.log('\n══════ تحميل الإنجنات ══════');
for (const g of ['lammaha', 'conan', 'jasoos', 'tahadi', 'wisper']) {
  try { require(path.join(ROOT, g, 'engine.js')); console.log('✅ ' + g); }
  catch (e) { console.log('❌ ' + g + ' → ' + e.message); }
}
