// Conservazione limitata dei dati personali delle chiamate (GDPR): dopo N mesi (default 12) si cancellano
// trascrizioni, riepiloghi, audio e numeri dei chiamanti. Restano durata e costo, per le statistiche.
// Prenotazioni e ordini sono registri del locale: non si toccano.
const db = require('../db');
const cfg = require('./config');

const months = () => { const v = parseInt(cfg.get('RETENTION_MONTHS'), 10); return Number.isInteger(v) && v >= 1 && v <= 120 ? v : 12; };

function apply() {
  const cutoff = db.prepare("SELECT datetime('now', ?) AS c").get(`-${months()} months`).c;
  const chiamate = Number(db.prepare(`
    UPDATE call_logs SET transcript = NULL, summary = NULL, recording_url = NULL, caller_number = NULL
    WHERE created_at < ? AND (transcript IS NOT NULL OR summary IS NOT NULL OR recording_url IS NOT NULL OR caller_number IS NOT NULL)
  `).run(cutoff).changes);
  return { chiamate };
}

module.exports = { apply, months };
