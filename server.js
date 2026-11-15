/*
 * O'quv markaz — backend server (faqat Node built-in modullar).
 * Ishga tushirish: node server.js  →  http://localhost:3000  (env PORT bilan o'zgartirsa bo'ladi)
 * Shartnoma: API.md
 *
 * Bog'liq ma'lumotlarni o'chirishdagi xatti-harakat (ma'lumotlar buzilmasligi uchun):
 *  - Kurs o'chirilsa: shu kursga tegishli barcha guruhlar ham o'chiriladi; o'sha guruhlarga
 *    biriktirilgan arizalar groupId=null, status="new" bo'ladi. Arizalarning o'zi (courseId bilan)
 *    tarix sifatida saqlanib qoladi.
 *  - Ustoz o'chirilsa: unga bog'langan kurs va guruhlarda teacherId=null qilinadi
 *    (kurs va guruhlar o'chirilmaydi, admin keyin yangi ustoz tayinlashi mumkin).
 *  - Guruh o'chirilsa: shu guruhdagi arizalar groupId=null, status="new" bo'ladi.
 *
 * JSON fayllarga yozish atomik: avval vaqtinchalik faylga yoziladi, so'ng rename qilinadi.
 * Fayl mavjud bo'lmasa (yoki buzilgan bo'lsa) seed ma'lumot bilan yaratiladi.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');
const IS_VERCEL = !!process.env.VERCEL;

// .env faylini o'qish (KEY=VALUE). Muhit o'zgaruvchisi allaqachon berilgan bo'lsa, u ustun turadi.
function loadEnvFile() {
  let text;
  try { text = fs.readFileSync(ENV_FILE, 'utf8'); } catch (_) { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

// Admin paroli: koddagi standart parol YO'Q. Berilmagan bo'lsa, kuchli tasodifiy parol yaratilib
// .env ga yoziladi (.env gitignore'da — GitHub'ga chiqmaydi) va konsolga bir marta chiqariladi.
function resolveAdminPassword() {
  loadEnvFile();
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  // Vercel'da fayl yozib bo'lmaydi: parol Vercel muhit o'zgaruvchisi (ADMIN_PASSWORD) orqali beriladi
  if (IS_VERCEL) return '';
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 16; i++) pw += ALPHA[crypto.randomInt(ALPHA.length)];
  fs.appendFileSync(ENV_FILE, `ADMIN_PASSWORD=${pw}\n`, { mode: 0o600 });
  console.log(`\n  Yangi admin parol yaratildi va .env fayliga yozildi: ${pw}\n`);
  return pw;
}

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = resolveAdminPassword();
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const MAX_BODY = 1024 * 1024; // ~1MB

// Saqlash: Upstash Redis (Vercel) yoki lokal JSON fayllar.
// Vercel Marketplace'dagi Upstash integratsiyasi KV_REST_API_URL / KV_REST_API_TOKEN ni o'zi qo'shadi.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_KV = !!(KV_URL && KV_TOKEN);
const KV_PREFIX = 'oquv:';

// Kirish tokenlari 12 soatdan keyin eskiradi.
const TOKEN_TTL = 12 * 60 * 60 * 1000;
const tokens = new Map(); // faqat lokal rejimda: token -> amal qilish muddati

// Parolni taxmin qilishdan himoya: bir IP dan 5 ta noto'g'ri urinish -> oxirgi urinishdan 15 daqiqa blok.
const MAX_FAILS = 5;
const BLOCK_MS = 15 * 60 * 1000;
const loginFails = new Map(); // faqat lokal rejimda: ip -> { count, expires }

// ---------------------------------------------------------------- Seed ma'lumot
const SEED = {
  teachers: [
    { id: 't1', name: 'Dilnoza Karimova', subject: 'Ingliz tili', experience: 8, bio: 'IELTS 8.5 sertifikati egasi. 500 dan ortiq o\'quvchini xalqaro imtihonlarga tayyorlagan.', photo: '/img/teachers/t1.jpg' },
    { id: 't2', name: 'Jasur Rahimov', subject: 'Matematika', experience: 12, bio: 'Matematika fanlari nomzodi. DTM va olimpiadaga tayyorlash bo\'yicha tajribali ustoz.', photo: '/img/teachers/t2.jpg' },
    { id: 't3', name: 'Sardor Tursunov', subject: 'IT / Dasturlash', experience: 6, bio: 'Senior Full-stack dasturchi. JavaScript, Python va web texnologiyalarni amaliy loyihalar orqali o\'rgatadi.', photo: '/img/teachers/t3.jpg' },
    { id: 't4', name: 'Nodira Abdullayeva', subject: 'Rus tili', experience: 10, bio: 'Rus filologiyasi bo\'yicha magistr. So\'zlashuv va grammatikani sodda usulda tushuntiradi.', photo: '/img/teachers/t4.jpg' },
    { id: 't5', name: 'Bekzod Ergashev', subject: 'Fizika', experience: 9, bio: 'Respublika fan olimpiadasi g\'oliblarini tayyorlagan. Murakkab mavzularni tajribalar bilan tushuntiradi.', photo: '/img/teachers/t5.jpg' },
    { id: 't6', name: 'Malika Yusupova', subject: 'Kimyo', experience: 7, bio: 'Tibbiyot oliygohlariga kirish uchun kimyo va biologiyadan tayyorlaydi.', photo: '/img/teachers/t6.jpg' }
  ],
  courses: [
    { id: 'c1', title: 'Ingliz tili (General English)', description: 'Noldan boshlab so\'zlashuv, grammatika va lug\'at boyligini oshirish. Haftada 3 marta dars.', level: "Boshlang'ich", duration: '6 oy', price: 450000, teacherId: 't1', icon: '🇬🇧' },
    { id: 'c2', title: 'IELTS tayyorlov', description: 'Listening, Reading, Writing va Speaking bo\'yicha intensiv tayyorgarlik, haftalik mock imtihonlar.', level: 'Yuqori', duration: '4 oy', price: 650000, teacherId: 't1', icon: '🎓' },
    { id: 'c3', title: 'Matematika (DTM tayyorlov)', description: 'Abituriyentlar uchun test yechish texnikasi va barcha mavzular bo\'yicha chuqur tayyorgarlik.', level: "O'rta", duration: '8 oy', price: 400000, teacherId: 't2', icon: '📐' },
    { id: 'c4', title: 'Frontend dasturlash', description: 'HTML, CSS, JavaScript va React. Kurs oxirida shaxsiy portfolio loyiha.', level: "Boshlang'ich", duration: '6 oy', price: 700000, teacherId: 't3', icon: '💻' },
    { id: 'c5', title: 'Python dasturlash', description: 'Python asoslari, algoritmlar va Telegram bot yaratish amaliyoti.', level: "O'rta", duration: '5 oy', price: 600000, teacherId: 't3', icon: '🐍' },
    { id: 'c6', title: 'Rus tili', description: 'Kundalik muloqot, grammatika va savodli yozish ko\'nikmalari.', level: "Boshlang'ich", duration: '4 oy', price: 350000, teacherId: 't4', icon: '📚' },
    { id: 'c7', title: 'Fizika', description: 'Mexanika, elektr va optika. Masala yechish va DTM testlariga tayyorlov.', level: "O'rta", duration: '6 oy', price: 400000, teacherId: 't5', icon: '⚛️' },
    { id: 'c8', title: 'Kimyo', description: 'Umumiy, anorganik va organik kimyo. Tibbiyot yo\'nalishiga tayyorlov.', level: 'Yuqori', duration: '6 oy', price: 450000, teacherId: 't6', icon: '🧪' }
  ],
  groups: [
    { id: 'g1', name: 'ENG-101', courseId: 'c1', teacherId: 't1', schedule: 'Du-Chor-Ju 14:00', capacity: 12 },
    { id: 'g2', name: 'FE-01', courseId: 'c4', teacherId: 't3', schedule: 'Se-Pa-Sha 16:00', capacity: 10 },
    { id: 'g3', name: 'MATH-DTM-1', courseId: 'c3', teacherId: 't2', schedule: 'Du-Chor-Ju 09:00', capacity: 15 },
    { id: 'g4', name: 'IELTS-7', courseId: 'c2', teacherId: 't1', schedule: 'Se-Pa-Sha 18:00', capacity: 8 }
  ],
  applications: [
    { id: '284716', name: 'Aziz Qodirov', phone: '+998 90 123 45 67', courseId: 'c1', message: 'Kechki guruh bo\'lsa yaxshi bo\'lardi.', status: 'assigned', groupId: 'g1', createdAt: '2026-11-08T09:15:00.000Z' },
    { id: '519302', name: 'Madina Sobirova', phone: '+998 93 555 12 34', courseId: 'c4', message: '', status: 'assigned', groupId: 'g2', createdAt: '2026-11-10T11:40:00.000Z' },
    { id: '730458', name: 'Otabek Nazarov', phone: '+998 97 777 88 99', courseId: 'c3', message: 'Abituriyentman, DTMga tayyorlanmoqchiman.', status: 'new', groupId: null, createdAt: '2026-11-12T14:05:00.000Z' },
    { id: '846127', name: 'Shahzoda Islomova', phone: '+998 99 321 65 87', courseId: 'c2', message: 'Hozirgi darajam B1, 7.0 olmoqchiman.', status: 'new', groupId: null, createdAt: '2026-11-13T16:20:00.000Z' },
    { id: '963580', name: 'Javohir Aliyev', phone: '+998 91 246 80 13', courseId: 'c5', message: '', status: 'new', groupId: null, createdAt: '2026-11-14T08:30:00.000Z' }
  ]
};

// ---------------------------------------------------------------- JSON saqlash
function filePath(name) {
  return path.join(DATA_DIR, name + '.json');
}

function writeAtomic(name, data) {
  const target = filePath(name);
  const tmp = target + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw e;
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// Upstash Redis REST: buyruq JSON massiv sifatida yuboriladi, masalan ["GET", "kalit"]
async function kv(...cmd) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Redis xatosi: ' + (j.error || r.status));
  return j.result;
}

async function load(name) {
  if (USE_KV) {
    const key = KV_PREFIX + name;
    let raw = await kv('GET', key);
    if (raw == null) {
      // Birinchi marta: seed bilan to'ldiramiz (NX — parallel so'rovda ustiga yozmaslik uchun)
      await kv('SET', key, JSON.stringify(SEED[name]), 'NX');
      raw = await kv('GET', key);
    }
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch (_) { /* pastga */ }
    return clone(SEED[name]);
  }
  if (IS_VERCEL) return clone(SEED[name]); // baza ulanmagan: faqat o'qish (seed)
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
    if (Array.isArray(parsed)) return parsed;
  } catch (_) { /* yo'q yoki buzilgan — seed bilan qayta yaratamiz */ }
  const seed = clone(SEED[name]);
  writeAtomic(name, seed);
  return seed;
}

