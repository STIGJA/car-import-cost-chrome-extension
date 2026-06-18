import { calculateImportCosts } from '../utils/calculator.js';
import { getSettings, saveSettings } from '../utils/settings.js';

const fmt = (n) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

// --- Laad instellingen ---
getSettings().then((s) => {
  document.getElementById('originOutsideEU').checked = s.originIsOutsideEU;
});

document.getElementById('originOutsideEU').addEventListener('change', (e) => {
  saveSettings({ originIsOutsideEU: e.target.checked });
});

// --- Berekening ---
document.getElementById('calculateBtn').addEventListener('click', () => {
  const price    = parseFloat(document.getElementById('carPrice').value);
  const year     = parseInt(document.getElementById('carYear').value, 10);
  const fuelType = document.getElementById('fuelType').value;
  const co2      = parseFloat(document.getElementById('co2').value) || null;

  if (!price || !year) return;

  const settings = { originIsOutsideEU: document.getElementById('originOutsideEU').checked };
  const costs = calculateImportCosts({ price, year, fuelType, co2 }, settings);

  document.getElementById('r-price').textContent = fmt(costs.price);
  document.getElementById('r-duty').textContent  = costs.importDuty > 0 ? fmt(costs.importDuty) : '—';
  document.getElementById('r-vat').textContent   = fmt(costs.vat);
  document.getElementById('r-bpm').textContent   = costs.bpm > 0 ? fmt(costs.bpm) : '— (EV)';
  document.getElementById('r-total').textContent = fmt(costs.total);
  document.getElementById('r-note').textContent  =
    co2 ? `BPM berekend op ${co2} g/km CO₂.` : 'BPM is een schatting (CO₂ onbekend).';

  document.getElementById('results').hidden = false;
});
