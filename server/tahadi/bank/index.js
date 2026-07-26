// اسأل واستفيد — فهرس بنك الأسئلة (10 كاتيجوري × 300 = 3000)
// كل كاتيجوري: 0-99 سهل | 100-199 متوسط | 200-299 صعب
const CATS = [
  { id: 'movies',     name: 'أفلام ومسلسلات',   icon: '🎬' },
  { id: 'anime',      name: 'أنمي وكرتون',      icon: '🍥' },
  { id: 'hist_islam', name: 'تاريخ إسلامي',     icon: '🕌' },
  { id: 'hist_ar',    name: 'تاريخ مصر والعرب', icon: '🏺' },
  { id: 'geo_ar',     name: 'جغرافيا عربية',    icon: '🗺️' },
  { id: 'geo_world',  name: 'جغرافيا العالم',   icon: '🌍' },
  { id: 'religion',   name: 'معلومات دينية',    icon: '📿' },
  { id: 'sports',     name: 'رياضة',            icon: '⚽' },
  { id: 'sci',        name: 'علوم وتكنولوجيا',  icon: '🔬' },
  { id: 'mix',        name: 'منوعات ومكس',      icon: '🎲' },
];

const LEVELS = [
  { id: 'easy',   name: 'سهل',   icon: '🟢' },
  { id: 'medium', name: 'متوسط', icon: '🟡' },
  { id: 'hard',   name: 'صعب',   icon: '🔴' },
];
const TIER = 100; // عدد الأسئلة في كل مستوى لكل كاتيجوري
function levelOf(i) { return i < TIER ? 'easy' : i < TIER * 2 ? 'medium' : 'hard'; }

const byId = new Map();
for (const cat of CATS) {
  const rows = require('./' + cat.id + '.js');
  cat.count = rows.length;
  cat.ids = [];
  cat.idsByLevel = { easy: [], medium: [], hard: [] };
  rows.forEach((row, i) => {
    const bankId = cat.id + ':' + i;
    const level = levelOf(i);
    cat.ids.push(bankId);
    (cat.idsByLevel[level] || cat.idsByLevel.easy).push(bankId);
    byId.set(bankId, {
      bankId,
      cat: cat.id,
      level,
      q: row[0],
      choices: [row[1], row[2], row[3]],
      a: row[4],
    });
  });
}

module.exports = {
  CATS,
  LEVELS,
  byId,
  get(bankId) { return byId.get(bankId); },
  catMeta(catId) { const c = CATS.find(c => c.id === catId); return c ? { id: c.id, name: c.name, icon: c.icon } : null; },
  levelMeta(lv) { return LEVELS.find(l => l.id === lv) || LEVELS[0]; },
  isLevel(lv) { return LEVELS.some(l => l.id === lv); },
  /* لو اتبعت مستوى → أسئلة المستوى ده بس، من غير مستوى → الكل */
  catIds(catId, level) {
    const c = CATS.find(c => c.id === catId);
    if (!c) return [];
    if (level && c.idsByLevel[level]) return c.idsByLevel[level];
    return c.ids;
  },
  total() { return byId.size; },
};