async function save(name, data) {
  if (USE_KV) { await kv('SET', KV_PREFIX + name, JSON.stringify(data)); return; }
  if (IS_VERCEL) throw new HttpError(503, "Ma'lumotlar bazasi ulanmagan (Upstash Redis sozlanmagan)");
  writeAtomic(name, data);
}

// --- Sessiyalar (admin tokenlari)
async function createSession(token) {
  if (USE_KV) return kv('SET', KV_PREFIX + 'sess:' + token, '1', 'PX', TOKEN_TTL);
  const now = Date.now();
  for (const [t, exp] of tokens) if (exp < now) tokens.delete(t); // eskirganlarni tozalash
  tokens.set(token, now + TOKEN_TTL);
}
async function hasSession(token) {
  if (!token) return false;
  if (USE_KV) return (await kv('GET', KV_PREFIX + 'sess:' + token)) !== null;
  const exp = tokens.get(token);
  if (exp && exp < Date.now()) tokens.delete(token);
  return !!exp && exp >= Date.now();
}
async function deleteSession(token) {
  if (USE_KV) return kv('DEL', KV_PREFIX + 'sess:' + token);
  tokens.delete(token);
}

// --- Noto'g'ri urinishlar (IP bo'yicha)
// Qaytaradi: blok qolgan vaqti (ms) yoki 0
async function blockedFor(ip) {
  if (USE_KV) {
    const key = KV_PREFIX + 'fail:' + ip;
    const count = Number(await kv('GET', key)) || 0;
    if (count < MAX_FAILS) return 0;
    return Math.max(Number(await kv('PTTL', key)) || 0, 0);
  }
  const rec = loginFails.get(ip);
  if (!rec || rec.expires < Date.now()) { loginFails.delete(ip); return 0; }
  return rec.count >= MAX_FAILS ? rec.expires - Date.now() : 0;
}
// Qaytaradi: hozirgi urinishlar soni
async function recordFail(ip) {
  if (USE_KV) {
    const key = KV_PREFIX + 'fail:' + ip;
    const count = await kv('INCR', key);
    await kv('PEXPIRE', key, BLOCK_MS);
    return count;
  }
  const now = Date.now();
  const rec = loginFails.get(ip);
  const count = (rec && rec.expires >= now ? rec.count : 0) + 1;
  loginFails.set(ip, { count, expires: now + BLOCK_MS });
  return count;
}
async function clearFails(ip) {
  if (USE_KV) return kv('DEL', KV_PREFIX + 'fail:' + ip);
  loginFails.delete(ip);
}

