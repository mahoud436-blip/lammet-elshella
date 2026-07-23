'use strict';
/* بنك «لمّحها»: 8 كاتيجوريز × 100 عنوان، مع مطابقة متسامحة */
const CATS = [
  { id: 'football', icon: '⚽', name: 'نجوم كورة', file: './football' },
  { id: 'islamic',  icon: '🕌', name: 'شخصيات إسلامية', file: './islamic' },
  { id: 'history',  icon: '🏛️', name: 'شخصيات تاريخية', file: './history' },
  { id: 'places',   icon: '🌍', name: 'بلاد ومدن', file: './places' },
  { id: 'celebs',   icon: '🎬', name: 'مشاهير وفن', file: './celebs' },
  { id: 'animals',  icon: '🐾', name: 'حيوانات', file: './animals' },
  { id: 'food',     icon: '🍔', name: 'أكلات ومشروبات', file: './food' },
  { id: 'things',   icon: '📱', name: 'حاجات وأدوات', file: './things' },
];

/* تطبيع النص العربي/الإنجليزي للمقارنة المتسامحة */
function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')   // تشكيل + تطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^a-z0-9\u0621-\u064A\s]/g, ' ')      // شيل ترقيم/رموز
    .replace(/\bال/g, '')                            // شيل "ال" التعريف من بداية الكلمات
    .replace(/\s+/g, ' ')
    .trim();
}

/* مسافة تحرير (Levenshtein) مع سقف — للتسامح مع خطأ حرف/اتنين */
function editDistance(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    let cur = [i];
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

/* سقف التسامح حسب طول الكلمة */
function tol(len) { return len <= 2 ? 0 : len <= 6 ? 1 : 2; }

const LEVELS = [
  { id: 'easy',   name: 'سهل',   icon: '🟢' },
  { id: 'medium', name: 'متوسط', icon: '🟡' },
  { id: 'hard',   name: 'صعب',   icon: '🔴' },
];
const TIER = 100;
function levelOf(i) { return i < TIER ? 'easy' : i < TIER * 2 ? 'medium' : 'hard'; }

const byCat = new Map();
const byCatLevel = new Map();
const all = [];
for (const c of CATS) {
  const rows = require(c.file);
  const items = rows.map((row, i) => {
    const title = Array.isArray(row) ? row[0] : row;
    const synRaw = Array.isArray(row) ? (row[1] || []) : [];
    const syns = Array.isArray(synRaw) ? synRaw : [synRaw];
    const accepts = [title, ...syns].filter(Boolean).map(normalize).filter(Boolean);
    return { id: c.id + '_' + i, cat: c.id, level: levelOf(i), title, accepts: [...new Set(accepts)] };
  });
  byCat.set(c.id, items);
  byCatLevel.set(c.id, { easy: items.filter(x => x.level === 'easy'), medium: items.filter(x => x.level === 'medium'), hard: items.filter(x => x.level === 'hard') });
  all.push(...items);
}

module.exports = {
  cats: () => CATS.map(c => ({ id: c.id, icon: c.icon, name: c.name, count: byCat.get(c.id).length })),
  LEVELS,
  isLevel: (lv) => LEVELS.some(l => l.id === lv),
  levelMeta: (lv) => LEVELS.find(l => l.id === lv) || LEVELS[0],
  catItemsByLevel: (id, lv) => { const m = byCatLevel.get(id); if (!m) return []; return (lv && m[lv]) ? m[lv] : (byCat.get(id) || []); },
  catMeta: (id) => { const c = CATS.find(x => x.id === id); return c ? { id: c.id, icon: c.icon, name: c.name } : null; },
  catItems: (id) => byCat.get(id) || [],
  get: (itemId) => all.find(x => x.id === itemId) || null,
  normalize,

  /* هل التلميح المكتوب فيه الاسم نفسه أو حاجة قريبة منه؟ (فلتر عكسي) */
  hintLeaks(item, hint) {
    const nh = normalize(hint);
    if (!nh) return false;
    const hintWords = nh.split(' ');
    for (const acc of item.accepts) {
      if (nh.includes(acc)) return true; // الاسم كامل جوه التلميح
      for (const w of acc.split(' ')) {
        if (w.length < 3) continue;
        for (const hw of hintWords) {
          const t = tol(Math.max(hw.length, w.length));
          if (editDistance(hw, w, t) <= t) return true; // كلمة قريبة إملائيًا من كلمة في الاسم
        }
      }
    }
    return false;
  },

  /* هل تخمين اللاعب صح للعنوان ده؟ (متسامح) */
  isMatch(item, guess) {
    const g = normalize(guess);
    if (!g) return false;
    for (const acc of item.accepts) {
      if (g === acc) return true;
      // احتواء: لو التخمين كلمة أساسية جوه الاسم الكامل أو العكس (وطولها معقول)
      if (acc.length >= 4 && (g === acc || (` ${acc} `).includes(` ${g} `) && g.length >= 4)) return true;
      // تسامح خطأ حرف/اتنين على الكلمة كاملة
      if (editDistance(g, acc, tol(Math.max(g.length, acc.length))) <= tol(Math.max(g.length, acc.length))) return true;
      // تسامح على أطول كلمة في الاسم (عشان "رونالدوو" ≈ "كريستيانو رونالدو")
      for (const word of acc.split(' ')) {
        if (word.length >= 4 && editDistance(g, word, tol(word.length)) <= tol(word.length)) return true;
      }
    }
    return false;
  },

  /* هل التلميح المكتوب قريب أوي من الاسم (يعني بيكشفه)؟ نرفضه لو كده.
     بنفحص كل كلمة في التلميح: لو أي كلمة = الاسم أو مرادف أو قريبة منه إملائيًا → مرفوض. */
  cluTooClose(item, clue) {
    const rtol = (len) => len <= 5 ? 1 : 2; // فلتر التلميح أصرم شوية عشان يمسك القريب
    const anagram = (a, b) => a.length === b.length && a.length >= 3 && a.split('').sort().join('') === b.split('').sort().join('');
    const words = normalize(clue).split(' ').filter(w => w.length >= 2);
    for (const w of words) {
      for (const acc of item.accepts) {
        if (w === acc) return true;
        if (acc.length >= 3 && editDistance(w, acc, rtol(Math.max(w.length, acc.length))) <= rtol(Math.max(w.length, acc.length))) return true;
        if (anagram(w, acc)) return true; // نفس حروف الاسم مرتبة غلط (صالح ≈ صلاح)
        for (const part of acc.split(' ')) {
          if (part.length >= 3 && (w === part || anagram(w, part) || editDistance(w, part, rtol(part.length)) <= rtol(part.length))) return true;
        }
      }
    }
    const joined = normalize(clue).replace(/\s+/g, '');
    for (const acc of item.accepts) {
      const a = acc.replace(/\s+/g, '');
      if (a.length >= 4 && joined.includes(a)) return true;
    }
    return false;
  },
};
