'use strict';
/* بنك «لمّحها» — 8 كاتيجوريز × 300 كلمة (100 لكل مستوى) */
const CATS = [
  { id: 'football', icon: '⚽', name: 'نجوم كورة',      file: './football' },
  { id: 'islamic',  icon: '🕌', name: 'شخصيات إسلامية', file: './islamic' },
  { id: 'history',  icon: '🏛️', name: 'شخصيات تاريخية', file: './history' },
  { id: 'places',   icon: '🌍', name: 'بلاد ومدن',      file: './places' },
  { id: 'celebs',   icon: '🎬', name: 'مشاهير وفن',     file: './celebs' },
  { id: 'animals',  icon: '🐾', name: 'حيوانات',        file: './animals' },
  { id: 'food',     icon: '🍔', name: 'أكلات ومشروبات', file: './food' },
  { id: 'things',   icon: '📱', name: 'حاجات وأدوات',   file: './things' },
];

/* ═══════════════ نواة المطابقة — واحدة بالظبط في التلات ألعاب ═══════════════
   شكل السطر في ملفات الكاتيجوري:
       ["الكلمة", ["مرادف", "مرادف"]]                 ← المستوى بالترتيب
       ["الكلمة", ["مرادف"], "easy"|"medium"|"hard"]   ← المستوى صريح (له الأولوية)
   كل كاتيجوري 300 كلمة: 0-99 سهل • 100-199 متوسط • 200-299 صعب
   ═══════════════════════════════════════════════════════════════════════ */

/* شيل «ال» التعريف من أول كل كلمة — بالتكرار عشان الأسماء اللي أصلها بيبدأ بـ«ال»
   («الألباني» → «باني») وعشان normalize تطلع نفس النتيجة لو اتنادت مرتين.
   الشرط {3,} بيحمي الكلمات القصيرة: «الله» و«النو» بيفضلوا زي ما هما. */
function stripAl(s) {
  let prev;
  do { prev = s; s = s.replace(/(^|\s)ال(?=[\u0621-\u064A]{3,})/g, '$1'); } while (s !== prev);
  return s;
}

function normalize(s) {
  return stripAl(String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')   // تشكيل + تطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^a-z0-9\u0621-\u064A\s]/g, ' ')     // شيل ترقيم ورموز
    .replace(/\s+/g, ' ')
    .trim());
}

/* مسافة تحرير (Levenshtein) بسقف */
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

/* تسامح التخمين — صارم: الكلمات القصيرة لازم تتكتب صح («نسر» ماتتقبلش مكان «نمر») */
function tol(len) { return len <= 4 ? 0 : len <= 7 ? 1 : 2; }
/* تسامح فلاتر التسريب — واسع: نمسك أي حاجة قريبة من الكلمة السرية */
function tolLeak(len) { return len <= 2 ? 0 : len <= 6 ? 1 : 2; }

/* مقارنة متسامحة للتخمين: غلطة حرف مسموحة، بس في الكلمات القصيرة أول حرف
   وآخر حرف لازم يكونوا مظبوطين. ده بيفرّق بين الكلمات المتشابهة
   («بولندا»≠«هولندا» • «بيرو»≠«بيروت» • «نابل»≠«نابلس») ولسه بيسامح على
   الغلط الحقيقي اللي بيحصل في النص («نيمر»→نيمار • «مودرتش»→مودريتش). */
function fuzzyEq(a, b) {
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  const t = tol(len);
  if (t === 0) return false;
  if (len <= 7 && (a[0] !== b[0] || a[a.length - 1] !== b[b.length - 1])) return false;
  return editDistance(a, b, t) <= t;
}

const LEVELS = [
  { id: 'easy',   name: 'سهل',   icon: '🟢' },
  { id: 'medium', name: 'متوسط', icon: '🟡' },
  { id: 'hard',   name: 'صعب',   icon: '🔴' },
];
const TIER = 100;
const LEVEL_IDS = LEVELS.map(l => l.id);
function levelOf(row, i) {
  const tag = Array.isArray(row) ? row[2] : null;
  if (typeof tag === 'string' && LEVEL_IDS.includes(tag)) return tag;
  return i < TIER ? 'easy' : i < TIER * 2 ? 'medium' : 'hard';
}

const byCat = new Map();
const byCatLevel = new Map();
const tokenFreq = new Map();   // "cat|token" → عدد المدخلات اللي فيها التوكن ده
const all = [];

