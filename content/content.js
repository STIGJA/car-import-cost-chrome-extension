/**
 * Content Script — AutoScout24
 *
 * CO2-strategie:
 *   1. Probeer CO2 uit de DOM te scrapen
 *   2. Indien gevonden: gebruik die waarde; vergelijk met lookup en log een
 *      console.warn als ze >20 g/km / >15% afwijken
 *   3. Indien niet gevonden: gebruik lookup (euronorm + vermogen, of bouwjaar)
 *      en toon een ⚠️ tooltip-icoon achter de BPM-regel
 *
 * BTW: alleen bij auto's jonger dan 6 maanden (nieuwprijs-regel)
 */

(async function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Inlined: co2-lookup.js
  // (Chrome content scripts ondersteunen geen ES module imports)
  // -------------------------------------------------------------------------

  const EURO_POWER_TABLE = {
    petrol: {
      'euro6d':      [118, 130, 142, 158, 175, 230],
      'euro6d-temp': [122, 135, 148, 165, 182, 235],
      'euro6c':      [126, 140, 154, 172, 190, 238],
      'euro6b':      [130, 146, 162, 180, 200, 242],
      'euro6':       [130, 146, 162, 180, 200, 242],
      'euro5':       [138, 154, 172, 192, 215, 258],
      'euro4':       [148, 166, 186, 208, 232, 278],
      'euro3':       [160, 180, 202, 226, 252, 300],
    },
    diesel: {
      'euro6d':      [112, 122, 132, 122, 148, 158],
      'euro6d-temp': [116, 126, 138, 128, 155, 165],
      'euro6c':      [120, 132, 145, 135, 162, 172],
      'euro6b':      [125, 138, 152, 142, 170, 182],
      'euro6':       [125, 138, 152, 142, 170, 182],
      'euro5':       [132, 146, 140, 125, 148, 178],
      'euro4':       [140, 156, 155, 138, 162, 195],
      'euro3':       [152, 170, 170, 155, 180, 215],
    },
    hybrid: {
      'euro6d':      [ 88,  98, 108, 118, 132, 155],
      'euro6d-temp': [ 92, 102, 114, 125, 140, 165],
      'euro6c':      [ 96, 108, 120, 132, 148, 175],
      'euro6b':      [100, 112, 126, 140, 158, 188],
      'euro6':       [100, 112, 126, 140, 158, 188],
      'euro5':       [108, 122, 138, 154, 172, 205],
      'euro4':       [118, 134, 152, 170, 190, 228],
      'euro3':       [128, 146, 166, 186, 208, 250],
    },
  };

  const YEAR_FALLBACK = {
    petrol:  {2024:138,2023:142,2022:146,2021:150,2020:152,2019:155,2018:158,2017:162,2016:166,2015:170,2014:175,2013:180,2012:185,2011:190,2010:196,2009:202,2008:210,2007:218,2006:225,2005:232},
    diesel:  {2024:128,2023:132,2022:136,2021:140,2020:143,2019:147,2018:151,2017:155,2016:159,2015:162,2014:167,2013:171,2012:175,2011:179,2010:184,2009:190,2008:198,2007:206,2006:214,2005:222},
    hybrid:  {2024: 95,2023: 98,2022:102,2021:106,2020:108,2019:112,2018:116,2017:120,2016:125,2015:130,2014:135,2013:140,2012:145,2011:150,2010:156},
    electric:{},
  };

  function powerBracket(kw) {
    if (!kw || kw < 75) return 0;
    if (kw < 100)       return 1;
    if (kw < 130)       return 2;
    if (kw < 160)       return 3;
    if (kw < 200)       return 4;
    return 5;
  }

  function normalizeEuroNorm(raw) {
    if (!raw) return null;
    const s = raw.toLowerCase().replace(/\s/g, '');
    if (s.includes('6d-temp') || s.includes('6dtemp')) return 'euro6d-temp';
    if (s.includes('6d'))   return 'euro6d';
    if (s.includes('6c'))   return 'euro6c';
    if (s.includes('6b'))   return 'euro6b';
    if (s.includes('6'))    return 'euro6';
    if (s.includes('5'))    return 'euro5';
    if (s.includes('4'))    return 'euro4';
    if (s.includes('3'))    return 'euro3';
    return null;
  }

  function estimateCO2FromSpecs({ fuelType, euroNorm, powerKw, year }) {
    if (fuelType === 'electric') return { co2: 0, method: 'elektrisch', confidence: 'exact' };
    const fuel = fuelType in EURO_POWER_TABLE ? fuelType : 'petrol';
    const normEuro = normalizeEuroNorm(euroNorm);
    if (normEuro && EURO_POWER_TABLE[fuel][normEuro] && powerKw) {
      return { co2: EURO_POWER_TABLE[fuel][normEuro][powerBracket(powerKw)], method: `${normEuro} + ${powerKw}\u00a0kW`, confidence: 'medium' };
    }
    if (normEuro && EURO_POWER_TABLE[fuel][normEuro]) {
      return { co2: EURO_POWER_TABLE[fuel][normEuro][2], method: normEuro, confidence: 'low' };
    }
    if (year && YEAR_FALLBACK[fuel]) {
      const y = Math.max(2005, Math.min(2024, year));
      const co2 = YEAR_FALLBACK[fuel][y];
      if (co2) return { co2, method: `bouwjaar ${y}`, confidence: 'low' };
    }
    const fallback = { petrol: 155, diesel: 145, hybrid: 120, electric: 0 };
    return { co2: fallback[fuel] ?? 155, method: 'standaard', confidence: 'very-low' };
  }

  function checkCO2DeviationWarn(scraped, estimated, label) {
    const diff = Math.abs(scraped - estimated);
    const pct  = Math.round((diff / scraped) * 100);
    if (diff >= 20 || pct >= 15) {
      console.warn(
        `[CarImport] CO\u2082-afwijking${label ? ' (' + label + ')' : ''}: ` +
        `pagina ${scraped}\u00a0g/km vs schatting ${estimated}\u00a0g/km ` +
        `(verschil ${scraped > estimated ? '+' : ''}${scraped - estimated}\u00a0g/km, ${pct}%). ` +
        `Controleer of de advertentie WLTP-waarden gebruikt.`
      );
    }
  }

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

  function getDepreciation(age) {
    const t = [0,0.09,0.17,0.25,0.33,0.41,0.50,0.57,0.63,0.68,0.73,0.77,0.81,0.84,0.87,0.90];
    return t[Math.min(age, t.length - 1)];
  }

  /**
   * BTW (21%) is alleen van toepassing bij auto's jonger dan 6 maanden
   * (marge-regeling: gebruikte auto's worden zonder BTW verhandeld)
   */
  function isNewCar(firstRegDate) {
    if (!firstRegDate) return false;
    // firstRegDate als Date-object of ISO-string of "MM/YYYY"
    let d;
    if (firstRegDate instanceof Date) {
      d = firstRegDate;
    } else {
      const parts = String(firstRegDate).match(/(\d{1,2})[\/-](\d{4})/);
      if (parts) d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, 1);
      else d = new Date(firstRegDate);
    }
    if (isNaN(d)) return false;
    const ageMonths = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    return ageMonths < 6;
  }

  function calculateImportCosts({ price, firstRegDate, fuelType, co2 }, settings = {}) {
    const outsideEU      = settings.originIsOutsideEU ?? true;
    const importDutyRate = outsideEU ? 6.5 : 0;
    const importDuty     = Math.round(price * importDutyRate / 100);

    // BTW alleen bij nieuwe auto (<6 maanden)
    const newCar = isNewCar(firstRegDate);
    const vat    = newCar ? Math.round((price + importDuty) * 0.21) : 0;

    let bpm = 0;
    if (fuelType !== 'electric') {
      // Leeftijd voor depreciatie: gebruik huidig jaar als geen datum bekend
      let ageYears = 3; // veilige standaard
      if (firstRegDate) {
        let d;
        const parts = String(firstRegDate).match(/(\d{1,2})[\/-](\d{4})/);
        if (parts) d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, 1);
        else d = new Date(firstRegDate);
        if (!isNaN(d)) ageYears = Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25)));
      }
      bpm = Math.round(co2ToBPM(co2, fuelType) * (1 - getDepreciation(ageYears)));
    }

    return { price, importDuty, importDutyRate, vat, newCar, bpm, total: Math.round(price + importDuty + vat + bpm) };
  }

  // -------------------------------------------------------------------------
  // DOM helpers
  // -------------------------------------------------------------------------

  function parseNumber(raw) {
    if (!raw) return null;
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : null;
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

  function scrapePrice() {
    const section = document.querySelector('[data-testid="price-section"]');
    if (!section) return null;
    for (const span of section.querySelectorAll('span')) {
      const text = span.textContent.trim();
      if (text.length < 20) {
        const val = parseNumber(text);
        if (val && val > 500) return val;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Scraper: advertentiepagina
  // -------------------------------------------------------------------------

  function scrapeListingPage() {
    const price = scrapePrice();
    if (!price) return null;

    // Eerste registratie als ruwe string (bijv. "03/2021" of "Mar 2021")
    const firstRegRaw = scrapeDetailValue(['Erstzulassung','First registration','Eerste registratie','1\u00e8re mise en circulation']);
    const fuelRaw     = scrapeDetailValue(['Kraftstoff','Fuel type','Brandstof','Carburant']) ?? '';
    const co2Raw      = scrapeDetailValue(['CO2-Emissionen','CO2 emissions','CO2-uitstoot','\u00c9missions CO2','CO\u2082']);
    const powerRaw    = scrapeDetailValue(['Leistung','Power','Vermogen','Puissance']);
    const euroRaw     = scrapeDetailValue(['Schadstoffklasse','Emission class','Emissieklasse','Classe d\u2019\u00e9mission','Euro']);
    const mileageRaw  = scrapeDetailValue(['Kilometerstand','Mileage','Kilom\u00e9trage']);

    // Vermogen: "135 kW (184 PS)" → 135
    let powerKw = null;
    if (powerRaw) {
      const kwM = powerRaw.match(/(\d+)\s*kW/);
      const psM = powerRaw.match(/(\d+)\s*(PS|pk|hp|cv)/i);
      if (kwM)      powerKw = parseInt(kwM[1], 10);
      else if (psM) powerKw = Math.round(parseInt(psM[1], 10) * 0.7355);
    }

    const fuelType   = normalizeFuelType(fuelRaw);
    const co2Scraped = co2Raw ? parseNumber(co2Raw) : null;
    const estimation = estimateCO2FromSpecs({ fuelType, euroNorm: euroRaw, powerKw, year: firstRegRaw ? parseInt(firstRegRaw.match(/\d{4}/)?.[0]) : null });

    let co2Final, co2IsEstimated = false;
    if (co2Scraped && co2Scraped > 0) {
      co2Final = co2Scraped;
      // Warning alleen in console
      checkCO2DeviationWarn(co2Scraped, estimation.co2, `${price}\u20ac`);
    } else {
      co2Final       = estimation.co2;
      co2IsEstimated = true;
    }

    console.log('[CarImport]', {
      price, firstRegRaw, fuelType,
      co2Final, co2IsEstimated,
      estimation: `${estimation.co2} g/km via ${estimation.method} (${estimation.confidence})`,
      powerKw, euroRaw,
    });

    return {
      price,
      firstRegDate: firstRegRaw,
      fuelType,
      co2: co2Final,
      co2IsEstimated,
      co2EstimationMethod: co2IsEstimated ? estimation.method : null,
      co2Confidence: co2IsEstimated ? estimation.confidence : 'scraped',
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

    // BPM-label: toon CO2-basis + eventueel ⚠️ icoon
    const co2Label = carData.co2IsEstimated
      ? `BPM <span style="color:#888;font-weight:400;font-size:12px">o.b.v. ${carData.co2}\u00a0g/km CO\u2082` +
        ` <span title="CO\u2082 niet gevonden op pagina\u00a0\u2014 geschat via ${carData.co2EstimationMethod}" ` +
        `style="cursor:help;color:#e65100;">\u26a0\ufe0f</span></span>`
      : `BPM <span style="color:#888;font-weight:400;font-size:12px">o.b.v. ${carData.co2}\u00a0g/km CO\u2082</span>`;

    const vatRow = costs.vat > 0
      ? `<tr><td>BTW (21%)</td><td style="text-align:right">${fmt(costs.vat)}</td></tr>`
      : '';

    const bpmRow = costs.bpm > 0
      ? `<tr><td>${co2Label}</td><td style="text-align:right">${fmt(costs.bpm)}</td></tr>`
      : '';

    const widget = document.createElement('div');
    widget.id = 'cic-listing-widget';
    widget.style.cssText = `
      background:#fff3e0;border:2px solid #ff9800;border-radius:8px;
      padding:12px 16px;margin:12px 0;font-family:sans-serif;font-size:14px;
    `;
    widget.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px;">\ud83c\uddf3\ud83c\uddf1 Importkosten naar Nederland</div>
      <table style="width:100%;border-collapse:collapse;line-height:1.7;">
        <tr><td>Vraagprijs</td><td style="text-align:right">${fmt(costs.price)}</td></tr>
        ${costs.importDuty > 0 ? `<tr><td>Invoerrechten (${costs.importDutyRate}%)</td><td style="text-align:right">${fmt(costs.importDuty)}</td></tr>` : ''}
        ${vatRow}
        ${bpmRow}
        <tr style="font-weight:700;border-top:1px solid #ff9800;">
          <td>Totaal</td><td style="text-align:right">${fmt(costs.total)}</td>
        </tr>
      </table>
      ${!costs.newCar ? '<p style="margin:6px 0 0;font-size:11px;color:#888;">BTW niet inbegrepen (gebruikte auto, marge-regeling).</p>' : ''}
    `;

    const anchor = document.querySelector('[data-testid="price-section"]');
    if (anchor) anchor.insertAdjacentElement('afterend', widget);
    else document.body.prepend(widget);

    console.log('[CarImport] Widget ge\u00efnjecteerd. Nieuw:', costs.newCar, '| BTW:', fmt(costs.vat), '| BPM:', fmt(costs.bpm));
  }

  // -------------------------------------------------------------------------
  // Scraper + widget: zoekresultatenpagina
  // -------------------------------------------------------------------------

  function scrapeSearchPage() {
    const cards = document.querySelectorAll('[data-testid="listing-item"], article[class]');
    if (!cards.length) return null;

    const results = [];
    for (const card of cards) {
      let price = null;
      for (const span of card.querySelectorAll('span')) {
        const val = parseNumber(span.textContent.trim());
        if (val && val > 500 && /[\u20ac\d.]/.test(span.textContent)) { price = val; break; }
      }
      if (!price) continue;

      const allText   = card.textContent;
      const yearMatch = allText.match(/(19|20)\d{2}/);
      const year      = yearMatch ? parseInt(yearMatch[0], 10) : null;
      const fuelType  = normalizeFuelType(allText);
      const est       = estimateCO2FromSpecs({ fuelType, year });

      results.push({ el: card, price, firstRegDate: year ? `01/${year}` : null, fuelType, co2: est.co2 });
    }
    return results.length ? results : null;
  }

  function injectSearchWidgets(cards, settings) {
    const fmt = (n) =>
      new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

    for (const { el, price, firstRegDate, fuelType, co2 } of cards) {
      if (el.querySelector('.cic-badge')) continue;
      const costs = calculateImportCosts({ price, firstRegDate, fuelType, co2 }, settings);
      const badge = document.createElement('div');
      badge.className = 'cic-badge';
      badge.style.cssText = `background:#ff9800;color:#fff;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:700;display:inline-block;margin-top:4px;`;
      badge.textContent = `\ud83c\uddf3\ud83c\uddf1 ${fmt(costs.total)}`;
      for (const span of el.querySelectorAll('span')) {
        const val = parseNumber(span.textContent);
        if (val && val > 500) { span.insertAdjacentElement('afterend', badge); break; }
      }
    }
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
    if (cards?.length) injectSearchWidgets(cards, settings);
  }

})();
