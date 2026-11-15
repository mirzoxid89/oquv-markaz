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

// Kirish tokenlari: token -> amal qilish muddati (ms). 12 soatdan keyin eskiradi.
const TOKEN_TTL = 12 * 60 * 60 * 1000;
const tokens = new Map();

// Parolni taxmin qilishdan himoya: bir IP dan 5 ta noto'g'ri urinish -> 15 daqiqa blok.
const MAX_FAILS = 5;
const BLOCK_MS = 15 * 60 * 1000;
const loginFails = new Map(); // ip -> { count, until }

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

function load(name) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
    if (Array.isArray(parsed)) return parsed;
  } catch (_) { /* yo'q yoki buzilgan — seed bilan qayta yaratamiz */ }
  const seed = JSON.parse(JSON.stringify(SEED[name]));
  writeAtomic(name, seed);
  return seed;
}

function save(name, data) {
  writeAtomic(name, data);
}

function initData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const name of Object.keys(SEED)) {
    if (!fs.existsSync(filePath(name))) writeAtomic(name, JSON.parse(JSON.stringify(SEED[name])));
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
function migrateApplicationIds() {
  const apps = load('applications');
  let changed = false;
  for (const a of apps) {
    if (!/^\d{6}$/.test(String(a.id))) { a.id = newAppId(apps); changed = true; }
  }
  if (changed) save('applications', apps);
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

function requireAuth(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const token = m ? m[1].trim() : '';
  const exp = tokens.get(token);
  if (!exp || exp < Date.now()) {
    if (exp) tokens.delete(token);
    throw new HttpError(401, 'Avtorizatsiya talab qilinadi');
  }
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
function validateCourse(input, existing) {
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
  } else if (!load('teachers').some((t) => t.id === c.teacherId)) {
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
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const rec = loginFails.get(ip);
    if (rec && rec.until > now) {
      const min = Math.ceil((rec.until - now) / 60000);
      throw new HttpError(429, `Juda ko'p noto'g'ri urinish. ${min} daqiqadan keyin qayta urinib ko'ring`);
    }
    const body = await readBody(req);
    const pass = typeof body.password === 'string' ? body.password : '';
    if (!crypto.timingSafeEqual(sha256(pass), sha256(ADMIN_PASSWORD))) {
      // Blok muddati o'tgan bo'lsa hisob noldan boshlanadi
      const count = (rec && rec.until === 0 ? rec.count : 0) + 1;
      loginFails.set(ip, { count, until: count >= MAX_FAILS ? now + BLOCK_MS : 0 });
      if (count >= MAX_FAILS) console.warn(`[xavfsizlik] ${ip} ${MAX_FAILS} marta noto'g'ri parol kiritdi — 15 daqiqaga bloklandi`);
      throw new HttpError(401, "Parol noto'g'ri");
    }
    loginFails.delete(ip);
    for (const [t, exp] of tokens) if (exp < now) tokens.delete(t); // eskirganlarni tozalash
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, now + TOKEN_TTL);
    return sendJson(res, 200, { token });
  }

  // --- logout (tokenni bekor qilish)
  if (resource === 'logout' && !id) {
    if (method !== 'POST') throw new HttpError(405, 'Metod ruxsat etilmagan');
    const m = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] || '');
    if (m) tokens.delete(m[1].trim());
    return sendJson(res, 200, { ok: true });
  }

  // --- courses
  if (resource === 'courses') {
    if (!id && method === 'GET') return sendJson(res, 200, load('courses'));
    if (!id && method === 'POST') {
      requireAuth(req);
      const body = await readBody(req);
      const course = { id: newId('c'), ...validateCourse(body) };
      const courses = load('courses');
      courses.push(course);
      save('courses', courses);
      return sendJson(res, 201, course);
    }
    if (id && method === 'PUT') {
      requireAuth(req);
      const body = await readBody(req);
      const courses = load('courses');
      const idx = courses.findIndex((c) => c.id === id);
      if (idx === -1) throw new HttpError(404, 'Kurs topilmadi');
      courses[idx] = { id, ...validateCourse(body, courses[idx]) };
      save('courses', courses);
      return sendJson(res, 200, courses[idx]);
    }
    if (id && method === 'DELETE') {
      requireAuth(req);
      const courses = load('courses');
      if (!courses.some((c) => c.id === id)) throw new HttpError(404, 'Kurs topilmadi');
      const groups = load('groups');
      const removedGroupIds = new Set(groups.filter((g) => g.courseId === id).map((g) => g.id));
      const apps = load('applications');
      let appsChanged = false;
      for (const a of apps) {
        if (a.groupId && removedGroupIds.has(a.groupId)) { a.groupId = null; a.status = 'new'; appsChanged = true; }
      }
      if (appsChanged) save('applications', apps);
      if (removedGroupIds.size) save('groups', groups.filter((g) => !removedGroupIds.has(g.id)));
      save('courses', courses.filter((c) => c.id !== id));
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(id ? 405 : 405, 'Metod ruxsat etilmagan');
  }

  // --- teachers
  if (resource === 'teachers') {
    if (!id && method === 'GET') return sendJson(res, 200, load('teachers'));
    if (!id && method === 'POST') {
      requireAuth(req);
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
      const teachers = load('teachers');
      teachers.push(t);
      save('teachers', teachers);
      return sendJson(res, 201, t);
    }
    if (id && method === 'DELETE') {
      requireAuth(req);
      const teachers = load('teachers');
      if (!teachers.some((t) => t.id === id)) throw new HttpError(404, 'Ustoz topilmadi');
      for (const name of ['courses', 'groups']) {
        const list = load(name);
        let changed = false;
        for (const item of list) if (item.teacherId === id) { item.teacherId = null; changed = true; }
        if (changed) save(name, list);
      }
      save('teachers', teachers.filter((t) => t.id !== id));
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(405, 'Metod ruxsat etilmagan');
  }

  // --- groups
  if (resource === 'groups') {
    requireAuth(req);
    if (!id && method === 'GET') return sendJson(res, 200, load('groups'));
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
      if (!load('courses').some((c) => c.id === g.courseId)) throw new HttpError(400, 'Bunday kurs mavjud emas');
      if (!load('teachers').some((t) => t.id === g.teacherId)) throw new HttpError(400, 'Bunday ustoz mavjud emas');
      if (!g.schedule) throw new HttpError(400, 'Dars jadvali kiritilishi shart');
      if (!Number.isInteger(g.capacity) || g.capacity < 1) throw new HttpError(400, 'Sig\'im musbat butun son bo\'lishi kerak');
      const groups = load('groups');
      groups.push(g);
      save('groups', groups);
      return sendJson(res, 201, g);
    }
    if (id && method === 'DELETE') {
      const groups = load('groups');
      if (!groups.some((g) => g.id === id)) throw new HttpError(404, 'Guruh topilmadi');
      const apps = load('applications');
      let changed = false;
      for (const a of apps) if (a.groupId === id) { a.groupId = null; a.status = 'new'; changed = true; }
      if (changed) save('applications', apps);
      save('groups', groups.filter((g) => g.id !== id));
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
      if (!load('courses').some((c) => c.id === courseId)) throw new HttpError(400, 'Kurs tanlanmagan yoki mavjud emas');
      if (name.length > 100 || phone.length > 30 || message.length > 2000) throw new HttpError(400, 'Maydonlar juda uzun');
      const apps = load('applications');
      const app = { id: newAppId(apps), name, phone, courseId, message, status: 'new', groupId: null, seen: false, adminNote: '', noteUpdatedAt: null, createdAt: new Date().toISOString() };
      apps.push(app);
      save('applications', apps);
      return sendJson(res, 201, app);
    }
    requireAuth(req);
    if (!id && method === 'GET') {
      const apps = load('applications').slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return sendJson(res, 200, apps);
    }
    // POST /api/applications/seen — barcha arizalarni "ko'rilgan" deb belgilaydi
    if (id === 'seen' && method === 'POST') {
      const apps = load('applications');
      let changed = 0;
      for (const a of apps) if (a.seen !== true) { a.seen = true; changed++; }
      if (changed) save('applications', apps);
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
      const apps = load('applications');
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
        save('applications', apps);
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
        const group = load('groups').find((g) => g.id === groupId);
        if (!group) throw new HttpError(400, 'Bunday guruh mavjud emas');
        if (app.groupId !== groupId) {
          const count = apps.filter((a) => a.groupId === groupId && a.id !== app.id).length;
          if (count >= group.capacity) throw new HttpError(400, "Guruh to'lgan");
        }
        app.groupId = groupId;
        app.status = 'assigned';
      }
      save('applications', apps);
      return sendJson(res, 200, app);
    }
    if (id && method === 'DELETE') {
      const apps = load('applications');
      if (!apps.some((a) => a.id === id)) throw new HttpError(404, 'Ariza topilmadi');
      save('applications', apps.filter((a) => a.id !== id));
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
const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
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
});

initData();
migrateApplicationIds();
server.listen(PORT, () => {
  console.log(`O'quv markaz serveri ishga tushdi: http://localhost:${PORT}`);
});
