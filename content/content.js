/**
 * Content Script — AutoScout24 (gebundeld, geen ES module imports)
 * AS24 gebruikt CSS Modules met willekeurige suffixen (bijv. PriceInfo_price__XU0aF)
 * — daarom selecteren we alleen op data-testid of structurele selectors.
 */

(async function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Settings
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
  // Helpers
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

  /**
   * Zoek een waarde in de detail-lijst (dt/dd).
   * AS24 gebruikt ook gewone dl>dt>dd structuur — die werkt wél.
   */
  function scrapeDetailValue(labels) {
    for (const dt of document.querySelectorAll('dt')) {
      const text = dt.textContent.trim().toLowerCase();
      if (labels.some((l) => text.includes(l.toLowerCase()))) {
        return dt.nextElementSibling?.textContent?.trim() ?? null;
      }
    }
    return null;
  }

  /**
   * Prijs ophalen uit de price-section.
   * AS24 CSS Modules: class-namen zijn onbetrouwbaar, maar de structuur is:
   *   [data-testid="price-section"] > div > div > div > span  (bevat "€ 16.990")
   * We selecteren de eerste span onder price-section die een euro-teken bevat.
   */
  function scrapePrice() {
    const section = document.querySelector('[data-testid="price-section"]');
    if (!section) return null;

    // Loop alle spans — pak de eerste met een €-bedrag
    for (const span of section.querySelectorAll('span')) {
      const text = span.textContent.trim();
      if (/[€$]?\s*[\d.,]+/.test(text) && text.length < 20) {
        const val = parseNumber(text);
        if (val && val > 500) return val; // sanity check: geen kleine getallen
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Scraper: advertentiepagina
  // -------------------------------------------------------------------------

  function scrapeListingPage() {
    const price = scrapePrice();
    console.log('[CarImport] Prijs gevonden:', price);
    if (!price) return null;

    const year = parseYear(
      scrapeDetailValue(['Erstzulassung', 'First registration', 'Eerste registratie', '1\u00e8re mise en circulation'])
    );
    const fuelRaw = scrapeDetailValue(['Kraftstoff', 'Fuel type', 'Brandstof', 'Carburant']) ?? '';
    const co2Raw  = scrapeDetailValue(['CO2-Emissionen', 'CO2 emissions', 'CO2-uitstoot', '\u00c9missions CO2']);
    const mileageRaw = scrapeDetailValue(['Kilometerstand', 'Mileage', 'Kilom\u00e9trage']);

    console.log('[CarImport] Scraped:', { year, fuelRaw, co2Raw, mileageRaw });

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
    widget.style.cssText = `
      background: #fff3e0; border: 2px solid #ff9800; border-radius: 8px;
      padding: 12px 16px; margin: 12px 0; font-family: sans-serif; font-size: 14px;
    `;
    widget.innerHTML = `
      <div style="font-weight:700; margin-bottom:8px;">🇳🇱 Importkosten naar Nederland</div>
      <table style="width:100%; border-collapse:collapse;">
        <tr><td>Vraagprijs</td>           <td style="text-align:right">${fmt(costs.price)}</td></tr>
        ${costs.importDuty > 0 ? `<tr><td>Invoerrechten (${costs.importDutyRate}%)</td><td style="text-align:right">${fmt(costs.importDuty)}</td></tr>` : ''}
        <tr><td>BTW (21%)</td>            <td style="text-align:right">${fmt(costs.vat)}</td></tr>
        ${costs.bpm > 0 ? `<tr><td>BPM</td><td style="text-align:right">${fmt(costs.bpm)}</td></tr>` : ''}
        <tr style="font-weight:700; border-top:1px solid #ff9800;">
          <td>Totaal</td>
          <td style="text-align:right">${fmt(costs.total)}</td>
        </tr>
      </table>
      <p style="margin:6px 0 0; font-size:12px; color:#666;">
        ${carData.co2 ? `BPM berekend op ${carData.co2} g/km CO\u2082.` : 'BPM is een schatting (CO\u2082 niet gevonden).'}
      </p>
    `;

    const anchor = document.querySelector('[data-testid="price-section"]');
    if (anchor) {
      anchor.insertAdjacentElement('afterend', widget);
      console.log('[CarImport] Widget ge\u00efnjecteerd.');
    } else {
      // Fallback: voeg toe aan body als eerste zichtbare element
      document.body.prepend(widget);
      console.warn('[CarImport] Fallback: widget bovenaan body gezet.');
    }
  }

  // -------------------------------------------------------------------------
  // Scraper: zoekresultatenpagina
  // -------------------------------------------------------------------------

  function scrapeSearchPage() {
    // AS24 search: artikelen hebben data-testid="listing-item" of zijn <article>
    const cards = document.querySelectorAll('[data-testid="listing-item"], article[class]');
    if (!cards.length) {
      console.log('[CarImport] Geen kaarten gevonden op zoekpagina.');
      return null;
    }

    const results = [];
    for (const card of cards) {
      // Prijs: zoek span met euro-bedrag in de kaart
      let price = null;
      for (const span of card.querySelectorAll('span')) {
        const text = span.textContent.trim();
        if (/€/.test(text) || /[\d.]{4,}/.test(text)) {
          const val = parseNumber(text);
          if (val && val > 500) { price = val; break; }
        }
      }
      if (!price) continue;

      const allText = card.textContent;
      const yearMatch = allText.match(/(19|20)\d{2}/);
      const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
      const fuelType = normalizeFuelType(allText);

      results.push({ el: card, price, year, fuelType, co2: null });
    }
    console.log('[CarImport] Zoekpagina kaarten:', results.length);
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
      badge.style.cssText = `
        background:#ff9800; color:#fff; border-radius:4px;
        padding:2px 8px; font-size:12px; font-weight:700;
        display:inline-block; margin-top:4px;
      `;
      badge.textContent = `🇳🇱 ${fmt(costs.total)}`;

      // Voeg badge in na het eerste prijselement in de kaart
      for (const span of el.querySelectorAll('span')) {
        const val = parseNumber(span.textContent);
        if (val && val > 500) {
          span.insertAdjacentElement('afterend', badge);
          break;
        }
      }
    }
    console.log(`[CarImport] ${cards.length} badges ge\u00efnjecteerd.`);
  }

  // -------------------------------------------------------------------------
  // Wacht op async DOM (AS24 is een React SPA)
  // -------------------------------------------------------------------------

  async function waitForData(scrapeFn, retries = 15, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
      const result = scrapeFn();
      if (result && (result.price || (Array.isArray(result) && result.length))) return result;
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
