const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

// Hash generated at startup — avoids storing plaintext
const PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER || !bcrypt.compareSync(password, PASSWORD_HASH)) {
    return res.status(401).json({ error: 'Credenziali non valide' });
  }
  req.session.authenticated = true;
  req.session.user = username;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
