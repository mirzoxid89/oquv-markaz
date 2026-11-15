# Dizayn tizimi — Dark Navy + Zumrad yashil (sayt va admin uchun umumiy)

Har ikki CSS fayl (`public/css/site.css`, `public/admin/admin.css`) `:root` da AYNAN shu tokenlarni e'lon qiladi va ranglarni faqat tokenlar orqali ishlatadi.

```css
:root {
  /* Fon qatlamlari (dark navy) */
  --bg:          #0A1324;   /* sahifa foni */
  --bg-2:        #0E1A30;   /* muqobil bo'lim foni */
  --surface:     #122140;   /* karta / panel */
  --surface-2:   #18294D;   /* hover, input foni */
  --border:      #22375F;
  --border-soft: rgba(148, 180, 230, 0.10);

  /* Matn */
  --text:        #E7EEF9;
  --text-muted:  #94A6C6;
  --text-dim:    #6B7FA3;

  /* Zumrad yashil (asosiy aksent) */
  --primary:        #10B981;
  --primary-hover:  #0EA371;
  --primary-strong: #059669;
  --primary-light:  #34D399;            /* to'q fonda matn/ikonka uchun */
  --primary-soft:   rgba(16, 185, 129, 0.14);
  --primary-glow:   0 8px 30px rgba(16, 185, 129, 0.28);
  --gradient:       linear-gradient(135deg, #10B981 0%, #0D9488 100%);

  /* Holat ranglari */
  --warning:      #F59E0B;  --warning-soft: rgba(245, 158, 11, 0.14);
  --danger:       #F43F5E;  --danger-soft:  rgba(244, 63, 94, 0.14);
  --info:         #38BDF8;  --info-soft:    rgba(56, 189, 248, 0.14);
  --success:      var(--primary); --success-soft: var(--primary-soft);

  --radius-sm: 8px; --radius: 14px; --radius-lg: 20px;
  --shadow: 0 10px 30px rgba(2, 8, 23, 0.45);
  --font: 'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif;
}
```

Qoidalar:
- Faqat dark tema (navy). `body { background: var(--bg); color: var(--text); }`.
- Tugmalar: asosiy — `--primary` fon, navy (#06231A yoki #0A1324) matn yoki oq matn (kontrast ≥ 4.5:1); hoverda `--primary-hover` + `--primary-glow`. Ikkilamchi — shaffof, `--border` chegara.
- Inputlar: `--surface-2` fon, `--border` chegara, fokusda `--primary` chegara + `0 0 0 3px var(--primary-soft)`.
- Shrift: Google Fonts Manrope (400/500/600/700/800).
- Breakpointlar (mobile-first tavsiya etiladi): telefon < 640px, planshet 640–1023px, kompyuter ≥ 1024px. Qo'shimcha: 375px kichik telefon.
- Hech qaysi o'lchamda gorizontal scroll bo'lmasin; telefonda yon gutter 16px; tegish nishonlari ≥ 44px.