for (const c of CATS) {
  const rows = require(c.file);
  const items = rows.map((row, i) => {
    const title = Array.isArray(row) ? row[0] : row;
    const synRaw = Array.isArray(row) ? (row[1] || []) : [];
    const syns = Array.isArray(synRaw) ? synRaw : [synRaw];
    const accepts = [title, ...syns].filter(Boolean).map(normalize).filter(Boolean);
    return { id: c.id + '_' + i, cat: c.id, level: levelOf(row, i), title, accepts: [...new Set(accepts)] };
  });
  byCat.set(c.id, items);
  byCatLevel.set(c.id, {
    easy: items.filter(x => x.level === 'easy'),
    medium: items.filter(x => x.level === 'medium'),
    hard: items.filter(x => x.level === 'hard'),
  });
  /* عدّ التوكنات: عشان كلمة شائعة زي «ابن» أو «محمد» ماتبقاش تخمين مقبول لوحدها */
  for (const it of items) {
    const seen = new Set();
    for (const acc of it.accepts) for (const w of acc.split(' ')) {
      if (w.length < 3 || seen.has(w)) continue;
      seen.add(w);
      const k = c.id + '|' + w;
      tokenFreq.set(k, (tokenFreq.get(k) || 0) + 1);
    }
  }
  all.push(...items);
}

/* التوكن ده مميّز للاسم ده؟ (مش شائع في الكاتيجوري) */
const MAX_SHARED = 2;
function distinctive(cat, token) { return (tokenFreq.get(cat + '|' + token) || 0) <= MAX_SHARED; }

/* كل عناوين البنك — بنستخدمها عشان كلمة موجودة كمدخل مستقل
   ما تتقبلش كإجابة لمدخل تاني مركّب منها */
const titleSet = new Set(all.map(x => normalize(x.title)));
/* مين من البنك ومين كلمة كتبها المتّهم بنفسه */
const bankIds = new Set(all.map(x => x.id));

/* فهرس المقاطع المتّصلة (كلمتين أو أكتر) اللي جوه الأسماء الطويلة —
   عشان «لوحة المفاتيح» تتقبل لـ«لوحة المفاتيح الرقمية».
   بنعدّ كل مقطع بيتكرر في كام مدخل: لو في أكتر من واحد يبقى ملخبط ومبيتقبلش
   («دوري أبطال» بتوصّل لأوروبا وأفريقيا — فمترفض) */
const phraseFreq = new Map();
for (const it of all) {
  const seen = new Set();
  for (const acc of it.accepts) {
    const w = acc.split(' ').filter(Boolean);
    if (w.length < 3) continue;                       /* المقطع لازم يكون أقصر من الاسم */
    for (let i = 0; i < w.length; i++) {
      for (let n = 2; n <= w.length - i - 1; n++) {
        const frag = w.slice(i, i + n).join(' ');
        if (seen.has(frag)) continue;
        seen.add(frag);
        const k = it.cat + '|' + frag;
        phraseFreq.set(k, (phraseFreq.get(k) || 0) + 1);
      }
    }
  }
}
/* المقطع ده بيوصّل لمدخل واحد بس؟
   0 = مش موجود في أي كلمة بنك (زي الكلمة اللي المتّهم كتبها بنفسه — مفيش لبس)
   1 = مدخل واحد بس  •  2+ = ملخبط، مبيتقبلش */
function phraseOk(cat, frag) { return (phraseFreq.get(cat + '|' + frag) || 0) <= 1; }

