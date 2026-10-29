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
let db = { songs: [], people: [], scores: {}, stars: {}, comments: {}, playlists: {}, admins: [], sessions: {}, years: [], notices: [], deadlines: {}, modes: {}, pasts: [], links: [], torder: {}, adminLinked: false, stamps: {}, pred: {}, reacts: {}, titles: {}, counters: {}, changes: {}, texc: {} };
let VER = 0;
function save() {
  VER++;
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
const ctr = (pid) => (db.counters[pid] = db.counters[pid] || {});
const bump = (pid, k, n = 1) => { const c = ctr(pid); c[k] = (c[k] || 0) + n; };
const jstDay = (t) => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
const luckyTime = (pid) => { const d = new Date(Date.now() + 9 * 3600000); if (d.getUTCHours() === d.getUTCMinutes()) bump(pid, 'zorome'); };
const BURST = {}, SEEN = {}, ONLINE_MS = 75000;
const isOn = (pid) => SEEN[pid] && Date.now() - SEEN[pid] < ONLINE_MS;
const isAdminPerson = (pid) => db.admins.some((a) => a.pid === pid);
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
function send(res, code, body, headers) {
  const isStr = typeof body === 'string', isBuf = Buffer.isBuffer(body);
  res.writeHead(code, Object.assign({ 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(isStr || isBuf ? body : JSON.stringify(body));
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
  return { key, label: labelOf(key), cour, people: people.map((p) => ({ id: p.id, name: p.name, ic: iconAt(p) })), rows, userAvg, overallAvg: mean(all), starTitles };
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
  { id: 'bonjin', name: '凡人', desc: '1つのランキングのすべての曲に、5.0〜6.0点をつけた' },
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
  { id: 'zero', name: 'ミスターゼロ', desc: '1つのランキングで、0.0点を5曲以上につけた' },
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
  { id: 'nostar', name: '無欲', desc: '全曲を採点したランキングで、そのクールの☆を使わなかった' },
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
  { id: 'qa', name: '品質保証', desc: 'デバッグ系の称号(バグハンター・デバッガー・境界値テスター・404の旅人・限界ネーム・ストレステスト・午前3時のデバッグ・ウィンドウ伸縮マニア・検証者・圏外の住人・再起動したら直った・無限ループ)を、すべて獲得した' },
  { id: 'halloween', name: 'トリックオアトリート', desc: '10月31日(日本時間)にサイトに来た' },
  { id: 'xmas', name: 'メリークリスマス', desc: '12月25日(日本時間)にサイトに来た' },
  { id: 'newyear', name: 'あけましておめでとう', desc: '1月1日(日本時間)にサイトに来た' },
  { id: 'tanabata', name: '七夕の願い', desc: '7月7日(日本時間)にサイトに来た' },
  { id: 'pocky', name: 'ポッキーの日', desc: '11月11日(日本時間)にサイトに来た' },
  { id: 'zorome', name: 'ゾロ目の奇跡', desc: '「11:11」「22:22」のように、時と分が同じ時刻に、点数かひとことを入力した(日本時間)' },
  { id: 'kaibun', name: '回文職人', desc: '3文字以上の回文(上から読んでも下から読んでも同じ)のひとことを書いた' },
  { id: 'lucky77', name: 'スリーセブン', desc: 'ちょうど77文字のひとことを書いた' },
  { id: 'pittari', name: 'ぴったり賞', desc: '10曲以上のランキングで全曲を採点し、点数の合計がちょうど100の倍数だった' },
  // ---- 第5弾 ----
  { id: 'tenzero', name: '天国と地獄', desc: '1つのランキングで、0点と10点を、それぞれ5曲以上につけた' },
  { id: 'allten', name: '全部満点', desc: '5曲以上のランキングで、全曲に10点をつけた' },
  { id: 'allzero', name: '虚無', desc: '5曲以上のランキングで、全曲に0点をつけた' },
  { id: 'ladder', name: '右肩上がり', desc: '8曲以上のランキングで全曲を採点し、曲リストの上から順に点数が下がらず、最初と最後で5点以上の差があった' },
  { id: 'descent', name: '右肩下がり', desc: '8曲以上のランキングで全曲を採点し、曲リストの上から順に点数が上がらず、最初と最後で5点以上の差があった' },
  { id: 'ichimai', name: '推しの一点豪華', desc: '10曲以上のランキングで全曲を採点し、10点が1曲だけ、ほかの曲はすべて6.0点以下だった' },
  { id: 'sniper', name: '狙撃手', desc: '全曲を採点し、自分が最高点をつけた曲(1曲だけ)が全体1位、最低点をつけた曲(1曲だけ)が全体最下位だった' },
  { id: 'tragic', name: '悲劇の推し', desc: '全曲を採点し、自分が最高点をつけた曲(1曲だけ)が、全体の最下位だった' },
  { id: 'manjo', name: '満場一致', desc: '3人以上が採点した曲のうち、採点した全員が8.0点以上をつけた曲に、自分も8.0点以上をつけたものが3曲以上あった' },
  { id: 'midpoint', name: 'ちょうど真ん中', desc: '5曲以上のランキングで全曲を採点し、自分の平均点がちょうど5.00点だった' },
  { id: 'jackpot', name: 'ジャックポット', desc: '10曲以上のランキングで全曲を採点し、点数の合計がちょうど777点だった' },
  { id: 'nito', name: '二刀流', desc: '同じクールの、2種類以上の区分(OP・EDなど)で、全曲を採点した' },
  { id: 'yonkan', name: '四種の神器', desc: '同じクールの、OP・ED・挿入歌・キャラソンの4区分すべてで、全曲を採点した' },
  { id: 'shiki', name: '四季折々', desc: '同じ年の、冬・春・夏・秋の4クールすべてで、全曲を採点した(区分は問いません)' },
  { id: 'rensen', name: '連戦連勝', desc: '同じ区分(OPなど)で、3クール連続して全曲を採点した' },
  { id: 'konami', name: 'コナミコマンド', desc: 'キーボードで ↑↑↓↓←→←→BA と入力した' },
  { id: 'revkonami', name: '逆コナミ', desc: 'キーボードで ↓↓↑↑→←→←AB と入力した' },
  { id: 'hadouken', name: '波動拳', desc: 'キーボードで ↓ → P と入力した' },
  { id: 'shoryuken', name: '昇龍拳', desc: 'キーボードで → ↓ → P と入力した' },
  { id: 'typeparty', name: 'パーティー開始', desc: 'キーボードで「party」と入力した(入力欄の外で)' },
  { id: 'typeanison', name: 'アニソン好き', desc: 'キーボードで「anison」と入力した(入力欄の外で)' },
  { id: 'sudo', name: 'スーパーユーザー', desc: 'キーボードで「sudo」と入力した(入力欄の外で)' },
  { id: 'gg', name: 'グッドゲーム', desc: 'キーボードで「gg」と入力した(入力欄の外で)' },
  { id: 'calltaiga', name: '運営を呼んだ', desc: 'キーボードで「taiga」と入力した(入力欄の外で)' },
  { id: 'logo7', name: 'ロゴ連打', desc: '画面左上のロゴを、7回すばやく連続でタップした' },
  { id: 'logohold', name: 'ロゴ長押し', desc: '画面左上のロゴを、3秒以上長押しした' },
  { id: 'ctrls', name: '保存魔', desc: 'Ctrl+S(Macは⌘+S)を押した' },
  { id: 'esc5', name: 'エスケープ', desc: 'Escキーを5回連続で押した' },
  { id: 'tab20', name: 'タブ職人', desc: 'Tabキーを、10秒以内に20回押した' },
  { id: 'allcmd', name: 'コマンドマスター', desc: '他のコマンド系の称号14個を、すべて獲得した' },
];
const TITLE_CATS = [["rankp", "参加ランク"], ["score", "採点のくせ"], ["result", "順位・結果"], ["join", "参加・継続"], ["comm", "ひとこと・交流"], ["site", "サイト愛"], ["debug", "デバッグ"], ["cmd", "コマンド"], ["lucky", "たまたま"], ["staff", "コレクション・特別"]];
const TITLE_META = {"rank1": ["rankp", 1], "rank2": ["rankp", 2], "rank3": ["rankp", 3], "rank4": ["rankp", 3], "rank5": ["rankp", 4], "sweet": ["score", 1], "bonjin": ["score", 1], "harsh": ["score", 1], "nostar": ["score", 1], "lucky7": ["score", 2], "gyaku": ["score", 2], "zero": ["score", 2], "steady": ["score", 2], "extreme": ["score", 2], "ten": ["score", 2], "contrary": ["score", 2], "kind": ["score", 2], "ice": ["score", 2], "dompisha": ["score", 2], "heretic": ["score", 2], "half": ["score", 2], "tasty": ["score", 2], "oneway": ["score", 2], "eye": ["score", 2], "kadai": ["score", 2], "silent": ["score", 2], "isekai": ["score", 2], "ichimai": ["score", 2], "indecisive": ["score", 2], "stairs": ["score", 3], "round": ["score", 3], "variety": ["score", 3], "avgbody": ["score", 3], "gunshi": ["score", 3], "tenzero": ["score", 3], "ladder": ["score", 3], "descent": ["score", 3], "allten": ["score", 4], "allzero": ["score", 4], "midpoint": ["score", 4], "sliding": ["result", 2], "star1": ["result", 2], "mine": ["result", 2], "early": ["result", 2], "night": ["result", 2], "lastlove": ["result", 2], "tragic": ["result", 2], "manjo": ["result", 2], "oshi": ["result", 2], "funeoriro": ["result", 2], "yari": ["result", 3], "constellation": ["result", 3], "gyakushin": ["result", 3], "manba": ["result", 3], "creator": ["result", 3], "destroyer": ["result", 3], "champion": ["result", 3], "detective": ["result", 3], "mvp": ["result", 3], "podium": ["result", 3], "sniper": ["result", 3], "prophet": ["result", 4], "marathon": ["join", 1], "regular5": ["join", 2], "nito": ["join", 2], "iron": ["join", 3], "rensen": ["join", 3], "attend": ["join", 4], "combo": ["join", 4], "traveler": ["join", 4], "yonkan": ["join", 4], "shiki": ["join", 4], "honor": ["comm", 1], "follower": ["comm", 1], "linked": ["comm", 1], "cmleader": ["comm", 2], "love": ["comm", 2], "resonance": ["comm", 2], "compatfan": ["comm", 2], "neighbor": ["comm", 2], "cmmaster": ["comm", 3], "popular": ["comm", 3], "ambassador": ["comm", 3], "soulmate": ["comm", 3], "loner": ["comm", 3], "pr": ["site", 1], "loginbonus": ["site", 1], "manual": ["site", 1], "iconmaker": ["site", 1], "viewer": ["site", 1], "camera": ["site", 1], "reporter": ["site", 2], "roster": ["site", 2], "weekly": ["site", 2], "regular": ["site", 2], "renamer": ["site", 2], "reviser": ["site", 2], "dresser": ["site", 2], "historian": ["site", 2], "photog": ["site", 2], "watcher": ["site", 2], "missionary": ["site", 3], "resident": ["site", 3], "veteran": ["site", 3], "explorer": ["site", 3], "master": ["site", 4], "debugger": ["debug", 1], "lost": ["debug", 1], "devtools": ["debug", 1], "bughunter": ["debug", 2], "maxname": ["debug", 2], "burst": ["debug", 2], "dawn": ["debug", 2], "resizer": ["debug", 2], "offline": ["debug", 2], "relog": ["debug", 2], "f5": ["debug", 2], "intruder": ["debug", 2], "boundary": ["debug", 3], "infloop": ["debug", 4], "qa": ["debug", 4], "halloween": ["lucky", 2], "xmas": ["lucky", 2], "newyear": ["lucky", 2], "tanabata": ["lucky", 2], "pocky": ["lucky", 2], "zorome": ["lucky", 3], "kaibun": ["lucky", 3], "lucky77": ["lucky", 3], "pittari": ["lucky", 3], "jackpot": ["lucky", 4], "gg": ["cmd", 1], "logo7": ["cmd", 1], "ctrls": ["cmd", 1], "esc5": ["cmd", 1], "hadouken": ["cmd", 2], "shoryuken": ["cmd", 2], "typeparty": ["cmd", 2], "typeanison": ["cmd", 2], "sudo": ["cmd", 2], "calltaiga": ["cmd", 2], "logohold": ["cmd", 2], "tab20": ["cmd", 2], "konami": ["cmd", 3], "revkonami": ["cmd", 3], "allcmd": ["cmd", 4], "hunter": ["staff", 2], "collector": ["staff", 3], "founder": ["staff", 3], "tking": ["staff", 4], "power": ["staff", 4]};
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
  return { pts: t.pts + w.pts, trifecta: t.exact === 3, worstTrifecta: w.exact === 3 };
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
    if (done && have.every((v) => v >= 5 && v <= 6)) add(pid, 'bonjin');
    if (have.filter((v) => v === 7 || v === 7.5).length >= 30) add(pid, 'lucky7');
    if (have.filter((v) => v === 0).length >= 5) add(pid, 'zero');
    if (have.filter((v) => v === 10).length >= 3) add(pid, 'ten');
    if (done) { doneCount[pid] = (doneCount[pid] || 0) + 1; fin.push({ pid, avg }); (doneKeys[pid] = doneKeys[pid] || []).push(k); }
    if (done && N >= 10 && Math.round(have.reduce((a, b) => a + b, 0) * 10) % 1000 === 0) add(pid, 'pittari');
    if (done && N >= 10 && Math.round(have.reduce((a, b) => a + b, 0) * 10) === 7770) add(pid, 'jackpot');
    if (have.filter((v) => v === 0).length >= 5 && have.filter((v) => v === 10).length >= 5) add(pid, 'tenzero');
    if (done && N >= 5 && have.every((v) => v === 10)) add(pid, 'allten');
    if (done && N >= 5 && have.every((v) => v === 0)) add(pid, 'allzero');
    if (done && N >= 5 && Math.abs(avg - 5) < 1e-9) add(pid, 'midpoint');
    if (done && N >= 10 && have.filter((v) => v === 10).length === 1 && have.filter((v) => v !== 10).every((v) => v <= 6)) add(pid, 'ichimai');
    if (done && N >= 8) {
      const scs = ordIds.map((sid) => (db.scores[pid] || {})[sid]);
      if (scs.length === N && scs.every((v) => typeof v === 'number')) {
        if (scs.every((v, i) => !i || v >= scs[i - 1]) && scs[N - 1] - scs[0] >= 5) add(pid, 'ladder');
        if (scs.every((v, i) => !i || v <= scs[i - 1]) && scs[0] - scs[N - 1] >= 5) add(pid, 'descent');
      }
    }
    if (done && nR >= 6) {
      const mxv = Math.max(...have), mnv = Math.min(...have), hi = rows.filter((r) => r.scores[pid] === mxv), lo = rows.filter((r) => r.scores[pid] === mnv), lastRank = ranked[nR - 1].rank;
      if (mxv !== mnv && hi.length === 1 && lastRank !== 1) {
        if (hi[0].rank === lastRank) add(pid, 'tragic');
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
    if (done && !rows.some((r) => r.starBy.includes(pid))) add(pid, 'nostar');
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
    if (pr) { const ps = predScore(k, pr); if (ps.trifecta) add(pid, 'manba'); if (ps.worstTrifecta) add(pid, 'mine'); if (ps.pts >= 12) add(pid, 'detective'); }
  });
  if (yariBest) add(yariBest.pid, 'yari');
  if (fin.length >= 3) { const mn = Math.min(...fin.map((x) => Math.round(x.avg * 1000))); fin.filter((x) => Math.round(x.avg * 1000) === mn).forEach((x) => add(x.pid, 'funeoriro')); }
}
let emVer = -1, emMemo = null;
function computeEarned() {
  if (emVer === VER && emMemo) return emMemo;
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
  db.people.forEach((u) => {
    const set = out.get(u.id) || new Set(), c = db.counters[u.id] || {};
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
      if ((cc.offline || 0) >= 1) set.add('offline'); if ((cc.relog || 0) >= 1) set.add('relog');
      if (Object.values(db.changes[u.id] || {}).some((n) => n >= 20)) set.add('infloop');
      const dset = new Set(days.map((d) => d.slice(5)));
      if (dset.has('10-31')) set.add('halloween'); if (dset.has('12-25')) set.add('xmas'); if (dset.has('01-01')) set.add('newyear'); if (dset.has('07-07')) set.add('tanabata'); if (dset.has('11-11')) set.add('pocky');
      if ((cc.zorome || 0) >= 1) set.add('zorome'); if ((cc.kaibun || 0) >= 1) set.add('kaibun'); if ((cc.lucky77 || 0) >= 1) set.add('lucky77');
      { // 連続・組み合わせ系
        const dk = doneKeys[u.id] || [], byCour = {}, byYear = {}, byKind = {};
        dk.forEach((kk) => { const pp = kk.split('-'), cour = pp[0] + '-' + pp[1], kind = pp[2]; (byCour[cour] = byCour[cour] || new Set()).add(kind); (byYear[pp[0]] = byYear[pp[0]] || new Set()).add(Number(pp[1])); (byKind[kind] = byKind[kind] || new Set()).add(Number(pp[0]) * 12 + Number(pp[1])); });
        if (Object.values(byCour).some((x) => x.size >= 2)) set.add('nito');
        if (Object.values(byCour).some((x) => KINDS.every((kd) => x.has(kd)))) set.add('yonkan');
        if (Object.values(byYear).some((x) => [1, 4, 7, 10].every((mo) => x.has(mo)))) set.add('shiki');
        if (Object.values(byKind).some((x) => Array.from(x).some((v) => x.has(v + 3) && x.has(v + 6)))) set.add('rensen');
      }
      const CMDS = ['konami', 'revkonami', 'hadouken', 'shoryuken', 'typeparty', 'typeanison', 'sudo', 'gg', 'calltaiga', 'logo7', 'logohold', 'ctrls', 'esc5', 'tab20'];
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
  const QA = ['bughunter', 'debugger', 'boundary', 'lost', 'maxname', 'burst', 'dawn', 'resizer', 'devtools', 'offline', 'relog', 'infloop'];
  out.forEach((set) => { if (QA.every((id) => set.has(id))) set.add('qa'); });
  db.people.forEach((u) => { if (isAdminPerson(u.id)) { if (!out.has(u.id)) out.set(u.id, new Set()); out.get(u.id).add('power'); } });
  out.forEach((set) => { const n = set.size - (set.has('power') ? 1 : 0); if (n >= 10) set.add('hunter'); if (n >= 20) set.add('collector'); if (n >= 50) set.add('tking'); });
  emVer = VER; emMemo = out; return out;
}
// 獲得した称号を保存する(一度獲得した称号は、あとから条件を外れても残る)
function awardFor(pid) {
  const set = computeEarned().get(pid); if (!set) return false;
  const T = (db.titles[pid] = db.titles[pid] || {}); let added = false;
  set.forEach((id) => { if (!T[id]) { T[id] = { at: Date.now(), seen: false }; added = true; } });
  if (T && !Object.keys(T).length) delete db.titles[pid];
  return added;
}
function awardAll() { db.people.forEach((u) => awardFor(u.id)); }
function equippedOf(u) {
  const T = db.titles[u.id] || {};
  if (u.equip === '') return null;
  if (u.equip && T[u.equip] && (!TITLE_BY_ID[u.equip].hidden || isAdminPerson(u.id))) return u.equip;
  if (isAdminPerson(u.id) && T.power && u.equip === undefined) return 'power';
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
    const me = person(req), sc = db.scores[me.id] || {}, dist = {}, per = {}, mine = [];
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
    return send(res, 200, { count: list.length, people: list });
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
    return send(res, 200, { people: db.people.map((u) => ({ id: u.id, ic: iconAt(u), name: u.name, adm: isAdminPerson(u.id), on: !!isOn(u.id) })), keys: Object.keys(total).map((k) => ({ key: k, songs: total[k], participants: (by[k] || []).sort((a, b) => b.scored - a.scored || a.name.localeCompare(b.name, 'ja')) })) });
  }
  const optPerson = () => { const t = bearer(req); return (t && db.people.find((x) => x.token === t)) || null; };
  if (p === '/api/me/titles' && m === 'GET') {
    const me = person(req);
    if (awardFor(me.id)) save();
    const T = db.titles[me.id] || {};
    const vis = TITLE_DEFS.filter((d) => !d.hidden || isAdminPerson(me.id));
    const hc = {}; Object.keys(db.titles).forEach((pid) => Object.keys(db.titles[pid]).forEach((id) => { hc[id] = (hc[id] || 0) + 1; }));
    const earned = vis.filter((d) => T[d.id]).map((d) => ({ id: d.id, name: d.name, desc: d.desc, holders: hc[d.id] || 0, cat: TITLE_META[d.id][0], lv: TITLE_META[d.id][1], at: T[d.id].at, fresh: !T[d.id].seen }));
    const lockedBy = {}; vis.filter((d) => !T[d.id]).forEach((d) => { const mt = TITLE_META[d.id]; (lockedBy[mt[0]] = lockedBy[mt[0]] || []).push(mt[1]); });
    return send(res, 200, { earned, locked: vis.length - earned.length, total: vis.length, equipped: equippedOf(me) || '', cats: TITLE_CATS, lockedBy, people: db.people.length });
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
    const SIMPLE = ['lost', 'resize', 'devtools', 'offline', 'relog', 'pastclick', 'imgsave', 'invite', 'news', 'f5', 'bug', 'watchclick', 'xclick'];
    if (SIMPLE.includes(type)) bump(me.id, type);
    else if (type === 'stay') { if (!c.lastStay || now - c.lastStay >= 45000) { c.stay = (c.stay || 0) + 60; c.lastStay = now; } }
    else if (type === 'visit') {
      const r = String(body.r || '');
      if (!['about', 'notices', 'invite', 'pasts', 'people', 'profile', 'titles', 'predict', 'compat'].includes(r)) throw bad('ページが正しくありません');
      c.visits = c.visits || {}; c.visits[r] = (c.visits[r] || 0) + 1;
    } else if (type === 'profile') {
      const pid = String(body.id || '');
      if (pid !== me.id && db.people.some((x) => x.id === pid)) { c.profiles = c.profiles || {}; if (Object.keys(c.profiles).length < 500) c.profiles[pid] = 1; }
    } else if (type === 'cmd') {
      const cid = String(body.c || '');
      if (!['konami', 'revkonami', 'hadouken', 'shoryuken', 'typeparty', 'typeanison', 'sudo', 'gg', 'calltaiga', 'logo7', 'logohold', 'ctrls', 'esc5', 'tab20'].includes(cid)) throw bad('コマンドが正しくありません');
      c.cmd = c.cmd || {}; c.cmd[cid] = 1;
    } else throw bad('種類が正しくありません');
    save();
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
    return send(res, 200, { id: u.id, name: u.name, ic: iconAt(u), at: u.at || 0, x: u.x || '', bio: u.bio || '', count: n, tid: tid || '', title: tid ? TITLE_BY_ID[tid].name : '', tn: Object.keys(db.titles[u.id] || {}).filter((t) => !TITLE_BY_ID[t].hidden || isAdminPerson(u.id)).length, titles: Object.keys(db.titles[u.id] || {}).filter((t) => TITLE_BY_ID[t] && (!TITLE_BY_ID[t].hidden || isAdminPerson(u.id))).sort((a, b) => TITLE_CATS.findIndex((c) => c[0] === TITLE_META[a][0]) - TITLE_CATS.findIndex((c) => c[0] === TITLE_META[b][0]) || TITLE_META[b][1] - TITLE_META[a][1]).map((t) => ({ id: t, name: TITLE_BY_ID[t].name })), adm: isAdminPerson(u.id) });
  }
  if (p === '/api/me/profile' && m === 'PUT') {
    const me = person(req);
    const x = normX(body.x);
    if (x === null) throw bad('Xのアカウントは、@ID か https://x.com/ID の形で入力してください(IDは英数字と_、15文字まで)');
    const bio = cleanBio(body.bio);
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
    { const c = ctr(me.id), d = jstDay(Date.now()); c.days = c.days || {}; if (!c.days[d]) { c.days[d] = 1; save(); } if (new Date(Date.now() + 9 * 3600000).getUTCHours() === 3 && !c.dawn) { c.dawn = 1; save(); } }
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
    me.salt = crypto.randomBytes(16).toString('hex'); me.hash = hashPw(next, me.salt); save();
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
      const byPerson = db.people.map((u) => ({ id: u.id, name: u.name, adm: isAdminPerson(u.id), titles: TITLE_DEFS.filter((d) => (db.titles[u.id] || {})[d.id]).map((d) => d.id) })).filter((x) => x.titles.length);
      return send(res, 200, { cats: TITLE_CATS, titles: TITLE_DEFS.map((d) => ({ id: d.id, name: d.name, desc: d.desc, hidden: !!d.hidden, cat: TITLE_META[d.id][0], lv: TITLE_META[d.id][1], holders: cnt[d.id] || 0, who: (who[d.id] || []).slice(0, 300) })), people: db.people.length, byPerson });
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
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, SEC));
    res.end(buf);
  });
}

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
srv.listen(PORT, () => console.log('Party Rank: http://localhost:' + PORT));
