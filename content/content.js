/**
 * Content Script — AutoScout24 (gebundeld, geen ES module imports)
 *
 * Alles in één bestand omdat Chrome content scripts geen
 * ES module imports ondersteunen.
 */

(async function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Settings (chrome.storage.sync)
  // -------------------------------------------------------------------------

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ originIsOutsideEU: true }, resolve);
    });
  }

  // -------------------------------------------------------------------------
  // BPM berekening (CO2-staffel 2025)
  // -------------------------------------------------------------------------

  function co2ToBPM(co2, fuelType) {
    let bpm = 0;
    if (co2 > 150)      { bpm += (co2 - 150) * 18; bpm += 50 * 7; bpm += 18 * 4; }
    else if (co2 > 100) { bpm += (co2 - 100) * 7;  bpm += 18 * 4; }
    else if (co2 > 82)  { bpm += (co2 - 82) * 4; }
    if (fuelType === 'diesel') bpm = Math.round(bpm * 1.15);
    return bpm;
  }

  function estimateCO2(fuelType) {
    return { petrol: 145, diesel: 155, hybrid: 110, electric: 0 }[fuelType] ?? 145;
  }

  function getDepreciation(age) {
    const t = [0, 0.09, 0.17, 0.25, 0.33, 0.41, 0.50, 0.57, 0.63, 0.68, 0.73, 0.77, 0.81, 0.84, 0.87, 0.90];
    return t[Math.min(age, t.length - 1)];
  }

  function calculateImportCosts({ price, year, fuelType, co2 }, settings = {}) {
    const outsideEU = settings.originIsOutsideEU ?? true;
    const importDutyRate = outsideEU ? 6.5 : 0;
    const importDuty = Math.round(price * importDutyRate / 100);
    const vat = Math.round((price + importDuty) * 0.21);

    let bpm = 0;
    if (fuelType !== 'electric') {
      const age = Math.max(0, new Date().getFullYear() - (year ?? new Date().getFullYear() - 3));
      const co2Val = co2 ?? estimateCO2(fuelType);
      bpm = Math.round(co2ToBPM(co2Val, fuelType) * (1 - getDepreciation(age)));
    }

    return { price, importDuty, importDutyRate, vat, bpm, total: Math.round(price + importDuty + vat + bpm) };
  }

  // -------------------------------------------------------------------------
  // Scraper helpers
  // -------------------------------------------------------------------------

  function parseNumber(raw) {
    if (!raw) return null;
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : null;
  }

  function parseYear(raw) {
    if (!raw) return null;
    const m = raw.match(/(19|20)\d{2}/);
    return m ? parseInt(m[0], 10) : null;
  }

  function normalizeFuelType(raw) {
    const l = (raw ?? '').toLowerCase();
    if (l.includes('elektr') || l.includes('electric') || l.includes('bev')) return 'electric';
    if (l.includes('diesel')) return 'diesel';
    if (l.includes('hybrid') || l.includes('phev')) return 'hybrid';
    return 'petrol';
  }

  function scrapeDetailValue(labels) {
    for (const dt of document.querySelectorAll('dt')) {
      const text = dt.textContent.trim().toLowerCase();
      if (labels.some((l) => text.includes(l.toLowerCase()))) {
        return dt.nextElementSibling?.textContent?.trim() ?? null;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Scraper: advertentiepagina
  // -------------------------------------------------------------------------

  function scrapeListingPage() {
    const priceEl =
      document.querySelector('[data-testid="price-section"] .cldt-price') ??
      document.querySelector('[data-testid="price"]') ??
      document.querySelector('.cldt-price');

    const price = parseNumber(priceEl?.textContent);
    if (!price) return null;

    const year = parseYear(
      scrapeDetailValue(['Erstzulassung', 'First registration', 'Eerste registratie', '1\u00e8re mise en circulation'])
    );
    const fuelRaw = scrapeDetailValue(['Kraftstoff', 'Fuel type', 'Brandstof', 'Carburant']) ?? '';
    const co2Raw  = scrapeDetailValue(['CO2-Emissionen', 'CO2 emissions', 'CO2-uitstoot', '\u00c9missions CO2']);
    const mileageRaw = scrapeDetailValue(['Kilometerstand', 'Mileage', 'Kilom\u00e9trage']);

    return {
      price,
      year,
      fuelType: normalizeFuelType(fuelRaw),
      co2: co2Raw ? parseNumber(co2Raw) : null,
      mileage: mileageRaw ? parseNumber(mileageRaw) : null,
    };
  }

  // -------------------------------------------------------------------------
  // Widget: advertentiepagina
  // -------------------------------------------------------------------------

  function injectListingWidget(carData, costs) {
    if (document.getElementById('cic-listing-widget')) return;

    const fmt = (n) =>
      new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

    const widget = document.createElement('div');
    widget.id = 'cic-listing-widget';
    widget.innerHTML = `
      <div class="cic-header">
        <span class="cic-flag">🇳🇱</span>
        <span class="cic-title">Importkosten naar NL</span>
      </div>
      <table class="cic-table">
        <tr><td>Vraagprijs</td>           <td class="cic-val">${fmt(costs.price)}</td></tr>
        ${costs.importDuty > 0 ? `<tr><td>Invoerrechten (${costs.importDutyRate}%)</td><td class="cic-val">${fmt(costs.importDuty)}</td></tr>` : ''}
        <tr><td>BTW (21%)</td>            <td class="cic-val">${fmt(costs.vat)}</td></tr>
        ${costs.bpm > 0   ? `<tr><td>BPM</td><td class="cic-val">${fmt(costs.bpm)}</td></tr>` : ''}
        <tr class="cic-total-row">
          <td>Totaal</td>
          <td class="cic-val">${fmt(costs.total)}</td>
        </tr>
      </table>
      <p class="cic-note">${carData.co2 ? `BPM berekend op ${carData.co2} g/km CO₂.` : 'BPM is een schatting (CO₂ niet gevonden).'}</p>
    `;

    // Ankerplek: naast/onder de prijs
    const anchor =
      document.querySelector('[data-testid="price-section"]') ??
      document.querySelector('.cldt-price')?.closest('section') ??
      document.querySelector('aside');

    if (anchor) {
      anchor.insertAdjacentElement('afterend', widget);
      console.log('[CarImport] Widget ge\u00efnjecteerd.');
    } else {
      console.warn('[CarImport] Geen ankerplek gevonden.');
    }
  }

  // -------------------------------------------------------------------------
  // Scraper: zoekresultatenpagina
  // -------------------------------------------------------------------------

  function scrapeSearchPage() {
    const cards = document.querySelectorAll('article[data-item-name], [data-testid="listing-item"]');
    if (!cards.length) return null;

    const results = [];
    for (const card of cards) {
      const priceEl = card.querySelector('[data-testid="price"], .cldt-price, [class*="price"]');
      const price = parseNumber(priceEl?.textContent);
      if (!price) continue;

      const specsText = card.querySelector('[data-testid="listing-specs"], [class*="spec"]')?.textContent ?? '';
      const yearMatch = specsText.match(/(19|20)\d{2}/);
      const year = yearMatch ? parseInt(yearMatch[0], 10) : null;

      const fuelRaw = card.querySelector('[data-testid="fuel-type"], [class*="fuel"]')?.textContent ?? '';

      results.push({ el: card, price, year, fuelType: normalizeFuelType(fuelRaw), co2: null });
    }
    return results.length ? results : null;
  }

  // -------------------------------------------------------------------------
  // Widget: zoekresultaten badges
  // -------------------------------------------------------------------------

  function injectSearchWidgets(cards, settings) {
    const fmt = (n) =>
      new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

    for (const { el, price, year, fuelType, co2 } of cards) {
      if (el.querySelector('.cic-badge')) continue;

      const costs = calculateImportCosts({ price, year, fuelType, co2 }, settings);
      const badge = document.createElement('div');
      badge.className = 'cic-badge';
      badge.innerHTML = `
        <span class="cic-badge-label">🇳🇱 Totaal NL</span>
        <span class="cic-badge-value">${fmt(costs.total)}</span>
      `;

      const priceEl = el.querySelector('[data-testid="price"], .cldt-price, [class*="price"]');
      priceEl?.insertAdjacentElement('afterend', badge);
    }
    console.log(`[CarImport] ${cards.length} badges ge\u00efnjecteerd.`);
  }

  // -------------------------------------------------------------------------
  // Wacht op async DOM (AS24 is een React SPA)
  // -------------------------------------------------------------------------

  async function waitForData(scrapeFn, retries = 12, delayMs = 400) {
    for (let i = 0; i < retries; i++) {
      const result = scrapeFn();
      if (result && (result.price || result.length)) return result;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    console.warn('[CarImport] Data niet gevonden na', retries, 'pogingen.');
    return null;
  }

  // -------------------------------------------------------------------------
  // Opstarten
  // -------------------------------------------------------------------------

  console.log('[CarImport] Content script gestart op', window.location.pathname);

  const settings = await getSettings();
  const path = window.location.pathname;
  const isListing = /\/(angebote|annonces|aanbod|annunci)\//.test(path);

  if (isListing) {
    const carData = await waitForData(scrapeListingPage);
    if (carData?.price) {
      const costs = calculateImportCosts(carData, settings);
      injectListingWidget(carData, costs);
    }
  } else {
    const cards = await waitForData(scrapeSearchPage);
    if (cards?.length) {
      injectSearchWidgets(cards, settings);
    }
  }

})();
