// Esegui con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const express = require('express');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rist-print-')), 'test.db');
const db = require('../db');

const app = express();
app.use('/api/alerts', require('../routes/alerts'));
app.use('/print', require('../routes/print'));
let server, base;
test.before(async () => {
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const EVIL = '<img src=x onerror="alert(1)">';

test('comanda: stampa piatti, allergie e note, con il testo dei clienti scappato', async () => {
  const oid = Number(db.prepare("INSERT INTO takeaway_orders (customer_name, customer_phone, pickup_date, pickup_time, notes, status, total) VALUES (?, '333', '2026-10-17', '20:15', ?, 'pending', 18.5)").run(EVIL, '<b>senza cipolla</b>').lastInsertRowid);
  db.prepare("INSERT INTO order_items (order_id, menu_item_id, item_name, item_price, quantity) VALUES (?, 1, 'Carbonara', 9.25, 2)").run(oid);
  db.prepare("INSERT INTO order_allergens (order_id, allergen_id, allergen_name) VALUES (?, 1, 'Glutine')").run(oid);

  const html = await (await fetch(`${base}/print/order/${oid}`)).text();
  assert.match(html, /20:15/);
  assert.match(html, /2×/);
  assert.match(html, /Carbonara/);
  assert.match(html, /ALLERGIE: Glutine/);
  assert.ok(!html.includes('<img src=x'), 'il tag del cliente deve essere scappato');
  assert.ok(!html.includes('<b>senza cipolla</b>'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(!html.includes('window.print()'), 'niente stampa automatica senza autoprint');
  assert.match(await (await fetch(`${base}/print/order/${oid}?autoprint=1`)).text(), /window\.print\(\)/);
});

test('comanda inesistente: 404', async () => {
  assert.equal((await fetch(`${base}/print/order/99999`)).status, 404);
});

test('foglio del giorno: coperti, tavoli e sezioni; cancellate escluse', async () => {
  db.exec('DELETE FROM reservations');
  const ins = db.prepare("INSERT INTO reservations (customer_name, customer_phone, date, time, guests, notes, status) VALUES (?, '1', '2026-10-17', ?, ?, ?, ?)");
  ins.run('Rossi', '13:00', 4, '', 'confirmed');
  ins.run(EVIL, '20:30', 6, 'compleanno', 'confirmed');
  ins.run('Annullata', '21:00', 10, '', 'cancelled');
  const html = await (await fetch(`${base}/print/day?date=2026-10-17`)).text();
  assert.match(html, /<b>10<\/b>coperti prenotati/);        // 4 + 6, la cancellata non conta
  assert.match(html, /<b>2<\/b>prenotazioni/);
  assert.ok(!html.includes('Annullata'));
  assert.match(html, /compleanno/);
  assert.match(html, /Carbonara/);                          // anche l'asporto del giorno
  assert.ok(!html.includes('<img src=x'));
});

test('foglio del giorno: data non valida usa oggi, non va in errore', async () => {
  const res = await fetch(`${base}/print/day?date=non-una-data`);
  assert.equal(res.status, 200);
});

test('avvisi: restituisce gli ultimi id e gli ordini in attesa', async () => {
  const a = await (await fetch(`${base}/api/alerts`)).json();
  assert.ok(a.orders >= 1);
  assert.ok(a.reservations >= 1);
  assert.equal(typeof a.pendingOrders, 'number');
  const before = a.orders;
  db.prepare("INSERT INTO takeaway_orders (customer_name, customer_phone, pickup_date, pickup_time, status, total) VALUES ('x','1','2026-10-17','21:00','pending',5)").run();
  assert.ok((await (await fetch(`${base}/api/alerts`)).json()).orders > before);
});
