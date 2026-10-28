/* 日本語の改行を文節の切れ目にそろえる(読みやすい位置で折り返すため)。
   word-break: auto-phrase に対応したブラウザ(Chromeなど)では何もしません。 */
(function () {
  'use strict';
  if (window.CSS && CSS.supports && CSS.supports('word-break', 'auto-phrase')) return;
  var Z = '​';
  var HIRA = /[ぁ-ゟ]/, WORD = /[㐀-鿿々〆ァ-ヺーA-Za-z0-9]/;
  var CLOSE = '、。,.!?!?」』)）】〕〉》', OPEN = '「『(（【〔〈《';
  function split(t) {
    var out = '', runStart = -1;
    for (var i = 0; i < t.length; i++) {
      var c = t.charAt(i), p = i ? t.charAt(i - 1) : '';
      if (i) {
        var brk = false;
        if (CLOSE.indexOf(p) >= 0) brk = CLOSE.indexOf(c) < 0 && !/\s/.test(c) && !('、。,.!?!?'.indexOf(p) < 0 && HIRA.test(c));
        else if (OPEN.indexOf(c) >= 0) brk = OPEN.indexOf(p) < 0 && !/\s/.test(p);
        else if (HIRA.test(p) && WORD.test(c)) {
          // 「お知らせ」「ご利用」のように、1文字の接頭語は切り離さない
          var runLen = i - runStart;
          brk = !(runLen === 1 && 'おごみ'.indexOf(p) >= 0);
        }
        if (brk) out += Z;
      }
      if (HIRA.test(c)) { if (runStart < 0 || !HIRA.test(p)) runStart = i; } else runStart = -1;
      out += c;
    }
    return out;
  }
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, OPTION: 1, SELECT: 1, TITLE: 1 };
  function proc(n) {
    var par = n.parentNode; if (!par || SKIP[par.nodeName]) return;
    var v = n.nodeValue; if (!v || v.length < 6) return;
    var w = split(v.replace(/​/g, ''));
    if (w !== v) n.nodeValue = w;
  }
  function walk(root) {
    if (root.nodeType === 3) { proc(root); return; }
    if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), x, list = [];
    while ((x = tw.nextNode())) list.push(x);
    list.forEach(proc);
  }
  function start() {
    walk(document.body);
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === 'characterData') proc(m.target);
        else Array.prototype.forEach.call(m.addedNodes, walk);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
