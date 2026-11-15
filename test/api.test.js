// Avtomatik testlar: npm test
// Server vaqtinchalik papkada (DATA_DIR) va alohida portda ishga tushiriladi — haqiqiy data/ ga tegmaydi.
// Telegram va Redis o'chirilgan, admin paroli faqat test uchun (NODE_ENV=test).
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'test-parol-' + crypto.randomBytes(4).toString('hex');
const APP_LIMIT = 15; // oxirgi test limitga yetguncha yuboradi, oldingilar unga yetmasligi kerak

let server;
let dataDir;
let token;

function scryptHash(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}

async function req(method, url, body, auth = true) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* matn javob */ }
  return { status: r.status, json, text, type: r.headers.get('content-type') || '' };
}

// Har bir ariza boshqa telefon raqam bilan (takror tekshiruvi xalaqit bermasligi uchun)
let phoneSeq = 0;
const nextPhone = () => '+998 90 ' + String(1000000 + ++phoneSeq).slice(1, 4) + ' ' + String(phoneSeq).padStart(4, '0');
const apply = (extra = {}) => req('POST', '/api/applications', {
  name: 'Test Foydalanuvchi', phone: nextPhone(), courseId: 'c1', message: '', website: '', formTime: 5000, ...extra
}, false);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oquv-test-'));
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      NODE_ENV: 'test',
      TEST_ADMIN_PASSWORD_HASH: scryptHash(PASSWORD),
      APP_LIMIT: String(APP_LIMIT),
      // .env dagi haqiqiy sozlamalar testga tushmasligi uchun bo'sh qiymatlar
      TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '',
      KV_REST_API_URL: '', KV_REST_API_TOKEN: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
      VERCEL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Server 10 soniyada ishga tushmadi')), 10000);
    server.stdout.on('data', (d) => { if (String(d).includes('ishga tushdi')) { clearTimeout(t); resolve(); } });
    server.on('exit', (code) => reject(new Error('Server to\'xtadi: ' + code)));
  });
});

