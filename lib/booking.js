// Motore di prenotazione: orari di apertura, chiusure, turni, assegnazione dei tavoli e regole
// dell'asporto. Usato sia dall'assistente vocale sia dall'interfaccia, così le due strade
// applicano le stesse regole.
const db = require('../db');
const cfg = require('./config');

// getDay(): 0 = domenica
const DAY_KEYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const DAY_NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const DEFAULT_SERVICES = [['12:00', '15:00'], ['19:00', '23:00']];
const SLOT = 15; // granularità degli orari proposti (minuti)

// ── Tempo ─────────────────────────────────────────────────────────────────────
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));

function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const daysOf = (date) => { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const absMin = (date, minutes) => daysOf(date) * 1440 + minutes;
const fmtDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' });

// "Adesso" nel fuso del locale (il server può girare in UTC)
function localNow() {
  const tz = cfg.get('TIMEZONE') || 'Europe/Rome';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const g = (t) => parts.find(p => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: parseInt(g('hour'), 10) * 60 + parseInt(g('minute'), 10) };
}

// Data e minuti locali di un istante (ISO) nel fuso del locale
function localParts(iso) {
  const tz = cfg.get('TIMEZONE') || 'Europe/Rome';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(iso));
  const g = (t) => parts.find(p => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: parseInt(g('hour'), 10) * 60 + parseInt(g('minute'), 10) };
}

// ── Configurazione ────────────────────────────────────────────────────────────
function defaultHours() {
  const h = {};
  DAY_KEYS.forEach(k => { h[k] = DEFAULT_SERVICES.map(s => [...s]); });
  return h;
}

function getHours() {
  const raw = cfg.get('OPENING_HOURS');
  if (!raw) return { hours: defaultHours(), configured: false };
  try {
    const parsed = JSON.parse(raw);
    const hours = {};
    DAY_KEYS.forEach(k => {
      hours[k] = (Array.isArray(parsed[k]) ? parsed[k] : [])
        .filter(s => Array.isArray(s) && isTime(s[0]) && isTime(s[1]) && toMin(s[0]) < toMin(s[1]));
    });
    return { hours, configured: true };
  } catch { return { hours: defaultHours(), configured: false }; }
}

function getClosures() {
  try {
    const arr = JSON.parse(cfg.get('CLOSURES') || '[]');
    return (Array.isArray(arr) ? arr : []).filter(c => isDate(c.from) && (!c.to || isDate(c.to)));
  } catch { return []; }
}

function getRules() {
  const n = (key, def, min) => { const v = parseInt(cfg.get(key), 10); return Number.isFinite(v) && v >= min ? v : def; };
  return {
    turn: n('TURN_MINUTES', 90, 15),                 // durata di un turno al tavolo
    lead: n('RES_LEAD_MINUTES', 30, 0),              // preavviso minimo per prenotare
    lastBeforeClose: n('LAST_SEATING_MINUTES', 45, 0), // ultima prenotazione prima della chiusura
    prep: n('TAKEAWAY_PREP_MINUTES', 30, 0),         // preparazione asporto
    perSlot: n('TAKEAWAY_MAX_PER_SLOT', 4, 1)        // ordini asporto massimi per quarto d'ora
  };
}

const closureOn = (date) => getClosures().find(c => date >= c.from && date <= (c.to || c.from));
const servicesOn = (date) => closureOn(date) ? [] : (getHours().hours[DAY_KEYS[weekday(date)]] || []);

const describeServices = (s) => s.map(([o, c]) => `dalle ${o} alle ${c}`).join(' e ');

// Orari raggruppati: "da martedì a domenica dalle 12:00 alle 15:00 e dalle 19:00 alle 23:00; lunedì chiuso"
function describeWeek() {
  const { hours } = getHours();
  const order = [1, 2, 3, 4, 5, 6, 0]; // da lunedì
  const groups = [];
  for (const d of order) {
    const key = JSON.stringify(hours[DAY_KEYS[d]]);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.days.push(d); else groups.push({ key, days: [d], services: hours[DAY_KEYS[d]] });
  }
  return groups.map(g => {
    const days = g.days.length === 1 ? DAY_NAMES[g.days[0]] : `da ${DAY_NAMES[g.days[0]]} a ${DAY_NAMES[g.days[g.days.length - 1]]}`;
    return `${days} ${g.services.length ? describeServices(g.services) : 'chiuso'}`;
  }).join('; ');
}

function describeUpcomingClosures() {
  const today = localNow().date;
  return getClosures().filter(c => (c.to || c.from) >= today).sort((a, b) => a.from.localeCompare(b.from)).slice(0, 4)
    .map(c => `${c.to && c.to !== c.from ? `dal ${fmtDate(c.from)} al ${fmtDate(c.to)}` : `il ${fmtDate(c.from)}`}${c.reason ? ` (${c.reason})` : ''}`);
}

