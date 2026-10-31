'use strict';
// Party Rank点数評価ツール — 依存パッケージなし(Node.js 18以上)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

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
let db = { songs: [], people: [], scores: {}, stars: {}, comments: {}, playlists: {}, admins: [], sessions: {}, years: [], notices: [], deadlines: {}, modes: {}, pasts: [], links: [], torder: {}, adminLinked: false, stamps: {}, pred: {}, reacts: {}, titles: {}, counters: {}, changes: {}, texc: {} };
let VER = 0, CVER = 0, dirty = false, saveT = null, saveDue = 0;
function flushDb() {
  if (saveT) { clearTimeout(saveT); saveT = null; }
  if (!dirty) return;
  dirty = false;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
// 保存は少し待ってまとめて行う(書き込みのたびにサイトが止まるのを防ぐ)。quiet=true は、操作の記録だけの保存(表や称号の計算を作り直さない)
function save(quiet) {
  CVER++; if (!quiet) VER++;
  dirty = true;
  const wait = quiet ? 5000 : 400, due = Date.now() + wait;
  if (saveT && saveDue <= due) return;
  if (saveT) clearTimeout(saveT);
  saveDue = due; saveT = setTimeout(() => { saveT = null; flushDb(); }, wait);
}
process.on('exit', () => { try { flushDb(); } catch (e) { /* */ } });
['SIGTERM', 'SIGINT'].forEach((sg) => process.on(sg, () => { try { flushDb(); } catch (e) { /* */ } process.exit(0); }));
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
  // 管理者タグ: 初回だけ、同じ名前のユーザーを管理者本人とみなして結びつける(以後は管理者ログイン時に結びつく)
  if (!db.adminLinked) {
    db.admins.forEach((a) => { const u = db.people.find((x) => x.name.toLowerCase() === a.name.toLowerCase()); if (u && !a.pid) a.pid = u.id; });
    db.adminLinked = true; save();
  }
  // 旧形式のお知らせ(タイトルなし)には、本文の1行目からタイトルを付ける
  db.notices.forEach((n) => { if (!n.title) n.title = String(n.text || '').split('\n')[0].slice(0, 30) || 'お知らせ'; });
}
load();

/* ---------- 小さな道具 ---------- */
const token = () => crypto.randomBytes(24).toString('hex');
const id = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const ICON_DIR = path.join(DATA_DIR, 'icons');
const iconFile = (pid) => path.join(ICON_DIR, String(pid).replace(/[^0-9a-z]/g, '') + '.img');
function sniffIcon(buf) {
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  return null;
}
// Xのアカウント: 「@id」「id」「https://x.com/id」「https://twitter.com/id」を受け付け、https://x.com/id にそろえる
function normX(v) {
  v = clean(v, 120); if (!v) return '';
  let h = v;
  const m = v.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?:[\/?#].*)?$/i);
  if (m) h = m[1]; else h = v.replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) return null;
  return 'https://x.com/' + h;
}
const iconAt = (u) => (u && u.icon ? u.icon.at : 0);
const https = require('https');
let wxBusy = false, wxTry = 0;
// 東京・大阪・名古屋・福岡の天気予報(Open-Meteo・無料・キー不要)を、1日1回だけ確認する
function ensureWeather(day) {
  db.weather = db.weather || {};
  if (db.weather[day] !== undefined || wxBusy || Date.now() - wxTry < 600000) return;
  wxBusy = true; wxTry = Date.now();
  const u = 'https://api.open-meteo.com/v1/forecast?latitude=35.69,34.69,35.18,33.59&longitude=139.69,135.50,136.91,130.40&daily=weather_code&timezone=Asia%2FTokyo&forecast_days=1';
  try {
    const rq = https.get(u, { timeout: 8000 }, (r) => {
      let b = ''; r.on('data', (d) => { b += d; if (b.length > 200000) r.destroy(); });
      r.on('end', () => {
        wxBusy = false;
        try {
          const j = JSON.parse(b), arr = Array.isArray(j) ? j : [j];
          if (arr.length === 4 && arr.every((x) => x && x.daily && Array.isArray(x.daily.weather_code))) {
            db.weather[day] = arr.every((x) => x.daily.weather_code[0] <= 1);
            Object.keys(db.weather).sort().slice(0, -400).forEach((k) => delete db.weather[k]);
            save(true);
          }
        } catch (e) { /* */ }
      });
      r.on('close', () => { wxBusy = false; });
    });
    rq.on('timeout', () => rq.destroy()); rq.on('error', () => { wxBusy = false; });
  } catch (e) { wxBusy = false; }
}
const BANNER_DEFAULT = '現在、サイトのアップデート中です。つながりにくくなったときは、しばらく待ってから、ページを再読み込み(リロード)してください。';
const ctr = (pid) => (db.counters[pid] = db.counters[pid] || {});
const bump = (pid, k, n = 1) => { const c = ctr(pid); c[k] = (c[k] || 0) + n; };
const jstDay = (t) => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
const luckyTime = (pid) => { const d = new Date(Date.now() + 9 * 3600000); if (d.getUTCHours() === d.getUTCMinutes()) bump(pid, 'zorome'); };
const BURST = {}, SEEN = {}, ONLINE_MS = 75000;
const isOn = (pid) => SEEN[pid] && Date.now() - SEEN[pid] < ONLINE_MS;
const isAdminPerson = (pid) => db.admins.some((a) => a.pid === pid);
// 称号の獲得数・玉座・獲得数の表示から除く、運営本人(taetaeのみ)
const canSeeT = (d, pid) => !d.hidden || (d.id === 'owner' ? isOwner(pid) : isAdminPerson(pid)); // 隠し称号は、持ち主(権力者=管理者全員、サイト管理者=taetaeのみ)にだけ見える
const isOwner = (pid) => db.admins.some((a) => a.pid === pid && String(a.name).toLowerCase() === 'taetae');
function rankCount(pid) {
  const sk = {}; db.songs.forEach((s) => { sk[s.id] = s.key; });
  const ks = new Set(); Object.keys(db.scores[pid] || {}).forEach((sid) => { if (sk[sid]) ks.add(sk[sid]); });
  return ks.size;
}
// 称号: ランキング参加数(1曲でも採点したランキングの数)で決まる
function titleOf(n) {
  if (n < 1) return '';
  if (n <= 5) return '駆け出しParty Ranker';
  if (n <= 10) return '中級Party Ranker';
  if (n <= 20) return '上級Party Ranker';
  if (n <= 30) return 'キングParty Ranker';
  return 'Party Rankの神';
}
const cleanBio = (v) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 200);
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const isScore = (v) => typeof v === 'number' && v >= 0 && v <= 10 && Math.round(v * 2) === v * 2;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const courOf = (key) => key.split('-').slice(0, 2).join('-');
const labelOf = (key) => {
  const p = key.split('-');
  return p[0] + '年' + COURS[p[1]] + (p[2] || '');
};
const songOrder = (a, b) => (a.ord != null ? a.ord : a.at) - (b.ord != null ? b.ord : b.at) || a.at - b.at;
const validKey = (k) => /^\d{4}-(1|4|7|10)-/.test(k) && KINDS.includes(String(k).split('-')[2]);

