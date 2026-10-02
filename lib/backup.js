// Backup automatico del database SQLite.
// Usa VACUUM INTO: produce una copia coerente anche mentre l'app scrive. Si tengono le ultime N copie
// nella cartella "backups" accanto al database (volume /data con Docker).
const fs = require('fs');
const path = require('path');
const db = require('../db');
const cfg = require('./config');
const booking = require('./booking');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'restaurant.db');
const dir = () => process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const KEEP = () => Math.max(1, parseInt(process.env.BACKUP_KEEP, 10) || 14);
const FILE_RE = /^restaurant-\d{8}-\d{6}-\d{3}\.db$/;

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.(\d+)Z$/, '-$1').replace('T', '-'); // 20261010-040000-123

function snapshotTo(file) {
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return fs.statSync(file).size;
}

function list() {
  if (!fs.existsSync(dir())) return [];
  return fs.readdirSync(dir()).filter(f => FILE_RE.test(f)).sort().reverse().map(name => {
    const st = fs.statSync(path.join(dir(), name));
    return { name, size: st.size, created: st.mtime.toISOString() };
  });
}

function prune() {
  for (const f of list().slice(KEEP())) { try { fs.unlinkSync(path.join(dir(), f.name)); } catch { /* ignora */ } }
}

function backupNow() {
  fs.mkdirSync(dir(), { recursive: true });
  const name = `restaurant-${stamp()}.db`;
  const size = snapshotTo(path.join(dir(), name));
  cfg.set('LAST_BACKUP_AT', new Date().toISOString());
  prune();
  return { name, size };
}

// Copia temporanea da scaricare: l'utente salva il file dove vuole (altro disco, cloud…)
function snapshotForDownload() {
  const tmp = path.join(require('os').tmpdir(), `restaurant-download-${stamp()}-${process.pid}.db`);
  snapshotTo(tmp);
  return tmp;
}

// Parte all'avvio: se l'ultima copia ha più di 20 ore ne fa una, poi controlla ogni ora e a
// BACKUP_HOUR (default 04:00, ora locale) fa la copia del giorno.
let timer = null;
function start() {
  const hour = parseInt(process.env.BACKUP_HOUR, 10);
  const targetHour = Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 4;
  const tick = () => {
    try {
      const last = cfg.get('LAST_BACKUP_AT');
      const ageH = last ? (Date.now() - new Date(last).getTime()) / 3.6e6 : Infinity;
      const nowLocal = booking.localNow();
      const lastDay = last ? booking.localParts(last).date : null;
      if (ageH > 20 || (Math.floor(nowLocal.minutes / 60) === targetHour && lastDay !== nowLocal.date)) {
        const r = backupNow();
        console.log(`[backup] copia creata: ${r.name} (${Math.round(r.size / 1024)} KB)`);
      }
    } catch (e) { console.error('[backup] errore:', e.message); }
  };
  setTimeout(tick, 5000).unref();
  timer = setInterval(tick, 3600_000); timer.unref();
}

module.exports = { backupNow, list, prune, start, snapshotForDownload, dir };
