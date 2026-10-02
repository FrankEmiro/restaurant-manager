// Esegui con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rist-priv-')), 'test.db');
const db = require('../db');
const cfg = require('../lib/config');
const v = require('../lib/vapiClient');
const retention = require('../lib/retention');

test('assistente: audio non registrato di default e informativa detta subito', () => {
  cfg.set('RESTAURANT_NAME', 'Trattoria da Mario'); cfg.set('RECORD_CALLS', '');
  const p = v.buildAssistantPayload([]);
  assert.equal(p.artifactPlan.recordingEnabled, false);
  assert.match(p.firstMessage, /assistente AI/);
  assert.match(p.firstMessage, /trascritta/);
});

test('assistente: con la registrazione attiva lo dichiara', () => {
  cfg.set('RECORD_CALLS', '1');
  const p = v.buildAssistantPayload([]);
  assert.equal(p.artifactPlan.recordingEnabled, true);
  assert.match(p.firstMessage, /registrata e trascritta/);
  cfg.set('RECORD_CALLS', '');
});

test('assistente: un primo messaggio personalizzato riceve comunque l\'informativa', () => {
  cfg.set('FIRST_MESSAGE', 'Buonasera, ristorante Da Mario');
  const m = v.buildAssistantPayload([]).firstMessage;
  assert.match(m, /assistente AI/); assert.match(m, /trascritta/);
  cfg.set('FIRST_MESSAGE', 'Sono Sara, assistente AI. La chiamata è trascritta. Come posso aiutarla?');
  assert.equal(v.buildAssistantPayload([]).firstMessage, 'Sono Sara, assistente AI. La chiamata è trascritta. Come posso aiutarla?');
  cfg.set('FIRST_MESSAGE', '');
});

test('conservazione: oltre i mesi impostati sparisce il contenuto delle chiamate, restano durata e costo', () => {
  cfg.set('RETENTION_MONTHS', '6');
  const ins = db.prepare("INSERT INTO call_logs (vapi_call_id, caller_number, duration_seconds, cost, transcript, summary, recording_url, created_at) VALUES (?, '+39333', 90, 0.2, 't', 's', 'https://x/r.mp3', ?)");
  ins.run('vecchia', '2025-01-01 10:00:00'); ins.run('recente', new Date().toISOString().slice(0, 19).replace('T', ' '));
  assert.equal(retention.apply().chiamate, 1);
  const v1 = db.prepare("SELECT * FROM call_logs WHERE vapi_call_id = 'vecchia'").get();
  assert.equal(v1.transcript, null); assert.equal(v1.caller_number, null); assert.equal(v1.cost, 0.2);
  assert.equal(db.prepare("SELECT transcript FROM call_logs WHERE vapi_call_id = 'recente'").get().transcript, 't');
});
