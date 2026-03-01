const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/tables
router.get('/', (req, res) => {
  const tables = db.prepare('SELECT * FROM tables WHERE active = 1 ORDER BY id').all();
  res.json(tables);
});

// POST /api/tables
router.post('/', (req, res) => {
  const { number, capacity, x = 50, y = 50, shape = 'round' } = req.body;
  if (!number || !capacity) {
    return res.status(400).json({ error: 'number e capacity sono obbligatori' });
  }
  const result = db.prepare(`
    INSERT INTO tables (number, capacity, x, y, shape, status, active)
    VALUES (?, ?, ?, ?, ?, 'free', 1)
  `).run(number, capacity, x, y, shape);
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(table);
});

// PATCH /api/tables/:id
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const allowed = ['number', 'capacity', 'x', 'y', 'shape', 'status', 'active'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nessun campo da aggiornare' });
  }
  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), id];
  db.prepare(`UPDATE tables SET ${setClauses} WHERE id = ?`).run(...values);
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
  if (!table) return res.status(404).json({ error: 'Tavolo non trovato' });
  res.json(table);
});

// DELETE /api/tables/:id (soft delete)
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE tables SET active = 0 WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
