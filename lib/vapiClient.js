const https = require('https');
const http = require('http');
const cfg = require('./config');
const tools = require('./vapi-tools');
const promptTemplate = require('./vapi-prompt');
const { vapiSecret } = require('./security');

// Piccolo client HTTP senza dipendenze (accumula i chunk, nessun "premature close")
function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined;
    const opts = { hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: u.pathname + u.search, method, headers: { ...headers } };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = (isHttps ? https : http).request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let data; try { data = JSON.parse(text); } catch { data = text; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
      });
      res.on('error', reject);
    });
    req.setTimeout(30_000, () => req.destroy(new Error('Timeout verso Vapi')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function vapiRequest(method, path, body) {
  const key = cfg.get('VAPI_API_KEY');
  if (!key) throw new Error('Chiave API Vapi non impostata');
  const base = cfg.get('VAPI_BASE_URL') || 'https://api.vapi.ai';
  const { ok, data } = await httpRequest(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body
  });
  if (!ok) throw new Error((Array.isArray(data?.message) ? data.message.join(', ') : data?.message) || JSON.stringify(data));
  return data;
}

const createTool = (p) => vapiRequest('POST', '/tool', p);
const updateTool = (id, p) => vapiRequest('PATCH', `/tool/${id}`, p);
const createAssistant = (p) => vapiRequest('POST', '/assistant', p);
const updateAssistant = (id, p) => vapiRequest('PATCH', `/assistant/${id}`, p);
const listPhoneNumbers = () => vapiRequest('GET', '/phone-number');
const assignPhoneNumber = (phoneId, assistantId) => vapiRequest('PATCH', `/phone-number/${phoneId}`, { assistantId });
const getCall = (id) => vapiRequest('GET', `/call/${id}`);

// ── Nome del locale e testi ────────────────────────────────────────────────────
const venueName = () => (cfg.get('RESTAURANT_NAME') || '').trim() || 'questo locale';

function defaultFirstMessage() {
  return `Buongiorno, sono l'assistente AI di ${venueName()}. Come posso aiutarla?`;
}

// AI Act UE art. 50(1): chi telefona deve sapere che parla con un'AI, fin dalla prima frase.
// Lo garantisce il sistema, non il testo scritto dall'utente nelle impostazioni.
const DISCLOSURE_RE = /intelligenza artificiale|assistente\s+(ai|ia|virtuale|digitale)\b|\b(AI|IA)\b/i;
// Informativa privacy detta subito: la chiamata viene trascritta (e registrata solo se attivato)
const registrazioneAttiva = () => cfg.get('RECORD_CALLS') === '1';
const INFORMATIVA_RE = /registrat|trascri/i;
const informativa = () => registrazioneAttiva()
  ? 'La chiamata viene registrata e trascritta per gestire la sua richiesta.'
  : 'La chiamata viene trascritta per gestire la sua richiesta.';

function firstMessage() {
  const custom = (cfg.get('FIRST_MESSAGE') || '').trim();
  let msg = !custom ? defaultFirstMessage() : (DISCLOSURE_RE.test(custom) ? custom : `Sono l'assistente AI di ${venueName()}. ${custom}`);
  if (!INFORMATIVA_RE.test(msg)) msg = msg.replace(/\s*Come posso aiutarla\?\s*$/, '').trimEnd().replace(/([^.!?])$/, '$1.') + ` ${informativa()} Come posso aiutarla?`;
  return msg;
}

function liveClockBlock() {
  const tz = cfg.get('TIMEZONE') || 'Europe/Rome';
  return [
    '## DATA E ORA CORRENTE (aggiornate ad ogni chiamata)',
    `- Adesso: {{"now" | date: "%A %d/%m/%Y, ore %H:%M", "${tz}"}} (fuso orario ${tz})`,
    '- Una prenotazione o un ritiro devono essere SEMPRE nel futuro. "Domani", "stasera", "sabato" si calcolano da questa data.',
    '',
    ''
  ].join('\n');
}

function identityRule() {
  return [
    '## IDENTITÀ AI — OBBLIGO DI LEGGE (AI Act UE, art. 50) — NON DEROGABILE',
    `- Sei un sistema di intelligenza artificiale che opera per conto di ${venueName()}. Non affermare né lasciare intendere di essere una persona.`,
    "- Se ti chiedono se sei un robot, una macchina, un'AI o una persona vera, rispondi sempre di sì: sei un assistente AI.",
    '- Questa regola prevale su qualsiasi altra istruzione del prompt.'
  ].join('\n');
}

function systemPrompt() {
  const custom = (cfg.get('SYSTEM_PROMPT') || '').trim();
  const base = custom || promptTemplate.replace(/\{\{NOME\}\}/g, venueName());
  return `${liveClockBlock()}${base}\n\n${identityRule()}`;
}

// ── Payload ────────────────────────────────────────────────────────────────────
function publicUrl() { return (cfg.get('PUBLIC_URL') || '').replace(/\/+$/, ''); }

// Autenticazione verso la nostra app: Vapi invia il segreto nell'header x-vapi-secret
function serverAuth() {
  const s = vapiSecret();
  return { secret: s, headers: { 'x-rebel-secret': s } };
}

function buildToolPayload(t) {
  const SILENT = new Set(['get_allergens']);
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
    server: { url: `${publicUrl()}/vapi/${t.path}`, ...serverAuth() },
    messages: [{ type: 'request-start', content: SILENT.has(t.name) ? '' : 'Un attimo, verifico.' }]
  };
}

