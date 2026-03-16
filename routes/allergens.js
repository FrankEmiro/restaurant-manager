const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/allergens
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM allergens ORDER BY id').all();
  res.json(rows);
});

// POST /api/allergens
router.post('/', (req, res) => {
  const { name, description = '' } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Il nome è obbligatorio' });
  }
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO allergens (name, description, created_at) VALUES (?, ?, ?)'
  ).run(name.trim(), description.trim(), now);
  const allergen = db.prepare('SELECT * FROM allergens WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(allergen);
});

// PATCH /api/allergens/:id
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM allergens WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Allergene non trovato' });

  const { name, description } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description.trim();
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nessun campo da aggiornare' });
  }
  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE allergens SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);
  const allergen = db.prepare('SELECT * FROM allergens WHERE id = ?').get(id);
  res.json(allergen);
});

// DELETE /api/allergens/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM allergens WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Allergene non trovato' });
  db.prepare('DELETE FROM allergens WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
