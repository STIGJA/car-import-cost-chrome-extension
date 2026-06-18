/**
 * Widget injector
 *
 * Stijlstrategie:
 *   1. Probeert de site-native stijlvariabelen te lenen (CSS custom properties op :root)
 *   2. Valt terug op eigen dark-mode stijlen als de site geen bruikbare vars heeft
 *
 * Door de widget NIET in Shadow DOM te plaatsen kunnen we bewust
 * site-CSS overnemen. Eigen classes hebben het `cic-` prefix om conflicten te voorkomen.
 */

const WIDGET_ID = 'car-import-cost-widget';

export function injectWidget({ carData, costs, siteName, settings }) {
  if (document.getElementById(WIDGET_ID)) return;

  const widget = buildWidget({ carData, costs, siteName, settings });

  // Ankerplek zoeken — van specifiek naar algemeen
  const anchor =
    document.querySelector('[data-testid="price-section"]') ??
    document.querySelector('.cldt-price')?.closest('section') ??
    document.querySelector('[data-testid="prime-price"]')?.closest('div') ??
    document.querySelector('aside') ??
    document.body;

  anchor.insertAdjacentElement('afterend', widget);
}

function buildWidget({ carData, costs, siteName, settings }) {
  const fmt = (n) =>
    new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(n);

  const countryFlag = { NL: '🇳🇱', BE: '🇧🇪', DE: '🇩🇪' }[settings.destinationCountry] ?? '🏁';
  const countryName = { NL: 'Nederland', BE: 'België', DE: 'Duitsland' }[settings.destinationCountry] ?? settings.destinationCountry;

  const wrapper = document.createElement('div');
  wrapper.id = WIDGET_ID;

  // Detecteer of de site CSS custom properties aanbiedt die we kunnen lenen
  const rootStyles = getComputedStyle(document.documentElement);
  const hasSiteVars = rootStyles.getPropertyValue('--color-primary').trim() !== '';

  // Voeg een data-attribuut toe zodat CSS weet of we site-vars kunnen gebruiken
  wrapper.dataset.siteVars = hasSiteVars ? 'true' : 'false';
  wrapper.dataset.site = siteName.toLowerCase().replace(/[^a-z]/g, '-');

  wrapper.innerHTML = `
    <div class="cic-header">
      <span class="cic-icon">${countryFlag}</span>
      <span class="cic-title">Importkosten naar ${countryName}</span>
      <span class="cic-site">${siteName}</span>
    </div>
    <table class="cic-table">
      <tr>
        <td>Vraagprijs</td>
        <td class="cic-value">${fmt(costs.price)}</td>
      </tr>
      ${
        costs.importDuty > 0
          ? `<tr>
        <td>Invoerrechten (${costs.importDutyRate}%)</td>
        <td class="cic-value">${fmt(costs.importDuty)}</td>
      </tr>`
          : ''
      }
      <tr>
        <td>${costs.vatLabel} (${costs.vatRate}%)</td>
        <td class="cic-value">${fmt(costs.vat)}</td>
      </tr>
      ${
        costs.bpm > 0
          ? `<tr>
        <td>BPM (schatting)</td>
        <td class="cic-value">${fmt(costs.bpm)}</td>
      </tr>`
          : ''
      }
      ${
        costs.roadsideTax != null
          ? `<tr>
        <td>${costs.roadsideTaxLabel}</td>
        <td class="cic-value">${fmt(costs.roadsideTax)}</td>
      </tr>`
          : ''
      }
      <tr class="cic-total">
        <td>Totaal in ${countryName}</td>
        <td class="cic-value">${fmt(costs.total)}</td>
      </tr>
    </table>
    <p class="cic-disclaimer">${costs.disclaimer ?? '* Schatting — raadpleeg een importspecialist voor exacte bedragen.'}</p>
  `;

  return wrapper;
}
