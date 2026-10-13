'use strict';
// 閲覧用HTMLを PDF 用に整える（ページ内で実行）：見出しに role=heading を付けて PDF のしおりにする
module.exports = function pdfPrep() {
  var HL = { title: 1, h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, th1: 1, th2: 2, th3: 3, th4: 4, th5: 5 };
  document.documentElement.setAttribute('data-theme', 'light');
  var pages = [].slice.call(document.querySelectorAll('section.scn-page'));
  var multi = pages.length > 1 && pages.every(function (s) { return s.getAttribute('data-name'); });
  /* 文字サイズを1段階小さく（極小/小/やや小/中） */
  var STEPS = [0.58, 0.7, 0.775, 0.85];
  [].forEach.call(document.querySelectorAll('.wrap'), function (w) {
    var cur = parseFloat(w.style.getPropertyValue('--fs') || getComputedStyle(w).getPropertyValue('--fs')) || 0.775;
    var next = STEPS[0];
    for (var i = 0; i < STEPS.length; i++) { if (STEPS[i] < cur - 0.001) next = STEPS[i]; }
    w.style.setProperty('--fs', String(next));
  });
  var st = document.createElement('style');
  st.textContent = '.pdf-ph{position:absolute;left:0;top:0;font-size:1px;line-height:1px;color:#fff;margin:0;padding:0;pointer-events:none}'
    + '.scn-page{position:relative;display:block!important}'
    + '.pdf-keep{break-inside:avoid;page-break-inside:avoid}'
    + '@media print{'
    + '.print-toc{display:none!important}'
    + '.mat-panel,.rpanel,.v-panel,#matPanel,#flagPanel,#evtPanel,#pcPanel,#clipPanel,.box-copy,.npc-copy{display:none!important}'
    + '.block[data-type="divider"]{break-after:page;page-break-after:always;height:0!important;padding:0!important;margin:0!important;border:0!important}'
    + '.block[data-type="divider"] hr{display:none!important}'
    + '.block[data-type="skill"],.block[data-type="skill2"]{background:transparent!important;border:0!important;border-left:1px dotted var(--blue)!important;border-radius:0!important;padding-bottom:0!important}'
    + '.block[data-type="skill"] .lbl,.block[data-type="skill2"] .lbl{left:-1px!important;background:var(--blue)!important;color:#fff!important}'
    + '}';
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
  /* 見出しリンクを PDF 内リンクにする */
  [].forEach.call(document.querySelectorAll('a.hlink[data-h]'), function (a) {
    var id = a.getAttribute('data-h'); if (id && document.getElementById('b_' + id)) a.setAttribute('href', '#b_' + id);
  });
  [].forEach.call(document.querySelectorAll('details'), function (d) { d.open = true; });
  [].forEach.call(document.querySelectorAll('.block.collapsed'), function (b) { b.classList.remove('collapsed'); });
  /* 区切り線の手前の空行は詰める（空白ページを作らない） */
  [].forEach.call(document.querySelectorAll('.block[data-type="divider"]'), function (dv) {
    var p = dv.previousElementSibling;
    while (p && p.classList.contains('block') && p.getAttribute('data-type') === 'p' && !p.textContent.replace(/[\s\u200B]/g, '') && !p.querySelector('img')) {
      p.style.setProperty('display', 'none', 'important');
      p = p.previousElementSibling;
    }
  });
  /* 見出しが枠の上にはみ出す枠：外側に余白付きの箱を作り、枠と見出しをまとめて次のページへ送る */
  [].forEach.call(document.querySelectorAll('.block[data-type]'), function (b) {
    var lbl = null;
    for (var i = 0; i < b.children.length; i++) { if (b.children[i].classList.contains('lbl')) { lbl = b.children[i]; break; } }
    if (!lbl || getComputedStyle(lbl).position !== 'absolute') return;
    var over = Math.ceil(b.getBoundingClientRect().top - lbl.getBoundingClientRect().top);
    if (over <= 0) return;
    var mt = parseFloat(getComputedStyle(b).marginTop) || 0;
    var w = document.createElement('div');
    w.className = 'pdf-keep';
    w.style.paddingTop = (over + 1) + 'px';
    w.style.marginTop = Math.max(0, mt - over - 1) + 'px';
    b.parentNode.insertBefore(w, b);
    w.appendChild(b);
    b.style.setProperty('margin-top', '0', 'important');
  });
  return { pages: pages.length, multi: multi };
};
