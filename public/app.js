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
  function admTag() { var t = el('span', 'admtag', '管理者'); return t; }
  function uLink(u, cls) { var a = el('a', cls || 'ulink', u.name); a.href = '#/profile/' + encodeURIComponent(u.id); return a; }
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
  function isFrozen(k) { var md = modeOf(k); return md === 'tally' || md === 'watch'; }
  function renderRank() {
    var k = key(), box = $('rank'); box.textContent = '';
    $('rh').textContent = (ME ? ME.name + 'さんの ' : '') + label(k) + ' ランキング';
    var rs = $('rsum'); rs.hidden = true;
    if (!ME) { box.appendChild(el('div', 'empty', 'ログインすると、あなたのランキングがここに出ます。')); return; }
    var L = rankedMine(k);
    if (L.length) {
      var tot = L.reduce(function (a, x) { return a + x.v; }, 0) / L.length;
      rs.hidden = false; rs.textContent = ''; rs.appendChild(el('span', 'rsl', 'あなたの平均点')); rs.appendChild(el('b', '', tot.toFixed(2))); rs.appendChild(el('span', 'rsn', '点(採点 ' + L.length + ' / ' + songsOf(k).length + '曲)'));
    }
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
    var FZ = isFrozen(k);
    L.forEach(function (s, idx) {
      var row = el('div', 'row'), starred = ST[courOf(s.key)] === s.id;
      row.appendChild(info(s, false));
      var rc = el('div', 'rc');
      var stb = el('button', 'star' + (starred ? ' on' : ''), starred ? '★' : '☆');
      stb.title = label(courOf(s.key) + '-') + 'の☆(1曲だけ)'; stb.setAttribute('aria-label', s.title + 'に☆を付ける'); stb.setAttribute('aria-pressed', starred ? 'true' : 'false');
      stb.disabled = !ME || FZ; stb.onclick = function () { toggleStar(s); }; rc.appendChild(stb);
      var sel = el('select'); sel.setAttribute('aria-label', s.title + 'の点数'); sel.disabled = !ME || FZ;
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
        cm.value = CM[s.id] || ''; cm.setAttribute('aria-label', s.title + 'へのひとこと'); cm.disabled = FZ;
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
  function isBusy() { var a = document.activeElement; return !!(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.closest && a.closest('#list, #rank, #adminSec, #predBox')); }
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
          try { await send(); ok = true; if (i >= 2) sendEvent('bug'); break; }
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
  $('rf').onsubmit = async function (e) {
    e.preventDefault(); $('rmsg').textContent = '';
    try { var r = await api('PUT', '/api/me/name', { name: $('rn').value, pass: $('rpw').value }, ptoken); ME.name = r.name; $('rpw').value = ''; renderAll(); loadTable(); loadPart(); toast('名前を変更しました'); renderProfile(); }
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
  async function moveUser(i, d) {
    var ids = TABLE.people.map(function (u) { return u.id; }), j = i + d;
    if (j < 0 || j >= ids.length) return;
    var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    try { TABLE = await api('PUT', '/api/admin/table-order', { key: TABLE.key, ids: ids }, atoken); TSIG = JSON.stringify(TABLE); renderMatrix(); }
    catch (e) { adminError(e, '並び替えできませんでした'); }
  }
  $('exReset') && ($('exReset').onclick = async function () {
    if (!TABLE) return;
    try { TABLE = await api('PUT', '/api/admin/table-order', { key: TABLE.key, ids: [] }, atoken); TSIG = JSON.stringify(TABLE); renderMatrix(); toast('ユーザーの並びを名前順に戻しました'); }
    catch (e) { adminError(e, '戻せませんでした'); }
  });

  /* ---- プロフィール ---- */
  var PFID = '';
  function titleClass(n) { return n > 30 ? 't5' : n > 20 ? 't4' : n > 10 ? 't3' : n > 5 ? 't2' : 't1'; }
  async function renderProfile(idArg) {
    var id = idArg || routeParam() || (ME && ME.id) || ''; PFID = id;
    var card = $('pfCard'); card.textContent = '';
    var mine = !!(ME && ME.id === id);
    $('pfEdit').hidden = !mine;
    if (!id) { card.appendChild(el('div', 'empty', 'ユーザーが見つかりません')); return; }
    var u;
    try { u = await api('GET', '/api/profile/' + encodeURIComponent(id)); }
    catch (e) { card.appendChild(el('div', 'empty', e.status === 404 ? 'このユーザーは見つかりません(削除された可能性があります)' : e.message)); $('pfEdit').hidden = true; return; }
    if (PFID !== id) return;
    var top = el('div', 'pftop'); top.appendChild(avatar(u.id, u.ic, u.name, 'xl'));
    var nm = el('div', 'pfname'), line = el('div', 'pfn'); line.appendChild(el('span', 'pfnm', u.name)); if (u.adm) line.appendChild(admTag()); nm.appendChild(line);
    if (u.title && u.tid) { var tw = el('div', 'ttw'); tw.appendChild(titleChip(u.tid, u.title)); nm.appendChild(tw); }
    if (u.at) nm.appendChild(el('div', 'pfsince', 'サイト登録日 ' + fdate(u.at)));
    top.appendChild(nm); card.appendChild(top);
    var st = el('div', 'pfstat'); st.appendChild(el('b', '', u.count)); st.appendChild(document.createTextNode(' ランキングに参加')); card.appendChild(st);
    if (u.x) { var xa = el('a', 'xl', xHandle(u.x)); xa.href = u.x; xa.target = '_blank'; xa.rel = 'noopener noreferrer'; xa.onclick = function () { sendEvent('xclick'); }; card.appendChild(xa); }
    if (ME && !mine) {
      var cl = el('div', 'pfcompat'); card.appendChild(cl);
      api('GET', '/api/me/compat', undefined, ptoken).then(function (r) { var f = r.list.filter(function (x) { return x.id === id; })[0]; cl.textContent = f ? 'あなたとの相性 ' + f.pct.toFixed(1) + '%(共通の曲 ' + f.n + '曲)' : ''; }).catch(function () {});
    }
    if (u.titles && u.titles.length) { var tb = el('div', 'pftt'); tb.appendChild(el('div', 'hint', '獲得した称号(' + u.titles.length + '個)')); var tw = el('div', 'pfttw'); u.titles.forEach(function (t) { tw.appendChild(titleChip(t.id, t.name)); }); tb.appendChild(tw); card.appendChild(tb); }
    if (u.bio) card.appendChild(el('p', 'pfbio', u.bio));
    else if (mine) card.appendChild(el('p', 'hint', '自己紹介はまだありません。下で書いてみましょう。'));
    if (mine) {
      $('pfBio').value = u.bio || ''; $('pfX').value = u.x ? xHandle(u.x) : ''; $('pfCnt').textContent = (u.bio || '').length + '/200'; $('pfMsg').textContent = '';
      checkTitles().then(function () { if (curRoute() === 'profile') fillPfTitle(); });
      ICDATA = ''; $('icFile').value = ''; $('icSave').disabled = true; $('icMsg').textContent = ''; iconPrev('');
      $('rn').value = ME.name; $('rpw').value = ''; $('rmsg').textContent = ''; renderUserPages();
    }
  }
  function fillPfTitle() {
    var sel = $('pfTitle'); if (!TT) { sel.textContent = ''; return; }
    sel.textContent = ''; var o0 = document.createElement('option'); o0.value = ''; o0.textContent = '称号なし'; sel.appendChild(o0);
    TT.earned.forEach(function (t) { var o = document.createElement('option'); o.value = t.id; o.textContent = t.name; sel.appendChild(o); });
    sel.value = TT.equipped || '';
    var pv = $('pfTitlePrev'); pv.textContent = ''; var cur = TT.earned.filter(function (t) { return t.id === TT.equipped; })[0];
    if (cur) pv.appendChild(titleChip(cur.id, cur.name));
    $('pfTitleHint').textContent = TT.earned.length ? '獲得した称号 ' + TT.earned.length + ' 個から選べます(名前の横に表示されます)。' : 'まだ称号がありません。ランキングに参加して手に入れましょう。';
  }
  $('pfTitle').onchange = async function () {
    var v = $('pfTitle').value;
    try { var r = await api('PUT', '/api/me/title', { id: v || null }, ptoken); if (TT) TT.equipped = r.equipped; fillPfTitle(); toast(v ? '称号をセットしました' : '称号を外しました'); renderProfile(); }
    catch (e) { toast(e.message); fillPfTitle(); }
  };
  $('pfBio').oninput = function () { $('pfCnt').textContent = $('pfBio').value.length + '/200'; };
  $('pfForm').onsubmit = async function (e) {
    e.preventDefault(); $('pfMsg').textContent = '';
    try { await api('PUT', '/api/me/profile', { bio: $('pfBio').value, x: $('pfX').value }, ptoken); toast('プロフィールを保存しました'); renderProfile(); checkTitles(); }
    catch (err) { $('pfMsg').textContent = err.message; if (err.status === 401) forget(); }
  };
  $('pfPw').onclick = function () { go('password'); };

  function f2(v) { return v == null ? '–' : (Math.round(v * 100) / 100).toFixed(2); }
  var TSIG = '';
  function modeOf(k) { return (MODES[k] && MODES[k].mode) || 'entry'; }
  async function loadTable() {
    var k = key(); loadReacts();
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
  var CMF = '', CMOPEN = false;
  function renderComments(t) {
    var list = $('cmList'); list.textContent = '';
    var withC = [], n = 0, byUser = {};
    t.rows.forEach(function (r) {
      var cs = t.people.filter(function (u) { return r.comments && r.comments[u.id]; });
      if (cs.length) { withC.push({ r: r, cs: cs }); cs.forEach(function (u) { byUser[u.id] = (byUser[u.id] || 0) + 1; }); }
    });
    withC.forEach(function (g) { n += g.cs.length; });
    $('cmSum').textContent = 'みんなのひとこと(' + n + '件)'; $('cmBox').hidden = !n;
    if (!n) return;
    if (!CMOPEN) { CMOPEN = true; $('cmBox').open = true; }
    if (CMF && !byUser[CMF]) CMF = '';
    var bar = el('div', 'cmbar'), sel = el('select'); sel.setAttribute('aria-label', 'ユーザーで絞り込み');
    sel.appendChild(new Option('全員のひとこと', ''));
    t.people.forEach(function (u) { if (byUser[u.id]) sel.appendChild(new Option(u.name + '(' + byUser[u.id] + '件)', u.id)); });
    sel.value = CMF; sel.onchange = function () { CMF = sel.value; renderComments(t); };
    bar.appendChild(sel); list.appendChild(bar);
    withC.forEach(function (g) {
      var cs = g.cs.filter(function (u) { return !CMF || u.id === CMF; }); if (!cs.length) return;
      var card = el('div', 'cmsong'), head = el('div', 'cmhead');
      head.appendChild(el('span', 'cmrk', g.r.rank == null ? '–' : g.r.rank + '位'));
      var ti = el('div', 'cmti'); ti.appendChild(el('b', '', g.r.title)); var sub = [g.r.artist, g.r.anime].filter(Boolean).join(' / '); if (sub) ti.appendChild(el('small', '', sub));
      head.appendChild(ti); head.appendChild(el('span', 'cmavg', f2(g.r.avg))); card.appendChild(head);
      cs.forEach(function (u) {
        var it = el('div', 'cmitem'), body = el('div', 'cmbody'), who = el('div', 'cmwho');
        who.appendChild(uLink(u)); var v = g.r.scores[u.id]; if (typeof v === 'number') who.appendChild(el('span', 'cmsc', v.toFixed(1) + '点')); if (g.r.starBy.indexOf(u.id) >= 0) who.appendChild(el('span', 'gold', '★'));
        body.appendChild(who); body.appendChild(el('div', 'cmtxt', g.r.comments[u.id]));
        if (REACTS && modeOf(t.key) === 'watch') body.appendChild(reactBar(t, g.r, u));
        it.appendChild(avatar(u.id, u.ic, u.name, 's')); it.appendChild(body); card.appendChild(it);
      });
      list.appendChild(card);
    });
  }
  var TUSEL = null, TUKEY = '';
  function renderTU() {
    var box = $('tuBox'); box.hidden = !(atoken && TABLE && TABLE.cand); if (box.hidden) return;
    if (TUKEY !== TABLE.key || !TUSEL) { TUKEY = TABLE.key; TUSEL = {}; TABLE.cand.forEach(function (c) { TUSEL[c.id] = c.on; }); }
    var n = TABLE.cand.filter(function (c) { return TUSEL[c.id]; }).length; $('tuSum').textContent = '(' + n + '/' + TABLE.cand.length + '人を反映中)';
    var l = $('tuList'); if (l.dataset.k === TUKEY + ':' + TABLE.cand.length) return; l.dataset.k = TUKEY + ':' + TABLE.cand.length; l.textContent = '';
    TABLE.cand.forEach(function (c) {
      var lb = el('label', 'tuit'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!TUSEL[c.id]; cb.dataset.id = c.id;
      cb.onchange = function () { TUSEL[c.id] = cb.checked; }; lb.appendChild(cb); lb.appendChild(document.createTextNode(' ' + c.name)); l.appendChild(lb);
    });
  }
  function tuSetAll(v) { if (!TABLE || !TABLE.cand) return; TABLE.cand.forEach(function (c) { TUSEL[c.id] = v; }); $('tuList').querySelectorAll('input').forEach(function (i) { i.checked = v; }); }
  $('tuAll').onclick = function () { tuSetAll(true); }; $('tuNone').onclick = function () { tuSetAll(false); };
  $('tuSave').onclick = async function () {
    if (!TABLE) return; var ids = TABLE.cand.filter(function (c) { return TUSEL[c.id]; }).map(function (c) { return c.id; }); $('tuMsg').textContent = '';
    try { TABLE = await api('PUT', '/api/admin/table-users', { key: TABLE.key, ids: ids }, atoken); TSIG = JSON.stringify(TABLE); TUSEL = null; $('tuList').dataset.k = ''; renderMatrix(); toast('全体表に反映しました'); }
    catch (e) { adminError(e, '反映できませんでした'); }
  };
  function renderMatrix() {
    $('adminSec').hidden = !TABLE; $('exBar').hidden = !atoken; $('mvHint').hidden = !atoken; if (!TABLE) { $('tuBox').hidden = true; return; } renderTU();
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
    t.people.forEach(function (u, ui) {
      var th = el('th'), pl = el('a', 'avl'); pl.href = '#/profile/' + encodeURIComponent(u.id); pl.title = u.name + 'のプロフィール'; pl.onclick = function (e) { e.stopPropagation(); };
      pl.appendChild(avatar(u.id, u.ic, u.name, 's')); th.appendChild(pl); th.appendChild(document.createTextNode(' ' + u.name + arrow(u.id)));
      sortTh(th, u.id, u.name);
      if (atoken) {
        var mv = el('span', 'mv');
        [['◀', -1, '左へ'], ['▶', 1, '右へ']].forEach(function (d) {
          var b = el('button', '', d[0]); b.type = 'button'; b.title = u.name + 'を' + d[2] + '移動'; b.setAttribute('aria-label', b.title);
          b.disabled = ui + d[1] < 0 || ui + d[1] >= t.people.length;
          b.onclick = function (e) { e.stopPropagation(); moveUser(ui, d[1]); };
          b.onkeydown = function (e) { e.stopPropagation(); };
          mv.appendChild(b);
        });
        th.appendChild(mv);
      }
      hr.appendChild(th);
    });
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
      var r = x.r, tr = el('tr', r.rank === 1 ? 'top' : ''), svals = t.people.map(function (u) { return r.scores[u.id]; }).filter(function (v) { return typeof v === 'number'; }), smax = Math.max.apply(null, svals), smin = Math.min.apply(null, svals), grOn = svals.length >= 2 && smax !== smin;
      tr.appendChild(el('td', 'c1', r.rank == null ? '–' : r.rank));
      var c2 = el('td', 'c2', r.title); c2.appendChild(el('small', '', [r.artist, r.anime].filter(Boolean).join(' / '))); tr.appendChild(c2);
      t.people.forEach(function (u) {
        var v = r.scores[u.id], td = el('td', '', typeof v === 'number' ? v.toFixed(1) : '–');
        if (typeof v === 'number') td.style.background = 'color-mix(in srgb, var(--acc) ' + Math.round(v * 7) + '%, var(--card))';
        if (grOn && v === smax) td.className = 'gmax'; else if (grOn && v === smin) td.className = 'gmin';
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
    renderComments(t);
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
    var url = canvas.toDataURL('image/png'); $('imgPrev').src = url; $('imgSave').onclick = function () { var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('保存しました'); sendEvent('imgsave'); };
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
      var iv = t.people.map(function (u) { return r.scores[u.id]; }).filter(function (v) { return typeof v === 'number'; }), imx = Math.max.apply(null, iv), imn = Math.min.apply(null, iv), igr = iv.length >= 2 && imx !== imn;
      t.people.forEach(function (u, j) {
        var v = r.scores[u.id], cx = x0 + C1 + C2 + j * per;
        if (typeof v === 'number') { var pc = v * 0.07; g.fillStyle = 'rgb(' + Math.round(255 - 31 * pc) + ',' + Math.round(255 - 207 * pc) + ',' + Math.round(255 - 144 * pc) + ')'; g.fillRect(cx + 2, y + 3, per - 4, RH - 6); }
        var gc = igr && v === imx ? '#0a9d4f' : igr && v === imn ? '#e0102a' : null;
        g.fillStyle = gc || '#1c1b3a'; g.font = (gc ? '800 15px ' : '700 14px ') + FF; g.textAlign = 'center'; g.textBaseline = 'middle'; if (gc) { g.shadowColor = gc; g.shadowBlur = 6; }
        g.fillText(typeof v === 'number' ? v.toFixed(1) : '–', cx + per / 2 - (r.starBy.indexOf(u.id) >= 0 ? 5 : 0), y + RH / 2 + 1); g.shadowBlur = 0; g.shadowColor = 'transparent';
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
      ptoken = r.token; store('pr-token', ptoken); $('jp').value = ''; $('jn').value = ''; try { var lo = Number(sessionStorage.getItem('pr-lo') || 0); if (lo && Date.now() - lo <= 60000) sendEvent('relog'); sessionStorage.removeItem('pr-lo'); } catch (e2) {} await loadMe(); renderAll(); loadPart(); toast(r.name + 'さんとしてログインしました');
    } catch (err) { $('jmsg').textContent = err.message; }
  };
  $('leave').onclick = async function () {
    if (ME && !ME.hasPass && !(await confirmBox('ログアウトしますか?', '合言葉が未設定です。ログアウトすると、同じ名前でログインし直せなくなり、これまでの点数も見られなくなります。\n先に、メニューの「パスワード(合言葉)の再設定」で合言葉を決めておくことをおすすめします。', 'ログアウトする'))) return;
    try { sessionStorage.setItem('pr-lo', String(Date.now())); } catch (e2) {}
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
        top.appendChild(avatar(u.id, u.ic, u.name, 's')); var nb = el('b'); nb.appendChild(uLink(u)); top.appendChild(nb); if (u.adm) top.appendChild(admTag()); top.appendChild(el('span', 'm', '(採点 ' + u.scored + '曲・合言葉' + (u.hasPass ? 'あり' : 'なし') + ')')); top.appendChild(el('span', 'grow'));
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
      var r = await api('POST', '/api/admin/login', { name: $('adm').value, password: $('pw').value, person: ptoken || undefined });
      atoken = r.token; adminName = r.name; store('pr-admin', atoken, true); store('pr-admin-name', adminName, true);
      $('pw').value = ''; await enterAdmin(); go(''); toast(adminName + 'として管理者画面に入りました');
    } catch (err) { $('lmsg').textContent = err.message; if (ptoken) setTimeout(checkTitles, 300); }
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
  $('bulkGo').onclick = async function () {
    $('bulkMsg').textContent = ''; var t = $('bulkText').value; if (!t.trim()) { $('bulkMsg').textContent = '曲の一覧を貼り付けてください'; return; }
    try { var r = await api('POST', '/api/admin/songs-bulk', { key: key(), text: t }, atoken); $('bulkText').value = ''; await refresh(); $('bulkMsg').textContent = r.added + '曲を追加しました' + (r.skipped ? '(' + r.skipped + '行は、空行か重複のため追加しませんでした)' : ''); toast(r.added + '曲を追加しました'); }
    catch (e) { adminError(e, ''); $('bulkMsg').textContent = e.message; }
  };
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
  $('shX').onclick = function () { sendEvent('invite'); }; $('shL').onclick = function () { sendEvent('invite'); };
  $('shD').onclick = function () { sendEvent('invite'); var t = invText(); copyText((t ? t + '\n' : '') + invUrl(), 'コピーしました。Discordに貼り付けてください'); };
  $('shN').onclick = function () { sendEvent('invite'); navigator.share({ title: 'Party Rank', text: invText(), url: invUrl() }).catch(function () {}); };

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
      r.staff.forEach(function (x) { var a = el('a', 'xacc', xHandle(x.x)); a.href = x.x; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.onclick = function () { sendEvent('xclick'); }; box.appendChild(a); });
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
    try { var r = await api('PUT', '/api/me/icon', { data: ICDATA }, ptoken); ME.icon = r.icon; ICDATA = ''; $('icFile').value = ''; $('icSave').disabled = true; PSIG = ''; TSIG = ''; renderAll(); loadTable(); loadPart(); toast('アイコンを設定しました'); renderProfile(); }
    catch (err) { $('icMsg').textContent = err.message; if (err.status === 401) forget(); }
  };
  $('icDel').onclick = async function () {
    try { await api('DELETE', '/api/me/icon', undefined, ptoken); ME.icon = 0; ICDATA = ''; $('icFile').value = ''; $('icSave').disabled = true; TSIG = ''; renderAll(); loadTable(); loadPart(); toast('アイコンを外しました'); renderProfile(); }
    catch (err) { $('icMsg').textContent = err.message; }
  };

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
      var a = el('a', 'vid', '▶ 動画を見る'); a.href = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.onclick = function () { sendEvent('pastclick'); }; r.appendChild(a);
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
    tally: { name: '集計中', cls: 'tally', text: '採点を締め切りました。集計中です(点数・☆・ひとこと・予想は変更できません)。結果発表をお待ちください。' },
    watch: { name: 'Party Watch', cls: 'watch', text: 'ランキングが公開されました。下に全体表が表示されます(点数の変更はできません)。' }
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
      $('mEntry').disabled = md === 'entry'; $('mRank').disabled = md === 'rank'; $('mTally').disabled = md === 'tally';
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
  $('mTally').onclick = async function () {
    if (!(await confirmBox('集計モードにしますか?', label(key()) + ' の点数・☆・ひとこと・予想の入力を締め切ります(全員が変更できなくなります)。\n称号の判定も、ここから始まります。', '締め切る'))) return;
    setMode('tally', '', '集計モードにしました。点数の入力を締め切りました');
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
  var ONL = { count: 0, people: [] };
  async function loadOnline() { try { ONL = await api('GET', '/api/online'); renderOnline(); if (PART && curRoute() === 'people') renderParticipants(); } catch (e) {} }
  function renderOnline() {
    var b = $('onl'); if (!b) return; b.textContent = '';
    if (!ONL.count) { b.hidden = true; return; }
    b.hidden = false; b.appendChild(el('span', 'ond', '')); b.appendChild(el('b', '', 'いまオンライン ' + ONL.count + '人'));
    var av = el('span', 'onav'); ONL.people.slice(0, 8).forEach(function (u) { av.appendChild(avatar(u.id, u.ic, u.name, 's')); }); b.appendChild(av);
    if (ONL.people.length > 8) b.appendChild(el('span', 'm', '+' + (ONL.people.length - 8)));
    b.onclick = function () { go('people'); };
  }
  function pingNow() { if (ptoken && !document.hidden) api('POST', '/api/me/ping', {}, ptoken).catch(function () {}); }
  setInterval(function () { pingNow(); if (!document.hidden) loadOnline(); }, 30000);
  setTimeout(function () { pingNow(); loadOnline(); }, 1500);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { pingNow(); loadOnline(); } });
  function renderParticipants() {
    var all = $('partAll'), sel = $('partKey'); all.textContent = '';
    if (!PART) return;
    $('partTotal').textContent = '全体のユーザー(' + PART.people.length + '人)';
    if (!PART.people.length) all.appendChild(el('span', 'm', 'まだ参加者はいません。'));
    var onSet = {}; ONL.people.forEach(function (u) { onSet[u.id] = 1; });
    var ob = $('partOn'); ob.textContent = ''; $('partOnBox').hidden = !ONL.count;
    ONL.people.forEach(function (u) { var c = el('span', 'chip hasav'); c.appendChild(avatar(u.id, u.ic, u.name, 's')); c.appendChild(uLink(u)); if (u.adm) c.appendChild(admTag()); ob.appendChild(c); });
    $('partOnH').textContent = 'いまオンライン(' + ONL.count + '人)';
    PART.people.forEach(function (u) { var c = el('span', 'chip hasav'); c.appendChild(avatar(u.id, u.ic, u.name, 's')); if (onSet[u.id] || u.on) c.appendChild(el('span', 'ond', '')); c.appendChild(uLink(u)); if (u.adm) c.appendChild(admTag()); all.appendChild(c); });
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
    g.participants.forEach(function (u) { var c = el('span', 'chip hasav'); c.appendChild(avatar(u.id, u.ic, u.name, 's')); c.appendChild(uLink(u)); if (u.adm) c.appendChild(admTag()); c.appendChild(document.createTextNode('(採点 ' + u.scored + '/' + g.songs + '曲)')); out.appendChild(c); });
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
    sm.appendChild(col); d.appendChild(sm); d.appendChild(el('div', 'nbody', n.text));
    d.addEventListener('toggle', function () { if (d.open && d.dataset.ev !== '1') { d.dataset.ev = '1'; sendEvent('news'); } }); return d;
  }
  function newsLink(n) {
    var b = el('button', 'nlink'); b.type = 'button'; var col = el('div', 'ncol'); col.appendChild(newsMeta(n)); col.appendChild(el('div', 'nt', n.title || 'お知らせ'));
    b.appendChild(col); b.onclick = function () { sendEvent('news'); NEWS_OPEN = n.id; go('notices'); }; return b;
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
    if (curRoute() === 'predict') { fillPredKeys(); renderPred(); }
    route(true);
  }


  /* ---- 称号 ---- */
  var TITLE_ICON = { rank1: '🌱', rank2: '🎧', rank3: '⭐', rank4: '👑', rank5: '✨', sweet: '🍬', bonjin: '😐', lucky7: '🍀', gyaku: '🙃', yari: '🔱', stairs: '🪜', star1: '🌟', cmleader: '💬', gyakushin: '⚡', manba: '🎫', kadai: '🎈', sliding: '⏱️', silent: '🤫', intruder: '💀', viewer: '📺', resonance: '🎵', camera: '📷', constellation: '🌌', zero: '🕳️', collector: '🏆', gunshi: '♟️', honor: '📝', power: '⚜️', tenzero: '⚖️', allten: '💯', allzero: '🫥', ladder: '📈', descent: '📉', ichimai: '🎆', sniper: '🎯', tragic: '🥀', manjo: '👏', midpoint: '⏺️', jackpot: '🎰', nito: '⚔️', yonkan: '🗝️', shiki: '🌸', rensen: '🔥', konami: '🕹️', revkonami: '🔄', hadouken: '🌀', shoryuken: '🐉', typeparty: '🎉', typeanison: '🎤', sudo: '#️⃣', gg: '🤝', calltaiga: '📢', logo7: '👆', logohold: '⏳', ctrls: '💾', esc5: '🚪', tab20: '⌨️', allcmd: '👾',funeoriro: '🚢', lost: '🧭', maxname: '🔠', burst: '⚡', dawn: '🌃', resizer: '↔️', devtools: '🔍', offline: '📡', relog: '🔌', infloop: '♾️', qa: '🛡️', halloween: '🎃', xmas: '🎄', newyear: '🎍', tanabata: '🎋', pocky: '🍫', zorome: '🕚', kaibun: '🔁', lucky77: '7️⃣', pittari: '💯', love: '💗', isekai: '🌀', creator: '☀️', destroyer: '💥', ten: '🎉', harsh: '🌶️', steady: '📏', extreme: '☯️', marathon: '🏃', oshi: '💖', eye: '👁️', cmmaster: '✍️', popular: '🎊', ambassador: '🤝', detective: '🕵️', mine: '💣', early: '🌅', night: '🌙', soulmate: '💞', loner: '🐺', contrary: '🌓', founder: '🏛️', champion: '🥇', pr: '📣', missionary: '⛪', reporter: '📰', indecisive: '🔀', resident: '🏠', f5: '🔄', roster: '📖', loginbonus: '🎁', weekly: '📅', regular: '🪑', veteran: '🎖️', iconmaker: '🖼️', renamer: '🏷️', reviser: '✏️', linked: '🔗', dresser: '👗', hunter: '🏹', tking: '👑', explorer: '🧭', historian: '📜', manual: '📚', compatfan: '💘', neighbor: '🏘️', follower: '🐦', photog: '📸', master: '🏯', watcher: '🎬', kind: '🕊️', ice: '🧊', dompisha: '🎯', heretic: '😈', half: '➗', round: '⭕', tasty: '🍰', mvp: '🏅', lastlove: '🥀', podium: '🏆', prophet: '🔮', oneway: '➡️', variety: '🎨', nostar: '🍃', avgbody: '⚖️', regular5: '🏁', iron: '🦾', attend: '🎓', combo: '💎', traveler: '🧳', bughunter: '🐛', debugger: '🛠️', boundary: '📐' };
  var TITLE_CATS = [["rankp", "参加ランク"], ["score", "採点のくせ"], ["result", "順位・結果"], ["join", "参加・継続"], ["comm", "ひとこと・交流"], ["site", "サイト愛"], ["debug", "デバッグ"], ["cmd", "コマンド"], ["lucky", "たまたま"], ["staff", "コレクション・特別"]], TITLE_META = {"rank1": ["rankp", 1], "rank2": ["rankp", 2], "rank3": ["rankp", 3], "rank4": ["rankp", 3], "rank5": ["rankp", 4], "sweet": ["score", 1], "bonjin": ["score", 1], "harsh": ["score", 1], "nostar": ["score", 1], "lucky7": ["score", 2], "gyaku": ["score", 2], "zero": ["score", 2], "steady": ["score", 2], "extreme": ["score", 2], "ten": ["score", 2], "contrary": ["score", 2], "kind": ["score", 2], "ice": ["score", 2], "dompisha": ["score", 2], "heretic": ["score", 2], "half": ["score", 2], "tasty": ["score", 2], "oneway": ["score", 2], "eye": ["score", 2], "kadai": ["score", 2], "silent": ["score", 2], "isekai": ["score", 2], "ichimai": ["score", 2], "indecisive": ["score", 2], "stairs": ["score", 3], "round": ["score", 3], "variety": ["score", 3], "avgbody": ["score", 3], "gunshi": ["score", 3], "tenzero": ["score", 3], "ladder": ["score", 3], "descent": ["score", 3], "allten": ["score", 4], "allzero": ["score", 4], "midpoint": ["score", 4], "sliding": ["result", 2], "star1": ["result", 2], "mine": ["result", 2], "early": ["result", 2], "night": ["result", 2], "lastlove": ["result", 2], "tragic": ["result", 2], "manjo": ["result", 2], "oshi": ["result", 2], "funeoriro": ["result", 2], "yari": ["result", 3], "constellation": ["result", 3], "gyakushin": ["result", 3], "manba": ["result", 3], "creator": ["result", 3], "destroyer": ["result", 3], "champion": ["result", 3], "detective": ["result", 3], "mvp": ["result", 3], "podium": ["result", 3], "sniper": ["result", 3], "prophet": ["result", 4], "marathon": ["join", 1], "regular5": ["join", 2], "nito": ["join", 2], "iron": ["join", 3], "rensen": ["join", 3], "attend": ["join", 4], "combo": ["join", 4], "traveler": ["join", 4], "yonkan": ["join", 4], "shiki": ["join", 4], "honor": ["comm", 1], "follower": ["comm", 1], "linked": ["comm", 1], "cmleader": ["comm", 2], "love": ["comm", 2], "resonance": ["comm", 2], "compatfan": ["comm", 2], "neighbor": ["comm", 2], "cmmaster": ["comm", 3], "popular": ["comm", 3], "ambassador": ["comm", 3], "soulmate": ["comm", 3], "loner": ["comm", 3], "pr": ["site", 1], "loginbonus": ["site", 1], "manual": ["site", 1], "iconmaker": ["site", 1], "viewer": ["site", 1], "camera": ["site", 1], "reporter": ["site", 2], "roster": ["site", 2], "weekly": ["site", 2], "regular": ["site", 2], "renamer": ["site", 2], "reviser": ["site", 2], "dresser": ["site", 2], "historian": ["site", 2], "photog": ["site", 2], "watcher": ["site", 2], "missionary": ["site", 3], "resident": ["site", 3], "veteran": ["site", 3], "explorer": ["site", 3], "master": ["site", 4], "debugger": ["debug", 1], "lost": ["debug", 1], "devtools": ["debug", 1], "bughunter": ["debug", 2], "maxname": ["debug", 2], "burst": ["debug", 2], "dawn": ["debug", 2], "resizer": ["debug", 2], "offline": ["debug", 2], "relog": ["debug", 2], "f5": ["debug", 2], "intruder": ["debug", 2], "boundary": ["debug", 3], "infloop": ["debug", 4], "qa": ["debug", 4], "halloween": ["lucky", 2], "xmas": ["lucky", 2], "newyear": ["lucky", 2], "tanabata": ["lucky", 2], "pocky": ["lucky", 2], "zorome": ["lucky", 3], "kaibun": ["lucky", 3], "lucky77": ["lucky", 3], "pittari": ["lucky", 3], "jackpot": ["lucky", 4], "gg": ["cmd", 1], "logo7": ["cmd", 1], "ctrls": ["cmd", 1], "esc5": ["cmd", 1], "hadouken": ["cmd", 2], "shoryuken": ["cmd", 2], "typeparty": ["cmd", 2], "typeanison": ["cmd", 2], "sudo": ["cmd", 2], "calltaiga": ["cmd", 2], "logohold": ["cmd", 2], "tab20": ["cmd", 2], "konami": ["cmd", 3], "revkonami": ["cmd", 3], "allcmd": ["cmd", 4], "hunter": ["staff", 2], "collector": ["staff", 3], "founder": ["staff", 3], "tking": ["staff", 4], "power": ["staff", 4]};
  function titleChip(id, name) { var mt = TITLE_META[id], c = el('span', 'ttl tt-' + id + (mt && mt[1] >= 3 ? ' lv' + mt[1] : '')); c.appendChild(el('i', 'tti', TITLE_ICON[id] || '🏅')); c.appendChild(el('span', 'ttn', name)); return c; }
  var TT = null;
  async function checkTitles(quiet) {
    if (!ptoken) { TT = null; return; }
    try {
      var r = await api('GET', '/api/me/titles', undefined, ptoken); TT = r;
      var fresh = r.earned.filter(function (t) { return t.fresh; });
      if (fresh.length) {
        api('POST', '/api/me/titles/seen', {}, ptoken).catch(function () {});
        showTitlePop(fresh);
        if (curRoute() === 'titles') renderTitleBox();
      }
    } catch (e) { if (e.status === 401) return; }
  }
  function lvStars(n) { return '★★★★'.slice(0, n) + '☆☆☆☆'.slice(0, 4 - n); }
  function renderTitleBox() {
    var box = $('ttlBox'); box.textContent = '';
    if (!TT) { box.appendChild(el('span', 'm', '読み込み中…')); return; }
    box.appendChild(el('p', 'hint', '獲得 ' + TT.earned.length + ' / ' + TT.total + ' 個 ・ ジャンルごとに、難しい(★が多い)称号から並んでいます'));
    (TT.cats || TITLE_CATS).forEach(function (cg) {
      var cat = cg[0], mine = TT.earned.filter(function (t) { return t.cat === cat; }).sort(function (a, b) { return b.lv - a.lv || a.at - b.at; }), lk = ((TT.lockedBy || {})[cat] || []).slice().sort(function (a, b) { return b - a; });
      if (!mine.length && !lk.length) return;
      var h = el('h3', 'sub ttcat', cg[1]); h.appendChild(el('span', 'hd', ' ' + mine.length + '/' + (mine.length + lk.length))); box.appendChild(h);
      var grid = el('div', 'ttgrid');
      mine.forEach(function (t) {
        var card = el('div', 'ttcard' + (TT.equipped === t.id ? ' on' : '')); card.appendChild(titleChip(t.id, t.name));
        card.appendChild(el('div', 'ttlv', '難易度 ' + lvStars(t.lv) + ' ・ 獲得者 ' + t.holders + '/' + TT.people + '人(' + (TT.people ? Math.max(1, Math.round(t.holders * 100 / TT.people)) : 0) + '%)'));
        card.appendChild(el('div', 'ttdesc', t.desc));
        var b = el('button', TT.equipped === t.id ? '' : 'pri', TT.equipped === t.id ? '外す' : '装備する'); b.type = 'button';
        b.onclick = async function () {
          try { var r = await api('PUT', '/api/me/title', { id: TT.equipped === t.id ? null : t.id }, ptoken); TT.equipped = r.equipped; renderTitleBox(); }
          catch (e) { toast(e.message); }
        };
        card.appendChild(b); grid.appendChild(card);
      });
      box.appendChild(grid);
      if (lk.length) { var lr = el('div', 'ttlockrow'); lk.forEach(function (lv) { var lc = el('span', 'lkchip'); lc.appendChild(el('span', 'ttl tt-lock', '？？？')); lc.appendChild(el('span', 'ttlv', lvStars(lv))); lr.appendChild(lc); }); lr.appendChild(el('div', 'hint', '未獲得 ' + lk.length + '個(条件は、獲得すると分かります)')); box.appendChild(lr); }
    });
  }
  var POPQ = [];
  function showTitlePop(list) {
    POPQ = POPQ.concat(list);
    if (!$('ttlPop').hidden) return;
    var items = POPQ.splice(0), box = $('ttlPopList'); box.textContent = '';
    items.forEach(function (t) { var w = el('div'); w.appendChild(titleChip(t.id, t.name)); w.appendChild(el('div', 'ttdesc', t.desc)); box.appendChild(w); });
    $('ttlPop').hidden = false; $('ttlPopOk').focus();
  }
  $('ttlPopOk').onclick = function () { $('ttlPop').hidden = true; if (POPQ.length) showTitlePop([]); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('ttlPop').hidden) $('ttlPopOk').click(); });
  var EVT_T = 0;
  function sendEvent(type, extra) {
    if (!ptoken) return; var body = { type: type }; if (extra) for (var k in extra) body[k] = extra[k];
    api('POST', '/api/me/event', body, ptoken).then(function () { clearTimeout(EVT_T); EVT_T = setTimeout(function () { checkTitles(); }, 1500); }).catch(function () {});
  }
  var LASTVIS = { r: '', t: 0 };
  function trackVisit(r) {
    if (!ptoken || !r) return; var now = Date.now(); if (LASTVIS.r === r && now - LASTVIS.t < 2000) return; LASTVIS = { r: r, t: now };
    if (['about', 'notices', 'invite', 'pasts', 'people', 'profile', 'titles', 'predict', 'compat'].indexOf(r) >= 0) sendEvent('visit', { r: r });
    if (r === 'profile') { var pid = routeParam(); if (pid && ME && pid !== ME.id) sendEvent('profile', { id: pid }); }
  }
  setInterval(function () { if (!document.hidden && ptoken) sendEvent('stay'); }, 60000);
  (function () {
    try {
      var a = JSON.parse(sessionStorage.getItem('pr-loads') || '[]'), n = Date.now(); a = a.filter(function (t) { return n - t < 10000; }); a.push(n);
      sessionStorage.setItem('pr-loads', JSON.stringify(a));
      if (a.length >= 5) { sessionStorage.setItem('pr-loads', '[]'); var iv = setInterval(function () { if (ptoken) { clearInterval(iv); sendEvent('f5'); } }, 800); setTimeout(function () { clearInterval(iv); }, 15000); }
    } catch (e) {}
  })();

  async function loadAdminTitles() {
    var box = $('adTtl'); box.textContent = '読み込み中…';
    try {
      var r = await api('GET', '/api/admin/titles', undefined, atoken); box.textContent = '';
      box.appendChild(el('p', 'hint', '全' + r.titles.length + '個 ・ ジャンルごとに、難しい(★が多い)称号から並んでいます'));
      (r.cats || TITLE_CATS).forEach(function (cg) {
        var ts = r.titles.filter(function (t) { return t.cat === cg[0]; }).sort(function (a, b) { return b.lv - a.lv; }); if (!ts.length) return;
        var h = el('h3', 'sub ttcat', cg[1]); h.appendChild(el('span', 'hd', ' ' + ts.length + '個')); box.appendChild(h);
        var list = el('div', 'adtt');
        ts.forEach(function (t) {
          var row = el('div', 'r'); row.appendChild(titleChip(t.id, t.name)); row.appendChild(el('div', 'ttlv', '難易度 ' + lvStars(t.lv))); row.appendChild(el('div', 'ttdesc', t.desc));
          row.appendChild(el('span', 'hd', '獲得者 ' + t.holders + '/' + r.people + '人' + (t.hidden ? '(管理者のみ)' : '')));
          if (t.who && t.who.length) { var dt = document.createElement('details'); dt.className = 'whod'; dt.appendChild(el('summary', '', '獲得した人を見る')); dt.appendChild(el('div', 'whol', t.who.join('、'))); row.appendChild(dt); }
          list.appendChild(row);
        });
        box.appendChild(list);
      });
      var byP = r.byPerson || [], nm = {}; r.titles.forEach(function (t) { nm[t.id] = t; });
      box.appendChild(el('h3', 'sub', 'ユーザー別の獲得状況'));
      var pl = el('div', 'adpp');
      byP.sort(function (a, b) { return b.titles.length - a.titles.length; }).forEach(function (p) {
        var d2 = document.createElement('details'); d2.className = 'adpd';
        var sm = document.createElement('summary'); sm.appendChild(el('b', '', p.name)); sm.appendChild(el('span', 'hd', ' ' + p.titles.length + '個')); d2.appendChild(sm);
        var w = el('div', 'adpc'); p.titles.forEach(function (id) { w.appendChild(titleChip(id, nm[id].name)); }); d2.appendChild(w); pl.appendChild(d2);
      });
      if (!byP.length) pl.appendChild(el('span', 'm', 'まだ称号を獲得した人はいません。'));
      box.appendChild(pl);
    } catch (e) { adminError(e, ''); box.textContent = ''; }
  }
  /* ---- 予想ゲーム ---- */
  var PREDS = {}, PDRAFT = {}, PRESULT = {};
  function pk() { return $('predKey').value; }
  function sk2p(k) { var p = k.split('-'); return Number(p[0]) * 100 + Number(p[1]); }
  function fillPredKeys() {
    var sel = $('predKey'), keep = sel.value || key(), seen = {}, ks = [];
    SONGS.forEach(function (x) { if (!seen[x.key]) { seen[x.key] = 1; ks.push(x.key); } });
    ks.sort(function (a, b) { return sk2p(b) - sk2p(a) || KINDS.indexOf(a.split('-')[2]) - KINDS.indexOf(b.split('-')[2]); });
    sel.textContent = ''; ks.forEach(function (k) { sel.appendChild(new Option(label(k), k)); });
    sel.value = seen[keep] ? keep : (ks[0] || '');
  }
  $('predKey').onchange = function () { renderPred(); };
  $('predBack').onclick = function () { go(''); };
  $('ttlBack').onclick = function () { go(''); };
  async function loadPred(k) {
    if (!ME || !ptoken) return;
    try { PREDS[k] = await api('GET', '/api/me/predict?key=' + encodeURIComponent(k), undefined, ptoken); if (k === pk()) renderPred(); } catch (e) { /* */ }
  }
  async function loadPredResult(k) {
    try { PRESULT[k] = await api('GET', '/api/predict-result?key=' + encodeURIComponent(k)); if (k === pk()) renderPred(); } catch (e) { /* */ }
  }
  function songTitle(id) { var s = SONGS.filter(function (x) { return x.id === id; })[0]; return s ? s.title : '(削除された曲)'; }
  function renderPred() {
    var k = pk(), box = $('predBox'), md = modeOf(k), L = songsOf(k); box.textContent = '';
    if (!k) { box.appendChild(el('div', 'empty', 'ランキングがまだありません。')); return; }
    box.appendChild(el('p', 'hint', '結果発表の前に、このランキングの「トップ3」と「ワースト3」を予想しましょう。順位までぴったり当てると3点、トップ3(ワースト3)に入っていれば1点(最大18点)。結果と全員の得点は、Party Watch になると見られます。'));
    if (!ME) { box.appendChild(el('div', 'empty', 'ログインすると予想できます。')); return; }
    if (L.length < 6) { box.appendChild(el('div', 'empty', '曲が6曲以上になると、予想できます。')); return; }
    if (!PREDS[k]) { loadPred(k); box.appendChild(el('span', 'm', '読み込み中…')); return; }
    var pd = PREDS[k].pred, frozen = md === 'watch' || (md === 'tally' && !!pd);
    var d = PDRAFT[k] || (PDRAFT[k] = { top: (pd && pd.top.slice()) || ['', '', ''], worst: (pd && pd.worst.slice()) || ['', '', ''] });
    var grp = el('div', 'predgrid');
    [['top', 'トップ', ['1位', '2位', '3位']], ['worst', 'ワースト', ['最下位', 'ワースト2', 'ワースト3']]].forEach(function (g) {
      var col = el('div', 'predcol'); col.appendChild(el('h4', '', g[1] + '3'));
      for (var i = 0; i < 3; i++) (function (i) {
        var lab = el('label', 'blk', g[2][i]), sel = el('select'); sel.appendChild(new Option('(選んでください)', ''));
        L.forEach(function (s) { sel.appendChild(new Option(s.title, s.id)); });
        sel.value = d[g[0]][i]; sel.disabled = frozen;
        sel.onchange = function () { d[g[0]][i] = sel.value; };
        lab.appendChild(sel); col.appendChild(lab);
      })(i);
      grp.appendChild(col);
    });
    box.appendChild(grp);
    if (!frozen) {
      var bar = el('div', 'bar'), sv = el('button', 'pri', pd ? '予想を更新する' : '予想を送信する'), msg = el('span', 'm', pd ? '送信済みです。締め切りまで変更できます。' : (md === 'tally' ? '集計中の予想は一度限りです。送信後は変更できません。' : ''));
      sv.type = 'button';
      sv.onclick = async function () {
        var all = d.top.concat(d.worst);
        if (all.some(function (v) { return !v; })) { msg.textContent = '6つすべて選んでください'; return; }
        if (new Set(all).size !== 6) { msg.textContent = '同じ曲は重ねて選べません'; return; }
        if (md === 'tally' && !(await confirmBox('この予想を提出しますか?', '集計中の提出は一度限りで、あとから変更できません。'))) return;
        try { await api('PUT', '/api/me/predict', { key: k, top: d.top, worst: d.worst }, ptoken); PREDS[k].pred = { top: d.top.slice(), worst: d.worst.slice() }; toast('予想を送信しました'); renderPred(); }
        catch (e) { msg.textContent = e.message; if (e.status === 401) forget(); }
      };
      bar.appendChild(sv); bar.appendChild(msg); box.appendChild(bar);
    } else if (md === 'tally') box.appendChild(el('p', 'hint', '集計中の予想は一度限りのため、変更できません。結果発表をお楽しみに!'));
    else if (md === 'watch' && !pd) box.appendChild(el('p', 'hint', '公開済みのため、予想の受付は終了しました。'));
    if (md === 'watch') {
      var r = PRESULT[k];
      if (!r) { loadPredResult(k); box.appendChild(el('span', 'm', '結果を読み込み中…')); return; }
      var res = el('div', 'predres'); res.appendChild(el('h4', '', '結果発表'));
      var line = function (lab, arr) { var p = el('p', 'predln'); p.appendChild(el('b', '', lab + ' ')); p.appendChild(document.createTextNode(arr.map(function (x, i) { return (i + 1) + '. ' + x.title + '(' + x.avg.toFixed(2) + ')'; }).join(' / '))); return p; };
      res.appendChild(line('トップ3', r.top)); res.appendChild(line('ワースト3', r.worst));
      if (!r.board.length) res.appendChild(el('p', 'hint', '予想した人はいませんでした。'));
      else {
        var ol = el('ol', 'predboard');
        r.board.forEach(function (b, i) {
          var li = el('li'); li.appendChild(el('span', 'prk', (i + 1) + '位')); li.appendChild(avatar(b.id, b.ic, b.name, 's')); li.appendChild(uLink(b)); if (b.adm) li.appendChild(admTag());
          li.appendChild(el('span', 'prpt', b.pts + '点')); if (b.trifecta) li.appendChild(el('span', 'prbadge', '三連単的中!'));
          var sub = el('div', 'prpick', 'トップ3: ' + b.top.map(songTitle).join(' / ') + '\nワースト3: ' + b.worst.map(songTitle).join(' / ')); li.appendChild(sub);
          ol.appendChild(li);
        });
        res.appendChild(ol);
      }
      box.appendChild(res);
    }
  }

  /* ---- マイ統計 ---- */
  async function loadStats() {
    var box = $('statsBox'); box.textContent = '読み込み中…';
    try {
      var d = await api('GET', '/api/me/stats', undefined, ptoken); box.textContent = '';
      if (!d.total) { box.appendChild(el('div', 'empty', 'まだ採点した曲がありません。曲に点数をつけると、ここに統計が出ます。')); return; }
      var sm = el('div', 'stsum'); [['採点した曲', d.total + '曲'], ['全体の平均点', d.avg.toFixed(2)], ['参加したランキング', d.keys.length + '個']].forEach(function (x) { var c = el('div', 'stc'); c.appendChild(el('small', '', x[0])); c.appendChild(el('b', '', x[1])); sm.appendChild(c); }); box.appendChild(sm);
      box.appendChild(el('h3', 'sub', '点数の分布'));
      var mx = 1; for (var v = 0; v <= 10; v += 0.5) mx = Math.max(mx, d.dist[v] || 0);
      var bars = el('div', 'stbars');
      for (var v2 = 0; v2 <= 10; v2 += 0.5) { var n = d.dist[v2] || 0, col = el('div', 'stcol'), b = el('div', 'stbar'); b.style.height = Math.round(n * 100 / mx) + '%'; b.title = v2.toFixed(1) + '点: ' + n + '曲'; col.appendChild(el('span', 'stn', n || '')); col.appendChild(b); col.appendChild(el('span', 'stx', Number.isInteger(v2) ? String(v2) : '')); bars.appendChild(col); }
      box.appendChild(bars);
      box.appendChild(el('h3', 'sub', 'ランキングごとの平均点'));
      if (d.keys.length >= 2) {
        var W = 340, H = 140, P = 22, X = function (i) { return P + (W - P * 2) * i / (d.keys.length - 1); }, Y = function (a) { return H - P - (H - P * 2) * a / 10; };
        var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'stline');
        function line(pts, cls) { var pl = document.createElementNS(ns, 'polyline'); pl.setAttribute('points', pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ')); pl.setAttribute('class', cls); svg.appendChild(pl); }
        [0, 5, 10].forEach(function (g) { var l = document.createElementNS(ns, 'line'); l.setAttribute('x1', P); l.setAttribute('x2', W - P); l.setAttribute('y1', Y(g)); l.setAttribute('y2', Y(g)); l.setAttribute('class', 'stgrid'); svg.appendChild(l); var t = document.createElementNS(ns, 'text'); t.setAttribute('x', 2); t.setAttribute('y', Y(g) + 4); t.setAttribute('class', 'stlab'); t.textContent = g; svg.appendChild(t); });
        var allp = d.keys.map(function (k, i) { return k.all == null ? null : [X(i), Y(k.all)]; }).filter(Boolean); if (allp.length >= 2) line(allp, 'stl2');
        line(d.keys.map(function (k, i) { return [X(i), Y(k.avg)]; }), 'stl1');
        d.keys.forEach(function (k, i) { var c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', X(i)); c.setAttribute('cy', Y(k.avg)); c.setAttribute('r', 3.5); c.setAttribute('class', 'stdot'); svg.appendChild(c); });
        box.appendChild(svg); box.appendChild(el('p', 'hint', '実線があなたの平均点' + (allp.length >= 2 ? '、点線が公開済みランキングの全体平均です。' : '。')));
      }
      var ul = el('ul', 'stkeys'); d.keys.forEach(function (k) { var li = el('li'); li.appendChild(el('span', '', k.label)); li.appendChild(el('span', 'hd', k.n + '/' + k.total + '曲')); li.appendChild(el('b', '', k.avg.toFixed(2))); if (k.all != null) li.appendChild(el('span', 'hd', '(全体 ' + k.all.toFixed(2) + ')')); ul.appendChild(li); }); box.appendChild(ul);
      function lst(h, a) { box.appendChild(el('h3', 'sub', h)); var o = el('ol', 'stlist'); a.forEach(function (x) { var li = el('li'); li.appendChild(el('span', '', x.title)); li.appendChild(el('small', '', ' ' + x.label)); li.appendChild(el('b', '', ' ' + x.v.toFixed(1))); o.appendChild(li); }); box.appendChild(o); }
      lst('いちばん高い点数をつけた曲', d.top); lst('いちばん低い点数をつけた曲', d.low);
    } catch (e) { box.textContent = ''; box.appendChild(el('div', 'empty', e.message)); if (e.status === 401) forget(); }
  }
  /* ---- 相性診断 ---- */
  var COMPAT = null;
  async function loadCompat() {
    var box = $('compatBox'); box.textContent = '計算中…';
    try {
      COMPAT = await api('GET', '/api/me/compat', undefined, ptoken); box.textContent = '';
      if (!COMPAT.watchKeys) { box.appendChild(el('div', 'empty', 'まだ公開されたランキング(Party Watch)がありません。公開されると、相性を調べられます。')); return; }
      if (!COMPAT.mySongs) { box.appendChild(el('div', 'empty', '公開されたランキングに、あなたの採点がありません。')); return; }
      if (!COMPAT.list.length) { box.appendChild(el('div', 'empty', '共通の曲が5曲以上ある人が、まだいません。')); return; }
      var ol = el('ol', 'cplist');
      COMPAT.list.forEach(function (u, i) {
        var li = el('li'); li.appendChild(el('span', 'cprk', i + 1)); li.appendChild(avatar(u.id, u.ic, u.name, 's'));
        var mid = el('div', 'cpmid'), nm = el('div', 'cpnm'); nm.appendChild(uLink(u)); if (u.adm) nm.appendChild(admTag()); mid.appendChild(nm);
        var bar = el('div', 'cpbar'), fill = el('i'); fill.style.width = u.pct + '%'; bar.appendChild(fill); mid.appendChild(bar); mid.appendChild(el('small', '', '共通の曲 ' + u.n + '曲')); li.appendChild(mid);
        li.appendChild(el('span', 'cppct', u.pct.toFixed(1) + '%')); ol.appendChild(li);
      });
      box.appendChild(ol);
    } catch (e) { box.textContent = e.message; }
  }
  $('compatBack').onclick = function () { go(''); };

  /* ---- ひとことへのリアクション ---- */
  var REACTS = null, RSIG = '';
  async function loadReacts() {
    var k = key();
    if (modeOf(k) !== 'watch') { REACTS = null; RSIG = ''; return; }
    try {
      var r = await api('GET', '/api/reacts?key=' + encodeURIComponent(k), undefined, ptoken || undefined), sig = JSON.stringify(r);
      if (k !== key() || sig === RSIG) return; RSIG = sig; REACTS = r; if (TABLE && TABLE.key === k) renderComments(TABLE);
    } catch (e) { /* */ }
  }
  function reactBar(t, r, u) {
    var ck = r.id + ':' + u.id, bar = el('div', 'rxbar'), cnt = (REACTS.counts || {})[ck] || {}, mine = (REACTS.mine || {})[ck] || [];
    (REACTS.emojis || []).forEach(function (e) {
      var b = el('button', 'rx' + (mine.indexOf(e) >= 0 ? ' on' : '')); b.type = 'button'; b.appendChild(el('span', '', e)); if (cnt[e]) b.appendChild(el('b', '', cnt[e]));
      b.disabled = !ME; b.title = ME ? 'リアクションする' : 'ログインするとリアクションできます'; b.setAttribute('aria-pressed', mine.indexOf(e) >= 0 ? 'true' : 'false');
      b.onclick = async function () {
        var on = mine.indexOf(e) >= 0, c2 = REACTS.counts[ck] = REACTS.counts[ck] || {};
        if (on) { REACTS.mine[ck] = mine.filter(function (x) { return x !== e; }); c2[e] = (c2[e] || 1) - 1; if (!c2[e]) delete c2[e]; } else { (REACTS.mine[ck] = REACTS.mine[ck] || []).push(e); c2[e] = (c2[e] || 0) + 1; }
        renderComments(t);
        try { await api('POST', '/api/me/react', { songId: r.id, owner: u.id, emoji: e }, ptoken); } catch (er) { toast(er.message); if (er.status === 401) forget(); }
        RSIG = ''; loadReacts();
      };
      bar.appendChild(b);
    });
    return bar;
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

  var VIEWS = { '': 'v-home', invite: 'v-invite', adminx: 'v-adminx', notices: 'v-notices', profile: 'v-profile', compat: 'v-compat', stats: 'v-stats', titles: 'v-titles', predict: 'v-predict', adtitles: 'v-adtitles', about: 'v-about', pasts: 'v-pasts', pastadmin: 'v-pastadmin', years: 'v-years', password: 'v-password', people: 'v-people', 'admin-login': 'v-adminlogin', admins: 'v-admins', users: 'v-users', adminpw: 'v-adminpw', news: 'v-news' };
  var ADMIN_ONLY = { adtitles: 1, adminx: 1, pastadmin: 1, years: 1, admins: 1, users: 1, adminpw: 1, news: 1 }, NEED_ME = { stats: 1, password: 1, compat: 1, titles: 1, predict: 1 };
  function routeParam() { var p = (location.hash || '').replace(/^#\/?/, '').split('/')[1]; try { return p ? decodeURIComponent(p) : ''; } catch (e) { return ''; } }
  function curRoute() { var h = (location.hash || '').replace(/^#\/?/, '').split('/')[0]; return Object.prototype.hasOwnProperty.call(VIEWS, h) ? h : ''; }
  function go(r) { var t = '#/' + (r || ''); if (location.hash === t || (!r && (location.hash === '' || location.hash === '#'))) route(false); else location.hash = t; }
  function menuItems() {
    var about = { t: 'Party Rankとは', r: 'about' }, past = { t: '過去のParty Rank', r: 'pasts' };
    var news = { t: 'お知らせ', r: 'notices' }, inv = { t: '友だちを招待', r: 'invite' };
    if (atoken) return [about, { t: '管理者ホーム', r: '' }].concat(ME ? [{ t: 'プロフィール', r: 'profile' }, { t: '称号コレクション', r: 'titles' }, { t: '予想ゲーム', r: 'predict' }, { t: '相性診断', r: 'compat' }, { t: 'マイ統計', r: 'stats' }] : [], [news, inv, past, { sep: 1 },
      { t: '管理者一覧', r: 'admins' }, { t: '一般ユーザーのパスワードリセット', r: 'users' },
      { t: '管理者パスワードの変更', r: 'adminpw' }, { t: 'お知らせの登録', r: 'news' },
      { t: '称号の一覧と獲得条件', r: 'adtitles' }, { t: 'Xアカウントの登録', r: 'adminx' }, { t: '年代の追加', r: 'years' }, { t: '過去のParty Rankの登録', r: 'pastadmin' }, { sep: 1 }, { t: '一般ユーザーに戻る', act: 'back' }]);
    var a = [about, { t: 'ホーム', r: '' }, news, inv];
    if (ME) a.push({ t: 'プロフィール', r: 'profile' }, { t: '称号コレクション', r: 'titles' }, { t: '予想ゲーム', r: 'predict' }, { t: '相性診断', r: 'compat' }, { t: 'マイ統計', r: 'stats' }, { t: 'パスワード(合言葉)の再設定', r: 'password' });
    a.push({ t: '参加者一覧', r: 'people' }, past, { sep: 1 }, { t: '管理者画面への入室', r: 'admin-login' });
    return a;
  }
  function renderMenu(cur) {
    var m = $('menu'), n = 0; m.textContent = '';
    menuItems().forEach(function (it) {
      if (it.sep) { m.appendChild(document.createElement('hr')); return; }
      var b = el('button', it.r && it.r === cur ? 'on' : ''); b.textContent = it.t; b.type = 'button'; b.style.setProperty('--i', n++);
      if (it.r && it.r === cur) b.setAttribute('aria-current', 'page');
      b.tabIndex = m.classList.contains('open') ? 0 : -1;
      b.onclick = function () { closeMenu(); if (it.act === 'back') adminLogout(false); else go(it.r); };
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
    if ((ADMIN_ONLY[r] && !atoken) || (NEED_ME[r] && !ME) || (r === 'admin-login' && atoken) || (r === 'profile' && !routeParam() && !ME)) r = '';
    if (r !== curRoute()) { try { history.replaceState(null, '', '#/' + (r || '')); } catch (e) { location.hash = '#/' + (r || ''); } }
    Object.keys(VIEWS).forEach(function (k) { $(VIEWS[k]).hidden = k !== r; });
    renderMenu(r); $('backBtn').hidden = !r;
    if (!soft) { var rawh = (location.hash || '').replace(/^#\/?/, '').split('/')[0]; if (rawh && !Object.prototype.hasOwnProperty.call(VIEWS, rawh)) sendEvent('lost'); }
    if (soft) return;
    window.scrollTo(0, 0); trackVisit(r);
    if (r === 'profile') renderProfile();
    else if (r === 'titles') { renderTitleBox(); checkTitles().then(function () { if (curRoute() === 'titles') renderTitleBox(); }); }
    else if (r === 'predict') { fillPredKeys(); renderPred(); }
    else if (r === 'adtitles') loadAdminTitles();
    else if (r === 'compat') loadCompat();
    else if (r === 'stats') loadStats();
    else if (r === 'password') { $('pmsg').textContent = ''; renderUserPages(); }
    else if (r === 'people') loadPart();
    else if (r === 'admins') loadAdmins();
    else if (r === 'users') { PSIG = ''; loadPeople(true); }
    else if (r === 'news') renderNews();
    else if (r === 'invite') renderInvite();
    else if (r === 'adminx') renderAdminX();
    else if (r === 'about') loadStaff();
    else if (r === 'notices') renderNews();
    else if (r === 'pasts') { renderPasts(); api('GET', '/api/pasts').then(function (d) { PASTS = d.pasts || []; if (curRoute() === 'pasts') renderPasts(); }).catch(function () {}); }
    else if (r === 'pastadmin') renderPastAdmin();
    else if (r === 'years') renderYears();
    else if (r === 'adminpw') { $('apmsg').textContent = ''; $('apName').textContent = adminName; }
    else if (r === 'admin-login') { $('lmsg').textContent = ''; $('adm').focus(); }
  }
  var NAVN = 0;
  window.addEventListener('hashchange', function () { NAVN++; route(false); });
  var RSZ = 0, RSZT = 0;
  window.addEventListener('resize', function () { clearTimeout(RSZT); RSZT = setTimeout(function () { var n = Date.now(); if (n - RSZ > 1500) { RSZ = n; sendEvent('resize'); } }, 500); });
  document.addEventListener('keydown', function (e) { var k = (e.key || '').toLowerCase(); if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) || (e.metaKey && e.altKey && (k === 'i' || k === 'j'))) sendEvent('devtools'); });
  var CMDS_SENT = {};
  function cmd(id) { if (CMDS_SENT[id] || !ptoken) return; CMDS_SENT[id] = 1; sendEvent('cmd', { c: id }); toast('コマンド入力を検知しました'); }
  var KB = [], ESCN = 0, ESCT = 0, TABS = [];
  var SEQ = { konami: ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a'], revkonami: ['down', 'down', 'up', 'up', 'right', 'left', 'right', 'left', 'a', 'b'], hadouken: ['down', 'right', 'p'], shoryuken: ['right', 'down', 'right', 'p'], typeparty: 'party'.split(''), typeanison: 'anison'.split(''), sudo: 'sudo'.split(''), gg: ['g', 'g'], calltaiga: 'taiga'.split('') };
  var AR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  document.addEventListener('keydown', function (e) {
    var k = e.key || '', lk = k.toLowerCase(), now = Date.now();
    if ((e.ctrlKey || e.metaKey) && lk === 's') cmd('ctrls');
    if (k === 'Escape') { if (now - ESCT > 1500) ESCN = 0; ESCT = now; ESCN++; if (ESCN >= 5) cmd('esc5'); } else ESCN = 0;
    if (k === 'Tab') { TABS.push(now); TABS = TABS.filter(function (t) { return now - t <= 10000; }); if (TABS.length >= 20) cmd('tab20'); }
    var tg = e.target, tn = tg && tg.tagName; if (tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT' || (tg && tg.isContentEditable)) { KB = []; return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tok = AR[k] || (lk.length === 1 ? lk : ''); if (!tok) return; KB.push(tok); if (KB.length > 14) KB.shift();
    Object.keys(SEQ).forEach(function (id) { var q = SEQ[id], n = q.length; if (KB.length >= n && KB.slice(KB.length - n).join(',') === q.join(',')) cmd(id); });
  });
  var LG = [], LGH = 0;
  (function () {
    var br = document.querySelector('a.brand'); if (!br) return;
    br.addEventListener('click', function () { var n = Date.now(); LG.push(n); LG = LG.filter(function (t, i, a) { return true; }); while (LG.length > 7) LG.shift(); if (LG.length === 7 && LG.every(function (t, i) { return !i || t - LG[i - 1] <= 1200; })) cmd('logo7'); });
    var down = function () { clearTimeout(LGH); LGH = setTimeout(function () { cmd('logohold'); }, 3000); }, up = function () { clearTimeout(LGH); };
    br.addEventListener('mousedown', down); br.addEventListener('touchstart', down, { passive: true }); ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(function (ev) { br.addEventListener(ev, up); });
  })();
  var WASOFF = false;
  window.addEventListener('offline', function () { WASOFF = true; });
  window.addEventListener('online', function () { if (WASOFF) { WASOFF = false; sendEvent('offline'); } });
  $('backBtn').onclick = function () { if (NAVN > 0) { NAVN = Math.max(0, NAVN - 2); history.back(); } else go(''); };
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

  // 無料プランなどでサーバーが眠っていたときは、起きるまで待つ
  async function waitServer() {
    for (var i = 0; i < 24; i++) {
      try { var r = await fetch('/healthz', { cache: 'no-store' }); if (r.ok) { $('bootMsg').hidden = true; return; } } catch (e) { /* */ }
      $('bootMsg').hidden = false; await sleep(5000);
    }
    $('bootMsg').hidden = true;
  }
  (async function init() {
    await waitServer();
    await loadMe();
    if (atoken) { try { await enterAdmin(); } catch (e) {} }
    await refresh();
    route(false);
    checkTitles();
    setInterval(function () { if (!document.hidden) { refresh(true); if (ptoken) checkTitles(); } }, 20000);
  })();
})();
