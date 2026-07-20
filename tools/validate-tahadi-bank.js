// فحص بنك الأسئلة: node tools/validate-bank.js
const bank = require('../server/tahadi/bank');
let errors = 0, warns = 0;
const seen = new Map();

for (const cat of bank.CATS) {
  if (cat.count !== 100) { console.error(`❌ [${cat.id}] العدد ${cat.count} مش 100`); errors++; }
  for (const id of cat.ids) {
    const q = bank.get(id);
    if (!q.q || typeof q.q !== 'string' || !q.q.trim()) { console.error(`❌ ${id}: سؤال فاضي`); errors++; }
    if (!Array.isArray(q.choices) || q.choices.length !== 3) { console.error(`❌ ${id}: لازم 3 اختيارات`); errors++; continue; }
    q.choices.forEach((c, i) => { if (!c || !String(c).trim()) { console.error(`❌ ${id}: اختيار ${i} فاضي`); errors++; } });
    if (new Set(q.choices.map(c => c.trim())).size !== 3) { console.error(`❌ ${id}: اختيارات مكررة -> ${q.choices.join(' | ')}`); errors++; }
    if (!(Number.isInteger(q.a) && q.a >= 0 && q.a <= 2)) { console.error(`❌ ${id}: رقم إجابة غلط (${q.a})`); errors++; }
    if (q.q.length > 220) { console.error(`❌ ${id}: السؤال طويل جدًا`); errors++; }
    const key = q.q.trim();
    if (seen.has(key)) { console.warn(`⚠️ سؤال مكرر: "${key}" في ${id} و ${seen.get(key)}`); warns++; }
    else seen.set(key, id);
  }
}

// توزيع الإجابات (للاطمئنان إن مفيش انحياز واضح)
const dist = [0, 0, 0];
for (const [, q] of bank.byId) dist[q.a]++;
console.log(`\nالإجمالي: ${bank.total()} سؤال في ${bank.CATS.length} كاتيجوري`);
console.log(`توزيع مكان الإجابة الصح: A=${dist[0]}  B=${dist[1]}  C=${dist[2]}`);
console.log(errors ? `\n❌ فيه ${errors} خطأ` : `\n✅ البنك سليم 100% (تحذيرات: ${warns})`);
process.exit(errors ? 1 : 0);
