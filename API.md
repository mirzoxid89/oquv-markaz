# O'quv markaz — API shartnomasi (barcha agentlar uchun yagona manba)

Stack: Node.js (faqat built-in modullar, npm paketsiz), `node server.js` → http://localhost:3000
Ma'lumotlar: `data/*.json` fayllarda saqlanadi.
UI tili: o'zbek (lotin).

## Fayl egaligi (har agent FAQAT o'z fayllariga yozadi)
- Backend agent: `server.js`, `data/`
- Sayt agent: `public/index.html`, `public/css/site.css`, `public/js/site.js`
- Admin agent: `public/admin/index.html`, `public/admin/admin.css`, `public/admin/admin.js`

## Statik fayllar
- `/` → `public/index.html`, `/admin` va `/admin/` → `public/admin/index.html`
- Boshqa yo'llar `public/` ichidan beriladi (masalan `/css/site.css`, `/admin/admin.js`).

## Umumiy qoidalar
- Barcha body va javoblar JSON. Xato: `{ "error": "xabar" }` + 400/401/404 status.
- id lar — string (masalan `"c1"`, yoki `Date.now().toString(36)`).
- Admin endpointlari `Authorization: Bearer <token>` talab qiladi, aks holda 401.

## Modellar
```
Course      { id, title, description, level, duration, price, teacherId, icon }
            level: "Boshlang'ich" | "O'rta" | "Yuqori"; duration: "3 oy" kabi string; price: number (so'm/oy); icon: emoji string
Teacher     { id, name, subject, experience, bio, photo }
            experience: number (yil); photo: rasm URL yoki "" (bo'sh bo'lsa frontend initsial ko'rsatadi)
Group       { id, name, courseId, teacherId, schedule, capacity }
            schedule: "Du-Chor-Ju 14:00" kabi string; capacity: number
Application { id, name, phone, courseId, message, status, groupId, createdAt }
            status: "new" | "assigned"; groupId: string | null; createdAt: ISO string
            id: 6 xonali raqamli string ("482913"), takrorlanmaydi; eski formatdagilar server ishga tushganda ko'chiriladi
            adminNote: string — admin izohi; noteUpdatedAt: ISO string | null
            seen: boolean — admin "Arizalar" bo'limini ochganda true bo'ladi (maydon yo'q bo'lsa = ko'rilmagan)
```

## Ochiq endpointlar
| Metod | Yo'l | Body | Javob |
|---|---|---|---|
| GET | /api/courses | — | Course[] |
| GET | /api/teachers | — | Teacher[] |
| POST | /api/applications | { name, phone, courseId, message? } | 201 Application |
| POST | /api/login | { password } | { token } yoki 401 |

POST /api/applications validatsiyasi: name (≥2 belgi), phone (≥9 raqam), courseId mavjud kurs bo'lishi shart.

## Admin endpointlari (token kerak)
| Metod | Yo'l | Body | Javob |
|---|---|---|---|
| GET | /api/applications | — | Application[] (yangilari birinchi) |
| PATCH | /api/applications/:id | { groupId: string \| null } | Application (groupId bo'lsa status="assigned", null bo'lsa "new") |
| PATCH | /api/applications/:id | { status: "new" \| "assigned" } | Application — holat guruhdan mustaqil; "new" bo'lsa groupId=null, "assigned" da guruh o'zgarmaydi |
| PATCH | /api/applications/:id | { adminNote: string } (≤2000) | Application — izohni saqlaydi, noteUpdatedAt yangilanadi; status/groupId bilan birga yuborish mumkin |
| POST | /api/applications/seen | — | { ok, changed } — barcha arizalarni seen=true qiladi |
| DELETE | /api/applications/:id | — | { ok: true } |
| POST | /api/courses | { title, description, level, duration, price, teacherId, icon? } | 201 Course |
| PUT | /api/courses/:id | Course maydonlari | Course |
| DELETE | /api/courses/:id | — | { ok: true } |
| POST | /api/teachers | { name, subject, experience, bio, photo? } | 201 Teacher |
| DELETE | /api/teachers/:id | — | { ok: true } |
| GET | /api/groups | — | Group[] |
| POST | /api/groups | { name, courseId, teacherId, schedule, capacity } | 201 Group |
| DELETE | /api/groups/:id | — | { ok: true } (shu guruhdagi arizalar groupId=null, status="new" bo'ladi) |

PATCH guruhga biriktirishda guruh to'lgan bo'lsa (capacity) → 400 `{ error: "Guruh to'lgan" }`.

Admin paroli doimiy: server.js dagi `ADMIN_PASSWORD_HASH` (scrypt) bilan tekshiriladi, .env/muhit o'zgaruvchisiga bog'liq emas. Token 12 soat amal qiladi, `POST /api/logout` bekor qiladi. Bir IP dan 5 ta noto'g'ri urinish → 15 daqiqa blok (429).
Frontend admin tokenni `localStorage["adminToken"]` da saqlaydi.
