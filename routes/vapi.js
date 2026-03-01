const express = require('express');
const router = express.Router();
const db = require('../db');
const { vapiMiddleware } = require('../vapi/handler');

// POST /vapi/reservations/create
router.post('/reservations/create', vapiMiddleware, (req, res) => {
  try {
    const p = req.vapiParams;
    const { customer_name, customer_phone, date, time, guests, notes = '' } = p;

    if (!customer_name || !customer_phone || !date || !time || !guests) {
      return res.vapiError('Dati mancanti. Servono: nome cliente, telefono, data (YYYY-MM-DD), orario (HH:MM), numero ospiti.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.vapiError('Data non valida. Usa il formato YYYY-MM-DD, ad esempio 2026-03-15.');
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return res.vapiError('Orario non valido. Usa il formato HH:MM, ad esempio 20:30.');
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO reservations (customer_name, customer_phone, date, time, guests, notes, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)
    `).run(customer_name, customer_phone, date, time, guests, notes, now);

    const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    const msg = `Prenotazione confermata! ${customer_name}, ${guests} ${guests === 1 ? 'persona' : 'persone'}, ${dateFormatted} alle ${time}. ID prenotazione: ${result.lastInsertRowid}.${notes ? ' Note: ' + notes : ''}`;
    res.vapiSuccess(msg);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// POST /vapi/reservations/cancel
router.post('/reservations/cancel', vapiMiddleware, (req, res) => {
  try {
    const p = req.vapiParams;
    const { reservation_id, customer_name, customer_phone, date } = p;

    let reservation = null;

    if (reservation_id) {
      reservation = db.prepare('SELECT * FROM reservations WHERE id = ? AND status = ?').get(reservation_id, 'confirmed');
    } else if (customer_phone && date) {
      reservation = db.prepare(`
        SELECT * FROM reservations WHERE customer_phone = ? AND date = ? AND status = 'confirmed'
        ORDER BY time LIMIT 1
      `).get(customer_phone, date);
    } else if (customer_name && date) {
      reservation = db.prepare(`
        SELECT * FROM reservations WHERE customer_name LIKE ? AND date = ? AND status = 'confirmed'
        ORDER BY time LIMIT 1
      `).get(`%${customer_name}%`, date);
    }

    if (!reservation) {
      return res.vapiError('Prenotazione non trovata. Verifica i dati forniti.');
    }

    db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(reservation.id);
    const dateFormatted = new Date(reservation.date + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    res.vapiSuccess(`Prenotazione di ${reservation.customer_name} del ${dateFormatted} alle ${reservation.time} cancellata con successo.`);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// POST /vapi/orders/create
router.post('/orders/create', vapiMiddleware, (req, res) => {
  try {
    const p = req.vapiParams;
    const { customer_name, customer_phone, pickup_date, pickup_time, notes = '', items = [] } = p;

    if (!customer_name || !customer_phone || !pickup_date || !pickup_time) {
      return res.vapiError('Dati mancanti. Servono: nome cliente, telefono, data ritiro (YYYY-MM-DD), orario ritiro (HH:MM).');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickup_date)) {
      return res.vapiError('Data non valida. Usa il formato YYYY-MM-DD.');
    }
    if (!/^\d{2}:\d{2}$/.test(pickup_time)) {
      return res.vapiError('Orario non valido. Usa il formato HH:MM.');
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.vapiError('Inserisci almeno un articolo nell\'ordine.');
    }

    let total = 0;
    const resolvedItems = [];
    for (const item of items) {
      if (!item.menu_item_id || !item.quantity || item.quantity < 1) {
        return res.vapiError('Ogni articolo richiede menu_item_id e quantity maggiore di zero.');
      }
      const menuItem = db.prepare('SELECT * FROM menu_items WHERE id = ? AND available = 1').get(item.menu_item_id);
      if (!menuItem) {
        return res.vapiError(`Il piatto con id ${item.menu_item_id} non è disponibile.`);
      }
      resolvedItems.push({ ...item, name: menuItem.name, price: menuItem.price });
      total += menuItem.price * item.quantity;
    }
    total = Math.round(total * 100) / 100;

    const now = new Date().toISOString();
    const orderId = db.withTransaction(() => {
      const result = db.prepare(`
        INSERT INTO takeaway_orders (customer_name, customer_phone, pickup_date, pickup_time, notes, status, total, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(customer_name, customer_phone, pickup_date, pickup_time, notes, total, now);
      const oid = result.lastInsertRowid;
      for (const item of resolvedItems) {
        db.prepare(`
          INSERT INTO order_items (order_id, menu_item_id, item_name, item_price, quantity)
          VALUES (?, ?, ?, ?, ?)
        `).run(oid, item.menu_item_id, item.name, item.price, item.quantity);
      }
      return oid;
    });
    const itemsList = resolvedItems.map(i => `${i.quantity}x ${i.name}`).join(', ');
    const dateFormatted = new Date(pickup_date + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    const msg = `Ordine asporto confermato! ID: ${orderId}. Cliente: ${customer_name}. Ritiro: ${dateFormatted} alle ${pickup_time}. Articoli: ${itemsList}. Totale: €${total.toFixed(2)}.${notes ? ' Note: ' + notes : ''}`;
    res.vapiSuccess(msg);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// GET /vapi/menu
router.get('/menu', vapiMiddleware, (req, res) => {
  try {
    const { category } = req.query;
    let query = 'SELECT name, category, price, description FROM menu_items WHERE available = 1';
    const params = [];
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    query += ' ORDER BY category, name';
    const items = db.prepare(query).all(...params);

    if (items.length === 0) {
      return res.vapiSuccess('Nessun piatto disponibile al momento.');
    }

    const grouped = {};
    for (const item of items) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(`${item.name} €${item.price.toFixed(2)}`);
    }
    const menuText = Object.entries(grouped)
      .map(([cat, list]) => `${cat}: ${list.join(', ')}`)
      .join('. ');

    res.vapiSuccess('Menu disponibile. ' + menuText);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// GET /vapi/availability
router.get('/availability', vapiMiddleware, (req, res) => {
  try {
    const { date, time, guests } = req.query;
    if (!date) {
      return res.vapiError('Specifica una data (YYYY-MM-DD) per verificare la disponibilità.');
    }

    const reservations = db.prepare(`
      SELECT table_id FROM reservations
      WHERE date = ? AND status = 'confirmed'
      ${time ? "AND time = ?" : ""}
    `).all(...(time ? [date, time] : [date]));

    const reservedTableIds = reservations.map(r => r.table_id).filter(Boolean);

    const allTables = db.prepare('SELECT * FROM tables WHERE active = 1').all();
    let availableTables = allTables.filter(t => !reservedTableIds.includes(t.id));

    if (guests) {
      availableTables = availableTables.filter(t => t.capacity >= parseInt(guests));
    }

    const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });

    if (availableTables.length === 0) {
      return res.vapiSuccess(`Non ci sono tavoli disponibili per ${guests ? guests + ' persone ' : ''}il ${dateFormatted}${time ? ' alle ' + time : ''}.`);
    }

    const msg = `Ci sono ${availableTables.length} tavoli disponibili per ${guests ? guests + ' persone ' : ''}il ${dateFormatted}${time ? ' alle ' + time : ''}. Posso procedere con la prenotazione?`;
    res.vapiSuccess(msg);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

module.exports = router;
