const router = require('express').Router();
const db = require('../db');

// Controllato ogni pochi secondi dal browser: dice se sono arrivati nuovi ordini, prenotazioni o
// segnalazioni (l'app confronta con l'ultimo id visto e fa suonare l'avviso).
router.get('/', (req, res) => {
  const max = (table) => db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${table}`).get().m;
  res.json({
    orders: max('takeaway_orders'),
    reservations: max('reservations'),
    complaints: max('complaints'),
    pendingOrders: db.prepare("SELECT COUNT(*) AS n FROM takeaway_orders WHERE status = 'pending'").get().n
  });
});

module.exports = router;
