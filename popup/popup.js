/**
 * popup.js
 *
 * BPM-logica komt van window.CIC_BPM (utils/bpm.js via popup.html <script>).
 * Zo gebruiken popup en content scripts altijd dezelfde staffel en tabellen.
 */

import { getSettings, saveSettings } from '../utils/settings.js';

const { bpmBruto, bpmNetto, estimateCO2 } = window.CIC_BPM;

const fmt = (n) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
  });
});

// ---------------------------------------------------------------------------
// Instellingen
// ---------------------------------------------------------------------------
const settings = await getSettings();

const postcodeEl = document.getElementById('postcode');
postcodeEl.value = settings.postcode ?? '';
postcodeEl.addEventListener('change', () => saveSettings({ postcode: postcodeEl.value.trim() }));

// ---------------------------------------------------------------------------
// Vul huidige maand en jaar in als standaard voor eerste registratie
// ---------------------------------------------------------------------------
const now = new Date();
document.getElementById('regMonth').value = String(now.getMonth() + 1);
document.getElementById('regYear').value  = String(now.getFullYear());

// ---------------------------------------------------------------------------
// Bereken
// ---------------------------------------------------------------------------
document.getElementById('calculateBtn').addEventListener('click', () => {
  const price    = parseFloat(document.getElementById('carPrice').value);
  const regMonth = parseInt(document.getElementById('regMonth').value, 10) || null;
  const regYear  = parseInt(document.getElementById('regYear').value, 10)  || null;
  const fuelType = document.getElementById('fuelType').value;
  const co2Input = parseFloat(document.getElementById('co2').value) || null;

  if (!price) return;

  const co2Estimated = !co2Input;
  const co2 = co2Input ?? estimateCO2(fuelType, regYear);

  const ageMonths = (regMonth && regYear)
    ? (Date.now() - new Date(regYear, regMonth - 1, 1).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    : null;
  const ageYears = ageMonths != null ? ageMonths / 12 : 3;
  const isNew    = ageMonths != null && ageMonths < 6;

  const vat   = isNew ? Math.round(price * 0.21) : 0;
  const gross = bpmBruto(co2, fuelType);
  const bpm   = bpmNetto(co2, fuelType, ageYears);
  const total = Math.round(price + vat + bpm);

  const rows = [];
  rows.push(['Vraagprijs', fmt(price), null]);
  if (isNew) rows.push(['BTW (21%)', fmt(vat), null]);

  if (fuelType === 'electric') {
    rows.push(['BPM', '\u2014', null]);
  } else {
    const bpmTooltip = `o.b.v. ${co2}\u00a0g/km CO\u2082 (bruto ${fmt(gross)})`;
    const bpmWarning = co2Estimated ? `CO\u2082 geschat o.b.v. bouwjaar ${regYear ?? '?'}` : null;
    rows.push(['BPM', fmt(bpm), { valueTooltip: bpmTooltip, labelWarning: bpmWarning }]);
  }

  const table = document.getElementById('results-table');
  table.innerHTML = rows.map(([label, value, meta]) => {
    const labelHtml = meta?.labelWarning
      ? `${label} <span title="${meta.labelWarning}" style="cursor:help">\u26a0\ufe0f</span>`
      : label;
    const valueHtml = meta?.valueTooltip
      ? `<span title="${meta.valueTooltip}" style="cursor:help;text-decoration:underline dotted">${value}</span>`
      : value;
    return `<tr><td>${labelHtml}</td><td>${valueHtml}</td></tr>`;
  }).join('') +
  `<tr class="row-total"><td>Totaal</td><td>${fmt(total)}</td></tr>`;

  document.getElementById('r-note').textContent =
    isNew ? '' : (ageMonths != null ? 'BTW niet van toepassing (gebruikte auto).' : 'Registratiedatum onbekend \u2014 BTW niet berekend.');

  document.getElementById('results').hidden = false;
});
