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

## Tuzilma

```
server.js            Node.js server (faqat built-in modullar) + REST API
public/              sayt (index.html, css/, js/, img/)
public/admin/        admin panel
API.md               API hujjati
DESIGN.md            rang va dizayn tizimi
```

> Ustozlar rasmlari (`public/img/teachers/`) — randomuser.me dan olingan namunaviy portretlar. Haqiqiy foydalanishda o'z rasmlaringizga almashtiring.
