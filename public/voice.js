// Assistente vocale (Vapi) e registro chiamate.
// Usa gli helper di app.js: apiFetch, esc, toast, closeModal.

const VOICE_STEPS = [
  { key: 'apiKeySet', label: 'Chiave API Vapi', hint: 'Dal pannello Vapi → API Keys' },
  { key: 'url', label: 'URL pubblico dell\'app', hint: 'Deve essere raggiungibile da internet (https)' },
  { key: 'name', label: 'Nome del locale', hint: 'L\'assistente si presenta con questo nome' },
  { key: 'synced', label: 'Assistente creato su Vapi', hint: 'Premi "Salva e sincronizza"' }
];

function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

async function loadVoice() {
  let st;
  try { st = await apiFetch('/api/voice/status'); }
  catch (e) { return toast('Errore: ' + e.message, 'error'); }

  const done = {
    apiKeySet: st.apiKeySet,
    url: !!st.PUBLIC_URL,
    name: !!st.RESTAURANT_NAME,
    synced: !!st.assistantId && st.toolsSynced === st.toolsTotal
  };
  document.getElementById('voice-steps').innerHTML = VOICE_STEPS.map(s => `
    <div class="voice-step ${done[s.key] ? 'done' : ''}">
      <i class="ph-bold ${done[s.key] ? 'ph-check-circle' : 'ph-circle'}"></i>
      <div><strong>${esc(s.label)}</strong><span>${esc(s.hint)}</span></div>
    </div>`).join('');

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('voice-name', st.RESTAURANT_NAME);
  set('voice-url', st.PUBLIC_URL);
  set('voice-first', st.FIRST_MESSAGE);
  set('voice-voice', st.VOICE || 'openai:nova');
  set('voice-model', st.MODEL || 'gpt-4.1-mini');
  set('voice-transfer', st.TRANSFER_PHONE);
  set('voice-record', st.RECORD_CALLS || '0');
  set('voice-retention', st.RETENTION_MONTHS || '12');
  set('voice-prompt', st.SYSTEM_PROMPT);
  set('voice-key', '');
  document.getElementById('voice-key').placeholder = st.apiKeySet ? '•••••••• salvata (lascia vuoto per mantenerla)' : 'Incolla la chiave API Vapi';
  document.getElementById('voice-url').disabled = st.publicUrlFromEnv;
  document.getElementById('voice-sync-info').textContent = st.lastSync
    ? `Ultima sincronizzazione: ${formatDateTime(st.lastSync)} · ${st.toolsSynced}/${st.toolsTotal} strumenti`
    : 'Non ancora sincronizzato.';
}

function voiceFormBody() {
  const v = (id) => document.getElementById(id).value.trim();
  return {
    RESTAURANT_NAME: v('voice-name'), PUBLIC_URL: v('voice-url'), VAPI_API_KEY: v('voice-key'),
    FIRST_MESSAGE: v('voice-first'), VOICE: v('voice-voice'), MODEL: v('voice-model'),
    TRANSFER_PHONE: v('voice-transfer'), SYSTEM_PROMPT: v('voice-prompt'),
    RECORD_CALLS: v('voice-record'), RETENTION_MONTHS: v('voice-retention')
  };
}