// ── Controlli su data e orario ────────────────────────────────────────────────
function checkDay(date) {
  if (!isDate(date)) return { ok: false, code: 'bad_date', message: 'La data non è valida.' };
  const c = closureOn(date);
  if (c) return { ok: false, code: 'closed', message: `Il ${fmtDate(date)} siamo chiusi${c.reason ? ` (${c.reason})` : ''}.` };
  if (servicesOn(date).length === 0) return { ok: false, code: 'closed', message: `Il ${DAY_NAMES[weekday(date)]} siamo chiusi.` };
  return { ok: true };
}

function tooSoon(date, minutes, needed, now) {
  const diff = absMin(date, minutes) - absMin(now.date, now.minutes);
  return diff < needed;
}

function checkReservationSlot(date, time, now = localNow()) {
  if (!isTime(time)) return { ok: false, code: 'bad_time', message: 'L\'orario non è valido.' };
  const day = checkDay(date);
  if (!day.ok) return day;
  const rules = getRules();
  const t = toMin(time);

  if (absMin(date, t) < absMin(now.date, now.minutes)) return { ok: false, code: 'past', message: 'Quell\'orario è già passato.' };

  const services = servicesOn(date);
  const inside = services.some(([o, c]) => t >= toMin(o) && t <= toMin(c) - rules.lastBeforeClose);
  if (!inside) {
    const lasts = services.map(([, c]) => fromMin(toMin(c) - rules.lastBeforeClose)).join(' e ');
    return { ok: false, code: 'outside_hours', message: `Il ${DAY_NAMES[weekday(date)]} siamo aperti ${describeServices(services)}. Si può prenotare fino a ${lasts}.` };
  }
  if (tooSoon(date, t, rules.lead, now)) {
    return { ok: false, code: 'too_soon', message: `Servono almeno ${rules.lead} minuti di preavviso per prenotare.` };
  }
  return { ok: true };
}

// ── Tavoli ─────────────────────────────────────────────────────────────────────
const maxCapacity = () => db.prepare('SELECT COALESCE(MAX(capacity), 0) AS m FROM tables WHERE active = 1').get().m;

// Trova il tavolo libero più piccolo che basta. Una prenotazione occupa il tavolo per tutta la
// durata del turno: due prenotazioni si sovrappongono se partono a meno di `turn` minuti l'una dall'altra.
function assignment(date, time, guests, { excludeId = null } = {}) {
  const turn = getRules().turn;
  const t = toMin(time);
  const tables = db.prepare('SELECT id, number, capacity FROM tables WHERE active = 1 ORDER BY capacity, id').all();
  const rows = db.prepare(`SELECT id, time, guests, table_id FROM reservations WHERE date = ? AND status = 'confirmed' ${excludeId ? 'AND id != ?' : ''}`)
    .all(...(excludeId ? [date, excludeId] : [date]))
    .filter(r => Math.abs(toMin(r.time) - t) < turn);

  const busy = new Set(rows.filter(r => r.table_id).map(r => r.table_id));
  const free = tables.filter(x => !busy.has(x.id));
  // Prenotazioni senza tavolo (es. fatte prima di questa versione): occupano comunque il più piccolo adatto
  for (const r of rows.filter(r => !r.table_id).sort((a, b) => b.guests - a.guests)) {
    const i = free.findIndex(x => x.capacity >= r.guests);
    if (i >= 0) free.splice(i, 1);
  }
  return { table: free.find(x => x.capacity >= guests) || null, freeCount: free.length };
}

// Orari di inizio validi in un giorno (ogni quarto d'ora dentro i servizi)
function validStarts(date, now) {
  const rules = getRules();
  const out = [];
  for (const [o, c] of servicesOn(date)) {
    for (let t = toMin(o); t <= toMin(c) - rules.lastBeforeClose; t += SLOT) {
      if (absMin(date, t) >= absMin(now.date, now.minutes) + rules.lead) out.push(t);
    }
  }
  return out;
}

// Orari alternativi con un tavolo libero, i più vicini a quello chiesto
function alternatives(date, around, guests, { now = localNow(), limit = 3, excludeId = null } = {}) {
  if (checkDay(date).ok === false) return [];
  const target = toMin(around);
  const candidates = validStarts(date, now)
    .filter(t => assignment(date, fromMin(t), guests, { excludeId }).table)
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
  // Proposte distinte: almeno mezz'ora l'una dall'altra (non "21:30, 21:45, 22:00")
  const picked = [];
  for (const t of candidates) {
    if (picked.every(p => Math.abs(p - t) >= 30)) picked.push(t);
    if (picked.length === limit) break;
  }
  return picked.sort((a, b) => a - b).map(fromMin);
}

// Verifica (senza scrivere) se si può prenotare: usato dall'assistente per rispondere "c'è posto?"
function checkReservation({ date, time, guests, excludeId = null }, now = localNow()) {
  guests = parseInt(guests, 10);
  if (!Number.isInteger(guests) || guests < 1) return { ok: false, code: 'bad_guests', message: 'Il numero di persone non è valido.' };
  const slot = checkReservationSlot(date, time, now);
  if (!slot.ok) return slot;

  const cap = maxCapacity();
  if (cap === 0) return { ok: false, code: 'no_tables', message: 'Al momento non posso gestire prenotazioni: i tavoli non sono ancora configurati.' };
  if (guests > cap) return { ok: false, code: 'party_too_large', message: `Per gruppi di più di ${cap} persone la prenotazione va concordata con il personale.` };

  const a = assignment(date, time, guests, { excludeId });
  if (a.table) return { ok: true, table: a.table };

  const alt = alternatives(date, time, guests, { now, excludeId });
  return {
    ok: false, code: 'full', alternatives: alt,
    message: alt.length
      ? `Alle ${time} non c'è posto per ${guests} ${guests === 1 ? 'persona' : 'persone'}. Posso offrire ${alt.join(', ')}.`
      : `Il ${fmtDate(date)} non c'è più posto per ${guests} ${guests === 1 ? 'persona' : 'persone'}.`
  };
}

