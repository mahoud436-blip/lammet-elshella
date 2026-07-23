const B = require('../server/lammaha/bank');
let errors = 0, total = 0;
console.log('🔍 فحص بنك «خليك لمَّاح»...\n');
for (const c of B.cats()) {
  const items = B.catItems(c.id);
  total += items.length;
  if (items.length !== 300) { console.error(`❌ ${c.name}: ${items.length} (المفروض 300)`); errors++; }
  for (const lv of ['easy', 'medium', 'hard']) {
    const n = B.catItemsByLevel(c.id, lv).length;
    if (n !== 100) { console.error(`❌ ${c.name} — ${lv}: ${n} (المفروض 100)`); errors++; }
  }
  const seen = new Set();
  for (const it of items) {
    if (!it.title || !it.title.trim()) { console.error('❌ اسم فاضي في ' + c.name); errors++; continue; }
    if (!it.accepts.length) { console.error('❌ مفيش صيغ مقبولة: ' + it.title); errors++; }
    const key = B.normalize(it.title);
    if (seen.has(key)) { console.error(`❌ مكرر في ${c.name}: ${it.title}`); errors++; }
    seen.add(key);
    if (!B.isMatch(it, it.title)) { console.error('❌ الاسم مش بيطابق نفسه: ' + it.title); errors++; }
  }
}
console.log(errors ? `\n❌ ${errors} خطأ` : `✅ بنك «خليك لمَّاح» سليم: ${total} اسم (8 كاتيجوري × 300 = سهل/متوسط/صعب 100 لكل مستوى)`);
process.exit(errors ? 1 : 0);
