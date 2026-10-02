const express = require('express');
const bcrypt = require('bcryptjs');
const { createLimiter, adminPasswordHash } = require('../lib/security');
const router = express.Router();

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const PASSWORD_HASH = adminPasswordHash(bcrypt);
// Hash reale: serve a fare comunque un confronto bcrypt quando l'utente non esiste
const DUMMY_HASH = bcrypt.hashSync('dummy-' + Math.random(), 10);

// 5 tentativi falliti per IP+utente ogni 15 minuti, 30 per IP. Un login riuscito azzera il conteggio.
const byAccount = createLimiter({ max: 5, windowMs: 15 * 60_000 });
const byIp = createLimiter({ max: 30, windowMs: 15 * 60_000 });

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Utente e password richiesti' });

  const key = `${req.ip}|${String(username).toLowerCase()}`;
  if (byAccount.blocked(key) || byIp.blocked(req.ip)) {
    const wait = Math.max(byAccount.retryAfterSec(key), byIp.retryAfterSec(req.ip));
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: `Troppi tentativi. Riprova tra ${Math.ceil(wait / 60)} minuti.` });
  }

  const userOk = username === ADMIN_USER;
  const passOk = await bcrypt.compare(String(password), userOk ? PASSWORD_HASH : DUMMY_HASH);
  if (!userOk || !passOk) {
    byAccount.fail(key); byIp.fail(req.ip);
    return res.status(401).json({ error: 'Credenziali non valide' });
  }
  byAccount.reset(key);

  // Nuovo id di sessione al login (anti session fixation)
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Errore di sessione' });
    req.session.authenticated = true;
    req.session.user = username;
    res.json({ ok: true });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
