// تحدي الشلة — فهرس بنك الأسئلة (10 كاتيجوري × 100 سؤال = 1000)
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

const byId = new Map();
for (const cat of CATS) {
  const rows = require('./' + cat.id + '.js');
  cat.count = rows.length;
  cat.ids = [];
  rows.forEach((row, i) => {
    const bankId = cat.id + ':' + i;
    cat.ids.push(bankId);
    byId.set(bankId, {
      bankId,
      cat: cat.id,
      q: row[0],
      choices: [row[1], row[2], row[3]],
      a: row[4],
    });
  });
}

module.exports = {
  CATS,
  byId,
  get(bankId) { return byId.get(bankId); },
  catMeta(catId) { const c = CATS.find(c => c.id === catId); return c ? { id: c.id, name: c.name, icon: c.icon } : null; },
  catIds(catId) { const c = CATS.find(c => c.id === catId); return c ? c.ids : []; },
  total() { return byId.size; },
};
