'use strict';
// 管理者のパスワードを設定・追加します(サーバーを止めてから実行してください)
//   node set-admin.js <管理者名> <新しいパスワード>
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const file = path.join(DATA_DIR, 'db.json');
const [name, pw] = process.argv.slice(2);
if (!name || !pw || pw.length < 6) { console.error('使い方: node set-admin.js <管理者名> <6文字以上のパスワード>'); process.exit(1); }
let db = { songs: [], people: [], scores: {}, stars: {}, admins: [], sessions: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
const a = db.admins.find((x) => x.name === name);
if (a) { a.salt = salt; a.hash = hash; } else db.admins.push({ name, salt, hash });
db.sessions = {};
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(file, JSON.stringify(db));
console.log(a ? name + ' のパスワードを変更しました' : name + ' を管理者に追加しました');
