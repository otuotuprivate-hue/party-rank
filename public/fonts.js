/* Webフォントを、画面の表示を止めないように後から読み込む(回線が遅いときの待ち時間を減らすため) */
(function () {
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=M+PLUS+Rounded+1c:wght@400;500;700;800&display=swap';
  (document.head || document.documentElement).appendChild(l);
})();
