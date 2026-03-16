const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/menu
router.get('/', (req, res) => {
  const { category } = req.query;
  let query = 'SELECT * FROM menu_items';
  const params = [];
  if (category) {
    query += ' WHERE category = ?';
    params.push(category);
  }
  query += ' ORDER BY category, name';
  const items = db.prepare(query).all(...params);
  res.json(items);
});

// POST /api/menu
router.post('/', (req, res) => {
  const { name, category, price, description = '', available = 1, vegetarian = 0, vegan = 0 } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name e price sono obbligatori' });
  }
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO menu_items (name, category, price, description, available, vegetarian, vegan, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, category, price, description, available, vegetarian ? 1 : 0, vegan ? 1 : 0, now);
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(item);
});

// PATCH /api/menu/:id
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const allowed = ['name', 'category', 'price', 'description', 'available', 'vegetarian', 'vegan'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nessun campo da aggiornare' });
  }
  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), id];
  db.prepare(`UPDATE menu_items SET ${setClauses} WHERE id = ?`).run(...values);
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'Piatto non trovato' });
  res.json(item);
});

// DELETE /api/menu/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const item = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'Piatto non trovato' });
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
