/* =========================================================
   ПОСТЕР · система заказов — клиентская часть
   Ванильный JS, без сборки. Данные берутся из /api.
   ========================================================= */

const API = '/api';

/* Ключ этого компьютера. Генерируется один раз и живёт в хранилище браузера —
 * по нему администратор привязывает профили к рабочим местам.
 * Прочитать настоящее «железо» (MAC, серийник диска) из браузера нельзя:
 * таких API не существует. Ключ отсекает чужие компьютеры, но человек с
 * доступом к консоли браузера может его скопировать — это защита от
 * «зашёл из дома», а не от намеренного обхода. */
function deviceKey() {
  let key = localStorage.getItem('poster.device');
  if (!key) {
    key = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem('poster.device', key);
  }
  return key;
}
const DEVICE_KEY = deviceKey();

const state = {
  templates: [],
  templatesByKey: {},
  statuses: [],
  transitions: {},
  forward: {},
  orders: [],
  filterTemplate: 'all',
  query: '',
  sort: localStorage.getItem('poster.sort') || 'due',
  view: 'board',            // какой раздел открыт
  prices: null,             // кэш прайса
  priceGroup: null,         // открытый раздел прайса (null = плитки)
  metricsDays: 30,
  metricsDetail: null,      // 'templates' | 'clients' | null
  formTemplateKey: null,
  formOrder: null,
  testQty: 1,
  role: null,                 // 'admin' | 'employee' | null (профиль не выбран)
  userName: '',
  permissions: [],
  loginTarget: null,
  staff: null,                // кэш списка сотрудников
  devices: null,
  staffTab: 'people',         // 'people' | 'devices'
  works: null,
  worksMeta: null,
  clientsQuery: '',
  clientsSort: 'recent',
  clientsOffset: 0,
  clientOrdersOffset: 0,
  permCatalog: null,
  token: localStorage.getItem('poster.token') || '',
};

const isAdmin = () => state.role === 'admin';


/* ---------------------------------------------------- утилиты */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const money = (v) => (v ? new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽' : '');
const dateRu = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '');
const dtRu = (iso) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const todayISO = () => new Date().toISOString().slice(0, 10);

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Device-Key': DEVICE_KEY,
    ...(options.headers || {}),
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(API + path, { ...options, headers });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && isAdmin()) {
      // токен протух или сервер перезапущен с другим ключом
      logout('Сессия администратора истекла — войдите заново');
      throw new Error('Нужен повторный вход');
    }
    const detail = data && data.detail;
    throw new Error(typeof detail === 'string' ? detail : 'Сервер не принял запрос');
  }
  return data;
}

function toast(text, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}

/* ---------------------------------------------------- иконки */
const ICONS = {
  printer: '<svg viewBox="0 0 24 24"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 15h12v6H6z"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5M9 13h6M9 17h4"/></svg>',
  blade: '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.5 16 18 4M15.5 16 6 4"/></svg>',
  roll: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M3 16c3 2 6 2 9 0s6-2 9 0"/><path d="M7 8h6"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 15h5M6 11h9"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c.7-3.5 3.5-5.2 7-5.2s6.3 1.7 7 5.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  arrowLeft: '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  arrowUp: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  arrowDown: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  device: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8 20.5h8M12 16.5v4"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.7"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M10.6 6.2A9.6 9.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3 3.8M6.3 7.9A16.7 16.7 0 0 0 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.2-1M3 3l18 18"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
};

/* ---------------------------------------------------- профили и вход */
/* Права приходят с сервера при входе и лежат в state.permissions.
 * can('ключ') прячет элементы интерфейса. Это удобство, а не защита:
 * настоящая проверка — на сервере, здесь мы просто не показываем то,
 * что человеку всё равно не отдадут. */
const can = (permission) => state.permissions.includes(permission);

function saveProfile(data) {
  state.role = data.kind;                 // 'admin' | 'employee'
  state.userName = data.name;
  state.permissions = data.permissions || [];
  state.token = data.token || state.token;
  localStorage.setItem('poster.role', data.kind);
  if (data.token) localStorage.setItem('poster.token', data.token);
}

function logout(message = '') {
  state.role = null;
  state.token = '';
  state.permissions = [];
  state.userName = '';
  localStorage.removeItem('poster.role');
  localStorage.removeItem('poster.token');
  closeModal();
  closeContextMenu();
  showGate();
  if (message) toast(message, true);
}

const initials = (name) => (name || '?').trim().charAt(0).toUpperCase();

async function showGate() {
  $('#gate').hidden = false;
  $('#gatePass').hidden = true;
  $('#gateChoices').hidden = false;
  $('#gatePassErr').hidden = true;
  $('#gatePassInput').value = '';

  const box = $('#gateChoices');
  box.innerHTML = '<div class="mx-empty">Загружаю профили…</div>';

  let employees = [];
  let data = {};
  try {
    data = await fetch(API + '/auth/profiles', {
      headers: { 'X-Device-Key': DEVICE_KEY },
    }).then((r) => r.json());
    employees = data.employees || [];
  } catch (_) {
    box.innerHTML = '<div class="mx-empty">Сервер недоступен</div>';
    return;
  }

  const lock = '<span class="lock"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>пароль</span>';
  const pin = '<span class="lock pin"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>другой компьютер</span>';

  box.innerHTML = `
    ${employees.map((e) => `
      <button class="gate-card ${e.available ? '' : 'locked'}" data-employee="${e.id}"
              data-locked="${e.has_password ? 1 : 0}" ${e.available ? '' : 'disabled'}>
        <span class="av">${esc(initials(e.name))}</span>
        <b>${esc(e.name)}</b>
        <span class="desc">${esc(e.note || 'Профиль сотрудника')}</span>
        ${e.available
          ? (e.has_password ? lock : '')
          : pin}
      </button>`).join('')}
    <button class="gate-card admin" data-admin="1">
      <span class="av">А</span>
      <b>Администратор</b>
      <span class="desc">Полный доступ: заказы, прайс, метрики, сотрудники и устройства.</span>
      ${lock}
    </button>`;

  const hint = $('#gateDevice');
  if (hint) {
    const dev = data.device || {};
    hint.textContent = dev.named
      ? `Этот компьютер: ${dev.name}`
      : 'Этот компьютер ещё не назван — администратор может сделать это в разделе «Устройства».';
  }

  box.querySelectorAll('.gate-card').forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      if (btn.dataset.admin) {
        askPassword({ admin: true, name: 'Администратор' });
        return;
      }
      const id = Number(btn.dataset.employee);
      if (btn.dataset.locked === '1') {
        askPassword({ employeeId: id, name: btn.querySelector('b').textContent });
      } else {
        enterEmployee(id, '');
      }
    });
  });
}

function askPassword(target) {
  state.loginTarget = target;
  $('#gateChoices').hidden = true;
  $('#gatePass').hidden = false;
  $('#gatePassLabel').textContent = `Пароль · ${target.name}`;
  $('#gatePassInput').value = '';
  $('#gatePassInput').focus();
}

async function enterEmployee(employeeId, password) {
  const err = $('#gatePassErr');
  try {
    const res = await fetch(API + '/auth/employee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Key': DEVICE_KEY },
      body: JSON.stringify({ employee_id: employeeId, password }),
    });
    if (!res.ok) {
      err.textContent = res.status === 401 ? 'Неверный пароль' : 'Профиль недоступен';
      err.hidden = false;
      $('#gatePassInput').select();
      return false;
    }
    saveProfile(await res.json());
    hideGate();
    await start();
    return true;
  } catch (_) {
    err.textContent = 'Сервер недоступен';
    err.hidden = false;
    return false;
  }
}

function hideGate() {
  $('#gate').hidden = true;
}

/** Прячет всё, на что у профиля нет прав. */
function applyRole() {
  $('#counter').hidden = !can('finance.totals');
  $('#newOrderBtn').hidden = !can('orders.create');

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const need = VIEWS[tab.dataset.view].permission;
    tab.hidden = need ? !can(need) : false;
  });

  const chip = $('#profileChip');
  chip.classList.toggle('admin', state.role === 'admin');
  $('#pcName').textContent = state.userName || 'Профиль';

  // если права отобрали, пока человек стоял на странице — уводим на доску
  const view = VIEWS[state.view];
  if (view && view.permission && !can(view.permission)) goView('board');
}

function bindGate() {
  $('#gateBack').addEventListener('click', showGate);

  $('#gatePass').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#gateEnter');
    const err = $('#gatePassErr');
    const password = $('#gatePassInput').value;
    btn.disabled = true;
    err.hidden = true;
    try {
      if (state.loginTarget && state.loginTarget.employeeId) {
        await enterEmployee(state.loginTarget.employeeId, password);
        return;
      }
      const res = await fetch(API + '/auth/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Key': DEVICE_KEY },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        err.textContent = res.status === 401 ? 'Неверный пароль' : 'Сервер недоступен';
        err.hidden = false;
        $('#gatePassInput').select();
        return;
      }
      saveProfile(await res.json());
      hideGate();
      await start();
    } catch (_) {
      err.textContent = 'Сервер недоступен';
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $('#profileChip').addEventListener('click', async () => {
    const ok = await askConfirm({
      eyebrow: state.userName,
      title: 'Сменить профиль?',
      text: 'Вы вернётесь к экрану выбора. Несохранённые изменения в открытых окнах пропадут.',
      yes: 'Выйти',
      no: 'Остаться',
    });
    if (ok) logout();
  });
}

/* ---------------------------------------------------- страницы и навигация */
const VIEWS = {
  board: { page: 'pageBoard', title: 'ПОСТЕР · Заказы', permission: null },
  clients: { page: 'pageClients', title: 'ПОСТЕР · Клиенты', permission: 'clients.list' },
  prices: { page: 'pagePrices', title: 'ПОСТЕР · Прайс', permission: 'prices.view' },
  works: { page: 'pageWorks', title: 'ПОСТЕР · Виды работ', permission: 'prices.view' },
  metrics: { page: 'pageMetrics', title: 'ПОСТЕР · Метрики', permission: 'metrics.view' },
  staff: { page: 'pageStaff', title: 'ПОСТЕР · Сотрудники', permission: 'staff.manage' },
};

function currentView() {
  const hash = (location.hash || '').replace('#/', '');
  return VIEWS[hash] ? hash : 'board';
}

/** Показывает раздел. Вызывается роутером при смене адреса. */
function showView(view) {
  const need = VIEWS[view].permission;
  if (need && !can(need)) view = 'board';
  state.view = view;

  Object.entries(VIEWS).forEach(([key, cfg]) => {
    $(`#${cfg.page}`).hidden = key !== view;
  });
  document.title = VIEWS[view].title;

  // фильтры и поиск относятся только к доске
  $('#filtersRow').hidden = view !== 'board';
  $('#searchBox').hidden = view !== 'board';
  $('#newOrderBtn').hidden = view !== 'board' || !can('orders.create');

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  if (view === 'prices') renderPricesPage();
  if (view === 'metrics') renderMetricsPage(state.metricsDays);
  if (view === 'staff') renderStaffPage();
  if (view === 'works') renderWorksPage();
  if (view === 'clients') renderClientsPage();
}

/** Переход на раздел — меняем адрес, дальше сработает роутер. */
function goView(view) {
  if (location.hash === `#/${view}`) showView(view);
  else location.hash = `#/${view}`;
}

function bindRouter() {
  window.addEventListener('hashchange', () => showView(currentView()));
}

/* ---------------------------------------------------- запуск */
async function init() {
  bindGate();

  if (state.token) {
    try {
      const me = await api('/auth/me');
      if (me.kind !== 'guest') {
        saveProfile({ kind: me.kind, name: me.name, permissions: me.permissions });
        hideGate();
        await start();
        return;
      }
    } catch (_) { /* упадём на экран выбора профиля */ }
  }
  logout();
}

/** Загрузка доски — вызывается уже после выбора профиля. */
async function start() {
  applyRole();
  if (!state.templates.length) {
    if (!(await reloadCatalog())) {
      toast('Не удалось загрузить справочники. Проверьте, запущен ли сервер.', true);
      return;
    }
    renderFilters();
    bindGlobal();
  }
  await loadOrders();
  showView(currentView());
}

async function loadOrders() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.filterTemplate !== 'all') params.set('template_key', state.filterTemplate);
  const suffix = params.toString() ? '?' + params : '';
  try {
    state.orders = await api('/orders' + suffix);
  } catch (e) {
    toast(e.message, true);
    return;
  }
  renderBoard();
  renderCounter();
}

/* ---------------------------------------------------- фильтры */
function renderFilters() {
  const box = $('#filters');
  const items = [{ key: 'all', title: 'Все работы' }, ...state.templates];
  box.innerHTML = items
    .map((t) => `<button data-key="${t.key}" class="${t.key === state.filterTemplate ? 'active' : ''}">${esc(t.title)}</button>`)
    .join('');
  box.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filterTemplate = btn.dataset.key;
      renderFilters();
      loadOrders();
    });
  });
}

function renderCounter() {
  if (!can('finance.totals')) return;
  const active = state.orders.filter((o) => !['done', 'cancelled'].includes(o.status));
  const sum = active.reduce((acc, o) => acc + (o.price || 0), 0);
  $('#counter').innerHTML = `<b>${active.length}</b><span>в работе · <em>${esc(money(sum) || '0 ₽')}</em></span>`;
}

/* ---------------------------------------------------- доска */

/** Номер вида ЗК-2026-000042 → 2026000042, чтобы сортировать числом.
 * Год учитывается первым, поэтому заказы 2025 года всегда идут раньше
 * заказов 2026-го, даже если порядковый номер у них больше. */
function numberKey(number) {
  const m = String(number || '').match(/(\d{4})\D+(\d+)\s*$/);
  if (!m) return 0;
  return Number(m[1]) * 1e9 + Number(m[2]);
}

const SORTERS = {
  // по сроку сдачи: ближайшие сверху, бессрочные в конце
  due: (a, b) => {
    if (!a.due_date && !b.due_date) return numberKey(b.number) - numberKey(a.number);
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  },
  new_top: (a, b) => new Date(b.created_at) - new Date(a.created_at),
  new_bottom: (a, b) => new Date(a.created_at) - new Date(b.created_at),
  number_asc: (a, b) => numberKey(a.number) - numberKey(b.number),
  number_desc: (a, b) => numberKey(b.number) - numberKey(a.number),
};

function sortOrders(list) {
  return [...list].sort(SORTERS[state.sort] || SORTERS.due);
}

function renderBoard() {
  const board = $('#pageBoard');
  board.innerHTML = '';
  state.statuses.forEach((st) => {
    const orders = sortOrders(state.orders.filter((o) => o.status === st.key));
    const sum = orders.reduce((acc, o) => acc + (o.price || 0), 0);

    const col = document.createElement('section');
    col.className = 'col';
    col.dataset.status = st.key;
    col.innerHTML = `
      <div class="col-head">
        <div class="col-top">
          <span class="col-dot" style="background:${st.color}"></span>
          <span class="col-title">${esc(st.title)}</span>
          <span class="col-count">${orders.length}</span>
        </div>
        <div class="col-sum">${sum && can('finance.totals') ? `<b>${esc(money(sum))}</b>` : esc(st.hint)}</div>
      </div>
      <div class="col-body"></div>`;

    const body = col.querySelector('.col-body');
    if (!orders.length) {
      body.innerHTML = `<div class="col-empty">${st.key === 'new' ? 'Пусто. Создайте заказ' : 'Пусто'}</div>`;
    } else {
      orders.forEach((o) => body.append(renderCard(o)));
    }

    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drop');
      const id = Number(e.dataTransfer.getData('text/plain'));
      if (id) confirmMoveStatus(id, st.key);
    });

    board.append(col);
  });
}

const PAYMENT = {
  paid: { label: 'Оплачен', short: 'оплачен' },
  partial: { label: 'Частично', short: 'частично' },
  none: { label: 'Не оплачен', short: 'не оплачен' },
  refunded: { label: 'Возврат', short: 'деньги вернули' },
  unset: { label: '', short: '' },
};

const payBadge = (order) => {
  const meta = PAYMENT[order.payment];
  if (!meta || !meta.label) return '';
  const hint = order.payment === 'partial' && order.debt
    ? ` — остаток ${money(order.debt)}`
    : '';
  return `<span class="pay pay-${order.payment}" title="${esc(meta.label + hint)}"><i></i>${esc(meta.label)}</span>`;
};

function renderCard(order) {
  const tpl = state.templatesByKey[order.template_key];
  const overdue = order.due_date && order.due_date < todayISO() && !['done', 'cancelled'].includes(order.status);
  const next = state.forward[order.status];

  const el = document.createElement('article');
  el.className = 'card' + (overdue ? ' overdue' : '');
  if (order.payment !== 'unset') el.classList.add('pay-mark', `mark-${order.payment}`);
  el.draggable = can('orders.status');
  el.tabIndex = 0;
  el.dataset.id = order.id;
  el.innerHTML = `
    <div class="card-top">
      <span class="card-num">${esc(order.number)}</span>
      <span class="card-tag">${esc(tpl ? tpl.short : order.template_key)}</span>
    </div>
    <div class="card-title">${esc(order.title)}</div>
    ${order.summary ? `<div class="card-sub">${esc(order.summary)} · ${order.quantity} шт</div>` : `<div class="card-sub">${order.quantity} шт</div>`}
    ${order.client_name ? `<div class="card-client">${ICONS.user}<span>${esc(order.client_name)}</span></div>` : ''}
    <div class="card-foot">
      ${can('orders.price.view')
        ? `<span class="card-price ${order.price ? '' : 'unset'}">${order.price ? esc(money(order.price)) : 'цена не указана'}</span>${payBadge(order)}`
        : ''}
      ${order.due_date ? `<span class="card-due ${overdue ? 'hot' : ''}">${ICONS.clock}${esc(dateRu(order.due_date))}</span>` : ''}
      ${next && can('orders.status')
        ? `<button class="card-next" type="button" title="В статус «${esc(statusTitle(next))}»" aria-label="Перевести в «${esc(statusTitle(next))}»">${ICONS.arrow}</button>`
        : ''}
    </div>`;

  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(order.id));
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('click', (e) => {
    if (e.target.closest('.card-next')) return;
    openOrder(order.id);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrder(order.id); }
    if (e.key === 'ContextMenu') { e.preventDefault(); const r = el.getBoundingClientRect(); openContextMenu(order, r.left + 30, r.top + 30); }
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openContextMenu(order, e.clientX, e.clientY);
  });
  const nextBtn = el.querySelector('.card-next');
  if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); confirmMoveStatus(order.id, next); });

  return el;
}

