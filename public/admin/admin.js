(function () {
  'use strict';

  var TOKEN_KEY = 'adminToken';
  var LEVELS = ["Boshlang'ich", "O'rta", 'Yuqori'];
  var VIEW_TITLES = {
    dashboard: 'Bosh sahifa',
    applications: 'Arizalar',
    groups: 'Guruhlar',
    courses: 'Kurslar',
    teachers: 'Ustozlar'
  };

  var state = {
    courses: [],
    teachers: [],
    groups: [],
    applications: [],
    view: 'dashboard',
    loaded: false,
    telegram: { status: 'loading', configured: false, sending: false }, // status: loading | ok | error
    justSeen: {}, // shu safar birinchi marta ko'rilgan arizalar (qatorni ajratib ko'rsatish uchun)
    filters: { search: '', status: 'all', course: 'all' }
  };

  // ---------- Helpers ----------
  function $(id) { return document.getElementById(id); }

  // Safe DOM builder: strings become text nodes (XSS-safe)
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  function formatPrice(n) {
    var num = Math.round(Number(n) || 0);
    return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + " so'm";
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  // Vaqt doim Toshkent bo'yicha (UTC+5, yozgi vaqt yo'q) — qurilmaning soat mintaqasiga bog'liq emas.
  // Qaytgan sanadan faqat getUTC* bilan o'qiladi.
  function tashkent(d) { return new Date(d.getTime() + 5 * 60 * 60 * 1000); }
  function ymd(d) { var t = tashkent(d); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }
  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var t = tashkent(d);
    return pad(t.getUTCDate()) + '.' + pad(t.getUTCMonth() + 1) + '.' + t.getUTCFullYear() + ' ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes());
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join('') || '?';
  }
  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function courseName(id) { var c = byId(state.courses, id); return c ? c.title : "Noma'lum kurs"; }
  function teacherName(id) { var t = byId(state.teachers, id); return t ? t.name : '—'; }
  function memberCounts() {
    var m = {};
    state.applications.forEach(function (a) { if (a.groupId) m[a.groupId] = (m[a.groupId] || 0) + 1; });
    return m;
  }
  function membersOf(groupId) {
    return state.applications.filter(function (a) { return a.groupId === groupId; });
  }
  function emptyState(icon, text) {
    return h('div', { class: 'empty' }, h('div', { class: 'empty-ic', text: icon }), h('div', { text: text }));
  }
  function progressBar(count, cap) {
    var pct = cap > 0 ? Math.min(100, Math.round(count / cap * 100)) : 0;
    var cls = 'progress' + (count >= cap && cap > 0 ? ' full' : pct >= 75 ? ' warn' : '');
    return h('div', { class: cls }, h('span', { style: { width: pct + '%' } }));
  }

  // ---------- Toast ----------
  function toast(msg, type) {
    var icons = { success: '✓', error: '⚠', info: 'ℹ' };
    var t = h('div', { class: 'toast ' + (type || 'info'), role: 'status' },
      h('span', { text: icons[type || 'info'] }), h('span', { text: msg }));
    $('toasts').appendChild(t);
    setTimeout(function () {
      t.classList.add('hide');
      setTimeout(function () { t.remove(); }, 300);
    }, type === 'error' ? 4500 : 3000);
  }

  // ---------- API ----------
  function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* ignore */ } }
  function removeToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }

  function api(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).catch(function () {
      throw new Error("Server bilan aloqa yo'q");
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (res.status === 401 && path !== '/api/login') {
          logout(true);
          var err401 = new Error('Sessiya tugadi, qaytadan kiring');
          err401.handled = true;
          throw err401;
        }
        if (!res.ok) throw new Error((data && data.error) || ('Xatolik yuz berdi (' + res.status + ')'));
        return data;
      });
    });
  }

  function handleError(err) {
    if (err && err.handled) return;
    toast((err && err.message) || 'Xatolik yuz berdi', 'error');
  }

  // ---------- Auth ----------
  function showLogin() {
    $('app').hidden = true;
    $('loginScreen').hidden = false;
    $('loginPassword').value = '';
    $('loginError').hidden = true;
    setTimeout(function () { $('loginPassword').focus(); }, 50);
  }
  function showApp() {
    $('loginScreen').hidden = true;
    $('app').hidden = false;
  }
  function logout(expired) {
    var t = getToken();
    if (t && !expired) {
      // Tokenni serverda ham bekor qilamiz (xato bo'lsa ham chiqish davom etadi)
      fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }).catch(function () {});
    }
    removeToken();
    closeModal();
    state.loaded = false;
    showLogin();
    if (expired) toast('Sessiya tugadi, qaytadan kiring', 'error');
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('loginPassword').value;
    var btn = $('loginBtn');
    var errEl = $('loginError');
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Tekshirilmoqda...';
    api('POST', '/api/login', { password: pw }).then(function (data) {
      if (!data || !data.token) throw new Error("Noto'g'ri javob");
      setToken(data.token);
      showApp();
      loadAll();
      toast('Xush kelibsiz!', 'success');
    }).catch(function (err) {
      errEl.textContent = err.message === 'Unauthorized' ? "Parol noto'g'ri" : (err.message || "Parol noto'g'ri");
      errEl.hidden = false;
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Kirish';
    });
  });

  $('logoutBtn').addEventListener('click', function () {
    logout(false);
    toast('Tizimdan chiqdingiz', 'info');
  });

  // ---------- Data ----------
  function loadAll(silent) {
    if (!silent) {
      resetLoading();
      $('globalLoading').hidden = false;
      document.querySelectorAll('.view').forEach(function (v) { v.hidden = true; });
    }
    var btn = $('refreshBtn');
    btn.disabled = true;
    loadTelegramStatus(); // mustaqil: asosiy yuklashni bloklamaydi, xatosi uni yiqitmaydi
    return Promise.all([
      api('GET', '/api/courses'),
      api('GET', '/api/teachers'),
      api('GET', '/api/groups'),
      api('GET', '/api/applications')
    ]).then(function (r) {
      state.courses = Array.isArray(r[0]) ? r[0] : [];
      state.teachers = Array.isArray(r[1]) ? r[1] : [];
      state.groups = Array.isArray(r[2]) ? r[2] : [];
      state.applications = Array.isArray(r[3]) ? r[3] : [];
      state.loaded = true;
      $('globalLoading').hidden = true;
      render();
    }).catch(function (err) {
      handleError(err);
      if (!err.handled && !silent) {
        var lb = clear($('globalLoading'));
        lb.hidden = false;
        append(lb, h('div', { class: 'empty' },
          h('div', { class: 'empty-ic', text: '⚠️' }),
          h('div', { text: "Ma'lumotlarni yuklab bo'lmadi. " + err.message }),
          h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn btn-primary', text: 'Qayta urinish', onclick: function () { resetLoading(); loadAll(); } }))));
      }
    }).then(function () { btn.disabled = false; });
  }
  function resetLoading() {
    var lb = clear($('globalLoading'));
    append(lb, [h('span', { class: 'spinner' }), ' Yuklanmoqda...']);
  }

  // ---------- Navigation ----------
  function setView(view) {
    if (!VIEW_TITLES[view]) view = 'dashboard';
    state.view = view;
    document.querySelectorAll('.nav-item[data-view]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    $('viewTitle').textContent = VIEW_TITLES[view];
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    $('app').classList.remove('sidebar-open');
    render();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('.nav-item[data-view]').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });
  document.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('[data-goto]');
    if (g) setView(g.getAttribute('data-goto'));
  });
  $('menuBtn').addEventListener('click', function () { $('app').classList.toggle('sidebar-open'); });
  $('sidebarBackdrop').addEventListener('click', function () { $('app').classList.remove('sidebar-open'); });
  $('refreshBtn').addEventListener('click', function () {
    loadAll(true).then(function () { if (state.loaded) toast('Yangilandi', 'success'); });
  });

  // ---------- Render ----------
  function render() {
    if (!state.loaded) return;
    document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + state.view; });
    if (state.view === 'applications') markSeen();
    else state.justSeen = {};
    // Sidebar badge: hali ko'rilmagan arizalar soni
    var unseenCount = state.applications.filter(function (a) { return a.seen !== true; }).length;
    var nb = $('navNewCount');
    nb.textContent = unseenCount;
    nb.hidden = unseenCount === 0;
    ({
      dashboard: renderDashboard,
      applications: renderApplications,
      groups: renderGroups,
      courses: renderCourses,
      teachers: renderTeachers
    })[state.view]();
  }

  // Dashboard
  function renderDashboard() {
    var apps = state.applications;
    var newCount = apps.filter(function (a) { return a.status !== 'assigned'; }).length;
    var stats = [
      { ic: '📝', tone: 'tone-indigo', value: apps.length, label: 'Jami arizalar' },
      { ic: '🆕', tone: 'tone-amber', value: newCount, label: 'Yangi arizalar' },
      { ic: '👥', tone: 'tone-green', value: state.groups.length, label: 'Guruhlar' },
      { ic: '📚', tone: 'tone-sky', value: state.courses.length, label: 'Kurslar' }
    ];
    var grid = clear($('statsGrid'));
    stats.forEach(function (s) {
      grid.appendChild(h('div', { class: 'stat' },
        h('div', { class: 'stat-ic ' + s.tone, text: s.ic }),
        h('div', null, h('div', { class: 'stat-value', text: s.value }), h('div', { class: 'stat-label', text: s.label }))));
    });

    var fill = clear($('groupFill'));
    var counts = memberCounts();
    if (!state.groups.length) {
      fill.appendChild(emptyState('👥', "Hali guruhlar yo'q"));
    } else {
      state.groups.forEach(function (g) {
        var c = counts[g.id] || 0;
        var cap = Number(g.capacity) || 0;
        fill.appendChild(h('div', null,
          h('div', { class: 'fill-row-head' },
            h('span', null, h('strong', { text: g.name }), ' · ', h('span', { class: 'muted', text: courseName(g.courseId) })),
            h('span', { text: c + '/' + cap + (c >= cap && cap > 0 ? " · to'lgan" : '') })),
          progressBar(c, cap)));
      });
    }

    renderTelegram();

    var recent = clear($('recentApps'));
    var list = apps.slice(0, 5);
    if (!list.length) {
      recent.appendChild(emptyState('📭', "Hali arizalar yo'q"));
    } else {
      recent.appendChild(h('ul', { class: 'recent-list' }, list.map(function (a) {
        return h('li', null,
          h('div', { class: 'avatar', style: { width: '36px', height: '36px', fontSize: '13px' }, text: initials(a.name) }),
          h('div', { class: 'recent-main' },
            h('div', null, h('strong', { text: a.name })),
            h('div', { text: courseName(a.courseId) + ' · ' + formatDate(a.createdAt) })),
          statusBadge(a.status));
      })));
    }
  }

  // Arizalar bo'limi ochilganda ko'rilmaganlarni "ko'rilgan" deb belgilaydi
  function markSeen() {
    var unseen = state.applications.filter(function (a) { return a.seen !== true; });
    if (!unseen.length) return;
    unseen.forEach(function (a) { a.seen = true; state.justSeen[a.id] = true; });
    api('POST', '/api/applications/seen').catch(handleError);
  }

  function statusSelect(a) {
    var sel = h('select', { class: 'input status-select status-' + (a.status === 'assigned' ? 'assigned' : 'new'), 'aria-label': 'Holatni o\'zgartirish' },
      h('option', { value: 'new', text: 'Yangi' }),
      h('option', { value: 'assigned', text: 'Biriktirildi' }));
    sel.value = a.status === 'assigned' ? 'assigned' : 'new';
    sel.addEventListener('change', function () {
      var val = sel.value;
      if (val === 'new' && a.groupId) {
        confirmDialog('Holatni o\'zgartirish', '"' + a.name + '" arizasi "Yangi" qilinsa, u guruhdan chiqariladi. Davom etasizmi?').then(function (ok) {
          if (ok) setStatus(a, val, sel); else render();
        });
        return;
      }
      setStatus(a, val, sel);
    });
    return sel;
  }

  function setStatus(a, status, ctrl) {
    if (ctrl) ctrl.disabled = true;
    api('PATCH', '/api/applications/' + encodeURIComponent(a.id), { status: status }).then(function (updated) {
      replaceApp(updated);
      toast('Holat yangilandi: ' + (status === 'assigned' ? 'Biriktirildi' : 'Yangi'), 'success');
      render();
    }).catch(function (err) {
      handleError(err);
      render();
    });
  }

  function statusBadge(status) {
    return status === 'assigned'
      ? h('span', { class: 'badge badge-assigned', text: 'Biriktirilgan' })
      : h('span', { class: 'badge badge-new', text: 'Yangi' });
  }

  // Applications
  function fillCourseFilter() {
    var sel = $('appCourse');
    var current = state.filters.course;
    clear(sel);
    sel.appendChild(h('option', { value: 'all', text: 'Barcha kurslar' }));
    state.courses.forEach(function (c) { sel.appendChild(h('option', { value: c.id, text: c.title })); });
    if (current !== 'all' && !byId(state.courses, current)) current = state.filters.course = 'all';
    sel.value = current;
  }

  // Joriy filtr + qidiruvdan o'tgan arizalar (ekrandagi tartibda)
  function filteredApplications() {
    var f = state.filters;
    var q = f.search.trim().toLowerCase();
    var qDigits = q.replace(/\D/g, '');
    return state.applications.filter(function (a) {
      if (f.status !== 'all' && (a.status === 'assigned' ? 'assigned' : 'new') !== f.status) return false;
      if (f.course !== 'all' && a.courseId !== f.course) return false;
      if (q) {
        var inName = String(a.name || '').toLowerCase().indexOf(q) !== -1;
        var inPhone = qDigits && String(a.phone || '').replace(/\D/g, '').indexOf(qDigits) !== -1;
        var inMsg = String(a.message || '').toLowerCase().indexOf(q) !== -1;
        var inNote = String(a.adminNote || '').toLowerCase().indexOf(q) !== -1;
        var inId = qDigits && String(a.id).indexOf(qDigits) !== -1;
        if (!inName && !inPhone && !inMsg && !inNote && !inId) return false;
      }
      return true;
    });
  }

  function renderApplications() {
    fillCourseFilter();
    var list = filteredApplications();
    var tbody = clear($('appTbody'));
    var empty = $('appEmpty');
    var table = tbody.closest('.table-wrap');
    if (!list.length) {
      table.hidden = true;
      clear(empty).hidden = false;
      append(empty, state.applications.length
        ? [h('div', { class: 'empty-ic', text: '🔍' }), h('div', { text: "Filtrga mos ariza topilmadi" })]
        : [h('div', { class: 'empty-ic', text: '📭' }), h('div', { text: "Hali arizalar yo'q" })]);
      return;
    }
    table.hidden = false;
    empty.hidden = true;
    var counts = memberCounts();
    list.forEach(function (a) { tbody.appendChild(appRow(a, counts)); });
  }

  function appRow(a, counts) {
    var groups = state.groups.filter(function (g) { return g.courseId === a.courseId; });
    var sel = h('select', { class: 'input group-select', 'aria-label': 'Guruh tanlash' });
    sel.appendChild(h('option', { value: '', text: groups.length ? '— Guruhga biriktirish —' : "Guruh yo'q — avval guruh oching" }));
    groups.forEach(function (g) {
      var c = counts[g.id] || 0;
      var cap = Number(g.capacity) || 0;
      var full = cap > 0 && c >= cap && a.groupId !== g.id;
      sel.appendChild(h('option', { value: g.id, disabled: full, text: g.name + ' (' + c + '/' + cap + ')' + (full ? " — to'lgan" : '') }));
    });
    // Current group may belong to another course (edge case) — keep it visible
    if (a.groupId && !groups.some(function (g) { return g.id === a.groupId; })) {
      var og = byId(state.groups, a.groupId);
      sel.appendChild(h('option', { value: a.groupId, text: og ? og.name : "O'chirilgan guruh" }));
    }
    sel.value = a.groupId || '';
    sel.disabled = !groups.length && !a.groupId;
    if (!groups.length) sel.title = "Bu kurs uchun hali guruh ochilmagan. Guruhlar bo'limida yangi guruh oching.";
    sel.addEventListener('change', function () {
      var val = sel.value || null;
      if (val === (a.groupId || null)) return;
      assign(a, val, sel);
    });

    var unassignBtn = a.groupId
      ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Biriktirishni bekor qilish', 'aria-label': 'Biriktirishni bekor qilish', text: '✕', onclick: function (e) { assign(a, null, e.currentTarget); } })
      : null;
    // Kurs uchun hali guruh bo'lmasa — shu yerning o'zidan guruh ochish
    var newGroupBtn = !groups.length && byId(state.courses, a.courseId)
      ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-new-group', title: courseName(a.courseId) + ' kursi uchun yangi guruh ochish', text: '+ Guruh ochish', onclick: function () { openGroupForm({ courseId: a.courseId }); } })
      : null;

    return h('tr', { class: state.justSeen[a.id] ? 'row-fresh' : null },
      h('td', { 'data-label': 'ID' }, h('button', { type: 'button', class: 'app-id', title: 'Arizani ochish', text: '#' + a.id, onclick: function () { openApplication(a.id); } })),
      h('td', { 'data-label': 'Ism' },
        h('button', { type: 'button', class: 'app-name', title: 'Arizani ochish', text: a.name, onclick: function () { openApplication(a.id); } }),
        a.adminNote ? h('span', { class: 'note-flag', title: 'Admin izohi: ' + a.adminNote, text: '📝' }) : null,
        state.justSeen[a.id] ? h('span', { class: 'fresh-dot', title: 'Yangi kelgan' }) : null),
      h('td', { class: 'cell-nowrap', 'data-label': 'Telefon' }, h('a', { href: 'tel:' + String(a.phone || '').replace(/[^\d+]/g, ''), text: a.phone })),
      h('td', { class: 'cell-nowrap', 'data-label': 'Kurs', text: courseName(a.courseId) }),
      h('td', { class: 'cell-msg', 'data-label': 'Izoh', title: a.message || '', text: a.message || '—' }),
      h('td', { class: 'cell-nowrap muted', 'data-label': 'Sana', text: formatDate(a.createdAt) }),
      h('td', { 'data-label': 'Status' }, statusSelect(a)),
      h('td', { 'data-label': 'Guruh' }, h('div', { class: 'assign-cell' }, sel, newGroupBtn, unassignBtn)),
      h('td', { class: 'cell-actions-td' }, h('div', { class: 'cell-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', text: "Ko'rish", onclick: function () { openApplication(a.id); } }),
        h('button', { class: 'btn btn-danger-ghost btn-sm', text: "O'chirish", onclick: function () { deleteApplication(a); } }))));
  }

  // Ariza tafsilotlari + admin izohi
  function openApplication(id) {
    var a = byId(state.applications, id);
    if (!a) return;
    var g = a.groupId ? byId(state.groups, a.groupId) : null;
    function row(label, value) {
      return [h('dt', { text: label }), h('dd', null, value)];
    }
    var info = h('dl', { class: 'app-details' },
      row('ID', h('span', { class: 'mono', text: '#' + a.id })),
      row('Ism', a.name),
      row('Telefon', h('a', { href: 'tel:' + String(a.phone || '').replace(/[^\d+]/g, ''), text: a.phone })),
      row('Kurs', courseName(a.courseId)),
      row('Holat', statusBadge(a.status)),
      row('Guruh', g ? g.name + ' · ' + (g.schedule || '') : '—'),
      row('Yuborilgan', formatDate(a.createdAt)),
      row('Mijoz izohi', a.message || '—'));

    var ta = h('textarea', { name: 'adminNote', rows: 4, maxlength: 2000, placeholder: "Masalan: qo'ng'iroq qilindi, kechki guruhni xohlaydi..." });
    ta.value = a.adminNote || '';
    var meta = h('small', { class: 'muted', text: a.adminNote && a.noteUpdatedAt ? 'Oxirgi tahrir: ' + formatDate(a.noteUpdatedAt) : '' });

    var form = h('form', { class: 'form' },
      info,
      field('Admin izohi', ta),
      meta,
      formError(),
      formActions('Izohni saqlash'));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitForm(form, api('PATCH', '/api/applications/' + encodeURIComponent(a.id), { adminNote: ta.value }).then(function (updated) {
        replaceApp(updated);
        toast('Izoh saqlandi', 'success');
      }));
    });
    openModal('Ariza #' + a.id, form);
  }

  function assign(a, groupId, ctrl) {
    if (ctrl) ctrl.disabled = true;
    api('PATCH', '/api/applications/' + encodeURIComponent(a.id), { groupId: groupId }).then(function (updated) {
      replaceApp(updated || Object.assign({}, a, { groupId: groupId, status: groupId ? 'assigned' : 'new', seen: a.seen }));
      toast(groupId ? 'Ariza guruhga biriktirildi' : 'Biriktirish bekor qilindi', 'success');
      render();
    }).catch(function (err) {
      handleError(err);
      render(); // reset select to actual value
    });
  }
  function replaceApp(updated) {
    state.applications = state.applications.map(function (x) { return x.id === updated.id ? updated : x; });
  }

  function deleteApplication(a) {
    confirmDialog("Arizani o'chirish", '"' + a.name + '" arizasini o\'chirmoqchimisiz? Bu amalni qaytarib bo\'lmaydi.').then(function (ok) {
      if (!ok) return;
      api('DELETE', '/api/applications/' + encodeURIComponent(a.id)).then(function () {
        state.applications = state.applications.filter(function (x) { return x.id !== a.id; });
        toast("Ariza o'chirildi", 'success');
        render();
      }).catch(handleError);
    });
  }

  $('appSearch').addEventListener('input', function (e) { state.filters.search = e.target.value; renderApplications(); });
  $('appStatus').addEventListener('change', function (e) { state.filters.status = e.target.value; renderApplications(); });
  $('appCourse').addEventListener('change', function (e) { state.filters.course = e.target.value; renderApplications(); });

  // ---------- Excel eksport ----------
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var xlsxPromise = null;
  // SheetJS faqat birinchi eksportda dinamik yuklanadi
  function loadXlsx() {
    if (window.XLSX && window.XLSX.utils) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var timer = setTimeout(fail, 15000);
      function fail() {
        clearTimeout(timer);
        s.onload = s.onerror = null;
        if (s.parentNode) s.parentNode.removeChild(s);
        xlsxPromise = null; // keyingi bosishda qayta urinish mumkin
        reject(new Error('SheetJS yuklanmadi'));
      }
      s.src = XLSX_URL;
      s.async = true;
      s.onload = function () {
        clearTimeout(timer);
        if (window.XLSX && window.XLSX.utils) resolve(window.XLSX); else fail();
      };
      s.onerror = fail;
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  // Formula injection himoyasi: = + - @ (tab/CR) bilan boshlansa — oldiga '
  function safeCell(v) {
    var str = v === null || v === undefined ? '' : String(v);
    return /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
  }

  var EXPORT_HEAD = ['ID', 'Ism', 'Telefon', 'Kurs', 'Guruh', 'Holat', 'Yuborilgan sana', 'Mijoz izohi', 'Admin izohi'];
  var EXPORT_WIDTHS = [10, 26, 18, 26, 22, 14, 18, 44, 44];

  // phoneAsText: xlsx da telefon matn turidagi katak (formula sifatida talqin qilinmaydi),
  // shuning uchun "+998..." ko'rinishi buzilmasligi uchun ' qo'shilmaydi
  function exportRows(list, phoneAsText) {
    return list.map(function (a) {
      var g = a.groupId ? byId(state.groups, a.groupId) : null;
      var date = formatDate(a.createdAt);
      return [
        String(a.id),
        safeCell(a.name),
        phoneAsText ? String(a.phone || '') : safeCell(a.phone),
        safeCell(courseName(a.courseId)),
        g ? safeCell(g.name) : (a.groupId ? "O'chirilgan guruh" : ''),
        a.status === 'assigned' ? 'Biriktirildi' : 'Yangi',
        date === '—' ? '' : date,
        safeCell(a.message || ''),
        safeCell(a.adminNote || '')
      ];
    });
  }

  function exportFileBase() {
    return 'arizalar-' + ymd(new Date());
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = h('a', { href: url, download: name, style: { display: 'none' } });
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); link.remove(); }, 1500);
  }

  // Zaxira: UTF-8 BOM bilan CSV (Excel to'g'ri kodlashda ochadi)
  function exportCsv(list) {
    var rows = [EXPORT_HEAD].concat(exportRows(list, false));
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), exportFileBase() + '.csv');
  }

  function exportXlsx(XLSX, list) {
    var rows = [EXPORT_HEAD].concat(exportRows(list, true));
    var ws = XLSX.utils.aoa_to_sheet(rows);
    // Barcha kataklar matn turida (son/formula sifatida talqin qilinmaydi)
    Object.keys(ws).forEach(function (k) {
      if (k.charAt(0) !== '!' && ws[k]) { ws[k].t = 's'; ws[k].v = String(ws[k].v); }
    });
    ws['!cols'] = EXPORT_WIDTHS.map(function (w) { return { wch: w }; });
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: EXPORT_HEAD.length - 1 } }) };
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Arizalar');
    XLSX.writeFile(wb, exportFileBase() + '.xlsx', { compression: true });
  }

  $('exportBtn').addEventListener('click', function () {
    var btn = $('exportBtn');
    var list = filteredApplications();
    if (!list.length) { toast("Eksport uchun ariza yo'q", 'info'); return; }
    btn.disabled = true;
    loadXlsx().then(function (XLSX) {
      exportXlsx(XLSX, list);
      toast(list.length + ' ta ariza Excel faylga yuklandi', 'success');
    }, function () {
      exportCsv(list);
      toast("Excel kutubxonasi yuklanmadi (internet yo'qmi?). CSV fayl yuklandi — Excel'da ochiladi", 'info');
    }).catch(function (err) {
      toast('Eksportda xatolik: ' + ((err && err.message) || "noma'lum"), 'error');
    }).then(function () { btn.disabled = false; });
  });

  // ---------- Telegram ----------
  function loadTelegramStatus() {
    state.telegram.status = 'loading';
    renderTelegram();
    return api('GET', '/api/telegram/status').then(function (d) {
      if (!d || typeof d.configured !== 'boolean') throw new Error("Noto'g'ri javob");
      state.telegram.status = 'ok';
      state.telegram.configured = d.configured;
    }).catch(function () {
      state.telegram.status = 'error';
    }).then(renderTelegram);
  }

  function renderTelegram() {
    var box = $('tgStatus');
    var btn = $('tgTestBtn');
    if (!box || !btn) return;
    var t = state.telegram;
    clear(box);
    if (t.status === 'loading') {
      append(box, [h('span', { class: 'spinner' }), ' Tekshirilmoqda...']);
    } else if (t.status === 'error') {
      append(box, [
        h('span', { class: 'badge badge-gray', text: "❔ Noma'lum" }),
        h('span', { class: 'muted', text: "Holatni aniqlab bo'lmadi" })]);
    } else if (t.configured) {
      append(box, [
        h('span', { class: 'badge badge-assigned', text: '✅ Ulangan' }),
        h('span', { class: 'muted', text: 'Yangi arizalar Telegramga yuboriladi' })]);
    } else {
      append(box, [
        h('span', { class: 'badge badge-gray', text: '⚪ Ulanmagan' }),
        h('span', { class: 'muted', text: "Sozlash yo'riqnomasi README.md da" })]);
    }
    btn.disabled = t.sending || t.status === 'loading';
    btn.textContent = t.sending ? 'Yuborilmoqda...' : 'Sinov xabarini yuborish';
  }

  $('tgTestBtn').addEventListener('click', function () {
    if (state.telegram.sending) return;
    state.telegram.sending = true;
    renderTelegram();
    api('POST', '/api/telegram/test').then(function () {
      toast('Sinov xabari Telegramga yuborildi', 'success');
    }).catch(function (err) {
      if (err && err.handled) return;
      toast('Telegram: ' + ((err && err.message) || 'Xatolik yuz berdi'), 'error');
    }).then(function () {
      state.telegram.sending = false;
      renderTelegram();
    });
  });

  // Zaxira nusxa: barcha ma'lumotlarni JSON fayl qilib yuklab olish
  $('backupBtn').addEventListener('click', function () {
    var btn = $('backupBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = 'Tayyorlanmoqda...';
    api('GET', '/api/backup').then(function (data) {
      var name = 'zaxira-' + ymd(new Date()) + '.json';
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
      toast('Zaxira nusxa yuklandi: ' + (data.applications || []).length + ' ta ariza', 'success');
    }).catch(function (err) {
      if (err && err.handled) return;
      toast('Zaxira nusxa: ' + ((err && err.message) || 'Xatolik yuz berdi'), 'error');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = label;
    });
  });

  // Groups
  function renderGroups() {
    var grid = clear($('groupsGrid'));
    $('groupsCount').textContent = 'Jami: ' + state.groups.length + ' ta guruh';
    if (!state.groups.length) {
      grid.appendChild(emptyState('👥', "Hali guruhlar yo'q. \"Yangi guruh\" tugmasi orqali qo'shing."));
      return;
    }
    var counts = memberCounts();
    state.groups.forEach(function (g) {
      var c = counts[g.id] || 0;
      var cap = Number(g.capacity) || 0;
      var members = membersOf(g.id);
      grid.appendChild(h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', { class: 'card-icon', text: (byId(state.courses, g.courseId) || {}).icon || '👥' }),
          h('div', { class: 'card-title' },
            h('h4', { text: g.name }),
            h('div', { class: 'card-sub', text: courseName(g.courseId) })),
          h('span', { class: 'badge ' + (c >= cap && cap > 0 ? 'badge-new' : 'badge-soft'), text: c + '/' + cap })),
        h('div', { class: 'meta' },
          h('span', null, '👨‍🏫 ', h('b', { text: teacherName(g.teacherId) })),
          h('span', null, '🕒 ', h('b', { text: g.schedule || '—' }))),
        progressBar(c, cap),
        h('div', { class: 'members' },
          h('div', { class: 'members-title', text: "A'zolar (" + members.length + ')' }),
          members.length
            ? h('ul', null, members.map(function (m) { return h('li', null, h('span', { text: m.name }), h('span', { text: m.phone })); }))
            : h('div', { class: 'muted', style: { fontSize: '13px' }, text: "Hali a'zolar yo'q" })),
        h('div', { class: 'card-foot' },
          h('button', { class: 'btn btn-danger-ghost btn-sm', text: "O'chirish", onclick: function () { deleteGroup(g, members.length); } }))));
    });
  }

  function deleteGroup(g, n) {
    var msg = '"' + g.name + '" guruhini o\'chirmoqchimisiz?' + (n ? ' Guruhdagi ' + n + " ta ariza \"Yangi\" holatiga qaytadi." : '');
    confirmDialog("Guruhni o'chirish", msg).then(function (ok) {
      if (!ok) return;
      api('DELETE', '/api/groups/' + encodeURIComponent(g.id)).then(function () {
        state.groups = state.groups.filter(function (x) { return x.id !== g.id; });
        state.applications = state.applications.map(function (a) {
          return a.groupId === g.id ? Object.assign({}, a, { groupId: null, status: 'new' }) : a;
        });
        toast("Guruh o'chirildi", 'success');
        render();
      }).catch(handleError);
    });
  }

  // prefill (ixtiyoriy): { courseId } — masalan, arizalar jadvalidan ochilganda
  function openGroupForm(prefill) {
    if (!state.courses.length) { toast("Avval kurs qo'shing", 'error'); return; }
    var preCourse = prefill && typeof prefill.courseId === 'string' ? prefill.courseId : null;
    var form = h('form', { novalidate: true },
      field('Guruh nomi', h('input', { name: 'name', required: true, placeholder: 'Masalan: Frontend-1' })),
      field('Kurs', selectOf('courseId', state.courses.map(function (c) { return [c.id, c.title]; }), preCourse, true)),
      field('Ustoz', selectOf('teacherId', state.teachers.map(function (t) { return [t.id, t.name + (t.subject ? ' — ' + t.subject : '')]; }), null, true)),
      h('div', { class: 'form-row' },
        field('Jadval', h('input', { name: 'schedule', required: true, placeholder: 'Du-Chor-Ju 14:00' })),
        field("Sig'im (o'rinlar)", h('input', { name: 'capacity', type: 'number', min: '1', required: true, value: '12' }))),
      formError(),
      formActions('Saqlash'));
    // Auto-pick the course's teacher
    var courseSel = form.elements.courseId, teacherSel = form.elements.teacherId;
    function syncTeacher() {
      var c = byId(state.courses, courseSel.value);
      if (c && c.teacherId && byId(state.teachers, c.teacherId)) teacherSel.value = c.teacherId;
    }
    courseSel.addEventListener('change', syncTeacher);
    syncTeacher();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = {
        name: form.elements.name.value.trim(),
        courseId: courseSel.value,
        teacherId: teacherSel.value,
        schedule: form.elements.schedule.value.trim(),
        capacity: Number(form.elements.capacity.value)
      };
      if (!d.name || !d.courseId || !d.teacherId || !d.schedule) return showFormError(form, "Barcha maydonlarni to'ldiring");
      if (!(d.capacity >= 1)) return showFormError(form, "Sig'im kamida 1 bo'lishi kerak");
      submitForm(form, api('POST', '/api/groups', d).then(function (g) {
        state.groups.push(g);
        toast("Guruh qo'shildi", 'success');
      }));
    });
    openModal('Yangi guruh', form);
  }
  $('addGroupBtn').addEventListener('click', function () { openGroupForm(); });

  // Courses
  function renderCourses() {
    var grid = clear($('coursesGrid'));
    $('coursesCount').textContent = 'Jami: ' + state.courses.length + ' ta kurs';
    if (!state.courses.length) {
      grid.appendChild(emptyState('📚', "Hali kurslar yo'q. \"Yangi kurs qo'shish\" tugmasini bosing."));
      return;
    }
    state.courses.forEach(function (c) {
      var appCount = state.applications.filter(function (a) { return a.courseId === c.id; }).length;
      var groupCount = state.groups.filter(function (g) { return g.courseId === c.id; }).length;
      grid.appendChild(h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', { class: 'card-icon', text: c.icon || '📘' }),
          h('div', { class: 'card-title' },
            h('h4', { text: c.title }),
            h('div', { class: 'card-sub', text: teacherName(c.teacherId) })),
          h('span', { class: 'badge badge-soft', text: c.level || '—' })),
        c.description ? h('p', { class: 'card-desc', text: c.description }) : null,
        h('div', { class: 'meta' },
          h('span', null, '⏱ ', h('b', { text: c.duration || '—' })),
          h('span', null, '👥 ', h('b', { text: groupCount }), ' guruh'),
          h('span', null, '📝 ', h('b', { text: appCount }), ' ariza')),
        h('div', { class: 'price', text: formatPrice(c.price) + ' / oy' }),
        h('div', { class: 'card-foot' },
          h('button', { class: 'btn btn-ghost btn-sm', text: '✎ Tahrirlash', onclick: function () { openCourseForm(c); } }),
          h('button', { class: 'btn btn-danger-ghost btn-sm', text: "O'chirish", onclick: function () { deleteCourse(c); } }))));
    });
  }

  function openCourseForm(course) {
    var c = course || {};
    var form = h('form', { novalidate: true },
      h('div', { class: 'form-row', style: { gridTemplateColumns: '1fr 110px' } },
        field('Kurs nomi', h('input', { name: 'title', required: true, value: c.title || '', placeholder: 'Masalan: Frontend dasturlash' })),
        field('Ikonka', h('input', { name: 'icon', value: c.icon || '', placeholder: '💻', maxlength: '8' }))),
      field('Tavsif', h('textarea', { name: 'description', rows: '3', placeholder: 'Kurs haqida qisqacha' }, c.description || '')),
      h('div', { class: 'form-row' },
        field('Daraja', selectOf('level', LEVELS.map(function (l) { return [l, l]; }), c.level || LEVELS[0], false)),
        field('Davomiyligi', h('input', { name: 'duration', required: true, value: c.duration || '', placeholder: '3 oy' }))),
      h('div', { class: 'form-row' },
        field("Narx (so'm/oy)", h('input', { name: 'price', type: 'number', min: '0', step: '1000', required: true, value: c.price !== undefined ? String(c.price) : '', placeholder: '450000' })),
        field('Ustoz', selectOf('teacherId', state.teachers.map(function (t) { return [t.id, t.name]; }), c.teacherId, true))),
      formError(),
      formActions(course ? 'Saqlash' : "Qo'shish"));

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var els = form.elements;
      var d = {
        title: els.title.value.trim(),
        description: els.description.value.trim(),
        level: els.level.value,
        duration: els.duration.value.trim(),
        price: Number(els.price.value),
        teacherId: els.teacherId.value,
        icon: els.icon.value.trim() || '📘'
      };
      if (!d.title || !d.duration || !d.teacherId || els.price.value === '') return showFormError(form, "Majburiy maydonlarni to'ldiring");
      if (!(d.price >= 0)) return showFormError(form, "Narx noto'g'ri");
      var req = course
        ? api('PUT', '/api/courses/' + encodeURIComponent(course.id), Object.assign({ id: course.id }, d)).then(function (upd) {
          var u = upd || Object.assign({}, course, d);
          state.courses = state.courses.map(function (x) { return x.id === course.id ? u : x; });
          toast('Kurs yangilandi', 'success');
        })
        : api('POST', '/api/courses', d).then(function (nc) {
          state.courses.push(nc);
          toast("Kurs qo'shildi", 'success');
        });
      submitForm(form, req);
    });
    openModal(course ? 'Kursni tahrirlash' : "Yangi kurs qo'shish", form);
  }
  $('addCourseBtn').addEventListener('click', function () {
    if (!state.teachers.length) { toast("Avval ustoz qo'shing", 'error'); return; }
    openCourseForm(null);
  });

  function deleteCourse(c) {
    confirmDialog("Kursni o'chirish", '"' + c.title + '" kursini o\'chirmoqchimisiz?').then(function (ok) {
      if (!ok) return;
      api('DELETE', '/api/courses/' + encodeURIComponent(c.id)).then(function () {
        toast("Kurs o'chirildi", 'success');
        return loadAll(true);
      }).catch(handleError);
    });
  }

  // Teachers
  function renderTeachers() {
    var grid = clear($('teachersGrid'));
    $('teachersCount').textContent = 'Jami: ' + state.teachers.length + ' ta ustoz';
    if (!state.teachers.length) {
      grid.appendChild(emptyState('👨‍🏫', "Hali ustozlar yo'q"));
      return;
    }
    state.teachers.forEach(function (t) {
      var avatar = h('div', { class: 'avatar avatar-teacher' });
      if (t.photo && /^(https?:\/\/|\/)/i.test(t.photo)) {
        var img = h('img', { src: t.photo, alt: t.name });
        img.addEventListener('error', function () { clear(avatar).textContent = initials(t.name); });
        avatar.appendChild(img);
      } else {
        avatar.textContent = initials(t.name);
      }
      var courses = state.courses.filter(function (c) { return c.teacherId === t.id; });
      grid.appendChild(h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          avatar,
          h('div', { class: 'card-title' },
            h('h4', { text: t.name }),
            h('div', { class: 'card-sub', text: t.subject || '—' })),
          h('span', { class: 'badge badge-gray', text: (Number(t.experience) || 0) + ' yil' })),
        t.bio ? h('p', { class: 'card-desc', text: t.bio }) : null,
        courses.length ? h('div', { class: 'meta' }, '📚 ', h('b', { text: courses.map(function (c) { return c.title; }).join(', ') })) : null,
        h('div', { class: 'card-foot' },
          h('button', { class: 'btn btn-danger-ghost btn-sm', text: "O'chirish", onclick: function () { deleteTeacher(t, courses.length); } }))));
    });
  }

  function openTeacherForm() {
    var form = h('form', { novalidate: true },
      field("Ism-familiya", h('input', { name: 'name', required: true, placeholder: 'Masalan: Aziz Karimov' })),
      h('div', { class: 'form-row' },
        field('Fan / yo\'nalish', h('input', { name: 'subject', required: true, placeholder: 'Frontend' })),
        field('Tajriba (yil)', h('input', { name: 'experience', type: 'number', min: '0', required: true, value: '1' }))),
      field('Bio', h('textarea', { name: 'bio', rows: '3', placeholder: "Ustoz haqida qisqacha" })),
      field('Rasm URL (ixtiyoriy)', h('input', { name: 'photo', type: 'text', placeholder: 'https://... yoki /img/teachers/...' })),
      formError(),
      formActions("Qo'shish"));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var els = form.elements;
      var d = {
        name: els.name.value.trim(),
        subject: els.subject.value.trim(),
        experience: Number(els.experience.value) || 0,
        bio: els.bio.value.trim(),
        photo: els.photo.value.trim()
      };
      if (!d.name || !d.subject) return showFormError(form, "Ism va fanni kiriting");
      if (d.photo && !/^(https?:\/\/|\/)/i.test(d.photo)) return showFormError(form, "Rasm URL http(s):// yoki / bilan boshlanishi kerak");
      submitForm(form, api('POST', '/api/teachers', d).then(function (t) {
        state.teachers.push(t);
        toast("Ustoz qo'shildi", 'success');
      }));
    });
    openModal("Ustoz qo'shish", form);
  }
  $('addTeacherBtn').addEventListener('click', openTeacherForm);

  function deleteTeacher(t, nCourses) {
    var msg = '"' + t.name + '" ni o\'chirmoqchimisiz?' + (nCourses ? ' U ' + nCourses + ' ta kursga biriktirilgan.' : '');
    confirmDialog("Ustozni o'chirish", msg).then(function (ok) {
      if (!ok) return;
      api('DELETE', '/api/teachers/' + encodeURIComponent(t.id)).then(function () {
        toast("Ustoz o'chirildi", 'success');
        return loadAll(true);
      }).catch(handleError);
    });
  }

  // ---------- Form helpers ----------
  function field(label, control) {
    return h('label', { class: 'field' }, h('span', { text: label }), control);
  }
  function selectOf(name, pairs, value, withPlaceholder) {
    var s = h('select', { name: name, required: true });
    if (withPlaceholder) s.appendChild(h('option', { value: '', text: pairs.length ? '— Tanlang —' : "Ro'yxat bo'sh" }));
    pairs.forEach(function (p) { s.appendChild(h('option', { value: p[0], text: p[1] })); });
    if (value && pairs.some(function (p) { return p[0] === value; })) s.value = value;
    else if (!withPlaceholder && pairs.length) s.value = pairs[0][0];
    return s;
  }
  function formError() { return h('p', { class: 'form-error', 'data-form-error': true, hidden: true }); }
  function formActions(label) {
    return h('div', { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': true, text: 'Bekor qilish' }),
      h('button', { type: 'submit', class: 'btn btn-primary', text: label }));
  }
  function showFormError(form, msg) {
    var el = form.querySelector('[data-form-error]');
    el.textContent = msg;
    el.hidden = false;
  }
  function submitForm(form, promise) {
    var btn = form.querySelector('button[type=submit]');
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saqlanmoqda...';
    form.querySelector('[data-form-error]').hidden = true;
    promise.then(function () {
      closeModal();
      render();
    }).catch(function (err) {
      if (err.handled) return;
      showFormError(form, err.message);
      toast(err.message, 'error');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = label;
    });
  }

  // ---------- Modal ----------
  var modalResolve = null;
  function openModal(title, content, small) {
    $('modalTitle').textContent = title;
    append(clear($('modalBody')), content);
    $('modal').querySelector('.modal-dialog').classList.toggle('sm', !!small);
    $('modal').hidden = false;
    document.body.style.overflow = 'hidden';
    var first = $('modalBody').querySelector('input, select, textarea, button.btn-danger');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function closeModal() {
    $('modal').hidden = true;
    clear($('modalBody'));
    document.body.style.overflow = '';
    if (modalResolve) { var r = modalResolve; modalResolve = null; r(false); }
  }
  $('modal').addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('modal').hidden) closeModal();
  });

  function confirmDialog(title, message) {
    return new Promise(function (resolve) {
      var body = h('div', null,
        h('p', { class: 'confirm-text', text: message }),
        h('div', { class: 'form-actions' },
          h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': true, text: 'Bekor qilish' }),
          h('button', {
            type: 'button', class: 'btn btn-danger', text: "Ha, o'chirish", onclick: function () {
              modalResolve = null;
              closeModal();
              resolve(true);
            }
          })));
      if (modalResolve) closeModal();
      openModal(title, body, true);
      modalResolve = resolve;
    });
  }

  // ---------- Init ----------
  window.addEventListener('hashchange', function () {
    var v = location.hash.slice(1);
    if (v && v !== state.view && VIEW_TITLES[v]) setView(v);
  });

  var initial = location.hash.slice(1);
  state.view = VIEW_TITLES[initial] ? initial : 'dashboard';
  document.querySelectorAll('.nav-item[data-view]').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-view') === state.view);
  });
  $('viewTitle').textContent = VIEW_TITLES[state.view];

  if (getToken()) {
    showApp();
    loadAll();
  } else {
    showLogin();
  }
})();
