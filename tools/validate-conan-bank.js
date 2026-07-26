const B = require('../server/conan/bank');
let errors = 0, total = 0;
console.log('🔍 فحص بنك «المحقق والمتهم»...\n');
for (const c of B.cats()) {
  const items = B.catItems(c.id);
  total += items.length;
  if (items.length !== 200) { console.error(`❌ ${c.name}: ${items.length} (المفروض 200)`); errors++; }
  const seen = new Set();
  for (const it of items) {
    if (!it.title || !it.title.trim()) { console.error('❌ كلمة فاضية في ' + c.name); errors++; continue; }
    if (!it.accepts.length) { console.error('❌ مفيش صيغ مقبولة: ' + it.title); errors++; }
    const key = B.normalize(it.title);
    if (seen.has(key)) { console.error(`❌ مكرر في ${c.name}: ${it.title}`); errors++; }
    seen.add(key);
    if (!B.isMatch(it, it.title)) { console.error('❌ مش بتطابق نفسها: ' + it.title); errors++; }
  }
}
console.log(errors ? `\n❌ ${errors} خطأ` : `✅ بنك «المحقق والمتهم» سليم: ${total} كلمة في 8 كاتيجوريز`);
process.exit(errors ? 1 : 0);
