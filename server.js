const express = require('express');
const path = require('path');
const session = require('express-session');
const requireAuth = require('./middleware/requireAuth');

const app = express();

app.use(express.json());

// 1. Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 ore
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
app.use((req, res, next) => {
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

// 7. VAPI routes (already whitelisted in requireAuth)
app.use('/vapi', require('./routes/vapi'));

// 8. SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Restaurant Manager running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Porta ${PORT} già in uso. Usa PORT=3001 npm start\n`);
    process.exit(1);
  } else throw err;
});
