// Numeri per il titolare: quanto lavoro ha fatto l'assistente vocale e quanto vale.
// Le prenotazioni/ordini fatti dall'assistente sono quelli con source = 'voice'.
// Il "valore" è una STIMA: coperti prenotati × spesa media per coperto (impostabile) + incasso asporto.
const db = require('../db');
const cfg = require('./config');
const booking = require('./booking');

const DEFAULT_SPEND = 25;
const avgSpend = () => { const v = parseFloat(cfg.get('AVG_SPEND_PER_COVER')); return Number.isFinite(v) && v >= 0 ? v : DEFAULT_SPEND; };
const round2 = (n) => Math.round(n * 100) / 100;

function addDays(date, delta) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function build(days = 30, now = booking.localNow()) {
  days = [7, 30, 90].includes(days) ? days : 30;
  const from = addDays(now.date, -(days - 1));        // primo giorno incluso (data locale)
  const inRange = (iso) => { if (!iso) return false; const d = booking.localParts(iso).date; return d >= from && d <= now.date; };

  // ── chiamate ──
  const calls = db.prepare('SELECT * FROM call_logs').all().filter(c => inRange(c.started_at || c.created_at));
  const callIds = new Set(calls.map(c => c.vapi_call_id));

  // ── prenotazioni e ordini creati nel periodo ──
  const reservations = db.prepare("SELECT * FROM reservations").all().filter(r => inRange(r.created_at));
  const orders = db.prepare("SELECT * FROM takeaway_orders").all().filter(o => inRange(o.created_at));
  const live = (x) => x.status !== 'cancelled';
  const resVoice = reservations.filter(r => r.source === 'voice');
  const ordVoice = orders.filter(o => o.source === 'voice');

  const covers = resVoice.filter(live).reduce((n, r) => n + r.guests, 0);
  const takeawayRevenue = round2(ordVoice.filter(live).reduce((n, o) => n + (o.total || 0), 0));
  const spend = avgSpend();
  const value = round2(covers * spend + takeawayRevenue);

  // ── chiamate che si sono concluse con un'azione, e chiamate fuori orario ──
  const withAction = new Set([...resVoice.filter(live), ...ordVoice.filter(live)].map(x => x.call_id).filter(Boolean));
  const callsWithAction = [...withAction].filter(id => callIds.has(id)).length;

  // Chiamate arrivate a locale chiuso: senza l'assistente sarebbero andate perse, quindi il loro
  // valore è sicuramente "in più" (a differenza delle prenotazioni che sarebbero arrivate comunque)
  let outOfHours = 0;
  const outOfHoursIds = new Set();
  for (const c of calls) {
    const { date, minutes } = booking.localParts(c.started_at || c.created_at);
    const open = booking.servicesOn(date).some(([o, cl]) => minutes >= booking.toMin(o) && minutes <= booking.toMin(cl));
    if (!open) { outOfHours++; outOfHoursIds.add(c.vapi_call_id); }
  }
  const nightCovers = resVoice.filter(live).filter(r => outOfHoursIds.has(r.call_id)).reduce((n, r) => n + r.guests, 0);
  const nightRevenue = round2(ordVoice.filter(live).filter(o => outOfHoursIds.has(o.call_id)).reduce((n, o) => n + (o.total || 0), 0));
  const nightValue = round2(nightCovers * spend + nightRevenue);

  const cost = round2(calls.reduce((n, c) => n + (c.cost || 0), 0));
  const durations = calls.filter(c => c.duration_seconds > 0).map(c => c.duration_seconds);

  // ── serie giornaliera (ultimi 31 giorni al massimo) ──
  const shown = Math.min(days, 31);
  const series = [];
  for (let i = shown - 1; i >= 0; i--) {
    const date = addDays(now.date, -i);
    series.push({
      date,
      calls: calls.filter(c => booking.localParts(c.started_at || c.created_at).date === date).length,
      actions: resVoice.filter(r => booking.localParts(r.created_at).date === date).length
             + ordVoice.filter(o => booking.localParts(o.created_at).date === date).length
    });
  }

  // ── orari più richiesti (ora delle prenotazioni create nel periodo) ──
  const byHour = {};
  for (const r of reservations.filter(live)) { const h = r.time.slice(0, 2); byHour[h] = (byHour[h] || 0) + r.guests; }
  const peakHours = Object.entries(byHour).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h, c]) => ({ hour: `${h}:00`, covers: c }));

  return {
    days, from, to: now.date,
    assumptions: { avgSpendPerCover: spend, usingDefaultSpend: !cfg.get('AVG_SPEND_PER_COVER') },
    calls: {
      total: calls.length,
      withAction: callsWithAction,
      actionRate: calls.length ? Math.round(callsWithAction * 100 / calls.length) : 0,
      outOfHours,
      avgDurationSec: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      cost
    },
    reservations: { byAssistant: resVoice.filter(live).length, byStaff: reservations.filter(r => r.source !== 'voice' && live(r)).length, covers, cancelled: reservations.filter(r => !live(r)).length },
    takeaway: { byAssistant: ordVoice.filter(live).length, byStaff: orders.filter(o => o.source !== 'voice' && live(o)).length, revenue: takeawayRevenue },
    value: { estimated: value, covers, avgSpend: spend, takeawayRevenue, outOfHours: nightValue },
    series, peakHours
  };
}

module.exports = { build, avgSpend, DEFAULT_SPEND };
