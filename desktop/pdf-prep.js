'use strict';
// 閲覧用HTMLを PDF 用に整える（ページ内で実行）：見出しに role=heading を付けて PDF のしおりにする
module.exports = function pdfPrep() {
  var HL = { title: 1, h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, th1: 1, th2: 2, th3: 3, th4: 4, th5: 5 };
  document.documentElement.setAttribute('data-theme', 'light');
  var pages = [].slice.call(document.querySelectorAll('section.scn-page'));
  var multi = pages.length > 1 && pages.every(function (s) { return s.getAttribute('data-name'); });
  var st = document.createElement('style');
  st.textContent = '.pdf-ph{position:absolute;left:0;top:0;font-size:1px;line-height:1px;color:#fff;margin:0;padding:0;pointer-events:none}'
    + '.scn-page{position:relative}'
    + '@media print{.mat-panel,.rpanel,.v-panel,#matPanel,#flagPanel,#evtPanel,#pcPanel,#clipPanel,.box-copy,.npc-copy{display:none!important}}';
  document.head.appendChild(st);
  pages.forEach(function (sec) {
    if (multi) {
      var t = document.createElement('div');
      t.className = 'pdf-ph'; t.setAttribute('role', 'heading'); t.setAttribute('aria-level', '1');
      t.textContent = sec.getAttribute('data-name');
      sec.insertBefore(t, sec.firstChild);
    }
  });
  [].forEach.call(document.querySelectorAll('.block[data-type]'), function (b) {
    var lv = HL[b.getAttribute('data-type')]; if (!lv) return;
    var be = b.querySelector('.be'); if (!be || !be.textContent.trim()) return;
    be.setAttribute('role', 'heading'); be.setAttribute('aria-level', String(Math.min(6, lv + (multi ? 1 : 0))));
  });
  [].forEach.call(document.querySelectorAll('details'), function (d) { d.open = true; });
  [].forEach.call(document.querySelectorAll('.block.collapsed'), function (b) { b.classList.remove('collapsed'); });
  return { pages: pages.length, multi: multi };
};
