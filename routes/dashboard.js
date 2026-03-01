const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/dashboard
router.get('/', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const reservationsToday = db.prepare(`
    SELECT COUNT(*) as c FROM reservations WHERE date = ? AND status != 'cancelled'
  `).get(today).c;

  const activeOrders = db.prepare(`
    SELECT COUNT(*) as c FROM takeaway_orders
    WHERE pickup_date = ? AND status IN ('pending', 'preparing', 'ready')
  `).get(today).c;

  const freeTables = db.prepare(`
    SELECT COUNT(*) as c FROM tables WHERE status = 'free' AND active = 1
  `).get().c;

  const occupiedTables = db.prepare(`
    SELECT COUNT(*) as c FROM tables WHERE status = 'occupied' AND active = 1
  `).get().c;

  const totalTables = db.prepare(`
    SELECT COUNT(*) as c FROM tables WHERE active = 1
  `).get().c;

  const revenueRow = db.prepare(`
    SELECT COALESCE(SUM(total), 0) as revenue
    FROM takeaway_orders
    WHERE pickup_date = ? AND status IN ('ready', 'picked_up')
  `).get(today);

  // Next 3 hours reservations
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5);
  const in3h = new Date(now.getTime() + 3 * 60 * 60 * 1000).toTimeString().slice(0, 5);

  const upcomingReservations = db.prepare(`
    SELECT r.*, t.number as table_number
    FROM reservations r
    LEFT JOIN tables t ON r.table_id = t.id
    WHERE r.date = ? AND r.time >= ? AND r.time <= ? AND r.status = 'confirmed'
    ORDER BY r.time
    LIMIT 10
  `).all(today, currentTime, in3h);

  const recentOrders = db.prepare(`
    SELECT * FROM takeaway_orders
    WHERE pickup_date = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(today);

  res.json({
    today,
    stats: {
      reservationsToday,
      activeOrders,
      freeTables,
      occupiedTables,
      totalTables,
      revenue: revenueRow.revenue
    },
    upcomingReservations,
    recentOrders
  });
});

module.exports = router;
