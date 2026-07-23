'use strict';
/* بنك «المحقق والمتهم»: 7 كاتيجوريز × 200 كلمة، بمطابقة متسامحة لتخمين المحقق والمتهم */
const CATS = [
  { id: 'living', icon: '🐾', name: 'كائنات حية',      file: './living' },
  { id: 'food',   icon: '🍔', name: 'أكل وشرب',        file: './food' },
  { id: 'things', icon: '🔧', name: 'حاجات وأدوات',    file: './things' },
  { id: 'places', icon: '🌍', name: 'أماكن ومعالم',    file: './places' },
  { id: 'people', icon: '👤', name: 'شخصيات مشهورة',   file: './people' },
  { id: 'jobs',   icon: '💼', name: 'مهن وشغلانات',    file: './jobs' },
  { id: 'sports', icon: '⚽', name: 'رياضة',           file: './sports' },
  { id: 'art',    icon: '🎬', name: 'فن وترفيه',       file: './art' },
];

function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^a-z0-9\u0621-\u064A\s]/g, ' ')
    .replace(/\bال/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function editDistance(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[lb];
}
function tol(len) { return len <= 2 ? 0 : len <= 6 ? 1 : 2; }

const byCat = new Map();
const all = [];
for (const c of CATS) {
  const rows = require(c.file);
  const items = rows.map((row, i) => {
    const title = Array.isArray(row) ? row[0] : row;
    const syns = Array.isArray(row) ? (row[1] || []) : [];
    const accepts = [title, ...syns].filter(Boolean).map(normalize).filter(Boolean);
    return { id: c.id + '_' + i, cat: c.id, title, accepts: [...new Set(accepts)] };
  });
  byCat.set(c.id, items);
  all.push(...items);
}

module.exports = {
  cats: () => CATS.map(c => ({ id: c.id, icon: c.icon, name: c.name, count: byCat.get(c.id).length })),
  catMeta: (id) => { const c = CATS.find(x => x.id === id); return c ? { id: c.id, icon: c.icon, name: c.name } : null; },
  catItems: (id) => byCat.get(id) || [],
  get: (itemId) => all.find(x => x.id === itemId) || null,
  normalize, editDistance, tol,

  /* تخمين المحقق والمتهم للكلمة — متسامح مع الأخطاء الإملائية */
  isMatch(item, guess) {
    const g = normalize(guess);
    if (!g) return false;
    for (const acc of item.accepts) {
      if (g === acc) return true;
      if (acc.length >= 4 && (` ${acc} `).includes(` ${g} `) && g.length >= 4) return true;
      const t = tol(Math.max(g.length, acc.length));
      if (editDistance(g, acc, t) <= t) return true;
      for (const w of acc.split(' ')) {
        if (w.length >= 4 && editDistance(g, w, tol(w.length)) <= tol(w.length)) return true;
      }
    }
    return false;
  },

  /* هل النص فيه الكلمة السرية؟ (مش مستخدم هنا — الأسئلة مسموح فيها كل حاجة) */
  leaksSecret(item, word) {
    const nw = normalize(word);
    if (!nw) return false;
    const parts = nw.split(' ');
    for (const acc of item.accepts) {
      if (nw === acc) return true;                          // مطابقة تامة (حتى لو كلمة قصيرة زي «دب»)
      if (acc.length >= 3 && nw.includes(acc)) return true;
      for (const w of acc.split(' ')) {
        if (w.length < 3) { if (parts.includes(w)) return true; continue; }
        for (const pw of parts) {
          const t = tol(Math.max(pw.length, w.length));
          if (editDistance(pw, w, t) <= t) return true;
        }
      }
    }
    return false;
  },

  /* هل الكلمة دي اتقالت قبل كده في الجولة؟ — مطابقة متسامحة */
  sameWord(a, b) {
    const x = normalize(a), y = normalize(b);
    if (!x || !y) return false;
    if (x === y) return true;
    // تسامح ضيق: حرف واحد بس وللكلمات الطويلة — عشان «كبير» و«كتير» يفضلوا مختلفين
    if (Math.min(x.length, y.length) >= 6) return editDistance(x, y, 1) <= 1;
    return false;
  },
};
