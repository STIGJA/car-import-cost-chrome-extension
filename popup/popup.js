/**
 * popup.js
 */

import { getSettings, saveSettings } from '../utils/settings.js';

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
// Berekeningslogica (inline — popup heeft geen toegang tot content/ scripts)
// ---------------------------------------------------------------------------
const BPM_BRACKETS = [
  { from:   0, to:  82, rate:  0 },
  { from:  82, to: 100, rate:  4 },
  { from: 100, to: 150, rate:  7 },
  { from: 150, to: Infinity, rate: 18 },
];

const DEPRECIATION = [0,0.09,0.17,0.25,0.33,0.41,0.50,0.57,0.63,0.68,0.73,0.77,0.81,0.84,0.87,0.90];

const CO2_FALLBACK = {
  petrol:  {2024:138,2023:142,2022:146,2021:150,2020:152,2019:155,2018:158,2017:162,2016:166,2015:170,2014:175,2013:180,2012:185,2011:190,2010:196,2009:202,2008:210,2007:218,2006:225,2005:232},
  diesel:  {2024:128,2023:132,2022:136,2021:140,2020:143,2019:147,2018:151,2017:155,2016:159,2015:162,2014:167,2013:171,2012:175,2011:179,2010:184,2009:190,2008:198,2007:206,2006:214,2005:222},
  hybrid:  {2024: 95,2023: 98,2022:102,2021:106,2020:108,2019:112,2018:116,2017:120,2016:125,2015:130,2014:135,2013:140,2012:145,2011:150,2010:156},
  electric:{},
};

function co2ToBPM(co2, fuelType) {
  let bpm = 0;
  for (const { from, to, rate } of BPM_BRACKETS) {
    if (co2 > from) bpm += (Math.min(co2, to) - from) * rate;
  }
  if (fuelType === 'diesel') bpm = Math.round(bpm * 1.15);
  return Math.round(bpm);
}

function getDepreciation(ageYears) {
  return DEPRECIATION[Math.max(0, Math.min(Math.floor(ageYears), DEPRECIATION.length - 1))];
}

function getAgeMonths(month, year) {
  if (!month || !year) return null;
  const reg = new Date(year, month - 1, 1);
  return (Date.now() - reg.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

function estimateCO2(fuelType, year) {
  const table = CO2_FALLBACK[fuelType] ?? CO2_FALLBACK.petrol;
  const y = Math.max(2005, Math.min(2024, year ?? 2020));
  return table[y] ?? 155;
}

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

  // CO2
  const co2Estimated = !co2Input;
  const co2 = co2Input ?? (fuelType === 'electric' ? 0 : estimateCO2(fuelType, regYear));

  // Leeftijd
  const ageMonths = getAgeMonths(regMonth, regYear);
  const ageYears  = ageMonths != null ? ageMonths / 12 : 3;
  const isNew     = ageMonths != null && ageMonths < 6;

  // Kosten
  const vat      = isNew ? Math.round(price * 0.21) : 0;
  const bpmGross = fuelType === 'electric' ? 0 : co2ToBPM(co2, fuelType);
  const bpm      = Math.round(bpmGross * (1 - getDepreciation(ageYears)));
  const total    = Math.round(price + vat + bpm);

  // Render tabel
  const rows = [];

  rows.push(['Vraagprijs', fmt(price), null]);

  if (isNew) {
    rows.push(['BTW (21%)', fmt(vat), null]);
  }

  if (fuelType === 'electric') {
    rows.push(['BPM', '\u2014', null]);
  } else {
    const bpmTooltip = `o.b.v. ${co2}\u00a0g/km CO\u2082`;
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
