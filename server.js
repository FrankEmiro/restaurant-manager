const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// ─── DEBUG LOGGER (solo per /vapi/*) ─────────────────────────────────────────
app.use('/vapi', (req, res, next) => {
  const ts = new Date().toISOString();
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[VAPI] ${ts}`);
  console.log(`[VAPI] ${req.method} ${req.originalUrl}`);
  console.log(`[VAPI] BODY:\n${JSON.stringify(req.body, null, 2)}`);

  // Log anche la risposta
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    console.log(`[VAPI] RESPONSE:\n${JSON.stringify(data, null, 2)}`);
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
