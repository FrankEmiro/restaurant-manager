const express = require('express');
const router = express.Router();
const db = require('../db');

function getOrderWithItems(id) {
  const order = db.prepare('SELECT * FROM takeaway_orders WHERE id = ?').get(id);
  if (!order) return null;
  order.items = db.prepare(`
    SELECT oi.*, mi.name as current_name
    FROM order_items oi
    LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
    WHERE oi.order_id = ?
  `).all(id);
  return order;
}

// GET /api/orders
router.get('/', (req, res) => {
  const { date, from, to, status } = req.query;
  let query = 'SELECT * FROM takeaway_orders WHERE 1=1';
  const params = [];
  if (date)   { query += ' AND pickup_date = ?'; params.push(date); }
  if (from)   { query += ' AND pickup_date >= ?'; params.push(from); }
  if (to)     { query += ' AND pickup_date <= ?'; params.push(to); }
  if (status) { query += ' AND status = ?'; params.push(status); }
  query += ' ORDER BY pickup_date, pickup_time';
  const orders = db.prepare(query).all(...params);
  // Attach items
  const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  for (const o of orders) o.items = getItems.all(o.id);
  res.json(orders);
});

// POST /api/orders
router.post('/', (req, res) => {
  const { customer_name, customer_phone, pickup_date, pickup_time, notes = '', items = [] } = req.body;
  if (!customer_name || !customer_phone || !pickup_date || !pickup_time) {
    return res.status(400).json({ error: 'Campi obbligatori: customer_name, customer_phone, pickup_date, pickup_time' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickup_date)) {
    return res.status(400).json({ error: 'Formato data non valido. Usa YYYY-MM-DD' });
  }
  if (!/^\d{2}:\d{2}$/.test(pickup_time)) {
    return res.status(400).json({ error: 'Formato orario non valido. Usa HH:MM' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Inserisci almeno un articolo negli items' });
  }

  // Calculate total and validate items
  let total = 0;
  const resolvedItems = [];
  for (const item of items) {
    if (!item.menu_item_id || !item.quantity || item.quantity < 1) {
      return res.status(400).json({ error: 'Ogni item richiede menu_item_id e quantity > 0' });
    }
    const menuItem = db.prepare('SELECT * FROM menu_items WHERE id = ? AND available = 1').get(item.menu_item_id);
    if (!menuItem) {
      return res.status(400).json({ error: `Piatto con id ${item.menu_item_id} non trovato o non disponibile` });
    }
    resolvedItems.push({ ...item, name: menuItem.name, price: menuItem.price });
    total += menuItem.price * item.quantity;
  }
  total = Math.round(total * 100) / 100;

  const now = new Date().toISOString();
  const insertOrder = db.prepare(`
    INSERT INTO takeaway_orders (customer_name, customer_phone, pickup_date, pickup_time, notes, status, total, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, menu_item_id, item_name, item_price, quantity)
    VALUES (?, ?, ?, ?, ?)
  `);

  const orderId = db.withTransaction(() => {
    const result = insertOrder.run(customer_name, customer_phone, pickup_date, pickup_time, notes, total, now);
    const orderId = result.lastInsertRowid;
    for (const item of resolvedItems) {
      insertItem.run(orderId, item.menu_item_id, item.name, item.price, item.quantity);
    }
    return orderId;
  });
  res.status(201).json(getOrderWithItems(orderId));
});

// GET /api/orders/:id
router.get('/:id', (req, res) => {
  const order = getOrderWithItems(req.params.id);
  if (!order) return res.status(404).json({ error: 'Ordine non trovato' });
  res.json(order);
});

// PATCH /api/orders/:id
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM takeaway_orders WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Ordine non trovato' });

  const allowed = ['status', 'notes', 'pickup_date', 'pickup_time'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nessun campo da aggiornare' });
  }
  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), id];
  db.prepare(`UPDATE takeaway_orders SET ${setClauses} WHERE id = ?`).run(...values);
  res.json(getOrderWithItems(id));
});

// DELETE /api/orders/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM takeaway_orders WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Ordine non trovato' });
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
  db.prepare('DELETE FROM takeaway_orders WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
