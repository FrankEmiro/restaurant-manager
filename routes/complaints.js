const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/complaints
router.get('/', (req, res) => {
  try {
    const { status, from, to } = req.query;
    let query = 'SELECT * FROM complaints WHERE 1=1';
    const params = [];
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (from)   { query += ' AND date(created_at) >= ?'; params.push(from); }
    if (to)     { query += ' AND date(created_at) <= ?'; params.push(to); }
    query += ' ORDER BY created_at DESC';
    res.json(db.prepare(query).all(...params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/complaints/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM complaints WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Segnalazione non trovata' });
  res.json(row);
});

// POST /api/complaints
router.post('/', (req, res) => {
  try {
    const { customer_name, customer_phone, order_id, type, description } = req.body;
    if (!customer_name || !customer_phone || !type || !description) {
      return res.status(400).json({ error: 'Campi obbligatori: customer_name, customer_phone, type, description' });
    }
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO complaints (customer_name, customer_phone, order_id, type, description, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'aperta', ?)
    `).run(customer_name, customer_phone, order_id || null, type, description, now);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/complaints/:id
router.patch('/:id', (req, res) => {
  try {
    const allowed = ['status', 'staff_notes'];
    const updates = [];
    const vals = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { updates.push(`${key} = ?`); vals.push(req.body[key]); }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nessun campo da aggiornare' });
    vals.push(req.params.id);
    db.prepare(`UPDATE complaints SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/complaints/:id
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM complaints WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
