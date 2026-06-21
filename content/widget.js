/**
 * widget.js
 *
 * Legacy widget injector — kept for backwards compatibility.
 * New code should use renderer.js (window.CIC_Renderer) instead.
 *
 * Exports:
 *   injectListingWidget(carData, costs) — full widget on the car detail page
 *   injectSearchWidgets(cards, settings) — compact badge per card on search pages
 */

import { calculateImportCosts } from '../utils/calculator.js';
import { getSettings } from '../utils/settings.js';

const LISTING_WIDGET_ID = 'cic-listing-widget';

const fmt = (n) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

// ---------------------------------------------------------------------------
// Car detail page
// ---------------------------------------------------------------------------

export function injectListingWidget(carData, costs) {
  if (document.getElementById(LISTING_WIDGET_ID)) return;

  const widget = document.createElement('div');
  widget.id = LISTING_WIDGET_ID;

  widget.innerHTML = `
    <div class="cic-header">
      <span class="cic-flag">&#x1F1F3;&#x1F1F1;</span>
      <span class="cic-title">Importkosten naar Nederland</span>
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
    <p class="cic-note">${costs.bpm > 0 ? '* BPM berekend op basis van CO\u2082 en brandstof.' : '* EV: geen BPM.'}</p>
  `;

  const anchor =
    document.querySelector('[data-testid="price-section"]') ??
    document.querySelector('.cldt-price')?.closest('section') ??
    document.querySelector('aside');

  anchor?.insertAdjacentElement('afterend', widget);
}

// ---------------------------------------------------------------------------
// Search results page
// ---------------------------------------------------------------------------

export async function injectSearchWidgets(cards, settings) {
  for (const { el, price, year, fuelType, co2 } of cards) {
    if (el.querySelector('.cic-badge')) continue; // already injected

    const costs = calculateImportCosts({ price, year, fuelType, co2 }, settings);

    const badge = document.createElement('div');
    badge.className = 'cic-badge';
    badge.innerHTML = `
      <span class="cic-badge-label">&#x1F1F3;&#x1F1F1; Totaal</span>
      <span class="cic-badge-value">${fmt(costs.total)}</span>
    `;

    // Append the badge below the price element on the card
    const priceEl = el.querySelector('[data-testid="price"], .cldt-price, [class*="price"]');
    priceEl?.insertAdjacentElement('afterend', badge);
  }
}
