import { calculateImportCosts } from '../utils/calculator.js';
import { getSettings, saveSettings } from '../utils/settings.js';

const fmt = (n) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

// Laad opgeslagen instellingen
getSettings().then((s) => {
  document.getElementById('destinationCountry').value = s.destinationCountry;
  document.getElementById('originOutsideEU').checked = s.originIsOutsideEU;
});

// Sla instellingen op bij wijziging
document.getElementById('destinationCountry').addEventListener('change', saveCurrentSettings);
document.getElementById('originOutsideEU').addEventListener('change', saveCurrentSettings);

function saveCurrentSettings() {
  saveSettings({
    destinationCountry: document.getElementById('destinationCountry').value,
    originIsOutsideEU: document.getElementById('originOutsideEU').checked,
  });
}

// Handmatige berekening
document.getElementById('calculateBtn').addEventListener('click', () => {
  const price = parseFloat(document.getElementById('carPrice').value);
  const year = parseInt(document.getElementById('carYear').value, 10);
  const fuelType = document.getElementById('fuelType').value;
  const destinationCountry = document.getElementById('destinationCountry').value;

  if (!price || !year) return;

  const costs = calculateImportCosts({ price, year, fuelType, destinationCountry });

  document.getElementById('res-price').textContent = fmt(costs.price);
  document.getElementById('res-bpm').textContent = costs.bpm > 0 ? fmt(costs.bpm) : '—';
  document.getElementById('res-roadside').textContent = costs.roadsideTax ? fmt(costs.roadsideTax) : '—';
  document.getElementById('res-btw').textContent = `${fmt(costs.vat)} (${costs.vatRate}%)`;
  document.getElementById('res-import').textContent = fmt(costs.importDuty);
  document.getElementById('res-total').textContent = fmt(costs.total);

  document.getElementById('results').hidden = false;
  document.getElementById('res-disclaimer').textContent = costs.disclaimer;
});
