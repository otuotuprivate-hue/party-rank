/* 画面の読み込み中にエラーが起きたとき、原因が分かるように画面の下に表示します(問題の調査用) */
(function () {
  var shown = 0;
  function show(msg) {
    try {
      if (shown >= 3) return; shown++;
      var b = document.createElement('div');
      b.setAttribute('role', 'alert');
      b.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#fff3cd;color:#3a2a00;border:2px solid #e0a800;border-radius:10px;padding:10px 12px;font:13px/1.5 sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.3)';
      b.textContent = '画面の表示でエラーが起きました。ページを再読み込みしても直らない場合は、次の内容を運営に伝えてください: ' + msg;
      var x = document.createElement('button'); x.type = 'button'; x.textContent = '閉じる'; x.style.cssText = 'display:block;margin-top:6px;padding:4px 10px';
      x.onclick = function () { if (b.parentNode) b.parentNode.removeChild(b); };
      b.appendChild(x); (document.body || document.documentElement).appendChild(b);
    } catch (e) { /* */ }
  }
  window.addEventListener('error', function (e) {
    if (e && e.target && e.target !== window && e.target.tagName) { if (e.target.tagName !== 'SCRIPT') return; show((e.target.src || e.target.href || '') + ' を読み込めませんでした'); return; }
    show(String((e && e.message) || 'error') + ' (' + String((e && e.filename) || '').split('/').pop() + ':' + (e && e.lineno) + ') ' + navigator.userAgent.replace(/^Mozilla\/5.0 /, '').slice(0, 80));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason; show('通信/処理エラー: ' + String((r && r.message) || r).slice(0, 120));
  });
})();