const statusTitle = (key) => (state.statuses.find((s) => s.key === key) || {}).title || key;
const statusColor = (key) => (state.statuses.find((s) => s.key === key) || {}).color || '#fff';

/** Перетаскивание карточки и стрелка «дальше» — оба меняют колонку одним
 * случайным движением, поэтому здесь всегда спрашиваем подтверждение.
 * Смена статуса из карточки заказа (openOrder) уже требует открыть заказ
 * и осознанно нажать нужный статус — там лишний шаг не нужен. */
function confirmMoveStatus(id, targetStatus) {
  const order = state.orders.find((o) => o.id === id);
  if (!order || order.status === targetStatus) return;

  const allowed = state.transitions[order.status] || [];
  if (!allowed.includes(targetStatus)) {
    toast(`Нельзя перевести из «${statusTitle(order.status)}» в «${statusTitle(targetStatus)}»`, true);
    return;
  }

  const body = `
    <p style="font-size:15px;color:#c4c8c0;margin:0 0 10px">
      Заказ <b style="color:var(--text)">${esc(order.number)}</b> — ${esc(order.title)}
    </p>
    <p style="font-size:16px;margin:0">
      <span style="color:${esc(statusColor(order.status))}">${esc(statusTitle(order.status))}</span>
      &nbsp;→&nbsp;
      <span style="color:${esc(statusColor(targetStatus))}">${esc(statusTitle(targetStatus))}</span>
    </p>`;
  const foot = `
    <button class="btn btn-ghost" id="moveCancel" type="button">Отмена</button>
    <div class="spacer"></div>
    <button class="btn btn-green" id="moveConfirm" type="button">Перевести</button>`;

  openModal({ eyebrow: order.number, title: 'Сменить статус?', body, foot });
  $('#moveCancel').addEventListener('click', closeModal);
  $('#moveConfirm').addEventListener('click', async () => {
    closeModal();
    await setStatus(id, targetStatus);
  });
}

async function setStatus(id, status) {
  const order = state.orders.find((o) => o.id === id);
  if (!order || order.status === status) return;
  try {
    const updated = await api(`/orders/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    replaceOrder(updated);
    toast(`${updated.number} → ${statusTitle(status)}`);
  } catch (e) {
    toast(e.message, true);
  }
}

function replaceOrder(updated) {
  const i = state.orders.findIndex((o) => o.id === updated.id);
  if (i >= 0) state.orders[i] = updated; else state.orders.push(updated);
  renderBoard();
  renderCounter();
}

/* ---------------------------------------------------- модалка */
function openModal({ eyebrow, title, body, foot }) {
  $('#modalEyebrow').textContent = eyebrow;
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modalFoot').innerHTML = foot || '';
  $('#overlay').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  if (window.PosterDesign) window.PosterDesign.unmount();
  $('#overlay').hidden = true;
  $('#modal').classList.remove('wide');
  document.body.style.overflow = '';
}

/** Перечитывает виды работ и статусы. Вызывается при запуске и после правок. */
async function reloadCatalog() {
  try {
    const catalog = await api('/catalog');
    state.templates = catalog.templates;
    state.templatesByKey = Object.fromEntries(catalog.templates.map((t) => [t.key, t]));
    state.statuses = catalog.statuses;
    state.transitions = catalog.transitions;
    state.forward = catalog.forward;
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------------------------------------------- выбор шаблона */
async function openTemplatePicker() {
  // каталог мог устареть после правки видов работ — перечитываем, если пуст
  if (!state.templates.length) {
    openModal({ eyebrow: 'Новый заказ', title: 'Вид работ', body: '<div class="mx-empty">Загружаю…</div>', foot: '' });
    if (!(await reloadCatalog())) {
      $('#modalBody').innerHTML = '<div class="mx-empty">Не удалось загрузить виды работ. Обновите страницу.</div>';
      return;
    }
  }
  if (!state.templates.length) {
    openModal({
      eyebrow: 'Новый заказ',
      title: 'Вид работ',
      body: '<div class="mx-empty">Виды работ ещё не настроены. Их заводит администратор в разделе «Виды работ».</div>',
      foot: '',
    });
    return;
  }

  const body = `<div class="tpl-list">${state.templates.map((t) => `
    <button class="tpl" data-key="${t.key}">
      <span class="ic">${ICONS[t.icon] || ICONS.printer}</span>
      <span class="txt">
        <b>${esc(t.title)}</b>
        <span>${esc(t.hint)}</span>
      </span>
      <span class="go">${ICONS.arrow}</span>
    </button>`).join('')}</div>`;

  openModal({ eyebrow: 'Новый заказ', title: 'Вид работ', body, foot: '' });
  $('#modalBody').querySelectorAll('.tpl').forEach((btn) => {
    btn.addEventListener('click', () => openForm(btn.dataset.key, null));
  });
}

/* ---------------------------------------------------- форма заказа */
function fieldHtml(f, value) {
  const v = value ?? f.default;
  if (f.type === 'select') {
    // необязательное поле можно оставить пустым: «без ламинации»
    const empty = f.required ? '' : `<option value="" ${!v ? 'selected' : ''}>— нет —</option>`;
    return `<div class="field"><label for="p_${f.key}">${esc(f.label)}${f.required ? '' : ''}</label>
      <select id="p_${f.key}" data-param="${f.key}">
        ${empty}
        ${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select></div>`;
  }
  if (f.type === 'number') {
    // у полей размера показываем единицу — иначе легко ввести метры вместо миллиметров
    const isSize = ['width', 'height', 'length'].includes(f.pricing_role);
    const unit = isSize ? (f.unit || 'мм') : '';
    return `<div class="field"><label for="p_${f.key}">${esc(f.label)}</label>
      <div class="num-with-unit">
        <input id="p_${f.key}" data-param="${f.key}" type="number" min="0" step="${unit === 'м' ? 'any' : '1'}" value="${esc(v ?? 0)}">
        ${unit ? `<span class="unit">${esc(unit)}</span>` : ''}
      </div></div>`;
  }
  if (f.type === 'bool') {
    return `<label class="check"><input type="checkbox" data-param="${f.key}" ${v ? 'checked' : ''}>${esc(f.label)}</label>`;
  }
  return `<div class="field"><label for="p_${f.key}">${esc(f.label)}</label>
    <input id="p_${f.key}" data-param="${f.key}" type="text" value="${esc(v ?? '')}"></div>`;
}

/** Открывает форму заказа. draft — сохранённые значения, если возвращаемся
 * из карточки клиента: заполненное не должно теряться. */
function openForm(templateKey, order, draft = null) {
  const tpl = state.templatesByKey[templateKey];
  state.formTemplateKey = templateKey;
  state.formOrder = order;
  const o = draft ? { ...(order || {}), ...draft } : (order || {});
  const params = o.params || {};

  const body = `
    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Работа</h3>
      <div class="grid">
        <div class="field"><label for="f_title">Название заказа</label>
          <input id="f_title" type="text" value="${esc(o.title || tpl.title)}" placeholder="${esc(tpl.title)}"></div>
        <div class="field"><label for="f_qty">${esc(tpl.quantity_label)}</label>
          <input id="f_qty" type="number" min="1" step="1" value="${esc(o.quantity || 1)}"></div>
      </div>
      <div class="grid" style="margin-top:13px">${tpl.fields.map((f) => fieldHtml(f, params[f.key])).join('')}</div>
    </div>

    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Клиент</h3>
      <div class="grid">
        <div class="field client-search">
          <label for="f_client">Имя или компания</label>
          <input id="f_client" type="text" value="${esc(o.client_name || '')}" placeholder="Начните вводить — найдём" autocomplete="off">
          <div class="client-drop" id="clientDropName" hidden></div>
        </div>
        <div class="field client-search">
          <label for="f_phone">Телефон</label>
          <input id="f_phone" type="tel" value="${esc(o.client_phone || '')}" placeholder="+7 ___ ___ __ __" autocomplete="off">
          <div class="client-drop" id="clientDropPhone" hidden></div>
        </div>
      </div>
      <div class="grid one" style="margin-top:13px">
        <div class="field"><label for="f_contact">Почта, телеграм или как удобнее</label>
          <input id="f_contact" type="text" value="${esc(o.client_contact || '')}" placeholder="Необязательно"></div>
      </div>
      <div class="client-linked" id="clientLinked" hidden>
        <span class="reg"><i></i></span>
        <span id="clientLinkedText"></span>
        <button type="button" id="clientOpen" hidden>карточка</button>
        <button type="button" id="clientUnlink">отвязать</button>
      </div>
    </div>

    <div class="form-sec">
      <h3><span class="reg"><i></i></span> ${can('orders.price.edit') ? 'Деньги и срок' : 'Срок'}</h3>
      <div class="grid">
        ${can('orders.price.edit') ? `
        <div class="field"><label for="f_price">Стоимость, ₽</label>
          <input id="f_price" type="number" min="0" step="10" value="${esc(o.price || '')}" placeholder="0"></div>
        <div class="field"><label for="f_prepaid">Внесено, ₽</label>
          <input id="f_prepaid" type="number" min="0" step="10" value="${esc(o.prepaid || '')}" placeholder="0"></div>` : ''}
        <div class="field"><label for="f_due">Срок сдачи</label>
          <input id="f_due" type="date" value="${esc(o.due_date || '')}"></div>
      </div>
      ${order ? '' : `<div class="hint" style="margin-top:9px">Заказ будет записан на профиль «${esc(state.userName)}».</div>`}

      ${can('orders.price.edit') ? `
      <div class="money-row">
        <button class="btn btn-ghost" id="paidFull" type="button">Оплачен полностью</button>
        <label class="check"><input type="checkbox" id="f_refunded" ${o.refunded ? 'checked' : ''}>Деньги вернули клиенту</label>
      </div>` : ''}

      ${can('orders.estimate') ? `
      <div class="calc">
        <div class="calc-head">
          <b>Подсказка по цене</b>
          <button class="btn btn-ghost" id="calcBtn" type="button">Рассчитать</button>
        </div>
        <div class="calc-lines" id="calcLines"></div>
      </div>` : ''}
    </div>

    ${!order && can('design.upload') ? `
    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Макет</h3>
      <div class="field">
        <input id="f_design" type="file" accept=".cdr">
        <div class="hint">
          Необязательно. Файл прикрепится к заказу сразу после создания —
          ему нужен номер, а он присваивается при сохранении.
          Позже макет можно загрузить или заменить в карточке заказа.
        </div>
      </div>
    </div>` : ''}

    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Дополнительно</h3>
      <div class="field"><label for="f_notes">Комментарий к заказу</label>
        <textarea id="f_notes" placeholder="Пожелания, ссылка на макет, что уточнить">${esc(o.notes || '')}</textarea></div>
    </div>`;

  const foot = `
    <button class="btn btn-ghost" id="cancelBtn" type="button">Отмена</button>
    <div class="spacer"></div>
    <button class="btn btn-green" id="saveBtn" type="button">${order ? 'Сохранить' : 'Создать заказ'}</button>`;

  openModal({
    eyebrow: order ? `${order.number} · редактирование` : 'Новый заказ',
    title: tpl.title,
    body,
    foot,
  });

  pickedClientId = o.client_id || null;
  if (can('clients.search')) bindClientSearch();
  if (pickedClientId) {
    api(`/clients/${pickedClientId}`).then(showLinked).catch(() => showLinked(null));
  }

  $('#cancelBtn').addEventListener('click', () => (order ? openOrder(order.id) : closeModal()));
  const calcBtn = $('#calcBtn');
  if (calcBtn) calcBtn.addEventListener('click', () => runEstimate(templateKey));
  const paidFull = $('#paidFull');
  if (paidFull) paidFull.addEventListener('click', () => {
    const price = Number($('#f_price').value || 0);
    if (!price) { toast('Сначала укажите стоимость', true); return; }
    $('#f_prepaid').value = price;
    $('#f_refunded').checked = false;
  });
  $('#saveBtn').addEventListener('click', () => saveOrder(templateKey, order));
}

function collectForm(templateKey) {
  const tpl = state.templatesByKey[templateKey];
  const params = {};
  tpl.fields.forEach((f) => {
    const el = $(`[data-param="${f.key}"]`);
    if (!el) return;
    if (f.type === 'bool') params[f.key] = el.checked;
    else if (f.type === 'number') params[f.key] = Number(el.value || 0);
    else params[f.key] = el.value;
  });
  const num = (sel) => { const el = $(sel); return el ? Number(el.value || 0) : 0; };
  const flag = (sel) => { const el = $(sel); return el ? el.checked : false; };
  return {
    template_key: templateKey,
    client_id: pickedClientId,
    title: $('#f_title').value.trim() || tpl.title,
    quantity: Math.max(num('#f_qty'), 1),
    params,
    client_name: $('#f_client').value.trim(),
    client_phone: $('#f_phone').value.trim(),
    client_contact: $('#f_contact').value.trim(),
    ...(can('orders.price.edit')
      ? { price: num('#f_price'), prepaid: num('#f_prepaid'), refunded: flag('#f_refunded') }
      : {}),
    due_date: $('#f_due').value || null,
    notes: $('#f_notes').value.trim(),
  };
}

async function runEstimate(templateKey) {
  const data = collectForm(templateKey);
  const box = $('#calcLines');
  try {
    const res = await api('/price/estimate', {
      method: 'POST',
      body: JSON.stringify({ template_key: templateKey, quantity: data.quantity, params: data.params }),
    });
    if (res.price === null) {
      box.innerHTML = `<div class="calc-note">${esc(res.note || 'Не хватает данных для расчёта')}</div>`;
      box.classList.add('show');
      return;
    }
    box.innerHTML = `
      ${res.breakdown.map((l) => `<div class="calc-line"><span>${esc(l.label)}</span><span>${esc(money(l.amount))}</span></div>`).join('')}
      <div class="calc-line total"><span>Итого по прайсу</span><span>${esc(money(res.price))}</span></div>
      ${res.note ? `<div class="calc-note">${esc(res.note)}</div>` : ''}
      <div class="calc-note">Цена подставлена в поле выше — поправьте, если договорились иначе.</div>`;
    box.classList.add('show');
    $('#f_price').value = Math.round(res.price);
  } catch (e) {
    toast(e.message, true);
  }
}

async function saveOrder(templateKey, order) {
  const payload = collectForm(templateKey);
  const btn = $('#saveBtn');
  btn.disabled = true;
  try {
    if (order) {
      const updated = await api(`/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      replaceOrder(updated);
      toast(`${updated.number} сохранён`);
      openOrder(updated.id);
    } else {
      const designInput = $('#f_design');
      const designFile = designInput && designInput.files ? designInput.files[0] : null;

      const created = await api('/orders', { method: 'POST', body: JSON.stringify(payload) });
      replaceOrder(created);
      toast(`${created.number} создан`);
      closeModal();

      // макет отправляем отдельным запросом: ему нужен номер заказа,
      // а он присваивается только при создании
      if (designFile) await uploadDesignForOrder(created, designFile);
    }
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false;
  }
}

/** Возврат из карточки клиента обратно в заполненную форму. */
function restoreForm(templateKey, order, draft) {
  openForm(templateKey, order, draft);
  if (draft && draft.client_id) {
    api(`/clients/${draft.client_id}`).then(showLinked).catch(() => showLinked(null));
  }
}

/* ---------------------------------------------------- макет заказа */
/* Скрипт макетов лежит отдельным файлом и грузится один раз, при первом
 * открытии заказа: он нужен не всегда, а тянуть его в основной файл — значит
 * замедлять загрузку доски для всех. */
let designScriptPromise = null;

function loadDesignScript() {
  if (window.PosterDesign) return Promise.resolve();
  if (!designScriptPromise) {
    designScriptPromise = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = '/static/js/design.js';
      tag.onload = resolve;
      tag.onerror = () => { designScriptPromise = null; reject(new Error('Не удалось загрузить модуль макетов')); };
      document.head.append(tag);
    });
  }
  return designScriptPromise;
}

/** Запрос для модуля макетов: с токеном и ключом устройства.
 * raw=true — вернуть Blob (для картинки превью). */
