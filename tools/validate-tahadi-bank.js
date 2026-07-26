const BANK = require('../server/tahadi/bank');
let errors = 0, warns = 0;
const norm = s => String(s).replace(/\s+/g, ' ').trim();
console.log('🔍 فحص بنك «اسأل واستفيد»...\n');
let total = 0;
for (const cat of BANK.CATS) {
  const ids = BANK.catIds(cat.id);
  total += ids.length;
  if (ids.length !== 300) { console.error(`❌ ${cat.name}: ${ids.length} سؤال (المفروض 300)`); errors++; }
  for (const lv of ['easy', 'medium', 'hard']) {
    const n = BANK.catIds(cat.id, lv).length;
    if (n !== 100) { console.error(`❌ ${cat.name} — مستوى ${lv}: ${n} (المفروض 100)`); errors++; }
  }
  const seenQ = new Map();
  for (const id of ids) {
    const q = BANK.get(id);
    if (!q || !q.q || !q.q.trim()) { console.error(`❌ سؤال فاضي: ${id}`); errors++; continue; }
    if (!Array.isArray(q.choices) || q.choices.length !== 3) { console.error(`❌ اختيارات غلط: ${id}`); errors++; continue; }
    if (q.choices.some(c => !String(c).trim())) { console.error(`❌ اختيار فاضي: ${id}`); errors++; }
    if (!(q.a >= 0 && q.a <= 2)) { console.error(`❌ رقم إجابة غلط: ${id}`); errors++; }
    if (new Set(q.choices.map(norm)).size !== 3) { console.error(`❌ اختيارات متكررة: ${id} — ${q.q.slice(0, 40)}`); errors++; }
    const key = norm(q.q);
    if (seenQ.has(key)) { console.error(`❌ سؤال مكرر في ${cat.name}: ${q.q.slice(0, 45)}`); errors++; }
    seenQ.set(key, id);
    if (/الأصح|الأدق|السؤال:|غلط[،.]/.test(q.q)) { console.error(`❌ صياغة ركيكة: ${id} — ${q.q.slice(0, 45)}`); errors++; }
    if (q.q.length > 200) { warns++; }
  }
}
console.log(errors ? `\n❌ ${errors} خطأ` : `✅ البنك سليم 100%: ${total} سؤال (10 كاتيجوري × 300 = سهل/متوسط/صعب 100 لكل مستوى) — تحذيرات: ${warns}`);
process.exit(errors ? 1 : 0);
