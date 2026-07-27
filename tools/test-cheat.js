'use strict';
/* اختبار حقيقي في DOM: بيقلّد ترتيب render() الفعلي —
   updPresence بتشتغل الأول وبعدها app.innerHTML بيتمسح ويترسم من جديد */
const { JSDOM } = require('jsdom');
const fs = require('fs');

const GAMES = ['conan', 'jasoos', 'lammaha', 'tahadi'];
let allOk = true;

for (const g of GAMES) {
  const src = fs.readFileSync('/home/claude/work/game/public/' + g + '/app.js', 'utf8');
  const m = src.match(/let CHEAT_SEEN[\s\S]*?\nfunction updPresence\(st\) \{[\s\S]*?\n\}/);
  if (!m) { console.log('❌ ' + g + ': مالقيتش updPresence'); allOk = false; continue; }

  const dom = new JSDOM('<!DOCTYPE html><body><div id="app"></div></body>');
  const { window } = dom;
  const doc = window.document;
  global.document = doc; global.window = window;

  const ctx = {
    $: (s) => doc.querySelector(s),
    esc: (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    document: doc,
  };
  const updPresence = new Function('$', 'esc', 'Snd', 'DOOR_OUT', 'document', 'window',
    m[0] + '; return updPresence;')(ctx.$, ctx.esc, { play() {} }, '<svg></svg>', doc, window);

  const header = () => '<div class="topbar">هيدر</div>';
  const app = doc.getElementById('app');
  const PH = { conan: 'play', jasoos: 'play', lammaha: 'clue', tahadi: 'quiz' };
  const phase = PH[g];

  const players = [
    { name: 'هوست', avatar: '🕵️', away: false, left: false, connected: true },
    { name: 'Hossa', avatar: '🧔', away: true, left: false, connected: true },
    { name: 'سالي', avatar: '👩', away: false, left: false, connected: true },
  ];
  const st = { phase, players };

  /* ترتيب render() الحقيقي: updPresence → بعدين الشاشة بتترسم من الأول */
  app.innerHTML = header();
  updPresence(st);
  const before = !!doc.getElementById('cheat-alert');

  app.innerHTML = header();          /* رسمة جديدة بتمسح #app بالكامل */
  const survived = !!doc.getElementById('cheat-alert');
  const bar = doc.getElementById('presence-bar');
  const circlesLive = !!bar && bar.querySelectorAll('.pv').length === players.length
    && [...bar.querySelectorAll('.av')].map(x => x.textContent).join('') === players.map(p => p.avatar).join('');

  updPresence(st);                   /* الحالة الجاية */
  const el = doc.getElementById('cheat-alert');
  const text = el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const inBody = el && el.parentElement === doc.body;

  /* رجع طبيعي → لازم يختفي */
  updPresence({ phase, players: players.map(p => ({ ...p, away: false })) });
  const gone = !doc.getElementById('cheat-alert');

  /* برّه اللعبة → لازم يختفي */
  updPresence(st);
  updPresence({ phase: 'lobby', players });
  const goneLobby = !doc.getElementById('cheat-alert');

  const ok = before && survived && circlesLive && inBody && /امسك غشاش/.test(text) && /Hossa/.test(text) && gone && goneLobby;
  if (!ok) allOk = false;
  console.log((ok ? '✅' : '❌') + ' ' + g.padEnd(8) +
    ' | ظهر: ' + (before ? '✔' : '✘') +
    ' | عاش بعد إعادة الرسم: ' + (survived ? '✔' : '✘') +
    ' | الدواير باقية: ' + (circlesLive ? '✔' : '✘') +
    ' | في body: ' + (inBody ? '✔' : '✘') +
    ' | اختفى لما رجع: ' + (gone ? '✔' : '✘') +
    ' | اختفى برّه اللعبة: ' + (goneLobby ? '✔' : '✘'));
  if (text) console.log('     النص: «' + text + '»');
}
console.log('\n' + (allOk ? '🎉 التحذير شغال في الأربع ألعاب' : '⚠️ في مشكلة'));