// Crea la prenotazione assegnando il tavolo, in un'unica transazione
function reserve({ customer_name, customer_phone, date, time, guests, notes = '', source = 'staff', callId = null }, now = localNow()) {
  return db.withTransaction(() => {
    const chk = checkReservation({ date, time, guests }, now);
    if (!chk.ok) return chk;
    const r = db.prepare(`
      INSERT INTO reservations (customer_name, customer_phone, date, time, guests, table_id, notes, status, created_at, source, call_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)
    `).run(customer_name, customer_phone, date, time, parseInt(guests, 10), chk.table.id, notes, new Date().toISOString(), source, callId);
    return { ok: true, id: Number(r.lastInsertRowid), table: chk.table };
  });
}

// ── Asporto ────────────────────────────────────────────────────────────────────
function slotLoad(date, time, excludeId = null) {
  const bucket = Math.floor(toMin(time) / SLOT);
  return db.prepare(`SELECT id, pickup_time FROM takeaway_orders WHERE pickup_date = ? AND status != 'cancelled' ${excludeId ? 'AND id != ?' : ''}`)
    .all(...(excludeId ? [date, excludeId] : [date]))
    .filter(o => Math.floor(toMin(o.pickup_time) / SLOT) === bucket).length;
}

function takeawayStarts(date, now) {
  const rules = getRules();
  const out = [];
  for (const [o, c] of servicesOn(date)) {
    for (let t = toMin(o); t <= toMin(c); t += SLOT) {
      if (absMin(date, t) >= absMin(now.date, now.minutes) + rules.prep) out.push(t);
    }
  }
  return out;
}

function checkTakeaway({ date, time, excludeId = null }, now = localNow()) {
  if (!isTime(time)) return { ok: false, code: 'bad_time', message: 'L\'orario di ritiro non è valido.' };
  const day = checkDay(date);
  if (!day.ok) return day;
  const rules = getRules();
  const t = toMin(time);

  if (absMin(date, t) < absMin(now.date, now.minutes)) return { ok: false, code: 'past', message: 'Quell\'orario di ritiro è già passato.' };

  const services = servicesOn(date);
  if (!services.some(([o, c]) => t >= toMin(o) && t <= toMin(c))) {
    return { ok: false, code: 'outside_hours', message: `Il ${DAY_NAMES[weekday(date)]} siamo aperti ${describeServices(services)}: il ritiro deve essere in quegli orari.` };
  }
  if (tooSoon(date, t, rules.prep, now)) {
    const next = takeawayStarts(date, now)[0];
    return { ok: false, code: 'too_soon', message: `Per la preparazione servono almeno ${rules.prep} minuti${next !== undefined ? `: il primo ritiro possibile è alle ${fromMin(next)}` : ''}.` };
  }
  if (slotLoad(date, time, excludeId) >= rules.perSlot) {
    const alt = takeawayStarts(date, now).filter(x => slotLoad(date, fromMin(x), excludeId) < rules.perSlot)
      .sort((a, b) => Math.abs(a - t) - Math.abs(b - t)).slice(0, 3).sort((a, b) => a - b).map(fromMin);
    return {
      ok: false, code: 'full', alternatives: alt,
      message: alt.length ? `Alle ${time} la cucina è già al completo. Posso offrire il ritiro alle ${alt.join(', ')}.` : `Il ${fmtDate(date)} la cucina è al completo per l'asporto.`
    };
  }
  return { ok: true };
}

// Riepilogo a parole degli orari e delle regole (per l'assistente)
function describeRules() {
  const r = getRules();
  const closures = describeUpcomingClosures();
  return [
    `Orari: ${describeWeek()}.`,
    `Si prenota fino a ${r.lastBeforeClose} minuti prima della chiusura, con almeno ${r.lead} minuti di preavviso. Un turno al tavolo dura circa ${r.turn} minuti.`,
    `Per l'asporto servono almeno ${r.prep} minuti di preparazione.`,
    closures.length ? `Chiusure programmate: ${closures.join('; ')}.` : ''
  ].filter(Boolean).join(' ');
}

module.exports = {
  DAY_KEYS, DAY_NAMES, toMin, fromMin, isTime, isDate, fmtDate, localNow, localParts, servicesOn, closureOn, weekday,
  getHours, getClosures, getRules, defaultHours,
  checkReservationSlot, checkReservation, reserve, assignment, alternatives, maxCapacity,
  checkTakeaway, takeawayStarts, validStarts, describeRules, describeWeek
};