after(() => {
  if (server) server.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('statik sahifalar va fayllar', async () => {
  for (const p of ['/', '/admin', '/css/site.css', '/js/site.js', '/admin/admin.js', '/robots.txt', '/og-image.png']) {
    assert.equal((await req('GET', p, undefined, false)).status, 200, p);
  }
  const fav = await req('GET', '/favicon.ico', undefined, false);
  assert.equal(fav.status, 200);
  assert.match(fav.type, /image\/png/);
  assert.equal((await req('GET', '/../server.js', undefined, false)).status, 404);
  assert.equal((await req('GET', '/data/applications.json', undefined, false)).status, 404);
});

test('ochiq API: kurslar va ustozlar', async () => {
  const c = await req('GET', '/api/courses', undefined, false);
  assert.equal(c.status, 200);
  assert.equal(c.json.length, 8);
  const t = await req('GET', '/api/teachers', undefined, false);
  assert.equal(t.status, 200);
  assert.ok(t.json.every((x) => x.photo.startsWith('/img/teachers/')));
});

test('admin: tokensiz 401, noto\'g\'ri parol 401, to\'g\'ri parol token beradi', async () => {
  assert.equal((await req('GET', '/api/applications', undefined, false)).status, 401);
  assert.equal((await req('POST', '/api/login', { password: 'xato' }, false)).status, 401);
  const r = await req('POST', '/api/login', { password: PASSWORD }, false);
  assert.equal(r.status, 200);
  assert.match(r.json.token, /^[0-9a-f]{64}$/);
  token = r.json.token;
  assert.equal((await req('GET', '/api/applications')).status, 200);
});

test('ariza: validatsiya va 6 xonali ID', async () => {
  assert.equal((await apply({ name: 'A' })).status, 400);
  assert.equal((await apply({ phone: '123' })).status, 400);
  assert.equal((await apply({ courseId: 'yoq' })).status, 400);
  const r = await apply({ name: 'Ali Valiyev' });
  assert.equal(r.status, 201);
  assert.match(r.json.id, /^\d{6}$/);
  assert.equal(r.json.status, 'new');
  const list = (await req('GET', '/api/applications')).json;
  assert.ok(list.some((a) => a.id === r.json.id));
});

test('spam: honeypot va juda tez yuborilgan forma saqlanmaydi', async () => {
  const before = (await req('GET', '/api/applications')).json.length;
  const bot1 = await apply({ name: 'Bot Bir', website: 'http://spam' });
  const bot2 = await apply({ name: 'Bot Ikki', formTime: 300 });
  assert.equal(bot1.status, 201); // bot sezmasligi uchun "muvaffaqiyat"
  assert.equal(bot2.status, 201);
  const list = (await req('GET', '/api/applications')).json;
  assert.equal(list.length, before);
  assert.ok(!list.some((a) => a.name.startsWith('Bot ')));
});

test('spam: bir telefon + kurs 24 soatda takror -> 409', async () => {
  const phone = '+998 93 777 11 22';
  assert.equal((await apply({ phone, courseId: 'c3' })).status, 201);
  const dup = await apply({ phone: '937771122', courseId: 'c3' });
  assert.equal(dup.status, 409);
  assert.match(dup.json.error, /allaqachon/);
  assert.equal((await apply({ phone, courseId: 'c5' })).status, 201); // boshqa kurs — ruxsat
});

test('admin: guruhga biriktirish, holat, izoh, ko\'rilgan', async () => {
  const a = (await apply({ courseId: 'c2' })).json;
  let r = await req('PATCH', '/api/applications/' + a.id, { groupId: 'g4', adminNote: '  Qo\'ng\'iroq qilindi  ' });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'assigned');
  assert.equal(r.json.groupId, 'g4');
  assert.equal(r.json.adminNote, 'Qo\'ng\'iroq qilindi');
  r = await req('PATCH', '/api/applications/' + a.id, { status: 'new' });
  assert.equal(r.json.status, 'new');
  assert.equal(r.json.groupId, null);
  assert.equal((await req('PATCH', '/api/applications/' + a.id, { status: 'xyz' })).status, 400);
  assert.equal((await req('POST', '/api/applications/seen')).status, 200);
  const list = (await req('GET', '/api/applications')).json;
  assert.ok(list.every((x) => x.seen === true));
});

test('admin: to\'lgan guruhga biriktirib bo\'lmaydi', async () => {
  const g = (await req('POST', '/api/groups', { name: 'KICHIK', courseId: 'c6', teacherId: 't4', schedule: 'Du 10:00', capacity: 1 })).json;
  const a1 = (await apply({ courseId: 'c6' })).json;
  const a2 = (await apply({ courseId: 'c6' })).json;
  assert.equal((await req('PATCH', '/api/applications/' + a1.id, { groupId: g.id })).status, 200);
  const full = await req('PATCH', '/api/applications/' + a2.id, { groupId: g.id });
  assert.equal(full.status, 400);
  assert.equal(full.json.error, "Guruh to'lgan");
  // Guruh o'chirilsa ariza "new" ga qaytadi
  assert.equal((await req('DELETE', '/api/groups/' + g.id)).status, 200);
  const back = (await req('GET', '/api/applications')).json.find((x) => x.id === a1.id);
  assert.equal(back.groupId, null);
  assert.equal(back.status, 'new');
});

test('admin: kurs qo\'shish, tahrirlash, o\'chirish', async () => {
  assert.equal((await req('POST', '/api/courses', { title: 'X' })).status, 400);
  const c = await req('POST', '/api/courses', {
    title: 'Robototexnika', description: 'Arduino bilan amaliy loyihalar', level: "O'rta",
    duration: '3 oy', price: 500000, teacherId: 't3', icon: '🤖'
  });
  assert.equal(c.status, 201);
  const u = await req('PUT', '/api/courses/' + c.json.id, { price: 550000 });
  assert.equal(u.json.price, 550000);
  assert.equal(u.json.title, 'Robototexnika');
  assert.equal((await req('DELETE', '/api/courses/' + c.json.id)).status, 200);
  assert.equal((await req('GET', '/api/courses', undefined, false)).json.length, 8);
});

test('admin: zaxira nusxa barcha ma\'lumotlarni qaytaradi', async () => {
  const b = await req('GET', '/api/backup');
  assert.equal(b.status, 200);
  for (const k of ['courses', 'teachers', 'groups', 'applications']) assert.ok(Array.isArray(b.json[k]), k);
  assert.equal(b.json.courses.length, 8);
  assert.equal((await req('GET', '/api/backup', undefined, false)).status, 401);
});

test('telegram sozlanmagan: status false, test 400', async () => {
  assert.deepEqual((await req('GET', '/api/telegram/status')).json, { configured: false });
  assert.equal((await req('POST', '/api/telegram/test')).status, 400);
});

test('spam: bir IP dan limitdan ortiq ariza -> 429', async () => {
  // Oldingi testlar ham shu IP dan ariza yuborgan; limitga yetguncha yuboramiz
  let last;
  for (let i = 0; i < APP_LIMIT + 2; i++) {
    last = await apply({ courseId: 'c7' });
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429);
  assert.match(last.json.error, /Juda ko'p ariza/);
});

test('logout tokenni bekor qiladi', async () => {
  assert.equal((await req('POST', '/api/logout')).status, 200);
  assert.equal((await req('GET', '/api/applications')).status, 401);
});
