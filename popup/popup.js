import { calculateImportCosts } from '../utils/calculator.js';

const calculateBtn = document.getElementById('calculateBtn');
const resultsSection = document.getElementById('results');

const fmt = (amount) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(amount);

calculateBtn.addEventListener('click', () => {
  const price = parseFloat(document.getElementById('carPrice').value);
  const year = parseInt(document.getElementById('carYear').value, 10);
  const fuelType = document.getElementById('fuelType').value;

  if (!price || !year) return;

  const costs = calculateImportCosts({ price, year, fuelType });

  document.getElementById('res-price').textContent = fmt(costs.price);
  document.getElementById('res-bpm').textContent = fmt(costs.bpm);
  document.getElementById('res-btw').textContent = fmt(costs.btw);
  document.getElementById('res-import').textContent = fmt(costs.importDuty);
  document.getElementById('res-total').textContent = fmt(costs.total);

  resultsSection.hidden = false;
});
