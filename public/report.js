// Report per il titolare e backup. Usa gli helper di app.js: apiFetch, esc, toast.

const eur0 = (n) => '€' + Math.round(n).toLocaleString('it-IT');
const eur2 = (n) => '€' + Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dur = (s) => { s = Math.round(s || 0); const m = Math.floor(s / 60); return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; };

async function loadReport() {
  const days = parseInt(document.getElementById('report-days').value, 10) || 30;
  let r;
  try { r = await apiFetch('/api/report?days=' + days); }
  catch (e) { return toast('Errore: ' + e.message, 'error'); }

  const empty = r.calls.total === 0 && r.reservations.byAssistant + r.reservations.byStaff + r.takeaway.byAssistant + r.takeaway.byStaff === 0;

  // ── valore stimato ──
  document.getElementById('report-hero').innerHTML = empty
    ? `<div class="hero-empty">Nessun dato negli ultimi ${days} giorni. Appena l'assistente risponde alle chiamate qui compaiono prenotazioni, ordini e il valore che generano.</div>`
    : `<div class="hero-label">Valore generato dall'assistente negli ultimi ${days} giorni <span class="hero-tag">stima</span></div>
       <div class="hero-value">${eur0(r.value.estimated)}</div>
       <div class="hero-sub">${r.value.covers} coperti prenotati × ${eur0(r.value.avgSpend)} a testa + ${eur0(r.value.takeawayRevenue)} di asporto. Costo delle telefonate: ${eur2(r.calls.cost)}.</div>
       ${r.value.outOfHours > 0 ? `<div class="hero-night"><i class="ph-bold ph-moon"></i> Di questi, <strong>${eur0(r.value.outOfHours)}</strong> arrivano da chiamate a locale chiuso: lavoro che senza l'assistente sarebbe andato perso.</div>` : ''}
       <div class="hero-note">È una stima: comprende anche prenotazioni che sarebbero arrivate comunque. Il dato più solido è quello delle chiamate fuori orario.</div>
       <div class="hero-edit">
         <label>Spesa media per coperto</label>
         <input id="report-spend" type="number" min="0" max="1000" step="1" value="${esc(r.value.avgSpend)}">
         <button class="btn btn-sm btn-outline" onclick="saveSpend()">Aggiorna stima</button>
         ${r.assumptions.usingDefaultSpend ? '<span class="hero-hint">Valore di esempio: inserisci quello reale del tuo locale.</span>' : ''}
       </div>`;

  // ── indicatori ──
  document.getElementById('report-kpis').innerHTML = [
    ['phone-incoming', 'Chiamate gestite', r.calls.total, `durata media ${dur(r.calls.avgDurationSec)}`],
    ['check-circle', 'Concluse con prenotazione o ordine', r.calls.actionRate + '%', `${r.calls.withAction} su ${r.calls.total} chiamate`],
    ['moon', 'Chiamate fuori orario', r.calls.outOfHours, 'risposte mentre il locale era chiuso'],
    ['currency-eur', 'Costo voce', eur2(r.calls.cost), r.calls.total ? `${eur2(r.calls.cost / r.calls.total)} a chiamata` : '—']
  ].map(([icon, label, value, sub]) => `
    <div class="stat-card"><div class="stat-icon"><i class="ph-bold ph-${icon}"></i></div>
    <div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`).join('');

  // ── prenotazioni e asporto ──
  document.getElementById('report-res').innerHTML = `
    <div class="split-row"><span>Fatte dall'assistente</span><strong>${r.reservations.byAssistant}</strong></div>
    <div class="split-row"><span>Fatte dallo staff</span><strong>${r.reservations.byStaff}</strong></div>
    <div class="split-row"><span>Coperti prenotati dall'assistente</span><strong>${r.reservations.covers}</strong></div>
    <div class="split-row"><span>Annullate</span><strong>${r.reservations.cancelled}</strong></div>`;
  document.getElementById('report-take').innerHTML = `
    <div class="split-row"><span>Ordini dell'assistente</span><strong>${r.takeaway.byAssistant}</strong></div>
    <div class="split-row"><span>Ordini dello staff</span><strong>${r.takeaway.byStaff}</strong></div>
    <div class="split-row"><span>Incasso asporto dall'assistente</span><strong>${eur2(r.takeaway.revenue)}</strong></div>`;

  // ── grafico giornaliero ──
  const max = Math.max(1, ...r.series.map(s => Math.max(s.calls, s.actions)));
  document.getElementById('report-chart').innerHTML = r.series.map(s => `
    <div class="bar-col" title="${esc(s.date.split('-').reverse().join('/'))}: ${s.calls} chiamate, ${s.actions} tra prenotazioni e ordini">
      <div class="bars"><div class="bar calls" style="height:${Math.round(s.calls * 100 / max)}%"></div><div class="bar actions" style="height:${Math.round(s.actions * 100 / max)}%"></div></div>
      <div class="bar-label">${esc(s.date.slice(8))}</div>
    </div>`).join('');

  document.getElementById('report-peaks').innerHTML = r.peakHours.length
    ? r.peakHours.map(p => `<div class="split-row"><span>Intorno alle ${esc(p.hour)}</span><strong>${p.covers} coperti</strong></div>`).join('')
    : '<div class="rules-hint">Ancora nessuna prenotazione nel periodo.</div>';
}

async function saveSpend() {
  try {
    await apiFetch('/api/report/settings', { method: 'POST', body: { AVG_SPEND_PER_COVER: document.getElementById('report-spend').value } });
    toast('Stima aggiornata');
    loadReport();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Backup ─────────────────────────────────────────────────────────────────────
const fmtKb = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

async function loadBackups() {
  const box = document.getElementById('backup-list');
  try {
    const d = await apiFetch('/api/backup');
    document.getElementById('backup-info').textContent = d.lastBackupAt
      ? `Ultima copia: ${formatDateTime(d.lastBackupAt)}. Si tengono le ultime 14, nella cartella ${d.folder}.`
      : 'Nessuna copia ancora: la prima parte da sola entro pochi secondi dall\'avvio.';
    box.innerHTML = d.backups.slice(0, 5).map(b => `<div class="split-row"><span>${esc(formatDateTime(b.created))}</span><strong>${esc(fmtKb(b.size))}</strong></div>`).join('');
  } catch (e) { box.innerHTML = ''; }
}

async function backupNow() {
  try { await apiFetch('/api/backup', { method: 'POST' }); toast('Copia creata'); loadBackups(); }
  catch (e) { toast(e.message, 'error'); }
}

function downloadBackup() { window.location.href = '/api/backup/download'; }
