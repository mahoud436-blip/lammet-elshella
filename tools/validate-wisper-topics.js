const T = require('../server/wisper/topics');
let errors = 0;
if (T.length !== 200) { console.error('❌ العدد ' + T.length + ' مش 200'); errors++; }
const seen = new Set();
T.forEach((t, i) => {
  if (!t || !t.trim()) { console.error('❌ عنوان فاضي #' + i); errors++; }
  if (t.length > 80) { console.error('❌ عنوان طويل #' + i); errors++; }
  const k = t.trim();
  if (seen.has(k)) { console.error('❌ مكرر: ' + k); errors++; }
  seen.add(k);
});
console.log(errors ? '❌ ' + errors + ' خطأ' : '✅ بنك حبر سري سليم: 200 عنوان فريد');
process.exit(errors ? 1 : 0);
