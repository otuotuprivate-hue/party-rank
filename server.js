'use strict';
// Party Rank点数評価ツール — 依存パッケージなし(Node.js 18以上)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SESSION_MS = 12 * 60 * 60 * 1000;
const COURS = { 1: '冬', 4: '春', 7: '夏', 10: '秋' };
const KINDS = ['OP', 'ED', '挿入歌', 'キャラソン'];
const PLAYLIST_HOSTS = ['music.apple.com', 'itunes.apple.com', 'geo.music.apple.com', 'embed.music.apple.com'];

/* ---------- データ保存(JSONファイル) ---------- */
let db = { songs: [], people: [], scores: {}, stars: {}, comments: {}, playlists: {}, admins: [], sessions: {} };
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function hashPw(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('hex');
}
function checkPw(pw, salt, hash) {
  const a = Buffer.from(hashPw(pw, salt), 'hex');
  const b = Buffer.from(String(hash), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function addAdmin(name, pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.admins.push({ name, salt, hash: hashPw(pw, salt) });
}
function load() {
  try {
    db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (!db.admins.length) {
    // 最初の管理者。公開前に ADMIN_NAME / ADMIN_PASSWORD を必ず設定してください。
    addAdmin(process.env.ADMIN_NAME || 'taetae', process.env.ADMIN_PASSWORD || 'Taiga0119');
    save();
  }
}
load();

/* ---------- 小さな道具 ---------- */
const token = () => crypto.randomBytes(24).toString('hex');
const id = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const isScore = (v) => typeof v === 'number' && v >= 0 && v <= 10 && Math.round(v * 2) === v * 2;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const courOf = (key) => key.split('-').slice(0, 2).join('-');
const labelOf = (key) => {
  const p = key.split('-');
  return p[0] + '年' + COURS[p[1]] + (p[2] || '');
};
const validKey = (k) => /^\d{4}-(1|4|7|10)-/.test(k) && KINDS.includes(String(k).split('-')[2]);

const hits = new Map();
function limited(req, bucket, max, ms) {
  let ip = req.socket.remoteAddress || '';
  if (TRUST_PROXY) ip = String(req.headers['x-forwarded-for'] || ip).split(',')[0].trim();
  const k = bucket + '|' + ip;
  const now = Date.now();
  const h = hits.get(k);
  if (!h || h.reset < now) { hits.set(k, { n: 1, reset: now + ms }); return false; }
  h.n++;
  return h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k); }, 60000).unref();

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (msg) => new HttpError(400, msg);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 65536) { reject(new HttpError(413, '送信データが大きすぎます')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const o = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(o && typeof o === 'object' ? o : {}); }
      catch (e) { reject(bad('JSONの形式が正しくありません')); }
    });
    req.on('error', reject);
  });
}
function send(res, code, body, headers) {
  const isStr = typeof body === 'string';
  res.writeHead(code, Object.assign({ 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(isStr ? body : JSON.stringify(body));
}
const bearer = (req) => (String(req.headers.authorization || '').match(/^Bearer ([0-9a-f]{48})$/) || [])[1] || '';

function person(req) {
  const t = bearer(req);
  const p = t && db.people.find((x) => x.token === t);
  if (!p) throw new HttpError(401, '名前を入力して参加してください');
  return p;
}
function admin(req) {
  const t = bearer(req);
  const s = t && db.sessions[t];
  if (!s || s.exp < Date.now()) { if (s) { delete db.sessions[t]; save(); } throw new HttpError(401, '管理者としてログインしてください'); }
  return s;
}

/* ---------- 集計(管理者の全体表・動画用データ) ---------- */
function buildTable(key) {
  const songs = db.songs.filter((s) => s.key === key).sort((a, b) => a.at - b.at);
  const ids = new Set(songs.map((s) => s.id));
  const cour = courOf(key);
  const people = db.people
    .filter((p) => Object.keys(db.scores[p.id] || {}).some((sid) => ids.has(sid)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const rows = songs.map((s) => {
    const scores = {}; const vals = [];
    people.forEach((p) => { const v = (db.scores[p.id] || {})[s.id]; if (typeof v === 'number') { scores[p.id] = v; vals.push(v); } });
    const starBy = people.filter((p) => (db.stars[p.id] || {})[cour] === s.id).map((p) => p.id);
    const comments = {};
    people.forEach((p) => { const c = (db.comments[p.id] || {})[s.id]; if (c) comments[p.id] = c; });
    return { id: s.id, title: s.title, artist: s.artist, anime: s.anime, scores, starBy, comments, avg: mean(vals), count: vals.length };
  });
  rows.sort((a, b) => (a.avg == null ? (b.avg == null ? 0 : 1) : b.avg == null ? -1 : b.avg - a.avg));
  let rk = 0, pv = null;
  rows.forEach((r, i) => { if (r.avg == null) { r.rank = null; return; } const q = Math.round(r.avg * 1000); if (q !== pv) { rk = i + 1; pv = q; } r.rank = rk; });
  const userAvg = {}; const starTitles = {}; const all = [];
  people.forEach((p) => {
    const v = songs.map((s) => (db.scores[p.id] || {})[s.id]).filter((x) => typeof x === 'number');
    userAvg[p.id] = mean(v); all.push(...v);
    const sid = (db.stars[p.id] || {})[cour];
    const sg = db.songs.find((s) => s.id === sid);
    starTitles[p.id] = sg ? sg.title : '';
  });
  return { key, label: labelOf(key), cour, people: people.map((p) => ({ id: p.id, name: p.name })), rows, userAvg, overallAvg: mean(all), starTitles };
}
const csvCell = (v) => { v = String(v == null ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
function tableCsv(t, footer, desc) {
  const names = t.people.map((p) => p.name);
  const rows = [['順位', '曲名', 'アーティスト', 'アニメ作品名', '平均点', '採点人数', '☆の数'].concat(names)];
  const data = t.rows.map((r) => [r.rank == null ? '' : r.rank, r.title, r.artist, r.anime, r2(r.avg) == null ? '' : r2(r.avg), r.count, r.starBy.length].concat(t.people.map((p) => (r.scores[p.id] == null ? '' : r.scores[p.id]))));
  if (desc) data.reverse();
  rows.push(...data);
  if (footer) {
    rows.push(['', 'ユーザーの平均', '', '', r2(t.overallAvg) == null ? '' : r2(t.overallAvg), '', ''].concat(t.people.map((p) => (r2(t.userAvg[p.id]) == null ? '' : r2(t.userAvg[p.id])))));
    rows.push(['', t.label.replace(/(OP|ED|挿入歌|キャラソン)$/, '') + 'の☆', '', '', '', '', ''].concat(t.people.map((p) => t.starTitles[p.id])));
  }
  return toCsv(rows);
}
function tableJson(t, desc) {
  const items = t.rows.map((r) => ({
    rank: r.rank, title: r.title, artist: r.artist, anime: r.anime,
    average: r2(r.avg), scoreCount: r.count,
    stars: r.starBy.map((pid) => t.people.find((p) => p.id === pid).name),
    scores: t.people.reduce((o, p) => { if (r.scores[p.id] != null) o[p.name] = r.scores[p.id]; return o; }, {}),
  }));
  if (desc) items.reverse();
  return {
    key: t.key, label: t.label, order: desc ? 'rank-desc' : 'rank-asc',
    participants: t.people.map((p) => p.name),
    participantAverages: t.people.reduce((o, p) => { o[p.name] = r2(t.userAvg[p.id]); return o; }, {}),
    overallAverage: r2(t.overallAvg), items,
  };
}
function allKeys() { return [...new Set(db.songs.map((s) => s.key))]; }

/* ---------- API ---------- */
async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req);

  if (m === 'GET' && p === '/api/songs') {
    return send(res, 200, { songs: db.songs.map(({ id, key, title, artist, anime, at }) => ({ id, key, title, artist, anime, at })), playlists: db.playlists });
  }
  if (m === 'POST' && p === '/api/join') {
    if (limited(req, 'join', 30, 10 * 60000)) throw new HttpError(429, '試行回数が多すぎます。しばらくしてからやり直してください');
    const name = clean(body.name, 30), pass = clean(body.pass, 60);
    if (!name) throw bad('名前を入力してください');
    if (pass && pass.length < 4) throw bad('合言葉は4文字以上にしてください');
    const ex = db.people.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (ex) {
      if (ex.hash && pass && checkPw(pass, ex.salt, ex.hash)) return send(res, 200, { token: ex.token, name: ex.name });
      throw new HttpError(409, 'その名前はすでに使われています。別の名前にするか、登録時の合言葉を入力してください');
    }
    const np = { id: id(), name, token: token(), at: Date.now() };
    if (pass) { np.salt = crypto.randomBytes(16).toString('hex'); np.hash = hashPw(pass, np.salt); }
    db.people.push(np); save();
    return send(res, 200, { token: np.token, name: np.name });
  }
  if (p === '/api/me' && m === 'GET') {
    const me = person(req);
    return send(res, 200, { name: me.name, scores: db.scores[me.id] || {}, stars: db.stars[me.id] || {}, comments: db.comments[me.id] || {} });
  }
  if (p === '/api/me/score' && m === 'PUT') {
    const me = person(req);
    const song = db.songs.find((s) => s.id === body.songId);
    if (!song) throw bad('曲が見つかりません');
    const sc = (db.scores[me.id] = db.scores[me.id] || {});
    if (body.score === null) delete sc[song.id];
    else if (isScore(body.score)) sc[song.id] = body.score;
    else throw bad('点数は0〜10の0.5点刻みで指定してください');
    save();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/me/star' && m === 'PUT') {
    const me = person(req);
    const st = (db.stars[me.id] = db.stars[me.id] || {});
    if (body.songId === null) {
      const c = clean(body.cour, 12);
      if (!/^\d{4}-(1|4|7|10)$/.test(c)) throw bad('クールが正しくありません');
      delete st[c];
    } else {
      const song = db.songs.find((s) => s.id === body.songId);
      if (!song) throw bad('曲が見つかりません');
      st[courOf(song.key)] = song.id;
    }
    save();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/me/comment' && m === 'PUT') {
    const me = person(req);
    const song = db.songs.find((s) => s.id === body.songId);
    if (!song) throw bad('曲が見つかりません');
    const text = clean(body.text, 100);
    const cm = (db.comments[me.id] = db.comments[me.id] || {});
    if (text) cm[song.id] = text; else delete cm[song.id];
    save();
    return send(res, 200, { ok: true, text });
  }
  if (p === '/api/me/name' && m === 'PUT') {
    const me = person(req);
    const name = clean(body.name, 30);
    if (!name) throw bad('名前を入力してください');
    if (db.people.some((x) => x.id !== me.id && x.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'その名前はすでに使われています');
    me.name = name; save();
    return send(res, 200, { name });
  }

  /* --- 管理者 --- */
  if (p === '/api/admin/login' && m === 'POST') {
    if (limited(req, 'login', 8, 15 * 60000)) throw new HttpError(429, 'ログインの試行回数が多すぎます。15分後にやり直してください');
    const name = clean(body.name, 30), pw = String(body.password || '');
    const a = db.admins.find((x) => x.name === name);
    // 管理者名の有無が分からないよう、どちらの場合も同じ計算をする
    const ok = checkPw(pw, a ? a.salt : '0'.repeat(32), a ? a.hash : '0'.repeat(64)) && !!a;
    if (!ok) throw new HttpError(401, '管理者名かパスワードが違います');
    const t = token();
    db.sessions[t] = { name: a.name, exp: Date.now() + SESSION_MS }; save();
    return send(res, 200, { token: t, name: a.name });
  }
  if (p.startsWith('/api/admin/')) {
    const s = admin(req);
    if (p === '/api/admin/logout' && m === 'POST') { delete db.sessions[bearer(req)]; save(); return send(res, 200, { ok: true }); }
    if (p === '/api/admin/table' && m === 'GET') {
      const key = url.searchParams.get('key') || '';
      if (!validKey(key)) throw bad('区分が正しくありません');
      return send(res, 200, buildTable(key));
    }
    if (p === '/api/admin/export' && m === 'GET') {
      const key = url.searchParams.get('key') || '', fmt = url.searchParams.get('format') || 'json';
      const desc = url.searchParams.get('order') === 'desc';
      const footer = url.searchParams.get('footer') === '1';
      if (fmt === 'json') {
        const keys = key === 'all' ? allKeys() : [key];
        if (!keys.length || !keys.every(validKey)) throw bad('区分が正しくありません');
        const out = keys.map((k) => tableJson(buildTable(k), desc));
        const name = key === 'all' ? 'party-rank-all.json' : 'party-rank-' + key + '.json';
        return send(res, 200, JSON.stringify(key === 'all' ? { generatedAt: new Date().toISOString(), tables: out } : Object.assign({ generatedAt: new Date().toISOString() }, out[0]), null, 2),
          { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name) });
      }
      if (fmt === 'csv') {
        if (!validKey(key)) throw bad('区分が正しくありません');
        return send(res, 200, tableCsv(buildTable(key), footer, desc), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('party-rank-' + key + (footer ? '-table' : '') + '.csv') });
      }
      throw bad('形式が正しくありません');
    }
    if (p === '/api/admin/songs' && m === 'POST') {
      const key = clean(body.key, 20), title = clean(body.title, 80);
      if (!validKey(key)) throw bad('区分が正しくありません');
      if (!title) throw bad('曲名を入力してください');
      const song = { id: id(), key, title, artist: clean(body.artist, 60), anime: clean(body.anime, 80), at: Date.now() };
      db.songs.push(song); save();
      return send(res, 200, song);
    }
    const dm = p.match(/^\/api\/admin\/songs\/([0-9a-z]+)$/);
    if (dm && m === 'PUT') {
      const song = db.songs.find((x) => x.id === dm[1]);
      if (!song) throw new HttpError(404, '曲が見つかりません');
      const title = clean(body.title, 80);
      if (!title) throw bad('曲名を入力してください');
      song.title = title; song.artist = clean(body.artist, 60); song.anime = clean(body.anime, 80);
      save();
      return send(res, 200, song);
    }
    if (p === '/api/admin/playlist' && m === 'PUT') {
      const key = clean(body.key, 20), raw = clean(body.url, 500);
      if (!validKey(key)) throw bad('区分が正しくありません');
      if (!raw) { delete db.playlists[key]; save(); return send(res, 200, { ok: true, url: '' }); }
      let u;
      try { u = new URL(raw); } catch (e) { throw bad('URLの形式が正しくありません'); }
      if (u.protocol !== 'https:' || !PLAYLIST_HOSTS.includes(u.hostname)) throw bad('Apple Music / iTunes のプレイリストのURL(https://music.apple.com/…)を貼ってください');
      db.playlists[key] = u.href; save();
      return send(res, 200, { ok: true, url: u.href });
    }
    if (p === '/api/admin/people' && m === 'GET') {
      return send(res, 200, { people: db.people.map((x) => ({ id: x.id, name: x.name, scored: Object.keys(db.scores[x.id] || {}).length })) });
    }
    const pm = p.match(/^\/api\/admin\/people\/([0-9a-z]+)$/);
    if (pm && m === 'DELETE') {
      const i = db.people.findIndex((x) => x.id === pm[1]);
      if (i < 0) throw new HttpError(404, 'ユーザーが見つかりません');
      db.people.splice(i, 1);
      delete db.scores[pm[1]]; delete db.stars[pm[1]]; delete db.comments[pm[1]];
      save();
      return send(res, 200, { ok: true });
    }
    if (dm && m === 'DELETE') {
      const i = db.songs.findIndex((x) => x.id === dm[1]);
      if (i < 0) throw new HttpError(404, '曲が見つかりません');
      db.songs.splice(i, 1);
      Object.values(db.scores).forEach((o) => delete o[dm[1]]);
      Object.values(db.comments).forEach((o) => delete o[dm[1]]);
      Object.values(db.stars).forEach((o) => { for (const c in o) if (o[c] === dm[1]) delete o[c]; });
      save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/admins' && m === 'GET') return send(res, 200, { admins: db.admins.map((a) => a.name), me: s.name });
    if (p === '/api/admin/admins' && m === 'POST') {
      const name = clean(body.name, 30), pw = String(body.password || '');
      if (!name || !pw) throw bad('名前とパスワードは必須です');
      if (pw.length < 6) throw bad('パスワードは6文字以上にしてください');
      if (db.admins.some((a) => a.name === name)) throw new HttpError(409, '同じ名前の管理者がすでにいます');
      addAdmin(name, pw); save();
      return send(res, 200, { admins: db.admins.map((a) => a.name) });
    }
  }
  throw new HttpError(404, '見つかりません');
}

/* ---------- 静的ファイル ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, SEC));
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
    serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'サーバーでエラーが起きました' });
  }
}).listen(PORT, () => console.log('Party Rank: http://localhost:' + PORT));
