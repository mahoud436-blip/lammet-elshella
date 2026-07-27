'use strict';
/* التنبيه بينبثق من أفاتار اللي بيغش + الصوت بيرن مرة واحدة وقصير وخافت */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const GAME = process.env.GAME_DIR || path.join(__dirname, '..');
const GAMES = ['conan', 'jasoos', 'lammaha', 'tahadi'];
const PHASE = { conan: 'play', jasoos: 'play', lammaha: 'clue', tahadi: 'quiz' };

let bad = 0;
const ok = (c, m, x) => { if (!c) bad++; console.log('  ' + (c ? '✅' : '❌') + ' ' + m + (x !== undefined ? '  — ' + x : '')); };

/* أفاتارات وهمية بمواضع حقيقية: عرض 34 وارتفاع 34، جنب بعض */
const RECTS = { p1: 120, p2: 170, p3: 220 };

for (const g of GAMES) {
  console.log('\n[' + g + ']');
  const src = fs.readFileSync(path.join(GAME, 'public', g, 'app.js'), 'utf8');

  /* ── الصوت متعرّف؟ قصير وخافت؟ ── */
  const line = (src.match(/^ {4}if \(name === 'alert'\).*$/m) || [''])[0];
  const tones = [...line.matchAll(/this\.tone\(([\d.]+),\s*t(?:\s*\+\s*([\d.]+))?,\s*([\d.]+),\s*'(\w+)',\s*([\d.]+)\)/g)];
  ok(tones.length >= 1, 'صوت التنبيه متعرّف', tones.length + ' نغمة');
  if (tones.length) {
    const last = tones[tones.length - 1];
    const total = (parseFloat(last[2] || 0) + parseFloat(last[3])) * 1000;
    const maxVol = Math.max(...tones.map(t => parseFloat(t[5])));
    ok(total <= 250, 'مدته قصيرة جدًا', Math.round(total) + ' مللي ثانية');
    ok(maxVol <= 0.08, 'صوته خافت', 'أعلى مستوى ' + maxVol + ' (باقي الأصوات .12–.2)');
  }

  /* ── شغّل updPresence في متصفح وهمي ── */
  const m = src.match(/let CHEAT_SEEN[\s\S]*?\nfunction updPresence\(st\) \{[\s\S]*?\n\}/);
  if (!m) { ok(false, 'مالقيتش updPresence'); continue; }

  const dom = new JSDOM('<!DOCTYPE html><body><div id="app"><div id="presence-bar" class="presence-bar hidden"></div></div></body>',
    { runScripts: 'dangerously' });
  const w = dom.window, d = w.document;
  Object.defineProperty(w, 'innerWidth', { value: 380, configurable: true });

  const played = [];
  const ctx = {
    $: s => d.querySelector(s),
    esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    Snd: { play: n => played.push(n) },
    DOOR_OUT: '<svg></svg>',
    document: d, window: w,
  };
  const upd = new Function('$', 'esc', 'Snd', 'DOOR_OUT', 'document', 'window',
    m[0] + '; return updPresence;')(ctx.$, ctx.esc, ctx.Snd, ctx.DOOR_OUT, d, w);

  /* المواضع بتتحدد على مستوى الـprototype عشان تفضل بعد إعادة الرسم */
  w.Element.prototype.getBoundingClientRect = function () {
    const x = (this.dataset && RECTS[this.dataset.pid]) || 0;
    return { left: x, right: x + 34, top: 10, bottom: 44, width: 34, height: 34, x, y: 10 };
  };
  Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { get() { return this.id === 'cheat-alert' ? 190 : 0; }, configurable: true });
  const stub = () => {};
  const mk = awayId => ({
    phase: PHASE[g],
    players: [
      { id: 'p1', name: 'محمود', avatar: '🦅', away: awayId === 'p1', left: false, connected: true },
      { id: 'p2', name: 'ميدو', avatar: '🎯', away: awayId === 'p2', left: false, connected: true },
      { id: 'p3', name: 'حسام', avatar: '🧠', away: awayId === 'p3', left: false, connected: true },
    ],
  });

  /* أول ما ميدو (p2) يخرج */
  upd(mk('p2')); stub(); upd(mk('p2'));
  const cap = d.querySelector('#cheat-alert');
  ok(!!cap, 'التنبيه ظهر');
  if (cap) {
    const left = parseFloat(cap.style.left), top = parseFloat(cap.style.top);
    const tail = cap.style.getPropertyValue('--tail');
    const cx = RECTS.p2 + 17;
    ok(cap.style.transform === 'none', 'اتفك من التوسيط');
    ok(Math.abs(left - (cx - 95)) < 1, 'متمركز تحت أفاتار ميدو', 'left=' + left);
    ok(top === 55, 'تحت الأفاتار مباشرة', 'top=' + top);
    ok(Math.abs(parseFloat(tail) - (cx - left)) < 1, 'الذيل بيشاور على الأفاتار', 'tail=' + tail);
    ok(/ميدو/.test(cap.textContent) && /امسك غشاش/.test(cap.textContent), 'فيه اسمه والعنوان');
    ok(!!d.querySelector('.pv[data-pid="p2"].away'), 'الأفاتار نفسه متعلّم (بينبض)');
  }
  ok(played.filter(x => x === 'alert').length === 1, 'الصوت رنّ مرة واحدة', played.join(',') || 'مافيش');

  /* تحديثات متكررة لنفس الشخص — مفيش صوت تاني */
  upd(mk('p2')); upd(mk('p2')); stub(); upd(mk('p2'));
  ok(played.filter(x => x === 'alert').length === 1, 'مبيتكررش مع كل تحديث', played.length + ' مرة إجمالي');

  /* واحد تاني يخرج — صوت جديد وموضع جديد */
  upd(mk('p3')); stub(); upd(mk('p3'));
  ok(played.filter(x => x === 'alert').length === 2, 'رنّ تاني لما حد جديد خرج');
  const cap2 = d.querySelector('#cheat-alert');
  ok(cap2 && Math.abs(parseFloat(cap2.style.left) - (RECTS.p3 + 17 - 95)) < 1, 'اتنقل لأفاتار حسام', 'left=' + (cap2 && cap2.style.left));

  /* رجعوا كلهم */
  upd(mk(null));
  ok(!d.querySelector('#cheat-alert'), 'اختفى لما رجعوا');

  /* الحافة اليمين: مايخرجش برّه الشاشة */
  const wide = { phase: PHASE[g], players: [{ id: 'p1', name: 'حد', avatar: '🦅', away: true, left: false, connected: true }] };
  RECTS.p1 = 350;
  upd(wide); stub(); upd(wide);
  const cap3 = d.querySelector('#cheat-alert');
  ok(cap3 && parseFloat(cap3.style.left) + 190 <= 380 - 8 + 0.5, 'مبيخرجش برّه الشاشة', 'left=' + (cap3 && cap3.style.left));
  RECTS.p1 = 120;
}

console.log('\n' + (bad ? '⚠️  ' + bad + ' فشل' : '🎉 التنبيه بينبثق من الأفاتار والصوت مظبوط'));
process.exit(bad ? 1 : 0);
