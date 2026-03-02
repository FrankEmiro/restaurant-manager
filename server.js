const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// ─── DEBUG LOGGER (tutte le chiamate API) ────────────────────────────────────
app.use((req, res, next) => {
  // Salta i file statici
  if (req.path.startsWith('/public') || req.path === '/favicon.ico' || (!req.path.startsWith('/api') && !req.path.startsWith('/vapi'))) {
    return next();
  }

  const ts = new Date().toISOString();
  const prefix = req.path.startsWith('/vapi') ? 'VAPI' : 'API';
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${prefix}] ${ts}`);
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

app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/tables', require('./routes/tables'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/dashboard', require('./routes/dashboard'));

// VAPI routes
app.use('/vapi', require('./routes/vapi'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Restaurant Manager running at http://localhost:${PORT}`);
});