async function saveVoice(andSync) {
  const btns = document.querySelectorAll('#view-voce .voice-actions .btn');
  btns.forEach(b => b.disabled = true);
  try {
    const body = voiceFormBody();
    if (document.getElementById('voice-url').disabled) delete body.PUBLIC_URL;
    await apiFetch('/api/voice/settings', { method: 'POST', body });
    if (andSync) {
      const r = await apiFetch('/api/voice/sync', { method: 'POST' });
      const created = r.tools.filter(t => t.action === 'created').length;
      toast(r.assistant === 'created' ? 'Assistente creato su Vapi' : `Assistente aggiornato (${r.tools.length} strumenti${created ? `, ${created} nuovi` : ''})`);
    } else {
      toast('Impostazioni salvate');
    }
    await loadVoice();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}

async function loadVoiceNumbers() {
  const sel = document.getElementById('voice-number');
  try {
    const list = await apiFetch('/api/voice/phone-numbers');
    sel.innerHTML = list.length
      ? list.map(n => `<option value="${esc(n.id)}">${esc(n.number)}${n.assistantId ? ' (già collegato)' : ''}</option>`).join('')
      : '<option value="">Nessun numero su Vapi</option>';
    document.getElementById('voice-assign-btn').disabled = !list.length;
  } catch (e) { toast(e.message, 'error'); }
}

async function assignVoiceNumber() {
  const phoneId = document.getElementById('voice-number').value;
  if (!phoneId) return;
  try {
    await apiFetch('/api/voice/assign-number', { method: 'POST', body: { phoneId } });
    toast('Numero collegato all\'assistente');
    loadVoiceNumbers();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Chiamate ─────────────────────────────────────────────────────────────────
const CALL_STATUS = {
  completed: ['badge-green', 'Completata'], voicemail: ['badge-gray', 'Segreteria'],
  busy: ['badge-yellow', 'Occupato'], 'no-answer': ['badge-yellow', 'Senza risposta'],
  failed: ['badge-red', 'Fallita'], unknown: ['badge-gray', '—']
};

async function loadCalls() {
  try {
    const [stats, calls] = await Promise.all([apiFetch('/api/voice/calls/stats?days=30'), apiFetch('/api/voice/calls?limit=100')]);
    document.getElementById('calls-stat-total').textContent = stats.total;
    document.getElementById('calls-stat-avg').textContent = fmtDuration(stats.avg_duration);
    document.getElementById('calls-stat-cost').textContent = '€' + (stats.total_cost || 0).toFixed(2);
    document.getElementById('calls-stat-ok').textContent = stats.total ? Math.round(stats.completed * 100 / stats.total) + '%' : '—';

    const body = document.getElementById('calls-body');
    if (!calls.length) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted)">Nessuna chiamata registrata. Compariranno qui appena l\'assistente risponde.</td></tr>';
      return;
    }
    body.innerHTML = calls.map(c => {
      const [cls, label] = CALL_STATUS[c.status] || CALL_STATUS.unknown;
      return `<tr>
        <td>${c.started_at ? esc(formatDateTime(c.started_at)) : '—'}</td>
        <td>${esc(c.caller_number || 'Sconosciuto')}</td>
        <td><span class="badge ${cls}">${esc(label)}</span></td>
        <td>${fmtDuration(c.duration_seconds)}</td>
        <td>€${(c.cost || 0).toFixed(3)}</td>
        <td class="call-summary" title="${esc(c.summary || '')}">${esc(c.summary || '—')}</td>
        <td><button class="btn-icon" title="Dettaglio" onclick="openCall(${Number(c.id)})"><i class="ph-bold ph-eye"></i></button></td>
      </tr>`;
    }).join('');
  } catch (e) { toast('Errore: ' + e.message, 'error'); }
}

async function openCall(id) {
  try {
    const c = await apiFetch('/api/voice/calls/' + id);
    document.getElementById('call-modal-title').textContent = `Chiamata del ${c.started_at ? formatDateTime(c.started_at) : '—'}`;
    document.getElementById('call-modal-meta').textContent =
      `${c.caller_number || 'Numero sconosciuto'} · ${fmtDuration(c.duration_seconds)} · €${(c.cost || 0).toFixed(3)}${c.ended_reason ? ' · ' + c.ended_reason : ''}`;
    document.getElementById('call-modal-summary').textContent = c.summary || 'Nessun riepilogo disponibile.';
    document.getElementById('call-modal-transcript').textContent = c.transcript || 'Trascrizione non disponibile.';
    const audio = document.getElementById('call-modal-audio');
    if (c.recording_url && /^https:\/\//i.test(c.recording_url)) { audio.src = c.recording_url; audio.style.display = 'block'; }
    else { audio.removeAttribute('src'); audio.style.display = 'none'; }
    document.getElementById('modal-call').style.display = 'flex';
  } catch (e) { toast(e.message, 'error'); }
}
