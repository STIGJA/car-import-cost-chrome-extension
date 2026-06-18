/**
 * Widget injector
 *
 * Maakt een klein HTML-blokje aan en injecteert het direct
 * naast het prijsblok op de AutoScout24 advertentiepagina.
 */

const WIDGET_ID = 'car-import-cost-widget';

/**
 * Injecteer het widget op de pagina.
 * @param {import('./scrapers/autoscout24.js').CarData} carData
 * @param {object} costs - Output van calculateImportCosts()
 */
export function injectWidget(carData, costs) {
  // Voorkom dubbele injectie
  if (document.getElementById(WIDGET_ID)) return;

  const widget = buildWidget(carData, costs);

  // Zoek een geschikte ankerplek naast de prijs
  const anchor =
    document.querySelector('[data-testid="price-section"]') ??
    document.querySelector('.cldt-price')?.closest('section') ??
    document.querySelector('aside') ??
    document.body; // laatste fallback

  anchor.insertAdjacentElement('afterend', widget);
}

/**
 * Werk het widget bij met nieuwe berekeningsresultaten.
 */
export function updateWidget(costs) {
  const widget = document.getElementById(WIDGET_ID);
  if (!widget) return;
  widget.replaceWith(buildWidget(null, costs));
}

// ---------------------------------------------------------------------------

function buildWidget(carData, costs) {
  const fmt = (n) =>
    new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

  const wrapper = document.createElement('div');
  wrapper.id = WIDGET_ID;

  const label = carData ? `${carData.make} ${carData.model}` : 'Import kosten';

  wrapper.innerHTML = `
    <div class="cic-header">
      <span class="cic-icon">🇳🇱</span>
      <span class="cic-title">Importkosten naar NL</span>
    </div>
    <table class="cic-table">
      <tr>
        <td>Vraagprijs</td>
        <td class="cic-value">${fmt(costs.price)}</td>
      </tr>
      <tr>
        <td>Invoerrechten (6,5%)</td>
        <td class="cic-value">${fmt(costs.importDuty)}</td>
      </tr>
      <tr>
        <td>BTW (21%)</td>
        <td class="cic-value">${fmt(costs.btw)}</td>
      </tr>
      <tr>
        <td>BPM (schatting)</td>
        <td class="cic-value">${fmt(costs.bpm)}</td>
      </tr>
      <tr class="cic-total">
        <td>Totaal in NL</td>
        <td class="cic-value">${fmt(costs.total)}</td>
      </tr>
    </table>
    <p class="cic-disclaimer">* BPM is een schatting. Werkelijke BPM is CO₂-gebaseerd.</p>
  `;

  return wrapper;
}
