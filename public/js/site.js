/* Bilim Markazi — ommaviy sayt skripti (vanilla JS) */
(function () {
  'use strict';

  // ---------- Holat ----------
  var state = {
    courses: [],
    teachers: [],
    teacherMap: {},
    filter: { level: '', query: '' },
    coursesLoaded: false
  };

  // ---------- Yordamchilar ----------
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /** Xavfsiz element yaratish: matn faqat textContent orqali qo'yiladi (XSS himoyasi). */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var val = attrs[key];
        if (val === null || val === undefined || val === false) return;
        if (key === 'class') node.className = val;
        else if (key === 'text') node.textContent = val;
        else if (key === 'style') node.setAttribute('style', val);
        else if (key.indexOf('on') === 0 && typeof val === 'function') node.addEventListener(key.slice(2), val);
        else node.setAttribute(key, val);
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function formatPrice(value) {
    var n = Number(value);
    if (!isFinite(n)) return "Narx so'raladi";
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + " so'm";
  }

  function str(v) { return v === null || v === undefined ? '' : String(v); }

  function levelClass(level) {
    switch (level) {
      case "Boshlang'ich": return 'level--beg';
      case "O'rta": return 'level--mid';
      case 'Yuqori': return 'level--adv';
      default: return 'level--def';
    }
  }

  function initials(name) {
    var parts = str(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var s = parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '');
    return s.toUpperCase();
  }

  // Zumrad / teal tuslari (DESIGN.md palitrasi asosida)
  var AVATAR_GRADIENTS = [
    ['#10B981', '#0D9488'], ['#34D399', '#059669'], ['#0D9488', '#0E7490'],
    ['#059669', '#10B981'], ['#14B8A6', '#0F766E'], ['#2DD4BF', '#0D9488']
  ];
  function avatarGradient(seed) {
    var h = 0, s = str(seed);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    var g = AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
    return 'background: linear-gradient(135deg, ' + g[0] + ', ' + g[1] + ');';
  }

  function isSafeUrl(url) {
    return /^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(str(url).trim());
  }

  /** fetch + timeout + JSON parsing; xato bo'lsa serverdagi `error` matni bilan Error tashlaydi. */
  function api(path, options) {
    options = options || {};
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 12000) : null;
    var init = {
      method: options.method || 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller ? controller.signal : undefined
    };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return fetch(path, init)
      .then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          if (!res.ok) {
            var msg = data && data.error ? data.error : 'Server xatosi (' + res.status + ')';
            var err = new Error(msg);
            err.status = res.status;
            err.fromServer = true;
            throw err;
          }
          return data;
        });
      })
      .catch(function (err) {
        if (err && err.fromServer) throw err;
        if (err && err.name === 'AbortError') throw new Error("Server javob bermadi. Birozdan so'ng qayta urinib ko'ring.");
        throw new Error("Serverga ulanib bo'lmadi. Internet aloqangizni tekshiring.");
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  // ---------- Toast ----------
  var toastTimer = null;
  function toast(message, type) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = message;
    t.className = 'toast' + (type ? ' toast--' + type : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4000);
  }

  // ---------- Holat bloklari (loader, xato, bo'sh) ----------
  function renderSkeleton(container, count, kind) {
    clear(container);
    for (var i = 0; i < count; i++) {
      var card = el('div', { class: 'card skeleton', 'aria-hidden': 'true' });
      if (kind === 'teacher') card.appendChild(el('div', { class: 'sk sk--circle' }));
      else card.appendChild(el('div', { class: 'sk sk--icon' }));
      card.appendChild(el('div', { class: 'sk sk--title' }));
      card.appendChild(el('div', { class: 'sk sk--line' }));
      card.appendChild(el('div', { class: 'sk sk--line' }));
      card.appendChild(el('div', { class: 'sk sk--line sk--short' }));
      container.appendChild(card);
    }
    container.setAttribute('aria-busy', 'true');
  }

  function renderState(container, opts) {
    clear(container);
    container.removeAttribute('aria-busy');
    var box = el('div', { class: 'state' + (opts.error ? ' state--error' : '') }, [
      el('div', { class: 'state__icon', text: opts.icon || (opts.error ? '⚠️' : '🔎') }),
      el('h3', { text: opts.title }),
      el('p', { text: opts.text })
    ]);
    if (opts.action) {
      box.appendChild(el('button', { class: 'btn btn--outline btn--sm', type: 'button', text: opts.action.label, onclick: opts.action.handler }));
    }
    container.appendChild(box);
  }

  // ---------- Kurslar ----------
  function courseCard(course) {
    var teacher = state.teacherMap[course.teacherId];
    var meta = el('div', { class: 'course__meta' }, [
      el('span', { title: 'Davomiyligi' }, ['⏱️ ', str(course.duration) || '—']),
      el('span', { title: 'Ustoz' }, ['👤 ', teacher ? str(teacher.name) : (state.teachers.length ? 'Ustoz belgilanmagan' : '—')])
    ]);

    var btn = el('button', {
      class: 'btn btn--primary btn--sm', type: 'button', text: 'Yozilish',
      'aria-label': str(course.title) + ' kursiga yozilish',
      onclick: function () { selectCourseAndScroll(course.id); }
    });

    return el('article', { class: 'card course' }, [
      el('div', { class: 'course__top' }, [
        el('div', { class: 'course__icon', 'aria-hidden': 'true', text: str(course.icon) || '📘' }),
        el('span', { class: 'level ' + levelClass(course.level), text: str(course.level) || 'Daraja' })
      ]),
      el('h3', { class: 'course__title', text: str(course.title) }),
      el('p', { class: 'course__desc', text: str(course.description) }),
      meta,
      el('div', { class: 'course__foot' }, [
        el('div', { class: 'price' }, [formatPrice(course.price), el('small', { text: '/oy' })]),
        btn
      ])
    ]);
  }

  function filteredCourses() {
    var q = state.filter.query.trim().toLowerCase();
    var lvl = state.filter.level;
    return state.courses.filter(function (c) {
      if (lvl && c.level !== lvl) return false;
      if (!q) return true;
      var teacher = state.teacherMap[c.teacherId];
      var hay = [c.title, c.description, c.level, teacher && teacher.name, teacher && teacher.subject].map(str).join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function renderCourses() {
    var grid = $('#coursesGrid');
    if (!state.coursesLoaded) return;
    if (!state.courses.length) {
      renderState(grid, { icon: '📚', title: "Hozircha kurslar yo'q", text: "Tez orada yangi kurslar qo'shiladi." });
      return;
    }
    var list = filteredCourses();
    if (!list.length) {
      renderState(grid, {
        title: 'Hech narsa topilmadi',
        text: "Qidiruv so'zini yoki daraja filtrini o'zgartirib ko'ring.",
        action: { label: 'Filtrni tozalash', handler: resetFilters }
      });
      return;
    }
    clear(grid);
    grid.removeAttribute('aria-busy');
    var frag = document.createDocumentFragment();
    list.forEach(function (c) { frag.appendChild(courseCard(c)); });
    grid.appendChild(frag);
  }

  function resetFilters() {
    state.filter.level = '';
    state.filter.query = '';
    var input = $('#courseSearch');
    if (input) input.value = '';
    $$('#levelChips .chip').forEach(function (chip) {
      chip.classList.toggle('is-active', chip.getAttribute('data-level') === '');
      chip.setAttribute('aria-pressed', chip.getAttribute('data-level') === '' ? 'true' : 'false');
    });
    renderCourses();
  }

  function initFilters() {
    var input = $('#courseSearch');
    var debounce = null;
    if (input) {
      input.addEventListener('input', function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          state.filter.query = input.value;
          renderCourses();
        }, 150);
      });
    }
    $$('#levelChips .chip').forEach(function (chip) {
      chip.setAttribute('type', 'button');
      chip.setAttribute('aria-pressed', chip.classList.contains('is-active') ? 'true' : 'false');
      chip.addEventListener('click', function () {
        state.filter.level = chip.getAttribute('data-level') || '';
        $$('#levelChips .chip').forEach(function (c) {
          var active = c === chip;
          c.classList.toggle('is-active', active);
          c.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        renderCourses();
      });
    });
  }

  // ---------- Ustozlar ----------
  function teacherCard(t) {
    var avatar = el('div', { class: 'avatar', style: avatarGradient(t.id || t.name), 'aria-hidden': 'true' });
    var initialsText = initials(t.name);
    if (t.photo && isSafeUrl(t.photo)) {
      var img = el('img', { src: str(t.photo).trim(), alt: '', loading: 'lazy' });
      img.addEventListener('error', function () {
        clear(avatar);
        avatar.textContent = initialsText;
      });
      avatar.appendChild(img);
    } else {
      avatar.textContent = initialsText;
    }
    var exp = Number(t.experience);
    return el('article', { class: 'card teacher' }, [
      avatar,
      el('h3', { class: 'teacher__name', text: str(t.name) }),
      el('div', { class: 'teacher__subject', text: str(t.subject) }),
      isFinite(exp) && exp > 0 ? el('span', { class: 'teacher__exp', text: exp + ' yillik tajriba' }) : null,
      t.bio ? el('p', { class: 'teacher__bio', text: str(t.bio) }) : null
    ]);
  }

  function renderTeachers() {
    var grid = $('#teachersGrid');
    if (!state.teachers.length) {
      renderState(grid, { icon: '👩‍🏫', title: "Ustozlar ro'yxati bo'sh", text: "Ma'lumotlar tez orada qo'shiladi." });
      return;
    }
    clear(grid);
    grid.removeAttribute('aria-busy');
    var frag = document.createDocumentFragment();
    state.teachers.forEach(function (t) { frag.appendChild(teacherCard(t)); });
    grid.appendChild(frag);
  }

  // ---------- Narxlar ----------
  function renderPricing() {
    var grid = $('#pricingGrid');
    if (!state.courses.length) {
      renderState(grid, { icon: '💳', title: "Narxlar mavjud emas", text: "Kurslar qo'shilgach narxlar shu yerda ko'rinadi." });
      return;
    }
    var sorted = state.courses.slice().sort(function (a, b) { return (Number(a.price) || 0) - (Number(b.price) || 0); });
    var featuredIdx = sorted.length >= 3 ? Math.floor(sorted.length / 2) : -1;
    clear(grid);
    grid.removeAttribute('aria-busy');
    var frag = document.createDocumentFragment();
    sorted.forEach(function (c, i) {
      var teacher = state.teacherMap[c.teacherId];
      var featured = i === featuredIdx;
      frag.appendChild(el('article', { class: 'card plan' + (featured ? ' plan--featured' : '') }, [
        featured ? el('span', { class: 'plan__tag', text: 'Ommabop' }) : null,
        el('div', { class: 'plan__icon', 'aria-hidden': 'true', text: str(c.icon) || '📘' }),
        el('h3', { class: 'plan__title', text: str(c.title) }),
        el('div', { class: 'plan__desc', text: str(c.level) }),
        el('div', { class: 'plan__price' }, [formatPrice(c.price), el('small', { text: 'bir oy uchun' })]),
        el('ul', { class: 'plan__list' }, [
          el('li', { text: '⏱️ Davomiyligi: ' + (str(c.duration) || '—') }),
          el('li', { text: '👤 Ustoz: ' + (teacher ? str(teacher.name) : '—') }),
          el('li', { text: '🎁 Bepul sinov darsi' }),
          el('li', { text: '📜 Sertifikat' })
        ]),
        el('button', {
          class: 'btn ' + (featured ? 'btn--primary' : 'btn--outline') + ' btn--block', type: 'button', text: 'Tanlash',
          onclick: function () { selectCourseAndScroll(c.id); }
        })
      ]));
    });
    grid.appendChild(frag);
  }

  // ---------- Forma: kurs select ----------
  function fillCourseSelect() {
    var select = $('#fCourse');
    var prev = select.value;
    clear(select);
    if (!state.courses.length) {
      select.appendChild(el('option', { value: '', text: state.coursesLoaded ? "Kurslar mavjud emas" : "Kurslarni yuklab bo'lmadi" }));
      select.disabled = true;
      return;
    }
    select.disabled = false;
    select.appendChild(el('option', { value: '', text: '— Kursni tanlang —' }));
    state.courses.forEach(function (c) {
      select.appendChild(el('option', { value: str(c.id), text: str(c.icon ? c.icon + ' ' : '') + str(c.title) + ' — ' + formatPrice(c.price) + '/oy' }));
    });
    if (prev && state.courses.some(function (c) { return str(c.id) === prev; })) select.value = prev;
  }

  function selectCourseAndScroll(courseId) {
    var select = $('#fCourse');
    select.value = str(courseId);
    clearFieldError('courseId');
    var section = $('#apply');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    select.classList.remove('is-highlight');
    void select.offsetWidth; // animatsiyani qayta ishga tushirish
    select.classList.add('is-highlight');
    setTimeout(function () {
      var name = $('#fName');
      if (name && !name.value) { try { name.focus({ preventScroll: true }); } catch (e) { name.focus(); } }
    }, 600);
  }

  // ---------- Telefon formatlash ----------
  function phoneLocalDigits(value) {
    var d = str(value).replace(/\D/g, '');
    if (d.indexOf('998') === 0) d = d.slice(3);
    return d.slice(0, 9);
  }
  function formatPhone(local) {
    var out = '+998';
    if (local.length) out += ' ' + local.slice(0, 2);
    if (local.length > 2) out += ' ' + local.slice(2, 5);
    if (local.length > 5) out += ' ' + local.slice(5, 7);
    if (local.length > 7) out += ' ' + local.slice(7, 9);
    return out;
  }
  function initPhoneInput() {
    var input = $('#fPhone');
    input.addEventListener('focus', function () {
      if (!input.value) input.value = '+998 ';
    });
    input.addEventListener('blur', function () {
      if (!phoneLocalDigits(input.value)) input.value = '';
    });
    input.addEventListener('input', function () {
      var local = phoneLocalDigits(input.value);
      input.value = local.length ? formatPhone(local) : '+998 ';
      if (local.length >= 9) clearFieldError('phone');
    });
  }

  // ---------- Forma validatsiya va yuborish ----------
  function setFieldError(name, message) {
    var small = $('.field__error[data-for="' + name + '"]');
    if (!small) return;
    small.textContent = message;
    small.parentNode.classList.add('has-error');
  }
  function clearFieldError(name) {
    var small = $('.field__error[data-for="' + name + '"]');
    if (!small) return;
    small.textContent = '';
    small.parentNode.classList.remove('has-error');
  }

  function showAlert(type, message) {
    var box = $('#formAlert');
    clear(box);
    box.className = 'form__alert form__alert--' + type;
    var icons = { error: '⚠️', warning: '⏳', info: 'ℹ️', success: '✅' };
    box.appendChild(el('span', { 'aria-hidden': 'true', text: icons[type] || '✅' }));
    box.appendChild(el('span', { text: message }));
    box.hidden = false;
  }
  function hideAlert() { var box = $('#formAlert'); box.hidden = true; clear(box); }

  function validate(data) {
    var ok = true;
    ['name', 'phone', 'courseId'].forEach(clearFieldError);
    if (data.name.length < 2) { setFieldError('name', "Ism kamida 2 ta belgidan iborat bo'lishi kerak"); ok = false; }
    if (data.phone.replace(/\D/g, '').length < 9 || phoneLocalDigits(data.phone).length < 9) {
      setFieldError('phone', "Telefon raqamni to'liq kiriting (masalan, +998 90 123 45 67)"); ok = false;
    }
    if (!data.courseId) { setFieldError('courseId', 'Iltimos, kursni tanlang'); ok = false; }
    return ok;
  }

  function setSubmitting(btn, on) {
    btn.disabled = on;
    clear(btn);
    if (on) {
      btn.appendChild(el('span', { class: 'spinner', 'aria-hidden': 'true' }));
      btn.appendChild(el('span', { class: 'btn__label', text: 'Yuborilmoqda...' }));
    } else {
      btn.appendChild(el('span', { class: 'btn__label', text: 'Ariza yuborish' }));
    }
  }

  function initForm() {
    var form = $('#applyForm');
    var btn = $('#submitBtn');
    var submitting = false;
    var loadedAt = Date.now(); // formTime uchun (spam himoyasi)

    $('#fName').addEventListener('input', function (e) { if (e.target.value.trim().length >= 2) clearFieldError('name'); });
    $('#fCourse').addEventListener('change', function (e) { if (e.target.value) clearFieldError('courseId'); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submitting) return;
      hideAlert();

      var data = {
        name: $('#fName').value.trim(),
        phone: $('#fPhone').value.trim(),
        courseId: $('#fCourse').value,
        message: $('#fMessage').value.trim()
      };
      if (!validate(data)) {
        var firstErr = $('.field.has-error input, .field.has-error select', form);
        if (firstErr) firstErr.focus();
        return;
      }

      var body = { name: data.name, phone: formatPhone(phoneLocalDigits(data.phone)), courseId: data.courseId };
      if (data.message) body.message = data.message;
      var hp = $('#fWebsite');
      body.website = hp ? hp.value : '';
      body.formTime = Date.now() - loadedAt;

      submitting = true;
      setSubmitting(btn, true);
      api('/api/applications', { method: 'POST', body: body })
        .then(function () {
          var course = state.courses.filter(function (c) { return str(c.id) === data.courseId; })[0];
          form.reset();
          loadedAt = Date.now(); // yangi ariza uchun vaqtni qayta boshlash
          ['name', 'phone', 'courseId'].forEach(clearFieldError);
          showAlert('success', 'Rahmat, ' + data.name + '! Arizangiz' + (course ? ' "' + str(course.title) + '" kursiga' : '') +
            " qabul qilindi. Tez orada siz bilan bog'lanamiz.");
          toast('Ariza muvaffaqiyatli yuborildi!', 'success');
        })
        .catch(function (err) {
          // 409 — ariza allaqachon bor (ma'lumot), 429 — juda ko'p urinish (ogohlantirish). Forma tozalanmaydi.
          var kind = err && err.status === 409 ? 'info' : err && err.status === 429 ? 'warning' : 'error';
          showAlert(kind, err.message || "Xatolik yuz berdi. Qayta urinib ko'ring.");
          toast(err.message || 'Xatolik yuz berdi', kind);
        })
        .finally(function () {
          submitting = false;
          setSubmitting(btn, false);
        });
    });
  }

  // ---------- Ma'lumotlarni yuklash ----------
  function loadData() {
    var coursesGrid = $('#coursesGrid');
    var teachersGrid = $('#teachersGrid');
    var pricingGrid = $('#pricingGrid');
    renderSkeleton(coursesGrid, 3, 'course');
    renderSkeleton(teachersGrid, 4, 'teacher');
    renderSkeleton(pricingGrid, 3, 'plan');
    var select = $('#fCourse');
    clear(select);
    select.appendChild(el('option', { value: '', text: 'Yuklanmoqda...' }));
    select.disabled = true;

    var teachersReq = api('/api/teachers').then(function (data) {
      state.teachers = Array.isArray(data) ? data : [];
      state.teacherMap = {};
      state.teachers.forEach(function (t) { state.teacherMap[t.id] = t; });
      renderTeachers();
      var st = $('#statTeachers');
      if (st && state.teachers.length) st.textContent = state.teachers.length + '+';
      return true;
    }).catch(function (err) {
      state.teachers = [];
      renderState(teachersGrid, {
        error: true, title: "Ustozlarni yuklab bo'lmadi", text: err.message,
        action: { label: 'Qayta urinish', handler: loadData }
      });
      return false;
    });

    var coursesReq = api('/api/courses').then(function (data) {
      return Array.isArray(data) ? data : [];
    });

    // Kurs kartalarida ustoz ismi kerak — shuning uchun ikkala so'rovni kutamiz
    Promise.all([coursesReq, teachersReq]).then(function (res) {
      state.courses = res[0];
      state.coursesLoaded = true;
      var sc = $('#statCourses');
      if (sc && state.courses.length) sc.textContent = state.courses.length + '+';
      renderCourses();
      renderPricing();
      fillCourseSelect();
    }).catch(function (err) {
      state.courses = [];
      state.coursesLoaded = false;
      var opts = {
        error: true, title: "Kurslarni yuklab bo'lmadi", text: err.message,
        action: { label: 'Qayta urinish', handler: loadData }
      };
      renderState(coursesGrid, opts);
      renderState(pricingGrid, {
        error: true, title: "Narxlarni yuklab bo'lmadi", text: err.message,
        action: { label: 'Qayta urinish', handler: loadData }
      });
      fillCourseSelect();
    });
  }

  // ---------- Navigatsiya ----------
  function initNav() {
    var burger = $('#burger');
    var nav = $('#nav');
    var header = $('#header');
    var DESKTOP = 1024; // CSS dagi kompyuter breakpointi bilan bir xil
    function setOpen(open) {
      if (open && window.innerWidth >= DESKTOP) open = false;
      nav.classList.toggle('is-open', open);
      document.body.classList.toggle('nav-open', open); // ochiq paytda body scroll bloklanadi
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Menyuni yopish' : 'Menyuni ochish');
    }
    burger.addEventListener('click', function () { setOpen(!nav.classList.contains('is-open')); });
    $$('a', nav).forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    document.addEventListener('click', function (e) {
      if (nav.classList.contains('is-open') && !nav.contains(e.target) && !burger.contains(e.target)) setOpen(false);
    });
    window.addEventListener('resize', function () { if (window.innerWidth >= DESKTOP) setOpen(false); });
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- Ishga tushirish ----------
  function init() {
    var y = $('#year');
    if (y) y.textContent = String(new Date().getFullYear());
    initNav();
    initFilters();
    initPhoneInput();
    initForm();
    loadData();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