function clientIp(req) {
  // Vercel'da haqiqiy IP x-forwarded-for da (uni Vercel o'zi qo'yadi); lokalda socket manzili
  if (IS_VERCEL) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket && req.socket.remoteAddress || 'unknown';
}

function initData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const name of Object.keys(SEED)) {
    if (!fs.existsSync(filePath(name))) writeAtomic(name, clone(SEED[name]));
  }
}

// Arizalar uchun 6 xonali raqamli ID (100000–999999), mavjudlari bilan takrorlanmaydi
function newAppId(apps) {
  const used = new Set(apps.map((a) => a.id));
  let id;
  do { id = String(crypto.randomInt(100000, 1000000)); } while (used.has(id));
  return id;
}

// Eski formatdagi (masalan "a1") ariza ID larini 6 xonali raqamga o'tkazadi — server ishga tushganda bir marta
async function migrateApplicationIds() {
  const apps = await load('applications');
  let changed = false;
  for (const a of apps) {
    if (!/^\d{6}$/.test(String(a.id))) { a.id = newAppId(apps); changed = true; }
  }
  if (changed) await save('applications', apps);
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
}

// ---------------------------------------------------------------- Yordamchilar
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  // Vercel body'ni o'zi o'qib req.body ga qo'yadi
  if (IS_VERCEL) {
    let b;
    try { b = req.body; } catch (_) { return Promise.reject(new HttpError(400, "Noto'g'ri JSON")); }
    if (Buffer.isBuffer(b)) b = b.toString('utf8');
    if (typeof b === 'string') {
      if (!b.trim()) return Promise.resolve({});
      try { b = JSON.parse(b); } catch (_) { return Promise.reject(new HttpError(400, "Noto'g'ri JSON")); }
    }
    if (b == null) return Promise.resolve({});
    if (typeof b !== 'object' || Array.isArray(b)) return Promise.reject(new HttpError(400, "Body JSON obyekt bo'lishi kerak"));
    return Promise.resolve(b);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        aborted = true;
        reject(new HttpError(413, "So'rov hajmi juda katta (maksimum 1MB)"));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new HttpError(400, "Body JSON obyekt bo'lishi kerak"));
        }
        resolve(parsed);
      } catch (_) {
        reject(new HttpError(400, "Noto'g'ri JSON"));
      }
    });
    req.on('error', reject);
  });
}

