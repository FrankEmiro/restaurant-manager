// Orari di apertura, regole di prenotazione/asporto e chiusure.
// Usa gli helper di app.js: apiFetch, esc, toast.

const RULE_DAYS = [
  ['lun', 'lunedì'], ['mar', 'martedì'], ['mer', 'mercoledì'], ['gio', 'giovedì'],
  ['ven', 'venerdì'], ['sab', 'sabato'], ['dom', 'domenica']
];
const RULE_KEYS = ['TURN_MINUTES', 'RES_LEAD_MINUTES', 'LAST_SEATING_MINUTES', 'TAKEAWAY_PREP_MINUTES', 'TAKEAWAY_MAX_PER_SLOT'];
let _closures = [];

async function loadRules() {
  let d;
  try { d = await apiFetch('/api/rules'); }
  catch (e) { return toast('Errore: ' + e.message, 'error'); }

  document.getElementById('hours-body').innerHTML = RULE_DAYS.map(([key, name]) => {
    const [a = ['', ''], b = ['', '']] = d.hours[key] || [];
    return `<tr>
      <td class="day">${esc(name)}</td>
      <td><div class="range"><input type="time" id="h-${key}-1-from" value="${esc(a[0])}"><span>–</span><input type="time" id="h-${key}-1-to" value="${esc(a[1])}"></div></td>
      <td><div class="range"><input type="time" id="h-${key}-2-from" value="${esc(b[0])}"><span>–</span><input type="time" id="h-${key}-2-to" value="${esc(b[1])}"></div></td>
    </tr>`;
  }).join('');

  RULE_KEYS.forEach(k => { document.getElementById('rule-' + k).value = d.rules[k]; });
  _closures = d.closures;
  renderClosures();

  const banner = document.getElementById('rules-banner');
  banner.style.display = d.configured ? 'none' : 'block';
  banner.textContent = 'Stai usando orari di esempio (12:00–15:00 e 19:00–23:00, tutti i giorni). Inserisci i tuoi e premi Salva: finché non lo fai, prenotazioni e assistente li applicano.';
}

function renderClosures() {
  const list = document.getElementById('closures-list');
  if (!_closures.length) { list.innerHTML = '<div class="rules-hint">Nessuna chiusura programmata.</div>'; return; }
  const fmt = (s) => s.split('-').reverse().join('/');
  list.innerHTML = _closures.map((c, i) => `
    <div class="closure-item">
      <div><strong>${c.to && c.to !== c.from ? `${esc(fmt(c.from))} → ${esc(fmt(c.to))}` : esc(fmt(c.from))}</strong>${c.reason ? ` <span>· ${esc(c.reason)}</span>` : ''}</div>
      <button class="btn-icon danger" title="Rimuovi" onclick="removeClosure(${i})"><i class="ph-bold ph-trash"></i></button>
    </div>`).join('');
}

function addClosure() {
  const from = document.getElementById('closure-from').value;
  const to = document.getElementById('closure-to').value;
  const reason = document.getElementById('closure-reason').value.trim();
  if (!from) return toast('Indica la data di inizio', 'error');
  if (to && to < from) return toast('La data finale non può precedere quella iniziale', 'error');
  _closures.push({ from, to: to || from, reason });
  _closures.sort((a, b) => a.from.localeCompare(b.from));
  ['closure-from', 'closure-to', 'closure-reason'].forEach(id => { document.getElementById(id).value = ''; });
  renderClosures();
}

function removeClosure(i) { _closures.splice(i, 1); renderClosures(); }

async function saveRules() {
  const hours = {};
  for (const [key] of RULE_DAYS) {
    hours[key] = [1, 2].map(n => [document.getElementById(`h-${key}-${n}-from`).value, document.getElementById(`h-${key}-${n}-to`).value])
      .filter(([f, t]) => f || t);
    if (hours[key].some(([f, t]) => !f || !t)) return toast(`${key}: compila sia l'apertura sia la chiusura`, 'error');
  }
  const rules = {};
  RULE_KEYS.forEach(k => { rules[k] = document.getElementById('rule-' + k).value; });
  try {
    await apiFetch('/api/rules', { method: 'POST', body: { hours, closures: _closures, rules } });
    toast('Orari e regole salvati');
    loadRules();
  } catch (e) { toast(e.message, 'error'); }
}