const PRIVATE_ADDR = /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|f[cd][0-9a-f]{2}:|::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/i;
// アクセス元のIP。Renderなどの中継(プロキシ)の内側からの接続のときだけ、X-Forwarded-For を信用する
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  if (TRUST_PROXY || PRIVATE_ADDR.test(remote)) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f.slice(0, 64);
  }
  return remote;
}
const hits = new Map();
function limited(req, bucket, max, ms) {
  const ip = clientIp(req);
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

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > (limit || 65536)) { reject(new HttpError(413, '送信データが大きすぎます')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const o = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(o && typeof o === 'object' ? o : {}); }
      catch (e) { reject(bad('JSONの形式が正しくありません')); }
    });
    req.on('error', reject);
  });
}
const wantsGzip = (res) => /\bgzip\b/.test(String((res.req && res.req.headers['accept-encoding']) || ''));
function send(res, code, body, headers) {
  const isStr = typeof body === 'string', isBuf = Buffer.isBuffer(body);
  const h = Object.assign({ 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers);
  let out = isStr || isBuf ? body : JSON.stringify(body);
  // 大きなデータ(JSON・文字)は圧縮して、スマホの回線でも速く届くようにする(画像は対象外)
  if (!isBuf && out.length > 1024 && wantsGzip(res)) { out = zlib.gzipSync(out); h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding'; }
  res.writeHead(code, h);
  res.end(out);
}
const bearer = (req) => (String(req.headers.authorization || '').match(/^Bearer ([0-9a-f]{48})$/) || [])[1] || '';

function person(req) {
  const t = bearer(req);
  const p = t && db.people.find((x) => x.token === t);
  if (!p) throw new HttpError(401, '名前を入力して参加してください');
  const now = Date.now(), b = (BURST[p.id] = (BURST[p.id] || []).filter((t0) => now - t0 < 60000)); b.push(now);
  if (b.length >= 30) { const c = ctr(p.id); if (!c.burst) { c.burst = 1; save(); } }
  return p;
}
function admin(req) {
  const t = bearer(req);
  const s = t && db.sessions[t];
  if (!s || s.exp < Date.now()) { if (s) { delete db.sessions[t]; save(); } throw new HttpError(401, '管理者としてログインしてください'); }
  return s;
}

/* ---------- 集計(管理者の全体表・動画用データ) ---------- */
function candOf(key) {
  const ids = new Set(db.songs.filter((s) => s.key === key).map((s) => s.id)), ex = db.texc[key] || [];
  return db.people.filter((p) => Object.keys(db.scores[p.id] || {}).some((sid) => ids.has(sid))).sort((a, b) => a.name.localeCompare(b.name, 'ja')).map((p) => ({ id: p.id, name: p.name, on: !ex.includes(p.id) }));
}
function adminTbl(key) { return Object.assign({}, buildTable(key), { cand: candOf(key) }); }
function buildTable(key) {
  const songs = db.songs.filter((s) => s.key === key).sort(songOrder);
  const ids = new Set(songs.map((s) => s.id));
  const cour = courOf(key);
  const people = db.people
    .filter((p) => Object.keys(db.scores[p.id] || {}).some((sid) => ids.has(sid)) && !(db.texc[key] || []).includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  // 管理者が決めた並び順(決めていない人は、名前順で後ろに続く)
  const ord = db.torder[key] || [];
  if (ord.length) { const ix = (p) => { const i = ord.indexOf(p.id); return i < 0 ? 1e9 : i; }; people.sort((a, b) => ix(a) - ix(b)); }
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
  const userGreen = {}, userRed = {}; people.forEach((p) => { userGreen[p.id] = 0; userRed[p.id] = 0; });
  rows.forEach((r) => {
    const vs = Object.values(r.scores); if (vs.length < 2) return;
    const mx = Math.max(...vs), mn = Math.min(...vs); if (mx === mn) return;
    people.forEach((p) => { if (r.scores[p.id] === mx) userGreen[p.id]++; else if (r.scores[p.id] === mn) userRed[p.id]++; });
  });
  return { key, label: labelOf(key), cour, userGreen, userRed, people: people.map((p) => ({ id: p.id, name: p.name, ic: iconAt(p) })), rows, userAvg, overallAvg: mean(all), starTitles };
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
    rows.push(['', 'Greenの数', '', '', '', '', ''].concat(t.people.map((p) => t.userGreen[p.id] || 0)));
    rows.push(['', 'Redの数', '', '', '', '', ''].concat(t.people.map((p) => t.userRed[p.id] || 0)));
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
    icons: t.people.reduce((o, p) => { const pu = db.people.find((x) => x.id === p.id); if (pu && pu.icon) { try { o[p.name] = 'data:image/' + (pu.icon.ext === 'jpeg' ? 'jpeg' : 'png') + ';base64,' + fs.readFileSync(iconFile(p.id)).toString('base64'); } catch (e) { /* なし */ } } return o; }, {}),
  };
}
/* モード: video があれば watch(全体表を公開)、rank が true なら rank(開催中)、どちらも無ければ entry */
function modeOf(key) {
  const m = db.modes[key] || {};
  return m.video ? 'watch' : m.tally ? 'tally' : m.rank ? 'rank' : 'entry';
}
function publicModes() {
  const out = {};
  Object.keys(db.modes).forEach((k) => { const m = db.modes[k] || {}; out[k] = { mode: modeOf(k), video: m.video || '' }; });
  return out;
}
// 集計中・Party Watch中は、点数・☆・ひとこと・予想を変えられない
const frozen = (key) => { const md = modeOf(key); return md === 'tally' || md === 'watch'; };
function allKeys() { return [...new Set(db.songs.map((s) => s.key))]; }


/* ---------- 称号・予想ゲーム・相性 ---------- */
const TITLE_DEFS = [
  { id: 'rank1', name: '駆け出しParty Ranker', desc: 'ランキング参加数が1〜5(参加数が1以上)' },
  { id: 'rank2', name: '中級Party Ranker', desc: 'ランキング参加数が6〜10(6以上)' },
  { id: 'rank3', name: '上級Party Ranker', desc: 'ランキング参加数が11〜20(11以上)' },
  { id: 'rank4', name: 'キングParty Ranker', desc: 'ランキング参加数が21〜30(21以上)' },
  { id: 'rank5', name: 'Party Rankの神', desc: 'ランキング参加数が31以上' },
  { id: 'sweet', name: '甘口審査員', desc: '1つのランキングで全曲を採点し、自分の平均点が7.50点以上だった' },
  { id: 'lucky7', name: 'ラッキーセブン', desc: '1つのランキングで、7.0点と7.5点を合わせて30曲以上につけた' },
  { id: 'gyaku', name: '逆張り王子', desc: '自分が☆をつけた曲が、ランキングのワースト10に入った' },
  { id: 'yari', name: '一番槍', desc: 'Party Rankモードになってから、そのランキングの全曲を最も早く採点した' },
  { id: 'stairs', name: '階段', desc: '1つのランキングで、0.0〜10.0のすべての点数(0.5点刻み)を使った' },
  { id: 'star1', name: '一番星', desc: '自分が☆をつけた曲が、ランキング1位になった' },
  { id: 'cmleader', name: 'コメントリーダー', desc: '1つのランキングのすべての曲に、ひとことを書いた' },
  { id: 'gyakushin', name: '逆神', desc: '自分のトップ3が、そのまま全体のワースト3になった' },
  { id: 'manba', name: '万馬券', desc: '予想ゲームで、トップ3を順番まで完全に当てた(三連単)' },
  { id: 'kadai', name: '過大評価?', desc: '1つのランキングで全曲を採点し、自分の平均点が全体の平均点より2.0点以上高かった' },
  { id: 'sliding', name: '滑り込みセーフ', desc: '全曲の採点を終えたのが、提出期限の1時間前以降だった' },
  { id: 'silent', name: 'サイレントマジョリティ', desc: '全曲を採点し、平均点が全体平均の±0.3点以内で、ひとことを一切書かなかった' },
  { id: 'intruder', name: '不法侵入者', desc: '管理者に登録されていない名前で、管理者ログインを試みた' },
  { id: 'viewer', name: '視聴者', desc: '過去のParty Rankの動画リンクを5回開いた' },
  { id: 'resonance', name: '共鳴者', desc: '公開済みのランキングで、ほかのユーザーと点数のつけ方が90%以上一致した(共通の10曲以上)' },
  { id: 'camera', name: 'カメラマン', desc: 'ランキング画像(自分・全体)を合計5回以上保存した' },
  { id: 'constellation', name: '星座になれたら', desc: '1つのランキングで、1曲に3人以上が☆をつけ、その一員だった' },
  { id: 'zero', name: 'ミスターゼロ', desc: '1つのランキングで、0.0点を3曲以上につけた' },
  { id: 'collector', name: '称号コレクター', desc: '称号を合計20個獲得した' },
  { id: 'gunshi', name: '軍師', desc: '全曲を採点し、自分のランキングが全体ランキングとほぼ完全に一致した(順位相関0.95以上・10曲以上)' },
  { id: 'honor', name: '優等生', desc: 'プロフィールの自己紹介文を100文字以上書いた' },
  { id: 'love', name: '愛を語る者', desc: '1つの曲に、90文字以上のひとことを残した' },
  { id: 'isekai', name: 'なろう系', desc: 'アニメタイトルに「異世界」「転生」を含む曲に、8.0点以上を3回つけた' },
  { id: 'creator', name: '創造神', desc: '自分の10.0点で、ある曲の全体平均点を1.0点以上引き上げた' },
  { id: 'destroyer', name: '破壊神', desc: '自分の0.0点で、ある曲の全体平均点を1.0点以上引き下げた' },
  { id: 'ten', name: 'ベタ褒め', desc: '1つのランキングで、10.0点を3曲以上につけた' },
  { id: 'harsh', name: '辛口審査員', desc: '1つのランキングで全曲を採点し、自分の平均点が4.00点以下だった' },
  { id: 'steady', name: '安定志向', desc: '10曲以上のランキングで全曲を採点し、最高点と最低点の差が2.0点以内だった' },
  { id: 'extreme', name: '両極端', desc: '1つのランキングで、0.0点と10.0点の両方をつけた' },
  { id: 'marathon', name: 'マラソンランナー', desc: '20曲以上あるランキングの、全曲を採点した' },
  { id: 'oshi', name: '推し活', desc: '自分が☆をつけた曲に、10.0点をつけた' },
  { id: 'eye', name: '目利き', desc: '自分が☆をつけた曲が、ランキングのトップ3に入った' },
  { id: 'cmmaster', name: 'ひとこと職人', desc: 'ひとことを、合計50件以上書いた' },
  { id: 'popular', name: '人気者', desc: '自分のひとことに、ほかのユーザーから合計10個以上のリアクションがついた' },
  { id: 'ambassador', name: 'リアクション大使', desc: 'ひとことへのリアクションを、合計30回以上送った' },
  { id: 'detective', name: '名探偵', desc: '予想ゲームで、12点以上を取った' },
  { id: 'mine', name: '地雷探知機', desc: '予想ゲームで、ワースト3を順番まで完全に当てた' },
  { id: 'early', name: '早起き', desc: '朝5時から8時(日本時間)の間に、点数を10回つけた' },
  { id: 'night', name: '夜更かし', desc: '深夜0時〜5時(日本時間)に、10回以上点数をつけた' },
  { id: 'soulmate', name: 'ソウルメイト', desc: '公開済みのランキングで、ほかのユーザーと点数のつけ方が99%以上一致した(共通の10曲以上)' },
  { id: 'loner', name: '孤高の存在', desc: '共通の曲が10曲以上ある3人以上の全員と、点数のつけ方の一致度が60%未満だった' },
  { id: 'contrary', name: '天邪鬼', desc: '1つのランキングで全曲を採点し、各曲の全体平均との差が、平均して2.0点以上あった' },
  { id: 'founder', name: '古参', desc: 'サイトに登録した順で、10番目までに入っていた' },
  { id: 'champion', name: '推しが優勝', desc: '自分が1曲だけ最高点をつけた曲が、そのまま全体1位になった' },
  // ---- 依頼の7個 ----
  { id: 'power', name: '権力者', desc: '管理者(運営)だけがもつ称号', hidden: true },
  { id: 'owner', name: 'サイト管理者', desc: 'サイトの運営者(taetae)だけがもつ称号', hidden: true },
  { id: 'pr', name: '広報担当', desc: 'このサイトへの招待(共有やコピー)を行った' },
  { id: 'missionary', name: '宣教師', desc: 'このサイトへの招待(共有やコピー)を5回行った' },
  { id: 'reporter', name: '記者', desc: 'お知らせのリンクを10回以上開いた' },
  { id: 'indecisive', name: '優柔不断', desc: '1つの曲の点数を、5回以上変更した' },
  { id: 'resident', name: 'サイトの住人', desc: 'サイトの滞在時間が、合計10時間を超えた' },
  { id: 'f5', name: '最前管理', desc: 'ページの再読み込み(F5)を、10秒以内に5回連打した' },
  { id: 'roster', name: '名簿の愛読者', desc: '参加者一覧のページを、20回以上開いた' },
  // ---- サイト愛 ----
  { id: 'loginbonus', name: 'ログインボーナス', desc: '3日連続でサイトに来た' },
  { id: 'weekly', name: '週間皆勤', desc: '7日連続でサイトに来た' },
  { id: 'regular', name: '常連', desc: 'サイトに来た日が、通算15日以上になった' },
  { id: 'veteran', name: '超常連', desc: 'サイトに来た日が、通算30日以上になった' },
  { id: 'iconmaker', name: 'アイコン職人', desc: 'アイコンを3回以上設定した' },
  { id: 'renamer', name: '改名マニア', desc: 'ユーザー名を3回以上変更した' },
  { id: 'reviser', name: '推敲の鬼', desc: 'プロフィールの自己紹介を、5回以上書き換えた' },
  { id: 'linked', name: 'つながる人', desc: 'プロフィールにXのリンクを設定した' },
  { id: 'dresser', name: '着せ替え名人', desc: '称号の装備を、5回以上変更した' },
  { id: 'hunter', name: '称号ハンター', desc: '称号を10個獲得した' },
  { id: 'tking', name: '称号の王様', desc: '称号を50個獲得した' },
  { id: 'explorer', name: 'メニュー探検家', desc: 'メニューの主なページ(Party Rankとは・お知らせ・友だちを招待・過去のParty Rank・参加者一覧・プロフィール・称号コレクション・予想ゲーム・相性診断)を、すべて開いた' },
  { id: 'historian', name: '歴史家', desc: '「過去のParty Rank」を10回以上開いた' },
  { id: 'manual', name: '説明書の虫', desc: '「Party Rankとは」を3回以上開いた' },
  { id: 'compatfan', name: '相性マニア', desc: '「相性診断」を10回以上開いた' },
  { id: 'neighbor', name: 'ご近所づきあい', desc: '10人以上の、ほかのユーザーのプロフィールを見た' },
  { id: 'follower', name: 'フォロワー', desc: 'ほかのユーザーや運営のXリンクを、5回以上開いた' },
  { id: 'photog', name: 'フォトグラファー', desc: 'ランキング画像を20回以上保存した' },
  { id: 'master', name: 'サイトの主', desc: 'サイトの滞在時間が、合計100時間を超えた' },
  { id: 'watcher', name: '本編視聴者', desc: '公開されたランキング動画のリンクを、3回以上開いた' },
  // ---- ランキング ----
  { id: 'kind', name: '優しい世界', desc: '1つのランキングで全曲を採点し、すべての曲に5.0点以上をつけた' },
  { id: 'ice', name: '氷河期', desc: '1つのランキングで全曲を採点し、すべての曲に5.0点以下をつけた' },
  { id: 'dompisha', name: 'ドンピシャ', desc: '1つのランキングで、自分の点数と曲の全体平均の差が0.1点以内だった曲が、5曲以上あった' },
  { id: 'heretic', name: '異端児', desc: '1つのランキングで、自分の点数と曲の全体平均の差が3.0点以上だった曲が、3曲以上あった' },
  { id: 'half', name: '半点職人', desc: '1つのランキングで、x.5点(0.5点刻み)を15曲以上につけた' },
  { id: 'round', name: 'キリ番主義', desc: '10曲以上のランキングで全曲を採点し、すべて整数の点数にした' },
  { id: 'tasty', name: '全部おいしい', desc: '1つのランキングで全曲を採点し、すべての曲に7.0点以上をつけた' },
  { id: 'mvp', name: '1位の立役者', desc: '全体1位になった曲に、10.0点をつけた' },
  { id: 'lastlove', name: '最下位にも愛を', desc: '全体最下位になった曲に、8.0点以上をつけた' },
  { id: 'podium', name: '表彰台コンプ', desc: '全体トップ3の3曲すべてに、8.0点以上をつけた' },
  { id: 'prophet', name: '予言者', desc: '6曲以上採点し、自分のトップ3が、全体のトップ3とまったく同じ3曲だった' },
  { id: 'oneway', name: 'ワンパターン', desc: '10曲以上のランキングで全曲を採点し、半分以上の曲に同じ点数をつけた' },
  { id: 'variety', name: '点数のバラエティ', desc: '1つのランキングで、15種類以上の違う点数を使った' },
  { id: 'avgbody', name: '平均点の化身', desc: '全曲を採点し、自分の平均点が全体平均と0.05点以内だった' },
  { id: 'regular5', name: '完走常連', desc: '5つ以上のランキングで、全曲を採点した' },
  { id: 'iron', name: '鉄人', desc: '10以上のランキングで、全曲を採点した' },
  { id: 'attend', name: '皆勤賞', desc: '公開・集計済みのランキング(3つ以上)すべてで、全曲を採点した' },
  { id: 'combo', name: 'フルコンボ', desc: '1つのランキングで、全曲の採点・全曲のひとこと・☆・予想ゲームを、すべて行った' },
  { id: 'traveler', name: '300曲の旅人', desc: '採点した曲が、通算300曲を超えた' },
  // ---- デバッグ ----
  { id: 'bughunter', name: 'バグハンター', desc: '通信の不具合に遭遇しながらも、点数などの保存をやり遂げた' },
  { id: 'debugger', name: 'デバッガー', desc: '集計中(または公開済み)の入力を、サーバーに送ろうとした(拒否されました)' },
  { id: 'boundary', name: '境界値テスター', desc: 'ひとことをちょうど100文字、自己紹介をちょうど200文字書いた' },
  // ---- 第4弾 ----
  { id: 'funeoriro', name: '船降りろ', desc: '1つのランキング(3人以上が全曲採点)で、自分の平均点が参加者の中でいちばん低かった' },
  { id: 'lost', name: '404の旅人', desc: '存在しないページのアドレスを開いた' },
  { id: 'maxname', name: '限界ネーム', desc: 'ちょうど30文字のユーザー名にした' },
  { id: 'burst', name: 'ストレステスト', desc: '1分以内に、サイトを30回以上操作した' },
  { id: 'dawn', name: '午前3時のデバッグ', desc: '午前3時台(日本時間)にサイトを開いた' },
  { id: 'resizer', name: 'ウィンドウ伸縮マニア', desc: '画面(ウィンドウ)の大きさを、30回以上変えた' },
  { id: 'devtools', name: '検証者', desc: '開発者ツール(F12など)を開こうとした' },
  { id: 'offline', name: '圏外の住人', desc: '通信が切れた状態から、復帰した' },
  { id: 'relog', name: '再起動したら直った', desc: 'ログアウトして、1分以内にログインし直した' },
  { id: 'infloop', name: '無限ループ', desc: '1つの曲の点数を、20回以上変更した' },
  { id: 'qa', name: '品質保証', desc: 'デバッグ系の称号(バグハンター・デバッガー・境界値テスター・404の旅人・限界ネーム・ストレステスト・午前3時のデバッグ・ウィンドウ伸縮マニア・検証者・圏外の住人・再起動したら直った・無限ループ・画面くるくる・配色チェンジ・拡大鏡・全選択・リロード職人・連打の達人・右クリッカー・紙派・ソース閲覧者・浮気性)を、すべて獲得した' },
  { id: 'halloween', name: 'トリックオアトリート', desc: '10月31日(日本時間)にサイトに来た' },
  { id: 'xmas', name: 'メリークリスマス', desc: '12月25日(日本時間)にサイトに来た' },
  { id: 'newyear', name: 'あけましておめでとう', desc: '1月1日(日本時間)にサイトに来た' },
  { id: 'tanabata', name: '七夕の願い', desc: '7月7日(日本時間)にサイトに来た' },
  { id: 'pocky', name: 'ポッキーの日', desc: '11月11日(日本時間)にサイトに来た' },
  { id: 'zorome', name: 'ゾロ目の奇跡', desc: '「11:11」「22:22」のように、時と分が同じ時刻に、点数かひとことを入力した(日本時間)' },
  { id: 'kaibun', name: '回文職人', desc: '3文字以上の回文(上から読んでも下から読んでも同じ)のひとことを書いた' },
  { id: 'lucky77', name: 'スリーセブン', desc: 'ちょうど77文字のひとことを書いた' },
  { id: 'pittari', name: 'ぴったり賞', desc: '10曲以上のランキングで全曲を採点し、点数の合計がちょうど100の倍数だった' },
  // ---- 第6弾 ----
  { id: 'bake', name: '化けそうなココロ', desc: '自分が☆をつけた曲が、3人以上が採点して平均8.286点を超えた' },
  { id: 'tansho', name: '単勝', desc: '予想ゲームで、トップ1(全体1位)を当てた(公開後に判定)' },
  { id: 'akumei', name: '悪名は無名に勝る', desc: '予想ゲームで、ワースト1(全体最下位)を当てた(公開後に判定)' },
  { id: 'apple', name: 'りんごの遣い手', desc: 'Apple Musicのプレイリストのリンクを、クリックした' },
  { id: 'meteor', name: '流星', desc: '☆を、5回以上つけ替えた' },
  { id: 'selfanalysis', name: '自己分析', desc: '「マイ統計」を見た' },
  { id: 'secguard', name: 'セキュリティガード', desc: '合言葉(パスワード)を、設定または再設定した' },
  { id: 'comma', name: 'カンマセパレーター', desc: 'ランキングや自分の点数を、CSVで保存した' },
  { id: 'zerozero', name: '全外し', desc: '予想ゲームで、0点を獲得した(公開後に判定)' },
  { id: 'idle', name: '寝た?', desc: 'サイトを開いたまま、1時間なにも操作せずに放置した' },
  { id: 'shobu', name: '勝負師', desc: '集計中に、予想ゲームを提出した' },
  { id: 'rotate', name: '画面くるくる', desc: 'スマホなどの画面を、縦横に回転させた' },
  { id: 'themechg', name: '配色チェンジ', desc: 'ダークモードとライトモードが切り替わった(端末の設定の変更)' },
  { id: 'zoom', name: '拡大鏡', desc: '画面を拡大・縮小した(ピンチやCtrl+プラス・マイナス)' },
  { id: 'allsel', name: '全選択', desc: 'Ctrl+A(Macは⌘+A)で、全選択をした' },
  { id: 'reloader', name: 'リロード職人', desc: 'ページの再読み込みを、累計20回行った' },
  { id: 'hanki', name: '反逆の一票', desc: '全曲を採点した6曲以上のランキングで、全体1位の曲に、自分の最低点(5.0点以下)をつけた' },
  { id: 'lonely', name: '孤高の辛口', desc: '全曲を採点した10曲以上のランキングで、すべての曲を、全体の平均より低い点にした(3人以上が採点した曲)' },
  { id: 'flatter', name: 'ご機嫌取り', desc: '全曲を採点した10曲以上のランキングで、すべての曲を、全体の平均より高い点にした(3人以上が採点した曲)' },
  { id: 'savior', name: '底辺の救世主', desc: '6曲以上のランキングで、全体最下位の曲に、9.0点以上をつけた' },
  { id: 'bias', name: '独断と偏見', desc: '1つのランキングで、全体の平均と5点以上離れた点を、3曲以上につけた(3人以上が採点した曲)' },
  { id: 'mash', name: '連打の達人', desc: '1秒以内に、画面を10回以上クリックした' },
  { id: 'rclick', name: '右クリッカー', desc: 'サイトの上で、右クリック(長押しメニュー)を開いた' },
  { id: 'print', name: '紙派', desc: '印刷の画面を開いた(Ctrl+Pなど)' },
  { id: 'viewsrc', name: 'ソース閲覧者', desc: 'ページのソースを表示しようとした(Ctrl+U)' },
  { id: 'tabhop', name: '浮気性', desc: '1回の訪問で、ほかのタブやアプリに10回以上切り替えた' },
  // ---- 第5弾 ----
  { id: 'tenzero', name: '天国と地獄', desc: '1つのランキングで、0点と10点を、それぞれ5曲以上につけた' },
  { id: 'reisen', name: '冷戦', desc: '1つのランキングで、0点か0.5点を、合わせて10曲以上につけた' },
  { id: 'ladder', name: '右肩上がり', desc: '5曲以上のランキングで全曲を採点し、曲リストの上から順に点数が下がらず、最初より最後が2点以上高かった(順に上がっていった)' },
  { id: 'descent', name: '右肩下がり', desc: '5曲以上のランキングで全曲を採点し、曲リストの上から順に点数が上がらず、最初より最後が2点以上低かった(順に下がっていった)' },
  { id: 'ichimai', name: '推しの一点豪華', desc: '10曲以上のランキングで全曲を採点し、10点が1曲だけ、ほかの曲はすべて6.0点以下だった' },
  { id: 'sniper', name: '狙撃手', desc: '全曲を採点し、自分が最高点をつけた曲(1曲だけ)が全体1位、最低点をつけた曲(1曲だけ)が全体最下位だった' },
  { id: 'tragic', name: '悲劇の推し', desc: '10曲以上のランキングで全曲を採点し、自分が9.0点以上をつけた曲(最高点で1曲だけ)が、全体の最下位だった' },
  { id: 'manjo', name: '満場一致', desc: '3人以上が採点した曲のうち、採点した全員が8.0点以上をつけた曲に、自分も8.0点以上をつけたものが3曲以上あった' },
  { id: 'midpoint', name: 'ちょうど真ん中', desc: '5曲以上のランキングで全曲を採点し、自分の平均点がちょうど5.00点だった' },
  { id: 'jackpot', name: 'ジャックポット', desc: '10曲以上のランキングで全曲を採点し、点数の合計がちょうど777点だった' },
  { id: 'nito', name: '二刀流', desc: '同じクールの、2種類以上の区分(OP・EDなど)で、全曲を採点した' },
  { id: 'goren', name: '五連覇', desc: '同じ区分(OPなど)で、5クール連続して全曲を採点した' },
  { id: 'shiki', name: '四季折々', desc: '同じ年の、冬・春・夏・秋の4クールすべてで、全曲を採点した(区分は問いません)' },
  { id: 'rensen', name: '連戦連勝', desc: '同じ区分(OPなど)で、3クール連続して全曲を採点した' },
  { id: 'ping', name: '疎通確認', desc: 'キーボードで「ping」と入力した(入力欄の外で)' },
  { id: 'traceroute', name: '経路を辿る者', desc: 'キーボードで「traceroute」と入力した(入力欄の外で)' },
  { id: 'whoami', name: '我、何者?', desc: 'キーボードで「whoami」と入力した(入力欄の外で)' },
  { id: 'rmrf', name: '禁断のコマンド', desc: 'キーボードで「rm -rf /」と入力した(入力欄の外で。実際には何も消えません)' },
  { id: 'typeparty', name: 'パーティー開始', desc: 'キーボードで「party」と入力した(入力欄の外で)' },
  { id: 'typeanison', name: 'アニソン好き', desc: 'キーボードで「anison」と入力した(入力欄の外で)' },
  { id: 'sudo', name: 'スーパーユーザー', desc: 'キーボードで「sudo」と入力した(入力欄の外で)' },
  { id: 'gg', name: 'グッドゲーム', desc: 'キーボードで「gg」と入力した(入力欄の外で)' },
  { id: 'calltaiga', name: '運営を呼んだ', desc: 'キーボードで「taetae」と入力した(入力欄の外で)' },
  { id: 'logo7', name: 'ロゴ連打', desc: '画面左上のロゴを、7回すばやく連続でタップした' },
  { id: 'logohold', name: 'ロゴ長押し', desc: '画面左上のロゴを、3秒以上長押しした' },
  { id: 'ctrls', name: '保存魔', desc: 'Ctrl+S(Macは⌘+S)を押した' },
  { id: 'esc5', name: 'エスケープ', desc: 'Escキーを5回連続で押した' },
  { id: 'tab20', name: 'タブ職人', desc: 'Tabキーを、10秒以内に20回押した' },
  { id: 'allcmd', name: 'コマンドマスター', desc: '他のコマンド系の称号14個を、すべて獲得した' },
];
const TITLE_CATS = [["rankp", "参加ランク"], ["score", "採点のくせ"], ["result", "順位・結果"], ["join", "参加・継続"], ["long", "長期・時間帯"], ["comm", "ひとこと・交流"], ["site", "サイト愛"], ["op", "サイト操作"], ["tease", "煽り"], ["lucky", "たまたま"], ["debug", "デバッグ"], ["cmd", "コマンド"], ["staff", "コレクション・特別"]];
const TITLE_META = {"rank1": ["rankp", 1], "rank2": ["rankp", 2], "rank3": ["rankp", 3], "rank4": ["rankp", 3], "rank5": ["rankp", 5], "sweet": ["score", 1], "harsh": ["score", 1], "lucky7": ["score", 2], "gyaku": ["score", 2], "zero": ["score", 2], "steady": ["score", 2], "extreme": ["score", 2], "ten": ["score", 2], "contrary": ["score", 2], "kind": ["score", 2], "ice": ["score", 2], "dompisha": ["score", 2], "heretic": ["score", 2], "half": ["score", 2], "tasty": ["score", 2], "oneway": ["score", 2], "eye": ["score", 2], "kadai": ["score", 2], "silent": ["score", 2], "isekai": ["score", 2], "ichimai": ["score", 2], "indecisive": ["score", 2], "stairs": ["score", 3], "round": ["score", 3], "variety": ["score", 3], "avgbody": ["score", 3], "gunshi": ["score", 3], "tenzero": ["score", 3], "ladder": ["score", 3], "descent": ["score", 3], "reisen": ["score", 4], "midpoint": ["score", 5], "sliding": ["result", 2], "star1": ["result", 2], "mine": ["result", 2], "early": ["score", 2], "night": ["score", 2], "lastlove": ["result", 2], "tragic": ["result", 4], "manjo": ["result", 2], "oshi": ["result", 2], "funeoriro": ["result", 2], "yari": ["result", 3], "constellation": ["result", 4], "gyakushin": ["result", 3], "manba": ["result", 3], "creator": ["result", 3], "destroyer": ["result", 3], "champion": ["result", 3], "detective": ["result", 3], "mvp": ["result", 3], "podium": ["result", 3], "sniper": ["result", 3], "prophet": ["result", 5], "marathon": ["join", 1], "regular5": ["join", 2], "nito": ["join", 2], "iron": ["join", 3], "rensen": ["join", 3], "attend": ["join", 5], "combo": ["join", 4], "traveler": ["join", 4], "goren": ["join", 4], "shiki": ["join", 4], "honor": ["comm", 1], "follower": ["comm", 1], "linked": ["comm", 1], "cmleader": ["comm", 3], "love": ["comm", 2], "resonance": ["comm", 2], "compatfan": ["comm", 2], "neighbor": ["comm", 2], "cmmaster": ["comm", 3], "popular": ["comm", 3], "ambassador": ["comm", 3], "soulmate": ["comm", 3], "loner": ["comm", 3], "pr": ["site", 1], "loginbonus": ["site", 1], "manual": ["site", 1], "iconmaker": ["site", 1], "viewer": ["site", 1], "camera": ["site", 2], "reporter": ["site", 2], "roster": ["site", 2], "weekly": ["site", 2], "regular": ["site", 2], "renamer": ["site", 2], "reviser": ["site", 2], "dresser": ["site", 2], "historian": ["site", 2], "photog": ["site", 3], "watcher": ["site", 2], "missionary": ["site", 3], "resident": ["site", 3], "veteran": ["site", 3], "explorer": ["site", 3], "master": ["site", 4], "debugger": ["debug", 1], "lost": ["debug", 1], "devtools": ["debug", 1], "bughunter": ["debug", 2], "maxname": ["debug", 2], "burst": ["debug", 2], "dawn": ["debug", 1], "resizer": ["debug", 2], "offline": ["debug", 2], "relog": ["debug", 2], "f5": ["debug", 2], "intruder": ["debug", 2], "boundary": ["debug", 5], "infloop": ["debug", 5], "qa": ["debug", 5], "halloween": ["lucky", 2], "xmas": ["lucky", 2], "newyear": ["lucky", 2], "tanabata": ["lucky", 2], "pocky": ["lucky", 2], "zorome": ["lucky", 3], "kaibun": ["lucky", 3], "lucky77": ["lucky", 3], "pittari": ["lucky", 3], "jackpot": ["lucky", 5], "gg": ["cmd", 1], "logo7": ["cmd", 1], "ctrls": ["cmd", 1], "esc5": ["cmd", 1], "whoami": ["cmd", 2], "rmrf": ["cmd", 5], "typeparty": ["cmd", 2], "typeanison": ["cmd", 2], "sudo": ["cmd", 3], "calltaiga": ["cmd", 2], "logohold": ["cmd", 2], "tab20": ["cmd", 2], "ping": ["cmd", 3], "traceroute": ["cmd", 3], "allcmd": ["cmd", 4], "hunter": ["staff", 2], "collector": ["staff", 3], "founder": ["staff", 3], "tking": ["staff", 4], "power": ["staff", 4], "bake": ["result", 5], "tansho": ["result", 2], "akumei": ["result", 2], "apple": ["site", 1], "meteor": ["site", 3], "selfanalysis": ["site", 1], "secguard": ["site", 1], "comma": ["site", 2], "zerozero": ["result", 2], "idle": ["site", 2], "shobu": ["result", 3], "rotate": ["debug", 1], "themechg": ["debug", 2], "zoom": ["debug", 1], "allsel": ["debug", 1], "reloader": ["debug", 2], "lonely": ["tease", 3], "flatter": ["tease", 3], "savior": ["tease", 2], "bias": ["tease", 2], "mash": ["debug", 2], "rclick": ["debug", 1], "print": ["debug", 2], "viewsrc": ["debug", 2], "tabhop": ["debug", 2], "hanki": ["tease", 3], "owner": ["staff", 5]};
// ---- 追加称号(隠しコマンド・サイト操作・長期/時間帯) ----
const EXTRA = (() => {
  // 追加称号(隠しコマンド・サイト操作・長期/時間帯)。rule の種類は server.js の判定部分と app.js の生成部分で使う。
  const X = [];
  const T = (id, name, icon, cat, lv, desc, rule) => X.push({ id, name, icon, cat, lv, desc, rule });
  const C = (id, seq, name, icon, lv, extra) => T('c_' + id, name, icon, 'cmd', lv, 'キーボードで「' + seq + '」と入力した(入力欄の外で。' + (extra || '') + '画面のどこにも表示されません)', { cmd: true, seq });
  // ---- 隠しコマンド(タイプ入力) 44個 ----
  C('ls', 'ls', 'ディレクトリ探検家', '📂', 1);
  C('pwd', 'pwd', '現在地の確認', '📍', 1);
  C('cat', 'cat', '猫派', '🐈', 1);
  C('man', 'man', '説明書を読む人', '📖', 1);
  C('top', 'top', 'タスクマネージャー', '📊', 1);
  C('exit', 'exit', '逃げ出した人', '🚪', 1);
  C('clear', 'clear', '画面クリア', '🧹', 1);
  C('cd', 'cd', 'どこかへ行くの？', '⬆️', 1);
  C('history', 'history', '歴史の目撃者', '📜', 2);
  C('echo', 'echo', 'みえてるよ', '🗣️', 2);
  C('ifconfig', 'ifconfig', 'ネットワークの顔', '🌐', 2);
  C('netstat', 'netstat', '接続の監視者', '🔌', 2);
  C('dig', 'dig', '掘る人', '⛏️', 2);
  C('curl', 'curl', 'くるくるHTTP', '🌀', 2);
  C('wget', 'wget', 'ダウンローダー', '⬇️', 2);
  C('ssh', 'ssh', 'リモートの住人', '🔐', 2);
  C('whois', 'whois', '身元調査員', '🕵️', 2);
  C('vimq', 'vi', 'バックアップは取った？', '🏃', 2);
  C('vimwq', ':wq', '保存して終了', '💾', 2);
  C('hello', 'hello world', 'Hello, World', '👋', 2);
  C('nslookup', 'nslookup', '名前解決人', '🔎', 3);
  C('telnet', 'telnet', '古の接続者', '📞', 3);
  C('pinglocal', 'ping 127.0.0.1', '自分自身への挨拶', '🪞', 3);
  C('ping8', 'ping 8.8.8.8', 'Googleへの挨拶', '🔍', 3);
  C('sudosu', 'su -', 'ルートへの昇格者', '👑', 3);
  C('chmod', 'chmod 777', '全員に全権限', '🔓', 3);
  C('docker', 'docker', 'コンテナ職人', '🐳', 3);
  C('reboot', 'reboot', '再起動の使い手', '🔄', 3);
  C('shutdown', 'shutdown', '電源を落とす者', '⏻', 4);
  // ---- 隠しコマンド(特殊な操作) 4個 ----
  T('c_sigint', 'SIGINT', '⛔', 'cmd', 3, 'Ctrl+C(MacはCmd+C)を、3秒以内に5回押した', { cmd: true });
  T('c_esc10', '脱出不能', '🏳️', 'cmd', 3, 'Escキーを、1.5秒以内の間隔で10回続けて押した', { cmd: true });
  T('c_logo20', 'ロゴ連打の鬼', '🔱', 'cmd', 3, '左上のロゴを、10秒以内に20回押した', { cmd: true });
  T('c_space20', '宇宙飛行士', '🚀', 'cmd', 3, 'スペースキーを(入力欄の外で)20回続けて押した', { cmd: true, seq: ' '.repeat(20) });
  // ---- コマンドの頂点 ----
  T('c_shell', 'シェルの支配者', '🐚', 'cmd', 5, 'タイプ入力の隠しコマンド29個を、すべて獲得した', { master: 'typed' });
  T('c_root', 'ルート権限', '#️⃣', 'cmd', 5, '隠しコマンドの称号35個(この称号を除く34個)を、すべて獲得した', { master: 'allcmd' });
  // ---- サイト操作 ----
  const A = (id, name, icon, lv, desc, act, n) => T('o_' + id, name, icon, 'op', lv, desc, { act, n });
  A('back1', 'タイムトラベラー', '⏪', 2, '画面左上の「戻る」を、累計50回押した', 'back', 50);
  A('back2', '時を戻す者', '⏳', 4, '画面左上の「戻る」を、累計300回押した', 'back', 300);
  A('menu1', 'メニュー愛好家', '☰', 2, 'メニュー(三本線)を、累計100回開いた', 'menu', 100);
  A('menu2', 'ハンバーガー好き', '🍔', 4, 'メニュー(三本線)を、累計500回開いた', 'menu', 500);
  A('dead1', '空振り三振', '⚾', 2, 'ボタンやリンクではない場所を、累計200回クリックした', 'deadclick', 200);
  A('dead2', '虚空を叩く者', '🕳️', 4, 'ボタンやリンクではない場所を、累計2,000回クリックした', 'deadclick', 2000);
  A('dbl1', 'ダブルクリッカー', '🖱️', 2, 'ダブルクリックを、累計100回した', 'dblclick', 100);
  A('dbl2', '二度押しの達人', '✌️', 4, 'ダブルクリックを、累計1,000回した', 'dblclick', 1000);
  A('copy1', 'コピペ常習犯', '📋', 2, '文字のコピーを、累計30回した', 'copy', 30);
  A('copy2', 'コピーライター', '✍️', 4, '文字のコピーを、累計200回した', 'copy', 200);
  A('paste1', '貼り付け職人', '📎', 2, '文字の貼り付けを、累計30回した', 'paste', 30);
  A('paste2', '貼り付けの鬼', '🧷', 4, '文字の貼り付けを、累計200回した', 'paste', 200);
  A('sel1', 'マーカー引き', '🖍️', 2, '30文字以上の文章を、累計50回選択した', 'selection', 50);
  A('sel2', '蛍光ペンの化身', '🖊️', 4, '30文字以上の文章を、累計300回選択した', 'selection', 300);
  A('bot1', '底を見る者', '⬇️', 2, '画面の一番下まで、累計100回スクロールした', 'scrollbottom', 100);
  A('bot2', '底なし沼の住人', '🌊', 4, '画面の一番下まで、累計1,000回スクロールした', 'scrollbottom', 1000);
  A('long1', '長押し名人', '👇', 2, '画面を、累計50回長押しした(0.8秒以上、動かさずに)', 'longpress', 50);
  A('long2', '押し続ける者', '🗿', 4, '画面を、累計300回長押しした(0.8秒以上、動かさずに)', 'longpress', 300);
  A('swipe1', 'スワイパー', '👆', 2, '画面を、横に累計100回スワイプした', 'swipe', 100);
  A('swipe2', '指先の達人', '💨', 4, '画面を、横に累計1,000回スワイプした', 'swipe', 1000);
  A('pinch1', 'ピンチイン', '🤏', 2, '2本指で画面を、累計20回つまんだ', 'pinch', 20);
  A('pinch2', 'ピンチアウト', '🖐️', 3, '2本指で画面を、累計100回つまんだ', 'pinch', 100);
  A('full', 'フルスクリーン', '🖥️', 2, '画面を全画面にした(F11など)', 'fullscreen', 1);
  A('find1', 'ページ内探偵', '🔦', 3, 'ページ内検索(Ctrl+F)を、累計10回使った', 'find', 10);
  A('bkm', 'お気に入り登録', '🔖', 1, 'ブックマーク(Ctrl+D)をしようとした', 'bookmark', 1);
  A('hard', '強制リロード', '⚡', 3, 'キャッシュを無視した再読み込み(Ctrl+Shift+Rなど)を、累計5回した', 'hardreload', 5);
  A('altl', 'キーボード派', '⌨️', 3, 'Alt+←/→で、ページの移動を累計20回した', 'altleft', 20);
  A('drag', 'ドラッガー', '🧲', 2, '画像や文字を、累計30回ドラッグした', 'drag', 30);
  A('key1', 'タイピスト', '⌨️', 2, '入力欄に、累計2,000文字を打ち込んだ', 'keys', 2000);
  A('key2', 'キーボードクラッシャー', '🔨', 4, '入力欄に、累計10,000文字を打ち込んだ', 'keys', 10000);
  A('comp1', '変換の鬼', '🈁', 2, '日本語の変換を、累計500回確定した', 'compose', 500);
  A('comp2', '辞書登録の達人', '📚', 4, '日本語の変換を、累計3,000回確定した', 'compose', 3000);
  A('multi3', '並列作業', '🗂️', 3, 'サイトを3つ以上のタブで同時に開いた', 'multi3', 1);
  A('multi5', '分身の術', '🥷', 4, 'サイトを5つ以上のタブで同時に開いた', 'multi5', 1);
  A('wide', 'ウルトラワイド', '🖼️', 2, '横幅1,900px以上の画面でサイトを開いた', 'wide', 1);
  A('narrow', '極小の窓', '🔬', 2, '横幅340px以下の画面でサイトを開いた', 'narrow', 1);
  A('foreign', '海外からの視聴', '🌏', 2, '日本語以外の言語設定のブラウザで、サイトを開いた', 'foreign', 1);
  A('stay30', '居座り', '🪑', 3, '同じ画面を、開いたまま30分見続けた', 'stay30', 1);
  A('stay120', '定住者', '🏠', 4, '同じ画面を、開いたまま2時間見続けた', 'stay120', 1);
  A('zap', 'ザッピング', '📺', 3, '30秒以内に、画面を20回切り替えた', 'zapping', 1);
  A('ret', '久しぶり', '👋', 2, '前回の訪問から、7日以上あけてサイトに戻った', 'return7', 1);
  T('o_both', '両刀使い', '⚔️', 'op', 3, 'スマホなどのタッチ操作と、マウス操作の両方でサイトを使った', { both: ['touch', 'mouse'] });
  const K = (id, name, icon, lv, desc, ctr, n) => T('o_' + id, name, icon, 'op', lv, desc, { ctr, n });
  K('reload', 'リロード中毒', '🔁', 4, 'ページの再読み込みを、累計100回した', 'reload', 100);
  K('f5', 'F5職人', '🔃', 3, '10秒以内の5連続リロードを、累計10回した', 'f5', 10);
  K('rclick', '右クリック依存', '🖱️', 3, '右クリック(長押しメニュー)を開いた訪問が、累計30回', 'rclick', 30);
  K('print', '印刷所', '🖨️', 3, '印刷画面を開いた訪問が、累計10回', 'print', 10);
  K('tabhop', '渡り鳥', '🐦', 3, 'ほかのタブへ10回以上切り替えた訪問が、累計30回', 'tabhop', 30);
  K('zoom', '拡大縮小の達人', '🔍', 3, '画面の拡大・縮小をした訪問が、累計20回', 'zoom', 20);
  K('allsel', '全選択マニア', '🔲', 3, '全選択(Ctrl+A)をした訪問が、累計50回', 'allsel', 50);
  K('lost', '迷子の常連', '🧭', 3, '存在しないページを開いた回数が、累計10回', 'lost', 10);
  K('devtools', '開発者ツール常連', '🛠️', 3, '開発者ツールを開こうとした訪問が、累計20回', 'devtools', 20);
  K('offline', '圏外の常連', '📵', 3, '圏外から復帰した回数が、累計10回', 'offline', 10);
  K('frozen', '締切破りの常習犯', '🚫', 3, '締め切り後のランキングを変更しようとした回数が、累計10回', 'frozenTry', 10);
  K('imgsave', '写真館', '📸', 4, '画像の保存を、累計100回した', 'imgsave', 100);
  K('swap', '流星群', '☄️', 3, '☆の曲の入れ替えを、累計30回した', 'starswap', 30);
  K('equip', '着せ替え人形', '🎎', 4, '称号の装備や付け外しを、累計100回した', 'equip', 100);
  K('stats', 'データ分析官', '🧮', 3, 'マイ統計を、累計50回開いた', 'stats', 50);
  const V = (id, name, icon, lv, desc, visit, n) => T('o_' + id, name, icon, 'op', lv, desc, { visit, n });
  V('vtitle', 'コレクション鑑賞家', '🏛️', 4, '称号コレクションを、累計200回開いた', 'titles', 200);
  V('vpeople', 'いつもの顔ぶれ', '👥', 4, '参加者の一覧を、累計300回開いた', 'people', 300);
  T('o_all', 'サイトを知り尽くした者', '🌟', 'op', 5, 'サイト操作の称号59個(この称号を除く)を、すべて獲得した', { master: 'allsite' });
  // ---- 長期・時間帯 ----
  const S = (id, name, icon, lv, desc, stat, n) => T('l_' + id, name, icon, 'long', lv, desc, { stat, n });
  S('d30', '三十日の常連', '🗓️', 3, 'サイトに、30日アクセスした', 'days', 30);
  S('d60', '六十日の住人', '🏘️', 4, 'サイトに、60日アクセスした', 'days', 60);
  S('d100', 'ヒャクニチソウ', '⛩️', 5, 'サイトに、100日アクセスした', 'days', 100);
  S('s7', '七日連続の旅', '🚶', 3, 'サイトに、7日連続でアクセスした', 'streak', 7);
  S('s14', '二週間の皆勤', '🏃', 4, 'サイトに、14日連続でアクセスした', 'streak', 14);
  S('s30', 'ひと月の皆勤', '🏅', 5, 'サイトに、30日連続でアクセスした', 'streak', 30);
  S('h10', '十時間の滞在', '⏱️', 3, 'サイトの滞在時間が、合計10時間を超えた', 'stayh', 10);
  S('h50', '五十時間の滞在', '⌛', 4, 'サイトの滞在時間が、合計50時間を超えた', 'stayh', 50);
  S('h100', '百時間の滞在', '🕰️', 5, 'サイトの滞在時間が、合計100時間を超えた', 'stayh', 100);
  S('sc500', '五百点の審査員', '📝', 4, 'すべてのランキングを合わせて、500曲以上に点数をつけた', 'scores', 500);
  S('sc1000', '千点の審査員', '🧾', 5, 'すべてのランキングを合わせて、1,000曲以上に点数をつけた', 'scores', 1000);
  S('cm100', 'ひとこと百本', '💬', 4, 'すべてのランキングを合わせて、100曲以上にひとことを書いた', 'comments', 100);
  T('l_noon', '昼休みの審査員', '🍱', 'long', 2, '12時台に、サイトを開いていた', { act: 'noon', n: 1 });
  T('l_mid', 'ゼロ時の訪問者', '🌌', 'long', 3, '0時0分〜0時9分の間に、サイトを開いていた', { act: 'midnight', n: 1 });
  T('l_sun', '日の出の観測者', '🌅', 'long', 3, '5時0分〜5時9分の間に、サイトを開いていた', { act: 'sunrise', n: 1 });
  // ---- デバッグ系の追加 ----
  const D = (id, name, icon, lv, desc, rule) => T('d_' + id, name, icon, 'debug', lv, desc, rule);
  D('inject', 'インジェクター', '💉', 4, 'ひとこと・自己紹介に、<script>タグやSQL文(DROP TABLEなど)を入力した(何も起きません)', { ctr: 'inject', n: 1 });
  D('bigpaste', 'ペーストモンスター', '👹', 2, '1,000文字以上の文章を、貼り付けた', { act: 'bigpaste', n: 1 });
  D('adminpeek', '立入禁止区域', '🚧', 2, '管理者用の画面のアドレスを、開こうとした', { ctr: 'adminpeek', n: 1 });
  D('ghost', '幽霊の目撃者', '👻', 2, '存在しないユーザーのプロフィールを、開こうとした', { ctr: 'ghost', n: 1 });
  D('keymash', 'キー連打の鬼', '🎹', 2, '同じキーを、3秒以内に30回連続で押した', { act: 'keymash', n: 1 });
  D('shake', 'マウスシェイカー', '🫨', 3, 'マウスを、1秒以内に左右へ10回以上振った', { act: 'shake', n: 1 });
  D('slow', '回線の試練', '🐢', 2, '通信に、6秒以上かかった', { act: 'slownet', n: 1 });
  D('prtsc', 'スクショ職人', '📷', 3, 'PrintScreenキーを、累計10回押した', { act: 'prtsc', n: 10 });
  D('flick', 'フリックの王', '🌪️', 3, '画面を高速でスクロールすることを、累計100回した', { act: 'flick', n: 100 });
  D('scmaster', 'ショートカットマスター', '🎛️', 5, 'ページ内検索・ブックマーク・強制リロード・Alt+矢印・印刷・ソース表示・全選択・拡大縮小を、すべて使った', { need: { act: ['find', 'bookmark', 'hardreload', 'altleft'], ctr: ['print', 'viewsrc', 'allsel', 'zoom'] } });
  // ---- サイト愛・各ジャンルの★5・称号獲得数 ----
  const SI = (id, name, icon, lv, desc, rule) => T('s_' + id, name, icon, 'site', lv, desc, rule);
  SI('apple2', 'りんご農園', '🍎', 3, 'Apple Musicのプレイリストのリンクを、累計10回押した', { ctr: 'applelink', n: 10 });
  SI('csv', 'CSV職人', '🗂️', 3, 'ランキングやデータをCSVで、累計5回保存した', { ctr: 'csv', n: 5 });
  SI('stats', 'マイ統計マニア', '📈', 2, 'マイ統計を、累計10回開いた', { ctr: 'stats', n: 10 });
  SI('people', '人間観察', '🔭', 3, '他のユーザーのプロフィールを、30人分見た', { stat: 'profiles', n: 30 });
  SI('news', '新聞の配達員', '📰', 4, 'お知らせを、累計50回開いた', { ctr: 'news', n: 50 });
  SI('pasts', 'アーカイブの主', '🗄️', 4, '過去のParty Rankの画面を、累計50回開いた', { visit: 'pasts', n: 50 });
  SI('about', '説明書の暗記', '📚', 3, 'Party Rankとは の画面を、累計20回開いた', { visit: 'about', n: 20 });
  SI('compat', '相性占い師', '🔮', 4, '相性診断の画面を、累計50回開いた', { visit: 'compat', n: 50 });
  SI('icon', 'アイコン収集家', '🖼️', 3, 'アイコンを、累計10回設定した', { ctr: 'iconset', n: 10 });
  SI('bio', '筆まめ', '🖋️', 4, '自己紹介を、累計30回書き換えた', { ctr: 'bioedit', n: 30 });
  SI('rename', '改名の達人', '🎭', 4, 'ユーザー名を、累計10回変更した', { ctr: 'rename', n: 10 });
  SI('invite', '宣教師長', '📣', 4, '招待や共有を、累計20回行った', { ctr: 'invite', n: 20 });
  SI('all', 'サイト愛の化身', '💞', 5, 'サイト愛ジャンルの称号を、25個獲得した', { masterCat: 'site', n: 25 });
  T('m_cm300', '語り部の頂', '🗣️', 'comm', 5, 'すべてのランキングを合わせて、300曲以上にひとことを書いた', { stat: 'comments', n: 300 });
  T('t_tease', 'ひねくれ者の王', '🃏', 'tease', 5, '煽りジャンルの称号5個を、すべて獲得した', { masterCat: 'tease', n: 5 });
  const TC = (n, id, name, icon, lv) => T('t_' + id, name, icon, 'staff', lv, '称号を' + n + '個獲得した', { cnt: n });
  TC(75, 'c75', '称号の貴族', '🎩', 4);
  TC(100, 'c100', '称号の大富豪', '💰', 5);
  TC(150, 'c150', '称号の覇者', '🏆', 5);
  TC(200, 'c200', '称号の大帝', '👑', 5);
  TC(250, 'c250', '称号の宇宙', '🌌', 5);
  T('t_all', 'コンプリート', '💯', 'staff', 5, 'すべての称号(管理者専用を除く)を、獲得した', { cnt: -1 });
  // ---- 2026-10-31 追加 ----
  T('x_throne', '玉座', '🪑', 'staff', 5, '現在、称号の獲得数が最も多いユーザーに付与される(最多のユーザーが変わると、剥奪されて、新しい最多のユーザーに付与される。taetaeは対象外)', { special: true });
  T('x_etude', 'エチュード', '🎼', 'join', 5, 'サイトに、100日連続でアクセスした', { stat: 'streak', n: 100 });
  T('x_senti', 'センチメンタル', '🥹', 'comm', 5, '感動系のひとこと(涙・感動・泣ける・心に染みる・胸が熱い・エモい・尊い・鳥肌 など)を、合計10曲に書いた', { stat: 'sentiment', n: 10 });
  T('x_stella', 'Stella', '🌠', 'site', 5, '☆を、合計100回つけた(つけ替えを含む)', { ctr: 'starset', n: 100 });
  T('x_okaeri', 'おかえり', '🏡', 'debug', 5, '最後にサイトを開いてから1か月(30日)以上あけて、再びサイトを開いた', { stat: 'maxgap', n: 30 });
  T('x_sonna', 'そんなもんね', '😐', 'score', 5, '4.0〜5.5点を、合計200回つけた', { stat: 'mid', n: 200 });
  T('x_futari', 'ふたりぶん', '👥', 'debug', 5, '同じ端末(ブラウザ)から、違うユーザーでログインした', { ctr: 'multiuser', n: 1 });
  T('x_speed', 'スピード', '💨', 'result', 5, 'Party Watchになったランキングで、全曲を最も早く採点した人になることを、3つのランキングで連続して達成した', { stat: 'speed3', n: 1 });
  T('x_hare', 'ハレの日に', '☀️', 'lucky', 5, '東京・大阪・名古屋・福岡の4都市がすべて晴れの日に、サイトを開いた(天気予報を、サーバーが自動で確認)', { stat: 'sunny', n: 1 });
  T('x_spice', '魔法はスパイス', '🧂', 'result', 4, '自分が☆をつけた曲が、全体の平均8.0点以上で、全体2位だった', { keyTitle: true });
  T('x_tsuki', '月と私のかくれんぼ', '🌙', 'join', 4, '14日連続でサイトを開き、そのすべてが夜間(19:00〜翌3:59)ではなかった', { stat: 'nightless', n: 14 });
  T('x_sayonara', 'さよなら人類', '🚀', 'result', 4, '全体の最高点と最低点の差が7.5点以上あった曲に、☆をつけた', { keyTitle: true });
  T('x_motibe', 'モチベ低下中', '🫠', 'score', 1, '1つのランキングで5曲以上に点数をつけたが、全体表から外された', { stat: 'excl', n: 1 });
  X.find((x) => x.id === 'c_sudosu').rule.alt = ['su-'];
  X.find((x) => x.id === 'c_sudosu').desc = 'キーボードで「su -」(または「su-」)と入力した(入力欄の外で。画面のどこにも表示されません)';
  return X;

})();
EXTRA.forEach((x) => { TITLE_DEFS.push({ id: x.id, name: x.name, desc: x.desc, special: !!x.rule.special }); TITLE_META[x.id] = [x.cat, x.lv]; });
const TITLE_ORD = Object.fromEntries(TITLE_DEFS.map((d, i) => [d.id, i]));
const SONG_DEFAULT = ['bake', 'x_etude', 'x_senti', 'x_stella', 'x_okaeri', 'x_sonna', 'l_d100', 'x_futari', 'x_speed', 'x_hare', 'constellation', 'x_tsuki', 'x_spice', 'x_sayonara'];
const SONG_SET = new Set(SONG_DEFAULT);
function songOrder2() { const o = (db.songTitles && Array.isArray(db.songTitles.order) ? db.songTitles.order : []).filter((id) => SONG_SET.has(id)); SONG_DEFAULT.forEach((id) => { if (!o.includes(id)) o.push(id); }); return o; }
const SUS = /<\s*script|<\s*img|<\s*iframe|onerror\s*=|javascript:|drop\s+table|union\s+select|'\s*or\s*'?1'?\s*=\s*'?1|<\s*svg/i;
const EXTRA_CMD = EXTRA.filter((x) => x.rule.cmd).map((x) => x.id);
const EXTRA_ACT = new Set(EXTRA.filter((x) => x.rule.act).map((x) => x.rule.act).concat(['touch', 'mouse', 'keys', 'compose']));
const TITLE_BY_ID = Object.fromEntries(TITLE_DEFS.map((t) => [t.id, t]));
const RANK_TIER = (n) => (n >= 31 ? 5 : n >= 21 ? 4 : n >= 11 ? 3 : n >= 6 ? 2 : n >= 1 ? 1 : 0);
const EMOJIS = ['👍', '❤️', '😂', '🔥', '😢'];

let tcVer = -1; const tcache = new Map();
function tableOf(k) {
  if (tcVer !== VER) { tcache.clear(); tcVer = VER; }
  if (!tcache.has(k)) tcache.set(k, buildTable(k));
  return tcache.get(k);
}
function ranksOf(arr) { // 同点は平均順位
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), out = new Array(arr.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let t = i; t <= j; t++) out[idx[t][1]] = (i + j) / 2 + 1; i = j + 1; }
  return out;
}
function spearman(a, b) {
  const x = ranksOf(a), y = ranksOf(b), n = x.length, mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
// 予想ゲームの採点: 順位ぴったり=3点、トップ3(ワースト3)に入っていた=1点。最大18点
function predScore(k, pred) {
  const T = tableOf(k), ranked = T.rows.filter((r) => r.avg != null);
  const rd = {}, ra = {}; let n = 0, pv = null;
  ranked.forEach((r) => { rd[r.id] = r.rank; });
  const asc = ranked.slice().sort((a, b) => a.avg - b.avg);
  asc.forEach((r, i) => { const q = Math.round(r.avg * 1000); if (q !== pv) { n = i + 1; pv = q; } ra[r.id] = n; });
  const calc = (list, rk) => {
    let pts = 0, exact = 0;
    (list || []).forEach((sid, i) => { const r = rk[sid]; if (r == null) return; if (r <= i + 1) { pts += 3; exact++; } else if (r <= 3) pts += 1; });
    return { pts, exact };
  };
  const t = calc(pred.top, rd), w = calc(pred.worst, ra);
  return { pts: t.pts + w.pts, trifecta: t.exact === 3, worstTrifecta: w.exact === 3, top1: rd[(pred.top || [])[0]] === 1, worst1: ra[(pred.worst || [])[0]] === 1 };
}
function predBoard(k) {
  const out = [];
  Object.keys(db.pred[k] || {}).forEach((pid) => {
    const u = db.people.find((x) => x.id === pid); if (!u) return;
    const pr = db.pred[k][pid], sc = predScore(k, pr);
    out.push({ id: u.id, name: u.name, ic: iconAt(u), adm: isAdminPerson(u.id), pts: sc.pts, trifecta: sc.trifecta, worstTrifecta: sc.worstTrifecta, top: pr.top, worst: pr.worst });
  });
  return out.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name, 'ja'));
}
function watchScores() {
  const sids = new Set(); allKeys().filter((k) => modeOf(k) === 'watch').forEach((k) => db.songs.forEach((s) => { if (s.key === k) sids.add(s.id); }));
  const m = new Map();
  db.people.forEach((u) => { const sc = db.scores[u.id] || {}, o = {}; let c = 0; Object.keys(sc).forEach((sid) => { if (sids.has(sid) && typeof sc[sid] === 'number') { o[sid] = sc[sid]; c++; } }); if (c) m.set(u.id, o); });
  return m;
}
function compatOf(a, b) {
  let n = 0, sum = 0;
  Object.keys(a).forEach((sid) => { if (typeof b[sid] === 'number') { n++; sum += Math.abs(a[sid] - b[sid]); } });
  return n ? { n, pct: Math.max(0, Math.round((100 - (sum / n) * 10) * 10) / 10) } : { n: 0, pct: 0 };
}
function keyTitles(k, out, doneCount, doneKeys) {
  const T = tableOf(k), rows = T.rows, N = rows.length;
  if (!N || !T.people.length) return;
  const add = (pid, id) => { if (!out.has(pid)) out.set(pid, new Set()); out.get(pid).add(id); };
  const ranked = rows.filter((r) => r.avg != null), nR = ranked.length, overall = T.overallAvg;
  const asc = ranked.slice().reverse(), q3 = (v) => Math.round(v * 1000);
  const worst3 = nR >= 6 && q3(asc[2].avg) < q3(asc[3].avg) ? new Set(asc.slice(0, 3).map((r) => r.id)) : null;
  const rankAt = (db.modes[k] || {}).rankAt, deadline = db.deadlines[k];
  const sids = rows.map((r) => r.id);
  const ordIds = db.songs.filter((x) => x.key === k).sort(songOrder).map((x) => x.id);
  let yariBest = null; const fin = [];
  T.people.forEach((p) => {
    const pid = p.id, sc = rows.map((r) => r.scores[pid]), have = sc.filter((v) => typeof v === 'number');
    if (!have.length) return;
    const done = have.length === N, avg = mean(have);
    if (done && avg >= 7.5) add(pid, 'sweet');
    if (have.filter((v) => v === 7 || v === 7.5).length >= 30) add(pid, 'lucky7');
    if (have.filter((v) => v === 0).length >= 3) add(pid, 'zero');
    if (have.filter((v) => v === 10).length >= 3) add(pid, 'ten');
    if (done) { doneCount[pid] = (doneCount[pid] || 0) + 1; fin.push({ pid, avg }); (doneKeys[pid] = doneKeys[pid] || []).push(k); }
    if (done && N >= 10 && Math.round(have.reduce((a, b) => a + b, 0) * 10) % 1000 === 0) add(pid, 'pittari');
    if (done && N >= 10 && Math.round(have.reduce((a, b) => a + b, 0) * 10) === 7770) add(pid, 'jackpot');
    if (have.filter((v) => v === 0).length >= 5 && have.filter((v) => v === 10).length >= 5) add(pid, 'tenzero');
    if (have.filter((v) => v <= 0.5).length >= 10) add(pid, 'reisen');
    if (done && N >= 5 && Math.abs(avg - 5) < 1e-9) add(pid, 'midpoint');
    if (done && N >= 10 && have.filter((v) => v === 10).length === 1 && have.filter((v) => v !== 10).every((v) => v <= 6)) add(pid, 'ichimai');
    if (done && N >= 5) {
      const scs = ordIds.map((sid) => (db.scores[pid] || {})[sid]);
      if (scs.length === N && scs.every((v) => typeof v === 'number')) {
        if (scs.every((v, i) => !i || v >= scs[i - 1]) && scs[N - 1] - scs[0] >= 2) add(pid, 'ladder');
        if (scs.every((v, i) => !i || v <= scs[i - 1]) && scs[0] - scs[N - 1] >= 2) add(pid, 'descent');
      }
    }
    if (done && nR >= 6) {
      const mxv = Math.max(...have), mnv = Math.min(...have), hi = rows.filter((r) => r.scores[pid] === mxv), lo = rows.filter((r) => r.scores[pid] === mnv), lastRank = ranked[nR - 1].rank;
      if (mxv !== mnv && hi.length === 1 && lastRank !== 1) {
        if (hi[0].rank === lastRank && N >= 10 && mxv >= 9) add(pid, 'tragic');
        if (lo.length === 1 && hi[0].rank === 1 && lo[0].rank === lastRank) add(pid, 'sniper');
      }
    }
    if (rows.filter((r) => r.count >= 3 && typeof r.scores[pid] === 'number' && r.scores[pid] >= 8 && Object.values(r.scores).every((v) => v >= 8)).length >= 3) add(pid, 'manjo');
    if (done && Math.min(...have) >= 5) add(pid, 'kind');
    if (done && Math.max(...have) <= 5) add(pid, 'ice');
    if (rows.filter((r) => typeof r.scores[pid] === 'number' && Math.abs(r.scores[pid] - r.avg) <= 0.1).length >= 5) add(pid, 'dompisha');
    if (rows.filter((r) => typeof r.scores[pid] === 'number' && Math.abs(r.scores[pid] - r.avg) >= 3).length >= 3) add(pid, 'heretic');
    if (have.filter((v) => v % 1 !== 0).length >= 15) add(pid, 'half');
    if (done && N >= 10 && have.every((v) => v % 1 === 0)) add(pid, 'round');
    if (done && Math.min(...have) >= 7) add(pid, 'tasty');
    if (done && N >= 10) { const fr = {}; have.forEach((v) => { fr[v] = (fr[v] || 0) + 1; }); if (Math.max(...Object.values(fr)) >= N / 2) add(pid, 'oneway'); }
    if (new Set(have).size >= 15) add(pid, 'variety');
    if (rows.some((r) => r.starBy.includes(pid) && r.count >= 3 && r.avg > 8.286)) add(pid, 'bake');
    if (rows.some((r) => r.starBy.includes(pid) && r.rank === 2 && r.avg != null && r.avg >= 8)) add(pid, 'x_spice');
    if (rows.some((r) => { if (!r.starBy.includes(pid)) return false; const v = Object.values(r.scores || {}).filter((x) => typeof x === 'number'); return v.length >= 2 && Math.max(...v) - Math.min(...v) >= 7.5; })) add(pid, 'x_sayonara');
    if (done && N >= 6 && nR >= 2 && q3(ranked[0].avg) > q3(ranked[1].avg) && ranked[0].scores[pid] <= Math.min(...have) && ranked[0].scores[pid] <= 5) add(pid, 'hanki');
    if (done && N >= 10 && rows.every((r) => r.avg != null && r.count >= 3 && r.scores[pid] < r.avg)) add(pid, 'lonely');
    if (done && N >= 10 && rows.every((r) => r.avg != null && r.count >= 3 && r.scores[pid] > r.avg)) add(pid, 'flatter');
    if (N >= 6 && nR >= 2 && q3(asc[0].avg) < q3(asc[1].avg) && typeof asc[0].scores[pid] === 'number' && asc[0].scores[pid] >= 9) add(pid, 'savior');
    if (rows.filter((r) => r.avg != null && r.count >= 3 && typeof r.scores[pid] === 'number' && Math.abs(r.scores[pid] - r.avg) >= 5).length >= 3) add(pid, 'bias');
    if (done && overall != null && Math.abs(avg - overall) <= 0.05) add(pid, 'avgbody');
    if (done && rows.every((r) => r.comments[pid]) && rows.some((r) => r.starBy.includes(pid)) && (db.pred[k] || {})[pid]) add(pid, 'combo');
    if (ranked.length >= 1 && ranked[0].rank === 1 && ranked.filter((r) => r.rank === 1).some((r) => r.scores[pid] === 10)) add(pid, 'mvp');
    if (nR >= 5) {
      const lastAvg = q3(asc[0].avg);
      if (asc.filter((r) => q3(r.avg) === lastAvg).some((r) => r.scores[pid] >= 8)) add(pid, 'lastlove');
      const t3 = ranked.slice(0, 3);
      if (t3.every((r) => typeof r.scores[pid] === 'number' && r.scores[pid] >= 8)) add(pid, 'podium');
    }
    if (have.length >= 6 && nR >= 6 && q3(ranked[2].avg) > q3(ranked[3].avg)) {
      const ord = rows.map((r) => ({ id: r.id, v: r.scores[pid] })).filter((x) => typeof x.v === 'number').sort((a, b) => b.v - a.v);
      const tset = new Set(ranked.slice(0, 3).map((r) => r.id));
      if (ord[2].v > ord[3].v && ord.slice(0, 3).every((x) => tset.has(x.id))) add(pid, 'prophet');
    }
    if (done && avg <= 4) add(pid, 'harsh');
    if (done && N >= 10 && Math.max(...have) - Math.min(...have) <= 2) add(pid, 'steady');
    if (have.includes(0) && have.includes(10)) add(pid, 'extreme');
    if (done && N >= 20) add(pid, 'marathon');
    if (done) {
      const dev = mean(rows.map((r) => Math.abs(r.scores[pid] - r.avg)));
      if (dev != null && dev >= 2) add(pid, 'contrary');
    }
    const mx = Math.max(...have), tops = rows.filter((r) => r.scores[pid] === mx);
    if (have.length >= 5 && tops.length === 1 && tops[0].rank === 1) add(pid, 'champion');
    let all = true; for (let v = 0; v <= 10; v += 0.5) if (!have.includes(v)) { all = false; break; }
    if (all) add(pid, 'stairs');
    if (rows.every((r) => r.comments[pid])) add(pid, 'cmleader');
    if (rows.some((r) => Array.from(r.comments[pid] || '').length >= 90)) add(pid, 'love');
    if (done && overall != null && avg - overall >= 2) add(pid, 'kadai');
    if (done && overall != null && Math.abs(avg - overall) <= 0.3 && !rows.some((r) => r.comments[pid])) add(pid, 'silent');
    if (done && N >= 10 && spearman(sc, rows.map((r) => r.avg)) >= 0.95) add(pid, 'gunshi');
    rows.forEach((r) => {
      const v = r.scores[pid], n = r.count;
      if (typeof v === 'number' && n >= 2) {
        const without = (r.avg * n - v) / (n - 1);
        if (v === 10 && r.avg - without >= 1) add(pid, 'creator');
        if (v === 0 && without - r.avg >= 1) add(pid, 'destroyer');
      }
      if (r.starBy.includes(pid)) {
        if (r.rank === 1) add(pid, 'star1');
        if (r.rank != null && r.rank <= 3) add(pid, 'eye');
        if (v === 10) add(pid, 'oshi');
        const pos = ranked.indexOf(r);
        if (pos >= 0 && nR > 10 && pos >= nR - 10) add(pid, 'gyaku');
      }
      if (r.starBy.length >= 3 && r.starBy.includes(pid)) add(pid, 'constellation');
    });
    if (worst3 && have.length >= 6) {
      const ord = rows.map((r) => ({ id: r.id, v: r.scores[pid] })).filter((x) => typeof x.v === 'number').sort((a, b) => b.v - a.v);
      if (ord[2].v > ord[3].v && ord.slice(0, 3).every((x) => worst3.has(x.id))) add(pid, 'gyakushin');
    }
    // 提出時刻 = 全曲を採点し終えた時刻
    const stp = db.stamps[pid] || {};
    if (done && sids.every((sid) => stp[sid])) {
      const comp = Math.max(...sids.map((sid) => stp[sid]));
      if (deadline && comp >= deadline - 3600000 && comp <= deadline) add(pid, 'sliding');
      if (rankAt && comp >= rankAt && (!yariBest || comp < yariBest.t)) yariBest = { pid, t: comp };
    }
    const pr = (db.pred[k] || {})[pid];
    if (pr) { const ps = predScore(k, pr); if (ps.trifecta) add(pid, 'manba'); if (ps.worstTrifecta) add(pid, 'mine'); if (ps.pts >= 12) add(pid, 'detective'); if (modeOf(k) === 'watch') { if (ps.top1) add(pid, 'tansho'); if (ps.worst1) add(pid, 'akumei'); if (ps.pts === 0) add(pid, 'zerozero'); } }
  });
  if (yariBest) add(yariBest.pid, 'yari');
  if (fin.length >= 3) { const mn = Math.min(...fin.map((x) => Math.round(x.avg * 1000))); fin.filter((x) => Math.round(x.avg * 1000) === mn).forEach((x) => add(x.pid, 'funeoriro')); }
}
let emVer = -1, emCver = -1, emMemo = null, emBase = null, emBaseVer = -1;
function computeEarned() {
  if (emVer === VER && emCver === CVER && emMemo) return emMemo;
  if (!(emBase && emBaseVer === VER)) {
    const out = new Map(), fk = allKeys().filter(frozen);
    const doneCount = {}, doneKeys = {};
    fk.forEach((k) => keyTitles(k, out, doneCount, doneKeys));
    // なろう系(凍結済みランキング全体で数える)
    const isk = /異世界|転生/;
    db.people.forEach((u) => {
      const sc = db.scores[u.id] || {}; let n = 0;
      fk.forEach((k) => tableOf(k).rows.forEach((r) => { if (isk.test(r.anime || '') && typeof (r.scores || {})[u.id] === 'number' && r.scores[u.id] >= 8) n++; }));
      if (n >= 3) { if (!out.has(u.id)) out.set(u.id, new Set()); out.get(u.id).add('isekai'); }
    });
    const ws = watchScores(), songIds = new Set(db.songs.map((x) => x.id)), rxIn = {}, rxOut = {};
    Object.keys(db.reacts).forEach((ck) => {
      const owner = ck.split(':')[1];
      Object.keys(db.reacts[ck]).forEach((e) => db.reacts[ck][e].forEach((pid) => { rxOut[pid] = (rxOut[pid] || 0) + 1; if (pid !== owner) rxIn[owner] = (rxIn[owner] || 0) + 1; }));
    });
    // スピード: Party Watchのランキングで、全曲を最も早く採点した人が、3つ連続したか
    const speed = new Set(), wk = fk.filter((k) => modeOf(k) === 'watch').sort((a, b) => { const p1 = a.split('-'), p2 = b.split('-'); return (Number(p1[0]) - Number(p2[0])) || (Number(p1[1]) - Number(p2[1])) || (KINDS.indexOf(p1[2]) - KINDS.indexOf(p2[2])); });
    let runPid = null, runN = 0;
    wk.forEach((k) => {
      const ids = db.songs.filter((x) => x.key === k).map((x) => x.id); let best = null;
      if (ids.length) db.people.forEach((u) => { const sc = db.scores[u.id] || {}, st = db.stamps[u.id] || {}; if (!ids.every((sid) => typeof sc[sid] === 'number' && st[sid])) return; const t = Math.max(...ids.map((sid) => st[sid])); if (!best || t < best.t) best = { pid: u.id, t }; });
      if (!best) { runPid = null; runN = 0; return; }
      if (best.pid === runPid) runN++; else { runPid = best.pid; runN = 1; }
      if (runN >= 3) speed.add(runPid);
    });
    emBase = { out, fk, speed, doneCount, doneKeys, ws, songIds, rxIn, rxOut }; emBaseVer = VER;
  }
  const out = new Map(); emBase.out.forEach((st, k) => out.set(k, new Set(st)));
  const { fk, speed, doneCount, doneKeys, ws, songIds, rxIn, rxOut } = emBase;
  db.people.forEach((u) => {
    const set = out.get(u.id) || new Set(), c = db.counters[u.id] || {};
    Object.keys(db.titles[u.id] || {}).forEach((id) => { if (TITLE_BY_ID[id] && !TITLE_BY_ID[id].special) set.add(id); });
    const t = RANK_TIER(rankCount(u.id)); for (let i = 1; i <= t; i++) set.add('rank' + i);
    if ((c.pastclick || 0) >= 5) set.add('viewer');
    if ((c.imgsave || 0) >= 5) set.add('camera');
    if (c.intruder) set.add('intruder');
    if (Array.from(u.bio || '').length >= 100) set.add('honor');
    if (Object.keys(db.comments[u.id] || {}).filter((sid) => songIds.has(sid)).length >= 50) set.add('cmmaster');
    if ((rxIn[u.id] || 0) >= 10) set.add('popular');
    if ((rxOut[u.id] || 0) >= 30) set.add('ambassador');
    if (Object.keys(db.stamps[u.id] || {}).filter((sid) => { const h = new Date(db.stamps[u.id][sid] + 9 * 3600000).getUTCHours(); return h < 5; }).length >= 10) set.add('night');
    if (Object.keys(db.stamps[u.id] || {}).filter((sid) => { const h = new Date(db.stamps[u.id][sid] + 9 * 3600000).getUTCHours(); return h >= 5 && h < 8; }).length >= 10) set.add('early');
    if (db.people.indexOf(u) < 10) set.add('founder');
    { // 行動の記録による称号
      const cc = c, dc = doneCount[u.id] || 0, days = Object.keys(cc.days || {}).sort(), v = cc.visits || {};
      if ((cc.invite || 0) >= 1) set.add('pr'); if ((cc.invite || 0) >= 5) set.add('missionary');
      if ((cc.news || 0) >= 10) set.add('reporter');
      if (Object.values(db.changes[u.id] || {}).some((n) => n >= 5)) set.add('indecisive');
      if ((cc.stay || 0) > 36000) set.add('resident'); if ((cc.stay || 0) > 360000) set.add('master');
      if ((cc.f5 || 0) >= 1) set.add('f5');
      if ((v.people || 0) >= 20) set.add('roster');
      let run = 0, best = 0, prev = null;
      days.forEach((d) => { const t = Date.parse(d + 'T00:00:00Z'); run = prev != null && t - prev === 86400000 ? run + 1 : 1; prev = t; if (run > best) best = run; });
      if (best >= 3) set.add('loginbonus'); if (best >= 7) set.add('weekly');
      if (days.length >= 15) set.add('regular'); if (days.length >= 30) set.add('veteran');
      if ((cc.iconset || 0) >= 3) set.add('iconmaker');
      if ((cc.rename || 0) >= 3) set.add('renamer');
      if ((cc.bioedit || 0) >= 5) set.add('reviser');
      if (u.x) set.add('linked');
      if ((cc.equip || 0) >= 5) set.add('dresser');
      if (['about', 'notices', 'invite', 'pasts', 'people', 'profile', 'titles', 'predict', 'compat'].every((r) => (v[r] || 0) >= 1)) set.add('explorer');
      if ((v.pasts || 0) >= 10) set.add('historian');
      if ((v.about || 0) >= 3) set.add('manual');
      if ((v.compat || 0) >= 10) set.add('compatfan');
      if (Object.keys(cc.profiles || {}).filter((id) => db.people.some((x) => x.id === id)).length >= 10) set.add('neighbor');
      if ((cc.xclick || 0) >= 5) set.add('follower');
      if ((cc.imgsave || 0) >= 20) set.add('photog');
      if ((cc.watchclick || 0) >= 3) set.add('watcher');
      if (dc >= 5) set.add('regular5'); if (dc >= 10) set.add('iron');
      if (fk.length >= 3 && dc === fk.length) set.add('attend');
      if (Object.keys(db.scores[u.id] || {}).filter((sid) => songIds.has(sid)).length >= 300) set.add('traveler');
      if ((cc.lost || 0) >= 1) set.add('lost'); if ((cc.maxname || 0) >= 1) set.add('maxname'); if ((cc.burst || 0) >= 1) set.add('burst');
      if ((cc.dawn || 0) >= 1) set.add('dawn'); if ((cc.resize || 0) >= 30) set.add('resizer'); if ((cc.devtools || 0) >= 1) set.add('devtools');
      if ((cc.offline || 0) >= 1) set.add('offline'); ['mash', 'rclick', 'print', 'viewsrc', 'tabhop'].forEach((x) => { if ((cc[x] || 0) >= 1) set.add(x); }); if ((cc.relog || 0) >= 1) set.add('relog');
      if (Object.values(db.changes[u.id] || {}).some((n) => n >= 20)) set.add('infloop');
      const dset = new Set(days.map((d) => d.slice(5)));
      if (dset.has('10-31')) set.add('halloween'); if (dset.has('12-25')) set.add('xmas'); if (dset.has('01-01')) set.add('newyear'); if (dset.has('07-07')) set.add('tanabata'); if (dset.has('11-11')) set.add('pocky');
      if ((cc.zorome || 0) >= 1) set.add('zorome'); if ((cc.kaibun || 0) >= 1) set.add('kaibun'); if ((cc.lucky77 || 0) >= 1) set.add('lucky77');
      { // 連続・組み合わせ系
        const dk = doneKeys[u.id] || [], byCour = {}, byYear = {}, byKind = {};
        dk.forEach((kk) => { const pp = kk.split('-'), cour = pp[0] + '-' + pp[1], kind = pp[2]; (byCour[cour] = byCour[cour] || new Set()).add(kind); (byYear[pp[0]] = byYear[pp[0]] || new Set()).add(Number(pp[1])); (byKind[kind] = byKind[kind] || new Set()).add(Number(pp[0]) * 12 + Number(pp[1])); });
        if (Object.values(byCour).some((x) => x.size >= 2)) set.add('nito');
        if (Object.values(byKind).some((x) => Array.from(x).some((v) => [3, 6, 9, 12].every((d) => x.has(v + d))))) set.add('goren');
        if (Object.values(byYear).some((x) => [1, 4, 7, 10].every((mo) => x.has(mo)))) set.add('shiki');
        if (Object.values(byKind).some((x) => Array.from(x).some((v) => x.has(v + 3) && x.has(v + 6)))) set.add('rensen');
      }
      { // 追加称号の判定
        const act = cc.act || {}, cmdD = cc.cmd || {};
        const nScore = Object.keys(db.scores[u.id] || {}).filter((sid) => songIds.has(sid)).length;
        const nCm = Object.keys(db.comments[u.id] || {}).filter((sid) => songIds.has(sid)).length;
        const SENTI = /涙|泣|感動|感涙|号泣|心に染み|染みる|沁みる|しみる|胸が熱|胸熱|エモ|尊い|鳥肌|じーん|ジーン|心が震|震え/;
        const nSenti = Object.keys(db.comments[u.id] || {}).filter((sid) => songIds.has(sid) && SENTI.test(String(db.comments[u.id][sid]))).length;
        const nMid = Object.keys(db.scores[u.id] || {}).filter((sid) => songIds.has(sid) && typeof db.scores[u.id][sid] === 'number' && db.scores[u.id][sid] >= 4 && db.scores[u.id][sid] <= 5.5).length;
        let maxgap = 0; days.forEach((d, i) => { if (i) maxgap = Math.max(maxgap, Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(days[i - 1] + 'T00:00:00Z')) / 86400000)); });
        let nl = 0, nrun = 0, nprev = null; days.forEach((d) => { if (d < (db.nightFrom || '9999')) { nrun = 0; nprev = null; return; } const t = Date.parse(d + 'T00:00:00Z'); if ((cc.nd || {})[d]) { nrun = 0; nprev = t; return; } nrun = nprev !== null && t - nprev === 86400000 ? nrun + 1 : 1; nprev = t; nl = Math.max(nl, nrun); });
        const nSunny = days.filter((d) => (db.weather || {})[d] === true).length;
        let nExcl = 0; Object.keys(db.texc || {}).forEach((kk) => { if ((db.texc[kk] || []).includes(u.id)) { const sc2 = db.scores[u.id] || {}; if (db.songs.filter((x) => x.key === kk && typeof sc2[x.id] === 'number').length >= 5) nExcl++; } });
        const stat = { days: days.length, streak: best, stayh: (cc.stay || 0) / 3600, scores: nScore, comments: nCm, profiles: Object.keys(cc.profiles || {}).filter((id) => db.people.some((x) => x.id === id)).length, sentiment: nSenti, mid: nMid, maxgap, nightless: nl, sunny: nSunny, excl: nExcl, speed3: speed.has(u.id) ? 1 : 0 };
        EXTRA.forEach((x) => {
          const r = x.rule;
          if (r.cmd) { if (cmdD[x.id]) set.add(x.id); }
          else if (r.act) { if ((act[r.act] || 0) >= r.n) set.add(x.id); }
          else if (r.ctr) { if ((cc[r.ctr] || 0) >= r.n) set.add(x.id); }
          else if (r.visit) { if ((v[r.visit] || 0) >= r.n) set.add(x.id); }
          else if (r.stat) { if (stat[r.stat] >= r.n) set.add(x.id); }
          else if (r.need) { if ((r.need.act || []).every((k) => (act[k] || 0) >= 1) && (r.need.ctr || []).every((k) => (cc[k] || 0) >= 1)) set.add(x.id); }
          else if (r.both) { if (r.both.every((k) => (act[k] || 0) >= 1)) set.add(x.id); }
        });
        const has = (ids) => ids.every((id) => set.has(id));
        const typed = EXTRA.filter((x) => x.rule.seq && x.id !== 'c_space20').map((x) => x.id);
        if (has(typed)) set.add('c_shell');
        if (has(EXTRA.filter((x) => x.cat === 'cmd' && x.id !== 'c_root').map((x) => x.id))) set.add('c_root');
        if (has(EXTRA.filter((x) => x.cat === 'op' && x.id !== 'o_all').map((x) => x.id))) set.add('o_all');
        EXTRA.forEach((x) => { if (x.rule.masterCat && Object.keys(TITLE_META).filter((id) => TITLE_META[id][0] === x.rule.masterCat && id !== x.id && set.has(id)).length >= x.rule.n) set.add(x.id); });
      }
      const CMDS = ['ping', 'traceroute', 'whoami', 'rmrf', 'typeparty', 'typeanison', 'sudo', 'gg', 'calltaiga', 'logo7', 'logohold', 'ctrls', 'esc5', 'tab20'];
      if ((cc.applelink || 0) >= 1) set.add('apple'); if ((cc.starswap || 0) >= 5) set.add('meteor'); if ((cc.stats || 0) >= 1) set.add('selfanalysis');
      if ((cc.pwset || 0) >= 1) set.add('secguard'); if ((cc.csv || 0) >= 1) set.add('comma'); if ((cc.idle1h || 0) >= 1) set.add('idle'); if ((cc.tallypred || 0) >= 1) set.add('shobu');
      if ((cc.rotate || 0) >= 1) set.add('rotate'); if ((cc.themechg || 0) >= 1) set.add('themechg'); if ((cc.zoom || 0) >= 1) set.add('zoom'); if ((cc.allsel || 0) >= 1) set.add('allsel'); if ((cc.reload || 0) >= 20) set.add('reloader');
      CMDS.forEach((id) => { if ((cc.cmd || {})[id]) set.add(id); });
      if (CMDS.every((id) => set.has(id))) set.add('allcmd');
      if ((cc.bug || 0) >= 1) set.add('bughunter');
      if ((cc.frozenTry || 0) >= 1) set.add('debugger');
      if (Object.keys(db.comments[u.id] || {}).some((sid) => Array.from(db.comments[u.id][sid]).length === 100) && Array.from(u.bio || '').length === 200) set.add('boundary');
    }
    const mine = ws.get(u.id);
    if (mine) {
      let near = 0, far = 0;
      for (const [oid, o] of ws) {
        if (oid === u.id) continue; const cp = compatOf(mine, o);
        if (cp.n >= 10) { if (cp.pct >= 90) set.add('resonance'); if (cp.pct >= 99) set.add('soulmate'); near++; if (cp.pct < 60) far++; }
      }
      if (near >= 3 && far === near) set.add('loner');
    }
    if (set.size) out.set(u.id, set);
  });
  const QA = ['bughunter', 'debugger', 'boundary', 'lost', 'maxname', 'burst', 'dawn', 'resizer', 'devtools', 'offline', 'relog', 'infloop', 'rotate', 'themechg', 'zoom', 'allsel', 'reloader', 'mash', 'rclick', 'print', 'viewsrc', 'tabhop'];
  out.forEach((set) => { if (QA.every((id) => set.has(id))) set.add('qa'); });
  db.people.forEach((u) => { if (isAdminPerson(u.id)) { if (!out.has(u.id)) out.set(u.id, new Set()); out.get(u.id).add('power'); if (isOwner(u.id)) out.get(u.id).add('owner'); } });
  out.forEach((set, pid) => {
    if (isOwner(pid)) return; // taetae(サイト管理者)の称号は、獲得数に含めない
    let n = 0; set.forEach((id) => { const d = TITLE_BY_ID[id]; if (d && !d.hidden && !d.special) n++; });
    if (n >= 10) set.add('hunter'); if (n >= 20) set.add('collector'); if (n >= 50) set.add('tking');
    EXTRA.forEach((x) => { if (x.rule.cnt > 0 && n >= x.rule.cnt) set.add(x.id); });
    const allIds = TITLE_DEFS.filter((d) => !d.hidden && !d.special && d.id !== 't_all').map((d) => d.id); if (allIds.every((id) => set.has(id))) set.add('t_all');
  });
  emVer = VER; emCver = CVER; emMemo = out; return out;
}
// 獲得した称号を保存する(一度獲得した称号は、あとから条件を外れても残る)
function awardFor(pid) {
  let any = false;
  for (let i = 0; i < 3; i++) {
    const set = computeEarned().get(pid); if (!set) break;
    const T = (db.titles[pid] = db.titles[pid] || {}); let added = false;
    set.forEach((id) => { if (!T[id] && !(TITLE_BY_ID[id] && TITLE_BY_ID[id].special)) { T[id] = { at: Date.now(), seen: false }; added = true; } });
    if (T && !Object.keys(T).length) delete db.titles[pid];
    if (!added) break;
    any = true; CVER++; // 獲得数に応じた称号を、続けて判定する
  }
  if (updateThrone()) any = true;
  return any;
}
// 玉座: 称号の獲得数が最も多いユーザー(管理者は除く)。同数のときは、いま持っている人を優先
function updateThrone() {
  const cnt = (pid) => Object.keys(db.titles[pid] || {}).filter((id) => TITLE_BY_ID[id] && !TITLE_BY_ID[id].hidden && !TITLE_BY_ID[id].special).length;
  let best = 0, top = [];
  db.people.forEach((u) => { if (isOwner(u.id)) return; const n = cnt(u.id); if (n > best) { best = n; top = [u.id]; } else if (n === best && n > 0) top.push(u.id); });
  const cur = db.throne && db.people.some((x) => x.id === db.throne) ? db.throne : null;
  const next = !top.length ? null : (cur && top.includes(cur) ? cur : top[0]);
  if (next === (db.throne || null) && (!next || (db.titles[next] || {}).x_throne)) return false;
  if (db.throne && db.titles[db.throne]) { delete db.titles[db.throne].x_throne; if (!Object.keys(db.titles[db.throne]).length) delete db.titles[db.throne]; }
  db.throne = next;
  if (next) (db.titles[next] = db.titles[next] || {}).x_throne = { at: Date.now(), seen: false };
  return true;
}
function awardAll() { db.people.forEach((u) => awardFor(u.id)); }
// 名前の変更などで存在しなくなった称号の記録を取り除く
function purgeTitles() { let ch = false; Object.keys(db.titles).forEach((pid) => { Object.keys(db.titles[pid]).forEach((id) => { if (!TITLE_BY_ID[id]) { delete db.titles[pid][id]; ch = true; } }); if (!Object.keys(db.titles[pid]).length) { delete db.titles[pid]; ch = true; } }); db.people.forEach((u) => { if (u.equip && !TITLE_BY_ID[u.equip]) { delete u.equip; ch = true; } if (Array.isArray(u.showT) && u.showT.some((x) => !TITLE_BY_ID[x])) { u.showT = u.showT.filter((x) => TITLE_BY_ID[x]); ch = true; } }); return ch; }
const titleSortKey = (id) => TITLE_CATS.findIndex((c) => c[0] === TITLE_META[id][0]);
function shownTitles(u) {
  const T = db.titles[u.id] || {}, ok = (id) => T[id] && TITLE_BY_ID[id] && canSeeT(TITLE_BY_ID[id], u.id);
  const sortf = (a, b) => titleSortKey(a) - titleSortKey(b) || TITLE_META[b][1] - TITLE_META[a][1];
  if (Array.isArray(u.showT)) return u.showT.filter(ok).sort(sortf);
  const all = Object.keys(T).filter(ok);
  if (all.length <= 10) return all.sort(sortf);
  return all.sort((a, b) => TITLE_META[b][1] - TITLE_META[a][1] || T[a].at - T[b].at).slice(0, 10).sort(sortf);
}
function equippedOf(u) {
  const T = db.titles[u.id] || {};
  if (u.equip === '') return null;
  if (u.equip && T[u.equip] && TITLE_BY_ID[u.equip] && canSeeT(TITLE_BY_ID[u.equip], u.id)) return u.equip;
  if (isAdminPerson(u.id) && u.equip === undefined) { if (T.owner) return 'owner'; if (T.power) return 'power'; }
  for (let i = 5; i >= 1; i--) if (T['rank' + i]) return 'rank' + i;
  return null;
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req, p === '/api/me/icon' ? 450000 : 0);

  if (m === 'GET' && p === '/api/songs') {
    return send(res, 200, { songs: db.songs.map(({ id, key, title, artist, anime, at, ord }) => ({ id, key, title, artist, anime, at, ord: ord != null ? ord : at })), playlists: db.playlists, years: db.years, notices: db.notices.slice().reverse(), deadlines: db.deadlines, modes: publicModes(), links: db.links.map(({ id, key, title, artist, url }) => ({ id, key, title, artist, url })) });
  }
  const icm = p.match(/^\/api\/icon\/([0-9a-z]+)$/);
  if (m === 'GET' && icm) {
    const u = db.people.find((x) => x.id === icm[1]);
    if (!u || !u.icon) throw new HttpError(404, 'アイコンがありません');
    let buf; try { buf = fs.readFileSync(iconFile(u.id)); } catch (e) { throw new HttpError(404, 'アイコンがありません'); }
    return send(res, 200, buf, { 'Content-Type': 'image/' + (u.icon.ext === 'jpeg' ? 'jpeg' : 'png'), 'Cache-Control': 'public, max-age=31536000, immutable' });
  }
  if (m === 'GET' && p === '/api/staff') {
    // 管理者のログイン名は出さず、Xのリンクだけを公開する
    return send(res, 200, { staff: db.admins.filter((a) => a.x).map((a) => ({ x: a.x })) });
  }
  if (m === 'GET' && p === '/api/pasts') {
    return send(res, 200, { pasts: db.pasts.map(({ id, key, title, url, at }) => ({ id, key, title, url, at })) });
  }
  if (m === 'GET' && p === '/api/table') {
    // Party Watchモードのランキングだけ、全体表とひとことを一般にも公開する
    const key = url.searchParams.get('key') || '';
    if (!validKey(key)) throw bad('区分が正しくありません');
    if (modeOf(key) !== 'watch') throw new HttpError(403, 'このランキングの全体表はまだ公開されていません');
    const t = buildTable(key);
    return send(res, 200, t);
  }
  if (p === '/api/me/stats' && m === 'GET') {
    const me = person(req); bump(me.id, 'stats');
    const sc = db.scores[me.id] || {}, dist = {}, per = {}, mine = [];
    db.songs.forEach((sg) => {
      const v = sc[sg.id]; if (typeof v !== 'number') return;
      dist[v] = (dist[v] || 0) + 1; mine.push({ title: sg.title, key: sg.key, v });
      const o = (per[sg.key] = per[sg.key] || { key: sg.key, n: 0, sum: 0, total: 0 }); o.n++; o.sum += v;
    });
    db.songs.forEach((sg) => { if (per[sg.key]) per[sg.key].total++; });
    const ord = (k) => { const q = k.split('-'); return Number(q[0]) * 100 + Number(q[1]) + KINDS.indexOf(q[2]) / 10; };
    const keys = Object.values(per).sort((a, b) => ord(a.key) - ord(b.key)).map((o) => ({ key: o.key, label: labelOf(o.key), n: o.n, total: o.total, avg: o.sum / o.n, all: modeOf(o.key) === 'watch' ? (tableOf(o.key).overallAvg == null ? null : tableOf(o.key).overallAvg) : null }));
    mine.sort((a, b) => b.v - a.v);
    const tot = mine.length, sum = mine.reduce((a, x) => a + x.v, 0);
    return send(res, 200, { total: tot, avg: tot ? sum / tot : null, dist, keys, top: mine.slice(0, 3).map((x) => ({ title: x.title, label: labelOf(x.key), v: x.v })), low: mine.slice(-3).reverse().map((x) => ({ title: x.title, label: labelOf(x.key), v: x.v })) });
  }
  if (p === '/api/me/ping' && m === 'POST') { const me = person(req); SEEN[me.id] = Date.now(); return send(res, 200, { ok: true }); }
  if (p === '/api/online' && m === 'GET') {
    const list = db.people.filter((u) => isOn(u.id)).map((u) => ({ id: u.id, ic: iconAt(u), name: u.name, adm: isAdminPerson(u.id) }));
    const bn = db.banner && db.banner.on ? (db.banner.text || BANNER_DEFAULT) : '';
    return send(res, 200, { count: list.length, people: list, banner: bn });
  }
  if (m === 'GET' && p === '/api/participants') {
    // 名前と採点した曲数だけを返す(点数・コメントは含めない)
    const songKey = {}, total = {};
    db.songs.forEach((s) => { songKey[s.id] = s.key; total[s.key] = (total[s.key] || 0) + 1; });
    const by = {};
    db.people.forEach((u) => {
      const cnt = {};
      Object.keys(db.scores[u.id] || {}).forEach((sid) => { if (songKey[sid]) cnt[songKey[sid]] = (cnt[songKey[sid]] || 0) + 1; });
      Object.keys(cnt).forEach((k) => { (by[k] = by[k] || []).push({ id: u.id, ic: iconAt(u), name: u.name, adm: isAdminPerson(u.id), scored: cnt[k] }); });
    });
    return send(res, 200, { people: db.people.map((u) => ({ id: u.id, ic: iconAt(u), name: u.name, adm: isAdminPerson(u.id), on: !!isOn(u.id), tn: isOwner(u.id) ? null : Object.keys(db.titles[u.id] || {}).filter((t) => TITLE_BY_ID[t] && !TITLE_BY_ID[t].hidden).length })), keys: Object.keys(total).map((k) => ({ key: k, songs: total[k], participants: (by[k] || []).sort((a, b) => b.scored - a.scored || a.name.localeCompare(b.name, 'ja')) })) });
  }
  const optPerson = () => { const t = bearer(req); return (t && db.people.find((x) => x.token === t)) || null; };
  if (p === '/api/me/titles' && m === 'GET') {
    const me = person(req);
    if (awardFor(me.id)) save();
    const T = db.titles[me.id] || {};
    const vis = TITLE_DEFS.filter((d) => canSeeT(d, me.id));
    const hc = {}; Object.keys(db.titles).forEach((pid) => Object.keys(db.titles[pid]).forEach((id) => { hc[id] = (hc[id] || 0) + 1; }));
    const earned = vis.filter((d) => T[d.id]).map((d) => ({ id: d.id, name: d.name, desc: d.desc, holders: hc[d.id] || 0, cat: TITLE_META[d.id][0], lv: TITLE_META[d.id][1], ord: TITLE_ORD[d.id], song: SONG_SET.has(d.id), at: T[d.id].at, fresh: !T[d.id].seen }));
    const songLocked = vis.filter((d) => !T[d.id] && SONG_SET.has(d.id)).map((d) => TITLE_META[d.id][1]);
    const lockedBy = {}; vis.filter((d) => !T[d.id]).forEach((d) => { const mt = TITLE_META[d.id]; (lockedBy[mt[0]] = lockedBy[mt[0]] || []).push(mt[1]); });
    return send(res, 200, { earned, locked: vis.length - earned.length, total: vis.length, equipped: equippedOf(me) || '', cats: TITLE_CATS, lockedBy, songLocked, songOrder: songOrder2(), songNotes: (db.songTitles || {}).notes || {}, people: db.people.length, shown: shownTitles(me), customShown: Array.isArray(me.showT) });
  }
  if (p === '/api/me/show-titles' && m === 'PUT') {
    const me = person(req);
    if (body.ids === null) { delete me.showT; save(); return send(res, 200, { shown: shownTitles(me), custom: false }); }
    const T = db.titles[me.id] || {};
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : null;
    if (!ids || ids.length > 10) throw bad('表示できる称号は、最大10個までです');
    if (!ids.every((x) => T[x] && TITLE_BY_ID[x] && canSeeT(TITLE_BY_ID[x], me.id))) throw bad('獲得していない称号は選べません');
    me.showT = ids; save();
    return send(res, 200, { shown: shownTitles(me), custom: true });
  }
  if (p === '/api/me/titles/seen' && m === 'POST') {
    const me = person(req); const T = db.titles[me.id] || {};
    Object.keys(T).forEach((id) => { T[id].seen = true; }); save();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/me/title' && m === 'PUT') {
    const me = person(req); const T = db.titles[me.id] || {};
    if (body.id === null || body.id === '') me.equip = '';
    else if (typeof body.id === 'string' && T[body.id]) me.equip = body.id;
    else throw bad('その称号はまだ獲得していません');
    bump(me.id, 'equip');
    save();
    return send(res, 200, { equipped: equippedOf(me) || '' });
  }
  if (p === '/api/me/event' && m === 'POST') {
    const me = person(req);
    if (limited(req, 'ev', 300, 60000)) throw new HttpError(429, '操作が多すぎます');
    const type = String(body.type || ''), c = ctr(me.id), now = Date.now();
    const SIMPLE = ['ghost', 'adminpeek', 'applelink', 'csv', 'idle1h', 'rotate', 'themechg', 'zoom', 'allsel', 'reload', 'mash', 'rclick', 'print', 'viewsrc', 'tabhop', 'lost', 'resize', 'devtools', 'offline', 'relog', 'pastclick', 'imgsave', 'invite', 'news', 'f5', 'bug', 'watchclick', 'xclick'];
    if (SIMPLE.includes(type)) bump(me.id, type);
    else if (type === 'stay') { if (!c.lastStay || now - c.lastStay >= 45000) { c.stay = (c.stay || 0) + 60; c.lastStay = now; } }
    else if (type === 'visit') {
      const r = String(body.r || '');
      if (!['about', 'notices', 'invite', 'pasts', 'people', 'profile', 'titles', 'predict', 'compat'].includes(r)) throw bad('ページが正しくありません');
      c.visits = c.visits || {}; c.visits[r] = (c.visits[r] || 0) + 1;
    } else if (type === 'profile') {
      const pid = String(body.id || '');
      if (pid !== me.id && db.people.some((x) => x.id === pid)) { c.profiles = c.profiles || {}; if (Object.keys(c.profiles).length < 500) c.profiles[pid] = 1; }
    } else if (type === 'dev') {
      const dv = String(body.d || '');
      if (/^[0-9a-z]{8,40}$/.test(dv)) {
        db.devices = db.devices || {};
        if (Object.keys(db.devices).length < 5000 || db.devices[dv]) {
          const L = (db.devices[dv] = db.devices[dv] || []);
          if (!L.includes(me.id) && L.length < 20) { L.push(me.id); if (L.length >= 2) L.forEach((x) => { ctr(x).multiuser = 1; }); }
        }
      }
    } else if (type === 'act') {
      const mm = body.m && typeof body.m === 'object' ? body.m : {};
      c.act = c.act || {};
      Object.keys(mm).slice(0, 40).forEach((k) => { const n = Math.floor(Number(mm[k])); if (EXTRA_ACT.has(k) && n >= 1) c.act[k] = Math.min(1e7, (c.act[k] || 0) + Math.min(n, 2000)); });
    } else if (type === 'cmd') {
      const cid = String(body.c || '');
      if (!['ping', 'traceroute', 'whoami', 'rmrf', 'typeparty', 'typeanison', 'sudo', 'gg', 'calltaiga', 'logo7', 'logohold', 'ctrls', 'esc5', 'tab20'].concat(EXTRA_CMD).includes(cid)) throw bad('コマンドが正しくありません');
      c.cmd = c.cmd || {}; c.cmd[cid] = 1;
    } else throw bad('種類が正しくありません');
    save(true);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/me/predict' && m === 'GET') {
    const me = person(req), key = clean(url.searchParams.get('key'), 20);
    if (!validKey(key)) throw bad('区分が正しくありません');
    return send(res, 200, { pred: ((db.pred[key] || {})[me.id]) || null, locked: modeOf(key) === 'watch', once: modeOf(key) === 'tally' });
  }
  if (p === '/api/me/predict' && m === 'PUT') {
    const me = person(req), key = clean(body.key, 20);
    if (!validKey(key)) throw bad('区分が正しくありません');
    const mdk = modeOf(key);
    if (mdk === 'watch') { bump(me.id, 'frozenTry'); save(); throw new HttpError(403, 'このランキングは公開済みのため、予想できません'); }
    if (mdk === 'tally' && (db.pred[key] || {})[me.id]) { bump(me.id, 'frozenTry'); save(); throw new HttpError(403, '集計中の予想は一度限りです。すでに提出済みのため、変更できません'); }
    const ids = new Set(db.songs.filter((x) => x.key === key).map((x) => x.id));
    const chk = (a) => Array.isArray(a) && a.length === 3 && a.every((v) => typeof v === 'string' && ids.has(v)) && new Set(a).size === 3;
    if (!chk(body.top) || !chk(body.worst)) throw bad('トップ3とワースト3を、重ならないように3曲ずつ選んでください');
    if (body.top.some((v) => body.worst.includes(v))) throw bad('トップ3とワースト3で、同じ曲は選べません');
    if (mdk === 'tally') bump(me.id, 'tallypred');
    (db.pred[key] = db.pred[key] || {})[me.id] = { top: body.top, worst: body.worst, at: Date.now() };
    save();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/predict-result' && m === 'GET') {
    const key = clean(url.searchParams.get('key'), 20);
    if (!validKey(key)) throw bad('区分が正しくありません');
    if (modeOf(key) !== 'watch') throw new HttpError(403, '予想の結果は、Party Watchになると見られます');
    const T = tableOf(key), ranked = T.rows.filter((r) => r.avg != null);
    const asc = ranked.slice().reverse();
    const pick = (list, f) => list.filter((r, i) => i < 3 || f(r)).map((r) => ({ id: r.id, title: r.title, avg: r2(r.avg) }));
    const thr = (list) => list.length >= 3 ? Math.round(list[2].avg * 1000) : null;
    return send(res, 200, {
      top: pick(ranked, (r) => Math.round(r.avg * 1000) === thr(ranked)), worst: pick(asc, (r) => Math.round(r.avg * 1000) === thr(asc)),
      board: predBoard(key),
    });
  }
  if (p === '/api/me/compat' && m === 'GET') {
    const me = person(req), ws = watchScores(), mine = ws.get(me.id);
    const list = [];
    if (mine) for (const [oid, o] of ws) {
      if (oid === me.id) continue;
      const u = db.people.find((x) => x.id === oid); if (!u) continue;
      const cp = compatOf(mine, o);
      if (cp.n >= 5) list.push({ id: u.id, name: u.name, ic: iconAt(u), adm: isAdminPerson(u.id), pct: cp.pct, n: cp.n });
    }
    list.sort((a, b) => b.pct - a.pct || b.n - a.n);
    return send(res, 200, { list, mySongs: mine ? Object.keys(mine).length : 0, watchKeys: allKeys().filter((k) => modeOf(k) === 'watch').length });
  }
  if (p === '/api/reacts' && m === 'GET') {
    const key = clean(url.searchParams.get('key'), 20);
    if (!validKey(key)) throw bad('区分が正しくありません');
    const me = optPerson(), counts = {}, mine = {};
    if (modeOf(key) === 'watch') db.songs.filter((x) => x.key === key).forEach((song) => {
      Object.keys(db.reacts).forEach((ck) => {
        if (!ck.startsWith(song.id + ':')) return;
        const o = {}; EMOJIS.forEach((e) => { const l = db.reacts[ck][e] || []; if (l.length) o[e] = l.length; if (me && l.includes(me.id)) (mine[ck] = mine[ck] || []).push(e); });
        if (Object.keys(o).length) counts[ck] = o;
      });
    });
    return send(res, 200, { counts, mine, emojis: EMOJIS });
  }
  if (p === '/api/me/react' && m === 'POST') {
    const me = person(req);
    if (limited(req, 'rx', 120, 60000)) throw new HttpError(429, '操作が多すぎます');
    const song = db.songs.find((x) => x.id === body.songId), owner = String(body.owner || ''), em = String(body.emoji || '');
    if (!song || !EMOJIS.includes(em) || !/^[0-9a-z]+$/.test(owner)) throw bad('リアクションを送れませんでした');
    if (modeOf(song.key) !== 'watch') throw new HttpError(403, 'リアクションは、Party Watchになってから使えます');
    if (!((db.comments[owner] || {})[song.id])) throw bad('そのひとことは見つかりません');
    const ck = song.id + ':' + owner, R = (db.reacts[ck] = db.reacts[ck] || {}), l = (R[em] = R[em] || []);
    const i = l.indexOf(me.id); if (i >= 0) l.splice(i, 1); else l.push(me.id);
    if (!l.length) delete R[em]; if (!Object.keys(R).length) delete db.reacts[ck];
    save();
    return send(res, 200, { ok: true });
  }
  const prm = p.match(/^\/api\/profile\/([0-9a-z]+)$/);
  if (m === 'GET' && prm) {
    const u = db.people.find((x) => x.id === prm[1]);
    if (!u) throw new HttpError(404, 'ユーザーが見つかりません');
    const n = rankCount(u.id), tid = equippedOf(u);
    return send(res, 200, { id: u.id, name: u.name, ic: iconAt(u), at: u.at || 0, x: u.x || '', bio: u.bio || '', count: n, tid: tid || '', title: tid ? TITLE_BY_ID[tid].name : '', tn: isOwner(u.id) ? null : Object.keys(db.titles[u.id] || {}).filter((t) => TITLE_BY_ID[t] && !TITLE_BY_ID[t].hidden).length, titles: shownTitles(u).map((t) => ({ id: t, name: TITLE_BY_ID[t].name })), adm: isAdminPerson(u.id) });
  }
  if (p === '/api/me/profile' && m === 'PUT') {
    const me = person(req);
    const x = normX(body.x);
    if (x === null) throw bad('Xのアカウントは、@ID か https://x.com/ID の形で入力してください(IDは英数字と_、15文字まで)');
    const bio = cleanBio(body.bio);
    if (SUS.test(bio)) bump(me.id, 'inject');
    if ((me.bio || '') !== bio) bump(me.id, 'bioedit');
    if (bio) me.bio = bio; else delete me.bio;
    if (x) me.x = x; else delete me.x;
    save();
    return send(res, 200, { bio: me.bio || '', x: me.x || '' });
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
    if (Array.from(name).length === 30) bump(np.id, 'maxname');
    if (pass) { np.salt = crypto.randomBytes(16).toString('hex'); np.hash = hashPw(pass, np.salt); }
    db.people.push(np); save();
    return send(res, 200, { token: np.token, name: np.name });
  }
  if (p === '/api/me' && m === 'GET') {
    const me = person(req);
    { const c = ctr(me.id), d = jstDay(Date.now()); c.days = c.days || {}; if (!c.days[d]) { c.days[d] = 1; save(true); } { const hh = new Date(Date.now() + 9 * 3600000).getUTCHours(); if (hh >= 19 || hh < 4) { c.nd = c.nd || {}; if (!c.nd[d]) { c.nd[d] = 1; save(true); } } } ensureWeather(d); if (new Date(Date.now() + 9 * 3600000).getUTCHours() === 3 && !c.dawn) { c.dawn = 1; save(); } }
    return send(res, 200, { id: me.id, icon: iconAt(me), name: me.name, hasPass: !!me.hash, scores: db.scores[me.id] || {}, stars: db.stars[me.id] || {}, comments: db.comments[me.id] || {} });
  }
  if (p === '/api/me/icon' && m === 'PUT') {
    const me = person(req);
    if (limited(req, 'icon', 30, 15 * 60000)) throw new HttpError(429, '操作が多すぎます。しばらくしてからやり直してください');
    const mt = String(body.data || '').match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    if (!mt) throw bad('PNGまたはJPEGの画像を選んでください');
    const buf = Buffer.from(mt[2], 'base64');
    const kind = sniffIcon(buf);
    if (!kind || buf.length > 300000) throw bad('画像が正しくないか、大きすぎます(300KBまで)');
    fs.mkdirSync(ICON_DIR, { recursive: true });
    fs.writeFileSync(iconFile(me.id), buf);
    me.icon = { ext: kind, at: Date.now() }; bump(me.id, 'iconset'); save();
    return send(res, 200, { icon: me.icon.at });
  }
  if (p === '/api/me/icon' && m === 'DELETE') {
    const me = person(req);
    try { fs.unlinkSync(iconFile(me.id)); } catch (e) { /* なし */ }
    delete me.icon; save();
    return send(res, 200, { icon: 0 });
  }
  if (p === '/api/me/score' && m === 'PUT') {
    const me = person(req);
    const song = db.songs.find((s) => s.id === body.songId);
    if (!song) throw bad('曲が見つかりません');
    if (frozen(song.key)) { bump(me.id, 'frozenTry'); save(); throw new HttpError(403, 'このランキングは集計中(または公開済み)のため、点数を変更できません'); }
    const sc = (db.scores[me.id] = db.scores[me.id] || {});
    const stp = (db.stamps[me.id] = db.stamps[me.id] || {});
    if (body.score === null) { delete sc[song.id]; delete stp[song.id]; }
    else if (isScore(body.score)) {
      if (typeof sc[song.id] === 'number' && sc[song.id] !== body.score) { const ch = (db.changes[me.id] = db.changes[me.id] || {}); ch[song.id] = (ch[song.id] || 0) + 1; }
      sc[song.id] = body.score; if (!stp[song.id]) stp[song.id] = Date.now(); luckyTime(me.id);
    }
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
      const cur = db.songs.find((s) => s.id === st[c]);
      if (cur && frozen(cur.key)) { bump(me.id, 'frozenTry'); save(); throw new HttpError(403, '集計中(または公開済み)のため、☆を変更できません'); }
      delete st[c];
    } else {
      const song = db.songs.find((s) => s.id === body.songId);
      if (!song) throw bad('曲が見つかりません');
      const cur = db.songs.find((s) => s.id === st[courOf(song.key)]);
      if (frozen(song.key) || (cur && frozen(cur.key))) { bump(me.id, 'frozenTry'); save(); throw new HttpError(403, '集計中(または公開済み)のため、☆を変更できません'); }
      if (st[courOf(song.key)] && st[courOf(song.key)] !== song.id) bump(me.id, 'starswap');
      if (st[courOf(song.key)] !== song.id) bump(me.id, 'starset');
      st[courOf(song.key)] = song.id;
    }
    save();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/me/comment' && m === 'PUT') {
    const me = person(req);
    const song = db.songs.find((s) => s.id === body.songId);
    if (!song) throw bad('曲が見つかりません');
    if (frozen(song.key)) { bump(me.id, 'frozenTry'); save(); throw new HttpError(403, '集計中(または公開済み)のため、ひとことを変更できません'); }
    const text = clean(body.text, 100);
    if (SUS.test(text)) bump(me.id, 'inject');
    const cm = (db.comments[me.id] = db.comments[me.id] || {});
    if (text) {
      cm[song.id] = text; luckyTime(me.id);
      const ch = Array.from(text); if (ch.length === 77) bump(me.id, 'lucky77');
      const sq = ch.filter((c) => /[\p{L}\p{N}]/u.test(c)).map((c) => c.toLowerCase()); if (sq.length >= 3 && sq.join('') === sq.slice().reverse().join('')) bump(me.id, 'kaibun');
    } else delete cm[song.id];
    save();
    return send(res, 200, { ok: true, text });
  }
  if (p === '/api/me/name' && m === 'PUT') {
    const me = person(req);
    if (limited(req, 'pw', 10, 15 * 60000)) throw new HttpError(429, '試行回数が多すぎます。15分後にやり直してください');
    const name = clean(body.name, 30), pass = String(body.pass || '');
    if (!me.hash) throw bad('合言葉が未設定です。メニューの「合言葉の再設定」で先に合言葉を設定してください');
    if (!pass || !checkPw(pass, me.salt, me.hash)) throw new HttpError(403, '合言葉が違います');
    if (!name) throw bad('名前を入力してください');
    if (db.people.some((x) => x.id !== me.id && x.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'その名前はすでに使われています');
    me.name = name; bump(me.id, 'rename'); if (Array.from(name).length === 30) bump(me.id, 'maxname'); save();
    return send(res, 200, { name });
  }
  if (p === '/api/me/password' && m === 'PUT') {
    const me = person(req);
    if (limited(req, 'pw', 10, 15 * 60000)) throw new HttpError(429, '試行回数が多すぎます。15分後にやり直してください');
    const cur = String(body.current || ''), next = clean(body.next, 60);
    if (me.hash && (!cur || !checkPw(cur, me.salt, me.hash))) throw new HttpError(403, '現在の合言葉が違います');
    if (next.length < 4) throw bad('新しい合言葉は4文字以上にしてください');
    me.salt = crypto.randomBytes(16).toString('hex'); me.hash = hashPw(next, me.salt); bump(me.id, 'pwset'); save();
    return send(res, 200, { ok: true });
  }

  /* --- 管理者 --- */
  if (p === '/api/admin/login' && m === 'POST') {
    if (limited(req, 'login', 8, 15 * 60000)) throw new HttpError(429, 'ログインの試行回数が多すぎます。15分後にやり直してください');
    const name = clean(body.name, 30), pw = String(body.password || '');
    const a = db.admins.find((x) => x.name === name);
    // 管理者名の有無が分からないよう、どちらの場合も同じ計算をする
    const ok = checkPw(pw, a ? a.salt : '0'.repeat(32), a ? a.hash : '0'.repeat(64)) && !!a;
    if (!a && body.person) {
      // 管理者に登録されていない名前での入室 → 称号「不法侵入者」
      const me = db.people.find((x) => x.token === String(body.person));
      if (me) { const c = (db.counters[me.id] = db.counters[me.id] || {}); c.intruder = 1; awardFor(me.id); save(); }
    }
    if (!ok) throw new HttpError(401, '管理者名かパスワードが違います');
    const t = token();
    const me = body.person && db.people.find((x) => x.token === String(body.person));
    if (me) a.pid = me.id; // ユーザーとしてもログイン中なら、そのユーザーに管理者タグをつける
    db.sessions[t] = { name: a.name, exp: Date.now() + SESSION_MS }; save();
    return send(res, 200, { token: t, name: a.name });
  }
  if (p.startsWith('/api/admin/')) {
    const s = admin(req);
    if (p === '/api/admin/logout' && m === 'POST') { delete db.sessions[bearer(req)]; save(); return send(res, 200, { ok: true }); }
    if (p === '/api/admin/table' && m === 'GET') {
      const key = url.searchParams.get('key') || '';
      if (!validKey(key)) throw bad('区分が正しくありません');
      return send(res, 200, adminTbl(key));
    }
    if (p === '/api/admin/table-users' && m === 'PUT') {
      const key = clean(body.key, 20);
      if (!validKey(key)) throw bad('区分が正しくありません');
      const cand = candOf(key).map((c) => c.id), inc = new Set((Array.isArray(body.ids) ? body.ids : []).filter((v) => typeof v === 'string'));
      const ex = cand.filter((id) => !inc.has(id));
      if (ex.length) db.texc[key] = ex; else delete db.texc[key];
      save();
      return send(res, 200, adminTbl(key));
    }
    if (p === '/api/admin/titles' && m === 'GET') {
      const cnt = {}; Object.keys(db.titles).forEach((pid) => Object.keys(db.titles[pid]).forEach((id) => { cnt[id] = (cnt[id] || 0) + 1; }));
      const who = {}; db.people.forEach((u) => { Object.keys(db.titles[u.id] || {}).forEach((id) => { (who[id] = who[id] || []).push(u.name); }); });
      const byPerson = db.people.map((u) => ({ id: u.id, name: u.name, adm: isAdminPerson(u.id), owner: isOwner(u.id), titles: TITLE_DEFS.filter((d) => (db.titles[u.id] || {})[d.id]).map((d) => d.id) })).filter((x) => x.titles.length);
      return send(res, 200, { songOrder: songOrder2(), songNotes: (db.songTitles || {}).notes || {}, cats: TITLE_CATS, titles: TITLE_DEFS.map((d) => ({ id: d.id, name: d.name, desc: d.desc, hidden: !!d.hidden, cat: TITLE_META[d.id][0], lv: TITLE_META[d.id][1], ord: TITLE_ORD[d.id], song: SONG_SET.has(d.id), holders: cnt[d.id] || 0, who: (who[d.id] || []).slice(0, 300) })), people: db.people.length, byPerson });
    }
    if (p === '/api/admin/banner' && m === 'GET') return send(res, 200, { on: !!(db.banner && db.banner.on), text: (db.banner && db.banner.text) || '', def: BANNER_DEFAULT });
    if (p === '/api/admin/banner' && m === 'PUT') {
      db.banner = { on: !!body.on, text: clean(body.text, 200) }; save();
      return send(res, 200, { on: db.banner.on, text: db.banner.text, def: BANNER_DEFAULT });
    }
    if (p === '/api/admin/song-titles' && m === 'PUT') {
      const ord = (Array.isArray(body.order) ? body.order : []).filter((id) => typeof id === 'string' && SONG_SET.has(id));
      const notes = {}; if (body.notes && typeof body.notes === 'object') Object.keys(body.notes).forEach((id) => { if (SONG_SET.has(id)) { const t = clean(body.notes[id], 300); if (t) notes[id] = t; } });
      db.songTitles = { order: [...new Set(ord)], notes }; save();
      return send(res, 200, { songOrder: songOrder2(), songNotes: notes });
    }
    if (p === '/api/admin/table-order' && m === 'PUT') {
      const key = clean(body.key, 20);
      if (!validKey(key)) throw bad('区分が正しくありません');
      const ids = (Array.isArray(body.ids) ? body.ids : []).filter((v) => typeof v === 'string' && /^[0-9a-z]+$/.test(v)).slice(0, 500);
      if (ids.length) db.torder[key] = [...new Set(ids)]; else delete db.torder[key];
      save();
      return send(res, 200, adminTbl(key));
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
      song.ord = Math.max(-1, ...db.songs.filter((x) => x.key === key).map((x) => (x.ord != null ? x.ord : x.at))) + 1;
      db.songs.push(song); save();
      return send(res, 200, song);
    }
    if (p === '/api/admin/songs-bulk' && m === 'POST') {
      const key = clean(body.key, 20);
      if (!validKey(key)) throw bad('区分が正しくありません');
      const lines = String(body.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 300);
      if (!lines.length) throw bad('曲の一覧を貼り付けてください');
      const cur = db.songs.filter((x) => x.key === key);
      let ordv = Math.max(-1, ...cur.map((x) => (x.ord != null ? x.ord : x.at))) + 1, added = 0, skipped = 0;
      const seen = new Set(cur.map((x) => x.title + '\u0000' + x.artist));
      lines.forEach((l) => {
        const parts = (l.includes('\t') ? l.split('\t') : l.includes(' / ') ? l.split(' / ') : l.includes('／') ? l.split('／') : l.split(',')).map((x) => x.trim());
        const title = clean(parts[0], 80), artist = clean(parts[1] || '', 60), anime = clean(parts[2] || '', 80);
        if (!title || seen.has(title + '\u0000' + artist)) { skipped++; return; }
        seen.add(title + '\u0000' + artist);
        db.songs.push({ id: id(), key, title, artist, anime, at: Date.now() + added, ord: ordv++ }); added++;
      });
      if (added) save();
      return send(res, 200, { added, skipped });
    }
    if (p === '/api/admin/songs/order' && m === 'PUT') {
      const key = clean(body.key, 20);
      if (!validKey(key)) throw bad('区分が正しくありません');
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const cur = db.songs.filter((x) => x.key === key);
      if (ids.length !== cur.length || new Set(ids).size !== ids.length || !ids.every((i) => cur.some((x) => x.id === i))) throw bad('曲の一覧が最新ではありません。画面を更新してやり直してください');
      ids.forEach((i, n) => { db.songs.find((x) => x.id === i).ord = n; });
      save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/deadline' && m === 'PUT') {
      const key = clean(body.key, 20);
      if (!validKey(key)) throw bad('区分が正しくありません');
      if (body.at == null || body.at === '') { delete db.deadlines[key]; save(); return send(res, 200, { deadlines: db.deadlines }); }
      const at = Number(body.at);
      if (!Number.isFinite(at) || at < Date.UTC(2000, 0, 1) || at > Date.UTC(2101, 0, 1)) throw bad('提出期限の日時が正しくありません');
      db.deadlines[key] = Math.round(at); save();
      return send(res, 200, { deadlines: db.deadlines });
    }
    if (p === '/api/admin/mode' && m === 'PUT') {
      const key = clean(body.key, 20);
      if (!validKey(key)) throw bad('区分が正しくありません');
      const to = String(body.mode || '');
      const prev = db.modes[key] || {};
      if (to === 'entry') delete db.modes[key];
      else if (to === 'rank') db.modes[key] = { rank: true, video: '', rankAt: prev.rankAt || Date.now() };
      else if (to === 'tally') db.modes[key] = { rank: false, tally: true, video: '', rankAt: prev.rankAt };
      else if (to === 'watch') {
        const v = clean(body.video, 500);
        let u; try { u = new URL(v); } catch (e) { u = null; }
        if (!u || u.protocol !== 'https:') throw bad('ランキング動画のリンクは https:// から始まるURLを入力してください');
        db.modes[key] = { rank: false, video: u.href, rankAt: prev.rankAt };
      } else throw bad('モードが正しくありません');
      if (to === 'tally' || to === 'watch') awardAll();
      save();
      return send(res, 200, { modes: publicModes() });
    }
    if (p === '/api/admin/links' && m === 'POST') {
      const key = clean(body.key, 20), title = clean(body.title, 100), artist = clean(body.artist, 60), v = clean(body.url, 500);
      if (!validKey(key)) throw bad('区分が正しくありません');
      if (!title) throw bad('動画タイトル(曲名)を入力してください');
      let u; try { u = new URL(v); } catch (e) { u = null; }
      if (!u || u.protocol !== 'https:') throw bad('リンクは https:// から始まるURLを入力してください');
      if (db.links.filter((x) => x.key === key).length >= 60) throw bad('この区分のリンクは60件までです');
      db.links.push({ id: id(), key, title, artist, url: u.href, at: Date.now() }); save();
      return send(res, 200, { links: db.links.map(({ id, key, title, artist, url }) => ({ id, key, title, artist, url })) });
    }
    const lkm = p.match(/^\/api\/admin\/links\/([0-9a-z]+)$/);
    if (lkm && m === 'DELETE') {
      db.links = db.links.filter((x) => x.id !== lkm[1]); save();
      return send(res, 200, { links: db.links.map(({ id, key, title, artist, url }) => ({ id, key, title, artist, url })) });
    }
    if (p === '/api/admin/pasts' && m === 'POST') {
      const key = clean(body.key, 20), title = clean(body.title, 100), v = clean(body.url, 500);
      if (!validKey(key)) throw bad('年代・クール・種別を選んでください');
      if (!title) throw bad('動画のタイトルを入力してください');
      let u; try { u = new URL(v); } catch (e) { u = null; }
      if (!u || u.protocol !== 'https:') throw bad('動画のリンクは https:// から始まるURLを入力してください');
      if (db.pasts.length >= 500) throw bad('登録数の上限(500件)に達しています');
      db.pasts.push({ id: id(), key, title, url: u.href, at: Date.now() }); save();
      return send(res, 200, { pasts: db.pasts });
    }
    const pam = p.match(/^\/api\/admin\/pasts\/([\w-]+)$/);
    if (pam && m === 'DELETE') {
      db.pasts = db.pasts.filter((x) => x.id !== pam[1]); save();
      return send(res, 200, { pasts: db.pasts });
    }
    if (p === '/api/admin/years' && m === 'POST') {
      const y = Number(body.year);
      if (!Number.isInteger(y) || y < 1950 || y > 2100) throw bad('年は1950〜2100の数字で入力してください');
      if (!db.years.includes(y)) { db.years.push(y); db.years.sort((a, b) => a - b); save(); }
      return send(res, 200, { years: db.years });
    }
    const ym = p.match(/^\/api\/admin\/years\/(\d{4})$/);
    if (ym && m === 'DELETE') {
      const y = Number(ym[1]);
      if (db.songs.some((x) => x.key.startsWith(y + '-'))) throw bad(y + '年には曲があるので削除できません');
      db.years = db.years.filter((v) => v !== y); save();
      return send(res, 200, { years: db.years });
    }
    if (p === '/api/admin/notices' && m === 'POST') {
      const ctl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
      const title = clean(body.title, 60);
      const text = String(body.text == null ? '' : body.text).replace(ctl, '').trim().slice(0, 1000);
      if (!title) throw bad('お知らせのタイトルを入力してください');
      if (!text) throw bad('お知らせの本文を入力してください');
      db.notices.push({ id: id(), title, text, at: Date.now() });
      if (db.notices.length > 100) db.notices.shift();
      save();
      return send(res, 200, { notices: db.notices.slice().reverse() });
    }
    const nm = p.match(/^\/api\/admin\/notices\/([0-9a-z]+)$/);
    if (nm && m === 'DELETE') {
      const i = db.notices.findIndex((x) => x.id === nm[1]);
      if (i < 0) throw new HttpError(404, 'お知らせが見つかりません');
      db.notices.splice(i, 1); save();
      return send(res, 200, { notices: db.notices.slice().reverse() });
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
      return send(res, 200, { people: db.people.map((x) => ({ id: x.id, name: x.name, scored: Object.keys(db.scores[x.id] || {}).length, hasPass: !!x.hash, ic: iconAt(x), adm: isAdminPerson(x.id) })) });
    }
    const pm = p.match(/^\/api\/admin\/people\/([0-9a-z]+)$/);
    if (pm && m === 'DELETE') {
      const i = db.people.findIndex((x) => x.id === pm[1]);
      if (i < 0) throw new HttpError(404, 'ユーザーが見つかりません');
      db.people.splice(i, 1);
      try { fs.unlinkSync(iconFile(pm[1])); } catch (e) { /* なし */ }
      delete db.scores[pm[1]]; delete db.stars[pm[1]]; delete db.comments[pm[1]];
      db.admins.forEach((a) => { if (a.pid === pm[1]) delete a.pid; });
      delete db.stamps[pm[1]]; delete db.titles[pm[1]]; delete db.counters[pm[1]]; Object.keys(db.pred).forEach((k) => { delete db.pred[k][pm[1]]; });
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
    if (p === '/api/admin/password' && m === 'POST') {
      if (limited(req, 'apw', 8, 15 * 60000)) throw new HttpError(429, '試行回数が多すぎます。15分後にやり直してください');
      const a = db.admins.find((x) => x.name === s.name);
      if (!a) throw new HttpError(404, '管理者が見つかりません');
      const cur = String(body.current || ''), next = String(body.next || '');
      if (!checkPw(cur, a.salt, a.hash)) throw new HttpError(403, '現在のパスワードが違います');
      if (next.length < 6) throw bad('新しいパスワードは6文字以上にしてください');
      a.salt = crypto.randomBytes(16).toString('hex'); a.hash = hashPw(next, a.salt);
      const me = bearer(req);
      Object.keys(db.sessions).forEach((t) => { if (t !== me && db.sessions[t].name === a.name) delete db.sessions[t]; });
      save();
      return send(res, 200, { ok: true });
    }
    const rm = p.match(/^\/api\/admin\/people\/([0-9a-z]+)\/password$/);
    if (rm && m === 'POST') {
      const u = db.people.find((x) => x.id === rm[1]);
      if (!u) throw new HttpError(404, 'ユーザーが見つかりません');
      const next = clean(body.pass, 60);
      if (next.length < 4) throw bad('新しい合言葉は4文字以上にしてください');
      u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hashPw(next, u.salt);
      u.token = token(); // いまログイン中の端末はいったんログアウトされる
      save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/admins' && m === 'GET') return send(res, 200, { admins: db.admins.map((a) => a.name), me: s.name, xs: db.admins.reduce((o, a) => { if (a.x) o[a.name] = a.x; return o; }, {}) });
    if (p === '/api/admin/x' && m === 'PUT') {
      const a = db.admins.find((x) => x.name === s.name);
      if (!a) throw new HttpError(404, '管理者が見つかりません');
      const v = normX(body.x);
      if (v === null) throw bad('Xのアカウントは、@ID か https://x.com/ID の形で入力してください(IDは英数字と_、15文字まで)');
      if (v) a.x = v; else delete a.x;
      save();
      return send(res, 200, { x: a.x || '' });
    }
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    if (path.basename(file) === 'index.html') {
      // リンクのプレビュー(OGP)用に、サイトのURLを入れる
      const proto = String((TRUST_PROXY && req.headers['x-forwarded-proto']) || 'http').split(',')[0].trim() === 'https' ? 'https' : 'http';
      const host = String((TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host || 'localhost').split(',')[0].trim().replace(/[^A-Za-z0-9.:\-]/g, '');
      buf = Buffer.from(buf.toString('utf8').replace(/__ORIGIN__/g, process.env.PUBLIC_URL || (proto + '://' + host)), 'utf8');
    }
    const ext = path.extname(file), etag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20) + '"';
    const hd = Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'ETag': etag, 'Vary': 'Accept-Encoding' }, SEC);
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, hd); return res.end(); }   // 変わっていなければ、中身は送らない
    if (['.html', '.js', '.css', '.svg', '.webmanifest'].includes(ext) && buf.length > 1024 && wantsGzip(res)) {
      let z = GZ.get(etag); if (!z) { z = zlib.gzipSync(buf, { level: 9 }); if (GZ.size > 60) GZ.clear(); GZ.set(etag, z); }
      hd['Content-Encoding'] = 'gzip'; res.writeHead(200, hd); return res.end(z);
    }
    res.writeHead(200, hd);
    res.end(buf);
  });
}

