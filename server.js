const express = require('express');
const path = require('path');
const session = require('express-session');
const requireAuth = require('./middleware/requireAuth');
const { sessionSecret, vapiSecret, verifyVapiSecret } = require('./lib/security');

const app = express();

// Dietro un reverse proxy (Coolify/Traefik) serve per avere l'IP reale e il cookie "secure"
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Header di sicurezza di base
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

// I report di fine chiamata (trascrizione + messaggi) possono superare 1 MB
app.use('/webhook', express.json({ limit: '10mb' }));
app.use((req, res, next) => req.path.startsWith('/webhook') ? next() : express.json({ limit: '1mb' })(req, res, next));

// 1. Session middleware
app.use(session({
  secret: sessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 ore
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto'
  }
}));

// 2. Static files
app.use(express.static(path.join(__dirname, 'public')));

// 3. Auth API (public)
app.use('/api/auth', require('./routes/auth'));

// 4. Login page — MUST be before requireAuth to avoid redirect loop
app.get('/login', (req, res) => {
  if (req.session?.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 5. Auth guard
app.use(requireAuth);

// ─── DEBUG LOGGER ────────────────────────────────────────────────────────────
// Attivo solo con DEBUG_API=1: i body contengono nomi e telefoni dei clienti.
app.use((req, res, next) => {
  if (process.env.DEBUG_API !== '1') return next();
  if (!req.path.startsWith('/api') && !req.path.startsWith('/vapi')) return next();

  const prefix = req.path.startsWith('/vapi') ? 'VAPI' : 'API';
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${prefix}] ${new Date().toISOString()}`);
  console.log(`[${prefix}] ${req.method} ${req.originalUrl}`);
  if (Object.keys(req.body || {}).length > 0) {
    console.log(`[${prefix}] BODY:\n${JSON.stringify(req.body, null, 2)}`);
  }
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    console.log(`[${prefix}] RESPONSE:\n${JSON.stringify(data, null, 2)}`);
    console.log(`${'─'.repeat(60)}\n`);
    return originalJson(data);
  };
  next();
});
// ─────────────────────────────────────────────────────────────────────────────

// 6. Protected REST API routes
app.use('/api/tables',       require('./routes/tables'));
app.use('/api/menu',         require('./routes/menu'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/orders',       require('./routes/orders'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.use('/api/allergens',    require('./routes/allergens'));
app.use('/api/complaints',   require('./routes/complaints'));
app.use('/api/security',     require('./routes/security'));
app.use('/api/voice',        require('./routes/voice'));
app.use('/api/rules',        require('./routes/rules'));
app.use('/api/alerts',       require('./routes/alerts'));
app.use('/api/report',       require('./routes/report'));
app.use('/api/backup',       require('./routes/backup'));
app.use('/print',            require('./routes/print'));

// 7. VAPI routes (fuori dalla sessione, protette dal segreto condiviso)
app.use('/vapi', verifyVapiSecret, require('./routes/vapi'));
app.use('/webhook/vapi', verifyVapiSecret, require('./routes/webhook'));

// 8. SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

vapiSecret(); // genera il segreto Vapi al primo avvio

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Restaurant Manager running at http://localhost:${PORT}`);
});

require('./lib/backup').start(); // copia automatica del database

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Porta ${PORT} già in uso. Usa PORT=3001 npm start\n`);
    process.exit(1);
  } else throw err;
});
