const router = require('express').Router();
const cfg = require('../lib/config');
const report = require('../lib/report');

router.get('/', (req, res) => res.json(report.build(parseInt(req.query.days, 10) || 30)));

// Spesa media per coperto: la usa la stima del valore generato
router.post('/settings', (req, res) => {
  const v = parseFloat(req.body?.AVG_SPEND_PER_COVER);
  if (!Number.isFinite(v) || v < 0 || v > 1000) return res.status(400).json({ error: 'Spesa media non valida (0–1000 €)' });
  cfg.set('AVG_SPEND_PER_COVER', String(v));
  res.json({ ok: true });
});

module.exports = router;
