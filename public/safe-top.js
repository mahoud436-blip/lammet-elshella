/* ═══════════ مسافة شريط إشعارات الموبايل ═══════════
   المشكلة: بعض الأجهزة الصفحة فيها بتمتد تحت شريط الإشعارات، وبعضها لأ.
   ورقم ثابت مايصلحش للاتنين: بيبقى ناقص على الجديد وفراغ ميت على القديم.

   الحل بالترتيب:
     1) نقيس env(safe-area-inset-top) الحقيقية من الجهاز — دي أدق حاجة.
     2) لو الجهاز مابيرجّعهاش (بترجع صفر) نسيبها صفر، عشان ما نعملش فراغ
        على جهاز مش محتاجه.
     3) لو لسه في تداخل، المستخدم يظبطها مرة واحدة من زرار «؟» (أو ?top=NN
        في اللينك) والقيمة بتتحفظ على الجهاز ده لوحده.
   ═════════════════════════════════════════════════ */
(function () {
  'use strict';
  var KEY = 'lamma_safe_top';
  var root = document.documentElement;

  /* القيمة الحقيقية من الجهاز */
  function measured() {
    var d = document.createElement('div');
    d.setAttribute('data-safe-probe', '1');
    d.style.cssText = 'position:fixed;top:0;left:0;width:1px;visibility:hidden';
    d.style.height = 'env(safe-area-inset-top, 0px)';
    if (!d.style.height) d.style.height = 'constant(safe-area-inset-top, 0px)';   /* iOS 11 القديم */
    (document.body || root).appendChild(d);
    var h = Math.round(d.getBoundingClientRect().height);
    d.parentNode.removeChild(d);
    return h > 0 && h < 120 ? h : 0;
  }

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      if (v === null) return null;
      var n = parseInt(v, 10);
      return isFinite(n) && n >= 0 && n <= 80 ? n : null;
    } catch (e) { return null; }
  }

  function apply(px) {
    root.style.setProperty('--safe-top', px + 'px');
    SafeTop.value = px;
  }

  var SafeTop = {
    value: 0,
    auto: 0,
    /* اظبطها واحفظها على الجهاز ده */
    set: function (px) {
      px = Math.max(0, Math.min(80, Math.round(px)));
      try { localStorage.setItem(KEY, String(px)); } catch (e) {}
      apply(px);
      return px;
    },
    /* ارجع للقياس التلقائي */
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      apply(SafeTop.auto);
      return SafeTop.auto;
    },
    isCustom: function () { return stored() !== null; },
  };
  window.SafeTop = SafeTop;

  function init() {
    SafeTop.auto = measured();
    /* ?top=NN في اللينك بيظبطها ويحفظها — طريقة سريعة لجهاز عنيد */
    var q = (location.search.match(/[?&]top=(\d{1,2})\b/) || [])[1];
    if (q != null) { SafeTop.set(parseInt(q, 10)); return; }
    var s = stored();
    apply(s === null ? SafeTop.auto : s);
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
