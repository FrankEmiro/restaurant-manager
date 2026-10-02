// Esegui con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rist-report-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');
process.env.BACKUP_KEEP = '2';
const db = require('../db');
const cfg = require('../lib/config');
const report = require('../lib/report');
const backup = require('../lib/backup');

const NOW = { date: '2026-10-10', minutes: 12 * 60 };

function seed() {
  db.exec('DELETE FROM call_logs; DELETE FROM reservations; DELETE FROM takeaway_orders;');
  cfg.set('OPENING_HOURS', JSON.stringify(Object.fromEntries(['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'].map(k => [k, [['12:00', '15:00'], ['19:00', '23:00']]]))));
  cfg.set('AVG_SPEND_PER_COVER', '30');
  const call = db.prepare("INSERT INTO call_logs (vapi_call_id, status, duration_seconds, cost, started_at) VALUES (?, 'completed', ?, ?, ?)");
  call.run('c1', 100, 0.10, '2026-10-09T18:00:00Z');   // 20:00 locali: in orario
  call.run('c2', 60, 0.05, '2026-10-09T19:00:00Z');    // 21:00: in orario
  call.run('c3', 40, 0.05, '2026-10-09T01:30:00Z');    // 03:30: fuori orario
  call.run('vecchia', 50, 9, '2026-08-01T10:00:00Z');  // fuori periodo
  const res = db.prepare("INSERT INTO reservations (customer_name, customer_phone, date, time, guests, status, created_at, source, call_id) VALUES (?, '1', '2026-10-12', ?, ?, ?, ?, ?, ?)");
  res.run('A', '20:00', 4, 'confirmed', '2026-10-09T18:05:00Z', 'voice', 'c1');
  res.run('B', '20:30', 2, 'confirmed', '2026-10-09T19:05:00Z', 'voice', 'c2');
  res.run('C', '13:00', 6, 'cancelled', '2026-10-09T19:10:00Z', 'voice', 'c2');   // annullata: non conta
  res.run('D', '20:00', 3, 'confirmed', '2026-10-09T10:00:00Z', 'staff', null);   // fatta dallo staff
  const ord = db.prepare("INSERT INTO takeaway_orders (customer_name, customer_phone, pickup_date, pickup_time, status, total, created_at, source, call_id) VALUES (?, '1', '2026-10-10', '20:00', ?, ?, ?, ?, ?)");
  ord.run('E', 'pending', 40, '2026-10-09T18:30:00Z', 'voice', 'c1');
  ord.run('F', 'cancelled', 99, '2026-10-09T18:31:00Z', 'voice', 'c3');
  ord.run('G', 'pending', 15, '2026-10-09T11:00:00Z', 'staff', null);
}

test('report: conta solo ciò che ha fatto l\'assistente, escludendo annullate e fuori periodo', () => {
  seed();
  const r = report.build(30, NOW);
  assert.equal(r.calls.total, 3);                       // la chiamata di agosto è fuori periodo
  assert.equal(r.calls.cost, 0.20);
  assert.equal(r.reservations.byAssistant, 2);
  assert.equal(r.reservations.covers, 6);               // 4 + 2, la annullata da 6 non conta
  assert.equal(r.reservations.byStaff, 1);
  assert.equal(r.reservations.cancelled, 1);
  assert.equal(r.takeaway.byAssistant, 1);
  assert.equal(r.takeaway.revenue, 40);                 // l'ordine annullato da 99 non conta
  assert.equal(r.takeaway.byStaff, 1);
});

test('report: valore stimato = coperti × spesa media + asporto', () => {
  seed();
  const r = report.build(30, NOW);
  assert.equal(r.value.estimated, 6 * 30 + 40);         // 220
  assert.equal(r.assumptions.avgSpendPerCover, 30);
});

test('report: chiamate concluse con un\'azione e chiamate fuori orario', () => {
  seed();
  const r = report.build(30, NOW);
  assert.equal(r.calls.withAction, 2);                  // c1 e c2 (c3 ha solo un ordine annullato: nessuna azione valida)
  assert.equal(r.calls.actionRate, 67);
  assert.equal(r.calls.outOfHours, 1);                  // c3 alle 03:30
});

test('report: periodo non valido usa 30 giorni; la serie è giornaliera', () => {
  seed();
  assert.equal(report.build(5, NOW).days, 30);
  const r = report.build(7, NOW);
  assert.equal(r.series.length, 7);
  assert.equal(r.series[r.series.length - 1].date, '2026-10-10');
  assert.equal(r.series.find(s => s.date === '2026-10-09').calls, 3);
});

test('report: senza dati non va in errore', () => {
  db.exec('DELETE FROM call_logs; DELETE FROM reservations; DELETE FROM takeaway_orders;');
  const r = report.build(30, NOW);
  assert.equal(r.calls.total, 0);
  assert.equal(r.value.estimated, 0);
  assert.equal(r.value.outOfHours, 0);
  assert.equal(r.calls.actionRate, 0);
});

test('backup: crea una copia leggibile con i dati dentro', () => {
  seed();
  const b = backup.backupNow();
  const copy = new DatabaseSync(path.join(backup.dir(), b.name));
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, 4);
  copy.close();
  assert.ok(cfg.get('LAST_BACKUP_AT'));
});

test('backup: tiene solo le ultime N copie', () => {
  for (let i = 0; i < 4; i++) backup.backupNow();
  assert.equal(backup.list().length, 2);                // BACKUP_KEEP = 2
});

test('backup: la copia da scaricare è un database valido', () => {
  const file = backup.snapshotForDownload();
  const copy = new DatabaseSync(file);
  assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM tables').get().n >= 0);
  copy.close(); fs.unlinkSync(file);
});

test('report: valore delle chiamate fuori orario (lavoro che sarebbe andato perso)', () => {
  seed();
  // c3 è la chiamata delle 03:30: una prenotazione confermata da 2 coperti collegata a lei
  db.prepare("INSERT INTO reservations (customer_name, customer_phone, date, time, guests, status, created_at, source, call_id) VALUES ('Notte','1','2026-10-12','20:00',2,'confirmed','2026-10-09T01:40:00Z','voice','c3')").run();
  const r = report.build(30, NOW);
  assert.equal(r.value.outOfHours, 2 * 30);             // 2 coperti × 30 €
  assert.equal(r.value.estimated, 8 * 30 + 40);         // il totale include anche questa
  assert.equal(r.calls.withAction, 3);
});
