/**
 * popup.js — Tabbladen, instellingen en handmatige berekening
 *
 * Gebruikt dezelfde lookup-logica als content scripts maar inline
 * (popup draait in eigen context, niet als content script).
 */

import { getSettings, saveSettings } from '../utils/settings.js';

const fmt = (n) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

// ---------------------------------------------------------------------------
// Tab-navigatie
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
// Instellingen laden/opslaan
// ---------------------------------------------------------------------------
const settings = await getSettings();

// Postcode
const postcodeEl = document.getElementById('postcode');
postcodeEl.value = settings.postcode ?? '';
postcodeEl.addEventListener('change', () => {
  saveSettings({ postcode: postcodeEl.value.trim() });
});

// ---------------------------------------------------------------------------
// Inline BPM-berekening (kopie van nl-import.js logica)
// ---------------------------------------------------------------------------
const BPM_BRACKETS = [
  { from:   0, to:  82, rate:  0 },
  { from:  82, to: 100, rate:  4 },
  { from: 100, to: 150, rate:  7 },
  { from: 150, to: Infinity, rate: 18 },
];
const DEPRECIATION = [0,0.09,0.17,0.25,0.33,0.41,0.50,0.57,0.63,0.68,0.73,0.77,0.81,0.84,0.87,0.90];

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

function isNewCar(firstRegValue) {
  if (!firstRegValue) return false;
  // input[type=month] geeft "YYYY-MM"
  const d = new Date(firstRegValue + '-01');
  if (isNaN(d)) return false;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44) < 6;
}

function getAgeYears(firstRegValue, fallbackYear) {
  if (firstRegValue) {
    const d = new Date(firstRegValue + '-01');
    if (!isNaN(d)) return Math.max(0, (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  }
  if (fallbackYear) return Math.max(0, new Date().getFullYear() - fallbackYear);
  return 3;
}

// CO2-schatting (vereenvoudigd — enkel bouwjaar fallback in popup)
const CO2_YEAR_FALLBACK = {
  petrol:  {2024:138,2023:142,2022:146,2021:150,2020:152,2019:155,2018:158,2017:162,2016:166,2015:170,2014:175,2013:180,2012:185,2011:190,2010:196,2009:202,2008:210,2007:218,2006:225,2005:232},
  diesel:  {2024:128,2023:132,2022:136,2021:140,2020:143,2019:147,2018:151,2017:155,2016:159,2015:162,2014:167,2013:171,2012:175,2011:179,2010:184,2009:190,2008:198,2007:206,2006:214,2005:222},
  hybrid:  {2024: 95,2023: 98,2022:102,2021:106,2020:108,2019:112,2018:116,2017:120,2016:125,2015:130,2014:135,2013:140,2012:145,2011:150,2010:156},
  electric:{},
};

function estimateCO2(fuelType, year) {
  if (fuelType === 'electric') return { co2: 0, estimated: false };
  const table = CO2_YEAR_FALLBACK[fuelType] ?? CO2_YEAR_FALLBACK.petrol;
  const y     = Math.max(2005, Math.min(2024, year ?? 2020));
  return { co2: table[y] ?? 155, estimated: true };
}

// ---------------------------------------------------------------------------
// Bereken-knop
// ---------------------------------------------------------------------------
document.getElementById('calculateBtn').addEventListener('click', () => {
  const price       = parseFloat(document.getElementById('carPrice').value);
  const year        = parseInt(document.getElementById('carYear').value, 10);
  const fuelType    = document.getElementById('fuelType').value;
  const co2Input    = parseFloat(document.getElementById('co2').value) || null;
  const firstRegVal = document.getElementById('firstReg').value; // "YYYY-MM" of ""

  if (!price || !year) return;

  // CO2
  let co2, co2Estimated;
  if (co2Input) {
    co2 = co2Input; co2Estimated = false;
  } else {
    const est = estimateCO2(fuelType, year);
    co2 = est.co2; co2Estimated = est.estimated;
  }

  const ageYears   = getAgeYears(firstRegVal, year);
  const newCar     = isNewCar(firstRegVal);
  const bpmGross   = fuelType === 'electric' ? 0 : co2ToBPM(co2, fuelType);
  const bpm        = Math.round(bpmGross * (1 - getDepreciation(ageYears)));
  const vat        = newCar ? Math.round(price * 0.21) : 0;
  const total      = Math.round(price + vat + bpm);

  // BTW-rij: alleen tonen als nieuw
  const rowVat = document.getElementById('row-vat');
  rowVat.classList.toggle('dimmed', !newCar);
  document.getElementById('r-vat').textContent = newCar ? fmt(vat) : '—';

  // BPM-label met tooltip als geschat
  const bpmLabel = document.getElementById('r-bpm-label');
  if (co2Estimated) {
    bpmLabel.innerHTML = `BPM <span title="CO₂ geschat o.b.v. bouwjaar ${year}" style="cursor:help">⚠️</span>`;
  } else {
    bpmLabel.textContent = 'BPM';
  }

  // BPM-waarde: tooltip met CO2-basis
  const bpmVal = document.getElementById('r-bpm');
  if (fuelType === 'electric') {
    bpmVal.textContent = '—';
    bpmVal.removeAttribute('title');
  } else {
    bpmVal.textContent = fmt(bpm);
    bpmVal.title = `o.b.v. ${co2} g/km CO₂`;
  }

  document.getElementById('r-price').textContent = fmt(price);
  document.getElementById('r-total').textContent = fmt(total);

  const note = document.getElementById('r-note');
  note.textContent = !newCar ? 'BTW niet van toepassing (gebruikte auto, marge-regeling).' : '';

  document.getElementById('results').hidden = false;
});
