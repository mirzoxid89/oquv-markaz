# Bilim Markazi — o'quv markaz sayti va admin panel

O'quv markaz uchun veb-sayt: kurslar, ustozlar, narxlar va kursga yozilish formasi. Admin panel orqali arizalarni ko'rish, guruhlarga taqsimlash, kurs, guruh va ustozlarni boshqarish mumkin.

Dizayn: dark navy + zumrad yashil, telefon, planshet va kompyuterga moslashgan.

## Ishga tushirish

Faqat [Node.js](https://nodejs.org) kerak (18+), qo'shimcha paket o'rnatilmaydi.

```bash
npm start        # yoki: node server.js
```

- Sayt: http://localhost:3000
- Admin panel: http://localhost:3000/admin — parol doimiy: kodda faqat uning scrypt xeshi saqlanadi (`server.js` dagi `ADMIN_PASSWORD_HASH`). Parolning o'zi repozitoriyda yo'q.
- Port: `PORT` muhit o'zgaruvchisi (standart 3000)

Birinchi ishga tushganda `data/` papkasi namunaviy ma'lumotlar bilan yaratiladi.

## Imkoniyatlar

**Sayt:** kurslar (daraja bo'yicha filtr, qidiruv), ustozlar (rasm bilan), narxlar, kursga yozilish formasi (validatsiya, +998 format).

**Admin panel:**
- Arizalar: 6 xonali ID, holat (Yangi / Biriktirildi), guruhga biriktirish, admin izohi, filtr va qidiruv
- Ko'rilmagan arizalar soni sidebar'da ko'rinadi
- Guruhlar (bandlik nazorati), kurslar va ustozlarni qo'shish/tahrirlash/o'chirish

## Ariza formasi himoyasi

- **Bot-tuzoq:** yashirin `website` maydoni to'ldirilgan yoki forma 3 soniyadan tez yuborilgan (`formTime < 3000`) bo'lsa — ariza saqlanmaydi (bot oddiy javob oladi).
- **IP limiti:** bir IP dan 10 daqiqada 10 tadan ortiq ariza → 429 (maktab Wi-Fi'ida ko'p odam bitta IP da bo'lgani uchun).
- **Takror ariza:** shu telefon (oxirgi 9 raqam) shu kursga 24 soat ichida qayta yuborsa → 409.
- Vercel (Redis) rejimida har bir ariza alohida saqlanadi (hash `oquv:apps`), bir vaqtda kelgan arizalar yo'qolmaydi. Eski `oquv:applications` kaliti avtomatik ko'chiriladi.

## Telegram bildirishnomasi

Har bir yangi ariza admin Telegramiga xabar bo'lib keladi (ID, ism, telefon, kurs, izoh, Toshkent vaqti).

1. Telegramda [@BotFather](https://t.me/BotFather) → `/newbot` → bot nomini kiriting → **token** beriladi (`123456789:AA...`).
2. Yangi botingizni oching va unga `/start` yozing (guruhga yuborish kerak bo'lsa — botni guruhga qo'shib, guruhda biror xabar yozing).
3. Brauzerda `https://api.telegram.org/bot<TOKEN>/getUpdates` ni oching va `"chat":{"id": ...}` dagi sonni oling — bu **chat id** (guruhniki manfiy, masalan `-100...`).
4. Sozlang:
   - Lokal: `.env` fayliga
     ```
     TELEGRAM_BOT_TOKEN=123456789:AA...
     TELEGRAM_CHAT_ID=987654321
     ```
     va serverni qayta ishga tushiring.
   - Vercel: Project → Settings → Environment Variables ga shu ikkisini qo'shing va qayta deploy qiling.
5. Admin panelda tekshirish: `GET /api/telegram/status` → `{ configured: true }`, `POST /api/telegram/test` test xabar yuboradi.

Token hech qachon javob yoki logda ko'rsatilmaydi. Telegram ishlamasa ham ariza saqlanaveradi (xato faqat server logiga yoziladi).

## Tuzilma

```
server.js            Node.js server (faqat built-in modullar) + REST API
public/              sayt (index.html, css/, js/, img/)
public/admin/        admin panel
API.md               API hujjati
DESIGN.md            rang va dizayn tizimi
```

> Ustozlar rasmlari (`public/img/teachers/`) — randomuser.me dan olingan namunaviy portretlar. Haqiqiy foydalanishda o'z rasmlaringizga almashtiring.

## Testlar

```bash
npm test
```

13 ta avtomatik test (`test/api.test.js`): sahifalar, admin kirishi, arizalar, spam himoyasi, guruhga biriktirish, kurslar, zaxira nusxa. Testlar vaqtinchalik papkada ishlaydi — `data/` ga tegmaydi, Telegram'ga xabar yubormaydi.

## Zaxira nusxa

Admin panel → Bosh sahifa → **Zaxira nusxa → Yuklab olish**: barcha ma'lumotlar bitta JSON faylga saqlanadi. Haftada bir marta yuklab olish tavsiya etiladi.
