const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/reservations
router.get('/', (req, res) => {
  const { date } = req.query;
  let query = `
    SELECT r.*, t.number as table_number, t.capacity as table_capacity
    FROM reservations r
    LEFT JOIN tables t ON r.table_id = t.id
  `;
  const params = [];
  if (date) {
    query += ' WHERE r.date = ?';
    params.push(date);
  }
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
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO reservations (customer_name, customer_phone, date, time, guests, table_id, notes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
  `).run(customer_name, customer_phone, date, time, guests, table_id || null, notes, now);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(result.lastInsertRowid);
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
  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), id];
  db.prepare(`UPDATE reservations SET ${setClauses} WHERE id = ?`).run(...values);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
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