module.exports = {
  cats: () => CATS.map(c => ({ id: c.id, icon: c.icon, name: c.name, count: byCat.get(c.id).length })),
  LEVELS,
  isLevel: (lv) => LEVELS.some(l => l.id === lv),
  levelMeta: (lv) => LEVELS.find(l => l.id === lv) || LEVELS[0],
  catMeta: (id) => { const c = CATS.find(x => x.id === id); return c ? { id: c.id, icon: c.icon, name: c.name } : null; },
  catItems: (id) => byCat.get(id) || [],
  catItemsByLevel: (id, lv) => { const m = byCatLevel.get(id); if (!m) return []; return (lv && m[lv]) ? m[lv] : (byCat.get(id) || []); },
  get: (itemId) => all.find(x => x.id === itemId) || null,
  normalize, editDistance, tol, tolLeak, distinctive,

  /* ═══ كل المدخلات اللي بتشاور على نفس الكيان (نفس الاسم أو صيغة تانية منه) ═══
     بتتنادى مرة واحدة أول ما الكلمة تتسحب، عشان «نيمار» و«نيمار جونيور»
     و«قطز» في كاتيجوريتين ما يجوش مرتين في نفس اللعبة.
     التجميع بيتم على أساس الاسم المطبّع أو مرادف مشترك بس — مش الاحتواء،
     عشان «هارون الرشيد» ما تتجمعش مع مدينة «رشيد» */
  relatedIds(item) {
    if (!item) return [];
    const out = [item.id];
    const accs = new Set(item.accepts);
    const nt = normalize(item.title);
    for (const other of all) {
      if (other.id === item.id) continue;
      if (normalize(other.title) === nt) { out.push(other.id); continue; }
      for (const a of other.accepts) if (accs.has(a)) { out.push(other.id); break; }
    }
    return out;
  },

  /* ═══ تخمين اللاعب صح؟ — متسامح مع الغلط الإملائي، صارم ضد الكلمات التانية ═══ */
  isMatch(item, guess) {
    const g = normalize(guess);
    if (!g) return false;
    const single = !g.includes(' ');
    const fromBank = bankIds.has(item.id);
    for (const acc of item.accepts) {
      if (g === acc) return true;                       // مطابقة تامة
      if (fuzzyEq(g, acc)) return true;                 // غلطة حرف/اتنين
      if (!single) {
        /* تخمين من كذا كلمة جوه اسم أطول — بشرط إنه يوصّل لمدخل واحد بس */
        if (acc.includes(' ') && (' ' + acc + ' ').includes(' ' + g + ' ')
            && !titleSet.has(g) && phraseOk(item.cat, g)) return true;
        continue;
      }
      /* كلمة واحدة جوه اسم مركّب */
      for (const w of acc.split(' ')) {
        if (w.length < 4) continue;
        if (fromBank) {
          /* كلمة من البنك: نعتمد على الإحصائيات — لازم تكون مميّزة
             («صلاح» أيوه، «محمد» لأ) ومش مدخل مستقل لوحدها
             (عشان «خروف» ما تتقبلش مكان «خروف البحر») */
          if (!distinctive(item.cat, w)) continue;
          if (titleSet.has(g) && g !== normalize(item.title)) continue;
        } else {
          /* كلمة المتّهم كتبها بنفسه: مفيش إحصائيات عنها، فالكلمة الواحدة
             تتقبل بس لو هي معظم الاسم — «الأهرامات» من «الأهرامات الثلاثة» أيوه،
             لكن «فريق» من «فريق الاتحاد الأوروبي» لأ */
          if (w.length * 2 < acc.replace(/\s+/g, '').length) continue;
          if (titleSet.has(g)) continue;
        }
        if (g === w || fuzzyEq(g, w)) return true;
      }
    }
    return false;
  },

  /* ═══ النص ده فيه الكلمة السرية أو حاجة قريبة منها؟ (يترفض) ═══ */
  leaksSecret(item, word) {
    const nw = normalize(word);
    if (!nw) return false;
    const parts = nw.split(' ');
    for (const acc of item.accepts) {
      if (nw === acc) return true;
      if (acc.length >= 3 && nw.includes(acc)) return true;
      for (const w of acc.split(' ')) {
        if (w.length < 3) { if (parts.includes(w)) return true; continue; }
        for (const pw of parts) {
          const t = tolLeak(Math.max(pw.length, w.length));
          if (editDistance(pw, w, t) <= t) return true;
        }
      }
    }
    return false;
  },

  /* ═══ التلميح بيكشف الاسم؟ (فلتر عكسي للمُلمِّح) ═══ */
  hintLeaks(item, hint) {
    return module.exports.leaksSecret(item, hint);
  },

  /* ═══ التلميح قريب أوي من الاسم؟ — أصرم: بيمسك القلب والجناس كمان ═══ */
  cluTooClose(item, clue) {
    const rtol = (len) => len <= 5 ? 1 : 2;
    const anagram = (a, b) => a.length === b.length && a.length >= 3 && a.split('').sort().join('') === b.split('').sort().join('');
    const words = normalize(clue).split(' ').filter(w => w.length >= 2);
    for (const w of words) {
      for (const acc of item.accepts) {
        if (w === acc) return true;
        if (acc.length >= 3 && editDistance(w, acc, rtol(Math.max(w.length, acc.length))) <= rtol(Math.max(w.length, acc.length))) return true;
        if (anagram(w, acc)) return true;
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

  /* ═══ الكلمة دي اتقالت قبل كده؟ ═══ */
  sameWord(a, b) {
    const x = normalize(a), y = normalize(b);
    if (!x || !y) return false;
    if (x === y) return true;
    if (Math.min(x.length, y.length) >= 6) return editDistance(x, y, 1) <= 1;
    return false;
  },
};
