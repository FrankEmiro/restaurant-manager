const router = require('express').Router();
const db = require('../db');
const cfg = require('../lib/config');
const vapi = require('../lib/vapiClient');

// Impostazioni modificabili dall'app. Le chiavi sensibili non vengono mai restituite al browser.
const FIELDS = ['RECORD_CALLS', 'RETENTION_MONTHS', 'RESTAURANT_NAME', 'PUBLIC_URL', 'FIRST_MESSAGE', 'VOICE', 'MODEL', 'TRANSFER_PHONE', 'TIMEZONE', 'MAX_CALL_DURATION_SECONDS', 'SYSTEM_PROMPT'];

function state() {
  const synced = db.prepare('SELECT COUNT(*) AS n, MAX(synced_at) AS last FROM vapi_tools').get();
  const out = {};
  for (const k of FIELDS) out[k] = cfg.get(k);
  return {
    ...out,
    apiKeySet: !!cfg.get('VAPI_API_KEY'),
    publicUrlFromEnv: !!process.env.PUBLIC_URL,
    assistantId: cfg.get('VAPI_ASSISTANT_ID') || null,
    toolsSynced: synced.n,
    toolsTotal: vapi.tools.length,
    lastSync: cfg.get('LAST_SYNC_AT') || synced.last || null,
    defaults: { FIRST_MESSAGE: null }
  };
}

router.get('/status', (req, res) => res.json(state()));

router.post('/settings', (req, res) => {
  const b = req.body || {};
  if (b.PUBLIC_URL !== undefined && b.PUBLIC_URL !== '' && !/^https?:\/\/[^\s/]+/i.test(b.PUBLIC_URL)) {
    return res.status(400).json({ error: 'URL pubblico non valido (deve iniziare con https://)' });
  }
  if (b.RECORD_CALLS !== undefined && b.RECORD_CALLS !== '' && !['0', '1'].includes(String(b.RECORD_CALLS))) return res.status(400).json({ error: 'Registrazione non valida' });
  if (b.RETENTION_MONTHS && !(parseInt(b.RETENTION_MONTHS, 10) >= 1 && parseInt(b.RETENTION_MONTHS, 10) <= 120)) return res.status(400).json({ error: 'Conservazione: tra 1 e 120 mesi' });
  if (b.TRANSFER_PHONE && !/^\+\d{8,15}$/.test(b.TRANSFER_PHONE)) {
    return res.status(400).json({ error: 'Numero di trasferimento non valido: usa il formato internazionale, es. +390212345678' });
  }
  if (b.MAX_CALL_DURATION_SECONDS && !(parseInt(b.MAX_CALL_DURATION_SECONDS, 10) >= 60)) {
    return res.status(400).json({ error: 'Durata massima: almeno 60 secondi' });
  }
  for (const k of FIELDS) {
    if (b[k] === undefined) continue;
    cfg.set(k, typeof b[k] === 'string' ? b[k].trim() : b[k]);
  }
  // La chiave API cambia solo se ne arriva una nuova (campo vuoto = lascia quella salvata)
  if (typeof b.VAPI_API_KEY === 'string' && b.VAPI_API_KEY.trim()) cfg.set('VAPI_API_KEY', b.VAPI_API_KEY.trim());
  res.json({ ok: true, ...state() });
});

// Crea o aggiorna su Vapi i tool e l'assistente. Idempotente: si può premere quante volte si vuole.
router.post('/sync', async (req, res) => {
  if (!cfg.get('VAPI_API_KEY')) return res.status(400).json({ error: 'Inserisci prima la chiave API Vapi.' });
  if (!vapi.publicUrl()) return res.status(400).json({ error: 'Inserisci prima l\'URL pubblico dell\'app (https://…): Vapi deve poterlo raggiungere.' });
  if (!cfg.get('RESTAURANT_NAME')) return res.status(400).json({ error: 'Inserisci il nome del locale: l\'assistente lo usa per presentarsi.' });

  const results = [];
  const ids = [];
  try {
    for (const t of vapi.tools) {
      const payload = vapi.buildToolPayload(t);
      const row = db.prepare('SELECT vapi_tool_id FROM vapi_tools WHERE tool_name = ?').get(t.name);
      let id = row?.vapi_tool_id;
      let action = 'updated';
      if (id) {
        try {
          const { type: _omit, ...patch } = payload; // PATCH /tool non accetta "type"
          await vapi.updateTool(id, patch);
        } catch (e) {
          if (!/not found|404/i.test(e.message)) throw e;
          id = null; // cancellato su Vapi: lo ricreo
        }
      }
      if (!id) {
        const created = await vapi.createTool(payload);
        id = created.id; action = 'created';
      }
      db.prepare("INSERT OR REPLACE INTO vapi_tools (tool_name, vapi_tool_id, synced_at) VALUES (?, ?, datetime('now'))").run(t.name, id);
      ids.push(id);
      results.push({ tool: t.name, action });
    }

    const payload = vapi.buildAssistantPayload(ids);
    let assistantId = cfg.get('VAPI_ASSISTANT_ID');
    let assistantAction = 'updated';
    if (assistantId) {
      try { await vapi.updateAssistant(assistantId, payload); }
      catch (e) { if (!/not found|404/i.test(e.message)) throw e; assistantId = null; }
    }
    if (!assistantId) {
      const created = await vapi.createAssistant(payload);
      assistantId = created.id; assistantAction = 'created';
      cfg.set('VAPI_ASSISTANT_ID', assistantId);
    }
    cfg.set('LAST_SYNC_AT', new Date().toISOString());
    res.json({ ok: true, assistant: assistantAction, tools: results, ...state() });
  } catch (e) {
    console.error('[voice] sync fallita:', e.message);
    res.status(502).json({ error: `Vapi ha risposto con un errore: ${e.message}`, tools: results });
  }
});

router.get('/phone-numbers', async (req, res) => {
  try {
    const list = await vapi.listPhoneNumbers();
    res.json((Array.isArray(list) ? list : []).map(n => ({
      id: n.id, number: n.number || n.sipUri || n.name || n.id, assistantId: n.assistantId || null
    })));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/assign-number', async (req, res) => {
  const assistantId = cfg.get('VAPI_ASSISTANT_ID');
  if (!assistantId) return res.status(400).json({ error: 'Sincronizza prima l\'assistente.' });
  if (!req.body?.phoneId) return res.status(400).json({ error: 'Numero non indicato' });
  try { await vapi.assignPhoneNumber(req.body.phoneId, assistantId); res.json({ ok: true }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Registro chiamate ────────────────────────────────────────────────────────
router.get('/calls', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const rows = db.prepare(`
    SELECT id, direction, caller_number, status, ended_reason, duration_seconds, cost, summary, started_at
    FROM call_logs ORDER BY COALESCE(started_at, created_at) DESC LIMIT ?
  `).all(limit);
  res.json(rows);
});

router.get('/calls/stats', (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
  const r = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(AVG(duration_seconds), 0) AS avg_duration,
           COALESCE(SUM(cost), 0) AS total_cost,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed
    FROM call_logs WHERE COALESCE(started_at, created_at) >= datetime('now', ?)
  `).get(`-${days} days`);
  res.json({ days, ...r });
});

router.get('/calls/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM call_logs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Chiamata non trovata' });
  res.json(row);
});

module.exports = router;
