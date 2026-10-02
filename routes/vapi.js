const express = require('express');
const router = express.Router();
const db = require('../db');
const { vapiMiddleware } = require('../vapi/handler');
const booking = require('../lib/booking');

// Messaggio per l'assistente: motivo del rifiuto (con eventuali alternative già dentro il testo)
const refuse = (res, r) => res.vapiError(r.message);

// POST /vapi/reservations/create
router.post('/reservations/create', vapiMiddleware, (req, res) => {
  try {
    const p = req.vapiParams;
    const { customer_name, customer_phone, date, time, guests, notes = '' } = p;

    if (!customer_name || !customer_phone || !date || !time || !guests) {
      return res.vapiError('Dati mancanti. Servono: nome cliente, telefono, data (YYYY-MM-DD), orario (HH:MM), numero ospiti.');
    }

    // Controlla orari, chiusure, turni e assegna il tavolo: niente più overbooking
    const r = booking.reserve({ customer_name, customer_phone, date, time, guests, notes });
    if (!r.ok) return refuse(res, r);

    const n = parseInt(guests, 10);
    const dateFormatted = booking.fmtDate(date);
    res.vapiSuccess(`Prenotazione confermata! ${customer_name}, ${n} ${n === 1 ? 'persona' : 'persone'}, ${dateFormatted} alle ${time}. ID prenotazione: ${r.id}.${notes ? ' Note: ' + notes : ''}`);
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
    // Orari di apertura, preparazione minima e limite di ordini per fascia
    const slot = booking.checkTakeaway({ date: pickup_date, time: pickup_time });
    if (!slot.ok) return refuse(res, slot);
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

// POST /vapi/reservations/list
router.post('/reservations/list', vapiMiddleware, (req, res) => {
  try {
    const { customer_phone, customer_name, date } = req.vapiParams;
    if (!customer_phone && !customer_name) {
      return res.vapiError('Specifica almeno il telefono o il nome del cliente per cercare le prenotazioni.');
    }

    let query = "SELECT id, customer_name, customer_phone, date, time, guests, notes, status FROM reservations WHERE status = 'confirmed'";
    const params = [];

    if (customer_phone) {
      query += ' AND customer_phone = ?'; params.push(customer_phone);
    } else if (customer_name) {
      query += ' AND customer_name LIKE ?'; params.push(`%${customer_name}%`);
    }
    if (date) {
      query += ' AND date = ?'; params.push(date);
    }
    query += ' ORDER BY date, time LIMIT 5';

    const rows = db.prepare(query).all(...params);
    if (rows.length === 0) {
      return res.vapiSuccess('Nessuna prenotazione attiva trovata per questo cliente.');
    }

    const list = rows.map(r => {
      const df = new Date(r.date + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
      return `ID ${r.id}: ${df} alle ${r.time}, ${r.guests} ospiti${r.notes ? ', note: ' + r.notes : ''}`;
    }).join(' — ');
    res.vapiSuccess(`Prenotazioni trovate: ${list}.`);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// POST /vapi/reservations/update
router.post('/reservations/update', vapiMiddleware, (req, res) => {
  try {
    const p = req.vapiParams;
    const { customer_phone, date: searchDate } = p;

    let reservation = null;
    if (p.reservation_id) {
      reservation = db.prepare("SELECT * FROM reservations WHERE id = ? AND status = 'confirmed'").get(p.reservation_id);
    } else if (customer_phone && searchDate) {
      reservation = db.prepare("SELECT * FROM reservations WHERE customer_phone = ? AND date = ? AND status = 'confirmed' ORDER BY time LIMIT 1").get(customer_phone, searchDate);
    }
    if (!reservation || !reservation.id) return res.vapiError('Prenotazione non trovata. Specifica ID oppure telefono e data.');

    const finalDate = p.new_date || reservation.date;
    const finalTime = p.new_time || reservation.time;
    const finalGuests = p.guests ? parseInt(p.guests, 10) : reservation.guests;
    const changesSlot = p.new_date || p.new_time || p.guests;

    if (!changesSlot && p.notes === undefined) return res.vapiError('Nessun campo da aggiornare. Specifica new_date, new_time, guests o notes.');

    // Se cambia data, orario o persone: riverifica le regole e riassegna il tavolo
    let tableId = reservation.table_id;
    if (changesSlot) {
      const chk = booking.checkReservation({ date: finalDate, time: finalTime, guests: finalGuests, excludeId: reservation.id });
      if (!chk.ok) return refuse(res, chk);
      tableId = chk.table.id;
    }

    db.prepare('UPDATE reservations SET date = ?, time = ?, guests = ?, table_id = ?, notes = ? WHERE id = ?')
      .run(finalDate, finalTime, finalGuests, tableId, p.notes !== undefined ? p.notes : reservation.notes, reservation.id);

    res.vapiSuccess(`Prenotazione ID ${reservation.id} aggiornata: ${reservation.customer_name}, ${finalGuests} ${finalGuests === 1 ? 'persona' : 'persone'}, ${booking.fmtDate(finalDate)} alle ${finalTime}.`);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// POST /vapi/orders/list
router.post('/orders/list', vapiMiddleware, (req, res) => {
  try {
    const { customer_phone, customer_name, pickup_date } = req.vapiParams;
    if (!customer_phone && !customer_name) {
      return res.vapiError('Specifica almeno il telefono o il nome del cliente per cercare gli ordini.');
    }

    let query = "SELECT id, customer_name, customer_phone, pickup_date, pickup_time, status, total, notes FROM takeaway_orders WHERE status NOT IN ('picked_up')";
    const params = [];

    if (customer_phone) {
      query += ' AND customer_phone = ?'; params.push(customer_phone);
    } else if (customer_name) {
      query += ' AND customer_name LIKE ?'; params.push(`%${customer_name}%`);
    }
    if (pickup_date) {
      query += ' AND pickup_date = ?'; params.push(pickup_date);
    }
    query += ' ORDER BY pickup_date, pickup_time LIMIT 5';

    const rows = db.prepare(query).all(...params);
    if (rows.length === 0) {
      return res.vapiSuccess('Nessun ordine attivo trovato per questo cliente.');
    }

    const statusLabel = { pending: 'in attesa', preparing: 'in preparazione', ready: 'pronto' };
    const list = rows.map(o => {
      const df = new Date(o.pickup_date + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
      return `ID ${o.id}: ritiro ${df} alle ${o.pickup_time}, stato: ${statusLabel[o.status] || o.status}, totale €${(o.total||0).toFixed(2)}`;
    }).join(' — ');
    res.vapiSuccess(`Ordini trovati: ${list}.`);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// POST /vapi/orders/cancel
router.post('/orders/cancel', vapiMiddleware, (req, res) => {
  try {
    const { order_id, customer_phone, pickup_date } = req.vapiParams;

    let order = null;
    if (order_id) {
      order = db.prepare("SELECT * FROM takeaway_orders WHERE id = ? AND status NOT IN ('picked_up','cancelled')").get(order_id);
    } else if (customer_phone && pickup_date) {
      order = db.prepare("SELECT * FROM takeaway_orders WHERE customer_phone = ? AND pickup_date = ? AND status NOT IN ('picked_up','cancelled') ORDER BY pickup_time LIMIT 1").get(customer_phone, pickup_date);
    } else if (customer_phone) {
      order = db.prepare("SELECT * FROM takeaway_orders WHERE customer_phone = ? AND status NOT IN ('picked_up','cancelled') ORDER BY pickup_date, pickup_time LIMIT 1").get(customer_phone);
    }

    if (!order) return res.vapiError('Ordine non trovato o già completato/annullato.');

    db.prepare("UPDATE takeaway_orders SET status = 'cancelled' WHERE id = ?").run(order.id);
    const df = new Date(order.pickup_date + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    res.vapiSuccess(`Ordine ID ${order.id} di ${order.customer_name} (ritiro ${df} alle ${order.pickup_time}) annullato con successo.`);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// POST /vapi/orders/update  (modifica orario/data ritiro e note — non i piatti)
router.post('/orders/update', vapiMiddleware, (req, res) => {
  try {
    const p = req.vapiParams;
    const { order_id, customer_phone, pickup_date: searchDate } = p;

    let order = null;
    if (order_id) {
      order = db.prepare("SELECT * FROM takeaway_orders WHERE id = ? AND status IN ('pending','preparing')").get(order_id);
    } else if (customer_phone && searchDate) {
      order = db.prepare("SELECT * FROM takeaway_orders WHERE customer_phone = ? AND pickup_date = ? AND status IN ('pending','preparing') ORDER BY pickup_time LIMIT 1").get(customer_phone, searchDate);
    } else if (customer_phone) {
      order = db.prepare("SELECT * FROM takeaway_orders WHERE customer_phone = ? AND status IN ('pending','preparing') ORDER BY pickup_date, pickup_time LIMIT 1").get(customer_phone);
    }
    if (!order) return res.vapiError('Ordine non trovato o non modificabile (già pronto/annullato). Specifica ID oppure telefono.');

    const updates = [];
    const vals = [];
    if (p.new_pickup_date || p.new_pickup_time) {
      const slot = booking.checkTakeaway({ date: p.new_pickup_date || order.pickup_date, time: p.new_pickup_time || order.pickup_time, excludeId: order.id });
      if (!slot.ok) return refuse(res, slot);
    }
    if (p.new_pickup_date) { updates.push('pickup_date = ?'); vals.push(p.new_pickup_date); }
    if (p.new_pickup_time) { updates.push('pickup_time = ?'); vals.push(p.new_pickup_time); }
    if (p.notes !== undefined) { updates.push('notes = ?'); vals.push(p.notes); }

    if (updates.length === 0) return res.vapiError('Nessun campo da aggiornare. Specifica new_pickup_date, new_pickup_time o notes.');

    vals.push(order.id);
    db.prepare(`UPDATE takeaway_orders SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

    const finalDate = p.new_pickup_date || order.pickup_date;
    const finalTime = p.new_pickup_time || order.pickup_time;
    const df = new Date(finalDate + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    res.vapiSuccess(`Ordine ID ${order.id} aggiornato: ritiro ${df} alle ${finalTime}.`);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// POST /vapi/allergens  (alias: /vapi/get_allergens)
function handleGetAllergens(req, res) {
  try {
    const items = db.prepare('SELECT name, description FROM allergens ORDER BY id').all();
    if (items.length === 0) return res.vapiSuccess('Nessun allergene registrato.');
    const list = items.map(a => a.description ? `${a.name} (${a.description})` : a.name).join('; ');
    res.vapiSuccess('Allergeni registrati: ' + list);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
}
router.post('/allergens', vapiMiddleware, handleGetAllergens);
router.post('/get_allergens', vapiMiddleware, handleGetAllergens);

// POST /vapi/menu  (VAPI always POSTs — params come from body via vapiMiddleware)
router.post('/menu', vapiMiddleware, (req, res) => {
  try {
    const { category } = req.vapiParams;
    let query = 'SELECT id, name, category, price FROM menu_items WHERE available = 1';
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
      grouped[item.category].push(`${item.name} (id:${item.id}) €${item.price.toFixed(2)}`);
    }
    const menuText = Object.entries(grouped)
      .map(([cat, list]) => `${cat}: ${list.join(', ')}`)
      .join('. ');

    res.vapiSuccess('Menu disponibile. ' + menuText);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// POST /vapi/availability  (VAPI always POSTs — params come from body via vapiMiddleware)
router.post('/availability', vapiMiddleware, (req, res) => {
  try {
    const { date, time, guests } = req.vapiParams;
    if (!date) {
      return res.vapiError('Specifica una data (YYYY-MM-DD) per verificare la disponibilità.');
    }
    const n = guests ? parseInt(guests, 10) : 2;
    const dateFormatted = booking.fmtDate(date);

    if (time) {
      const chk = booking.checkReservation({ date, time, guests: n });
      if (!chk.ok) return refuse(res, chk);
      return res.vapiSuccess(`Sì, il ${dateFormatted} alle ${time} c'è posto per ${n} ${n === 1 ? 'persona' : 'persone'}. Posso procedere con la prenotazione?`);
    }

    // Senza orario: indica quando c'è posto (ogni mezz'ora)
    const day = booking.checkReservation({ date, time: '12:00', guests: n });
    if (['closed', 'bad_date', 'party_too_large', 'no_tables', 'bad_guests'].includes(day.code)) return refuse(res, day);

    const free = booking.validStarts(date, booking.localNow())
      .filter(t => t % 30 === 0 && booking.assignment(date, booking.fromMin(t), n).table)
      .map(booking.fromMin);
    if (free.length === 0) return res.vapiSuccess(`Il ${dateFormatted} non c'è più posto per ${n} ${n === 1 ? 'persona' : 'persone'}.`);
    res.vapiSuccess(`Il ${dateFormatted} c'è posto per ${n} ${n === 1 ? 'persona' : 'persone'} alle ${free.slice(0, 8).join(', ')}${free.length > 8 ? ' e altri orari' : ''}. Quale preferisce?`);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// POST /vapi/hours  — orari di apertura, chiusure e regole di prenotazione/asporto
router.post('/hours', vapiMiddleware, (req, res) => {
  try {
    res.vapiSuccess(booking.describeRules());
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

// POST /vapi/complaints/create
router.post('/complaints/create', vapiMiddleware, (req, res) => {
  try {
    const p = req.vapiParams;
    const { customer_name, customer_phone, order_id, description } = p;
    const type = p.issue_type || p.type;
    if (!customer_name || !customer_phone || !type || !description) {
      return res.vapiError('Dati mancanti. Servono: nome cliente, telefono, tipo problema e descrizione.');
    }
    const validTypes = ['ordine_sbagliato', 'ritardo', 'qualita', 'qualita_scarsa', 'mancanza_articoli', 'altro'];
    if (!validTypes.includes(type)) {
      return res.vapiError(`Tipo non valido. Usa uno di: ${validTypes.join(', ')}.`);
    }
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO complaints (customer_name, customer_phone, order_id, type, description, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'aperta', ?)
    `).run(customer_name, customer_phone, order_id || null, type, description, now);
    res.vapiSuccess(`Segnalazione registrata con successo. ID: ${result.lastInsertRowid}. Il nostro staff la contatterà al più presto per risolvere il problema. Ci scusiamo per l'inconveniente.`);
  } catch (err) {
    res.vapiError('Errore interno: ' + err.message);
  }
});

module.exports = router;
