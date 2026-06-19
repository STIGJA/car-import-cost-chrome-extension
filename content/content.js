/**
 * Content Script — AutoScout24
 *
 * CO2-strategie:
 *  1. Probeer CO2 uit de DOM te scrapen (dt/dd structuur)
 *  2. Als gevonden: gebruik die waarde, maar vergelijk met lookup-schatting
 *     en toon een warning als ze >20 g/km of >15% afwijken
 *  3. Als niet gevonden: gebruik lookup op basis van euronorm + vermogen + bouwjaar
 *     en toon duidelijk dat het een schatting is + de confidence
 */

(async function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Inline: co2-lookup.js (gebundeld, geen ES module imports)
  // -------------------------------------------------------------------------

  const EURO_POWER_TABLE = {
    petrol: {
      'euro6d':      [118, 130, 142, 158, 175, 210],
      'euro6d-temp': [122, 135, 148, 165, 182, 218],
      'euro6c':      [126, 140, 154, 172, 190, 228],
      'euro6b':      [130, 146, 162, 180, 200, 240],
      'euro6':       [130, 146, 162, 180, 200, 240],
      'euro5':       [138, 154, 172, 192, 215, 258],
      'euro4':       [148, 166, 186, 208, 232, 278],
      'euro3':       [160, 180, 202, 226, 252, 300],
    },
    diesel: {
      'euro6d':      [112, 122, 132, 145, 162, 190],
      'euro6d-temp': [116, 126, 138, 152, 170, 200],
      'euro6c':      [120, 132, 145, 160, 178, 210],
      'euro6b':      [125, 138, 152, 168, 188, 222],
      'euro6':       [125, 138, 152, 168, 188, 222],
      'euro5':       [132, 146, 162, 180, 200, 238],
      'euro4':       [140, 156, 174, 194, 216, 258],
      'euro3':       [152, 170, 190, 212, 236, 282],
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
    petrol:  { 2024:138,2023:142,2022:146,2021:150,2020:152,2019:155,2018:158,2017:162,2016:166,2015:170,2014:175,2013:180,2012:185,2011:190,2010:196,2009:202,2008:210,2007:218,2006:225,2005:232 },
    diesel:  { 2024:132,2023:136,2022:140,2021:144,2020:146,2019:150,2018:154,2017:158,2016:162,2015:165,2014:170,2013:174,2012:178,2011:183,2010:188,2009:194,2008:202,2007:210,2006:218,2005:226 },
    hybrid:  { 2024: 95,2023: 98,2022:102,2021:106,2020:108,2019:112,2018:116,2017:120,2016:125,2015:130,2014:135,2013:140,2012:145,2011:150,2010:156 },
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
    if (fuelType === 'electric') return { co2: 0, method: 'electric', confidence: 'exact' };
    const fuel = fuelType in EURO_POWER_TABLE ? fuelType : 'petrol';
    const normEuro = normalizeEuroNorm(euroNorm);

    if (normEuro && EURO_POWER_TABLE[fuel][normEuro] && powerKw) {
      const co2 = EURO_POWER_TABLE[fuel][normEuro][powerBracket(powerKw)];
      return { co2, method: `euronorm(${normEuro})+vermogen(${powerKw}kW)`, confidence: 'medium' };
    }
    if (normEuro && EURO_POWER_TABLE[fuel][normEuro]) {
      const co2 = EURO_POWER_TABLE[fuel][normEuro][2];
      return { co2, method: `euronorm(${normEuro})`, confidence: 'low' };
    }
    if (year && YEAR_FALLBACK[fuel]) {
      const yearKey = Math.max(2005, Math.min(2024, year));
      const co2 = YEAR_FALLBACK[fuel][yearKey];
      if (co2) return { co2, method: `bouwjaar(${yearKey})`, confidence: 'low' };
    }
    const hardFallback = { petrol: 155, diesel: 160, hybrid: 120, electric: 0 };
    return { co2: hardFallback[fuel] ?? 155, method: 'fallback', confidence: 'very-low' };
  }

  function checkCO2Deviation(scraped, estimated) {
    const diff = Math.abs(scraped - estimated);
    const pct  = Math.round((diff / scraped) * 100);
    const warn = diff >= 20 || pct >= 15;
    return {
      warn, diff, pct,
      message: warn
        ? `\u26a0\ufe0f Opgegeven CO\u2082 (${scraped}\u00a0g/km) wijkt ${diff}\u00a0g/km\u00a0(${pct}%) af van de schatting (${estimated}\u00a0g/km). Controleer of de waarde WLTP is.`
        : null,
    };
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

  function calculateImportCosts({ price, year, fuelType, co2 }, settings = {}) {
    const outsideEU     = settings.originIsOutsideEU ?? true;
    const importDutyRate = outsideEU ? 6.5 : 0;
    const importDuty    = Math.round(price * importDutyRate / 100);
    const vat           = Math.round((price + importDuty) * 0.21);
    let bpm = 0;
    if (fuelType !== 'electric') {
      const age = Math.max(0, new Date().getFullYear() - (year ?? new Date().getFullYear() - 3));
      bpm = Math.round(co2ToBPM(co2, fuelType) * (1 - getDepreciation(age)));
    }
    return { price, importDuty, importDutyRate, vat, bpm, total: Math.round(price + importDuty + vat + bpm) };
  }

  // -------------------------------------------------------------------------
  // DOM helpers
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

    const year    = parseYear(scrapeDetailValue(['Erstzulassung','First registration','Eerste registratie','1\u00e8re mise en circulation']));
    const fuelRaw = scrapeDetailValue(['Kraftstoff','Fuel type','Brandstof','Carburant']) ?? '';
    const co2Raw  = scrapeDetailValue(['CO2-Emissionen','CO2 emissions','CO2-uitstoot','\u00c9missions CO2','CO\u2082']);
    const mileageRaw = scrapeDetailValue(['Kilometerstand','Mileage','Kilom\u00e9trage']);

    // Extra velden voor lookup
    const powerRaw   = scrapeDetailValue(['Leistung','Power','Vermogen','Puissance']);
    const euroRaw    = scrapeDetailValue(['Schadstoffklasse','Emission class','Emissieklasse','Classe d\u2019\u00e9mission','Euro']);

    // Vermogen: AS24 toont bijv. "135 kW (184 PS)" — pak het kW-getal
    let powerKw = null;
    if (powerRaw) {
      const kwMatch = powerRaw.match(/(\d+)\s*kW/);
      const psMatch = powerRaw.match(/(\d+)\s*(PS|pk|hp|cv)/i);
      if (kwMatch)      powerKw = parseInt(kwMatch[1], 10);
      else if (psMatch) powerKw = Math.round(parseInt(psMatch[1], 10) * 0.7355);
    }

    const fuelType = normalizeFuelType(fuelRaw);
    const co2Scraped = co2Raw ? parseNumber(co2Raw) : null;

    // CO2 bepalen + eventuele warning
    let co2Final, co2Source, co2Warning = null;
    const estimation = estimateCO2FromSpecs({ fuelType, euroNorm: euroRaw, powerKw, year });

    if (co2Scraped && co2Scraped > 0) {
      co2Final  = co2Scraped;
      co2Source = 'pagina';
      const dev = checkCO2Deviation(co2Scraped, estimation.co2);
      if (dev.warn) co2Warning = dev.message;
    } else {
      co2Final  = estimation.co2;
      co2Source = `schatting (${estimation.method})`;
    }

    console.log('[CarImport]', { price, year, fuelType, co2Final, co2Source, co2Warning, powerKw, euroRaw });

    return {
      price,
      year,
      fuelType,
      co2: co2Final,
      co2Source,
      co2Confidence: co2Scraped ? 'scraped' : estimation.confidence,
      co2Warning,
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

    const confidenceLabel = {
      'scraped':   { icon: '\u2705', text: 'van de advertentie', color: '#2e7d32' },
      'medium':    { icon: '\u26a0\ufe0f', text: 'geschat (euronorm + vermogen)', color: '#e65100' },
      'low':       { icon: '\u26a0\ufe0f', text: 'geschat (beperkte data)', color: '#e65100' },
      'very-low':  { icon: '\u274c', text: 'ruwe schatting', color: '#c62828' },
      'exact':     { icon: '\u2705', text: 'elektrisch (0 g/km)', color: '#2e7d32' },
    };
    const cl = confidenceLabel[carData.co2Confidence] ?? confidenceLabel['low'];

    const warningRow = carData.co2Warning
      ? `<tr><td colspan="2" style="padding-top:6px;font-size:12px;color:#b71c1c;">${carData.co2Warning}</td></tr>`
      : '';

    const widget = document.createElement('div');
    widget.id = 'cic-listing-widget';
    widget.style.cssText = `
      background:#fff3e0; border:2px solid #ff9800; border-radius:8px;
      padding:12px 16px; margin:12px 0; font-family:sans-serif; font-size:14px;
    `;
    widget.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px;">\ud83c\uddf3\ud83c\uddf1 Importkosten naar Nederland</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td>Vraagprijs</td><td style="text-align:right">${fmt(costs.price)}</td></tr>
        ${costs.importDuty > 0 ? `<tr><td>Invoerrechten (${costs.importDutyRate}%)</td><td style="text-align:right">${fmt(costs.importDuty)}</td></tr>` : ''}
        <tr><td>BTW (21%)</td><td style="text-align:right">${fmt(costs.vat)}</td></tr>
        ${costs.bpm > 0 ? `<tr><td>BPM</td><td style="text-align:right">${fmt(costs.bpm)}</td></tr>` : ''}
        <tr style="font-weight:700;border-top:1px solid #ff9800;">
          <td>Totaal</td><td style="text-align:right">${fmt(costs.total)}</td>
        </tr>
        ${warningRow}
      </table>
      <p style="margin:6px 0 0;font-size:12px;color:#555;">
        CO\u2082: <strong>${carData.co2}\u00a0g/km</strong>
        <span style="color:${cl.color}">${cl.icon} ${cl.text}</span>
        &nbsp;&middot;&nbsp; BPM-basis: ${carData.co2Source}
      </p>
    `;

    const anchor = document.querySelector('[data-testid="price-section"]');
    if (anchor) anchor.insertAdjacentElement('afterend', widget);
    else document.body.prepend(widget);

    console.log('[CarImport] Widget ge\u00efnjecteerd.');
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
        const text = span.textContent.trim();
        if (/\u20ac/.test(text) || /[\d.]{4,}/.test(text)) {
          const val = parseNumber(text);
          if (val && val > 500) { price = val; break; }
        }
      }
      if (!price) continue;

      const allText  = card.textContent;
      const yearMatch = allText.match(/(19|20)\d{2}/);
      const year      = yearMatch ? parseInt(yearMatch[0], 10) : null;
      const fuelType  = normalizeFuelType(allText);
      const estimation = estimateCO2FromSpecs({ fuelType, year });

      results.push({ el: card, price, year, fuelType, co2: estimation.co2, co2Source: `schatting(${estimation.method})` });
    }
    return results.length ? results : null;
  }

  function injectSearchWidgets(cards, settings) {
    const fmt = (n) =>
      new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

    for (const { el, price, year, fuelType, co2 } of cards) {
      if (el.querySelector('.cic-badge')) continue;
      const costs = calculateImportCosts({ price, year, fuelType, co2 }, settings);
      const badge = document.createElement('div');
      badge.className = 'cic-badge';
      badge.style.cssText = `
        background:#ff9800;color:#fff;border-radius:4px;
        padding:2px 8px;font-size:12px;font-weight:700;
        display:inline-block;margin-top:4px;
      `;
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
