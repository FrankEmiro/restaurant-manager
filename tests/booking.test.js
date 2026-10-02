// Esegui con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Database isolato per i test
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rist-test-')), 'test.db');
process.env.VAPI_BASE_URL = 'http://localhost:1';
const db = require('../db');
const cfg = require('../lib/config');
const b = require('../lib/booking');

// Lunedì 5 ottobre 2026, ore 10:00 (data fissa per test deterministici)
const NOW = { date: '2026-10-05', minutes: 10 * 60 };
const SAT = '2026-10-10';   // sabato
const MON = '2026-10-12';   // lunedì
const resetData = () => { db.exec('DELETE FROM reservations; DELETE FROM takeaway_orders; DELETE FROM tables;'); };

function setup() {
  resetData();
  const ins = db.prepare('INSERT INTO tables (number, capacity) VALUES (?, ?)');
  ins.run('T1', 2); ins.run('T2', 4); ins.run('T3', 6);
  cfg.set('OPENING_HOURS', JSON.stringify({
    lun: [], mar: [['12:00', '15:00'], ['19:00', '23:00']], mer: [['12:00', '15:00'], ['19:00', '23:00']],
    gio: [['12:00', '15:00'], ['19:00', '23:00']], ven: [['12:00', '15:00'], ['19:00', '23:00']],
    sab: [['12:00', '15:00'], ['19:00', '23:30']], dom: [['12:00', '15:00']]
  }));
  cfg.set('CLOSURES', JSON.stringify([{ from: '2026-12-24', to: '2026-12-26', reason: 'Natale' }]));
  for (const k of ['TURN_MINUTES', 'RES_LEAD_MINUTES', 'LAST_SEATING_MINUTES', 'TAKEAWAY_PREP_MINUTES', 'TAKEAWAY_MAX_PER_SLOT']) cfg.set(k, '');
}
const book = (over = {}) => b.reserve({ customer_name: 'Mario', customer_phone: '333', date: SAT, time: '20:00', guests: 2, ...over }, NOW);

test('prenota e assegna il tavolo più piccolo adatto', () => {
  setup();
  const r = book({ guests: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.table.number, 'T1');
  assert.equal(book({ guests: 3 }).table.number, 'T2');
});

test('non permette l\'overbooking: finiti i tavoli adatti, rifiuta e propone alternative', () => {
  setup();
  assert.equal(book({ guests: 6 }).ok, true);            // unico tavolo da 6
  const second = book({ guests: 6 });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'full');
  assert.ok(second.alternatives.length > 0, 'deve proporre altri orari');
  assert.ok(!second.alternatives.includes('20:00'));
});

test('il turno libera il tavolo dopo la sua durata', () => {
  setup();
  assert.equal(book({ time: '19:00', guests: 6 }).ok, true);
  assert.equal(book({ time: '20:00', guests: 6 }).ok, false); // 60 min dopo: ancora occupato (turno 90)
  assert.equal(book({ time: '20:30', guests: 6 }).ok, true);  // 90 min dopo: libero
});

test('una prenotazione cancellata libera il tavolo', () => {
  setup();
  const r = book({ guests: 6 });
  db.prepare("UPDATE reservations SET status='cancelled' WHERE id=?").run(r.id);
  assert.equal(book({ guests: 6 }).ok, true);
});

test('prenotazioni senza tavolo (vecchie) occupano comunque un tavolo', () => {
  setup();
  db.prepare("INSERT INTO reservations (customer_name, customer_phone, date, time, guests, status) VALUES ('Vecchia','1',?, '20:00', 6, 'confirmed')").run(SAT);
  assert.equal(book({ guests: 6 }).ok, false);
});

test('gruppi più grandi del tavolo massimo vanno al personale', () => {
  setup();
  const r = book({ guests: 9 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'party_too_large');
});

test('giorno di chiusura settimanale', () => {
  setup();
  const r = book({ date: MON });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'closed');
  assert.match(r.message, /lunedì siamo chiusi/);
});

test('chiusura per ferie con motivo', () => {
  setup();
  const r = book({ date: '2026-12-25' });
  assert.equal(r.code, 'closed');
  assert.match(r.message, /Natale/);
});

