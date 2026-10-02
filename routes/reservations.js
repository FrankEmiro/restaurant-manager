const express = require('express');
const router = express.Router();
const db = require('../db');
const booking = require('../lib/booking');

// Avvisi per lo staff (non bloccanti): orari, chiusure, tavolo già occupato
function slotWarnings({ date, time, guests, tableId, excludeId }) {
  const out = [];
  const slot = booking.checkReservationSlot(date, time);
  if (!slot.ok) out.push(slot.message);
  if (tableId) {
    const turn = booking.getRules().turn;
    const clash = db.prepare("SELECT time FROM reservations WHERE date = ? AND table_id = ? AND status = 'confirmed' " + (excludeId ? 'AND id != ?' : ''))
      .all(...(excludeId ? [date, tableId, excludeId] : [date, tableId]))
      .find(r => Math.abs(booking.toMin(r.time) - booking.toMin(time)) < turn);
    if (clash) out.push(`Il tavolo scelto è già prenotato alle ${clash.time}.`);
    const t = db.prepare('SELECT number, capacity FROM tables WHERE id = ?').get(tableId);
    if (t && guests > t.capacity) out.push(`Il tavolo ${t.number} ha ${t.capacity} posti, per ${guests} persone potrebbe essere stretto.`);
  }
  return out;
}

// GET /api/reservations
router.get('/', (req, res) => {
  const { date, from, to } = req.query;
  let query = `
    SELECT r.*, t.number as table_number, t.capacity as table_capacity
    FROM reservations r
    LEFT JOIN tables t ON r.table_id = t.id
    WHERE 1=1
  `;
  const params = [];
  if (date) { query += ' AND r.date = ?'; params.push(date); }
  if (from) { query += ' AND r.date >= ?'; params.push(from); }
  if (to)   { query += ' AND r.date <= ?'; params.push(to); }
  query += ' ORDER BY r.date, r.time';
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// POST /api/reservations
router.post('/', (req, res) => {
  const { customer_name, customer_phone, date, time, guests, table_id, notes = '' } = req.body;
  if (!customer_name || !customer_phone || !date || !time || !guests) {
    return res.status(400).json({ error: 'Campi obbligatori: customer_name, customer_phone, date, time, guests' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Formato data non valido. Usa YYYY-MM-DD' });
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: 'Formato orario non valido. Usa HH:MM' });
  }
  if (!booking.isDate(date) || !booking.isTime(time)) {
    return res.status(400).json({ error: 'Data o orario non validi' });
  }
  const nGuests = parseInt(guests, 10);
  if (!Number.isInteger(nGuests) || nGuests < 1) return res.status(400).json({ error: 'Numero di persone non valido' });

  const warnings = [];
  let tid = table_id || null;
  if (!tid) {
    const a = booking.assignment(date, time, nGuests);
    if (a.table) tid = a.table.id;
    else warnings.push('Nessun tavolo libero a quell\'ora: prenotazione registrata senza tavolo.');
  }
  warnings.push(...slotWarnings({ date, time, guests: nGuests, tableId: tid }));

  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO reservations (customer_name, customer_phone, date, time, guests, table_id, notes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
  `).run(customer_name, customer_phone, date, time, nGuests, tid, notes, now);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(result.lastInsertRowid);
  if (warnings.length) reservation.warning = warnings.join(' ');
  res.status(201).json(reservation);
});

// GET /api/reservations/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT r.*, t.number as table_number
    FROM reservations r
    LEFT JOIN tables t ON r.table_id = t.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Prenotazione non trovata' });
  res.json(row);
});

// PATCH /api/reservations/:id
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM reservations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Prenotazione non trovata' });

  const allowed = ['customer_name', 'customer_phone', 'date', 'time', 'guests', 'table_id', 'notes', 'status'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nessun campo da aggiornare' });
  }

  const warnings = [];
  const before = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const slotChanged = ['date', 'time', 'guests', 'table_id'].some(k => updates[k] !== undefined);
  if (slotChanged && (updates.status === undefined || updates.status === 'confirmed')) {
    const date = updates.date ?? before.date;
    const time = updates.time ?? before.time;
    const guests = parseInt(updates.guests ?? before.guests, 10);
    if (!booking.isDate(date) || !booking.isTime(time)) return res.status(400).json({ error: 'Data o orario non validi' });

    let tid = updates.table_id !== undefined ? updates.table_id : before.table_id;
    // Nessun tavolo (o scelta "da assegnare"): tengo quello attuale se è ancora libero, altrimenti ne cerco un altro
    if (!tid || updates.table_id === null) {
      const a = booking.assignment(date, time, guests, { excludeId: before.id });
      tid = a.table ? a.table.id : null;
      if (!tid) warnings.push('Nessun tavolo libero a quell\'ora: la prenotazione resta senza tavolo.');
    }
    updates.table_id = tid;
    warnings.push(...slotWarnings({ date, time, guests, tableId: tid, excludeId: before.id }));
  }
  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), id];
  db.prepare(`UPDATE reservations SET ${setClauses} WHERE id = ?`).run(...values);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (warnings.length) reservation.warning = warnings.join(' ');
  res.json(reservation);
});

// DELETE /api/reservations/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM reservations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Prenotazione non trovata' });
  db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