async function designRequest(path, options = {}) {
  const { raw, ...rest } = options;
  const headers = { 'X-Device-Key': DEVICE_KEY, ...(rest.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  // FormData сам ставит нужный Content-Type с границей — не перебиваем
  if (rest.body && !(rest.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(API + path, { ...rest, headers });
  if (res.status === 204) return null;
  if (!res.ok) {
    if (raw) return null;
    const data = await res.json().catch(() => null);
    const detail = data && data.detail;
    throw new Error(typeof detail === 'string' ? detail : 'Сервер не принял запрос');
  }
  return raw ? res.blob() : res.json();
}

async function mountDesign(container, orderId, onChange) {
  if (!can('design.view')) return;
  try {
    await loadDesignScript();
  } catch (e) {
    toast(e.message, true);
    return;
  }
  window.PosterDesign.mount(container, orderId, {
    request: designRequest,
    toast,
    confirm: askConfirm,
    onChange,
  });
}

/** Отправляет макет, выбранный в форме создания заказа. */
async function uploadDesignForOrder(order, file) {
  if (!/\.cdr$/i.test(file.name)) {
    toast('Макет не прикреплён: принимаются только файлы .cdr', true);
    return;
  }
  try {
    const form = new FormData();
    form.append('file', file);
    const info = await designRequest(`/orders/${order.id}/design`, { method: 'POST', body: form });
    toast(info.has_preview
      ? `Макет прикреплён к ${order.number}`
      : `Макет прикреплён к ${order.number}, но превью в нём нет`);
  } catch (e) {
    // заказ уже создан — сообщаем про макет, но не делаем вид, что всё пропало
    toast(`Заказ создан, но макет не загрузился: ${e.message}`, true);
  }
}

/* ---------------------------------------------------- карточка заказа */
async function openOrder(id, opts = {}) {
  let order;
  try {
    order = await api(`/orders/${id}`);
  } catch (e) {
    toast(e.message, true);
    return;
  }
  replaceOrder(order);

  const tpl = state.templatesByKey[order.template_key];
  const allowed = state.transitions[order.status] || [];

  const paramRows = (tpl ? tpl.fields : [])
    .map((f) => {
      const v = (order.params || {})[f.key];
      if (v === undefined || v === '' || v === null) return '';
      const shown = f.type === 'bool' ? (v ? 'да' : 'нет') : v;
      if (f.type === 'bool' && !v) return '';
      return `<dt>${esc(f.label)}</dt><dd>${esc(shown)}</dd>`;
    })
    .join('');

  const body = `
    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Статус</h3>
      <div class="status-row">
        ${state.statuses.map((s) => {
          const isCurrent = s.key === order.status;
          const allowedHere = isCurrent || (allowed.includes(s.key) && can('orders.status'));
          return `<button class="status-pill ${isCurrent ? 'current' : ''}" data-status="${s.key}"
            style="${isCurrent ? `color:${s.color}` : ''}" ${allowedHere ? '' : 'disabled'}>${esc(s.title)}</button>`;
        }).join('')}
      </div>
    </div>

    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Работа</h3>
      <dl class="kv">
        <dt>Вид</dt><dd>${esc(tpl ? tpl.title : order.template_key)}</dd>
        <dt>Количество</dt><dd>${esc(order.quantity)} шт</dd>
        ${paramRows}
        ${order.due_date ? `<dt>Срок</dt><dd>${esc(new Date(order.due_date + 'T00:00:00').toLocaleDateString('ru-RU'))}</dd>` : ''}
        ${order.manager ? `<dt>Принял</dt><dd>${esc(order.manager)}</dd>` : ''}
      </dl>
    </div>

    ${order.client_name || order.client_phone || order.client_contact ? `
    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Клиент</h3>
      <dl class="kv">
        ${order.client_name ? `<dt>Кто</dt><dd>${order.client_id && can('clients.history')
            ? `<a href="#" id="openClient" style="color:var(--green);border-bottom:1px dashed currentColor">${esc(order.client_name)}</a>`
            : esc(order.client_name)}</dd>` : ''}
        ${order.client_phone && can('clients.view') ? `<dt>Телефон</dt><dd><a href="tel:${esc(order.client_phone.replace(/[^\d+]/g, ''))}">${esc(order.client_phone)}</a></dd>` : ''}
        ${order.client_contact && can('clients.view') ? `<dt>Контакт</dt><dd>${esc(order.client_contact)}</dd>` : ''}
      </dl>
    </div>` : ''}

    ${can('orders.price.view') ? `
    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Деньги</h3>
      ${order.payment !== 'unset' ? `<div class="pay-row">
        ${payBadge(order)}
        <span class="amount">${order.payment === 'partial'
          ? `внесено ${esc(money(order.prepaid))} из ${esc(money(order.price))}, остаток ${esc(money(order.debt))}`
          : order.payment === 'refunded'
            ? `клиенту вернули ${esc(money(order.prepaid) || money(order.price) || '—')}`
            : order.payment === 'paid'
              ? `${esc(money(order.price))} получены полностью`
              : `к оплате ${esc(money(order.debt))}`}</span>
      </div>` : ''}
      <dl class="kv">
        <dt>Стоимость</dt><dd>${order.price ? esc(money(order.price)) : 'не указана'}</dd>
        ${order.prepaid ? `<dt>Внесено</dt><dd>${esc(money(order.prepaid))}</dd>` : ''}
      </dl>
    </div>` : ''}

    ${order.notes ? `
    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Комментарий</h3>
      <div style="font-size:14px;color:#c4c8c0;white-space:pre-wrap">${esc(order.notes)}</div>
    </div>` : ''}

    <div id="orderDesign"></div>

    <div class="form-sec">
      <h3><span class="reg"><i></i></span> История</h3>
      <ul class="feed">
        ${order.events.map((ev) => `<li>${esc(ev.text)}${ev.author ? ` · ${esc(ev.author)}` : ''}<time>${esc(dtRu(ev.created_at))}</time></li>`).join('')}
      </ul>
    </div>`;

  const foot = `
    ${can('orders.delete') ? '<button class="btn btn-danger" id="delBtn" type="button">Удалить</button>' : ''}
    <div class="spacer"></div>
    ${opts.back ? `<button class="btn btn-ghost" id="orderBack" type="button">${esc(opts.back.label)}</button>` : ''}
    ${can('orders.edit') ? '<button class="btn btn-ghost" id="editBtn" type="button">Редактировать</button>' : ''}
    <button class="btn btn-green" id="okBtn" type="button">Закрыть</button>`;

  openModal({ eyebrow: `${order.number} · ${statusTitle(order.status)}`, title: order.title, body, foot });

  $('#modalBody').querySelectorAll('.status-pill').forEach((pill) => {
    pill.addEventListener('click', async () => {
      if (pill.disabled || pill.dataset.status === order.status) return;
      await setStatus(order.id, pill.dataset.status);
      openOrder(order.id);
    });
  });
  const clientLink = $('#openClient');
  if (clientLink) clientLink.addEventListener('click', (e) => {
    e.preventDefault();
    openClientCard(order.client_id, {
      back: { label: '← К заказу', action: () => openOrder(order.id, opts) },
    });
  });
  const editBtn = $('#editBtn');
  if (editBtn) editBtn.addEventListener('click', () => openForm(order.template_key, order));
  $('#okBtn').addEventListener('click', closeModal);
  const orderBack = $('#orderBack');
  if (orderBack) orderBack.addEventListener('click', () => opts.back.action());

  // блок макета: подтягивается отдельным скриптом, обновляет карточку
  // после загрузки или удаления файла (там появляется запись в истории)
  const designBox = $('#orderDesign');
  if (designBox) mountDesign(designBox, order.id, () => openOrder(order.id, opts));
  const delBtn = $('#delBtn');
  if (delBtn) delBtn.addEventListener('click', () => confirmDelete(order));
}

function confirmDelete(order) {
  const body = `
    <p style="font-size:15px;color:#c4c8c0;margin:0 0 10px">
      Заказ <b>${esc(order.number)}</b> — ${esc(order.title)} будет удалён вместе с историей. Отменить это нельзя.
    </p>
    <p style="font-size:13.5px;color:var(--muted);margin:0">
      Если заказ просто не состоялся, переведите его в «Отменён» — он останется в базе.
    </p>`;
  const foot = `
    <button class="btn btn-ghost" id="backBtn" type="button">Назад</button>
    <div class="spacer"></div>
    <button class="btn btn-danger" id="reallyDel" type="button">Удалить заказ</button>`;

  openModal({ eyebrow: 'Удаление', title: 'Удалить заказ?', body, foot });
  $('#backBtn').addEventListener('click', () => openOrder(order.id));
  $('#reallyDel').addEventListener('click', async () => {
    try {
      await api(`/orders/${order.id}`, { method: 'DELETE' });
      state.orders = state.orders.filter((o) => o.id !== order.id);
      renderBoard();
      renderCounter();
      closeModal();
      toast(`${order.number} удалён`);
    } catch (e) {
      toast(e.message, true);
    }
  });
}

/* ---------------------------------------------------- подтверждение действия */
/* Замена системному confirm(): своё окно в стиле интерфейса, без «127.0.0.1»
 * в заголовке. Возвращает промис — вызывать через await.
 * Живёт на отдельном слое, поэтому работает и поверх открытой формы. */
function askConfirm({
  title = 'Вы уверены?',
  eyebrow = 'Подтверждение',
  text = '',
  note = '',
  yes = 'Подтвердить',
  no = 'Отмена',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const overlay = $('#confirmOverlay');
    $('#confirmEyebrow').textContent = eyebrow;
    $('#confirmTitle').textContent = title;
    const lines = (Array.isArray(text) ? text : [text]).filter(Boolean);
    $('#confirmBody').innerHTML = `
      ${lines.map((t) => `<p class="confirm-text">${t}</p>`).join('')}
      ${note ? `<div class="confirm-note">${esc(note)}</div>` : ''}`;

    const yesBtn = $('#confirmYes');
    const noBtn = $('#confirmNo');
    yesBtn.textContent = yes;
    noBtn.textContent = no;
    yesBtn.className = danger ? 'btn btn-danger' : 'btn btn-green';

    overlay.hidden = false;
    setTimeout(() => yesBtn.focus(), 30);

    const close = (result) => {
      overlay.hidden = true;
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
      overlay.removeEventListener('mousedown', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const onYes = () => close(true);
    const onNo = () => close(false);
    const onBackdrop = (e) => { if (e.target === overlay) close(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(false); }
      if (e.key === 'Enter' && document.activeElement !== noBtn) { e.preventDefault(); close(true); }
    };

    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
    overlay.addEventListener('mousedown', onBackdrop);
    document.addEventListener('keydown', onKey, true);
  });
}

/* ---------------------------------------------------- контекстное меню */
function closeContextMenu() {
  $('#ctx').hidden = true;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // clipboard API недоступен без https — запасной вариант через скрытое поле
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    return ok;
  }
}

function openContextMenu(order, x, y) {
  const ctx = $('#ctx');
  const allowed = state.transitions[order.status] || [];

  const moveItems = state.statuses
    .filter((s) => s.key !== order.status)
    .map((s) => `
      <button class="ctx-item" data-act="move" data-status="${s.key}" ${allowed.includes(s.key) ? '' : 'disabled'}>
        <span class="ctx-dot" style="background:${s.color}"></span>${esc(s.title)}
      </button>`)
    .join('');

  ctx.innerHTML = `
    <div class="ctx-num">${esc(order.number)} · ${esc(order.title)}</div>
    <button class="ctx-item" data-act="open">${ICONS.open}Открыть</button>
    ${can('orders.edit') ? `<button class="ctx-item" data-act="edit">${ICONS.edit}Изменить</button>` : ''}
    <button class="ctx-item" data-act="copy">${ICONS.copy}Скопировать номер</button>
    ${can('orders.status') ? `
      <div class="ctx-sep"></div>
      <div class="ctx-head">Перенести в</div>
      ${moveItems}` : ''}
    ${can('orders.delete') ? `
      <div class="ctx-sep"></div>
      <button class="ctx-item danger" data-act="delete">${ICONS.trash}Удалить</button>` : ''}`;

  // сначала показываем, потом двигаем — иначе не знаем реальный размер
  ctx.hidden = false;
  ctx.style.left = '0px';
  ctx.style.top = '0px';
  const box = ctx.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - box.width - 8);
  const top = Math.min(y, window.innerHeight - box.height - 8);
  ctx.style.left = `${Math.max(8, left)}px`;
  ctx.style.top = `${Math.max(8, top)}px`;

  ctx.querySelectorAll('.ctx-item').forEach((item) => {
    item.addEventListener('click', async () => {
      if (item.disabled) return;
      const act = item.dataset.act;
      closeContextMenu();

      if (act === 'open') openOrder(order.id);
      if (act === 'edit') openForm(order.template_key, order);
      if (act === 'delete') confirmDelete(order);
      if (act === 'move') confirmMoveStatus(order.id, item.dataset.status);
      if (act === 'copy') {
        const ok = await copyText(order.number);
        toast(ok ? `Номер ${order.number} скопирован` : 'Не удалось скопировать', !ok);
      }
    });
  });
}

/* ---------------------------------------------------- страницы списков */
/* Общий переключатель: 1 2 3 … Показывает не все номера подряд, а окно
 * вокруг текущей страницы — иначе при сотне страниц полоса не поместится. */
function pagerHtml(total, limit, offset, { id = 'pager' } = {}) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return '';
  const current = Math.floor(offset / limit) + 1;

  const nums = new Set([1, pages, current]);
  for (let d = 1; d <= 2; d += 1) {
    if (current - d > 1) nums.add(current - d);
    if (current + d < pages) nums.add(current + d);
  }
  const sorted = [...nums].sort((a, b) => a - b);

  let html = '';
  let prev = 0;
  sorted.forEach((n) => {
    if (n - prev > 1) html += '<span class="pg-gap">…</span>';
    html += `<button class="pg-num ${n === current ? 'on' : ''}" data-page="${n}">${n}</button>`;
    prev = n;
  });

  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return `
    <div class="pager" id="${id}">
      <button class="pg-arrow" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''} title="Назад">${ICONS.arrowLeft}</button>
      ${html}
      <button class="pg-arrow" data-page="${current + 1}" ${current === pages ? 'disabled' : ''} title="Вперёд">${ICONS.arrow}</button>
      <span class="pg-info">${from}–${to} из ${total}</span>
    </div>`;
}

/** Навешивает обработчики на переключатель. onGo получает новый offset. */
function bindPager(root, limit, onGo) {
  root.querySelectorAll('.pager [data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      onGo((Number(btn.dataset.page) - 1) * limit);
    });
  });
}

/* ---------------------------------------------------- клиенты (раздел) */
const CLIENT_SORTS = [
  { key: 'recent', title: 'Последние' },
  { key: 'orders', title: 'По числу заказов' },
  { key: 'sum', title: 'По сумме' },
  { key: 'name', title: 'По имени' },
];

