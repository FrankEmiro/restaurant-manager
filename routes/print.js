// Pagine pronte per la stampa: comanda per la cucina (carta termica 80 mm) e foglio del giorno (A4).
// Sono pagine HTML generate dal server, dietro il login: si aprono in una nuova scheda e partono con
// la stampa (autoprint=1). Ogni testo che arriva dai clienti passa da esc().
const router = require('express').Router();
const db = require('../db');
const cfg = require('../lib/config');
const booking = require('../lib/booking');

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const venue = () => cfg.get('RESTAURANT_NAME') || 'Rebel Ristoranti';
const eur = (n) => `€${Number(n || 0).toFixed(2)}`;
const STATUS = { pending: 'In attesa', preparing: 'In preparazione', ready: 'Pronto', picked_up: 'Ritirato' };

function page(title, css, body, autoprint) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${css}</style></head><body>${body}
${autoprint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250))</script>' : ''}
</body></html>`;
}

// ── Comanda (80 mm) ────────────────────────────────────────────────────────────
const TICKET_CSS = `
@page { size: 80mm auto; margin: 3mm; }
* { box-sizing: border-box; }
body { font-family: "Courier New", monospace; font-size: 13px; color: #000; width: 74mm; margin: 0 auto; }
h1 { font-size: 15px; text-align: center; margin: 0 0 4px; text-transform: uppercase; }
.sub { text-align: center; font-size: 11px; margin-bottom: 8px; }
.big { font-size: 30px; font-weight: 700; text-align: center; margin: 6px 0; letter-spacing: 1px; }
.row { display: flex; justify-content: space-between; gap: 8px; }
hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
.item { display: flex; gap: 8px; font-size: 16px; font-weight: 700; margin: 4px 0; }
.item .q { min-width: 28px; }
.allergy { border: 2px solid #000; padding: 5px; margin: 8px 0; font-weight: 700; text-transform: uppercase; }
.notes { margin: 6px 0; font-style: italic; }
.foot { font-size: 11px; text-align: center; margin-top: 8px; }
@media screen { body { padding: 12px; background: #fff; } }
`;

router.get('/order/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM takeaway_orders WHERE id = ?').get(req.params.id);
  if (!o || !o.id) return res.status(404).send('Ordine non trovato');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
  const allergens = db.prepare('SELECT allergen_name FROM order_allergens WHERE order_id = ?').all(o.id);
  const body = `
    <h1>${esc(venue())}</h1>
    <div class="sub">ASPORTO · ordine n° ${o.id}</div>
    <div class="big">${esc(o.pickup_time)}</div>
    <div class="sub">${esc(booking.fmtDate(o.pickup_date))}</div>
    <hr>
    <div><strong>${esc(o.customer_name)}</strong></div>
    <div>${esc(o.customer_phone)}</div>
    <hr>
    ${items.map(i => `<div class="item"><span class="q">${esc(i.quantity)}×</span><span>${esc(i.item_name)}</span></div>`).join('')}
    ${allergens.length ? `<div class="allergy">⚠ ALLERGIE: ${allergens.map(a => esc(a.allergen_name)).join(', ')}</div>` : ''}
    ${o.notes ? `<div class="notes">Note: ${esc(o.notes)}</div>` : ''}
    <hr>
    <div class="row"><span>Totale</span><strong>${esc(eur(o.total))}</strong></div>
    <div class="foot">Stampato ${esc(new Date().toLocaleString('it-IT', { timeZone: cfg.get('TIMEZONE') || 'Europe/Rome' }))}</div>`;
  res.type('html').send(page(`Comanda ${o.id}`, TICKET_CSS, body, req.query.autoprint === '1'));
});

// ── Foglio del giorno (A4) ─────────────────────────────────────────────────────
const DAY_CSS = `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 14px; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #111; }
.head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 4px; }
.meta { color: #444; font-size: 11px; }
.sum { display: flex; gap: 10px; margin: 10px 0 0; }
.sum div { border: 1px solid #111; padding: 6px 12px; border-radius: 4px; }
.sum b { font-size: 18px; display: block; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #111; padding: 4px 6px; }
td { padding: 5px 6px; border-bottom: 1px solid #ccc; vertical-align: top; }
td.t { font-weight: 700; white-space: nowrap; }
td.n { text-align: center; font-weight: 700; }
.allergy { font-weight: 700; border: 1.5px solid #111; padding: 1px 5px; display: inline-block; margin-top: 2px; text-transform: uppercase; }
.empty { color: #666; padding: 8px 0; }
.closed { padding: 10px; border: 2px solid #111; margin: 10px 0; font-weight: 700; }
.noprint { margin-bottom: 12px; }
@media print { .noprint { display: none; } }
`;

// Assegna una prenotazione a un servizio (pranzo/cena...) in base agli orari del giorno
function serviceLabel(time, services) {
  if (!services.length) return 'Servizio';
  const t = booking.toMin(time);
  const idx = services.findIndex(([o, c]) => t >= booking.toMin(o) && t <= booking.toMin(c));
  const i = idx >= 0 ? idx : (t < 17 * 60 ? 0 : services.length - 1);
  return services.length === 1 ? 'Servizio' : (i === 0 ? 'Pranzo' : i === 1 ? 'Cena' : `Servizio ${i + 1}`);
}

router.get('/day', (req, res) => {
  const date = booking.isDate(req.query.date) ? req.query.date : booking.localNow().date;
  const services = booking.servicesOn(date);
  const closure = booking.closureOn(date);
  const reservations = db.prepare(`
    SELECT r.*, t.number AS table_number FROM reservations r LEFT JOIN tables t ON r.table_id = t.id
    WHERE r.date = ? AND r.status IN ('confirmed','completed') ORDER BY r.time, r.id
  `).all(date);
  const orders = db.prepare("SELECT * FROM takeaway_orders WHERE pickup_date = ? AND status != 'cancelled' ORDER BY pickup_time, id").all(date);
  const itemsOf = db.prepare('SELECT quantity, item_name FROM order_items WHERE order_id = ?');
  const allergensOf = db.prepare('SELECT allergen_name FROM order_allergens WHERE order_id = ?');

  // coperti per servizio
  const byService = {};
  for (const r of reservations) {
    const k = serviceLabel(r.time, services);
    byService[k] = byService[k] || { count: 0, covers: 0 };
    byService[k].count++; byService[k].covers += r.guests;
  }
  const totalCovers = reservations.reduce((n, r) => n + r.guests, 0);

  const dayLabel = `${booking.DAY_NAMES[booking.weekday(date)]} ${booking.fmtDate(date)}`;
  const hoursLabel = closure ? `CHIUSO${closure.reason ? ` — ${closure.reason}` : ''}` : (services.length ? `Aperto ${services.map(([o, c]) => `${o}–${c}`).join(' · ')}` : 'CHIUSO');

  const resRows = reservations.map(r => `<tr>
      <td class="t">${esc(r.time)}</td><td>${esc(r.customer_name)}</td><td class="n">${esc(r.guests)}</td>
      <td class="n">${esc(r.table_number || '—')}</td><td>${esc(r.customer_phone)}</td><td>${r.notes ? `<strong>${esc(r.notes)}</strong>` : ''}</td></tr>`).join('');

  const ordRows = orders.map(o => {
    const its = itemsOf.all(o.id).map(i => `${esc(i.quantity)}× ${esc(i.item_name)}`).join('<br>');
    const al = allergensOf.all(o.id).map(a => esc(a.allergen_name)).join(', ');
    return `<tr><td class="t">${esc(o.pickup_time)}</td><td>${esc(o.customer_name)}<br><span class="meta">${esc(o.customer_phone)}</span></td>
      <td>${its}${al ? `<br><span class="allergy">Allergie: ${al}</span>` : ''}${o.notes ? `<br><em>${esc(o.notes)}</em>` : ''}</td>
      <td>${esc(STATUS[o.status] || o.status)}</td><td style="text-align:right">${esc(eur(o.total))}</td></tr>`;
  }).join('');

  const body = `
    <div class="noprint"><button onclick="window.print()">🖨 Stampa</button></div>
    <div class="head"><div><h1>${esc(venue())} — Foglio del giorno</h1><div class="meta">${esc(dayLabel)} · ${esc(hoursLabel)}</div></div>
      <div class="meta">Stampato ${esc(new Date().toLocaleString('it-IT', { timeZone: cfg.get('TIMEZONE') || 'Europe/Rome' }))}</div></div>
    ${closure || !services.length ? `<div class="closed">${esc(hoursLabel)}</div>` : ''}
    <div class="sum">
      <div><b>${esc(totalCovers)}</b>coperti prenotati</div>
      <div><b>${esc(reservations.length)}</b>prenotazioni</div>
      ${Object.keys(byService).length > 1 ? Object.entries(byService).map(([k, v]) => `<div><b>${esc(v.covers)}</b>coperti a ${esc(k.toLowerCase())} (${esc(v.count)})</div>`).join('') : ''}
      <div><b>${esc(orders.length)}</b>ordini asporto</div>
    </div>
    <h2>Prenotazioni</h2>
    ${reservations.length ? `<table><thead><tr><th>Ora</th><th>Cliente</th><th>Pers.</th><th>Tavolo</th><th>Telefono</th><th>Note</th></tr></thead><tbody>${resRows}</tbody></table>` : '<div class="empty">Nessuna prenotazione.</div>'}
    <h2>Asporto</h2>
    ${orders.length ? `<table><thead><tr><th>Ritiro</th><th>Cliente</th><th>Piatti</th><th>Stato</th><th style="text-align:right">Totale</th></tr></thead><tbody>${ordRows}</tbody></table>` : '<div class="empty">Nessun ordine.</div>'}`;
  res.type('html').send(page(`Foglio del giorno ${date}`, DAY_CSS, body, req.query.autoprint === '1'));
});

module.exports = router;
