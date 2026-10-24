(function () {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var NAMES = { 1: '冬', 4: '春', 7: '夏', 10: '秋' }, KINDS = ['OP', 'ED', '挿入歌', 'キャラソン'];
  var SONGS = [], PL = {}, CM = {}, editId = null, ME = null, SC = {}, ST = {}, TABLE = null, ptoken = '', atoken = '', adminName = '';
  try { ptoken = localStorage.getItem('pr-token') || ''; atoken = sessionStorage.getItem('pr-admin') || ''; adminName = sessionStorage.getItem('pr-admin-name') || ''; } catch (e) {}

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function toast(t) { var e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('show'); }, 2600); }
  function store(k, v, sess) { try { (sess ? sessionStorage : localStorage)[v ? 'setItem' : 'removeItem'](k, v); } catch (e) {} }

  async function api(method, path, body, tok) {
    var h = { 'Content-Type': 'application/json' };
    if (tok) h.Authorization = 'Bearer ' + tok;
    var r = await fetch(path, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    var data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) { var err = new Error((data && data.error) || '通信に失敗しました'); err.status = r.status; throw err; }
    return data;
  }

  /* ---- 区分 ---- */
  var now = new Date(), yr = $('year');
  for (var y = now.getFullYear() + 1; y >= 2000; y--) yr.appendChild(new Option(y + '年', y));
  yr.value = now.getFullYear(); $('cour').value = [1, 4, 7, 10][Math.floor(now.getMonth() / 3)];
  function key() { return yr.value + '-' + $('cour').value + '-' + $('kind').value; }
  function courOf(k) { return k.split('-').slice(0, 2).join('-'); }
  function label(k) { var p = k.split('-'); return p[0] + '年' + NAMES[p[1]] + (p[2] || ''); }
  function songsOf(k) { return SONGS.filter(function (s) { return s.key === k; }).sort(function (a, b) { return a.at - b.at; }); }

  /* ---- 自分のランキング ---- */
  function rankedMine(k) {
    var a = songsOf(k).map(function (s, i) { return { s: s, i: i, v: SC[s.id] }; }).filter(function (x) { return typeof x.v === 'number'; });
    a.sort(function (x, y) { return y.v - x.v || x.i - y.i; });
    var rk = 0, pv = null; a.forEach(function (x, i) { if (x.v !== pv) { rk = i + 1; pv = x.v; } x.rank = rk; });
    return a;
  }
  function info(s, star) {
    var b = el('div'); b.appendChild(el('div', 't', (star ? '★ ' : '') + s.title));
    b.appendChild(el('div', 'm', [s.artist, s.anime].filter(Boolean).join(' / ')));
    return b;
  }
  function renderRank() {
    var k = key(), box = $('rank'); box.textContent = '';
    $('rh').textContent = (ME ? ME.name + 'さんの ' : '') + label(k) + ' ランキング';
    if (!ME) { box.appendChild(el('div', 'empty', '名前を入力して参加すると、あなたのランキングがここに出ます。')); return; }
    var L = rankedMine(k);
    if (!L.length) { box.appendChild(el('div', 'empty', '採点した曲がまだありません。下の曲一覧で点数を選ぶと、ここに順位が出ます。')); return; }
    var ol = el('ol');
    L.forEach(function (x) {
      var li = el('li', x.rank === 1 ? 'top1' : '');
      li.appendChild(el('div', 'rank', x.rank)); li.appendChild(info(x.s, ST[courOf(x.s.key)] === x.s.id));
      var p = el('div', 'pt', x.v.toFixed(1)); p.appendChild(el('small', '', '点')); li.appendChild(p); ol.appendChild(li);
    });
    box.appendChild(ol);
  }
  function renderList() {
    var k = key(), box = $('list'), L = songsOf(k); box.textContent = '';
    $('lh').textContent = '曲一覧 ' + label(k); renderPlink();
    if (!L.length) { box.appendChild(el('div', 'empty', atoken ? 'この区分の曲はまだありません。上のフォームから曲を追加してください。' : 'この区分の曲はまだありません。管理者が曲を追加するまでお待ちください。')); return; }
    L.forEach(function (s) {
      var row = el('div', 'row'), starred = ST[courOf(s.key)] === s.id;
      row.appendChild(info(s, false));
      var rc = el('div', 'rc');
      var stb = el('button', 'star' + (starred ? ' on' : ''), starred ? '★' : '☆');
      stb.title = label(courOf(s.key) + '-') + 'の☆(1曲だけ)'; stb.setAttribute('aria-label', s.title + 'に☆を付ける'); stb.setAttribute('aria-pressed', starred ? 'true' : 'false');
      stb.disabled = !ME; stb.onclick = function () { toggleStar(s); }; rc.appendChild(stb);
      var sel = el('select'); sel.setAttribute('aria-label', s.title + 'の点数'); sel.disabled = !ME;
      sel.appendChild(new Option('未採点', ''));
      for (var p = 10; p >= 0; p -= 0.5) sel.appendChild(new Option(p.toFixed(1) + '点', p));
      sel.value = typeof SC[s.id] === 'number' ? SC[s.id] : '';
      sel.onchange = function () { setScore(s.id, sel.value === '' ? null : Number(sel.value)); };
      rc.appendChild(sel);
      if (atoken) {
        var ed = el('button', 'ghost', '編集'); ed.onclick = function () { editSong(s); }; rc.appendChild(ed);
        var del = el('button', 'ghost', '削除');
        del.onclick = async function () {
          if (!confirm('「' + s.title + '」を削除します。全員の点数とコメントも消えます。')) return;
          try { await api('DELETE', '/api/admin/songs/' + s.id, undefined, atoken); if (editId === s.id) cancelEdit(); await refresh(); toast('削除しました'); } catch (e) { adminError(e, '削除できませんでした'); }
        };
        rc.appendChild(del);
      }
      row.appendChild(rc);
      if (ME) {
        var cm = el('input', 'cm'); cm.maxLength = 100; cm.placeholder = 'ひとこと(100字まで。見られるのは自分と管理者だけ)';
        cm.value = CM[s.id] || ''; cm.setAttribute('aria-label', s.title + 'へのひとこと');
        cm.onchange = function () { setComment(s.id, cm.value, cm); }; row.appendChild(cm);
      }
      box.appendChild(row);
    });
  }
  function renderPlink() {
    var b = $('plink'); b.textContent = ''; var u = PL[key()];
    if (u && /^https:\/\//.test(u)) {
      var a = el('a', '', label(key()) + 'のプレイリストを開く(Apple Music / iTunes)');
      a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; b.appendChild(a);
    }
  }
  function tabs() {
    var t = $('tabs'); t.textContent = ''; var seen = {};
    SONGS.forEach(function (s) { seen[s.key] = (seen[s.key] || 0) + 1; });
    function sk(k) { var p = k.split('-'); return Number(p[0]) * 100 + Number(p[1]); }
    Object.keys(seen).sort(function (a, b) { return sk(b) - sk(a) || KINDS.indexOf(a.split('-')[2]) - KINDS.indexOf(b.split('-')[2]); }).forEach(function (k) {
      var b = el('button', k === key() ? 'on' : '', label(k) + '(' + seen[k] + ')');
      b.onclick = function () { var p = k.split('-'); yr.value = p[0]; $('cour').value = p[1]; $('kind').value = p[2]; renderAll(); loadTable(); };
      t.appendChild(b);
    });
  }

  /* ---- 採点・☆ ---- */
  async function setScore(songId, v) {
    try { await api('PUT', '/api/me/score', { songId: songId, score: v }, ptoken); if (v == null) delete SC[songId]; else SC[songId] = v; renderRank(); renderList(); loadTable(); }
    catch (e) { toast(e.message); if (e.status === 401) forget(); else renderList(); }
  }
  async function toggleStar(s) {
    var c = courOf(s.key), on = ST[c] === s.id;
    try { await api('PUT', '/api/me/star', { songId: on ? null : s.id, cour: c }, ptoken); if (on) delete ST[c]; else ST[c] = s.id; renderRank(); renderList(); loadTable(); }
    catch (e) { toast(e.message); if (e.status === 401) forget(); }
  }

  async function setComment(songId, text, input) {
    try { var r = await api('PUT', '/api/me/comment', { songId: songId, text: text }, ptoken); if (r.text) CM[songId] = r.text; else delete CM[songId]; if (input) input.value = r.text; loadTable(); }
    catch (e) { toast(e.message); if (e.status === 401) forget(); }
  }
  $('rename').onclick = function () { $('renamePanel').hidden = false; $('rn').value = ME ? ME.name : ''; $('rn').focus(); };
  $('rcancel').onclick = function () { $('renamePanel').hidden = true; $('rmsg').textContent = ''; };
  $('rf').onsubmit = async function (e) {
    e.preventDefault(); $('rmsg').textContent = '';
    try { var r = await api('PUT', '/api/me/name', { name: $('rn').value }, ptoken); ME.name = r.name; $('renamePanel').hidden = true; renderAll(); loadTable(); toast('名前を変更しました'); }
    catch (err) { $('rmsg').textContent = err.message; if (err.status === 401) forget(); }
  };

  /* ---- 管理者の全体表 ---- */
  function f2(v) { return v == null ? '–' : (Math.round(v * 100) / 100).toFixed(2); }
  var TSIG = '';
  async function loadTable() {
    if (!atoken) return;
    loadPeople();
    try {
      var t = await api('GET', '/api/admin/table?key=' + encodeURIComponent(key()), undefined, atoken), sig = JSON.stringify(t);
      if (sig === TSIG) return; TSIG = sig; TABLE = t; renderMatrix();
    }
    catch (e) { adminError(e, '全体表を読み込めませんでした'); }
  }
  function renderMatrix() {
    $('adminSec').hidden = !atoken; if (!atoken || !TABLE) return;
    var t = TABLE, box = $('matrix'); box.textContent = ''; $('cmBox').hidden = true;
    $('mh').textContent = '全ユーザー一覧 ' + t.label;
    if (!t.rows.length || !t.people.length) { box.appendChild(el('div', 'empty', 'この区分の曲か、採点したユーザーがまだいません。')); return; }
    var wrap = el('div', 'mwrap'), tb = el('table', 'mx'), hr = el('tr');
    hr.appendChild(el('th', 'c1', '順位')); hr.appendChild(el('th', 'c2', '曲名'));
    t.people.forEach(function (u) { var th = el('th', '', u.name); th.title = u.name; hr.appendChild(th); });
    hr.appendChild(el('th', 'av', '曲の平均'));
    var th0 = el('thead'); th0.appendChild(hr); tb.appendChild(th0);
    var body = el('tbody');
    t.rows.forEach(function (r) {
      var tr = el('tr', r.rank === 1 ? 'top' : '');
      tr.appendChild(el('td', 'c1', r.rank == null ? '–' : r.rank));
      var c2 = el('td', 'c2', r.title); c2.appendChild(el('small', '', [r.artist, r.anime].filter(Boolean).join(' / '))); tr.appendChild(c2);
      t.people.forEach(function (u) {
        var v = r.scores[u.id], td = el('td', '', typeof v === 'number' ? v.toFixed(1) : '–');
        if (typeof v === 'number') td.style.background = 'color-mix(in srgb, var(--acc) ' + Math.round(v * 7) + '%, var(--card))';
        if (r.starBy.indexOf(u.id) >= 0) td.appendChild(el('span', 'gold', ' ★'));
        if (r.comments && r.comments[u.id]) { var mk = el('span', 'cmk', ' ✎'); mk.title = r.comments[u.id]; td.appendChild(mk); }
        tr.appendChild(td);
      });
      tr.appendChild(el('td', 'av', f2(r.avg))); body.appendChild(tr);
    });
    tb.appendChild(body);
    var tf = el('tfoot'), a = el('tr'), a1 = el('th', 'c1', 'ユーザーの平均'); a1.colSpan = 2; a1.style.textAlign = 'left'; a.appendChild(a1);
    t.people.forEach(function (u) { a.appendChild(el('td', '', f2(t.userAvg[u.id]))); }); a.appendChild(el('td', 'av', f2(t.overallAvg)));
    var b = el('tr'), b1 = el('th', 'c1', label(t.cour + '-') + 'の☆'); b1.colSpan = 2; b1.style.textAlign = 'left'; b.appendChild(b1);
    t.people.forEach(function (u) { var n = t.starTitles[u.id], td = el('td', 'st', n || '–'); td.title = n; b.appendChild(td); }); b.appendChild(el('td', 'av', ''));
    tf.appendChild(a); tf.appendChild(b); tb.appendChild(tf); wrap.appendChild(tb); box.appendChild(wrap);
    var list = $('cmList'); list.textContent = ''; var n = 0;
    t.rows.forEach(function (r) {
      t.people.forEach(function (u) {
        var c = r.comments && r.comments[u.id]; if (!c) return; n++;
        var line = el('div', 'cmrow'); line.appendChild(el('b', '', r.title + ' / ' + u.name + ': ')); line.appendChild(document.createTextNode(c)); list.appendChild(line);
      });
    });
    $('cmSum').textContent = 'ひとこと(' + n + '件)'; $('cmBox').hidden = !n;
  }
  async function download(path, fallback) {
    try {
      var r = await fetch(path, { headers: { Authorization: 'Bearer ' + atoken } });
      if (!r.ok) { var d = null; try { d = await r.json(); } catch (e) {} var er = new Error((d && d.error) || fallback); er.status = r.status; throw er; }
      var m = (r.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''(.+)$/), name = m ? decodeURIComponent(m[1]) : 'party-rank';
      var url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('保存しました');
    } catch (e) { adminError(e, fallback); }
  }
  function exportUrl(fmt, extra) { return '/api/admin/export?key=' + encodeURIComponent(key()) + '&format=' + fmt + (extra || '') + ($('desc').checked ? '&order=desc' : ''); }
  $('exTbl').onclick = function () { download(exportUrl('csv', '&footer=1'), '書き出せませんでした'); };
  $('exVcsv').onclick = function () { download(exportUrl('csv'), '書き出せませんでした'); };
  $('exVjson').onclick = function () { download(exportUrl('json'), '書き出せませんでした'); };

  /* ---- 自分のCSV ---- */
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  $('exMine').onclick = function () {
    var L = rankedMine(key()); if (!ME || !L.length) { toast('出力できる採点がありません'); return; }
    var rows = [['ユーザー名', 'ランキング', '順位', '曲名', 'アーティスト', 'アニメ作品名', '点数', '☆']];
    L.forEach(function (x) { rows.push([ME.name, label(key()), x.rank, x.s.title, x.s.artist, x.s.anime, x.v, ST[courOf(x.s.key)] === x.s.id ? '★' : '']); });
    var url = URL.createObjectURL(new Blob(['﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n')], { type: 'text/csv' }));
    var a = document.createElement('a'); a.href = url; a.download = 'my-ranking-' + key() + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  };

  /* ---- 参加(名前) ---- */
  function forget() { ptoken = ''; ME = null; SC = {}; ST = {}; CM = {}; store('pr-token', ''); renderAll(); }
  async function loadMe() {
    if (!ptoken) { ME = null; SC = {}; ST = {}; CM = {}; return; }
    try { var m = await api('GET', '/api/me', undefined, ptoken); ME = { name: m.name }; SC = m.scores || {}; ST = m.stars || {}; CM = m.comments || {}; }
    catch (e) { if (e.status === 401) forget(); }
  }
  $('jf').onsubmit = async function (e) {
    e.preventDefault(); $('jmsg').textContent = '';
    try {
      var r = await api('POST', '/api/join', { name: $('jn').value, pass: $('jp').value });
      ptoken = r.token; store('pr-token', ptoken); $('jp').value = ''; $('jn').value = ''; await loadMe(); renderAll(); toast(r.name + 'さんとして参加しました');
    } catch (err) { $('jmsg').textContent = err.message; }
  };
  $('leave').onclick = function () { forget(); $('joinPanel').hidden = false; $('jn').focus(); };

  /* ---- 管理者 ---- */
  var PSIG = '';
  async function loadPeople() {
    if (!atoken) return;
    try {
      var r = await api('GET', '/api/admin/people', undefined, atoken), sig = JSON.stringify(r.people);
      if (sig === PSIG) return; PSIG = sig;
      var box = $('ppl'); box.textContent = '';
      if (!r.people.length) { box.appendChild(el('span', 'm', 'まだ参加者はいません。')); return; }
      r.people.forEach(function (u) {
        var chip = el('span', 'chip'); chip.appendChild(document.createTextNode(u.name + '(採点 ' + u.scored + '曲)'));
        var d = el('button', 'ghost', '削除'); d.setAttribute('aria-label', u.name + 'を削除');
        d.onclick = async function () {
          if (!confirm('「' + u.name + '」を削除します。この人の点数・☆・ひとことも消え、元に戻せません。')) return;
          try { await api('DELETE', '/api/admin/people/' + u.id, undefined, atoken); PSIG = ''; TSIG = ''; await loadPeople(); await loadTable(); toast('削除しました'); } catch (e) { adminError(e, '削除できませんでした'); }
        };
        chip.appendChild(d); box.appendChild(chip);
      });
    } catch (e) { adminError(e, ''); }
  }
  function adminError(e, fb) { if (e.status === 401) { adminLogout(true); toast('管理者のログインが切れました。もう一度入ってください'); } else toast(e.message || fb); }
  $('adminIn').onclick = function () { $('loginPanel').hidden = false; $('adm').focus(); };
  $('lcancel').onclick = function () { $('loginPanel').hidden = true; $('pw').value = ''; $('lmsg').textContent = ''; };
  $('lf').onsubmit = async function (e) {
    e.preventDefault(); $('lmsg').textContent = '';
    try {
      var r = await api('POST', '/api/admin/login', { name: $('adm').value, password: $('pw').value });
      atoken = r.token; adminName = r.name; store('pr-admin', atoken, true); store('pr-admin-name', adminName, true);
      $('pw').value = ''; $('loginPanel').hidden = true; await enterAdmin(); toast(adminName + 'として管理者画面に入りました');
    } catch (err) { $('lmsg').textContent = err.message; }
  };
  async function enterAdmin() { await loadAdmins(); await loadTable(); renderAll(); }
  async function adminLogout(silent) {
    var t = atoken; atoken = ''; adminName = ''; TABLE = null; TSIG = ''; PSIG = ''; cancelEdit(); store('pr-admin', '', true); store('pr-admin-name', '', true);
    if (t && !silent) { try { await api('POST', '/api/admin/logout', {}, t); } catch (e) {} }
    renderAll(); if (!silent) toast('管理者画面を出ました');
  }
  $('adminOut').onclick = function () { adminLogout(false); };
  async function loadAdmins() {
    try { var r = await api('GET', '/api/admin/admins', undefined, atoken); $('admList').textContent = '登録済みの管理者: ' + r.admins.join('、'); } catch (e) { adminError(e, ''); }
  }
  $('af').onsubmit = async function (e) {
    e.preventDefault();
    try { var r = await api('POST', '/api/admin/admins', { name: $('an').value, password: $('ap').value }, atoken); $('an').value = ''; $('ap').value = ''; $('admList').textContent = '登録済みの管理者: ' + r.admins.join('、'); toast('管理者を追加しました'); }
    catch (err) { if (err.status === 401) adminError(err); else toast(err.message); }
  };
  function editSong(s) {
    editId = s.id; $('title').value = s.title; $('artist').value = s.artist || ''; $('anime').value = s.anime || '';
    $('fsub').textContent = '変更を保存'; $('fcancelBar').hidden = false; $('editNote').textContent = label(s.key) + 'の曲を編集中です。';
    $('addPanel').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('title').focus();
  }
  function cancelEdit() { editId = null; $('title').value = ''; $('artist').value = ''; $('anime').value = ''; $('fsub').textContent = '曲を追加'; $('fcancelBar').hidden = true; }
  $('fcancel').onclick = cancelEdit;
  $('f').onsubmit = async function (e) {
    e.preventDefault(); var t = $('title').value.trim(); if (!t) return;
    var body = { title: t, artist: $('artist').value, anime: $('anime').value };
    try {
      if (editId) { await api('PUT', '/api/admin/songs/' + editId, body, atoken); cancelEdit(); await refresh(); toast('曲を変更しました'); }
      else { body.key = key(); await api('POST', '/api/admin/songs', body, atoken); $('title').value = ''; $('artist').value = ''; await refresh(); toast('曲を追加しました'); $('title').focus(); }
    } catch (err) { adminError(err, '曲を保存できませんでした'); }
  };
  $('pf').onsubmit = async function (e) {
    e.preventDefault();
    try {
      var r = await api('PUT', '/api/admin/playlist', { key: key(), url: $('purl').value }, atoken);
      if (r.url) PL[key()] = r.url; else delete PL[key()];
      $('purl').value = r.url; renderPlink(); toast(r.url ? 'プレイリストを保存しました' : 'プレイリストを外しました');
    } catch (err) { adminError(err, '保存できませんでした'); }
  };

  /* ---- 描画 ---- */
  function renderAll() {
    var admin = !!atoken;
    $('meName').textContent = ME ? ME.name + 'さんとして参加中' : '名前が未入力です';
    $('adminBadge').hidden = !admin; $('adminBadge').textContent = admin ? '管理者: ' + adminName : '管理者';
    $('adminIn').hidden = admin; $('adminOut').hidden = !admin;
    $('leave').hidden = !ME; $('rename').hidden = !ME; if (!ME) $('renamePanel').hidden = true; $('joinPanel').hidden = !!ME;
    $('addPanel').hidden = !admin; $('adminMgr').hidden = !admin; $('adminSec').hidden = !admin;
    $('exMine').hidden = !ME;
    $('lead').textContent = admin ? '管理者画面です。曲の追加・全ユーザーの採点の確認・動画用データの書き出しができます。'
      : '名前を入力して参加し、曲一覧から点数(0〜10)を付けると、あなたのランキングができます。各クールで1曲だけ☆を付けられます。';
    if (admin) $('purl').value = PL[key()] || '';
    tabs(); renderRank(); renderList(); renderMatrix();
  }
  var SIG = '';
  async function refresh(silent) {
    try {
      var res = await api('GET', '/api/songs'), songs = res.songs, sig = JSON.stringify(res);
      if (silent === true && sig === SIG) { loadTable(); return; }
      SIG = sig; SONGS = songs; PL = res.playlists || {};
    } catch (e) { if (silent !== true) toast('曲一覧を読み込めませんでした'); return; }
    renderAll(); loadTable();
  }
  yr.onchange = $('cour').onchange = $('kind').onchange = function () { renderAll(); loadTable(); };

  (async function init() {
    await loadMe();
    if (atoken) { try { await enterAdmin(); } catch (e) {} }
    await refresh();
    setInterval(function () { if (!document.hidden) refresh(true); }, 20000);
  })();
})();