async function renderClientsPage() {
  const box = $('#clientsContent');
  box.innerHTML = '<div class="mx-empty">Загружаю…</div>';

  const LIMIT = 25;
  const params = new URLSearchParams({ limit: String(LIMIT), offset: String(state.clientsOffset) });
  if (state.clientsQuery) params.set('q', state.clientsQuery);
  else params.set('sort', state.clientsSort);

  let page;
  let summary = {};
  try {
    [page, summary] = await Promise.all([
      api(`/clients?${params}`),
      api('/clients/summary').catch(() => ({})),
    ]);
  } catch (e) {
    box.innerHTML = `<div class="mx-empty">${esc(e.message)}</div>`;
    return;
  }
  const list = page.items;

  box.innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow"><span class="reg"><i></i></span> Справочник</div>
      <h1>Клиенты</h1>
      <p class="sub">
        Карточки заводятся сами при создании заказа. Здесь — весь список с поиском
        и историей: видно, кто сколько заказывал и когда обращался последний раз.
      </p>
    </div>

    <div class="cl-tools">
      <div class="cl-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="clSearch" placeholder="Имя, телефон, почта…" value="${esc(state.clientsQuery)}" autocomplete="off">
      </div>
      ${state.clientsQuery ? '' : `
      <div class="cl-sorts">
        ${CLIENT_SORTS.map((srt) => `
          <button data-sort="${srt.key}" class="${state.clientsSort === srt.key ? 'active' : ''}">${srt.title}</button>`).join('')}
      </div>`}
    </div>

    ${summary.total !== undefined ? `
    <div class="cl-summary">
      <span><b>${summary.total}</b> ${plural(summary.total, 'клиент', 'клиента', 'клиентов')}</span>
      <span><b>${summary.with_orders}</b> с заказами</span>
      ${summary.revenue !== undefined ? `<span>на <b>${esc(money(summary.revenue) || '0 ₽')}</b></span>` : ''}
    </div>` : ''}

    ${list.length ? `<div class="cl-list">${list.map((c) => `
      <button class="cl-row" data-id="${c.id}" type="button">
        <span class="cl-av">${esc(initials(c.name))}</span>
        <span class="cl-main">
          <b>${esc(c.name || 'Без имени')}</b>
          <span class="meta">${[
            c.phone ? esc(c.phone) : '',
            c.contact ? esc(c.contact) : '',
          ].filter(Boolean).join(' · ') || 'контактов нет'}</span>
        </span>
        <span class="cl-nums">
          <span class="n">${c.orders_count}</span>
          <span class="l">${plural(c.orders_count, 'заказ', 'заказа', 'заказов')}</span>
        </span>
        ${c.active_count ? `<span class="cl-badge">${c.active_count} в работе</span>` : ''}
        ${c.total_sum !== null && c.total_sum !== undefined
          ? `<span class="cl-sum">${esc(money(c.total_sum) || '—')}</span>` : ''}
        <span class="cl-when">${c.last_order_at ? esc(dateRu(String(c.last_order_at).slice(0, 10))) : '—'}</span>
      </button>`).join('')}</div>`
      : `<div class="mx-empty">${state.clientsQuery ? 'Никого не нашлось' : 'Клиентов пока нет'}</div>`}
    ${pagerHtml(page.total, page.limit, page.offset)}`;

  bindPager(box, page.limit, (offset) => {
    state.clientsOffset = offset;
    renderClientsPage();
    $('#pageClients').scrollTop = 0;
  });

  let timer;
  const search = $('#clSearch');
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      state.clientsQuery = search.value.trim();
      state.clientsOffset = 0;   // новый поиск — с первой страницы
      await renderClientsPage();
      // страница перерисовалась — возвращаем курсор в поле поиска.
      // Поля может не быть, если человек успел уйти в другой раздел.
      const el = $('#clSearch');
      if (el && state.view === 'clients') {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 300);
  });

  box.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.clientsSort = btn.dataset.sort;
      state.clientsOffset = 0;
      renderClientsPage();
    });
  });
  box.querySelectorAll('.cl-row').forEach((row) => {
    row.addEventListener('click', () => openClientCard(Number(row.dataset.id)));
  });
}

/* ---------------------------------------------------- карточка клиента */
async function openClientCard(clientId, opts = {}) {
  const HISTORY_LIMIT = 10;
  const offset = opts.ordersOffset ?? 0;

  let client;
  let history = { items: [], total: 0, limit: HISTORY_LIMIT, offset: 0 };
  try {
    client = await api(`/clients/${clientId}`);
    if (can('clients.history')) {
      history = await api(`/clients/${clientId}/orders?limit=${HISTORY_LIMIT}&offset=${offset}`);
    }
  } catch (e) {
    toast(e.message, true);
    return;
  }
  const orders = history.items;

  // как вернуться сюда же — из заказа, открытого из этой карточки
  const backHere = () => openClientCard(clientId, opts);

  const editable = can('clients.edit');
  const phoneHref = (client.phone || '').replace(/[^\d+]/g, '');

  const body = `
    <div class="cl-card-top">
      <span class="cl-av big">${esc(initials(client.name))}</span>
      <div class="cl-card-stats">
        <div class="cl-stat"><b>${client.orders_count}</b><span>${plural(client.orders_count, 'заказ', 'заказа', 'заказов')}</span></div>
        ${client.active_count ? `<div class="cl-stat accent"><b>${client.active_count}</b><span>в работе</span></div>` : ''}
        ${client.total_sum !== null && client.total_sum !== undefined
          ? `<div class="cl-stat"><b>${esc(money(client.total_sum) || '0 ₽')}</b><span>всего</span></div>` : ''}
        <div class="cl-stat"><b>${client.last_order_at ? esc(dateRu(String(client.last_order_at).slice(0, 10))) : '—'}</b><span>последний</span></div>
      </div>
    </div>

    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Контакты</h3>
      ${editable ? `
      <div class="grid">
        <div class="field"><label for="cl_name">Имя или компания</label>
          <input id="cl_name" type="text" value="${esc(client.name)}"></div>
        <div class="field"><label for="cl_phone">Телефон</label>
          <input id="cl_phone" type="tel" value="${esc(client.phone)}"></div>
      </div>
      <div class="grid one" style="margin-top:13px">
        <div class="field"><label for="cl_contact">Почта, телеграм</label>
          <input id="cl_contact" type="text" value="${esc(client.contact)}" placeholder="Необязательно"></div>
      </div>
      <div class="grid one" style="margin-top:13px">
        <div class="field"><label for="cl_notes">Заметка</label>
          <textarea id="cl_notes" placeholder="Особенности работы с клиентом, скидки, предпочтения">${esc(client.notes)}</textarea></div>
      </div>` : `
      <dl class="kv">
        ${client.phone ? `<dt>Телефон</dt><dd><a href="tel:${esc(phoneHref)}">${esc(client.phone)}</a></dd>` : ''}
        ${client.contact ? `<dt>Контакт</dt><dd>${esc(client.contact)}</dd>` : ''}
        ${client.notes ? `<dt>Заметка</dt><dd style="white-space:pre-wrap">${esc(client.notes)}</dd>` : ''}
        ${!client.phone && !client.contact ? '<dt>Контакты</dt><dd>не указаны</dd>' : ''}
      </dl>`}
    </div>

    ${can('clients.history') ? `
    <div class="form-sec">
      <h3><span class="reg"><i></i></span> История заказов${history.total > orders.length ? ` <span style="color:var(--muted);font-weight:400">— всего ${history.total}</span>` : ''}</h3>
      ${orders.length ? `<ul class="cl-orders">${orders.map((o) => `
        <li data-id="${o.id}">
          <span class="num">${esc(o.number)}</span>
          <span class="ttl">${esc(o.title)}${o.summary ? `<em>${esc(o.summary)}</em>` : ''}</span>
          <span class="st" style="color:${esc(statusColor(o.status))}">${esc(statusTitle(o.status))}</span>
          <span class="pr">${o.price !== null && o.price !== undefined ? esc(money(o.price) || '—') : ''}</span>
        </li>`).join('')}</ul>
      ${pagerHtml(history.total, history.limit, history.offset, { id: 'clOrdersPager' })}`
        : '<div class="mx-empty">Заказов пока нет</div>'}
    </div>` : ''}`;

  const foot = `
    ${editable ? '<button class="btn btn-danger" id="clDelete" type="button">Удалить</button>' : ''}
    <div class="spacer"></div>
    ${opts.back ? `<button class="btn btn-ghost" id="clBack" type="button">${esc(opts.back.label)}</button>` : ''}
    ${editable ? '<button class="btn btn-green" id="clSave" type="button">Сохранить</button>'
               : '<button class="btn btn-green" id="clClose" type="button">Закрыть</button>'}`;

  openModal({ eyebrow: 'Клиент', title: client.name || 'Без имени', body, foot });

  const closeBtn = $('#clClose');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  const backBtn = $('#clBack');
  if (backBtn) backBtn.addEventListener('click', () => opts.back.action());

  bindPager($('#modalBody'), history.limit, (newOffset) => {
    openClientCard(clientId, { ...opts, ordersOffset: newOffset });
  });

  // из истории — в заказ, и обратно в эту же карточку на ту же страницу
  $('#modalBody').querySelectorAll('.cl-orders li').forEach((li) => {
    li.addEventListener('click', () => {
      openOrder(Number(li.dataset.id), {
        back: { label: `← К клиенту`, action: backHere },
      });
    });
  });

  const saveBtn = $('#clSave');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    try {
      await api(`/clients/${clientId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: $('#cl_name').value.trim(),
          phone: $('#cl_phone').value.trim(),
          contact: $('#cl_contact').value.trim(),
          notes: $('#cl_notes').value.trim(),
        }),
      });
      toast('Карточка сохранена');
      if (opts.back) opts.back.action();
      else { closeModal(); if (state.view === 'clients') renderClientsPage(); }
    } catch (e) {
      toast(e.message, true);
    }
  });

  const delBtn = $('#clDelete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const ok = await askConfirm({
      eyebrow: 'Клиенты',
      title: 'Удалить карточку?',
      text: [
        `Карточка <b>${esc(client.name || 'Без имени')}</b> будет удалена.`,
        'Заказы останутся — в них имя и телефон хранятся отдельно.',
      ],
      note: 'При следующем заказе на этот телефон карточка заведётся заново.',
      yes: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/clients/${clientId}`, { method: 'DELETE' });
      toast('Карточка удалена');
      closeModal();
      if (state.view === 'clients') renderClientsPage();
    } catch (e) {
      toast(e.message, true);
    }
  });
}

/* ---------------------------------------------------- поиск клиента в форме */
let pickedClientId = null;

function showLinked(client) {
  pickedClientId = client ? client.id : null;
  const box = $('#clientLinked');
  if (!box) return;
  if (!client) { box.hidden = true; return; }

  const parts = [];
  if (client.orders_count) {
    parts.push(`${client.orders_count} ${plural(client.orders_count, 'заказ', 'заказа', 'заказов')}`);
  } else {
    parts.push('новая карточка');
  }
  if (client.active_count) parts.push(`${client.active_count} в работе`);
  if (client.total_sum) parts.push(`на ${money(client.total_sum)}`);

  $('#clientLinkedText').textContent = `Клиент из справочника · ${parts.join(' · ')}`;
  // карточку можно посмотреть, не бросая заполнение заказа
  const openBtn = $('#clientOpen');
  if (openBtn) openBtn.hidden = !can('clients.history');
  box.hidden = false;
}

const plural = (n, one, few, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

function fillClient(client) {
  $('#f_client').value = client.name || '';
  $('#f_phone').value = client.phone || '';
  if (client.contact) $('#f_contact').value = client.contact;
  showLinked(client);
  hideClientDrops();
}

function hideClientDrops() {
  ['#clientDropName', '#clientDropPhone'].forEach((sel) => {
    const el = $(sel);
    if (el) el.hidden = true;
  });
}

/** Вешает подсказки на поле имени и на поле телефона. */
function bindClientSearch() {
  [['#f_client', '#clientDropName'], ['#f_phone', '#clientDropPhone']].forEach(([inputSel, dropSel]) => {
    const input = $(inputSel);
    const drop = $(dropSel);
    if (!input || !drop) return;

    let timer;
    let items = [];
    let cursor = -1;

    const render = () => {
      if (!items.length) {
        drop.innerHTML = '<div class="none">Ничего не нашлось — будет заведён новый клиент</div>';
        drop.hidden = false;
        return;
      }
      drop.innerHTML = items.map((c, i) => `
        <button type="button" class="client-opt ${i === cursor ? 'on' : ''}" data-i="${i}">
          <b>${esc(c.name || 'без имени')}</b>
          <span>${esc(c.phone || 'без телефона')}${c.orders_count ? ` · <em class="cnt">${c.orders_count} ${plural(c.orders_count, 'заказ', 'заказа', 'заказов')}</em>` : ' · новый'}${
            c.active_count ? ` · <em class="cnt">${c.active_count} в работе</em>` : ''}</span>
        </button>`).join('');
      drop.hidden = false;
      drop.querySelectorAll('.client-opt').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();  // не даём полю потерять фокус раньше клика
          fillClient(items[Number(btn.dataset.i)]);
        });
      });
    };

    input.addEventListener('input', () => {
      pickedClientId = null;
      showLinked(null);
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { drop.hidden = true; return; }
      timer = setTimeout(async () => {
        try {
          items = await api(`/clients?q=${encodeURIComponent(q)}&limit=6`);
        } catch (_) {
          items = [];
        }
        cursor = -1;
        render();
      }, 250);
    });

    input.addEventListener('keydown', (e) => {
      if (drop.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cursor = e.key === 'ArrowDown'
          ? Math.min(cursor + 1, items.length - 1)
          : Math.max(cursor - 1, 0);
        render();
      }
      if (e.key === 'Enter' && cursor >= 0) {
        e.preventDefault();
        fillClient(items[cursor]);
      }
      if (e.key === 'Escape') drop.hidden = true;
    });

    input.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 120));
  });

  const unlink = $('#clientUnlink');
  if (unlink) unlink.addEventListener('click', () => showLinked(null));

  // Смотрим карточку клиента, не теряя заполненную форму: запоминаем ввод,
  // открываем карточку, по кнопке «Назад к заказу» возвращаем всё как было.
  const openBtn = $('#clientOpen');
  if (openBtn) openBtn.addEventListener('click', () => {
    if (!pickedClientId) return;
    const draft = collectForm(state.formTemplateKey);
    const order = state.formOrder;
    openClientCard(pickedClientId, {
      back: {
        label: '← К заказу',
        action: () => restoreForm(state.formTemplateKey, order, draft),
      },
    });
  });
}

/* ---------------------------------------------------- устройства */
/* Раздел живёт внутри страницы «Сотрудники»: переключатель вкладок вверху. */
async function renderDevices(box) {
  let list;
  try {
    list = await api('/devices');
  } catch (e) {
    box.innerHTML = `<div class="mx-empty">${esc(e.message)}</div>`;
    return;
  }
  state.devices = list;

  box.innerHTML = `
    <p class="sub" style="margin-bottom:22px">
      Компьютеры, с которых открывали систему. Дайте им понятные имена — потом
      в профиле сотрудника можно указать, с каких рабочих мест разрешён вход.
      Ключ компьютера хранится в браузере: очистка данных сайта или другой
      браузер на том же компьютере считаются новым устройством.
    </p>
    ${list.length ? `<div class="dv-list">${list.map((d) => `
      <div class="dv-card ${d.is_current ? 'current' : ''}" data-id="${d.id}">
        <span class="dv-ic">${ICONS.device}</span>
        <span class="dv-main">
          <b>${esc(d.display_name)}${d.is_current ? ' · этот компьютер' : ''}</b>
          <span class="meta">${esc(d.browser)} · ${esc(d.last_ip || 'адрес неизвестен')} · был ${esc(dtRu(d.last_seen_at))}</span>
        </span>
        <span class="dv-bound">
          ${d.bound_to.length
            ? d.bound_to.map((n) => `<span class="dv-tag">${esc(n)}</span>`).join('')
            : '<span class="dv-tag free">профили не привязаны</span>'}
        </span>
        <span class="st-actions">
          <button class="pr-act" data-rename="${d.id}" title="Переименовать">${ICONS.edit}</button>
          <button class="pr-act del" data-forget="${d.id}" title="Забыть устройство">${ICONS.trash}</button>
        </span>
      </div>`).join('')}</div>`
      : '<div class="mx-empty">Пока ни одного устройства</div>'}`;

  box.querySelectorAll('[data-rename]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const dev = list.find((d) => d.id === Number(btn.dataset.rename));
      const name = prompt('Название компьютера — например «Приёмка» или «Ноутбук в цехе»:', dev.name || '');
      if (name === null) return;
      try {
        await api(`/devices/${dev.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
        toast('Название сохранено');
        renderStaffPage();
      } catch (e) { toast(e.message, true); }
    });
  });

  box.querySelectorAll('[data-forget]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const dev = list.find((d) => d.id === Number(btn.dataset.forget));
      const ok = await askConfirm({
        eyebrow: 'Устройства',
        title: 'Забыть компьютер?',
        text: `Устройство <b>${esc(dev.display_name)}</b> будет удалено из списка.`,
        note: dev.bound_to.length
          ? `К нему привязаны профили: ${dev.bound_to.join(', ')}. Они станут недоступны, пока вы не привяжете их заново.`
          : '',
        yes: 'Забыть',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/devices/${dev.id}`, { method: 'DELETE' });
        toast('Устройство забыто');
        renderStaffPage();
      } catch (e) { toast(e.message, true); }
    });
  });
}

/* ---------------------------------------------------- сотрудники (staff.manage) */
const PRESETS = {
  reception: {
    title: 'Приёмщик',
    hint: 'Принимает заказы, ведёт клиентов, цены видит',
    keys: ['orders.view', 'orders.create', 'orders.edit', 'orders.status',
           'orders.price.view', 'orders.price.edit', 'orders.estimate',
           'clients.view', 'clients.search', 'clients.history'],
  },
  production: {
    title: 'Производство',
    hint: 'Двигает заказы по статусам, денег не видит',
    keys: ['orders.view', 'orders.status'],
  },
  senior: {
    title: 'Старший смены',
    hint: 'Всё по заказам плюс итоги и прайс на просмотр',
    keys: ['orders.view', 'orders.create', 'orders.edit', 'orders.status', 'orders.delete',
           'orders.price.view', 'orders.price.edit', 'orders.estimate', 'finance.totals',
           'clients.view', 'clients.search', 'clients.history', 'prices.view'],
  },
  none: { title: 'Снять все', hint: '', keys: [] },
};

async function renderStaffPage() {
  const box = $('#staffContent');
  box.innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow"><span class="reg"><i></i></span> Настройки</div>
      <h1>${state.staffTab === 'devices' ? 'Устройства' : 'Сотрудники'}</h1>
    </div>
    <div class="mx-tabs" id="staffTabs">
      <button data-tab="people" class="${state.staffTab === 'devices' ? '' : 'active'}">Профили</button>
      <button data-tab="devices" class="${state.staffTab === 'devices' ? 'active' : ''}">Устройства</button>
    </div>
    <div id="staffBody"><div class="mx-empty">Загружаю…</div></div>`;

  $('#staffTabs').querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.staffTab = btn.dataset.tab;
      renderStaffPage();
    });
  });

  const body = $('#staffBody');
  if (state.staffTab === 'devices') {
    renderDevices(body);
    return;
  }

  let list;
  try {
    [list, state.permCatalog, state.devices] = await Promise.all([
      api('/employees'),
      state.permCatalog ? Promise.resolve(state.permCatalog) : api('/employees/permissions'),
      api('/devices'),
    ]);
  } catch (e) {
    body.innerHTML = `<div class="mx-empty">${esc(e.message)}</div>`;
    return;
  }
  state.staff = list;

  const permTitle = (key) => {
    for (const g of state.permCatalog.groups) {
      const found = g.items.find((i) => i.key === key);
      if (found) return found;
    }
    return null;
  };

  const deviceName = (id) => {
    const dev = (state.devices || []).find((d) => d.id === id);
    return dev ? dev.display_name : `устройство #${id}`;
  };

  body.innerHTML = `
    <p class="sub" style="margin-bottom:18px">
      У каждого профиля своё имя, права и список компьютеров, с которых в него можно войти.
      Права и привязка проверяются на сервере — изменения действуют сразу, перезаходить не нужно.
    </p>
    <div class="page-actions" style="margin-bottom:22px">
      <button class="btn btn-green" id="stAdd" type="button">+ Новый профиль</button>
    </div>

    <div class="st-list">
      ${list.map((e) => {
        const perms = e.permissions.map(permTitle).filter(Boolean);
        return `
        <div class="st-card ${e.active ? '' : 'off'}" data-id="${e.id}">
          <div class="st-top">
            <span class="st-av">${esc(initials(e.name))}</span>
            <span class="st-name">
              <b>${esc(e.name)}</b>
              <span>${esc(e.note || 'без описания')}${e.last_login_at ? ` · заходил ${esc(dtRu(e.last_login_at))}` : ' · ещё не заходил'}</span>
            </span>
            <span class="st-badge ${e.access_mode === 'devices' ? 'on' : ''}">${
              e.access_mode === 'devices'
                ? (e.allowed_devices.length
                    ? esc(e.allowed_devices.map(deviceName).join(', '))
                    : 'привязан, но устройств нет')
                : 'с любого компьютера'}</span>
            ${e.has_password ? '<span class="st-badge on">пароль</span>' : ''}
            <span class="st-badge">${e.permissions.length} ${plural(e.permissions.length, 'право', 'права', 'прав')}</span>
            ${e.active ? '' : '<span class="st-badge warn">отключён</span>'}
            <span class="st-actions">
              <button class="pr-act" data-edit="${e.id}" title="Настроить">${ICONS.edit}</button>
              <button class="pr-act" data-toggle="${e.id}" title="${e.active ? 'Отключить' : 'Включить'}">${e.active ? ICONS.eye : ICONS.eyeOff}</button>
              <button class="pr-act del" data-del="${e.id}" title="Удалить">${ICONS.trash}</button>
            </span>
          </div>
          <div class="st-perms">
            ${perms.length
              ? perms.map((pm) => `<span class="st-perm ${pm.danger ? 'danger' : ''}">${esc(pm.title)}</span>`).join('')
              : '<span class="st-none">Прав нет — сотрудник не увидит ничего</span>'}
          </div>
        </div>`;
      }).join('')}
    </div>`;

  $('#stAdd').addEventListener('click', () => openStaffEditor(null));
  body.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openStaffEditor(list.find((e) => e.id === Number(btn.dataset.edit))));
  });
  body.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const emp = list.find((e) => e.id === Number(btn.dataset.toggle));
      try {
        await api(`/employees/${emp.id}`, { method: 'PATCH', body: JSON.stringify({ active: !emp.active }) });
        toast(emp.active ? `${emp.name} отключён` : `${emp.name} снова активен`);
        renderStaffPage();
      } catch (e) { toast(e.message, true); }
    });
  });
  body.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const emp = list.find((e) => e.id === Number(btn.dataset.del));
      const ok = await askConfirm({
        eyebrow: 'Сотрудники',
        title: 'Удалить профиль?',
        text: [
          `Профиль <b>${esc(emp.name)}</b> будет удалён без возможности вернуть.`,
          'Заказы, которые он принял, останутся — имя в них хранится текстом.',
        ],
        note: 'Если сотрудник ушёл временно, профиль лучше отключить, а не удалять.',
        yes: 'Удалить',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/employees/${emp.id}`, { method: 'DELETE' });
        toast('Профиль удалён');
        renderStaffPage();
      } catch (e) { toast(e.message, true); }
    });
  });
}

/** Окно настройки профиля: имя, пароль, права по разделам. */
function openStaffEditor(employee) {
  const isNew = !employee;
  const current = new Set(employee ? employee.permissions : state.permCatalog.defaults);
  let mode = employee ? (employee.access_mode || 'any') : 'any';
  const boundDevices = new Set(employee ? (employee.allowed_devices || []) : []);

  const body = `
    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Профиль</h3>
      <div class="grid">
        <div class="field"><label for="st_name">Имя сотрудника</label>
          <input id="st_name" type="text" value="${esc(employee ? employee.name : '')}" placeholder="Как показывать на входе"></div>
        <div class="field"><label for="st_note">Описание</label>
          <input id="st_note" type="text" value="${esc(employee ? employee.note : '')}" placeholder="Например: приём заказов"></div>
      </div>
    </div>

    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Откуда можно входить</h3>
      <div class="mode-row">
        <button type="button" class="mode-btn ${mode === 'any' ? 'on' : ''}" data-mode="any">
          <b>С любого компьютера</b>
          <span>Профиль виден на всех рабочих местах.</span>
        </button>
        <button type="button" class="mode-btn ${mode === 'devices' ? 'on' : ''}" data-mode="devices">
          <b>Только с выбранных</b>
          <span>С других компьютеров профиль не появится в списке.</span>
        </button>
      </div>

      <div class="dev-pick" id="devPick" ${mode === 'devices' ? '' : 'hidden'}>
        ${(state.devices || []).length
          ? (state.devices || []).map((d) => `
            <label class="dev-opt ${d.is_current ? 'now' : ''}">
              <input type="checkbox" data-device="${d.id}" ${boundDevices.has(d.id) ? 'checked' : ''}>
              <span class="txt">
                <b>${esc(d.display_name)}</b>
                <span>${esc(d.browser)} · ${esc(d.last_ip || 'адрес неизвестен')}</span>
              </span>
            </label>`).join('')
          : '<div class="mx-empty">Устройств пока нет. Откройте систему на нужном компьютере — он появится в списке.</div>'}
      </div>
      <div class="hint" style="margin-top:10px">
        Компьютер запоминается по ключу в браузере. Очистка данных сайта или другой
        браузер на том же компьютере = новое устройство, привязку нужно обновить.
      </div>
    </div>

    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Пароль <span style="color:var(--muted);font-weight:400">— необязательно</span></h3>
      <div class="field">
        <input id="st_pass" type="text" autocomplete="off" placeholder="${isNew ? 'Пусто — вход без пароля' : 'Пусто — оставить прежний'}">
        <div class="hint">${isNew
          ? 'Второй рубеж поверх привязки к компьютеру. Если рабочее место используют несколько человек — пароль стоит задать.'
          : employee.has_password
            ? 'Текущий пароль посмотреть нельзя, только задать новый. Чтобы убрать пароль — впишите минус.'
            : 'Сейчас профиль без пароля.'}</div>
      </div>
    </div>

    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Быстрый набор прав</h3>
      <div class="perm-presets">
        ${Object.entries(PRESETS).map(([key, preset]) => `
          <button type="button" data-preset="${key}" title="${esc(preset.hint)}">${esc(preset.title)}</button>`).join('')}
      </div>
    </div>

    ${state.permCatalog.groups.map((g) => `
      <div class="perm-group">
        <h4><span class="reg"><i></i></span> ${esc(g.title)}</h4>
        ${g.items.map((item) => `
          <label class="perm-row ${item.danger ? 'danger' : ''}">
            <input type="checkbox" data-perm="${esc(item.key)}" ${current.has(item.key) ? 'checked' : ''}>
            <span class="txt">
              <b>${esc(item.title)}</b>
              <span>${esc(item.hint)}</span>
            </span>
          </label>`).join('')}
      </div>`).join('')}`;

  const foot = `
    <button class="btn btn-ghost" id="stCancel" type="button">Отмена</button>
    <div class="spacer"></div>
    <button class="btn btn-green" id="stSave" type="button">${isNew ? 'Создать профиль' : 'Сохранить'}</button>`;

  openModal({
    eyebrow: isNew ? 'Новый профиль' : `Настройка · ${employee.name}`,
    title: isNew ? 'Сотрудник' : employee.name,
    body,
    foot,
  });

  $('#modalBody').querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode;
      $('#modalBody').querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
      $('#devPick').hidden = mode !== 'devices';
    });
  });

  $('#modalBody').querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const keys = new Set(PRESETS[btn.dataset.preset].keys);
      $('#modalBody').querySelectorAll('[data-perm]').forEach((cb) => {
        cb.checked = keys.has(cb.dataset.perm);
      });
    });
  });

  $('#stCancel').addEventListener('click', closeModal);
  $('#stSave').addEventListener('click', async () => {
    const name = $('#st_name').value.trim();
    if (!name) { toast('Укажите имя сотрудника', true); return; }

    const permissions = [...$('#modalBody').querySelectorAll('[data-perm]')]
      .filter((cb) => cb.checked)
      .map((cb) => cb.dataset.perm);

    const passRaw = $('#st_pass').value;
    const allowed = [...$('#modalBody').querySelectorAll('[data-device]')]
      .filter((cb) => cb.checked)
      .map((cb) => Number(cb.dataset.device));

    if (mode === 'devices' && !allowed.length) {
      toast('Выберите хотя бы один компьютер — иначе в профиль не войти', true);
      return;
    }

    const payload = {
      name,
      note: $('#st_note').value.trim(),
      permissions,
      access_mode: mode,
      allowed_devices: allowed,
    };

    if (isNew) {
      payload.password = passRaw;
    } else if (passRaw === '-') {
      payload.password = '';        // явное снятие пароля
    } else if (passRaw) {
      payload.password = passRaw;
    }

    try {
      if (isNew) await api('/employees', { method: 'POST', body: JSON.stringify(payload) });
      else await api(`/employees/${employee.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast(isNew ? `Профиль «${name}» создан` : 'Сохранено');
      closeModal();
      renderStaffPage();
    } catch (e) {
      toast(e.message, true);
    }
  });
}

