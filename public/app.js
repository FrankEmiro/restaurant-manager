/* ═══════════════════════════════════════════════
   Restaurant Manager — Frontend App
   ═══════════════════════════════════════════════ */

const API = '';  // same origin

// ─── AUTH ────────────────────────────────────────

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

// Intercept 401 → redirect to login
window.addEventListener('unhandledrejection', e => {
  if (e.reason?.message === 'Non autenticato') {
    window.location.href = '/login';
  }
});

// ─── UTILITY ────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Errore sconosciuto');
  return data;
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function formatDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status) {
  const map = {
    confirmed: ['badge-green', 'Confermata'],
    cancelled: ['badge-red', 'Cancellata'],
    completed: ['badge-gray', 'Completata'],
    pending: ['badge-yellow', 'In attesa'],
    preparing: ['badge-orange', 'In preparazione'],
    ready: ['badge-green', 'Pronto'],
    picked_up: ['badge-gray', 'Ritirato'],
    free: ['badge-green', 'Libero'],
    occupied: ['badge-red', 'Occupato'],
    reserved: ['badge-yellow', 'Prenotato'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function countdownLabel(pickupDate, pickupTime) {
  const pickupMs = new Date(pickupDate + 'T' + pickupTime).getTime();
  const diffMin = Math.round((pickupMs - Date.now()) / 60000);
  if (diffMin < -120 || diffMin > 1440) return ''; // oltre 2h passate o 24h future: niente etichetta
  if (diffMin < 0) return `<span class="kc-countdown soon">${Math.abs(diffMin)}m fa</span>`;
  if (diffMin < 30) return `<span class="kc-countdown soon">${diffMin}m</span>`;
  return `<span class="kc-countdown ok">${diffMin}m</span>`;
}

// ─── ROUTER ─────────────────────────────────────

const views = ['dashboard', 'cucina', 'mappa', 'editor', 'menu', 'allergeni', 'agenda', 'segnalazioni'];
let activeView = 'dashboard';

// ─── AUTO-REFRESH ────────────────────────────────
let _pollInterval = null;
const POLL_INTERVALS = { dashboard: 15000, cucina: 10000, mappa: 20000 };

function startPolling(view) {
  stopPolling();
  const ms = POLL_INTERVALS[view];
  if (!ms) return;
  _pollInterval = setInterval(() => loadView(view), ms);
}

function stopPolling() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
}
// ─────────────────────────────────────────────────

function navigate(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('#sidebar nav a').forEach(a => a.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');
  const link = document.querySelector(`[data-view="${view}"]`);
  if (link) link.classList.add('active');
  loadView(view);
  startPolling(view);
}

function loadView(view) {
  switch (view) {
    case 'dashboard': loadDashboard(); break;
    case 'cucina': loadKitchen(); break;
    case 'mappa': loadMap(); break;
    case 'editor': loadEditor(); break;
    case 'menu': loadMenu(); break;
    case 'allergeni': loadAllergens(); break;
    case 'agenda':        loadAgenda();      break;
    case 'segnalazioni':  loadComplaints();  break;
  }
}

// ─── DASHBOARD ──────────────────────────────────

async function loadDashboard() {
  try {
    const [data, reservations, allOrders] = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch(`/api/reservations?date=${today()}`),
      apiFetch(`/api/orders`),
    ]);
    const todayStr = today();
    const orders = allOrders.filter(o =>
      ['pending', 'preparing', 'ready'].includes(o.status) || o.pickup_date === todayStr
    );
    const s = data.stats;

    document.getElementById('stat-reservations').textContent = s.reservationsToday;
    document.getElementById('stat-orders').textContent = s.activeOrders;
    document.getElementById('stat-tables').textContent = `${s.freeTables}/${s.totalTables}`;
    document.getElementById('stat-revenue').textContent = `€${s.revenue.toFixed(2)}`;

    // All today's reservations
    const resBody = document.getElementById('upcoming-reservations-body');
    const activeRes = reservations.filter(r => r.status !== 'cancelled');
    if (activeRes.length === 0) {
      resBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">Nessuna prenotazione oggi</td></tr>';
    } else {
      resBody.innerHTML = activeRes.map(r => `
        <tr>
          <td><strong>${r.customer_name}</strong><br><small style="color:var(--text-muted)">${r.customer_phone}</small></td>
          <td>${r.time}</td>
          <td>${r.guests}</td>
          <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.notes || ''}">${r.notes || '—'}</td>
          <td>${statusBadge(r.status)}</td>
          <td>
            <div class="row-actions">
              <button class="btn-icon" title="Modifica" onclick="editReservation(${r.id})"><i class="bi bi-pencil"></i></button>
              <button class="btn-icon danger" title="Cancella" onclick="cancelReservation(${r.id})"><i class="bi bi-x-lg"></i></button>
            </div>
          </td>
        </tr>
      `).join('');
    }

    // All today's orders
    const ordersBody = document.getElementById('recent-orders-body');
    if (orders.length === 0) {
      ordersBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">Nessun ordine oggi</td></tr>';
    } else {
      const nextStatus = { pending: 'preparing', preparing: 'ready', ready: 'picked_up' };
      const nextIcon  = { pending: 'bi-play-fill', preparing: 'bi-check-lg', ready: 'bi-archive' };
      const nextLabel = { pending: 'Prepara', preparing: 'Pronto', ready: 'Archivia' };
      ordersBody.innerHTML = orders.map(o => {
        const allergenBadge = (o.allergens && o.allergens.length > 0)
          ? `<br><span style="color:#dc2626;font-size:11px;font-weight:600"><i class="bi bi-exclamation-triangle-fill"></i> ${o.allergens.map(a => a.allergen_name).join(', ')}</span>`
          : '';
        return `
        <tr>
          <td><strong>${o.customer_name}</strong><br><small style="color:var(--text-muted)">${o.customer_phone}</small>${allergenBadge}</td>
          <td>${o.pickup_time}</td>
          <td>${statusBadge(o.status)}</td>
          <td>€${(o.total || 0).toFixed(2)}</td>
          <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${o.notes || ''}">${o.notes || '—'}</td>
          <td>
            <div class="row-actions">
              ${nextStatus[o.status] ? `<button class="btn-icon" title="${nextLabel[o.status]}" onclick="advanceOrderStatus(${o.id},'${nextStatus[o.status]}')"><i class="bi ${nextIcon[o.status]}"></i></button>` : ''}
              <button class="btn-icon danger" title="Elimina" onclick="deleteOrder(${o.id})"><i class="bi bi-trash3"></i></button>
            </div>
          </td>
        </tr>
      `}).join('');
    }
  } catch (e) {
    toast('Errore caricamento dashboard: ' + e.message, 'error');
  }
}

async function editReservation(id) {
  try {
    const r = await apiFetch(`/api/reservations/${id}`);
    document.getElementById('res-modal-title').textContent = 'Modifica prenotazione';
    document.getElementById('res-id').value = r.id;
    document.getElementById('res-name').value = r.customer_name;
    document.getElementById('res-phone').value = r.customer_phone;
    document.getElementById('res-date').value = r.date;
    document.getElementById('res-time').value = r.time;
    document.getElementById('res-guests').value = r.guests;
    document.getElementById('res-notes').value = r.notes || '';
    await populateTableSelect(r.table_id);
    document.getElementById('modal-reservation').style.display = 'flex';
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

async function cancelReservation(id) {
  if (!confirm('Cancellare questa prenotazione?')) return;
  try {
    await apiFetch(`/api/reservations/${id}`, { method: 'PATCH', body: { status: 'cancelled' } });
    toast('Prenotazione cancellata');
    loadDashboard();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

async function advanceOrderStatus(id, status) {
  try {
    await apiFetch(`/api/orders/${id}`, { method: 'PATCH', body: { status } });
    loadDashboard();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

async function deleteOrder(id) {
  if (!confirm('Eliminare questo ordine?')) return;
  try {
    await apiFetch(`/api/orders/${id}`, { method: 'DELETE' });
    toast('Ordine eliminato');
    loadDashboard();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

// ─── CUCINA ─────────────────────────────────────

async function loadKitchen() {
  await renderKitchen();
}

async function renderKitchen() {
  try {
    const orders = await apiFetch(`/api/orders`);
    const active = orders.filter(o => ['pending', 'preparing', 'ready'].includes(o.status));
    const grid = document.getElementById('kitchen-grid');

    if (active.length === 0) {
      grid.innerHTML = '<div class="kitchen-empty"><i class="bi bi-cup-hot" style="font-size:40px;display:block;margin-bottom:12px;opacity:0.3"></i>Nessun ordine attivo</div>';
      return;
    }

    grid.innerHTML = active.map(o => {
      const items = (o.items || []).map(i =>
        `<div class="kc-item"><span class="kc-qty">${i.quantity}</span>${i.item_name}</div>`
      ).join('');

      let actions = '';
      if (o.status === 'pending') {
        actions = `<button class="btn btn-warning" onclick="updateOrderStatus(${o.id},'preparing')"><i class="bi bi-play-fill"></i> In preparazione</button>`;
      } else if (o.status === 'preparing') {
        actions = `<button class="btn btn-success" onclick="updateOrderStatus(${o.id},'ready')"><i class="bi bi-check-lg"></i> Pronto</button>`;
      } else if (o.status === 'ready') {
        actions = `<button class="btn btn-outline" style="color:white;border-color:rgba(255,255,255,0.2)" onclick="updateOrderStatus(${o.id},'picked_up')"><i class="bi bi-archive"></i> Archivia</button>`;
      }

      const allergenBanner = (o.allergens && o.allergens.length > 0)
        ? `<div class="kc-allergens"><i class="bi bi-exclamation-triangle-fill"></i> ALLERGIE: ${o.allergens.map(a => a.allergen_name).join(', ')}</div>`
        : '';

      const statusLabel = o.status === 'pending' ? '<i class="bi bi-hourglass-split"></i> In attesa'
        : o.status === 'preparing' ? '<i class="bi bi-fire"></i> In preparazione'
        : '<i class="bi bi-check-circle-fill"></i> Pronto';

      return `
        <div class="kitchen-card ${o.status}">
          <div class="kc-status">${statusLabel}</div>
          <div class="kc-customer">${o.customer_name}</div>
          <div class="kc-time">Ritiro: ${o.pickup_time} ${countdownLabel(o.pickup_date, o.pickup_time)}</div>
          ${allergenBanner}
          ${o.notes ? `<div class="kc-notes"><i class="bi bi-sticky"></i> ${o.notes}</div>` : ''}
          <div class="kc-items">${items}</div>
          <div class="kc-actions">${actions}</div>
        </div>`;
    }).join('');
  } catch (e) {
    console.error('Kitchen error:', e);
  }
}

async function updateOrderStatus(id, status) {
  try {
    await apiFetch(`/api/orders/${id}`, { method: 'PATCH', body: { status } });
    await renderKitchen();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

// ─── MAPPA TAVOLI ────────────────────────────────

let mapTables = [];
let mapReservations = {};  // table_id → reservation
let activePopup = null;

async function loadMap() {
  const [tables, reservations] = await Promise.all([
    apiFetch('/api/tables'),
    apiFetch(`/api/reservations?date=${today()}`),
  ]);
  mapTables = tables;
  mapReservations = {};
  for (const r of reservations) {
    if (r.table_id && r.status === 'confirmed') {
      // Keep the earliest booking for that table
      if (!mapReservations[r.table_id]) mapReservations[r.table_id] = r;
    }
  }
  renderMap();
}

function effectiveStatus(table) {
  if (mapReservations[table.id]) return 'reserved';
  return table.status;
}

function renderMap() {
  const area = document.getElementById('map-area');
  area.innerHTML = mapTables.map(t => {
    const size = t.capacity <= 2 ? 64 : t.capacity <= 4 ? 76 : 90;
    const status = effectiveStatus(t);
    const res = mapReservations[t.id];
    return `
      <div class="table-token ${t.shape} ${status}"
        style="left:${t.x}%;top:${t.y}%;width:${size}px;height:${size}px"
        data-id="${t.id}"
        onclick="showTablePopup(event, ${t.id})">
        <div class="t-number">${t.number}</div>
        <div class="t-cap">${res ? res.time : t.capacity + 'p'}</div>
      </div>`;
  }).join('');
}

function showTablePopup(e, tableId) {
  e.stopPropagation();
  closePopup();
  const table = mapTables.find(t => t.id === tableId);
  if (!table) return;

  const res = mapReservations[tableId];
  const status = effectiveStatus(table);

  const resBlock = res ? `
    <div style="background:#fef3c7;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px">
      <strong>${res.customer_name}</strong> · ${res.guests} persone<br>
      🕐 ${res.time}${res.customer_phone ? ' · ' + res.customer_phone : ''}
      ${res.notes ? `<br><span style="color:#92400e">📝 ${res.notes}</span>` : ''}
    </div>` : '';

  const statusOptions = ['free', 'occupied', 'reserved'].map(s =>
    `<button class="btn btn-sm ${s === status ? 'btn-primary' : 'btn-outline'}" onclick="changeTableStatus(${tableId},'${s}')">
      ${s === 'free' ? 'Libero' : s === 'occupied' ? 'Occupato' : 'Prenotato'}
    </button>`
  ).join('');

  const popup = document.createElement('div');
  popup.className = 'table-popup';
  popup.id = 'table-popup';
  popup.innerHTML = `
    <button class="popup-close" onclick="closePopup()">×</button>
    <h3>${table.number}</h3>
    <div class="popup-sub">Capacità: ${table.capacity} posti · ${table.shape === 'round' ? 'Rotondo' : 'Quadrato'}</div>
    ${resBlock}
    <div class="popup-info" style="margin-bottom:10px">Stato: ${statusBadge(status)}</div>
    <div class="popup-actions">${statusOptions}</div>
  `;

  const rect = e.target.closest('.table-token').getBoundingClientRect();
  popup.style.left = Math.min(rect.right + 8, window.innerWidth - 320) + 'px';
  popup.style.top = Math.max(rect.top, 60) + 'px';
  document.body.appendChild(popup);
  activePopup = popup;
}

function closePopup() {
  if (activePopup) { activePopup.remove(); activePopup = null; }
}

async function changeTableStatus(id, status) {
  try {
    await apiFetch(`/api/tables/${id}`, { method: 'PATCH', body: { status } });
    closePopup();
    await loadMap();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

document.addEventListener('click', (e) => {
  if (activePopup && !activePopup.contains(e.target)) closePopup();
});

// ─── EDITOR TAVOLI ───────────────────────────────

let editorTables = [];
let dragging = null;
let dragOffset = { x: 0, y: 0 };
let selectedTable = null;

async function loadEditor() {
  editorTables = await apiFetch('/api/tables');
  renderEditor();
}

function renderEditor() {
  const area = document.getElementById('editor-map-area');
  area.innerHTML = editorTables.map(t => {
    const size = t.capacity <= 2 ? 64 : t.capacity <= 4 ? 76 : 90;
    return `
      <div class="table-token ${t.shape} free ${selectedTable === t.id ? 'selected' : ''}"
        style="left:${t.x}%;top:${t.y}%;width:${size}px;height:${size}px;cursor:grab"
        data-id="${t.id}"
        onmousedown="startDrag(event, ${t.id})"
        onclick="selectEditorTable(event, ${t.id})">
        <div class="t-number">${t.number}</div>
        <div class="t-cap">${t.capacity}p</div>
      </div>`;
  }).join('');
}

function startDrag(e, id) {
  e.preventDefault();
  const token = e.currentTarget;
  token.classList.add('dragging');
  dragging = id;
  const area = document.getElementById('editor-map-area');
  const areaRect = area.getBoundingClientRect();
  const tokenRect = token.getBoundingClientRect();
  dragOffset.x = e.clientX - (tokenRect.left + tokenRect.width / 2);
  dragOffset.y = e.clientY - (tokenRect.top + tokenRect.height / 2);

  function onMove(e2) {
    if (!dragging) return;
    const x = ((e2.clientX - dragOffset.x - areaRect.left) / areaRect.width) * 100;
    const y = ((e2.clientY - dragOffset.y - areaRect.top) / areaRect.height) * 100;
    const clamped_x = Math.max(3, Math.min(97, x));
    const clamped_y = Math.max(3, Math.min(97, y));
    token.style.left = clamped_x + '%';
    token.style.top = clamped_y + '%';
    const t = editorTables.find(t => t.id === id);
    if (t) { t.x = clamped_x; t.y = clamped_y; }
  }

  async function onUp() {
    if (!dragging) return;
    token.classList.remove('dragging');
    dragging = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    // Auto-save position
    const t = editorTables.find(t => t.id === id);
    if (t) {
      try {
        await apiFetch(`/api/tables/${id}`, { method: 'PATCH', body: { x: t.x, y: t.y } });
      } catch (err) {
        toast('Errore salvataggio posizione', 'error');
      }
    }
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function selectEditorTable(e, id) {
  if (dragging) return;
  selectedTable = selectedTable === id ? null : id;
  renderEditor();
  // Show edit panel
  if (selectedTable) showEditorPanel(id);
  else {
    document.getElementById('editor-panel').style.display = 'none';
    document.getElementById('editor-no-selection').style.display = 'flex';
  }
}

function showEditorPanel(id) {
  const t = editorTables.find(t => t.id === id);
  if (!t) return;
  document.getElementById('editor-panel').style.display = 'block';
  document.getElementById('editor-no-selection').style.display = 'none';
  document.getElementById('ep-number').value = t.number;
  document.getElementById('ep-capacity').value = t.capacity;
  document.getElementById('ep-shape').value = t.shape;
}

async function saveEditorTable() {
  if (!selectedTable) return;
  const number = document.getElementById('ep-number').value.trim();
  const capacity = parseInt(document.getElementById('ep-capacity').value);
  const shape = document.getElementById('ep-shape').value;
  if (!number || !capacity) { toast('Compila tutti i campi', 'error'); return; }
  try {
    await apiFetch(`/api/tables/${selectedTable}`, { method: 'PATCH', body: { number, capacity, shape } });
    editorTables = await apiFetch('/api/tables');
    renderEditor();
    toast('Tavolo aggiornato');
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

async function deleteEditorTable() {
  if (!selectedTable) return;
  if (!confirm('Eliminare il tavolo?')) return;
  try {
    await apiFetch(`/api/tables/${selectedTable}`, { method: 'DELETE' });
    selectedTable = null;
    editorTables = await apiFetch('/api/tables');
    renderEditor();
    document.getElementById('editor-panel').style.display = 'none';
    document.getElementById('editor-no-selection').style.display = 'flex';
    toast('Tavolo eliminato');
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

function openAddTableModal() {
  document.getElementById('add-table-form').reset();
  document.getElementById('modal-add-table').style.display = 'flex';
}

async function submitAddTable() {
  const number = document.getElementById('at-number').value.trim();
  const capacity = parseInt(document.getElementById('at-capacity').value);
  const shape = document.getElementById('at-shape').value;
  if (!number || !capacity) { toast('Compila tutti i campi', 'error'); return; }
  try {
    await apiFetch('/api/tables', { method: 'POST', body: { number, capacity, shape, x: 50, y: 50 } });
    closeModal('modal-add-table');
    editorTables = await apiFetch('/api/tables');
    renderEditor();
    toast('Tavolo aggiunto!');
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

// ─── MENU ────────────────────────────────────────

let menuItems = [];
let menuFilter = 'all';

async function loadMenu() {
  menuItems = await apiFetch('/api/menu');
  renderMenu();
}

function renderMenu() {
  const categories = ['all', ...new Set(menuItems.map(i => i.category).filter(Boolean))];
  const catBar = document.getElementById('menu-categories');
  catBar.innerHTML = categories.map(c =>
    `<button class="menu-category-btn ${menuFilter === c ? 'active' : ''}" onclick="setMenuFilter('${c}')">${c === 'all' ? 'Tutti' : c}</button>`
  ).join('');

  const filtered = menuFilter === 'all' ? menuItems : menuItems.filter(i => i.category === menuFilter);
  const grid = document.getElementById('menu-grid');

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="icon">🍽️</div><p>Nessun piatto in questa categoria</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(item => {
    const badges = [
      item.vegan       ? '<span class="diet-badge vegan"><i class="bi bi-flower1"></i> Vegano</span>'        : '',
      item.vegetarian  ? '<span class="diet-badge vegetarian"><i class="bi bi-leaf"></i> Vegetariano</span>' : '',
    ].filter(Boolean).join('');
    return `
    <div class="menu-item-card ${item.available ? '' : 'unavailable'}">
      <div class="mic-header">
        <div>
          <div class="mic-cat">${item.category || ''}${badges ? ' ' + badges : ''}</div>
          <div class="mic-name">${item.name}</div>
        </div>
        <div class="mic-price">€${item.price.toFixed(2)}</div>
      </div>
      ${item.description ? `<div class="mic-desc">${item.description}</div>` : ''}
      <div class="mic-actions">
        <label class="toggle-switch">
          <input type="checkbox" ${item.available ? 'checked' : ''} onchange="toggleMenuItem(${item.id}, this.checked, this)">
          <span class="toggle-slider"></span>
          <span class="toggle-label">${item.available ? 'Disponibile' : 'Non disp.'}</span>
        </label>
        <button class="btn-icon" title="Modifica" onclick="editMenuItem(${item.id})"><i class="bi bi-pencil"></i></button>
        <button class="btn-icon danger" title="Elimina" onclick="deleteMenuItem(${item.id})"><i class="bi bi-trash3"></i></button>
      </div>
    </div>
  `}).join('');
}

function setMenuFilter(cat) {
  menuFilter = cat;
  renderMenu();
}

async function toggleMenuItem(id, available, checkboxEl) {
  try {
    await apiFetch(`/api/menu/${id}`, { method: 'PATCH', body: { available: available ? 1 : 0 } });
    const item = menuItems.find(i => i.id === id);
    if (item) item.available = available ? 1 : 0;
    // Update label without full re-render
    if (checkboxEl) {
      const label = checkboxEl.closest('.toggle-switch')?.querySelector('.toggle-label');
      if (label) label.textContent = available ? 'Disponibile' : 'Non disp.';
    }
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
    renderMenu();
  }
}

function openAddMenuModal() {
  document.getElementById('menu-modal-title').textContent = 'Nuovo piatto';
  document.getElementById('menu-item-form').reset();
  document.getElementById('mi-id').value = '';
  document.getElementById('mi-vegetarian').checked = false;
  document.getElementById('mi-vegan').checked = false;
  document.getElementById('modal-menu-item').style.display = 'flex';
}

function editMenuItem(id) {
  const item = menuItems.find(i => i.id === id);
  if (!item) return;
  document.getElementById('menu-modal-title').textContent = 'Modifica piatto';
  document.getElementById('mi-id').value = item.id;
  document.getElementById('mi-name').value = item.name;
  document.getElementById('mi-category').value = item.category || '';
  document.getElementById('mi-price').value = item.price;
  document.getElementById('mi-description').value = item.description || '';
  document.getElementById('mi-vegetarian').checked = !!item.vegetarian;
  document.getElementById('mi-vegan').checked = !!item.vegan;
  document.getElementById('modal-menu-item').style.display = 'flex';
}

async function submitMenuItem() {
  const id = document.getElementById('mi-id').value;
  const body = {
    name: document.getElementById('mi-name').value.trim(),
    category: document.getElementById('mi-category').value,
    price: parseFloat(document.getElementById('mi-price').value),
    description: document.getElementById('mi-description').value.trim(),
    vegetarian: document.getElementById('mi-vegetarian').checked ? 1 : 0,
    vegan: document.getElementById('mi-vegan').checked ? 1 : 0,
  };
  if (!body.name || isNaN(body.price)) { toast('Nome e prezzo obbligatori', 'error'); return; }

  try {
    if (id) {
      await apiFetch(`/api/menu/${id}`, { method: 'PATCH', body });
    } else {
      await apiFetch('/api/menu', { method: 'POST', body });
    }
    closeModal('modal-menu-item');
    menuItems = await apiFetch('/api/menu');
    renderMenu();
    toast(id ? 'Piatto aggiornato' : 'Piatto aggiunto!');
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

async function deleteMenuItem(id) {
  if (!confirm('Eliminare questo piatto?')) return;
  try {
    await apiFetch(`/api/menu/${id}`, { method: 'DELETE' });
    menuItems = menuItems.filter(i => i.id !== id);
    renderMenu();
    toast('Piatto eliminato');
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

// ─── ORDER CREATION ──────────────────────────────

let orderItems = [];  // [{ id, name, price, quantity }]
let allMenuItems = [];

async function openAddOrderModal() {
  orderItems = [];
  document.getElementById('order-form').reset();
  document.getElementById('ord-date').value = today();
  document.getElementById('ord-item-qty').value = 1;
  renderOrderItems();

  // Load allergens as checkboxes
  const allergens = await apiFetch('/api/allergens');
  document.getElementById('ord-allergen-list').innerHTML = allergens.map(a => `
    <label class="check-label">
      <input type="checkbox" name="ord-allergen" value="${a.id}">
      ${a.name}
    </label>
  `).join('');

  // Load menu into select
  if (allMenuItems.length === 0) {
    allMenuItems = await apiFetch('/api/menu');
  }
  const select = document.getElementById('ord-item-select');
  const available = allMenuItems.filter(i => i.available);
  const grouped = {};
  for (const item of available) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }
  select.innerHTML = '<option value="">— Seleziona piatto —</option>' +
    Object.entries(grouped).map(([cat, items]) =>
      `<optgroup label="${cat}">${items.map(i =>
        `<option value="${i.id}" data-price="${i.price}" data-name="${i.name}">
          ${i.name} — €${i.price.toFixed(2)}
        </option>`
      ).join('')}</optgroup>`
    ).join('');

  document.getElementById('modal-order').style.display = 'flex';
}

function addOrderItem() {
  const select = document.getElementById('ord-item-select');
  const qty = parseInt(document.getElementById('ord-item-qty').value) || 1;
  const opt = select.options[select.selectedIndex];
  if (!opt || !opt.value) { toast('Seleziona un piatto', 'error'); return; }

  const id = parseInt(opt.value);
  const name = opt.dataset.name;
  const price = parseFloat(opt.dataset.price);

  // If already in list, increase qty
  const existing = orderItems.find(i => i.id === id);
  if (existing) {
    existing.quantity += qty;
  } else {
    orderItems.push({ id, name, price, quantity: qty });
  }

  select.value = '';
  document.getElementById('ord-item-qty').value = 1;
  renderOrderItems();
}

function removeOrderItem(idx) {
  orderItems.splice(idx, 1);
  renderOrderItems();
}

function renderOrderItems() {
  const list = document.getElementById('ord-items-list');
  if (orderItems.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:13px">Nessun piatto aggiunto</div>';
    document.getElementById('ord-total').textContent = '€0.00';
    return;
  }
  list.innerHTML = orderItems.map((item, idx) => `
    <div class="order-item-row">
      <span class="oir-name">${item.name}</span>
      <span class="oir-qty">${item.quantity} × €${item.price.toFixed(2)}</span>
      <span class="oir-price">€${(item.price * item.quantity).toFixed(2)}</span>
      <button type="button" class="oir-remove" onclick="removeOrderItem(${idx})">×</button>
    </div>
  `).join('');
  const total = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  document.getElementById('ord-total').textContent = `€${total.toFixed(2)}`;
}

async function submitOrder() {
  const name = document.getElementById('ord-name').value.trim();
  const phone = document.getElementById('ord-phone').value.trim();
  const date = document.getElementById('ord-date').value;
  const time = document.getElementById('ord-time').value;
  const notes = document.getElementById('ord-notes').value.trim();

  if (!name || !phone || !date || !time) {
    toast('Compila tutti i campi obbligatori', 'error'); return;
  }
  if (orderItems.length === 0) {
    toast('Aggiungi almeno un piatto', 'error'); return;
  }

  const allergen_ids = [...document.querySelectorAll('input[name="ord-allergen"]:checked')]
    .map(cb => parseInt(cb.value));

  try {
    await apiFetch('/api/orders', {
      method: 'POST',
      body: {
        customer_name: name,
        customer_phone: phone,
        pickup_date: date,
        pickup_time: time,
        notes,
        allergen_ids,
        items: orderItems.map(i => ({ menu_item_id: i.id, quantity: i.quantity })),
      }
    });
    closeModal('modal-order');
    toast('Ordine creato!');
    if (activeView === 'dashboard') loadDashboard();
    if (activeView === 'cucina') renderKitchen();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

// ─── RESERVATIONS (Dashboard modals) ─────────────

async function openAddReservationModal() {
  document.getElementById('res-form').reset();
  document.getElementById('res-id').value = '';
  document.getElementById('res-modal-title').textContent = 'Nuova prenotazione';
  document.getElementById('res-date').value = today();
  await populateTableSelect(null);
  document.getElementById('modal-reservation').style.display = 'flex';
}

async function populateTableSelect(selectedTableId) {
  const tables = await apiFetch('/api/tables');
  const select = document.getElementById('res-table');
  select.innerHTML = '<option value="">— Da assegnare —</option>' +
    tables.map(t =>
      `<option value="${t.id}" ${t.id === selectedTableId ? 'selected' : ''}>
        ${t.number} (${t.capacity} posti)
      </option>`
    ).join('');
}

async function submitReservation() {
  const id = document.getElementById('res-id').value;
  const tableVal = document.getElementById('res-table').value;
  const body = {
    customer_name: document.getElementById('res-name').value.trim(),
    customer_phone: document.getElementById('res-phone').value.trim(),
    date: document.getElementById('res-date').value,
    time: document.getElementById('res-time').value,
    guests: parseInt(document.getElementById('res-guests').value),
    notes: document.getElementById('res-notes').value.trim(),
    table_id: tableVal ? parseInt(tableVal) : null,
  };
  if (!body.customer_name || !body.customer_phone || !body.date || !body.time || !body.guests) {
    toast('Compila tutti i campi obbligatori', 'error'); return;
  }
  try {
    if (id) {
      await apiFetch(`/api/reservations/${id}`, { method: 'PATCH', body });
    } else {
      await apiFetch('/api/reservations', { method: 'POST', body });
    }
    closeModal('modal-reservation');
    if (activeView === 'dashboard') loadDashboard();
    toast(id ? 'Prenotazione aggiornata' : 'Prenotazione creata!');
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

// ─── MODALS ──────────────────────────────────────

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// Close on backdrop click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.style.display = 'none';
  }
});

// ─── ALLERGENI ───────────────────────────────────

let allergensList = [];

async function loadAllergens() {
  allergensList = await apiFetch('/api/allergens');
  renderAllergens();
}

function renderAllergens() {
  const grid = document.getElementById('allergen-grid');
  if (allergensList.length === 0) {
    grid.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text-muted)">Nessun allergene. Aggiungine uno.</div>';
    return;
  }
  grid.innerHTML = allergensList.map((a, i) => `
    <div class="allergen-card">
      <div class="allergen-number">${i + 1}</div>
      <div class="allergen-body">
        <div class="allergen-name">${a.name}</div>
        ${a.description ? `<div class="allergen-desc">${a.description}</div>` : ''}
      </div>
      <div class="allergen-actions">
        <button class="btn-icon" title="Modifica" onclick="editAllergen(${a.id})"><i class="bi bi-pencil"></i></button>
        <button class="btn-icon danger" title="Elimina" onclick="deleteAllergen(${a.id})"><i class="bi bi-trash3"></i></button>
      </div>
    </div>
  `).join('');
}

function openAddAllergenModal() {
  document.getElementById('allergen-modal-title').textContent = 'Nuovo allergene';
  document.getElementById('allergen-form').reset();
  document.getElementById('al-id').value = '';
  document.getElementById('modal-allergen').style.display = 'flex';
}

function editAllergen(id) {
  const a = allergensList.find(x => x.id === id);
  if (!a) return;
  document.getElementById('allergen-modal-title').textContent = 'Modifica allergene';
  document.getElementById('al-id').value = a.id;
  document.getElementById('al-name').value = a.name;
  document.getElementById('al-description').value = a.description || '';
  document.getElementById('modal-allergen').style.display = 'flex';
}

async function submitAllergen() {
  const id = document.getElementById('al-id').value;
  const body = {
    name: document.getElementById('al-name').value.trim(),
    description: document.getElementById('al-description').value.trim(),
  };
  if (!body.name) { toast('Il nome è obbligatorio', 'error'); return; }
  try {
    if (id) {
      await apiFetch(`/api/allergens/${id}`, { method: 'PATCH', body });
    } else {
      await apiFetch('/api/allergens', { method: 'POST', body });
    }
    closeModal('modal-allergen');
    await loadAllergens();
    toast(id ? 'Allergene aggiornato' : 'Allergene aggiunto!');
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

async function deleteAllergen(id) {
  if (!confirm('Eliminare questo allergene?')) return;
  try {
    await apiFetch(`/api/allergens/${id}`, { method: 'DELETE' });
    await loadAllergens();
    toast('Allergene eliminato');
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

// ─── AGENDA ──────────────────────────────────────

let agendaTab = 'prenotazioni';

function nDaysFrom(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function switchAgendaTab(tab) {
  agendaTab = tab;
  document.getElementById('tab-prenotazioni').classList.toggle('active', tab === 'prenotazioni');
  document.getElementById('tab-ordini').classList.toggle('active', tab === 'ordini');
  document.getElementById('agenda-prenotazioni').style.display = tab === 'prenotazioni' ? '' : 'none';
  document.getElementById('agenda-ordini').style.display = tab === 'ordini' ? '' : 'none';
}

async function loadAgenda() {
  // Imposta i default solo la prima volta
  if (!document.getElementById('agenda-res-from').value) {
    document.getElementById('agenda-res-from').value = today();
    document.getElementById('agenda-res-to').value = nDaysFrom(14);
  }
  if (!document.getElementById('agenda-ord-from').value) {
    document.getElementById('agenda-ord-from').value = nDaysFrom(-30);
    document.getElementById('agenda-ord-to').value = today();
  }
  if (agendaTab === 'prenotazioni') {
    await loadAgendaReservations();
  } else {
    await loadAgendaOrders();
  }
}

async function loadAgendaReservations() {
  const from = document.getElementById('agenda-res-from').value;
  const to   = document.getElementById('agenda-res-to').value;
  const tbody = document.getElementById('agenda-res-body');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">Caricamento...</td></tr>';
  try {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to)   params.set('to', to);
    const rows = await apiFetch('/api/reservations?' + params);
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">Nessuna prenotazione nel periodo</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${formatDate(r.date)}</td>
        <td>${r.time}</td>
        <td><strong>${r.customer_name}</strong><br><small style="color:var(--text-muted)">${r.customer_phone}</small></td>
        <td>${r.guests}</td>
        <td>${r.table_number || '—'}</td>
        <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.notes || ''}">${r.notes || '—'}</td>
        <td>${statusBadge(r.status)}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" title="Modifica" onclick="editReservation(${r.id})"><i class="bi bi-pencil"></i></button>
            ${r.status !== 'cancelled' ? `<button class="btn-icon danger" title="Cancella" onclick="cancelAgendaReservation(${r.id})"><i class="bi bi-x-lg"></i></button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

async function cancelAgendaReservation(id) {
  if (!confirm('Cancellare questa prenotazione?')) return;
  try {
    await apiFetch(`/api/reservations/${id}`, { method: 'PATCH', body: { status: 'cancelled' } });
    toast('Prenotazione cancellata');
    loadAgendaReservations();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

async function loadAgendaOrders() {
  const from = document.getElementById('agenda-ord-from').value;
  const to   = document.getElementById('agenda-ord-to').value;
  const tbody = document.getElementById('agenda-ord-body');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">Caricamento...</td></tr>';
  try {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to)   params.set('to', to);
    const orders = await apiFetch('/api/orders?' + params);
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">Nessun ordine nel periodo</td></tr>';
      return;
    }
    tbody.innerHTML = orders.map(o => `
      <tr>
        <td>${formatDate(o.pickup_date)}</td>
        <td>${o.pickup_time}</td>
        <td><strong>${o.customer_name}</strong><br><small style="color:var(--text-muted)">${o.customer_phone}</small></td>
        <td>${statusBadge(o.status)}</td>
        <td>€${(o.total || 0).toFixed(2)}</td>
        <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${o.notes || ''}">${o.notes || '—'}</td>
      </tr>
    `).join('');
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

// ─── SEGNALAZIONI ────────────────────────────────

const COMPLAINT_TYPE_LABEL = {
  ordine_sbagliato:  'Ordine sbagliato',
  ritardo:           'Ritardo consegna',
  qualita:           'Qualità del cibo',
  mancanza_articoli: 'Articoli mancanti',
  altro:             'Altro',
};

let currentComplaintId = null;

async function loadComplaints() {
  const status = document.getElementById('complaint-filter-status')?.value || '';
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  try {
    const rows = await apiFetch('/api/complaints?' + params);

    // Stats
    const all = status ? await apiFetch('/api/complaints') : rows;
    document.getElementById('complaint-stat-aperte').textContent   = all.filter(r => r.status === 'aperta').length;
    document.getElementById('complaint-stat-gestione').textContent = all.filter(r => r.status === 'in_gestione').length;
    document.getElementById('complaint-stat-risolte').textContent  = all.filter(r => r.status === 'risolta').length;

    const list = document.getElementById('complaint-list');
    if (rows.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text-muted)"><i class="bi bi-check-circle" style="font-size:40px;opacity:0.3;display:block;margin-bottom:12px"></i>Nessuna segnalazione</div>';
      return;
    }
    list.innerHTML = rows.map(c => {
      const statusCls = { aperta: 'complaint-open', in_gestione: 'complaint-wip', risolta: 'complaint-done' }[c.status] || '';
      const statusBadgeMap = { aperta: 'badge-red', in_gestione: 'badge-yellow', risolta: 'badge-green' };
      const statusLabelMap = { aperta: 'Aperta', in_gestione: 'In gestione', risolta: 'Risolta' };
      return `
      <div class="complaint-card ${statusCls}">
        <div class="complaint-card-header">
          <div>
            <div class="complaint-type">${COMPLAINT_TYPE_LABEL[c.type] || c.type}</div>
            <div class="complaint-customer">
              <i class="bi bi-person"></i> <strong>${c.customer_name}</strong>
              &nbsp;·&nbsp;<i class="bi bi-telephone"></i> ${c.customer_phone}
              ${c.order_id ? `&nbsp;·&nbsp;<i class="bi bi-bag"></i> Ordine #${c.order_id}` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
            <span class="badge ${statusBadgeMap[c.status]}">${statusLabelMap[c.status]}</span>
            <span style="font-size:11px;color:var(--text-light)">${formatDateTime(c.created_at)}</span>
          </div>
        </div>
        <div class="complaint-desc">${c.description}</div>
        ${c.staff_notes ? `<div class="complaint-staff-note"><i class="bi bi-sticky"></i> ${c.staff_notes}</div>` : ''}
        <div class="complaint-actions">
          <button class="btn-icon" title="Dettaglio / Gestisci" onclick="openComplaintModal(${c.id})">
            <i class="bi bi-pencil"></i>
          </button>
          ${c.status !== 'in_gestione' && c.status !== 'risolta' ? `<button class="btn btn-sm btn-warning" onclick="setComplaintStatus(${c.id},'in_gestione')"><i class="bi bi-hourglass-split"></i> Prendi in carico</button>` : ''}
          ${c.status !== 'risolta' ? `<button class="btn btn-sm btn-success" onclick="setComplaintStatus(${c.id},'risolta')"><i class="bi bi-check-lg"></i> Risolvi</button>` : ''}
          <button class="btn-icon danger" title="Elimina" onclick="deleteComplaint(${c.id})"><i class="bi bi-trash3"></i></button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    toast('Errore caricamento segnalazioni: ' + e.message, 'error');
  }
}

async function setComplaintStatus(id, status) {
  try {
    await apiFetch(`/api/complaints/${id}`, { method: 'PATCH', body: { status } });
    loadComplaints();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

async function deleteComplaint(id) {
  if (!confirm('Eliminare questa segnalazione?')) return;
  try {
    await apiFetch(`/api/complaints/${id}`, { method: 'DELETE' });
    toast('Segnalazione eliminata');
    loadComplaints();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

async function openComplaintModal(id) {
  try {
    const c = await apiFetch(`/api/complaints/${id}`);
    currentComplaintId = id;
    const statusLabelMap = { aperta: 'Aperta', in_gestione: 'In gestione', risolta: 'Risolta' };
    document.getElementById('complaint-modal-title').textContent = `Segnalazione #${c.id} — ${COMPLAINT_TYPE_LABEL[c.type] || c.type}`;
    document.getElementById('complaint-modal-body').innerHTML = `
      <div class="form-group">
        <label>Cliente</label>
        <div style="padding:9px 13px;background:var(--cream);border-radius:var(--radius-sm);font-size:14px">
          ${c.customer_name} · ${c.customer_phone}${c.order_id ? ` · Ordine #${c.order_id}` : ''}
        </div>
      </div>
      <div class="form-group">
        <label>Stato</label>
        <select id="cm-status">
          <option value="aperta"      ${c.status === 'aperta'      ? 'selected' : ''}>Aperta</option>
          <option value="in_gestione" ${c.status === 'in_gestione' ? 'selected' : ''}>In gestione</option>
          <option value="risolta"     ${c.status === 'risolta'     ? 'selected' : ''}>Risolta</option>
        </select>
      </div>
      <div class="form-group">
        <label>Descrizione cliente</label>
        <div style="padding:9px 13px;background:var(--cream);border-radius:var(--radius-sm);font-size:14px;line-height:1.5">${c.description}</div>
      </div>
      <div class="form-group">
        <label>Note staff</label>
        <textarea id="cm-notes" placeholder="Come è stato gestito, soluzione adottata...">${c.staff_notes || ''}</textarea>
      </div>
    `;
    document.getElementById('modal-complaint').style.display = 'flex';
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

async function saveComplaintNotes() {
  if (!currentComplaintId) return;
  try {
    await apiFetch(`/api/complaints/${currentComplaintId}`, {
      method: 'PATCH',
      body: {
        status: document.getElementById('cm-status').value,
        staff_notes: document.getElementById('cm-notes').value.trim(),
      }
    });
    closeModal('modal-complaint');
    toast('Segnalazione aggiornata');
    loadComplaints();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

function openNewComplaintModal() {
  document.getElementById('complaint-form').reset();
  document.getElementById('modal-new-complaint').style.display = 'flex';
}

async function submitComplaint() {
  const body = {
    customer_name:  document.getElementById('nc-name').value.trim(),
    customer_phone: document.getElementById('nc-phone').value.trim(),
    type:           document.getElementById('nc-type').value,
    description:    document.getElementById('nc-description').value.trim(),
    order_id:       document.getElementById('nc-order-id').value || null,
  };
  try {
    await apiFetch('/api/complaints', { method: 'POST', body });
    closeModal('modal-new-complaint');
    toast('Segnalazione registrata');
    loadComplaints();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

// ─── INIT ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Nav
  document.querySelectorAll('[data-view]').forEach(a => {
    a.addEventListener('click', () => navigate(a.dataset.view));
  });

  navigate('dashboard');
});