function bearer(req) {
  const m = /^Bearer\s+([A-Za-z0-9]+)$/i.exec(String(req.headers['authorization'] || '').trim());
  return m ? m[1] : '';
}

async function requireAuth(req) {
  if (!(await hasSession(bearer(req)))) throw new HttpError(401, 'Avtorizatsiya talab qilinadi');
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const LEVELS = ["Boshlang'ich", "O'rta", 'Yuqori'];

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

// ---------------------------------------------------------------- Validatsiya
async function validateCourse(input, existing) {
  const base = existing || {};
  const pick = (k) => (input[k] !== undefined ? input[k] : base[k]);
  const c = {
    title: str(pick('title')),
    description: str(pick('description')),
    level: str(pick('level')),
    duration: str(pick('duration')),
    price: toNumber(pick('price')),
    teacherId: pick('teacherId') === null ? null : str(pick('teacherId')),
    icon: str(pick('icon')) || '📘'
  };
  if (c.title.length < 2) throw new HttpError(400, 'Kurs nomi kamida 2 belgi bo\'lishi kerak');
  if (!c.description) throw new HttpError(400, 'Kurs tavsifi kiritilishi shart');
  if (!LEVELS.includes(c.level)) throw new HttpError(400, 'Daraja quyidagilardan biri bo\'lishi kerak: ' + LEVELS.join(', '));
  if (!c.duration) throw new HttpError(400, 'Davomiylik kiritilishi shart');
  if (!Number.isFinite(c.price) || c.price < 0) throw new HttpError(400, 'Narx musbat son bo\'lishi kerak');
  if (!c.teacherId) {
    if (existing && c.teacherId === null) { /* ustoz o'chirilgan kurs — ruxsat */ }
    else throw new HttpError(400, 'Ustoz tanlanishi shart');
  } else if (!(await load('teachers')).some((t) => t.id === c.teacherId)) {
    throw new HttpError(400, 'Bunday ustoz mavjud emas');
  }
  return c;
}

// ---------------------------------------------------------------- Router
async function handleApi(req, res, pathname) {
  const method = req.method;
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ['api', 'courses', ':id']
  const resource = parts[1];
  const id = parts[2] ? decodeURIComponent(parts[2]) : null;
  if (parts.length > 3) throw new HttpError(404, 'Topilmadi');

  // --- login
  if (resource === 'login' && !id) {
    if (method !== 'POST') throw new HttpError(405, 'Metod ruxsat etilmagan');
    if (!ADMIN_PASSWORD) throw new HttpError(503, 'Admin paroli sozlanmagan (ADMIN_PASSWORD)');
    const ip = clientIp(req);
    const left = await blockedFor(ip);
    if (left > 0) {
      throw new HttpError(429, `Juda ko'p noto'g'ri urinish. ${Math.ceil(left / 60000)} daqiqadan keyin qayta urinib ko'ring`);
    }
    const body = await readBody(req);
    const pass = typeof body.password === 'string' ? body.password : '';
    if (!crypto.timingSafeEqual(sha256(pass), sha256(ADMIN_PASSWORD))) {
      const count = await recordFail(ip);
      if (count >= MAX_FAILS) console.warn(`[xavfsizlik] ${ip} ${count} marta noto'g'ri parol kiritdi — 15 daqiqaga bloklandi`);
      throw new HttpError(401, "Parol noto'g'ri");
    }
    await clearFails(ip);
    const token = crypto.randomBytes(32).toString('hex');
    await createSession(token);
    return sendJson(res, 200, { token });
  }

  // --- logout (tokenni bekor qilish)
  if (resource === 'logout' && !id) {
    if (method !== 'POST') throw new HttpError(405, 'Metod ruxsat etilmagan');
    const token = bearer(req);
    if (token) await deleteSession(token);
    return sendJson(res, 200, { ok: true });
  }

  // --- courses
  if (resource === 'courses') {
    if (!id && method === 'GET') return sendJson(res, 200, await load('courses'));
    if (!id && method === 'POST') {
      await requireAuth(req);
      const body = await readBody(req);
      const course = { id: newId('c'), ...(await validateCourse(body)) };
      const courses = await load('courses');
      courses.push(course);
      await save('courses', courses);
      return sendJson(res, 201, course);
    }
    if (id && method === 'PUT') {
      await requireAuth(req);
      const body = await readBody(req);
      const courses = await load('courses');
      const idx = courses.findIndex((c) => c.id === id);
      if (idx === -1) throw new HttpError(404, 'Kurs topilmadi');
      courses[idx] = { id, ...(await validateCourse(body, courses[idx])) };
      await save('courses', courses);
      return sendJson(res, 200, courses[idx]);
    }
    if (id && method === 'DELETE') {
      await requireAuth(req);
      const courses = await load('courses');
      if (!courses.some((c) => c.id === id)) throw new HttpError(404, 'Kurs topilmadi');
      const groups = await load('groups');
      const removedGroupIds = new Set(groups.filter((g) => g.courseId === id).map((g) => g.id));
      const apps = await load('applications');
      let appsChanged = false;
      for (const a of apps) {
        if (a.groupId && removedGroupIds.has(a.groupId)) { a.groupId = null; a.status = 'new'; appsChanged = true; }
      }
      if (appsChanged) await save('applications', apps);
      if (removedGroupIds.size) await save('groups', groups.filter((g) => !removedGroupIds.has(g.id)));
      await save('courses', courses.filter((c) => c.id !== id));
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(id ? 405 : 405, 'Metod ruxsat etilmagan');
  }

  // --- teachers
  if (resource === 'teachers') {
    if (!id && method === 'GET') return sendJson(res, 200, await load('teachers'));
    if (!id && method === 'POST') {
      await requireAuth(req);
      const body = await readBody(req);
      const t = {
        id: newId('t'),
        name: str(body.name),
        subject: str(body.subject),
        experience: toNumber(body.experience),
        bio: str(body.bio),
        photo: str(body.photo)
      };
      if (t.name.length < 2) throw new HttpError(400, 'Ism kamida 2 belgi bo\'lishi kerak');
      if (!t.subject) throw new HttpError(400, 'Fan kiritilishi shart');
      if (!Number.isFinite(t.experience) || t.experience < 0) throw new HttpError(400, 'Tajriba (yil) musbat son bo\'lishi kerak');
      const teachers = await load('teachers');
      teachers.push(t);
      await save('teachers', teachers);
      return sendJson(res, 201, t);
    }
    if (id && method === 'DELETE') {
      await requireAuth(req);
      const teachers = await load('teachers');
      if (!teachers.some((t) => t.id === id)) throw new HttpError(404, 'Ustoz topilmadi');
      for (const name of ['courses', 'groups']) {
        const list = await load(name);
        let changed = false;
        for (const item of list) if (item.teacherId === id) { item.teacherId = null; changed = true; }
        if (changed) await save(name, list);
      }
      await save('teachers', teachers.filter((t) => t.id !== id));
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(405, 'Metod ruxsat etilmagan');
  }

  // --- groups
  if (resource === 'groups') {
    await requireAuth(req);
    if (!id && method === 'GET') return sendJson(res, 200, await load('groups'));
    if (!id && method === 'POST') {
      const body = await readBody(req);
      const g = {
        id: newId('g'),
        name: str(body.name),
        courseId: str(body.courseId),
        teacherId: str(body.teacherId),
        schedule: str(body.schedule),
        capacity: toNumber(body.capacity)
      };
      if (!g.name) throw new HttpError(400, 'Guruh nomi kiritilishi shart');
      if (!(await load('courses')).some((c) => c.id === g.courseId)) throw new HttpError(400, 'Bunday kurs mavjud emas');
      if (!(await load('teachers')).some((t) => t.id === g.teacherId)) throw new HttpError(400, 'Bunday ustoz mavjud emas');
      if (!g.schedule) throw new HttpError(400, 'Dars jadvali kiritilishi shart');
      if (!Number.isInteger(g.capacity) || g.capacity < 1) throw new HttpError(400, 'Sig\'im musbat butun son bo\'lishi kerak');
      const groups = await load('groups');
      groups.push(g);
      await save('groups', groups);
      return sendJson(res, 201, g);
    }
    if (id && method === 'DELETE') {
      const groups = await load('groups');
      if (!groups.some((g) => g.id === id)) throw new HttpError(404, 'Guruh topilmadi');
      const apps = await load('applications');
      let changed = false;
      for (const a of apps) if (a.groupId === id) { a.groupId = null; a.status = 'new'; changed = true; }
      if (changed) await save('applications', apps);
      await save('groups', groups.filter((g) => g.id !== id));
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(405, 'Metod ruxsat etilmagan');
  }

  // --- applications
  if (resource === 'applications') {
    if (!id && method === 'POST') {
      const body = await readBody(req);
      const name = str(body.name);
      const phone = str(body.phone);
      const courseId = str(body.courseId);
      const message = str(body.message);
      if (name.length < 2) throw new HttpError(400, 'Ism kamida 2 belgi bo\'lishi kerak');
      if (phone.replace(/\D/g, '').length < 9) throw new HttpError(400, 'Telefon raqam kamida 9 ta raqamdan iborat bo\'lishi kerak');
      if (!(await load('courses')).some((c) => c.id === courseId)) throw new HttpError(400, 'Kurs tanlanmagan yoki mavjud emas');
      if (name.length > 100 || phone.length > 30 || message.length > 2000) throw new HttpError(400, 'Maydonlar juda uzun');
      const apps = await load('applications');
      const app = { id: newAppId(apps), name, phone, courseId, message, status: 'new', groupId: null, seen: false, adminNote: '', noteUpdatedAt: null, createdAt: new Date().toISOString() };
      apps.push(app);
      await save('applications', apps);
      return sendJson(res, 201, app);
    }
    await requireAuth(req);
    if (!id && method === 'GET') {
      const apps = (await load('applications')).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return sendJson(res, 200, apps);
    }
    // POST /api/applications/seen — barcha arizalarni "ko'rilgan" deb belgilaydi
    if (id === 'seen' && method === 'POST') {
      const apps = await load('applications');
      let changed = 0;
      for (const a of apps) if (a.seen !== true) { a.seen = true; changed++; }
      if (changed) await save('applications', apps);
      return sendJson(res, 200, { ok: true, changed });
    }
    if (id && method === 'PATCH') {
      const body = await readBody(req);
      const hasGroup = 'groupId' in body;
      const hasStatus = 'status' in body;
      const hasNote = 'adminNote' in body;
      if (!hasGroup && !hasStatus && !hasNote) throw new HttpError(400, 'groupId, status yoki adminNote maydoni kerak');
      if (hasStatus && body.status !== 'new' && body.status !== 'assigned') {
        throw new HttpError(400, "status \"new\" yoki \"assigned\" bo'lishi kerak");
      }
      if (hasNote && typeof body.adminNote !== 'string') throw new HttpError(400, "adminNote matn bo'lishi kerak");
      if (hasNote && body.adminNote.length > 2000) throw new HttpError(400, 'Izoh juda uzun (2000 belgigacha)');
      const apps = await load('applications');
      const app = apps.find((a) => a.id === id);
      if (!app) throw new HttpError(404, 'Ariza topilmadi');
      if (hasNote) {
        app.adminNote = body.adminNote.trim();
        app.noteUpdatedAt = new Date().toISOString();
      }
      if (!hasGroup) {
        // Holatni o'zgartirish (guruhdan mustaqil):
        // "new" — ariza guruhdan chiqariladi; "assigned" — guruh o'zgarmaydi (guruhsiz ham bo'lishi mumkin).
        if (hasStatus) {
          app.status = body.status;
          if (body.status === 'new') app.groupId = null;
        }
        await save('applications', apps);
        return sendJson(res, 200, app);
      }
      const groupId = body.groupId === null || body.groupId === '' ? null : str(body.groupId);
      if (body.groupId !== null && body.groupId !== '' && typeof body.groupId !== 'string') {
        throw new HttpError(400, "groupId string yoki null bo'lishi kerak");
      }
      if (groupId === null) {
        app.groupId = null;
        app.status = 'new';
      } else {
        const group = (await load('groups')).find((g) => g.id === groupId);
        if (!group) throw new HttpError(400, 'Bunday guruh mavjud emas');
        if (app.groupId !== groupId) {
          const count = apps.filter((a) => a.groupId === groupId && a.id !== app.id).length;
          if (count >= group.capacity) throw new HttpError(400, "Guruh to'lgan");
        }
        app.groupId = groupId;
        app.status = 'assigned';
      }
      await save('applications', apps);
      return sendJson(res, 200, app);
    }
    if (id && method === 'DELETE') {
      const apps = await load('applications');
      if (!apps.some((a) => a.id === id)) throw new HttpError(404, 'Ariza topilmadi');
      await save('applications', apps.filter((a) => a.id !== id));
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(405, 'Metod ruxsat etilmagan');
  }

  throw new HttpError(404, 'Endpoint topilmadi');
}

// ---------------------------------------------------------------- Statik fayllar
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 — Sahifa topilmadi');
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    return res.end('405 — Metod ruxsat etilmagan');
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { return send404(res); }
  if (rel.includes('\0')) return send404(res);
  if (rel === '/' || rel === '') rel = '/index.html';
  else if (rel === '/admin' || rel === '/admin/') rel = '/admin/index.html';
  else if (rel.endsWith('/')) rel += 'index.html';

  const full = path.resolve(PUBLIC_DIR, '.' + path.posix.normalize('/' + rel.replace(/\\/g, '/')));
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) return send404(res);

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return send404(res);
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(full);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

// ---------------------------------------------------------------- Server
async function handler(req, res) {
  let pathname;
  try {
    const u = new URL(req.url, 'http://localhost');
    pathname = u.pathname;
    // Vercel: vercel.json dagi rewrite asl yo'lni ?__p= orqali uzatadi
    const p = u.searchParams.get('__p');
    if (IS_VERCEL && p !== null && pathname.startsWith('/api')) pathname = '/api/' + p.replace(/^\/+/, '');
  } catch (_) {
    return sendJson(res, 400, { error: "Noto'g'ri URL" });
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, pathname);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Server xatosi' : err.message });
      if (status === 413) req.resume();
    }
    return;
  }
  serveStatic(req, res, pathname);
}

module.exports = { handler };

// Lokal ishga tushirish: node server.js (Vercel'da esa api/index.js handler'ni ishlatadi)
if (require.main === module) {
  (async () => {
    if (!USE_KV) initData();
    await migrateApplicationIds();
    http.createServer(handler).listen(PORT, () => {
      console.log(`O'quv markaz serveri ishga tushdi: http://localhost:${PORT}` + (USE_KV ? ' (Redis)' : ' (lokal fayllar)'));
    });
  })().catch((e) => { console.error(e); process.exit(1); });
}