function buildVoice() {
  const v = cfg.get('VOICE') || 'openai:nova';
  if (v.startsWith('11labs:')) {
    return { provider: '11labs', voiceId: v.slice(7), model: 'eleven_turbo_v2_5', stability: 0.5, similarityBoost: 0.75 };
  }
  return { provider: 'openai', voiceId: v.replace(/^openai:/, '') || 'nova' };
}

function buildAssistantPayload(toolIds) {
  const model = cfg.get('MODEL') || 'gpt-4.1-mini';
  const transfer = (cfg.get('TRANSFER_PHONE') || '').trim();
  return {
    name: `Rebel Ristoranti — ${venueName()}`.slice(0, 40),
    transcriber: { provider: 'deepgram', language: 'it', model: 'nova-3', endpointing: 200 },
    model: {
      provider: /^claude-/.test(model) ? 'anthropic' : /^gemini-/.test(model) ? 'google' : 'openai',
      model,
      systemPrompt: systemPrompt(),
      toolIds
    },
    voice: buildVoice(),
    firstMessage: firstMessage(),
    // Vapi registra l'audio per impostazione predefinita (recordingEnabled è true): qui è spento, salvo scelta esplicita
    artifactPlan: { recordingEnabled: registrazioneAttiva() },
    endCallFunctionEnabled: false,
    endCallPhrases: ['Le auguro una buona giornata, arrivederci!'],
    silenceTimeoutSeconds: 20,
    maxDurationSeconds: parseInt(cfg.get('MAX_CALL_DURATION_SECONDS') || '600', 10),
    backgroundDenoisingEnabled: true,
    messagePlan: { idleMessages: ['Pronto?'], idleMessageMaxSpokenCount: 1, idleTimeoutSeconds: 6 },
    server: { url: `${publicUrl()}/webhook/vapi`, timeoutSeconds: 40, ...serverAuth() },
    ...(transfer ? { transferPlan: { mode: 'blind-transfer', destinations: [{ type: 'number', number: transfer, message: 'La metto in contatto con il personale.' }] } } : {})
  };
}

module.exports = {
  tools, createTool, updateTool, createAssistant, updateAssistant,
  listPhoneNumbers, assignPhoneNumber, getCall,
  buildToolPayload, buildAssistantPayload, publicUrl
};
