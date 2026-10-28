(function () {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var NAMES = { 1: '冬', 4: '春', 7: '夏', 10: '秋' }, KINDS = ['OP', 'ED', '挿入歌', 'キャラソン'];
  var LINKS = [], ICDATA = '', PASTS = [], MODES = {}, DEAD = {}, PART = null, OPENK = {}, SORT = { uid: null, dir: -1 }, NEWS = [], SONGS = [], PL = {}, CM = {}, editId = null, ME = null, SC = {}, ST = {}, TABLE = null, ptoken = '', atoken = '', adminName = '';
  try { ptoken = localStorage.getItem('pr-token') || ''; atoken = sessionStorage.getItem('pr-admin') || ''; adminName = sessionStorage.getItem('pr-admin-name') || ''; } catch (e) {}

  function confirmBox(title, body, okLabel) {
    return new Promise(function (resolve) {
      var m = $('modal'), prev = document.activeElement;
      $('mTitle').textContent = title; $('mBody').textContent = body; $('mOk').textContent = okLabel || '削除する';
      m.hidden = false; $('mCancel').focus();
      function done(v) { m.hidden = true; document.removeEventListener('keydown', key); $('mOk').onclick = $('mCancel').onclick = m.onclick = null; if (prev && prev.focus) { try { prev.focus(); } catch (e) {} } resolve(v); }
      function key(e) { if (e.key === 'Escape') done(false); }
      document.addEventListener('keydown', key);
      $('mOk').onclick = function () { done(true); }; $('mCancel').onclick = function () { done(false); };
      m.onclick = function (e) { if (e.target === m) done(false); };
    });
  }
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function avatar(id, ic, name, cls) {
    var s = el('span', 'avt ' + (cls || '')), ch = Array.from(String(name || '?'))[0] || '?';
    if (id && ic) {
      var im = document.createElement('img'); im.src = '/api/icon/' + encodeURIComponent(id) + '?v=' + ic; im.alt = ''; im.loading = 'lazy';
      im.onerror = function () { im.remove(); s.textContent = ch; };
      s.appendChild(im);
    } else {
      var h = 0; Array.from(String(name || '')).forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; });
      s.textContent = ch; s.style.background = 'hsl(' + h + ' 55% 45%)';
    }
    return s;
  }
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
  var now = new Date(), yr = $('year'), YEARS = [];
  function buildYears(keep) {
    var set = {}, a = [];
    for (var y = now.getFullYear() + 1; y >= 2000; y--) set[y] = 1;
    YEARS.forEach(function (v) { set[v] = 1; }); if (keep) set[keep] = 1;
    Object.keys(set).forEach(function (v) { a.push(Number(v)); }); a.sort(function (p, q) { return q - p; });
    yr.textContent = ''; a.forEach(function (v) { yr.appendChild(new Option(v + '年', v)); });
    yr.value = keep || now.getFullYear();
  }
  buildYears(0); $('cour').value = [1, 4, 7, 10][Math.floor(now.getMonth() / 3)];
  var LAST = null; try { LAST = JSON.parse(localStorage.getItem('pr-last') || 'null'); } catch (e) {}
  if (LAST && /^\d{4}$/.test(String(LAST.y)) && NAMES[LAST.c] && KINDS.indexOf(LAST.k) >= 0) { buildYears(Number(LAST.y)); $('cour').value = LAST.c; $('kind').value = LAST.k; }
  function saveLast() { try { localStorage.setItem('pr-last', JSON.stringify({ y: yr.value, c: $('cour').value, k: $('kind').value })); } catch (e) {} }
  function key() { return yr.value + '-' + $('cour').value + '-' + $('kind').value; }
  function courOf(k) { return k.split('-').slice(0, 2).join('-'); }
  function label(k) { var p = k.split('-'); return p[0] + '年' + NAMES[p[1]] + (p[2] || ''); }
  function songsOf(k) { return SONGS.filter(function (s) { return s.key === k; }).sort(function (a, b) { return (a.ord - b.ord) || (a.at - b.at); }); }

  /* ---- 自分のランキング ---- */
  function rankedMine(k) {
    var a = songsOf(k).map(function (s, i) { return { s: s, i: i, v: SC[s.id] }; }).filter(function (x) { return typeof x.v === 'number'; });
    a.sort(function (x, y) { return y.v - x.v || x.i - y.i; });
    var rk = 0, pv = null; a.forEach(function (x, i) { if (x.v !== pv) { rk = i + 1; pv = x.v; } x.rank = rk; });
    return a;
  }
  function info(s, star) {
    var b = el('div'); b.appendChild(el('div', 't', (star ? '★ ' : '') + s.title));
    if (s.artist) b.appendChild(el('div', 'ln', s.artist));
    if (s.anime) b.appendChild(el('div', 'ln an', s.anime));
    return b;
  }
  function renderRank() {
    var k = key(), box = $('rank'); box.textContent = '';
    $('rh').textContent = (ME ? ME.name + 'さんの ' : '') + label(k) + ' ランキング';
    if (!ME) { box.appendChild(el('div', 'empty', 'ログインすると、あなたのランキングがここに出ます。')); return; }
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
    L.forEach(function (s, idx) {
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
        var up = el('button', 'ghost mv', '↑'); up.title = '上へ'; up.setAttribute('aria-label', s.title + 'を上へ'); up.disabled = idx === 0; up.onclick = function () { moveSong(L, idx, -1); }; rc.appendChild(up);
        var dn = el('button', 'ghost mv', '↓'); dn.title = '下へ'; dn.setAttribute('aria-label', s.title + 'を下へ'); dn.disabled = idx === L.length - 1; dn.onclick = function () { moveSong(L, idx, 1); }; rc.appendChild(dn);
        var ed = el('button', 'ghost', '編集'); ed.onclick = function () { editSong(s); }; rc.appendChild(ed);
        var del = el('button', 'ghost', '削除');
        del.onclick = async function () {
          if (!(await confirmBox('曲を削除しますか?', '「' + s.title + '」(' + label(s.key) + ')を削除します。\nこの曲への全員の点数・ひとこと・☆も消え、元に戻せません。'))) return;
          try { await api('DELETE', '/api/admin/songs/' + s.id, undefined, atoken); if (editId === s.id) cancelEdit(); await refresh(); toast('削除しました'); } catch (e) { adminError(e, '削除できませんでした'); }
        };
        rc.appendChild(del);
      }
      row.appendChild(rc);
      if (ME) {
        var cm = el('input', 'cm'); cm.maxLength = 100; cm.placeholder = 'ひとこと(100字まで)';
        cm.value = CM[s.id] || ''; cm.setAttribute('aria-label', s.title + 'へのひとこと');
        var cmT; cm.oninput = function () { clearTimeout(cmT); cmT = setTimeout(function () { setComment(s.id, cm.value); }, 900); };
        cm.onchange = function () { clearTimeout(cmT); setComment(s.id, cm.value); }; row.appendChild(cm);
      }
      box.appendChild(row);
    });
  }
  async function moveSong(L, idx, d) {
    var j = idx + d; if (j < 0 || j >= L.length) return;
    var ids = L.map(function (x) { return x.id; }), t = ids[idx]; ids[idx] = ids[j]; ids[j] = t;
    try { await api('PUT', '/api/admin/songs/order', { key: key(), ids: ids }, atoken); await refresh(); }
    catch (e) { adminError(e, '並び替えできませんでした'); }
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
      b.onclick = function () { var p = k.split('-'); yr.value = p[0]; $('cour').value = p[1]; $('kind').value = p[2]; saveLast(); renderAll(); loadTable(); };
      t.appendChild(b);
    });
  }

  /* ---- 採点・☆ ---- */
  /* 保存: 画面にはすぐ反映し、サーバーへの保存は裏で行う。通信できないときは(更新中のサーバー再起動なども含め)自動で再試行する */
  var PQ = {}, PEND = {};
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function renderSaveState() {
    var n = Object.keys(PEND).length, b = $('saveState'); b.hidden = !n;
    if (n) b.textContent = '保存しています…(通信できないときは、自動でやり直します。このページは閉じないでください)';
  }
  function isBusy() { var a = document.activeElement; return !!(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.closest && a.closest('#list, #rank, #adminSec')); }
  async function resync() {
    if (!ptoken || Object.keys(PEND).length) return;
    await loadMe(); renderRank(); if (!isBusy()) renderList();
  }
  function persist(k, send, after) {
    var st = PQ[k] || (PQ[k] = { busy: false, dirty: false });
    st.dirty = true; if (st.busy) return;
    st.busy = true; PEND[k] = 1; renderSaveState();
    (async function () {
      var delays = [0, 1500, 3000, 6000, 10000, 15000, 20000, 30000], failed = null;
      while (st.dirty && !failed) {
        st.dirty = false; var ok = false;
        for (var i = 0; i < delays.length; i++) {
          if (delays[i]) await sleep(delays[i]);
          try { await send(); ok = true; break; }
          catch (e) { if (e.status && e.status < 500 && e.status !== 429) { failed = e; break; } }
        }
        if (!ok && !failed) failed = new Error('通信できませんでした');
      }
      st.busy = false; delete PEND[k]; renderSaveState();
      if (failed) {
        if (failed.status === 401) { toast(failed.message); forget(); return; }
        toast('保存できませんでした: ' + failed.message + '(画面を最新の状態に戻します)');
        await resync(); return;
      }
      if (after) after();
    })();
  }
  window.addEventListener('beforeunload', function (e) { if (Object.keys(PEND).length) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) resync(); });
  var afterSave = (function () { var t; return function () { clearTimeout(t); t = setTimeout(function () { loadTable(); loadPart(); }, 600); }; })();

  function setScore(songId, v) {
    if (v == null) delete SC[songId]; else SC[songId] = v;
    renderRank();
    persist('s' + songId, function () { return api('PUT', '/api/me/score', { songId: songId, score: typeof SC[songId] === 'number' ? SC[songId] : null }, ptoken); }, afterSave);
  }
  function toggleStar(s) {
    var c = courOf(s.key), on = ST[c] === s.id;
    if (on) delete ST[c]; else ST[c] = s.id;
    renderRank(); renderList();
    persist('t' + c, function () { return ST[c] ? api('PUT', '/api/me/star', { songId: ST[c], cour: c }, ptoken) : api('PUT', '/api/me/star', { songId: null, cour: c }, ptoken); }, afterSave);
  }
  function setComment(songId, text) {
    text = String(text || '').slice(0, 100);
    if (text.trim()) CM[songId] = text; else delete CM[songId];
    persist('c' + songId, function () { return api('PUT', '/api/me/comment', { songId: songId, text: CM[songId] || '' }, ptoken); }, afterSave);
  }
  function renderUserPages() {
    var has = !!(ME && ME.hasPass);
    $('rNote').hidden = has; $('rf').hidden = !has;
    $('pCurWrap').hidden = !has;
    $('pNote').textContent = has ? '合言葉を変えるには、現在の合言葉が必要です。' : 'まだ合言葉が設定されていません。合言葉を決めると、別の端末からも同じ名前で使え、名前の変更もできるようになります。';
  }
  $('rcancel').onclick = function () { go(''); };
  $('rf').onsubmit = async function (e) {
    e.preventDefault(); $('rmsg').textContent = '';
    try { var r = await api('PUT', '/api/me/name', { name: $('rn').value, pass: $('rpw').value }, ptoken); ME.name = r.name; $('rpw').value = ''; renderAll(); loadTable(); loadPart(); toast('名前を変更しました'); go(''); }
    catch (err) { $('rmsg').textContent = err.message; if (err.status === 401) forget(); }
  };
  $('pcancel').onclick = function () { go(''); };
  $('pwf').onsubmit = async function (e) {
    e.preventDefault(); $('pmsg').textContent = '';
    if ($('pnew').value !== $('pnew2').value) { $('pmsg').textContent = '新しい合言葉が一致しません'; return; }
    try { await api('PUT', '/api/me/password', { current: $('pcur').value, next: $('pnew').value }, ptoken); ME.hasPass = true; $('pcur').value = $('pnew').value = $('pnew2').value = ''; renderAll(); toast('合言葉を変更しました'); go(''); }
    catch (err) { $('pmsg').textContent = err.message; if (err.status === 401) forget(); }
  };

  /* ---- 管理者の全体表 ---- */
  function f2(v) { return v == null ? '–' : (Math.round(v * 100) / 100).toFixed(2); }
  var TSIG = '';
  function modeOf(k) { return (MODES[k] && MODES[k].mode) || 'entry'; }
  async function loadTable() {
    var k = key();
    if (!atoken) {
      // 一般ユーザー: Party Watchのときだけ全体表を取得する
      if (modeOf(k) !== 'watch') { if (TABLE) { TABLE = null; TSIG = ''; } renderMatrix(); return; }
      try {
        var pt = await api('GET', '/api/table?key=' + encodeURIComponent(k)), psig = JSON.stringify(pt);
        if (k !== key()) return;
        if (psig === TSIG) return; TSIG = psig; TABLE = pt; renderMatrix();
      } catch (e) { TABLE = null; TSIG = ''; renderMatrix(); }
      return;
    }
    loadPeople();
    try {
      var t = await api('GET', '/api/admin/table?key=' + encodeURIComponent(k), undefined, atoken), sig = JSON.stringify(t);
      if (sig === TSIG) return; TSIG = sig; TABLE = t; renderMatrix();
    }
    catch (e) { adminError(e, '全体表を読み込めませんでした'); }
  }
  function renderMatrix() {
    $('adminSec').hidden = !TABLE; $('exBar').hidden = !atoken; if (!TABLE) return;
    var t = TABLE, box = $('matrix'); box.textContent = ''; $('cmBox').hidden = true;
    $('mh').textContent = (atoken ? '全ユーザー一覧 ' : '全体表 ') + t.label;
    if (!t.rows.length || !t.people.length) { box.appendChild(el('div', 'empty', 'この区分の曲か、採点したユーザーがまだいません。')); return; }
    var wrap = el('div', 'mwrap'), tb = el('table', 'mx'), hr = el('tr');
    hr.appendChild(el('th', 'c1', '順位')); hr.appendChild(el('th', 'c2', '曲名'));
    if (SORT.uid && SORT.uid !== '_avg' && !t.people.some(function (u) { return u.id === SORT.uid; })) SORT.uid = null;
    function arrow(id) { return SORT.uid === id ? (SORT.dir < 0 ? ' ▼' : ' ▲') : ''; }
    function sortTh(th, id, name) {
      th.className += ' sortable'; th.tabIndex = 0; th.setAttribute('role', 'button'); th.title = name + 'の点数で並べ替え(高い順 → 低い順 → 元の順位順)';
      function go() { if (SORT.uid !== id) { SORT.uid = id; SORT.dir = -1; } else if (SORT.dir < 0) SORT.dir = 1; else SORT.uid = null; renderMatrix(); }
      th.onclick = go; th.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    }
    t.people.forEach(function (u) { var th = el('th'); th.appendChild(avatar(u.id, u.ic, u.name, 's')); th.appendChild(document.createTextNode(' ' + u.name + arrow(u.id))); sortTh(th, u.id, u.name); hr.appendChild(th); });
    var thAv = el('th', 'av', '曲の平均' + arrow('_avg')); sortTh(thAv, '_avg', '曲の平均'); hr.appendChild(thAv);
    var th0 = el('thead'); th0.appendChild(hr); tb.appendChild(th0);
    var body = el('tbody');
    var rowsS = t.rows.map(function (r, i) { return { r: r, i: i }; });
    if (SORT.uid) rowsS.sort(function (a, b) {
      var va = SORT.uid === '_avg' ? a.r.avg : a.r.scores[SORT.uid], vb = SORT.uid === '_avg' ? b.r.avg : b.r.scores[SORT.uid];
      var na = typeof va !== 'number', nb = typeof vb !== 'number';
      if (na || nb) return na === nb ? a.i - b.i : na ? 1 : -1;
      return (va - vb) * SORT.dir || a.i - b.i;
    });
    rowsS.forEach(function (x) {
      var r = x.r, tr = el('tr', r.rank === 1 ? 'top' : '');
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

  /* ---- 画像で保存 ---- */
  var FF = '"M PLUS Rounded 1c","Hiragino Sans","Noto Sans JP",sans-serif', DF = '"Dela Gothic One","M PLUS Rounded 1c",sans-serif';
  function loadImg(src) { return new Promise(function (res) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; }); }
  async function fontsReady() {
    try { await Promise.all([document.fonts.load('500 16px "M PLUS Rounded 1c"'), document.fonts.load('700 16px "M PLUS Rounded 1c"'), document.fonts.load('800 16px "M PLUS Rounded 1c"'), document.fonts.load('400 16px "Dela Gothic One"')]); } catch (e) {}
  }
  function nameColor(n) { var h = 0; Array.from(String(n || '')).forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return 'hsl(' + h + ',55%,45%)'; }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function fitText(g, text, maxW, size, weight, min) {
    var z = size; for (; ; ) { g.font = weight + ' ' + z + 'px ' + FF; if (g.measureText(text).width <= maxW || z <= min) break; z--; }
    if (g.measureText(text).width > maxW) { var t = Array.from(text); while (t.length > 1 && g.measureText(t.join('') + '…').width > maxW) t.pop(); return t.join('') + '…'; }
    return text;
  }
  function avatarOn(g, img, name, cx, cy, r) {
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.closePath(); g.clip();
    if (img) { var m = Math.min(img.width, img.height); g.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, cx - r, cy - r, r * 2, r * 2); }
    else { g.fillStyle = nameColor(name); g.fillRect(cx - r, cy - r, r * 2, r * 2); g.fillStyle = '#fff'; g.font = '800 ' + Math.round(r * 1.1) + 'px ' + FF; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(Array.from(String(name || '?'))[0] || '?', cx, cy + 1); }
    g.restore();
  }
  function newCanvas(W, H) {
    var sc = Math.min(2, Math.sqrt(12000000 / (W * H))), c = document.createElement('canvas'); c.width = Math.round(W * sc); c.height = Math.round(H * sc);
    var g = c.getContext('2d'); g.scale(sc, sc); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    var bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#f6f5fd'); bg.addColorStop(1, '#e8e5fa'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    return { c: c, g: g };
  }
  function band(g, W, H, title, sub, logo, av) {
    var gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#3b36c9'); gr.addColorStop(1, '#e0306f'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    var x = 28;
    if (av) { avatarOn(g, av.img, av.name, 28 + 30, H / 2, 30); x = 28 + 60 + 16; }
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    var tt = fitText(g, title, W - x - 28 - (logo ? 64 : 0), 28, 800, 16); g.font = '800 ' + g.font.match(/(\d+)px/)[1] + 'px ' + FF; g.fillText(tt, x, H / 2 + 2);
    g.globalAlpha = .85; g.font = '500 14px ' + FF; g.fillText(sub, x, H / 2 + 26); g.globalAlpha = 1;
    if (logo) g.drawImage(logo, W - 28 - 44, (H - 44) / 2, 44, 44);
  }
  function footer(g, W, H, y) {
    g.fillStyle = '#6b6a8a'; g.font = '500 12px ' + FF; g.textAlign = 'right'; g.fillText('Party Rank点数評価ツール ・ ' + fdate(Date.now()), W - 28, y); g.textAlign = 'left';
  }
  function showImage(canvas, name) {
    var url = canvas.toDataURL('image/png'); $('imgPrev').src = url; $('imgSave').onclick = function () { var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('保存しました'); };
    var m = $('imgModal'); m.hidden = false; $('imgClose').focus();
    function close() { m.hidden = true; document.removeEventListener('keydown', kd); }
    function kd(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', kd); $('imgClose').onclick = close; m.onclick = function (e) { if (e.target === m) close(); };
  }
  async function myImage() {
    var k = key(), L = rankedMine(k); if (!ME || !L.length) { toast('画像にできる採点がありません'); return; }
    toast('画像を作っています…'); await fontsReady();
    var logo = await loadImg('/icon-192.png'), avimg = ME.icon ? await loadImg('/api/icon/' + encodeURIComponent(ME.id) + '?v=' + ME.icon) : null;
    var n = L.length, PAD = 24, HEAD = 96, CW = 420, CH = 66, G = 10, FOOT = 40, best = 1, bd = 1e9;
    for (var c = 1; c <= 4; c++) { var r0 = Math.ceil(n / c), w0 = PAD * 2 + c * CW + (c - 1) * G, h0 = HEAD + PAD + r0 * (CH + G) - G + FOOT, d = Math.abs(w0 / h0 - 1.5); if (d < bd) { bd = d; best = c; } }
    var cols = best, rows = Math.ceil(n / cols), W = PAD * 2 + cols * CW + (cols - 1) * G, H = HEAD + PAD + rows * (CH + G) - G + FOOT;
    var cv = newCanvas(W, H), g = cv.g;
    band(g, W, HEAD, ME.name + 'さんの ' + label(k) + ' ランキング', n + '曲を採点', logo, { img: avimg, name: ME.name });
    L.forEach(function (x, i) {
      var col = Math.floor(i / rows), row = i % rows, cx = PAD + col * (CW + G), cy = HEAD + PAD + row * (CH + G), star = ST[courOf(x.s.key)] === x.s.id;
      g.fillStyle = '#fff'; rr(g, cx, cy, CW, CH, 12); g.fill(); g.lineWidth = x.rank === 1 ? 3 : 1; g.strokeStyle = x.rank === 1 ? '#f5b800' : '#dedcf0'; g.stroke();
      g.fillStyle = x.rank === 1 ? '#f5b800' : '#6b6a8a'; g.font = '400 ' + (x.rank >= 100 ? 20 : 28) + 'px ' + DF; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(x.rank), cx + 32, cy + CH / 2 + 1);
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      var tx = cx + 66, tw = CW - 66 - 108;
      var title = (star ? '★ ' : '') + x.s.title; g.fillStyle = '#1c1b3a'; var t = fitText(g, title, tw, 17, 800, 12); g.fillText(t, tx, cy + 28);
      var sub = [x.s.artist, x.s.anime].filter(Boolean).join(' / '); if (sub) { g.fillStyle = '#6b6a8a'; g.fillText(fitText(g, sub, tw, 12, 500, 10), tx, cy + 49); }
      g.fillStyle = '#1c1b3a'; g.textAlign = 'right'; g.font = '400 26px ' + DF; g.fillText(x.v.toFixed(1), cx + CW - 30, cy + CH / 2 + 10); g.font = '700 12px ' + FF; g.fillText('点', cx + CW - 12, cy + CH / 2 + 10); g.textAlign = 'left';
    });
    footer(g, W, H, H - 16);
    showImage(cv.c, 'my-ranking-' + k + '.png');
  }
  async function tableImage() {
    var t = TABLE; if (!t || !t.rows.length || !t.people.length) { toast('画像にできる全体表がありません'); return; }
    toast('画像を作っています…'); await fontsReady();
    var logo = await loadImg('/icon-192.png'), P = t.people.length, per = P > 14 ? 52 : 64, imgs = await Promise.all(t.people.map(function (u) { return u.ic ? loadImg('/api/icon/' + encodeURIComponent(u.id) + '?v=' + u.ic) : Promise.resolve(null); }));
    var PAD = 24, HEAD = 84, HH = 96, RH = 44, C1 = 52, C2 = 300, CA = 76, W = PAD * 2 + C1 + C2 + per * P + CA, R = t.rows.length, H = HEAD + HH + (R + 1) * RH + 52;
    var cv = newCanvas(W, H), g = cv.g;
    band(g, W, HEAD, '全体表 ' + t.label, '参加者' + P + '人 ・ ' + R + '曲', logo, null);
    var x0 = PAD, y0 = HEAD + 14, tw = W - PAD * 2;
    g.fillStyle = '#fff'; rr(g, x0, y0, tw, HH - 14 + (R + 1) * RH, 12); g.fill(); g.strokeStyle = '#dedcf0'; g.lineWidth = 1; g.stroke();
    // 見出し
    g.fillStyle = '#6b6a8a'; g.font = '700 13px ' + FF; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('順位', x0 + C1 / 2, y0 + (HH - 14) / 2);
    g.textAlign = 'left'; g.fillText('曲名', x0 + C1 + 8, y0 + (HH - 14) / 2);
    t.people.forEach(function (u, i) {
      var cx = x0 + C1 + C2 + i * per + per / 2; avatarOn(g, imgs[i], u.name, cx, y0 + 28, 17);
      g.fillStyle = '#1c1b3a'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(fitText(g, u.name, per - 6, 12, 700, 9), cx, y0 + 68);
    });
    g.fillStyle = '#1c1b3a'; g.font = '800 13px ' + FF; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('曲の平均', x0 + tw - CA / 2, y0 + (HH - 14) / 2);
    var top = y0 + HH - 14;
    g.strokeStyle = '#dedcf0'; g.beginPath(); g.moveTo(x0, top); g.lineTo(x0 + tw, top); g.stroke();
    t.rows.forEach(function (r, i) {
      var y = top + i * RH; g.textBaseline = 'middle';
      g.fillStyle = r.rank === 1 ? '#f5b800' : '#6b6a8a'; g.font = '400 18px ' + DF; g.textAlign = 'center'; g.fillText(r.rank == null ? '–' : String(r.rank), x0 + C1 / 2, y + RH / 2 + 1);
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = '#1c1b3a'; g.fillText(fitText(g, r.title, C2 - 12, 14, 800, 10), x0 + C1 + 8, y + 19);
      var sub = [r.artist, r.anime].filter(Boolean).join(' / '); if (sub) { g.fillStyle = '#6b6a8a'; g.fillText(fitText(g, sub, C2 - 12, 11, 500, 9), x0 + C1 + 8, y + 35); }
      t.people.forEach(function (u, j) {
        var v = r.scores[u.id], cx = x0 + C1 + C2 + j * per;
        if (typeof v === 'number') { var pc = v * 0.07; g.fillStyle = 'rgb(' + Math.round(255 - 31 * pc) + ',' + Math.round(255 - 207 * pc) + ',' + Math.round(255 - 144 * pc) + ')'; g.fillRect(cx + 2, y + 3, per - 4, RH - 6); }
        g.fillStyle = '#1c1b3a'; g.font = '700 14px ' + FF; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(typeof v === 'number' ? v.toFixed(1) : '–', cx + per / 2 - (r.starBy.indexOf(u.id) >= 0 ? 5 : 0), y + RH / 2 + 1);
        if (r.starBy.indexOf(u.id) >= 0) { g.fillStyle = '#f5b800'; g.fillText('★', cx + per - 11, y + RH / 2 + 1); }
      });
      g.fillStyle = '#1c1b3a'; g.font = '800 15px ' + FF; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(f2(r.avg), x0 + tw - CA / 2, y + RH / 2 + 1);
      g.strokeStyle = '#eceaf8'; g.beginPath(); g.moveTo(x0 + 8, y + RH); g.lineTo(x0 + tw - 8, y + RH); g.stroke();
    });
    var yf = top + R * RH; g.fillStyle = '#6b6a8a'; g.font = '800 13px ' + FF; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('ユーザーの平均', x0 + C1 + 8, yf + RH / 2 + 1);
    t.people.forEach(function (u, j) { g.fillStyle = '#1c1b3a'; g.font = '700 14px ' + FF; g.textAlign = 'center'; g.fillText(f2(t.userAvg[u.id]), x0 + C1 + C2 + j * per + per / 2, yf + RH / 2 + 1); });
    g.font = '800 15px ' + FF; g.fillText(f2(t.overallAvg), x0 + tw - CA / 2, yf + RH / 2 + 1);
    g.textBaseline = 'alphabetic'; footer(g, W, H, H - 16);
    showImage(cv.c, 'party-rank-' + t.key + '-table.png');
  }
  $('exMineImg').onclick = function () { myImage().catch(function () { toast('画像を作れませんでした'); }); };
  $('exTblImg').onclick = function () { tableImage().catch(function () { toast('画像を作れませんでした'); }); };

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
    try { var m = await api('GET', '/api/me', undefined, ptoken); ME = { id: m.id, icon: m.icon || 0, name: m.name, hasPass: !!m.hasPass }; SC = m.scores || {}; ST = m.stars || {}; CM = m.comments || {}; }
    catch (e) { if (e.status === 401) forget(); }
  }
  $('jf').onsubmit = async function (e) {
    e.preventDefault(); $('jmsg').textContent = '';
    try {
      var r = await api('POST', '/api/join', { name: $('jn').value, pass: $('jp').value });
      ptoken = r.token; store('pr-token', ptoken); $('jp').value = ''; $('jn').value = ''; await loadMe(); renderAll(); loadPart(); toast(r.name + 'さんとしてログインしました');
    } catch (err) { $('jmsg').textContent = err.message; }
  };
  $('leave').onclick = async function () {
    if (ME && !ME.hasPass && !(await confirmBox('ログアウトしますか?', '合言葉が未設定です。ログアウトすると、同じ名前でログインし直せなくなり、これまでの点数も見られなくなります。\n先に、メニューの「パスワード(合言葉)の再設定」で合言葉を決めておくことをおすすめします。', 'ログアウトする'))) return;
    forget(); $('joinPanel').hidden = false; $('jn').focus(); toast('ログアウトしました');
  };

  /* ---- 管理者 ---- */
  var PSIG = '';
  async function loadPeople(force) {
    if (!atoken) return;
    try {
      var r = await api('GET', '/api/admin/people', undefined, atoken), sig = JSON.stringify(r.people);
      if (sig === PSIG && !force) return; PSIG = sig;
      var box = $('ppl'); box.textContent = '';
      $('uSum').textContent = '登録ユーザー ' + r.people.length + '人';
      if (!r.people.length) { box.appendChild(el('span', 'm', 'まだ参加者はいません。')); return; }
      r.people.forEach(function (u) {
        var row = el('div', 'urow'), top = el('div', 'bar'); top.style.marginBottom = '0';
        top.appendChild(avatar(u.id, u.ic, u.name, 's')); top.appendChild(el('b', '', u.name)); top.appendChild(el('span', 'm', '(採点 ' + u.scored + '曲・合言葉' + (u.hasPass ? 'あり' : 'なし') + ')')); top.appendChild(el('span', 'grow'));
        var rs = el('button', '', '合言葉をリセット'), del = el('button', 'ghost', '削除'); del.setAttribute('aria-label', u.name + 'を削除');
        top.appendChild(rs); top.appendChild(del); row.appendChild(top);
        var form = el('form', 'inl'); form.hidden = true;
        var lab = el('label', 'blk', '新しい合言葉(4文字以上。本人に伝えてください)'), inp = el('input'); inp.type = 'text'; inp.maxLength = 60; inp.required = true; inp.autocomplete = 'off'; lab.appendChild(inp);
        var ok = el('button', 'pri', 'この合言葉に設定'); form.appendChild(lab); form.appendChild(ok); row.appendChild(form);
        rs.onclick = function () { form.hidden = !form.hidden; if (!form.hidden) inp.focus(); };
        form.onsubmit = async function (e) {
          e.preventDefault();
          if (!(await confirmBox('合言葉をリセットしますか?', '「' + u.name + '」の合言葉を新しいものに変更します。\nこの人がいまログイン中の端末はログアウトされ、新しい合言葉で入り直す必要があります。', '変更する'))) return;
          try { await api('POST', '/api/admin/people/' + u.id + '/password', { pass: inp.value }, atoken); inp.value = ''; form.hidden = true; PSIG = ''; await loadPeople(true); toast(u.name + 'さんの合言葉を変更しました'); } catch (er) { adminError(er, '変更できませんでした'); }
        };
        del.onclick = async function () {
          if (!(await confirmBox('ユーザーを削除しますか?', '「' + u.name + '」(採点 ' + u.scored + '曲)を削除します。\nこの人の点数・☆・ひとことも消え、元に戻せません。'))) return;
          try { await api('DELETE', '/api/admin/people/' + u.id, undefined, atoken); PSIG = ''; TSIG = ''; await loadPeople(true); await loadTable(); toast('削除しました'); } catch (e) { adminError(e, '削除できませんでした'); }
        };
        box.appendChild(row);
      });
    } catch (e) { adminError(e, ''); }
  }
  function adminError(e, fb) { if (e.status === 401) { adminLogout(true); toast('管理者のログインが切れました。もう一度入ってください'); } else toast(e.message || fb); }
  $('lcancel').onclick = function () { $('pw').value = ''; $('lmsg').textContent = ''; go(''); };
  $('lf').onsubmit = async function (e) {
    e.preventDefault(); $('lmsg').textContent = '';
    try {
      var r = await api('POST', '/api/admin/login', { name: $('adm').value, password: $('pw').value });
      atoken = r.token; adminName = r.name; store('pr-admin', atoken, true); store('pr-admin-name', adminName, true);
      $('pw').value = ''; await enterAdmin(); go(''); toast(adminName + 'として管理者画面に入りました');
    } catch (err) { $('lmsg').textContent = err.message; }
  };
  async function enterAdmin() { await loadAdmins(); await loadTable(); renderAll(); }
  async function adminLogout(silent) {
    var t = atoken; atoken = ''; adminName = ''; TABLE = null; TSIG = ''; PSIG = ''; cancelEdit(); store('pr-admin', '', true); store('pr-admin-name', '', true);
    if (t && !silent) { try { await api('POST', '/api/admin/logout', {}, t); } catch (e) {} }
    renderAll(); go(''); loadTable(); if (!silent) toast('管理者画面から退出しました');
  }
  $('backUser').onclick = function () { adminLogout(false); };
  function showAdmins(list, me, xs) {
    var box = $('admList'); box.textContent = ''; xs = xs || {};
    list.forEach(function (n) { var c = el('span', 'chip', n + (n === me ? '(あなた)' : '') + (xs[n] ? ' ' + xHandle(xs[n]) : '')); box.appendChild(c); });
  }
  async function loadAdmins() {
    try { var r = await api('GET', '/api/admin/admins', undefined, atoken); showAdmins(r.admins, r.me, r.xs); } catch (e) { adminError(e, ''); }
  }
  $('af').onsubmit = async function (e) {
    e.preventDefault();
    try { var r = await api('POST', '/api/admin/admins', { name: $('an').value, password: $('ap').value }, atoken); $('an').value = ''; $('ap').value = ''; showAdmins(r.admins, adminName); loadAdmins(); toast('管理者を追加しました'); }
    catch (err) { if (err.status === 401) adminError(err); else toast(err.message); }
  };
  $('apf').onsubmit = async function (e) {
    e.preventDefault(); $('apmsg').textContent = '';
    if ($('apnew').value !== $('apnew2').value) { $('apmsg').textContent = '新しいパスワードが一致しません'; return; }
    try { await api('POST', '/api/admin/password', { current: $('apcur').value, next: $('apnew').value }, atoken); $('apcur').value = $('apnew').value = $('apnew2').value = ''; toast('管理者パスワードを変更しました'); }
    catch (err) { if (err.status === 401) adminError(err); else $('apmsg').textContent = err.message; }
  };
  function editSong(s) {
    editId = s.id; $('title').value = s.title; $('artist').value = s.artist || ''; $('anime').value = s.anime || '';
    $('fsub').textContent = '変更を保存'; $('fcancelBar').hidden = false; $('editNote').textContent = label(s.key) + 'の曲を編集中です。';
    $('f').closest('details').open = true;
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

  /* ---- 招待リンク ---- */
  var INV_DEF = 'Party Rank(みんなでアニソンに点数をつけるランキング)に参加しよう!';
  function invUrl() { return location.origin + '/'; }
  function invText() { return ($('invMsg').value || '').trim(); }
  function updateShare() {
    var u = invUrl(), t = invText();
    $('shX').href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(t) + '&url=' + encodeURIComponent(u);
    $('shL').href = 'https://line.me/R/share?text=' + encodeURIComponent((t ? t + '\n' : '') + u);
  }
  function renderInvite() {
    $('invUrl').value = invUrl(); if (!$('invMsg').value) $('invMsg').value = INV_DEF;
    $('shN').hidden = !navigator.share; updateShare();
  }
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); toast(ok ? okMsg : 'コピーできませんでした。手動でコピーしてください');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback); else fallback();
  }
  $('invMsg').oninput = updateShare;
  $('invUrl').onfocus = function () { this.select(); };
  $('shC').onclick = function () { copyText(invUrl(), 'リンクをコピーしました'); };
  $('shD').onclick = function () { var t = invText(); copyText((t ? t + '\n' : '') + invUrl(), 'コピーしました。Discordに貼り付けてください'); };
  $('shN').onclick = function () { navigator.share({ title: 'Party Rank', text: invText(), url: invUrl() }).catch(function () {}); };

  /* ---- 管理者のX ---- */
  var MYX = '';
  function xHandle(u) { return '@' + String(u).replace(/^https:\/\/x\.com\//, ''); }
  function renderAdminX() {
    $('axmsg').textContent = ''; $('axnow').textContent = '';
    api('GET', '/api/admin/admins', undefined, atoken).then(function (r) {
      MYX = (r.xs && r.xs[r.me]) || ''; $('axv').value = MYX;
      $('axnow').textContent = MYX ? '登録中: ' + xHandle(MYX) : 'まだ登録されていません。';
    }).catch(function (e) { adminError(e, ''); });
  }
  $('axf').onsubmit = async function (e) {
    e.preventDefault(); $('axmsg').textContent = '';
    try { var r = await api('PUT', '/api/admin/x', { x: $('axv').value }, atoken); MYX = r.x; $('axv').value = MYX; $('axnow').textContent = MYX ? '登録中: ' + xHandle(MYX) : 'まだ登録されていません。'; toast(MYX ? 'Xアカウントを登録しました' : '登録を外しました'); }
    catch (err) { if (err.status === 401) adminError(err); else $('axmsg').textContent = err.message; }
  };
  $('axdel').onclick = async function () { $('axv').value = ''; $('axf').requestSubmit(); };
  async function loadStaff() {
    try {
      var r = await api('GET', '/api/staff'), box = $('staffList'); box.textContent = ''; $('staffBox').hidden = !r.staff.length;
      r.staff.forEach(function (x) { var a = el('a', 'xacc', xHandle(x.x)); a.href = x.x; a.target = '_blank'; a.rel = 'noopener noreferrer'; box.appendChild(a); });
    } catch (e) { $('staffBox').hidden = true; }
  }

  /* ---- プレイリスト未収録曲のリンク ---- */
  function renderXlinks() {
    var k = key(), list = LINKS.filter(function (l) { return l.key === k; }), box = $('xlinks'); box.textContent = ''; box.hidden = !list.length;
    list.forEach(function (l, i) {
      if (!i) box.appendChild(el('div', 'xh', 'プレイリスト未収録曲のリンク'));
      var a = el('a', 'xl'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.appendChild(el('span', 'xp', '▶')); var t = el('span', 'xt', l.title); if (l.artist) t.appendChild(el('small', '', l.artist)); a.appendChild(t); box.appendChild(a);
    });
    var adm = $('xAdm'); adm.textContent = ''; if (!atoken) return;
    list.forEach(function (l) {
      var r = el('div', 'xrow'), d = el('div', 'xrt'); d.appendChild(el('b', '', l.title + (l.artist ? ' / ' + l.artist : ''))); d.appendChild(el('div', 'm', l.url)); r.appendChild(d);
      var del = el('button', 'ghost', '削除'); del.setAttribute('aria-label', l.title + 'のリンクを削除');
      del.onclick = async function () {
        if (!(await confirmBox('リンクを削除しますか?', '「' + l.title + '」のリンクを外します。'))) return;
        try { var rs = await api('DELETE', '/api/admin/links/' + l.id, undefined, atoken); LINKS = rs.links; renderXlinks(); toast('削除しました'); } catch (e) { adminError(e, '削除できませんでした'); }
      };
      r.appendChild(del); adm.appendChild(r);
    });
  }
  $('xf').onsubmit = async function (e) {
    e.preventDefault();
    try { var r = await api('POST', '/api/admin/links', { key: key(), title: $('xtitle').value, artist: $('xartist').value, url: $('xurl').value }, atoken); LINKS = r.links; $('xtitle').value = $('xartist').value = $('xurl').value = ''; renderXlinks(); toast('リンクを追加しました'); }
    catch (err) { adminError(err, '追加できませんでした'); }
  };

  /* ---- アイコン ---- */
  function iconPrev(src) {
    var b = $('icPrev'); b.textContent = '';
    if (src) { var im = document.createElement('img'); im.src = src; im.alt = ''; b.appendChild(im); }
    else b.appendChild(avatar(ME && ME.id, ME && ME.icon, ME && ME.name, 'xl'));
  }
  $('icFile').onchange = function () {
    var f = this.files && this.files[0]; $('icMsg').textContent = ''; ICDATA = ''; $('icSave').disabled = true;
    if (!f) { iconPrev(''); return; }
    if (!/^image\//.test(f.type)) { $('icMsg').textContent = '画像ファイルを選んでください'; return; }
    if (f.size > 15 * 1024 * 1024) { $('icMsg').textContent = '画像が大きすぎます(15MBまで)'; return; }
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = function () {
        function make(size, type, q) {
          var c = document.createElement('canvas'); c.width = c.height = size; var g = c.getContext('2d');
          if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); }
          var m = Math.min(im.width, im.height), sx = (im.width - m) / 2, sy = (im.height - m) / 2;
          g.imageSmoothingQuality = 'high'; g.drawImage(im, sx, sy, m, m, 0, 0, size, size); return c.toDataURL(type, q);
        }
        var d = make(256, 'image/png');
        if (d.length > 380000) d = make(256, 'image/jpeg', 0.9);
        if (d.length > 380000) d = make(192, 'image/jpeg', 0.85);
        if (d.length > 380000) { $('icMsg').textContent = '画像を小さくできませんでした。別の画像を選んでください'; return; }
        ICDATA = d; iconPrev(d); $('icSave').disabled = false;
      };
      im.onerror = function () { $('icMsg').textContent = 'この画像は読み込めませんでした。PNG・JPEGなどで試してください'; };
      im.src = fr.result;
    };
    fr.readAsDataURL(f);
  };
  $('icSave').onclick = async function () {
    if (!ICDATA) return; $('icMsg').textContent = '';
    try { var r = await api('PUT', '/api/me/icon', { data: ICDATA }, ptoken); ME.icon = r.icon; ICDATA = ''; $('icFile').value = ''; $('icSave').disabled = true; PSIG = ''; TSIG = ''; renderAll(); loadTable(); loadPart(); toast('アイコンを設定しました'); go(''); }
    catch (err) { $('icMsg').textContent = err.message; if (err.status === 401) forget(); }
  };
  $('icDel').onclick = async function () {
    try { await api('DELETE', '/api/me/icon', undefined, ptoken); ME.icon = 0; ICDATA = ''; $('icFile').value = ''; $('icSave').disabled = true; TSIG = ''; renderAll(); loadTable(); loadPart(); toast('アイコンを外しました'); iconPrev(''); }
    catch (err) { $('icMsg').textContent = err.message; }
  };
  $('icBack').onclick = function () { go(''); };

  /* ---- 過去のParty Rank ---- */
  function sk2(k) { var p = k.split('-'); return Number(p[0]) * 100 + Number(p[1]); }
  function yearList() { return Array.prototype.map.call(yr.options, function (o) { return o.value; }); }
  function fillYearSel(sel, allLabel, def) {
    var keep = sel.value; sel.textContent = '';
    if (allLabel) sel.appendChild(new Option(allLabel, ''));
    yearList().forEach(function (y) { sel.appendChild(new Option(y + '年', y)); });
    var want = keep !== '' && keep != null ? keep : (def || '');
    if (Array.prototype.some.call(sel.options, function (o) { return o.value === want; })) sel.value = want; else if (!allLabel) sel.selectedIndex = 0;
  }
  function sortedPasts() {
    return PASTS.slice().sort(function (a, b) { return sk2(b.key) - sk2(a.key) || KINDS.indexOf(a.key.split('-')[2]) - KINDS.indexOf(b.key.split('-')[2]) || b.at - a.at; });
  }
  function renderPasts() {
    fillYearSel($('pfY'), 'すべての年代');
    var y = $('pfY').value, c = $('pfC').value, k = $('pfK').value, box = $('pastList'); box.textContent = '';
    var list = sortedPasts().filter(function (x) { var p = x.key.split('-'); return (!y || p[0] === y) && (!c || p[1] === c) && (!k || p[2] === k); });
    if (!list.length) { box.appendChild(el('div', 'empty', PASTS.length ? '条件に合う動画はありません。' : 'まだ登録された動画はありません。')); return; }
    list.forEach(function (x) {
      var r = el('div', 'pastrow'), d = el('div', 'pt1'); d.appendChild(el('div', 't', x.title)); d.appendChild(el('div', 'm', label(x.key))); r.appendChild(d);
      var a = el('a', 'vid', '▶ 動画を見る'); a.href = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; r.appendChild(a);
      var pl = PL[x.key]; if (pl && /^https:\/\//.test(pl)) { var b = el('a', 'pl', 'プレイリスト'); b.href = pl; b.target = '_blank'; b.rel = 'noopener noreferrer'; r.appendChild(b); }
      box.appendChild(r);
    });
  }
  $('pfY').onchange = $('pfC').onchange = $('pfK').onchange = renderPasts;
  function renderPastAdmin() {
    fillYearSel($('payr'), '', yr.value);
    var box = $('paAdm'); box.textContent = ''; $('paSum').textContent = '登録済みの動画(' + PASTS.length + '件)';
    if (!PASTS.length) { box.appendChild(el('span', 'm', 'まだ登録はありません。')); return; }
    sortedPasts().forEach(function (x) {
      var r = el('div', 'pastrow'), d = el('div', 'pt1'); d.appendChild(el('div', 't', x.title)); d.appendChild(el('div', 'm', label(x.key) + ' / ' + x.url)); r.appendChild(d);
      var del = el('button', 'ghost', '削除'); del.setAttribute('aria-label', x.title + 'を削除');
      del.onclick = async function () {
        if (!(await confirmBox('登録を削除しますか?', '「' + x.title + '」(' + label(x.key) + ')を一覧から外します。'))) return;
        try { var rs = await api('DELETE', '/api/admin/pasts/' + x.id, undefined, atoken); PASTS = rs.pasts; renderPastAdmin(); toast('削除しました'); } catch (e) { adminError(e, '削除できませんでした'); }
      };
      r.appendChild(del); box.appendChild(r);
    });
  }
  $('paf').onsubmit = async function (e) {
    e.preventDefault();
    var k = $('payr').value + '-' + $('pacour').value + '-' + $('pakind').value;
    try { var r = await api('POST', '/api/admin/pasts', { key: k, title: $('patitle').value, url: $('paurl').value }, atoken); PASTS = r.pasts; $('patitle').value = ''; $('paurl').value = ''; renderPastAdmin(); toast('登録しました'); }
    catch (err) { adminError(err, '登録できませんでした'); }
  };

  /* ---- 開催モード ---- */
  var MODE_INFO = {
    entry: { name: '通常', cls: '', text: 'Party Rankの開催をお待ちください🥹' },
    rank: { name: 'Party Rank', cls: 'rank', text: '開催中です(採点受付中)。結果発表まで、全体表は公開されません。' },
    watch: { name: 'Party Watch', cls: 'watch', text: 'ランキングが公開されました。下に全体表が表示されます。' }
  };
  function renderMode() {
    var k = key(), md = modeOf(k), info = MODE_INFO[md], url = MODES[k] && MODES[k].video, box = $('modeBox'); box.textContent = '';
    {
      var d = el('div', 'mode ' + info.cls); d.appendChild(el('span', 'mb', info.name)); d.appendChild(el('span', '', (md === 'entry' ? '' : label(k) + ': ') + info.text));
      if (md === 'watch' && url && /^https:\/\//.test(url)) { var a = el('a', 'vid', '▶ ランキング動画を見る'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; d.appendChild(a); }
      box.appendChild(d);
    }
    if (atoken) {
      $('modeNow').textContent = label(k) + ' の現在のモード: ' + info.name + (md === 'watch' && url ? '(動画リンクを公開中)' : '');
      $('mEntry').disabled = md === 'entry'; $('mRank').disabled = md === 'rank';
      $('mvideo').value = md === 'watch' ? url : ($('mvideo').value || '');
      $('mwatch').textContent = md === 'watch' ? '動画リンクを更新する' : 'リンクを公開して Party Watch にする';
    }
  }
  async function setMode(mode, video, okMsg) {
    try { var r = await api('PUT', '/api/admin/mode', { key: key(), mode: mode, video: video }, atoken); MODES = r.modes; TSIG = ''; renderAll(); loadTable(); toast(okMsg); }
    catch (err) { adminError(err, '切り替えられませんでした'); }
  }
  $('mRank').onclick = async function () {
    if (!(await confirmBox('Party Rank を開始しますか?', label(key()) + ' を Party Rank モードにします。一般ユーザーには全体表は表示されません。', '開始する'))) return;
    setMode('rank', '', 'Party Rank モードにしました');
  };
  $('mEntry').onclick = async function () {
    if (!(await confirmBox('通常モードに戻しますか?', label(key()) + ' を通常モードに戻します。公開中の動画リンクと全体表は一般ユーザーから見えなくなります。', '戻す'))) return;
    setMode('entry', '', '通常モードに戻しました');
  };
  $('mf').onsubmit = async function (e) {
    e.preventDefault(); var u = $('mvideo').value.trim();
    if (!(await confirmBox('Party Watch に切り替えますか?', label(key()) + ' の動画リンクと全体表を、一般ユーザーにも公開します。\n' + u, '公開する'))) return;
    setMode('watch', u, 'Party Watch にしました。動画リンクと全体表を公開中です');
  };

  /* ---- 提出期限 ---- */
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function localInput(t) { var d = new Date(t); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' + two(d.getHours()) + ':' + two(d.getMinutes()); }
  function renderDeadline() {
    var b = $('dline'), t = DEAD[key()]; b.textContent = ''; b.className = 'deadline';
    if (atoken) $('dtime').value = t ? localInput(t) : '';
    if (!t) return;
    var d = new Date(t), W = ['日', '月', '火', '水', '木', '金', '土'], diff = t - Date.now();
    var l1 = el('div', 'dl1'); l1.appendChild(el('span', 'dll', '提出期限'));
    l1.appendChild(el('span', 'dld', d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + W[d.getDay()] + ') ' + two(d.getHours()) + ':' + two(d.getMinutes()))); b.appendChild(l1);
    var rest;
    if (diff <= 0) { rest = '期限を過ぎています'; b.className = 'deadline over'; }
    else {
      var mins = Math.floor(diff / 60000), dd = Math.floor(mins / 1440), hh = Math.floor((mins % 1440) / 60);
      rest = dd ? 'あと' + dd + '日と' + hh + '時間' : hh ? 'あと' + hh + '時間' + (mins % 60) + '分' : 'あと' + (mins % 60) + '分';
    }
    b.appendChild(el('div', 'dl2', rest));
  }
  setInterval(renderDeadline, 60000);
  $('df').onsubmit = async function (e) {
    e.preventDefault(); var v = $('dtime').value; if (!v) { toast('日時を入力してください'); return; }
    try { var r = await api('PUT', '/api/admin/deadline', { key: key(), at: new Date(v).getTime() }, atoken); DEAD = r.deadlines; renderDeadline(); toast('提出期限を保存しました'); }
    catch (err) { adminError(err, '保存できませんでした'); }
  };
  $('dclear').onclick = async function () {
    try { var r = await api('PUT', '/api/admin/deadline', { key: key(), at: null }, atoken); DEAD = r.deadlines; renderDeadline(); toast('提出期限を外しました'); }
    catch (err) { adminError(err, '操作できませんでした'); }
  };

  /* ---- 参加者一覧 ---- */
  async function loadPart() { try { PART = await api('GET', '/api/participants'); renderParticipants(); } catch (e) {} }
  function renderParticipants() {
    var all = $('partAll'), sel = $('partKey'); all.textContent = '';
    if (!PART) return;
    $('partTotal').textContent = '全体のユーザー(' + PART.people.length + '人)';
    if (!PART.people.length) all.appendChild(el('span', 'm', 'まだ参加者はいません。'));
    PART.people.forEach(function (u) { var c = el('span', 'chip hasav'); c.appendChild(avatar(u.id, u.ic, u.name, 's')); c.appendChild(document.createTextNode(u.name)); all.appendChild(c); });
    function sk(k) { var p = k.split('-'); return Number(p[0]) * 100 + Number(p[1]); }
    var keep = sel.value; sel.textContent = '';
    sel.appendChild(new Option('(ランキングを選んでください)', ''));
    PART.keys.slice().sort(function (a, b) { return sk(b.key) - sk(a.key) || KINDS.indexOf(a.key.split('-')[2]) - KINDS.indexOf(b.key.split('-')[2]); }).forEach(function (g) {
      sel.appendChild(new Option(label(g.key) + '(' + g.participants.length + '人)', g.key));
    });
    sel.value = keep && PART.keys.some(function (g) { return g.key === keep; }) ? keep : '';
    renderPartKey();
  }
  function renderPartKey() {
    var out = $('partOut'), k = $('partKey').value; out.textContent = '';
    var g = PART && PART.keys.filter(function (x) { return x.key === k; })[0];
    if (!g) { out.appendChild(el('span', 'm', 'ランキングを選ぶと、そのランキングの参加者が表示されます。')); return; }
    if (!g.participants.length) out.appendChild(el('span', 'm', 'まだ採点した人はいません。'));
    g.participants.forEach(function (u) { var c = el('span', 'chip hasav'); c.appendChild(avatar(u.id, u.ic, u.name, 's')); c.appendChild(document.createTextNode(u.name + '(採点 ' + u.scored + '/' + g.songs + '曲)')); out.appendChild(c); });
  }
  $('partKey').onchange = renderPartKey;

  /* ---- お知らせ・年 ---- */
  function fdate(t) { var d = new Date(t); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); }
  function isNew(n) { return Date.now() - n.at < 7 * 86400000; }
  var NEWS_OPEN = null;
  function newsMeta(n) { var m = el('div', 'nmeta'); if (isNew(n)) m.appendChild(el('span', 'newb', 'New!')); m.appendChild(el('span', 'nd', fdate(n.at))); return m; }
  function newsItem(n, open) {
    var d = document.createElement('details'); d.className = 'nitem'; d.id = 'news-' + n.id; if (open) d.open = true;
    var sm = document.createElement('summary'), col = el('div', 'ncol'); col.appendChild(newsMeta(n)); col.appendChild(el('div', 'nt', n.title || 'お知らせ'));
    sm.appendChild(col); d.appendChild(sm); d.appendChild(el('div', 'nbody', n.text)); return d;
  }
  function newsLink(n) {
    var b = el('button', 'nlink'); b.type = 'button'; var col = el('div', 'ncol'); col.appendChild(newsMeta(n)); col.appendChild(el('div', 'nt', n.title || 'お知らせ'));
    b.appendChild(col); b.onclick = function () { NEWS_OPEN = n.id; go('notices'); }; return b;
  }
  function renderNews() {
    var box = $('newsList'), all = $('nAll'), adm = $('nAdm'); box.textContent = ''; all.textContent = ''; adm.textContent = '';
    $('newsBox').hidden = !NEWS.length; $('newsAll').hidden = NEWS.length <= 3;
    NEWS.slice(0, 3).forEach(function (n) { box.appendChild(newsLink(n)); });
    if (!NEWS.length) all.appendChild(el('span', 'm', 'お知らせはまだありません。'));
    var openEl = null;
    NEWS.forEach(function (n) {
      var it = newsItem(n, n.id === NEWS_OPEN); all.appendChild(it); if (n.id === NEWS_OPEN) openEl = it;
      if (atoken) {
        var a = el('div', 'news-i'); a.appendChild(newsMeta(n));
        a.appendChild(el('b', 'nt2', n.title || 'お知らせ'));
        a.appendChild(el('div', 'm', n.text.slice(0, 60) + (n.text.length > 60 ? '…' : '')));
        var del = el('button', 'ghost', '削除'); del.onclick = async function () {
          if (!(await confirmBox('お知らせを削除しますか?', (n.title || '') + '\n' + n.text.slice(0, 80) + (n.text.length > 80 ? '…' : '')))) return;
          try { var r = await api('DELETE', '/api/admin/notices/' + n.id, undefined, atoken); NEWS = r.notices; renderNews(); } catch (e) { adminError(e, '削除できませんでした'); }
        };
        a.appendChild(del); adm.appendChild(a);
      }
    });
    if (openEl && curRoute() === 'notices') { NEWS_OPEN = null; setTimeout(function () { openEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); }
  }
  $('newsAll').onclick = function () { go('notices'); };
  function renderYears() {
    var box = $('yList'); box.textContent = ''; if (!atoken) return;
    if (!YEARS.length) { box.textContent = '追加した年はありません(2000年〜来年は最初から選べます)。'; return; }
    box.appendChild(document.createTextNode('追加済みの年: '));
    YEARS.forEach(function (y) {
      var chip = el('span', 'chip', y + '年'); var d = el('button', 'ghost', '×'); d.setAttribute('aria-label', y + '年を削除');
      d.onclick = async function () { if (!(await confirmBox('年を削除しますか?', y + '年を年の選択肢から外します(曲がない年のみ削除できます)。'))) return; try { var r = await api('DELETE', '/api/admin/years/' + y, undefined, atoken); YEARS = r.years; buildYears(Number(yr.value)); renderAll(); } catch (e) { adminError(e, '削除できませんでした'); } };
      chip.appendChild(d); box.appendChild(chip);
    });
  }
  $('yf').onsubmit = async function (e) {
    e.preventDefault();
    try { var r = await api('POST', '/api/admin/years', { year: Number($('ynew').value) }, atoken); YEARS = r.years; var y = Number($('ynew').value); $('ynew').value = ''; buildYears(y); saveLast(); renderAll(); loadTable(); toast(y + '年を追加しました'); }
    catch (err) { adminError(err, '追加できませんでした'); }
  };
  $('nf').onsubmit = async function (e) {
    e.preventDefault();
    try { var r = await api('POST', '/api/admin/notices', { title: $('ntitle').value, text: $('ntext').value }, atoken); NEWS = r.notices; $('ntitle').value = ''; $('ntext').value = ''; renderNews(); toast('お知らせを投稿しました'); }
    catch (err) { adminError(err, '投稿できませんでした'); }
  };

  /* ---- 描画 ---- */
  function renderAll() {
    var admin = !!atoken;
    $('meName').textContent = ME ? ME.name + 'さんとしてログイン中' : 'ログインしていません';
    $('backUser').hidden = !admin;
    $('adminBadge').hidden = !admin; $('adminBadge').textContent = admin ? '管理者: ' + adminName : '管理者';
    $('meAv').textContent = ''; if (ME) $('meAv').appendChild(avatar(ME.id, ME.icon, ME.name, 'm'));
    $('leave').hidden = !ME; $('joinPanel').hidden = !!ME;
    $('addPanel').hidden = !admin; $('adminSec').hidden = !admin;
    $('exMine').hidden = !ME; $('exMineImg').hidden = !ME;
    $('lead').textContent = admin ? '管理者画面です。曲の追加・全ユーザーの採点の確認・動画用データの書き出しができます。'
      : '名前を入力してログインし、曲一覧から点数(0〜10)を付けると、あなたのランキングができます。各クールで1曲だけ☆を付けられます。';
    if (admin) { $('purl').value = PL[key()] || ''; $('apName').textContent = adminName; }
    tabs(); renderRank(); renderList(); renderMatrix(); renderNews(); renderYears(); renderDeadline(); renderMode(); renderXlinks(); renderParticipants(); renderUserPages();
    route(true);
  }

  /* ---- メニューとページの切り替え ---- */
  /* スマホ: 曲名・アーティスト・アニメ名は、1行に収まるよう文字を小さくする */
  var FITMQ = window.matchMedia ? window.matchMedia('(max-width: 620px)') : { matches: false };
  function fitLines() {
    var nodes = document.querySelectorAll('#rank .t, #rank .ln, #list .t, #list .ln');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i]; n.style.fontSize = '';
      if (!FITMQ.matches || !n.clientWidth) continue;
      var size = parseFloat(getComputedStyle(n).fontSize);
      while (n.scrollWidth > n.clientWidth + 0.5 && size > 9) { size -= 0.5; n.style.fontSize = size + 'px'; }
    }
  }
  var fitT;
  function fitSoon() { clearTimeout(fitT); fitT = setTimeout(fitLines, 30); }
  ['rank', 'list'].forEach(function (id) { var b = $(id); if (b && window.MutationObserver) new MutationObserver(fitSoon).observe(b, { childList: true }); });
  window.addEventListener('resize', fitSoon);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSoon);

  var VIEWS = { '': 'v-home', invite: 'v-invite', adminx: 'v-adminx', notices: 'v-notices', icon: 'v-icon', about: 'v-about', pasts: 'v-pasts', pastadmin: 'v-pastadmin', years: 'v-years', rename: 'v-rename', password: 'v-password', people: 'v-people', 'admin-login': 'v-adminlogin', admins: 'v-admins', users: 'v-users', adminpw: 'v-adminpw', news: 'v-news' };
  var ADMIN_ONLY = { adminx: 1, pastadmin: 1, years: 1, admins: 1, users: 1, adminpw: 1, news: 1 }, NEED_ME = { rename: 1, password: 1, icon: 1 };
  function curRoute() { var h = (location.hash || '').replace(/^#\/?/, ''); return Object.prototype.hasOwnProperty.call(VIEWS, h) ? h : ''; }
  function go(r) { var t = '#/' + (r || ''); if (location.hash === t || (!r && (location.hash === '' || location.hash === '#'))) route(false); else location.hash = t; }
  function menuItems() {
    var about = { t: 'Party Rankとは', r: 'about' }, past = { t: '過去のParty Rank', r: 'pasts' };
    var news = { t: 'お知らせ', r: 'notices' }, inv = { t: '友だちを招待', r: 'invite' };
    if (atoken) return [about, { t: '管理者ホーム', r: '' }, news, inv, past, { sep: 1 },
      { t: '管理者一覧', r: 'admins' }, { t: '一般ユーザーのパスワードリセット', r: 'users' },
      { t: '管理者パスワードの変更', r: 'adminpw' }, { t: 'お知らせの登録', r: 'news' },
      { t: 'Xアカウントの登録', r: 'adminx' }, { t: '年代の追加', r: 'years' }, { t: '過去のParty Rankの登録', r: 'pastadmin' }];
    var a = [about, { t: 'ホーム', r: '' }, news, inv];
    if (ME) a.push({ t: 'アイコンの設定', r: 'icon' }, { t: 'ユーザー名の変更', r: 'rename' }, { t: 'パスワード(合言葉)の再設定', r: 'password' });
    a.push({ t: '参加者一覧', r: 'people' }, past, { sep: 1 }, { t: '管理者画面への入室', r: 'admin-login' });
    return a;
  }
  function renderMenu(cur) {
    var m = $('menu'), n = 0; m.textContent = '';
    menuItems().forEach(function (it) {
      if (it.sep) { m.appendChild(document.createElement('hr')); return; }
      var b = el('button', it.r === cur ? 'on' : ''); b.textContent = it.t; b.type = 'button'; b.style.setProperty('--i', n++);
      if (it.r === cur) b.setAttribute('aria-current', 'page');
      b.tabIndex = m.classList.contains('open') ? 0 : -1;
      b.onclick = function () { closeMenu(); go(it.r); };
      m.appendChild(b);
    });
  }
  function setMenu(open) {
    $('menu').classList.toggle('open', open); $('menuBg').classList.toggle('open', open);
    $('menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false'); $('menuBtn').setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    Array.prototype.forEach.call($('menu').querySelectorAll('button'), function (b) { b.tabIndex = open ? 0 : -1; });
  }
  function closeMenu() { setMenu(false); }
  $('menuBtn').onclick = function () { var open = !$('menu').classList.contains('open'); setMenu(open); if (open) { var f = $('menu').querySelector('button.on') || $('menu').querySelector('button'); if (f) setTimeout(function () { f.focus(); }, 60); } };
  $('menuBg').onclick = closeMenu;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('menu').classList.contains('open')) { closeMenu(); $('menuBtn').focus(); } });
  function route(soft) {
    var r = curRoute();
    if ((ADMIN_ONLY[r] && !atoken) || (NEED_ME[r] && !ME) || (r === 'admin-login' && atoken)) r = '';
    if (r !== curRoute()) { try { history.replaceState(null, '', '#/' + (r || '')); } catch (e) { location.hash = '#/' + (r || ''); } }
    Object.keys(VIEWS).forEach(function (k) { $(VIEWS[k]).hidden = k !== r; });
    renderMenu(r);
    if (soft) return;
    window.scrollTo(0, 0);
    if (r === 'rename') { $('rn').value = ME ? ME.name : ''; $('rpw').value = ''; $('rmsg').textContent = ''; renderUserPages(); }
    else if (r === 'password') { $('pmsg').textContent = ''; renderUserPages(); }
    else if (r === 'people') loadPart();
    else if (r === 'admins') loadAdmins();
    else if (r === 'users') { PSIG = ''; loadPeople(true); }
    else if (r === 'news') renderNews();
    else if (r === 'invite') renderInvite();
    else if (r === 'adminx') renderAdminX();
    else if (r === 'about') loadStaff();
    else if (r === 'notices') renderNews();
    else if (r === 'icon') { ICDATA = ''; $('icFile').value = ''; $('icSave').disabled = true; $('icMsg').textContent = ''; iconPrev(''); }
    else if (r === 'pasts') { renderPasts(); api('GET', '/api/pasts').then(function (d) { PASTS = d.pasts || []; if (curRoute() === 'pasts') renderPasts(); }).catch(function () {}); }
    else if (r === 'pastadmin') renderPastAdmin();
    else if (r === 'years') renderYears();
    else if (r === 'adminpw') { $('apmsg').textContent = ''; $('apName').textContent = adminName; }
    else if (r === 'admin-login') { $('lmsg').textContent = ''; $('adm').focus(); }
  }
  window.addEventListener('hashchange', function () { route(false); });
  var SIG = '';
  var SIGP = '', DEFER = false;
  document.addEventListener('focusout', function () {
    if (!DEFER) return;
    setTimeout(function () { if (DEFER && !isBusy()) { DEFER = false; refresh(true); } }, 500);
  });
  async function refresh(silent) {
    try {
      var res = await api('GET', '/api/songs'), songs = res.songs, sig = JSON.stringify(res);
      var pt = null, pa = null;
      try { pt = await api('GET', '/api/participants'); } catch (e) {}
      try { pa = (await api('GET', '/api/pasts')).pasts || []; } catch (e) {}
      if (pt) PART = pt; if (pa) PASTS = pa;
      // 参加者・過去動画だけが変わったときは、曲一覧を作り直さない(入力中の内容が消えるため)
      var sp = JSON.stringify([PART, PASTS]);
      if (sp !== SIGP) { SIGP = sp; renderParticipants(); if (curRoute() === 'pasts') renderPasts(); }
      if (silent === true && sig === SIG) { loadTable(); return; }
      // 入力中・保存中は、あとで反映する
      if (silent === true && (isBusy() || Object.keys(PEND).length)) { DEFER = true; loadTable(); return; }
      DEAD = res.deadlines || {}; MODES = res.modes || {}; LINKS = res.links || [];
      SIG = sig; SONGS = songs; PL = res.playlists || {}; NEWS = res.notices || [];
      var ny = res.years || []; if (JSON.stringify(ny) !== JSON.stringify(YEARS)) { YEARS = ny; buildYears(Number(yr.value)); }
    } catch (e) { if (silent !== true) toast('曲一覧を読み込めませんでした'); return; }
    renderAll(); loadTable();
  }
  yr.onchange = $('cour').onchange = $('kind').onchange = function () { saveLast(); renderAll(); loadTable(); };

  (async function init() {
    await loadMe();
    if (atoken) { try { await enterAdmin(); } catch (e) {} }
    await refresh();
    route(false);
    setInterval(function () { if (!document.hidden) refresh(true); }, 20000);
  })();
})();
