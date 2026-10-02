// Avvisi sonori per nuovi ordini, prenotazioni e segnalazioni + stampa di comande e foglio del giorno.
// Usa gli helper di app.js: apiFetch, toast, activeView, loadView.

const ALERT_POLL_MS = 8000;
let _audio = null;
let _alertBaseline = null;   // ultimi id visti: il primo controllo non suona
let _unseen = 0;
const _origTitle = document.title;

const soundEnabled = () => { try { return localStorage.getItem('alertSound') !== '0'; } catch { return true; } };

// I browser bloccano l'audio finché l'utente non tocca la pagina: lo si sblocca al primo click
function unlockAudio() {
  try {
    _audio = _audio || new (window.AudioContext || window.webkitAudioContext)();
    if (_audio.state === 'suspended') _audio.resume();
  } catch { /* audio non disponibile */ }
}
document.addEventListener('click', unlockAudio);
document.addEventListener('touchstart', unlockAudio, { passive: true });

function tone(freq, start, dur, vol = 0.25) {
  const o = _audio.createOscillator(), g = _audio.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, _audio.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, _audio.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, _audio.currentTime + start + dur);
  o.connect(g); g.connect(_audio.destination);
  o.start(_audio.currentTime + start); o.stop(_audio.currentTime + start + dur + 0.05);
}

function playAlert(kind) {
  if (!soundEnabled() || !_audio || _audio.state !== 'running') return;
  if (kind === 'order') { [0, 0.55].forEach(t => { tone(880, t, 0.25); tone(660, t + 0.25, 0.3); }); }      // din-don ×2: cucina
  else if (kind === 'reservation') { tone(740, 0, 0.35, 0.18); }                                             // nota singola: sala
  else { tone(330, 0, 0.3, 0.25); tone(330, 0.4, 0.3, 0.25); }                                              // segnalazione: bassa ×2
}

const ALERT_LABEL = { order: 'Nuovo ordine asporto', reservation: 'Nuova prenotazione', complaint: 'Nuova segnalazione' };

async function checkAlerts() {
  let a;
  try { a = await apiFetch('/api/alerts'); } catch { return; }
  const now = { order: a.orders, reservation: a.reservations, complaint: a.complaints };
  if (_alertBaseline === null) {
    try { _alertBaseline = JSON.parse(sessionStorage.getItem('alertBase') || 'null'); } catch { _alertBaseline = null; }
    if (!_alertBaseline) _alertBaseline = now;
  }
  const fresh = Object.keys(now).filter(k => now[k] > (_alertBaseline[k] || 0));
  _alertBaseline = now;
  try { sessionStorage.setItem('alertBase', JSON.stringify(now)); } catch {}
  if (!fresh.length) return;

  // l'ordine conta più del resto: se ce n'è uno nuovo suona quello
  const kind = fresh.includes('order') ? 'order' : fresh[0];
  playAlert(kind);
  fresh.forEach(k => toast(ALERT_LABEL[k], 'info'));
  if (document.hidden) { _unseen += fresh.length; document.title = `(${_unseen}) ${_origTitle}`; }
  // aggiorna la vista aperta così il nuovo arriva a schermo
  if (['dashboard', 'cucina', 'agenda', 'segnalazioni', 'mappa'].includes(activeView)) loadView(activeView);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { _unseen = 0; document.title = _origTitle; }
});

function updateSoundButton() {
  const btn = document.getElementById('sound-btn');
  if (!btn) return;
  btn.innerHTML = soundEnabled()
    ? '<i class="ph-bold ph-bell-ringing"></i><span>Suoni attivi</span>'
    : '<i class="ph-bold ph-bell-slash"></i><span>Suoni spenti</span>';
}

function toggleSound() {
  const next = !soundEnabled();
  try { localStorage.setItem('alertSound', next ? '1' : '0'); } catch {}
  unlockAudio();
  updateSoundButton();
  if (next) playAlert('reservation'); // prova
}

document.addEventListener('DOMContentLoaded', () => {
  updateSoundButton();
  checkAlerts();
  setInterval(checkAlerts, ALERT_POLL_MS);
});

// ── Stampa ─────────────────────────────────────────────────────────────────────
function printTicket(orderId) {
  window.open(`/print/order/${Number(orderId)}?autoprint=1`, '_blank', 'width=420,height=680');
}

function printPendingTickets() {
  // tutte le comande in attesa, una dopo l'altra (il browser può bloccare più finestre: consentirle una volta)
  apiFetch('/api/orders').then(orders => {
    const pending = orders.filter(o => o.status === 'pending');
    if (!pending.length) return toast('Nessun ordine in attesa da stampare', 'info');
    pending.forEach((o, i) => setTimeout(() => printTicket(o.id), i * 600));
  }).catch(e => toast('Errore: ' + e.message, 'error'));
}

function printDaySheet(date) {
  const d = date || (typeof today === 'function' ? today() : '');
  window.open(`/print/day?date=${encodeURIComponent(d)}&autoprint=1`, '_blank');
}