test('fuori orario di servizio', () => {
  setup();
  assert.equal(book({ time: '03:00' }).code, 'outside_hours');
  assert.equal(book({ time: '16:30' }).code, 'outside_hours');
  assert.match(book({ time: '16:30' }).message, /dalle 12:00 alle 15:00 e dalle 19:00 alle 23:30/);
});

test('ultima prenotazione prima della chiusura', () => {
  setup();
  assert.equal(book({ time: '22:45' }).ok, true);       // sabato chiude 23:30, -45 = 22:45
  assert.equal(book({ time: '23:00' }).code, 'outside_hours');
});

test('date nel passato e preavviso minimo', () => {
  setup();
  assert.equal(b.reserve({ customer_name: 'a', customer_phone: '1', date: '2026-10-02', time: '20:00', guests: 2 }, NOW).code, 'past');
  const today = { date: '2026-10-06', minutes: 19 * 60 + 50 }; // martedì 19:50
  const r = b.reserve({ customer_name: 'a', customer_phone: '1', date: '2026-10-06', time: '20:00', guests: 2 }, today);
  assert.equal(r.code, 'too_soon');
});

test('data inesistente e orario malformato', () => {
  setup();
  assert.equal(book({ date: '2026-02-31' }).code, 'bad_date');
  assert.equal(book({ time: '25:99' }).code, 'bad_time');
  assert.equal(book({ guests: 0 }).code, 'bad_guests');
});

test('senza tavoli configurati non accetta prenotazioni', () => {
  setup(); db.exec('DELETE FROM tables;');
  assert.equal(book().code, 'no_tables');
});

test('modifica: la prenotazione stessa non blocca il suo tavolo', () => {
  setup();
  const r = book({ guests: 6 });
  const chk = b.checkReservation({ date: SAT, time: '20:30', guests: 6, excludeId: r.id }, NOW);
  assert.equal(chk.ok, true);
});

test('asporto: preparazione minima', () => {
  setup();
  const soon = { date: '2026-10-06', minutes: 19 * 60 }; // martedì 19:00
  const r = b.checkTakeaway({ date: '2026-10-06', time: '19:10' }, soon);
  assert.equal(r.code, 'too_soon');
  assert.match(r.message, /19:30/);
  assert.equal(b.checkTakeaway({ date: '2026-10-06', time: '19:30' }, soon).ok, true);
});

test('asporto: limite per fascia di 15 minuti', () => {
  setup();
  const ins = db.prepare("INSERT INTO takeaway_orders (customer_name, customer_phone, pickup_date, pickup_time, status, total) VALUES ('x','1',?,?, 'pending', 10)");
  for (let i = 0; i < 4; i++) ins.run(SAT, '20:05');
  const r = b.checkTakeaway({ date: SAT, time: '20:10' }, NOW); // stessa fascia 20:00-20:14
  assert.equal(r.code, 'full');
  assert.ok(r.alternatives.length > 0);
  assert.equal(b.checkTakeaway({ date: SAT, time: '20:15' }, NOW).ok, true);
  db.prepare("UPDATE takeaway_orders SET status='cancelled' WHERE pickup_time='20:05'").run();
  assert.equal(b.checkTakeaway({ date: SAT, time: '20:10' }, NOW).ok, true);
});

test('asporto: solo negli orari di apertura', () => {
  setup();
  assert.equal(b.checkTakeaway({ date: SAT, time: '17:00' }, NOW).code, 'outside_hours');
  assert.equal(b.checkTakeaway({ date: MON, time: '20:00' }, NOW).code, 'closed');
});

test('descrizione a parole degli orari', () => {
  setup();
  const d = b.describeRules();
  assert.match(d, /lunedì chiuso/);
  assert.match(d, /da martedì a venerdì dalle 12:00 alle 15:00 e dalle 19:00 alle 23:00/);
  assert.match(d, /Natale/);
});

test('le alternative sono distanziate di almeno 30 minuti', () => {
  setup();
  assert.equal(book({ guests: 6, time: '20:00' }).ok, true);
  const r = book({ guests: 6, time: '20:30' });
  assert.equal(r.code, 'full');
  const mins = r.alternatives.map(b.toMin);
  for (let i = 1; i < mins.length; i++) assert.ok(mins[i] - mins[i - 1] >= 30, `troppo vicine: ${r.alternatives}`);
});
