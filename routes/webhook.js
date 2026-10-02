const router = require('express').Router();
const db = require('../db');

const STATUS = {
  'customer-ended-call': 'completed',
  'assistant-ended-call': 'completed',
  'assistant-said-end-call-phrase': 'completed',
  'silence-timed-out': 'completed',
  'voicemail': 'voicemail',
  'customer-busy': 'busy',
  'customer-did-not-answer': 'no-answer',
};

function toStatus(reason) {
  if (!reason) return 'unknown';
  if (STATUS[reason]) return STATUS[reason];
  return /error|failed|fail/i.test(reason) ? 'failed' : 'completed';
}

// Eventi di chiamata inviati da Vapi (autenticati dal segreto condiviso in server.js)
router.post('/', (req, res) => {
  try {
    const m = req.body?.message || req.body || {};
    if (m.type !== 'end-of-call-report') return res.json({ ok: true });

    const call = m.call || {};
    if (!call.id) return res.json({ ok: true });
    const artifact = m.artifact || call.artifact || {};

    const started = call.startedAt || m.startedAt || null;
    // Se Vapi non manda la fine chiamata, la durata resta 0: non va inventata con l'ora attuale
    const ended = call.endedAt || m.endedAt || null;
    let duration = 0;
    if (typeof m.durationSeconds === 'number') duration = Math.round(m.durationSeconds);
    else if (started && ended) duration = Math.max(0, Math.round((new Date(ended) - new Date(started)) / 1000));

    const endedReason = m.endedReason || call.endedReason || null;
    const summary = m.summary || m.analysis?.summary || call.analysis?.summary || null;

    db.prepare(`
      INSERT INTO call_logs (vapi_call_id, direction, caller_number, status, ended_reason, duration_seconds, cost, summary, transcript, recording_url, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(vapi_call_id) DO UPDATE SET
        status = excluded.status, ended_reason = excluded.ended_reason, duration_seconds = excluded.duration_seconds,
        cost = excluded.cost, summary = excluded.summary, transcript = excluded.transcript,
        recording_url = excluded.recording_url, ended_at = excluded.ended_at
    `).run(
      call.id,
      /outbound/i.test(call.type || '') ? 'outbound' : 'inbound',
      call.customer?.number || null,
      toStatus(endedReason),
      endedReason,
      duration,
      Number(m.cost ?? call.cost ?? 0) || 0,
      summary,
      artifact.transcript || null,
      artifact.recordingUrl || null,
      started,
      ended
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[webhook] errore salvataggio chiamata:', e.message);
    res.status(200).json({ ok: false }); // 200 comunque: Vapi non deve ritentare all'infinito
  }
});

module.exports = router;
