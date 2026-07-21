const B = require('../server/lammaha/bank');
let errors = 0, warns = 0, total = 0;
const seenGlobal = new Set();
for (const c of B.cats()) {
  const items = B.catItems(c.id);
  total += items.length;
  if (items.length !== 100) { console.error(`❌ ${c.name}: ${items.length} مش 100`); errors++; }
  const seen = new Set();
  for (const it of items) {
    if (!it.title || !it.title.trim()) { console.error('❌ عنوان فاضي في ' + c.name); errors++; }
    if (!it.accepts.length) { console.error('❌ مفيش صيغ مقبولة: ' + it.title); errors++; }
    const key = B.normalize(it.title);
    if (seen.has(key)) { console.error(`❌ مكرر في ${c.name}: ${it.title}`); errors++; }
    seen.add(key);
    // كل عنوان لازم يطابق نفسه
    if (!B.isMatch(it, it.title)) { console.error('❌ العنوان مش بيطابق نفسه: ' + it.title); errors++; }
  }
}
console.log(errors ? `❌ ${errors} خطأ` : `✅ بنك «لمّحها» سليم: ${total} عنوان في 8 كاتيجوريز`);
process.exit(errors ? 1 : 0);
