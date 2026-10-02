const router = require('express').Router();
const cfg = require('../lib/config');
const booking = require('../lib/booking');

const RULE_FIELDS = {
  TURN_MINUTES: [15, 360, 'Durata del turno'],
  RES_LEAD_MINUTES: [0, 1440, 'Preavviso per prenotare'],
  LAST_SEATING_MINUTES: [0, 240, 'Ultima prenotazione prima della chiusura'],
  TAKEAWAY_PREP_MINUTES: [0, 240, 'Preparazione asporto'],
  TAKEAWAY_MAX_PER_SLOT: [1, 50, 'Ordini asporto per fascia']
};

router.get('/', (req, res) => {
  const { hours, configured } = booking.getHours();
  const r = booking.getRules();
  res.json({
    configured,
    hours,
    closures: booking.getClosures(),
    rules: {
      TURN_MINUTES: r.turn, RES_LEAD_MINUTES: r.lead, LAST_SEATING_MINUTES: r.lastBeforeClose,
      TAKEAWAY_PREP_MINUTES: r.prep, TAKEAWAY_MAX_PER_SLOT: r.perSlot
    },
    timezone: cfg.get('TIMEZONE') || 'Europe/Rome',
    summary: booking.describeRules()
  });
});

router.post('/', (req, res) => {
  const { hours, closures, rules } = req.body || {};

  // ── Orari ──
  const cleanHours = {};
  for (const key of booking.DAY_KEYS) {
    const day = Array.isArray(hours?.[key]) ? hours[key] : [];
    if (day.length > 3) return res.status(400).json({ error: `${key}: al massimo 3 fasce al giorno` });
    const services = [];
    for (const s of day) {
      if (!Array.isArray(s) || !booking.isTime(s[0]) || !booking.isTime(s[1])) return res.status(400).json({ error: 'Orario non valido (usa HH:MM)' });
      if (booking.toMin(s[0]) >= booking.toMin(s[1])) return res.status(400).json({ error: `Fascia ${s[0]}–${s[1]}: l'apertura deve essere prima della chiusura` });
      services.push([s[0], s[1]]);
    }
    services.sort((a, b) => a[0].localeCompare(b[0]));
    for (let i = 1; i < services.length; i++) {
      if (booking.toMin(services[i][0]) < booking.toMin(services[i - 1][1])) return res.status(400).json({ error: 'Le fasce dello stesso giorno non possono sovrapporsi' });
    }
    cleanHours[key] = services;
  }

  // ── Chiusure ──
  const cleanClosures = [];
  if (closures !== undefined) {
    if (!Array.isArray(closures) || closures.length > 60) return res.status(400).json({ error: 'Chiusure non valide' });
    for (const c of closures) {
      if (!booking.isDate(c?.from) || (c.to && !booking.isDate(c.to))) return res.status(400).json({ error: 'Data di chiusura non valida' });
      if (c.to && c.to < c.from) return res.status(400).json({ error: 'In una chiusura la data finale non può precedere quella iniziale' });
      cleanClosures.push({ from: c.from, to: c.to || c.from, reason: String(c.reason || '').slice(0, 80) });
    }
  }

  // ── Regole numeriche ──
  const cleanRules = {};
  for (const [key, [min, max, label]] of Object.entries(RULE_FIELDS)) {
    if (rules?.[key] === undefined || rules[key] === '') continue;
    const v = parseInt(rules[key], 10);
    if (!Number.isInteger(v) || v < min || v > max) return res.status(400).json({ error: `${label}: valore tra ${min} e ${max}` });
    cleanRules[key] = v;
  }

  cfg.set('OPENING_HOURS', JSON.stringify(cleanHours));
  if (closures !== undefined) cfg.set('CLOSURES', JSON.stringify(cleanClosures));
  for (const [k, v] of Object.entries(cleanRules)) cfg.set(k, String(v));
  res.json({ ok: true, summary: booking.describeRules() });
});

module.exports = router;
