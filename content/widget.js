/**
 * Widget injector
 *
 * injectListingWidget — groot widget op advertentiepagina, naast de prijs
 * injectSearchWidgets — compact badge per kaart in zoekresultaten
 */

import { calculateImportCosts } from '../utils/calculator.js';
import { getSettings } from '../utils/settings.js';

const LISTING_WIDGET_ID = 'cic-listing-widget';

const fmt = (n) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

// ---------------------------------------------------------------------------
// Advertentiepagina
// ---------------------------------------------------------------------------

export function injectListingWidget(carData, costs) {
  if (document.getElementById(LISTING_WIDGET_ID)) return;

  const widget = document.createElement('div');
  widget.id = LISTING_WIDGET_ID;

  widget.innerHTML = `
    <div class="cic-header">
      <span class="cic-flag">🇳🇱</span>
      <span class="cic-title">Importkosten naar NL</span>
    </div>
    <table class="cic-table">
      <tr><td>Vraagprijs</td>          <td class="cic-val">${fmt(costs.price)}</td></tr>
      <tr><td>Invoerrechten (6,5%)</td><td class="cic-val">${fmt(costs.importDuty)}</td></tr>
      <tr><td>BTW (21%)</td>           <td class="cic-val">${fmt(costs.vat)}</td></tr>
      ${costs.bpm > 0 ? `<tr><td>BPM</td><td class="cic-val">${fmt(costs.bpm)}</td></tr>` : ''}
      <tr class="cic-total-row">
        <td>Totaal</td>
        <td class="cic-val">${fmt(costs.total)}</td>
      </tr>
    </table>
    <p class="cic-note">${costs.bpm > 0 ? '* BPM berekend op basis van CO₂ en brandstof.' : '* EV: geen BPM.'}</p>
  `;

  const anchor =
    document.querySelector('[data-testid="price-section"]') ??
    document.querySelector('.cldt-price')?.closest('section') ??
    document.querySelector('aside');

  anchor?.insertAdjacentElement('afterend', widget);
}

// ---------------------------------------------------------------------------
// Zoekresultatenpagina
// ---------------------------------------------------------------------------

export async function injectSearchWidgets(cards, settings) {
  for (const { el, price, year, fuelType, co2 } of cards) {
    if (el.querySelector('.cic-badge')) continue; // al geïnjecteerd

    const costs = calculateImportCosts({ price, year, fuelType, co2 }, settings);

    const badge = document.createElement('div');
    badge.className = 'cic-badge';
    badge.innerHTML = `
      <span class="cic-badge-label">🇳🇱 Totaal</span>
      <span class="cic-badge-value">${fmt(costs.total)}</span>
    `;

    // Plak de badge onderaan de kaart, na het prijselement
    const priceEl = el.querySelector('[data-testid="price"], .cldt-price, [class*="price"]');
    priceEl?.insertAdjacentElement('afterend', badge);
  }
}