/* ---------------------------------------------------- виды работ (конструктор) */
/* Здесь администратор собирает форму заказа: какие поля спрашивать и как
 * каждое влияет на цену. Поля-списки берут варианты из разделов прайса —
 * добавили материал в прайс, он появился в форме заказа. */

async function renderWorksPage() {
  const box = $('#worksContent');
  box.innerHTML = '<div class="mx-empty">Загружаю…</div>';

  let list;
  try {
    [list, state.worksMeta, state.prices] = await Promise.all([
      api('/templates'),
      state.worksMeta ? Promise.resolve(state.worksMeta) : api('/templates/meta'),
      api('/prices'),
    ]);
  } catch (e) {
    box.innerHTML = `<div class="mx-empty">${esc(e.message)}</div>`;
    return;
  }
  state.works = list;

  const editable = can('prices.edit');
  const roleTitle = (key) => (state.worksMeta.roles.find((r) => r.key === key) || {}).title || key;

  box.innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow"><span class="reg"><i></i></span> Настройки</div>
      <h1>Виды работ</h1>
      <p class="sub">
        То, что сотрудник выбирает первым шагом при создании заказа. У каждого вида
        свой набор полей: списки материалов подтягиваются из разделов прайса, а роль
        поля определяет, как оно влияет на цену. Формулы писать не нужно.
      </p>
      ${editable ? `<div class="page-actions">
        <button class="btn btn-green" id="wkAdd" type="button">+ Новый вид работ</button>
      </div>` : ''}
    </div>

    <div class="st-list">
      ${list.map((t) => `
        <div class="st-card ${t.active ? '' : 'off'}" data-id="${t.id}">
          <div class="st-top">
            <span class="st-av">${ICONS[t.icon] || ICONS.printer}</span>
            <span class="st-name">
              <b>${esc(t.title)}</b>
              <span>${esc(t.hint || 'без описания')} · ${t.orders_count} ${plural(t.orders_count, 'заказ', 'заказа', 'заказов')}</span>
            </span>
            <span class="st-badge">${t.fields.length} ${plural(t.fields.length, 'поле', 'поля', 'полей')}</span>
            ${t.active ? '' : '<span class="st-badge warn">скрыт</span>'}
            ${editable ? `<span class="st-actions">
              <button class="pr-act" data-edit="${t.id}" title="Настроить">${ICONS.edit}</button>
              <button class="pr-act" data-hide="${t.id}" title="${t.active ? 'Скрыть' : 'Показать'}">${t.active ? ICONS.eye : ICONS.eyeOff}</button>
              <button class="pr-act del" data-del="${t.id}" title="Удалить">${ICONS.trash}</button>
            </span>` : ''}
          </div>
          <div class="st-perms">
            ${t.fields.map((f) => `
              <span class="st-perm ${f.pricing_role !== 'none' ? '' : 'muted'}">${esc(f.label)}${
                f.pricing_role !== 'none' ? ` · ${esc(roleTitle(f.pricing_role))}` : ''}</span>`).join('')
              || '<span class="st-none">Полей нет</span>'}
          </div>
        </div>`).join('')}
    </div>`;

  if (!editable) return;
  $('#wkAdd').addEventListener('click', () => openWorkEditor(null));
  box.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openWorkEditor(list.find((t) => t.id === Number(btn.dataset.edit))));
  });
  box.querySelectorAll('[data-hide]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tpl = list.find((t) => t.id === Number(btn.dataset.hide));
      try {
        await api(`/templates/${tpl.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...templatePayload(tpl), active: !tpl.active }),
        });
        toast(tpl.active ? `«${tpl.title}» скрыт` : `«${tpl.title}» снова доступен`);
        renderWorksPage();
      } catch (e) { toast(e.message, true); }
    });
  });
  box.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tpl = list.find((t) => t.id === Number(btn.dataset.del));
      const ok = await askConfirm({
        eyebrow: 'Виды работ',
        title: 'Удалить вид работ?',
        text: `<b>${esc(tpl.title)}</b> исчезнет из списка при создании заказа.`,
        note: tpl.orders_count
          ? `По нему уже есть заказы (${tpl.orders_count}) — удалить не получится, можно только скрыть.`
          : 'Ненужный вид работ можно скрыть — тогда он останется в настройках.',
        yes: 'Удалить',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/templates/${tpl.id}`, { method: 'DELETE' });
        toast('Вид работ удалён');
        renderWorksPage();
      } catch (e) { toast(e.message, true); }
    });
  });
}

function templatePayload(tpl) {
  return {
    title: tpl.title,
    short: tpl.short,
    hint: tpl.hint,
    icon: tpl.icon,
    quantity_label: tpl.quantity_label,
    active: tpl.active,
    fields: tpl.fields.map((f) => ({
      key: f.key, label: f.label, type: f.type, source: f.source,
      price_group: f.price_group, options: f.options, default_value: String(f.default_value ?? ''),
      pricing_role: f.pricing_role, price_item: f.price_item,
      unit: f.unit || 'мм', source_field: f.source_field || '', required: f.required,
    })),
  };
}

/** Окно конструктора: шапка вида работ + список полей. */
function openWorkEditor(tpl) {
  const isNew = !tpl;
  // рабочая копия — правим её, сохраняем одним запросом
  const draft = isNew
    ? { title: '', short: '', hint: '', icon: 'printer', quantity_label: 'Количество, шт', active: true, fields: [] }
    : JSON.parse(JSON.stringify(templatePayload(tpl)));

  // приводим сохранённые поля в порядок: роль, которая не может работать при
  // текущем типе и источнике, снимается — иначе она «залипает» невидимкой
  // и выдаёт предупреждения, которых человек не может объяснить
  draft.fields.forEach((f) => {
    const kind = FIELD_KINDS.find((k) => k.match(f));
    if (!kind) return;
    const allowed = kind.money ? rolesFor(kind.key).map((r) => r.key) : [kind.apply.pricing_role];
    if (!allowed.includes(f.pricing_role)) f.pricing_role = allowed[0];
  });

  const render = () => {
    currentDraft = draft;
    const body = `
      <div class="form-sec">
        <h3><span class="reg"><i></i></span> Вид работ</h3>
        <div class="grid">
          <div class="field"><label for="wk_title">Название</label>
            <input id="wk_title" type="text" value="${esc(draft.title)}" placeholder="Например: Лазерная гравировка"></div>
          <div class="field"><label for="wk_short">Метка на карточке</label>
            <input id="wk_short" type="text" value="${esc(draft.short)}" placeholder="Коротко: Гравировка"></div>
        </div>
        <div class="grid one" style="margin-top:13px">
          <div class="field"><label for="wk_hint">Описание</label>
            <input id="wk_hint" type="text" value="${esc(draft.hint)}" placeholder="Что это за работа"></div>
        </div>
        <div class="field" style="margin-top:13px">
          <label>Иконка</label>
          <div class="icon-row">
            ${['printer','doc','blade','roll','card'].map((ic) => `
              <button type="button" class="icon-pick ${draft.icon === ic ? 'on' : ''}" data-icon="${ic}">${ICONS[ic] || ICONS.printer}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="form-sec">
        <h3><span class="reg"><i></i></span> Поля формы заказа</h3>
        <p class="pr-hint">
          Это то, что сотрудник заполнит при создании заказа. Поля считаются сверху вниз,
          поэтому коэффициент умножает только то, что стоит выше него.
        </p>
        <div class="wk-fields">
          ${quantityRow(draft)}
          ${draft.fields.map((f, i) => fieldRow(f, i, draft.fields.length)).join('')
            || '<div class="mx-empty">Полей пока нет. Начните с материала — он даст цену.</div>'}
        </div>
        <button class="btn btn-ghost" id="wkAddField" type="button" style="margin-top:12px">+ Добавить поле</button>
      </div>

      <div class="form-sec">
        <h3><span class="reg"><i></i></span> Проверка расчёта</h3>
        <p class="pr-hint">
          Посчитайте пример по текущим настройкам — сразу видно, работает ли цена.
          Вид работ для этого сохранять не нужно.
        </p>
        <div class="wk-test">
          <label class="wk-cell">
            <span>Количество</span>
            <input type="number" id="wkTestQty" min="1" value="${state.testQty || 1}">
          </label>
          ${draft.fields
            .filter((f) => ['width', 'height', 'length'].includes(f.pricing_role))
            .map((f) => `
              <label class="wk-cell">
                <span>${esc(f.label || 'размер')}, ${esc(f.unit || 'мм')}</span>
                <input type="number" step="any" data-test="${esc(f.key || f.label)}"
                       value="${esc(f.default_value || ((f.unit || 'мм') === 'м' ? 1 : 1000))}">
              </label>`).join('')}
          <button class="btn btn-ghost" id="wkTest" type="button">Посчитать пример</button>
        </div>
        <div class="calc-lines" id="wkTestOut"></div>
      </div>`;

    $('#modalBody').innerHTML = body;
    bindWorkEditor(draft, render);
  };

  openModal({
    eyebrow: isNew ? 'Новый вид работ' : `Настройка · ${tpl.title}`,
    title: isNew ? 'Вид работ' : tpl.title,
    body: '',
    foot: `
      <button class="btn btn-ghost" id="wkCancel" type="button">Отмена</button>
      <div class="spacer"></div>
      <button class="btn btn-green" id="wkSave" type="button">${isNew ? 'Создать' : 'Сохранить'}</button>`,
  });
  $('#modal').classList.add('wide');
  render();

  $('#wkCancel').addEventListener('click', closeModal);
  $('#wkSave').addEventListener('click', async () => {
    collectWork(draft);
    if (!draft.title.trim()) { toast('Укажите название вида работ', true); return; }

    // не даём сохранить набор, который не будет работать
    const problems = [];
    const named = (f, i) => `«${f.label.trim() || `поле ${i + 1}`}»`;

    draft.fields.forEach((f, i) => {
      const kind = FIELD_KINDS.find((k) => k.match(f));
      if (!f.label.trim()) problems.push(`${named(f, i)}: не заполнена подпись`);
      if (kind?.money && !f.price_group) problems.push(`${named(f, i)}: не выбран раздел прайса`);
      if (f.type === 'bool' && f.price_group && !f.price_item) {
        problems.push(`${named(f, i)}: не выбрана позиция прайса`);
      }
      if (f.type === 'select' && f.source === 'list' && !(f.options || []).length) {
        problems.push(`${named(f, i)}: не заданы варианты`);
      }
    });

    const paying = draft.fields.filter((f) => PAYING_ROLES.includes(f.pricing_role));

    // у каждой роли свои требования к полям размеров
    const present = new Set(draft.fields.map((f) => f.pricing_role));
    Object.entries(SIZE_REQUIREMENTS).forEach(([role, needed]) => {
      if (!present.has(role)) return;
      const missing = needed.filter((r) => !present.has(r));
      if (!missing.length) return;
      const titles = { width: '«Ширина»', height: '«Высота»', length: '«Длина изделия»' };
      problems.push(`не хватает полей: ${missing.map((r) => titles[r]).join(' и ')}`);
    });

    if (problems.length) {
      toast(problems[0], true);
      return;
    }
    if (!paying.length) {
      const ok = await askConfirm({
        eyebrow: 'Виды работ',
        title: 'Сохранить без расчёта цены?',
        text: 'Ни одно поле не влияет на цену — кнопка «Рассчитать» в заказе ничего не покажет, стоимость придётся ставить руками.',
        note: 'Так тоже можно: не для всех работ есть прайс.',
        yes: 'Сохранить',
        no: 'Вернуться',
      });
      if (!ok) return;
    }

    // служебные поля конструктора наружу не отдаём
    const payload = {
      ...draft,
      fields: draft.fields.map(({ _new, _title, _value, ...rest }) => rest),
    };

    try {
      if (isNew) await api('/templates', { method: 'POST', body: JSON.stringify(payload) });
      else await api(`/templates/${tpl.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast(isNew ? `«${draft.title}» создан` : 'Сохранено');
      closeModal();
      await reloadCatalog();   // доска и форма заказа должны увидеть правку сразу
      renderWorksPage();
    } catch (e) {
      toast(e.message, true);
    }
  });
}

/* Виды полей — то, как о них думает администратор.
 * Каждый вид разворачивается в тройку (тип, источник, роль), которой оперирует
 * движок расчёта. Так человеку не нужно знать про устройство системы:
 * он отвечает на один вопрос «что это за поле», остальное подставляется само. */
const FIELD_KINDS = [
  {
    key: 'price_choice',
    title: 'Выбор из прайса — влияет на цену',
    hint: 'Материал, бумага, формат. Сотрудник выбирает из списка, цена берётся из прайса.',
    apply: { type: 'select', source: 'price', pricing_role: 'per_unit' },
    match: (f) => f.type === 'select' && f.source === 'price',
    money: true,
    roles: true,
  },
  {
    key: 'option_paid',
    title: 'Доплата галочкой',
    hint: 'Включил — прибавилось. Ламинация, люверсы, оклейка на объекте.',
    apply: { type: 'bool', source: 'price', pricing_role: 'per_order' },
    match: (f) => f.type === 'bool',
    money: true,
  },
  {
    key: 'width',
    title: 'Ширина изделия, мм',
    hint: 'Нужна, чтобы считать площадь и периметр. Сотрудник вводит число.',
    apply: { type: 'number', source: 'list', pricing_role: 'width', price_group: '' },
    match: (f) => f.pricing_role === 'width',
  },
  {
    key: 'height',
    title: 'Высота изделия, мм',
    hint: 'Вторая сторона для площади и периметра.',
    apply: { type: 'number', source: 'list', pricing_role: 'height', price_group: '' },
    match: (f) => f.pricing_role === 'height',
  },
  {
    key: 'length',
    title: 'Длина изделия, мм',
    hint: 'Когда считаем по длине: резка кромки, кант, погонаж. Второе измерение не нужно.',
    apply: { type: 'number', source: 'list', pricing_role: 'length', price_group: '' },
    match: (f) => f.pricing_role === 'length',
  },
  {
    key: 'choice',
    title: 'Выбор из своего списка — без цены',
    hint: 'Пометка для производства: тип изделия, вариант раскладки.',
    apply: { type: 'select', source: 'list', pricing_role: 'none', price_group: '' },
    match: (f) => f.type === 'select' && f.source === 'list',
  },
  {
    key: 'number_info',
    title: 'Число — без цены',
    hint: 'Количество сгибов, номер станка. Просто записывается в заказ.',
    apply: { type: 'number', source: 'list', pricing_role: 'none', price_group: '' },
    match: (f) => f.type === 'number',
  },
  {
    key: 'note',
    title: 'Текстовая заметка',
    hint: 'Свободная строка: что гравируем, номер макета.',
    apply: { type: 'text', source: 'list', pricing_role: 'none', price_group: '' },
    match: (f) => f.type === 'text',
  },
];

/* Как считать — показывается только у полей, влияющих на цену.
 * kinds ограничивает, каким видам поля роль подходит. */
const MONEY_ROLES = [
  { key: 'per_order', title: 'Один раз за заказ', kinds: ['price_choice', 'option_paid'] },
  { key: 'per_unit', title: 'Умножить на количество', kinds: ['price_choice', 'option_paid'] },
  { key: 'per_sqm', title: 'Умножить на площадь', kinds: ['price_choice', 'option_paid'] },
  { key: 'per_m', title: 'Умножить на периметр', kinds: ['price_choice', 'option_paid'] },
  { key: 'per_length', title: 'Умножить на длину (пог. м)', kinds: ['price_choice', 'option_paid'] },
  { key: 'step_per_unit', title: 'Цена по ступеням тиража', kinds: ['price_choice'] },
  { key: 'multiplier', title: 'Коэффициент — умножит всё выше', kinds: ['price_choice', 'option_paid'] },
];

const rolesFor = (kindKey) => MONEY_ROLES.filter((r) => r.kinds.includes(kindKey));

/* Роли, которые дают сумму. Считаются из MONEY_ROLES, а не перечисляются
 * руками: иначе новая роль забудется в проверках — так уже случилось
 * с «Умножить на длину». Коэффициент сюда не входит: сам по себе он
 * ничего не добавляет, только множит то, что выше. */
const PAYING_ROLES = MONEY_ROLES.map((r) => r.key).filter((k) => k !== 'multiplier');
/* Роли, которым нужны размеры: какие именно — во втором элементе. */
const SIZE_REQUIREMENTS = {
  per_sqm: ['width', 'height'],
  per_m: ['width', 'height'],
  per_length: ['length'],
};

function kindOf(f) {
  return (FIELD_KINDS.find((k) => k.match(f)) || FIELD_KINDS[0]).key;
}

function applyKind(f, kindKey) {
  const kind = FIELD_KINDS.find((k) => k.key === kindKey) || FIELD_KINDS[0];
  Object.assign(f, kind.apply);
  if (!kind.money) { f.price_item = ''; f.price_group = f.price_group && kind.apply.source === 'price' ? f.price_group : ''; }
  if (kindKey !== 'option_paid') f.price_item = '';
  f.default_value = '';
  return kind;
}

// показываем все разделы, включая только что созданные пустые:
// иначе новый раздел пропадал бы из списка сразу после создания
const priceGroups = () => (state.prices?.groups || []).filter((g) => g.id);
const groupByKey = (key) => priceGroups().find((g) => g.key === key);

let currentDraft = null;
const lengthFieldCount = () => (currentDraft?.fields || []).filter((f) => f.pricing_role === 'length').length;
const hasRoles = (...roles) => roles.every(
  (role) => (currentDraft?.fields || []).some((x) => x.pricing_role === role));

/** Количество — встроенное поле, оно есть у любого вида работ.
 * Показываем его в общем списке, иначе администратор не видит, что оно
 * участвует в цене, и заводит второе поле с тем же смыслом. */
function quantityRow(draft) {
  const hasLength = (draft.fields || []).some((f) => f.pricing_role === 'length');
  const perLength = (draft.fields || []).some((f) => f.pricing_role === 'per_length');

  let note;
  if (hasLength || perLength) {
    note = 'Сейчас длина считается отдельным полем, значит количество — это <b>число изделий</b>. '
      + 'Например 3 детали по 2.5 м.';
  } else {
    note = 'Умножает всё, что считается «за единицу». Если продаёте погонным метром, '
      + 'напишите здесь «Погонных метров», поставьте цену в ₽/м и роль «Умножить на количество» — '
      + 'отдельное поле длины тогда не нужно.';
  }

  return `
    <div class="wk-field wk-field-fixed">
      <div class="wk-field-top">
        <span class="wk-num">№</span>
        <input class="wk-label" type="text" id="wk_qty" value="${esc(draft.quantity_label)}"
               placeholder="Количество, шт">
        <span class="wk-fixed-tag">всегда есть</span>
      </div>
      <div class="wk-kind-hint">${note}</div>
    </div>`;
}

/* Единицы, которые ждёт каждая роль. Нужно, чтобы поймать несовпадение:
 * раздел с ценой за м², умноженный на длину, даст бессмыслицу. */
const ROLE_UNITS = {
  per_unit: { units: ['₽/шт', '₽'], name: 'за штуку' },
  step_per_unit: { units: ['₽/шт', '₽'], name: 'за штуку' },
  per_sqm: { units: ['₽/м²'], name: 'за квадратный метр' },
  per_m: { units: ['₽/пог.м', '₽/м'], name: 'за погонный метр' },
  per_length: { units: ['₽/пог.м', '₽/м'], name: 'за метр длины' },
  per_order: { units: ['₽'], name: 'разовую сумму' },
  multiplier: { units: ['×'], name: 'коэффициент' },
};

/** Всё, что не так с полем — простым языком. Считается и при перерисовке,
 * и на лету, пока администратор печатает. */
function fieldWarnings(f, i) {
  const kind = FIELD_KINDS.find((k) => k.match(f)) || FIELD_KINDS[0];
  const group = groupByKey(f.price_group);
  const items = group ? group.items : [];
  const warns = [];

  if (!String(f.label || '').trim()) warns.push('впишите подпись поля');

  if (kind.money) {
    if (!f.price_group) {
      warns.push('выберите раздел прайса, иначе цены не будет');
    } else if (!items.length) {
      warns.push('в разделе пока нет позиций — создайте хотя бы одну');
    } else {
      // единицы раздела должны отвечать выбранному способу расчёта
      const expect = ROLE_UNITS[f.pricing_role];
      if (expect && group.unit && !expect.units.includes(group.unit)) {
        warns.push(`в разделе «${group.title}» цены ${group.unit}, `
          + `а вы считаете ${expect.name} — проверьте, что выбрано верно`);
      }
    }
  }

  if (f.type === 'bool' && f.price_group && items.length && !f.price_item) {
    warns.push('выберите позицию прайса');
  }
  if (f.pricing_role === 'multiplier' && i === 0) {
    warns.push('коэффициент стоит первым — умножать нечего, опустите его ниже');
  }
  if (f.pricing_role === 'step_per_unit' && group && !items.some((it) => /^\d+$/.test(it.item_key))) {
    warns.push('в разделе нет позиций-чисел вида 100, 500 — ступени не сработают');
  }
  const needed = SIZE_REQUIREMENTS[f.pricing_role] || [];
  if (needed.length && !hasRoles(...needed)) {
    const titles = { width: '«Ширина»', height: '«Высота»', length: '«Длина изделия»' };
    warns.push(`добавьте ${needed.map((r) => titles[r]).join(' и ')} — без них считать не по чему`);
  }
  return warns;
}

function fieldRow(f, i, total) {
  const kindKey = kindOf(f);
  const kind = FIELD_KINDS.find((k) => k.key === kindKey);
  const group = groupByKey(f.price_group);
  const items = group ? group.items : [];

  const warns = fieldWarnings(f, i);

  const groupSelect = `
    <label class="wk-cell">
      <span>Раздел прайса</span>
      <select data-f="price_group">
        <option value="">— выберите —</option>
        ${priceGroups().map((g) => `
          <option value="${esc(g.key)}" ${f.price_group === g.key ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}
        <option value="__new__">+ Создать новый раздел…</option>
      </select>
    </label>`;

  const roleSelect = `
    <label class="wk-cell">
      <span>Как считать</span>
      <select data-f="pricing_role">
        ${rolesFor(kindKey).map((r) => `
          <option value="${r.key}" ${f.pricing_role === r.key ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}
      </select>
    </label>`;

  // список позиций раздела + пункт «создать» — чтобы не уходить в прайс
  const itemSelect = (name, value, withValue) => `
    <label class="wk-cell">
      <span>${name === 'price_item' ? 'Позиция прайса' : 'Выбрано по умолчанию'}</span>
      <select data-f="${name}" ${f.price_group ? '' : 'disabled'}>
        <option value="">${f.price_group ? '— выберите —' : '— сначала раздел —'}</option>
        ${items.map((it) => `
          <option value="${esc(it.item_key)}" ${value === it.item_key ? 'selected' : ''}>${esc(it.title || it.item_key)}${withValue ? ` · ${it.value}` : ''}</option>`).join('')}
        ${f.price_group ? '<option value="__new__">+ Создать позицию…</option>' : ''}
      </select>
    </label>`;

  let extra = '';
  const requiredCell = `
    <label class="wk-cell">
      <span>Обязательное</span>
      <span class="wk-toggle">
        <input type="checkbox" id="req_${i}" data-f="required" ${f.required ? 'checked' : ''}>
        <label for="req_${i}">${f.required ? 'Да' : 'Нет'}</label>
      </span>
    </label>`;

  // Если в шаблоне несколько полей длины (погонаж материала и длина реза),
  // денежное поле должно знать, по какому из них считать.
  const lengthFields = (currentDraft?.fields || []).filter((x) => x.pricing_role === 'length');
  const dimCell = (f.pricing_role === 'per_length' && lengthFields.length > 1) ? `
    <label class="wk-cell">
      <span>Считать по полю</span>
      <select data-f="source_field">
        ${lengthFields.map((x, n) => `
          <option value="${esc(x.key || '')}" ${f.source_field === x.key ? 'selected' : ''}>${esc(x.label || `длина ${n + 1}`)}</option>`).join('')}
      </select>
    </label>` : '';

  if (kindKey === 'price_choice') {
    extra = `${groupSelect}${roleSelect}${dimCell}${itemSelect('default_value', f.default_value, false)}${requiredCell}`;
  } else if (kindKey === 'option_paid') {
    extra = `${groupSelect}${itemSelect('price_item', f.price_item, true)}${roleSelect}${dimCell}
      <label class="wk-cell">
        <span>Включено сразу</span>
        <span class="wk-toggle">
          <input type="checkbox" id="chk_${i}" data-f="default_value" ${f.default_value ? 'checked' : ''}>
          <label for="chk_${i}">${f.default_value ? 'Да' : 'Нет'}</label>
        </span>
      </label>`;
  } else if (kindKey === 'choice') {
    const opts = f.options || [];
    extra = `
      <label class="wk-cell wide">
        <span>Варианты через запятую</span>
        <input type="text" data-f="options" value="${esc(opts.join(', '))}" placeholder="Односторонняя, Двусторонняя">
      </label>
      <label class="wk-cell">
        <span>Выбрано по умолчанию</span>
        <select data-f="default_value">
          <option value="">${f.required ? '— первый в списке —' : '— нет —'}</option>
          ${opts.map((o) => `<option value="${esc(o)}" ${f.default_value === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
        </select>
      </label>
      ${requiredCell}`;
  } else if (kindKey === 'width' || kindKey === 'height' || kindKey === 'length') {
    extra = `
      <label class="wk-cell">
        <span>В чём вводят</span>
        <select data-f="unit">
          ${['мм', 'см', 'м'].map((u) => `
            <option value="${u}" ${(f.unit || 'мм') === u ? 'selected' : ''}>${u === 'мм' ? 'миллиметры' : u === 'см' ? 'сантиметры' : 'метры'}</option>`).join('')}
        </select>
      </label>
      <label class="wk-cell wide">
        <span>Значение по умолчанию, ${esc(f.unit || 'мм')}</span>
        <input type="number" step="any" data-f="default_value" value="${esc(f.default_value ?? '')}" placeholder="например ${(f.unit || 'мм') === 'м' ? '2.5' : '300'}">
      </label>`;
    extra += `<div class="wk-unit-note">Это только для удобства ввода: сотрудник вводит в ${esc(f.unit || 'мм')}, а цена из прайса всегда считается за метр — пересчёт автоматический.</div>`;
  } else if (kindKey === 'number_info') {
    extra = `
      <label class="wk-cell">
        <span>Значение по умолчанию</span>
        <input type="number" step="any" data-f="default_value" value="${esc(f.default_value ?? '')}" placeholder="например 2">
      </label>`;
  }

  return `
    <div class="wk-field ${warns.length ? 'has-warn' : ''}" data-i="${i}">
      <div class="wk-field-top">
        <span class="wk-num">${i + 1}</span>
        <input class="wk-label" type="text" value="${esc(f.label)}" placeholder="Подпись поля — например «Материал»" data-f="label">
        <button class="pr-act" data-up="${i}" title="Выше" ${i === 0 ? 'disabled' : ''}>${ICONS.arrowUp}</button>
        <button class="pr-act" data-down="${i}" title="Ниже" ${i === total - 1 ? 'disabled' : ''}>${ICONS.arrowDown}</button>
        <button class="pr-act del" data-rm="${i}" title="Убрать">${ICONS.trash}</button>
      </div>

      <label class="wk-kind">
        <span>Что это за поле</span>
        <select data-f="kind">
          ${FIELD_KINDS.map((k) => `
            <option value="${k.key}" ${k.key === kindKey ? 'selected' : ''}>${esc(k.title)}</option>`).join('')}
        </select>
      </label>
      <div class="wk-kind-hint">${esc(kind.hint)}</div>

      ${extra ? `<div class="wk-field-body">${extra}</div>` : ''}
      ${quickForm(f, i)}
      ${warns.length && !f._new ? `<div class="wk-warn">${warns.map((w) => `<span>${esc(w)}</span>`).join('')}</div>` : ''}
    </div>`;
}

/** Встроенная форма создания раздела или позиции прайса.
 * Открывается прямо в строке поля — уходить в раздел «Прайс» не нужно. */
function quickForm(f, i) {
  if (f._new === 'group') {
    return `
      <div class="wk-quick">
        <div class="wk-quick-title">Новый раздел прайса</div>
        <div class="wk-quick-row">
          <label class="wk-cell"><span>Название</span>
            <input type="text" data-q="title" placeholder="Например: Срочность" value="${esc(f._title || '')}"></label>
          <label class="wk-cell"><span>Единица</span>
            <select data-q="unit">
              ${['₽', '₽/шт', '₽/м²', '₽/пог.м', '×'].map((u) => `
                <option value="${u}" ${f._unit === u ? 'selected' : ''}>${u}</option>`).join('')}
            </select></label>
          <button class="btn btn-green" data-q-save="${i}" type="button">Создать</button>
          <button class="btn btn-ghost" data-q-cancel="${i}" type="button">Отмена</button>
        </div>
        <div class="wk-quick-hint">
          «×» — для коэффициентов вроде 1.5 (плюс 50%). Остальные — для сумм в рублях.
        </div>
      </div>`;
  }
  if (f._new === 'item') {
    const group = groupByKey(f.price_group);
    const factor = group && group.kind === 'factor';
    return `
      <div class="wk-quick">
        <div class="wk-quick-title">Новая позиция в разделе «${esc(group ? group.title : '')}»</div>
        <div class="wk-quick-row">
          <label class="wk-cell"><span>Название</span>
            <input type="text" data-q="title" placeholder="Например: Срочный заказ" value="${esc(f._title || '')}"></label>
          <label class="wk-cell"><span>${factor ? 'Коэффициент' : `Значение, ${esc(group ? group.unit : '₽')}`}</span>
            <input type="number" step="0.01" min="0" data-q="value" value="${esc(f._value ?? (factor ? '1.5' : '500'))}"></label>
          <button class="btn btn-green" data-q-save="${i}" type="button">Создать</button>
          <button class="btn btn-ghost" data-q-cancel="${i}" type="button">Отмена</button>
        </div>
        <div class="wk-quick-hint">
          ${factor ? '1.5 — цена вырастет наполовину, 2 — вдвое.' : 'Цену потом можно поменять в разделе «Прайс» — она подтянется сюда сама.'}
        </div>
      </div>`;
  }
  return '';
}

async function saveQuick(draft, i, render) {
  const f = draft.fields[i];
  const row = $(`.wk-field[data-i="${i}"]`);
  const title = row.querySelector('[data-q="title"]').value.trim();
  if (!title) { toast('Укажите название', true); return; }

  try {
    if (f._new === 'group') {
      const unit = row.querySelector('[data-q="unit"]').value;
      const res = await api('/prices/groups', {
        method: 'POST',
        body: JSON.stringify({ title, unit, kind: unit === '×' ? 'factor' : 'money' }),
      });
      state.prices = await api('/prices');
      collectWork(draft);
      Object.assign(draft.fields[i], { price_group: res.key, price_item: '', default_value: '' });
      toast(`Раздел «${title}» создан`);
    } else {
      const value = Number(row.querySelector('[data-q="value"]').value || 0);
      await api('/prices', {
        method: 'POST',
        body: JSON.stringify({ group_key: f.price_group, item_key: title, value }),
      });
      state.prices = await api('/prices');
      collectWork(draft);
      const target = draft.fields[i];
      if (target.type === 'bool') target.price_item = title;
      else target.default_value = title;
      toast(`«${title}» добавлена в прайс`);
    }
  } catch (e) {
    toast(e.message, true);
    return;
  }
  delete draft.fields[i]._new;
  render();
}

function collectWork(draft) {
  draft.title = $('#wk_title').value.trim();
  draft.short = $('#wk_short').value.trim();
  draft.hint = $('#wk_hint').value.trim();
  draft.quantity_label = $('#wk_qty').value.trim() || 'Количество, шт';

  $('#modalBody').querySelectorAll('.wk-field').forEach((row) => {
    const f = draft.fields[Number(row.dataset.i)];
    if (!f) return;
    if (row.querySelector('[data-q="title"]')) {
      f._title = row.querySelector('[data-q="title"]').value;
      const val = row.querySelector('[data-q="value"]');
      if (val) f._value = val.value;
    }
    row.querySelectorAll('[data-f]').forEach((el) => {
      const name = el.dataset.f;
      if (name === 'kind') return;   // вид меняется отдельным обработчиком
      if (name === 'options') f.options = el.value.split(',').map((o) => o.trim()).filter(Boolean);
      else if (el.type === 'checkbox') {
        f[name] = name === 'required' ? el.checked : (el.checked ? '1' : '');
      }
      else f[name] = el.value;
    });
  });

  // Ключ — то, под чем значение поля хранится в заказе. У существующих полей
  // он НЕ меняется: иначе переименование подписи осиротило бы данные во всех
  // уже созданных заказах. Генерируем только для новых полей.
  const used = new Set(draft.fields.map((f) => f.key).filter(Boolean));
  draft.fields.forEach((f, i) => {
    if (f.key) return;
    const base = translit(f.label || `field_${i + 1}`);
    let key = base;
    let n = 2;
    while (used.has(key)) { key = `${base}_${n}`; n += 1; }
    used.add(key);
    f.key = key;
  });
}

/** «Ширина, мм» → «shirina_mm». Ключ нужен латиницей: он попадает в данные заказа. */
function translit(value) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return (value || '').toLowerCase().split('').map((ch) => map[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';
}

function bindWorkEditor(draft, render) {
  const body = $('#modalBody');

  body.querySelectorAll('[data-icon]').forEach((btn) => {
    btn.addEventListener('click', () => { collectWork(draft); draft.icon = btn.dataset.icon; render(); });
  });

  // смена вида поля переписывает его настройки — перерисовываем строку
  body.querySelectorAll('[data-f="kind"]').forEach((el) => {
    el.addEventListener('change', () => {
      collectWork(draft);
      const i = Number(el.closest('.wk-field').dataset.i);
      applyKind(draft.fields[i], el.value);
      render();
    });
  });

  // раздел прайса меняет списки позиций и умолчаний
  body.querySelectorAll('[data-f="pricing_role"], [data-f="options"], [data-f="required"], [data-f="unit"], [data-f="source_field"]').forEach((el) => {
    el.addEventListener('change', () => { collectWork(draft); render(); });
  });

  // «+ Создать раздел» и «+ Создать позицию» — не уходя из конструктора
  body.querySelectorAll('[data-f="price_group"]').forEach((el) => {
    el.addEventListener('change', () => {
      const i = Number(el.closest('.wk-field').dataset.i);
      const wantsNew = el.value === '__new__';
      if (wantsNew) el.value = draft.fields[i].price_group || '';
      collectWork(draft);
      if (wantsNew) draft.fields[i]._new = 'group';
      render();
    });
  });

  body.querySelectorAll('[data-f="price_item"], select[data-f="default_value"]').forEach((el) => {
    el.addEventListener('change', () => {
      const i = Number(el.closest('.wk-field').dataset.i);
      const name = el.dataset.f;
      const wantsNew = el.value === '__new__';
      if (wantsNew) el.value = draft.fields[i][name] || '';
      collectWork(draft);
      if (wantsNew) draft.fields[i]._new = 'item';
      render();
    });
  });

  body.querySelectorAll('[data-q-save]').forEach((btn) => {
    btn.addEventListener('click', () => saveQuick(draft, Number(btn.dataset.qSave), render));
  });
  body.querySelectorAll('[data-q-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      collectWork(draft);
      delete draft.fields[Number(btn.dataset.qCancel)]._new;
      render();
    });
  });

  body.querySelectorAll('[data-rm]').forEach((btn) => {
    btn.addEventListener('click', () => {
      collectWork(draft);
      draft.fields.splice(Number(btn.dataset.rm), 1);
      render();
    });
  });

  const move = (from, to) => {
    collectWork(draft);
    if (to < 0 || to >= draft.fields.length) return;
    const [item] = draft.fields.splice(from, 1);
    draft.fields.splice(to, 0, item);
    render();
  };
  body.querySelectorAll('[data-up]').forEach((btn) => {
    btn.addEventListener('click', () => move(Number(btn.dataset.up), Number(btn.dataset.up) - 1));
  });
  body.querySelectorAll('[data-down]').forEach((btn) => {
    btn.addEventListener('click', () => move(Number(btn.dataset.down), Number(btn.dataset.down) + 1));
  });

  $('#wkTest').addEventListener('click', async () => {
    collectWork(draft);
    const out = $('#wkTestOut');
    const params = {};
    draft.fields.forEach((f) => {
      const test = $(`#modalBody [data-test="${f.key}"]`);
      if (test) params[f.key] = Number(test.value || 0);
      else if (f.type === 'bool') params[f.key] = !!f.default_value;
      else if (f.type === 'number') params[f.key] = Number(f.default_value || 0);
      else params[f.key] = f.default_value || (f.options || [])[0] || '';
    });
    state.testQty = Math.max(Number($('#wkTestQty').value || 1), 1);

    try {
      const res = await api('/templates/preview', {
        method: 'POST',
        body: JSON.stringify({
          quantity: state.testQty,
          params,
          fields: draft.fields,
        }),
      });
      if (res.price === null) {
        out.innerHTML = `<div class="calc-note">${esc(res.note || 'Цена не считается — проверьте поля выше')}</div>`;
      } else {
        out.innerHTML = `
          ${res.breakdown.map((l) => `<div class="calc-line"><span>${esc(l.label)}</span><span>${esc(money(l.amount))}</span></div>`).join('')}
          <div class="calc-line total"><span>Итого по прайсу</span><span>${esc(money(res.price))}</span></div>
          ${res.note ? `<div class="calc-note">${esc(res.note)}</div>` : ''}
          <div class="calc-note">Остальные поля взяты со значениями «по умолчанию».</div>`;
      }
      out.classList.add('show');
    } catch (e) {
      out.innerHTML = `<div class="calc-note">${esc(e.message)}</div>`;
      out.classList.add('show');
    }
  });

  $('#wkAddField').addEventListener('click', () => {
    collectWork(draft);
    const f = {
      key: '', label: '', type: 'select', source: 'price', price_group: '',
      options: [], default_value: '', pricing_role: 'per_unit', price_item: '',
      unit: 'мм', source_field: '', required: false,
    };
    draft.fields.push(f);
    render();
  });
}

/* ---------------------------------------------------- прайс (только админ) */
/* Страница устроена в два уровня: плитки разделов → строки внутри раздела.
 * Какой раздел открыт, хранится в state.priceGroup (null = показываем плитки). */

const PRICE_ICONS = {
  print_color_sheet: 'printer',
  print_bw_sheet: 'doc',
  paper: 'doc',
  lamination: 'roll',
  binding: 'card',
  material_sqm: 'roll',
  finish_per_m: 'blade',
  cards_base: 'card',
  cards_paper_k: 'card',
  work: 'blade',
};

async function loadPrices(force = false) {
  if (!state.prices || force) {
    state.prices = await api('/prices');
  }
  return state.prices;
}

async function renderPricesPage() {
  const box = $('#pricesContent');
  box.innerHTML = '<div class="mx-empty">Загружаю прайс…</div>';

  let data;
  try {
    data = await loadPrices(true);
  } catch (e) {
    box.innerHTML = `<div class="mx-empty">${esc(e.message)}</div>`;
    return;
  }

  if (state.priceGroup) {
    const group = data.groups.find((g) => g.key === state.priceGroup);
    if (group) { renderPriceGroup(group); return; }
    state.priceGroup = null;
  }

  const total = data.groups.reduce((acc, g) => acc + g.items.length, 0);

  box.innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow"><span class="reg"><i></i></span> Настройки</div>
      <h1>Прайс</h1>
      <p class="sub">
        ${can('prices.edit')
          ? 'Цены применяются сразу: сотрудник нажмёт «Рассчитать» в заказе и получит новую сумму. Уже созданные заказы не пересчитываются — их стоимость зафиксирована.'
          : 'Прайс открыт для просмотра. Менять цены может администратор.'}
        Всего разделов: ${data.groups.length}, позиций: ${total}.
      </p>
      ${can('prices.edit') ? `
      <div class="page-actions">
        <button class="btn btn-green" id="prAddGroup" type="button">+ Новый раздел</button>
        <button class="btn btn-ghost" id="prRestore" type="button">Восстановить недостающие</button>
      </div>` : ''}
    </div>

    <div class="pr-tiles">
      ${data.groups.map((g) => {
        const off = g.items.filter((i) => !i.active).length;
        return `
        <button class="pr-tile" data-group="${esc(g.key)}" type="button">
          <span class="top">
            <span class="ic">${ICONS[PRICE_ICONS[g.key]] || ICONS.printer}</span>
            ${g.unit ? `<span class="unit">${esc(g.unit)}</span>` : ''}
          </span>
          <b>${esc(g.title)}</b>
          <span class="desc">${esc(g.hint || '')}</span>
          <span class="foot">
            <span class="cnt">${g.items.length}</span>
            <span class="cnt-label">${plural(g.items.length, 'позиция', 'позиции', 'позиций')}</span>
            ${off ? `<span class="off-cnt">${off} откл.</span>` : ''}
          </span>
        </button>`;
      }).join('')}
    </div>`;

  box.querySelectorAll('.pr-tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      state.priceGroup = tile.dataset.group;
      renderPricesPage();
      $('#pagePrices').scrollTop = 0;
    });
  });
  const addGroupBtn = $('#prAddGroup');
  if (addGroupBtn) addGroupBtn.addEventListener('click', () => openGroupEditor(null));

  const restoreBtn = $('#prRestore');
  if (restoreBtn) restoreBtn.addEventListener('click', async () => {
    try {
      const res = await api('/prices/restore-defaults', { method: 'POST' });
      toast(res.added ? `Добавлено позиций: ${res.added}` : 'Всё на месте, добавлять нечего');
      if (res.added) renderPricesPage();
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function renderPriceGroup(group) {
  const box = $('#pricesContent');
  const editable = can('prices.edit');

  // без права правки строки рисуются текстом: ни полей ввода, ни кнопок
  const rows = group.items.map((it) => (editable ? `
      <div class="pr-row ${it.active ? '' : 'off'}" data-id="${it.id}">
        <span class="nm">
          <input type="text" value="${esc(it.title)}" data-field="title" aria-label="Название позиции">
          <span class="key">${esc(it.item_key)}${it.updated_by ? ` · менял ${esc(it.updated_by)}` : ''}</span>
        </span>
        <input class="val" type="number" step="0.01" min="0" value="${it.value}" data-field="value" aria-label="Значение">
        <button class="pr-act" data-toggle="${it.id}" title="${it.active ? 'Отключить' : 'Включить'}" type="button">
          ${it.active ? ICONS.eye : ICONS.eyeOff}
        </button>
        <button class="pr-act del" data-del="${it.id}" title="Удалить" type="button">${ICONS.trash}</button>
      </div>` : `
      <div class="pr-row read ${it.active ? '' : 'off'}">
        <span class="nm">
          <b>${esc(it.title)}</b>
          <span class="key">${esc(it.item_key)}${it.active ? '' : ' · отключена'}</span>
        </span>
        <span class="val-read">${esc(formatRate(it.value, group.unit))}</span>
      </div>`)).join('');

  box.innerHTML = `
    <button class="pr-back" id="prBack" type="button">${ICONS.arrow} Все разделы прайса</button>

    <div class="page-head">
      <div class="page-eyebrow"><span class="reg"><i></i></span> Прайс${group.unit ? ` · ${esc(group.unit)}` : ''}</div>
      <h1>${esc(group.title)}</h1>
      ${group.hint ? `<p class="sub">${esc(group.hint)}</p>` : ''}
      ${editable ? `
      <div class="page-actions">
        <button class="btn btn-green" id="prAddBtn" type="button">+ Добавить позицию</button>
        <button class="btn btn-ghost" id="prEditGroup" type="button">Настроить раздел</button>
        ${group.system || group.in_use ? '' : '<button class="btn btn-danger" id="prDelGroup" type="button">Удалить раздел</button>'}
      </div>` : ''}
    </div>

    ${editable ? `
    <div class="pr-note">
      Ключ позиции должен совпадать с вариантом в шаблоне заказа, иначе расчёт её не найдёт.
      Название можно менять свободно. Значение сохраняется по Enter или когда уходите из поля.
    </div>

    <div class="pr-add" id="prAddForm" hidden>
      <div class="field"><label>Ключ (как в шаблоне заказа)</label>
        <input type="text" data-new="key" placeholder="Например: Баннер 650 г"></div>
      <div class="field"><label>Название</label>
        <input type="text" data-new="title" placeholder="Можно оставить пустым"></div>
      <div class="field small"><label>Значение</label>
        <input type="number" data-new="value" step="0.01" min="0" value="0"></div>
      <button class="btn btn-green" id="prSaveNew" type="button">Добавить</button>
    </div>` : `
    <div class="pr-note">Только просмотр. Изменение цен доступно администратору.</div>`}

    ${group.items.length ? `<div class="pr-rows">${rows}</div>`
      : '<div class="mx-empty">В разделе пока нет позиций</div>'}`;

  $('#prBack').addEventListener('click', () => {
    state.priceGroup = null;
    renderPricesPage();
    $('#pagePrices').scrollTop = 0;
  });

  if (!editable) return;   // дальше только обработчики правки

  $('#prEditGroup').addEventListener('click', () => openGroupEditor(group));
  const delGroup = $('#prDelGroup');
  if (delGroup) delGroup.addEventListener('click', async () => {
    const ok = await askConfirm({
      eyebrow: 'Прайс',
      title: 'Удалить раздел?',
      text: [
        `Раздел <b>${esc(group.title)}</b> будет удалён.`,
        `Вместе с ним пропадут все его позиции — ${group.items.length} ${plural(group.items.length, 'штука', 'штуки', 'штук')}.`,
      ],
      yes: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/prices/groups/${group.id}`, { method: 'DELETE' });
      toast('Раздел удалён');
      state.priceGroup = null;
      renderPricesPage();
    } catch (e) { toast(e.message, true); }
  });

  $('#prAddBtn').addEventListener('click', () => {
    const form = $('#prAddForm');
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('[data-new="key"]').focus();
  });
  $('#prSaveNew').addEventListener('click', () => savePriceItem(group.key));
  bindPriceRows(group.key);
}

/** «700 ₽/м²» — значение с единицей измерения раздела. */
function formatRate(value, unit) {
  const num = new Intl.NumberFormat('ru-RU').format(value);
  if (!unit) return num;
  if (unit === '×') return `× ${num}`;
  return `${num} ${unit.replace('₽', '₽')}`;
}

async function savePriceItem(groupKey) {
  const form = $('#prAddForm');
  const key = form.querySelector('[data-new="key"]').value.trim();
  if (!key) { toast('Укажите ключ позиции', true); return; }
  try {
    await api('/prices', {
      method: 'POST',
      body: JSON.stringify({
        group_key: groupKey,
        item_key: key,
        title: form.querySelector('[data-new="title"]').value.trim(),
        value: Number(form.querySelector('[data-new="value"]').value || 0),
        author: state.userName,
      }),
    });
    toast(`«${key}» добавлена в прайс`);
    renderPricesPage();
  } catch (e) {
    toast(e.message, true);
  }
}

function bindPriceRows() {
  const box = $('#pricesContent');

  box.querySelectorAll('.pr-row [data-field]').forEach((input) => {
    input.dataset.was = input.value;
    const save = async () => {
      const row = input.closest('.pr-row');
      const field = input.dataset.field;
      const value = field === 'value' ? Number(input.value || 0) : input.value.trim();
      if (String(value) === input.dataset.was) return;
      try {
        await api(`/prices/${row.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ [field]: value, author: state.userName }),
        });
        input.dataset.was = String(value);
        state.prices = null;  // прайс изменился — перечитаем при следующем открытии
        if (field === 'value') {
          input.classList.add('saved');
          setTimeout(() => input.classList.remove('saved'), 900);
        }
      } catch (e) {
        toast(e.message, true);
      }
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  });

  box.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.pr-row');
      const active = !row.classList.contains('off');
      try {
        await api(`/prices/${btn.dataset.toggle}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: !active }),
        });
        row.classList.toggle('off');
        btn.innerHTML = active ? ICONS.eyeOff : ICONS.eye;
        btn.title = active ? 'Включить' : 'Отключить';
        state.prices = null;
      } catch (e) {
        toast(e.message, true);
      }
    });
  });

  box.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.pr-row');
      const name = row.querySelector('[data-field="title"]').value;
      const ok = await askConfirm({
        eyebrow: 'Прайс',
        title: 'Удалить позицию?',
        text: `<b>${esc(name)}</b> исчезнет из прайса и из списков в форме заказа.`,
        note: 'Если позиция временно не нужна, её можно отключить «глазом» — настройки сохранятся.',
        yes: 'Удалить',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/prices/${btn.dataset.del}`, { method: 'DELETE' });
        row.remove();
        state.prices = null;
        toast('Позиция удалена');
      } catch (e) {
        toast(e.message, true);
      }
    });
  });
}

/** Создание и настройка раздела прайса. */
function openGroupEditor(group) {
  const isNew = !group;
  const body = `
    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Раздел прайса</h3>
      <div class="grid">
        <div class="field"><label for="gr_title">Название</label>
          <input id="gr_title" type="text" value="${esc(group ? group.title : '')}" placeholder="Например: Гравировка: материалы"></div>
        <div class="field"><label for="gr_unit">Единица</label>
          <select id="gr_unit">
            ${['₽', '₽/шт', '₽/м', '₽/м²', '₽/пог.м', '₽/лист', '×'].map((u) => `
              <option value="${u}" ${(group ? group.unit : '₽/м') === u ? 'selected' : ''}>${u}</option>`).join('')}
            ${group && !['₽', '₽/шт', '₽/м', '₽/м²', '₽/пог.м', '₽/лист', '×'].includes(group.unit)
              ? `<option value="${esc(group.unit)}" selected>${esc(group.unit)}</option>` : ''}
          </select>
          <div class="hint">
            Только подпись для людей — на расчёт не влияет. Единицу задаёт роль
            поля в виде работ: «умножить на длину» всегда считает за метр,
            «на площадь» — за м². Выбирайте ту, что совпадает с ролью, иначе
            цену легко занести не в том масштабе.
          </div>
        </div>
      </div>
      <div class="grid one" style="margin-top:13px">
        <div class="field"><label for="gr_hint">Пояснение</label>
          <input id="gr_hint" type="text" value="${esc(group ? group.hint : '')}" placeholder="Что здесь лежит и как считается"></div>
      </div>
      <div class="grid one" style="margin-top:13px">
        <div class="field"><label for="gr_kind">Что хранят позиции</label>
          <select id="gr_kind">
            <option value="money" ${!group || group.kind === 'money' ? 'selected' : ''}>Цены в рублях</option>
            <option value="factor" ${group && group.kind === 'factor' ? 'selected' : ''}>Коэффициенты (×1.8)</option>
          </select>
          <div class="hint">Коэффициенты умножают цену — например надбавка за двустороннюю печать.</div>
        </div>
      </div>
    </div>`;

  openModal({
    eyebrow: isNew ? 'Прайс' : `Раздел · ${group.title}`,
    title: isNew ? 'Новый раздел' : 'Настройка раздела',
    body,
    foot: `
      <button class="btn btn-ghost" id="grCancel" type="button">Отмена</button>
      <div class="spacer"></div>
      <button class="btn btn-green" id="grSave" type="button">${isNew ? 'Создать' : 'Сохранить'}</button>`,
  });

  $('#grCancel').addEventListener('click', closeModal);
  $('#grSave').addEventListener('click', async () => {
    const payload = {
      title: $('#gr_title').value.trim(),
      hint: $('#gr_hint').value.trim(),
      unit: $('#gr_unit').value || '₽',
      kind: $('#gr_kind').value,
    };
    if (!payload.title) { toast('Укажите название раздела', true); return; }
    try {
      if (isNew) await api('/prices/groups', { method: 'POST', body: JSON.stringify(payload) });
      else await api(`/prices/groups/${group.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast(isNew ? `Раздел «${payload.title}» создан` : 'Сохранено');
      closeModal();
      renderPricesPage();
    } catch (e) { toast(e.message, true); }
  });
}

