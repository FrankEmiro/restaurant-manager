const crypto = require('crypto');
const db = require('../db');

// Impostazioni persistenti (tabella settings): segreti generati alla prima partenza,
// così ogni installazione ha i propri valori casuali senza passaggi manuali.
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, String(value));
}
function getOrCreateSecret(key, envName, bytes = 32) {
  if (envName && process.env[envName]) return process.env[envName];
  let v = getSetting(key);
  if (!v) { v = crypto.randomBytes(bytes).toString('hex'); setSetting(key, v); }
  return v;
}

// Confronto a tempo costante: si confrontano gli hash, così la lunghezza non trapela.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Rate limiter in memoria a finestra scorrevole. Basta per un'istanza singola.
function createLimiter({ max, windowMs }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of hits) {
      const recent = arr.filter(t => now - t < windowMs);
      if (recent.length) hits.set(k, recent); else hits.delete(k);
    }
  }, 60_000).unref();
  return {
    blocked(key) {
      const now = Date.now();
      const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
      hits.set(key, recent);
      return recent.length >= max;
    },
    fail(key) { const a = hits.get(key) || []; a.push(Date.now()); hits.set(key, a); },
    reset(key) { hits.delete(key); },
    retryAfterSec(key) {
      const a = hits.get(key) || [];
      return a.length ? Math.max(1, Math.ceil((windowMs - (Date.now() - a[0])) / 1000)) : 0;
    },
  };
}

const sessionSecret = () => getOrCreateSecret('SESSION_SECRET', 'SESSION_SECRET', 48);
const vapiSecret = () => getOrCreateSecret('VAPI_WEBHOOK_SECRET', 'VAPI_WEBHOOK_SECRET');

// Le rotte /vapi/* sono chiamate da Vapi, non da un browser: senza segreto chiunque
// potrebbe creare prenotazioni, ordini e reclami o leggere i dati dei clienti.
// Vapi invia il segreto nell'header x-vapi-secret (campo "secret" del server).
function verifyVapiSecret(req, res, next) {
  const got = req.headers['x-vapi-secret'] || req.headers['x-rebel-secret'] || '';
  if (got && safeEqual(got, vapiSecret())) return next();
  console.warn(`[security] Richiesta VAPI rifiutata (${got ? 'segreto errato' : 'segreto mancante'}) ${req.method} ${req.originalUrl} ip=${req.ip}`);
  return res.status(401).json({ error: 'Unauthorized' });
}

// Password admin: da env, oppure generata casuale al primo avvio e mostrata una sola volta.
function adminPasswordHash(bcrypt) {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return bcrypt.hashSync(fromEnv, 10);
  let hash = getSetting('ADMIN_PASSWORD_HASH');
  if (!hash) {
    const pwd = crypto.randomBytes(9).toString('base64url');
    hash = bcrypt.hashSync(pwd, 10);
    setSetting('ADMIN_PASSWORD_HASH', hash);
    console.log('\n' + '═'.repeat(60));
    console.log(' PRIMO AVVIO — password admin generata (mostrata una volta sola)');
    console.log(`   utente:   ${process.env.ADMIN_USER || 'admin'}`);
    console.log(`   password: ${pwd}`);
    console.log(' Per sceglierne una tua imposta ADMIN_PASSWORD nell\'ambiente.');
    console.log('═'.repeat(60) + '\n');
  }
  return hash;
}

module.exports = { getSetting, setSetting, sessionSecret, vapiSecret, verifyVapiSecret, safeEqual, createLimiter, adminPasswordHash };
