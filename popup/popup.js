/**
 * popup.js
 *
 * BPM logic comes from window.CIC_BPM (utils/bpm.js loaded via popup.html <script>)
 * so the popup and content scripts always share the same BPM brackets and tables.
 */

import { getSettings, saveSettings, resetSettings, SETTING_DEFAULTS } from '../utils/settings.js';

const { bpmBruto, bpmNetto, estimateCO2 } = window.CIC_BPM;

const fmt = (n) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

// ---------------------------------------------------------------------------
// Tab navigation
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
// Settings — load and persist on change
// ---------------------------------------------------------------------------

const settings = await getSettings();

const postcodeEl   = document.getElementById('postcode');
const fixedCostsEl = document.getElementById('fixedCosts');

postcodeEl.value   = settings.postcode   ?? '';
fixedCostsEl.value = settings.fixedCosts ?? SETTING_DEFAULTS.fixedCosts;

postcodeEl.addEventListener('change', () =>
  saveSettings({ postcode: postcodeEl.value.trim() })
);

fixedCostsEl.addEventListener('change', () => {
  const val = parseFloat(fixedCostsEl.value);
  if (!isNaN(val) && val >= 0) saveSettings({ fixedCosts: val });
});

// Reset all settings to their defaults
document.getElementById('resetSettingsBtn').addEventListener('click', async () => {
  await resetSettings();
  postcodeEl.value   = SETTING_DEFAULTS.postcode;
  fixedCostsEl.value = SETTING_DEFAULTS.fixedCosts;
});

// ---------------------------------------------------------------------------
// Pre-fill current month + year as default first-registration date
// ---------------------------------------------------------------------------

const now = new Date();
document.getElementById('regMonth').value = String(now.getMonth() + 1);
document.getElementById('regYear').value  = String(now.getFullYear());

// ---------------------------------------------------------------------------
// Calculate button
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

  const currentFixedCosts = parseFloat(fixedCostsEl.value) || SETTING_DEFAULTS.fixedCosts;

  const vat   = isNew ? Math.round(price * 0.21) : 0;
  const gross = bpmBruto(co2, fuelType);
  const bpm   = bpmNetto(co2, fuelType, ageYears);
  const total = Math.round(price + vat + bpm + currentFixedCosts);

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

  rows.push(['Vaste kosten (RDW e.d.)', fmt(currentFixedCosts), null]);

  const table = document.getElementById('results-table');
  table.innerHTML = rows.map(([label, value, meta]) => {
    const labelHtml = meta?.labelWarning
      ? `${label} <span title="${meta.labelWarning}" class="cic-warning-icon">&#x26A0;&#xFE0F;</span>`
      : label;
    const valueHtml = meta?.valueTooltip
      ? `<span title="${meta.valueTooltip}" class="cic-tooltip-trigger">${value}</span>`
      : value;
    return `<tr><td>${labelHtml}</td><td>${valueHtml}</td></tr>`;
  }).join('') +
  `<tr class="row-total"><td>Totaal</td><td>${fmt(total)}</td></tr>`;

  document.getElementById('r-note').textContent =
    isNew ? '' : (ageMonths != null ? 'BTW niet van toepassing (gebruikte auto).' : 'Registratiedatum onbekend \u2014 BTW niet berekend.');

  document.getElementById('results').hidden = false;
});
