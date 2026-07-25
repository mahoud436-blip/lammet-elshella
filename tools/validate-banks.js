'use strict';
/* فاحص البنوك — بيشغّل كل الشروط على التلات ألعاب */
const path = require('path');
const ROOT = process.argv[2] || require('path').join(__dirname, '..', 'server');
const ONLY = process.argv[3] || null;

const GAMES = {
  lammaha: ['football', 'islamic', 'history', 'places', 'celebs', 'animals', 'food', 'things'],
  conan: ['living', 'food', 'things', 'places', 'people', 'jobs', 'sports', 'art'],
  jasoos: ['sports', 'geo', 'food', 'animals', 'celebs', 'things', 'landmarks'],
};
const TARGET = 300, PER_LEVEL = 100;

let problems = 0;
function bad(msg) { problems++; console.log('   ❌ ' + msg); }

for (const [g, cats] of Object.entries(GAMES)) {
  if (ONLY && g !== ONLY) continue;
  const B = require(path.join(ROOT, g, 'bank', 'index.js'));
  console.log('\n╔══ ' + g + ' ══╗');
  const seenGame = new Map();   // العنوان المطبّع → كاتيجوري
  let total = 0, noSyn = 0;

  for (const c of cats) {
    const rows = require(path.join(ROOT, g, 'bank', c + '.js'));
    const items = B.catItems(c);
    total += items.length;
    const issues = [];

    /* 1) العدد */
    if (items.length !== TARGET) issues.push('العدد ' + items.length + ' (المطلوب ' + TARGET + ')');

    /* 2) المستويات */
    const lv = { easy: 0, medium: 0, hard: 0 };
    for (const it of items) lv[it.level]++;
    if (lv.easy !== PER_LEVEL || lv.medium !== PER_LEVEL || lv.hard !== PER_LEVEL)
      issues.push('المستويات ' + lv.easy + '/' + lv.medium + '/' + lv.hard + ' (المطلوب 100/100/100)');

    /* 3) شكل السطر */
    let badRow = 0;
    rows.forEach((r) => {
      if (!Array.isArray(r) || typeof r[0] !== 'string' || !r[0].trim()) { badRow++; return; }
      if (r[1] != null && !Array.isArray(r[1])) badRow++;
    });
    if (badRow) issues.push(badRow + ' سطر شكله غلط');

    /* 4) تكرار داخل الكاتيجوري + عبر الكاتيجوريز */
    const seenCat = new Set(); let dupCat = [], dupCross = [];
    for (const it of items) {
      const k = B.normalize(it.title);
      if (seenCat.has(k)) dupCat.push(it.title); else seenCat.add(k);
      if (seenGame.has(k) && seenGame.get(k) !== c) dupCross.push(it.title + ' (كمان في ' + seenGame.get(k) + ')');
      else seenGame.set(k, c);
    }
    if (dupCat.length) issues.push('مكرر جوه الكاتيجوري: ' + dupCat.slice(0, 4).join(' • ') + (dupCat.length > 4 ? ' +' + (dupCat.length - 4) : ''));
    if (dupCross.length) issues.push('مكرر في كاتيجوري تانية: ' + dupCross.slice(0, 3).join(' • ') + (dupCross.length > 3 ? ' +' + (dupCross.length - 3) : ''));

    /* 5) نفس الكيان مكتوب مرتين (تطابق في الاتجاهين) */
    const ent = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b2 = items[j];
      if (!(B.isMatch(a, b2.title) && B.isMatch(b2, a.title))) continue;
      const na = B.normalize(a.title), nb = B.normalize(b2.title);
      if (na.includes(nb) || nb.includes(na) || a.accepts.some(x => b2.accepts.includes(x)))
        ent.push(a.title + ' ≡ ' + b2.title);
    }
    if (ent.length) issues.push('نفس الكيان مرتين: ' + ent.slice(0, 4).join(' • ') + (ent.length > 4 ? ' +' + (ent.length - 4) : ''));

    /* 6) مرادفات */
    const ns = items.filter(it => it.accepts.length < 2).length;
    noSyn += ns;

    /* 7) صحة المطابقة */
    let selfF = 0, synF = 0;
    for (const it of items) {
      if (!B.isMatch(it, it.title)) selfF++;
      for (const a of it.accepts) if (!B.isMatch(it, a)) synF++;
    }
    if (selfF) issues.push(selfF + ' عنوان مابيطابقش نفسه');
    if (synF) issues.push(synF + ' مرادف مابيتقبلش');

    const tag = issues.length ? '❌' : '✅';
    console.log(' ' + tag + ' ' + c.padEnd(10) + ' ' + String(items.length).padStart(3) +
      ' | ' + lv.easy + '/' + lv.medium + '/' + lv.hard +
      ' | بدون مرادف ' + String(ns).padStart(3));
    for (const m of issues) bad('   ' + c + ': ' + m);
  }

  /* 8) تداخل عام */
  const list = []; for (const c of cats) list.push(...B.catItems(c));
  let coll = 0; const aff = new Set();
  for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
    if (i === j) continue;
    if (B.isMatch(list[i], list[j].title)) { coll++; aff.add(list[i].id); }
  }
  const want = cats.length * TARGET;
  console.log(' ─── إجمالي ' + total + '/' + want + (total === want ? ' ✅' : ' ❌ ناقص ' + (want - total)) +
    ' | بدون مرادف ' + noSyn + ' (' + (100 * (total - noSyn) / (total || 1)).toFixed(1) + '% مغطّاة)' +
    ' | تداخل ' + coll + ' (' + (100 * aff.size / (list.length || 1)).toFixed(1) + '%)');
}

console.log('\n' + (problems ? '⚠️  ' + problems + ' مشكلة محتاجة شغل' : '🎉 كل الشروط متحققة'));