const GZ = new Map();
/* ---------- アクセス制限(攻撃・連打への備え) ---------- */
const RATE_MULT = Math.max(1, Number(process.env.RATE_MULT) || 1); // 負荷テスト用。通常は設定しない
let secN = 0, secT = 0;
function rateGuard(req, url) {
  const now = Date.now();
  if (now - secT >= 1000) { secT = now; secN = 0; }
  if (++secN > 200 * RATE_MULT) return true;                               // サイト全体で毎秒200件まで
  const api = url.pathname.startsWith('/api/'), write = req.method !== 'GET' && req.method !== 'HEAD';
  if (write) return limited(req, 'w', 120 * RATE_MULT, 60000);             // 書き込み: 1分に120回まで
  if (api) return limited(req, 'r', 1200 * RATE_MULT, 60000);              // 読み込み(API): 1分に1200回まで
  return limited(req, 's', 900 * RATE_MULT, 60000);                        // 画面のファイル: 1分に900回まで
}

const srv = http.createServer({ maxHeaderSize: 16384 }, async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    // 生存確認(Renderの無料プランを眠らせないための監視サービス用)。制限の対象外
    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    if (rateGuard(req, url)) { res.setHeader('Retry-After', '30'); throw new HttpError(429, 'アクセスが多すぎます。少し待ってからやり直してください'); }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
    serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'サーバーでエラーが起きました' });
  }
});
srv.headersTimeout = 15000; srv.requestTimeout = 30000; srv.keepAliveTimeout = 10000; srv.maxConnections = 2000; // 遅い接続で居座られないようにする
if (!db.nightFrom) { db.nightFrom = jstDay(Date.now()); save(); }
if (purgeTitles()) save();
srv.listen(PORT, () => console.log('Party Rank: http://localhost:' + PORT));