/* ---------------------------------------------------- метрики (только админ) */
const METRIC_PERIODS = [
  { days: 7, label: 'Неделя' },
  { days: 30, label: 'Месяц' },
  { days: 90, label: 'Квартал' },
  { days: 365, label: 'Год' },
  { days: 0, label: 'Всё время' },
];

async function renderMetricsPage(days = 30) {
  const box = $('#metricsContent');
  state.metricsDays = days;
  box.innerHTML = '<div class="mx-empty">Считаю…</div>';

  let m;
  try {
    m = await api(`/metrics?days=${days}&top=50`);
  } catch (e) {
    box.innerHTML = `<div class="mx-empty">${esc(e.message)}</div>`;
    return;
  }

  if (state.metricsDetail) {
    renderMetricsDetail(m, state.metricsDetail);
    return;
  }

  const tabs = `<div class="mx-tabs">${METRIC_PERIODS.map((p) => `
    <button data-days="${p.days}" class="${p.days === days ? 'active' : ''}">${p.label}</button>`).join('')}</div>`;

  const peak = Math.max(...m.series.map((s) => s.sum), 1);
  const chart = m.series.length
    ? `<div class="mx-chart">${m.series.map((s) => `
         <div class="mx-bar ${s.sum ? 'has' : ''}" style="height:${Math.max((s.sum / peak) * 100, 2)}%"
              title="${esc(s.label)} — ${esc(money(s.sum) || '0 ₽')}"></div>`).join('')}</div>
       <div class="mx-axis"><span>${esc(m.series[0].label)}</span><span>${esc(m.series[m.series.length - 1].label)}</span></div>`
    : '<div class="mx-empty">За период нет выданных заказов</div>';

  box.innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow"><span class="reg"><i></i></span> Аналитика · ${esc(m.period.label)}</div>
      <h1>Метрики</h1>
    </div>

    ${tabs}

    <div class="mx-hero">
      <div class="mx-cell accent">
        <div class="k">Заработано<br>за период</div>
        <div class="v">${esc(money(m.revenue) || '0 ₽')}</div>
      </div>
      <div class="mx-cell">
        <div class="k">Выдано<br>заказов</div>
        <div class="v">${m.orders_done}</div>
      </div>
      <div class="mx-cell">
        <div class="k">Средний<br>чек</div>
        <div class="v">${esc(money(m.avg_check) || '—')}</div>
      </div>
      <div class="mx-cell">
        <div class="k">Срок<br>выполнения</div>
        <div class="v">${m.avg_lead_days !== null ? `${m.avg_lead_days}<small>дн.</small>` : '—'}</div>
      </div>
    </div>

    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Выручка по дням</h3>
      ${chart}
    </div>

    <div class="mx-hero">
      <div class="mx-cell">
        <div class="k">Сейчас<br>в работе</div>
        <div class="v">${m.active_count}<small>на ${esc(money(m.active_sum) || '0 ₽')}</small></div>
      </div>
      <div class="mx-cell">
        <div class="k">Ждём<br>доплаты</div>
        <div class="v">${esc(money(m.debt) || '0 ₽')}</div>
      </div>
      <div class="mx-cell ${m.overdue_count ? 'warn' : ''}">
        <div class="k">Просрочено<br>/ сегодня</div>
        <div class="v">${m.overdue_count}<small>/ сегодня ${m.due_today_count}</small></div>
      </div>
      <div class="mx-cell ${m.no_price_count ? 'warn' : ''}">
        <div class="k">Без цены<br>в работе</div>
        <div class="v">${m.no_price_count}</div>
      </div>
    </div>

    <div class="mx-cols">
      <button class="mx-open" data-detail="templates" type="button">
        <span class="k">По видам работ</span>
        <span class="v">${m.by_template.length} <small>${m.by_template.length ? 'вида в работе' : '—'}</small></span>
        <span class="go">Открыть разбор ${ICONS.arrow}</span>
      </button>
      <button class="mx-open" data-detail="clients" type="button">
        <span class="k">Клиенты по выручке</span>
        <span class="v">${m.clients_total} <small>${plural(m.clients_total, 'клиент', 'клиента', 'клиентов')}</small></span>
        <span class="go">Открыть список ${ICONS.arrow}</span>
      </button>
    </div>

    <div class="form-sec">
      <h3><span class="reg"><i></i></span> Заявки за период</h3>
      <ul class="mx-list">
        <li><span class="nm">Создано заказов</span><span class="sm">${m.created_count}</span></li>
        <li><span class="nm">Отменено</span><span class="sm">${m.cancelled_count} · ${m.cancel_rate}%</span></li>
        <li><span class="nm">Предоплат в кассе по активным</span><span class="sm">${esc(money(m.prepaid_held) || '0 ₽')}</span></li>
      </ul>
    </div>`;

  bindMetricsTabs();
  box.querySelectorAll('.mx-open').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.metricsDetail = btn.dataset.detail;
      renderMetricsPage(days);
      $('#pageMetrics').scrollTop = 0;
    });
  });
}

/** Разбор одного разреза: по видам работ или по клиентам. */
function renderMetricsDetail(m, kind) {
  const box = $('#metricsContent');
  const rows = kind === 'clients'
    ? m.top_clients.map((c) => ({ name: c.name, count: c.count, sum: c.sum }))
    : m.by_template.map((t) => ({ name: t.title, count: t.count, sum: t.sum }));

  const total = rows.reduce((acc, r) => acc + r.sum, 0);
  const peak = Math.max(...rows.map((r) => r.sum), 1);

  const tabs = `<div class="mx-tabs">${METRIC_PERIODS.map((p) => `
    <button data-days="${p.days}" class="${p.days === state.metricsDays ? 'active' : ''}">${p.label}</button>`).join('')}</div>`;

  box.innerHTML = `
    <button class="pr-back" id="mxBack" type="button">${ICONS.arrow} Все метрики</button>

    <div class="page-head">
      <div class="page-eyebrow"><span class="reg"><i></i></span> Аналитика · ${esc(m.period.label)}</div>
      <h1>${kind === 'clients' ? 'Клиенты' : 'Виды работ'}</h1>
    </div>

    ${tabs}

    <div class="mx-sum">
      <span>Всего за период</span>
      <b>${esc(money(total) || '0 ₽')}</b>
      <span class="cnt">${rows.length} ${kind === 'clients'
        ? plural(rows.length, 'клиент', 'клиента', 'клиентов')
        : plural(rows.length, 'вид', 'вида', 'видов')}</span>
    </div>

    ${rows.length ? `<div class="mx-rank">${rows.map((r, i) => `
      <div class="mx-rank-row">
        <span class="i">${i + 1}</span>
        <div class="body">
          <div class="line">
            <span class="nm">${esc(r.name)}</span>
            <span class="sm">${esc(money(r.sum) || '0 ₽')}</span>
          </div>
          <div class="track"><span style="width:${Math.max((r.sum / peak) * 100, 1.5)}%"></span></div>
          <div class="meta">
            <span>${r.count} ${plural(r.count, 'заказ', 'заказа', 'заказов')}</span>
            <span>${total ? Math.round((r.sum / total) * 100) : 0}% выручки</span>
            <span>средний ${esc(money(r.count ? r.sum / r.count : 0) || '—')}</span>
          </div>
        </div>
      </div>`).join('')}</div>`
    : '<div class="mx-empty">За этот период нет выданных заказов</div>'}`;

  $('#mxBack').addEventListener('click', () => {
    state.metricsDetail = null;
    renderMetricsPage(state.metricsDays);
    $('#pageMetrics').scrollTop = 0;
  });
  bindMetricsTabs();
}

function bindMetricsTabs() {
  $('#metricsContent').querySelectorAll('.mx-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => renderMetricsPage(Number(btn.dataset.days)));
  });
}

/* ---------------------------------------------------- глобальные обработчики */
function bindGlobal() {
  $('#newOrderBtn').addEventListener('click', openTemplatePicker);
  bindRouter();

  const sortSelect = $('#sortSelect');
  sortSelect.value = state.sort;
  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    localStorage.setItem('poster.sort', state.sort);
    renderBoard();
  });
  $('#modalClose').addEventListener('click', closeModal);
  $('#overlay').addEventListener('mousedown', (e) => { if (e.target === $('#overlay')) closeModal(); });

  // контекстное меню закрываем при любом клике мимо, скролле и правом клике вне карточки
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#ctx')) closeContextMenu();
  });
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.card')) closeContextMenu();
  });
  document.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('resize', closeContextMenu);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#ctx').hidden) { closeContextMenu(); return; }
      if (!$('#overlay').hidden) closeModal();
    }
    if (e.key === '/' && state.view === 'board' && document.activeElement !== $('#search') && $('#overlay').hidden) {
      e.preventDefault();
      $('#search').focus();
    }
  });

  let timer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value.trim();
      loadOrders();
    }, 250);
  });
}

init();