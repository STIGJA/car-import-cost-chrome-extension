/**
 * autoscout24.js — Scraper voor AutoScout24
 */

'use strict';

(function (root) {

  function parsePrice(raw) {
    if (!raw) return null;
    const cleaned = raw
      .replace(/[\u00b9\u00b2\u00b3\u2070-\u2079]/g, '')
      .replace(/\s+\d+$/, '')
      .replace(/[^0-9]/g, '');
    return cleaned ? parseInt(cleaned, 10) : null;
  }

  function parseNumber(raw) {
    if (!raw) return null;
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : null;
  }

  function normalizeFuelType(raw) {
    const l = (raw ?? '').toLowerCase();
    if (l.includes('elektr') || l.includes('electric') || l.includes('bev')) return 'electric';
    if (l.includes('diesel'))                                                 return 'diesel';
    if (l.includes('hybrid') || l.includes('phev'))                          return 'hybrid';
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

  /**
   * Returns the smallest valid price found inside [data-testid="price-section"].
   * Leaf text nodes only (el.children.length === 0) to avoid double-counting.
   */
  function scrapePrice() {
    const section = document.querySelector('[data-testid="price-section"]');
    if (!section) return null;

    const candidates = [];
    for (const el of section.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      const text = el.textContent.trim();
      if (!text || text.length > 20) continue;
      const val = parsePrice(text);
      if (val && val > 500 && val < 10_000_000) candidates.push(val);
    }

    if (!candidates.length) return null;
    return Math.min(...candidates);
  }

  function parsePowerKw(raw) {
    if (!raw) return null;
    const kwM = raw.match(/(\d+)\s*kW/);
    const psM = raw.match(/(\d+)\s*(PS|pk|hp|cv)/i);
    if (kwM) return parseInt(kwM[1], 10);
    if (psM) return Math.round(parseInt(psM[1], 10) * 0.7355);
    return null;
  }

  function buildCO2Field(fuelType, euroNormRaw, powerKw, year, co2Scraped) {
    // CIC_Lookups may not be loaded in all contexts — guard gracefully
    const lookups = root.CIC_Lookups;
    if (!lookups) {
      return { value: co2Scraped ?? null, unit: 'g/km', source: 'scraped', method: null, confidence: co2Scraped ? 'scraped' : 'unknown' };
    }
    const estimation = lookups.estimateCO2({ fuelType, euroNorm: euroNormRaw, powerKw, year });
    if (co2Scraped && co2Scraped > 0) {
      lookups.checkCO2Deviation?.(co2Scraped, estimation.co2, null);
      return { value: co2Scraped, unit: 'g/km', source: 'scraped', method: null, confidence: 'scraped' };
    }
    return {
      value:      estimation.co2,
      unit:       'g/km',
      source:     'estimated',
      method:     estimation.method,
      confidence: estimation.confidence,
    };
  }

  function parseLocationText(text) {
    if (!text) return null;
    const prefixed = text.match(/\b(DE|BE|FR|IT|ES|AT|CH|PL|NL|LU|CZ|HU|RO|PT)[-\s](\d{4,5})\b/);
    if (prefixed) return { postcode: prefixed[2], country: prefixed[1] };
    const de = text.match(/\b(\d{5})\b/);
    if (de) return { postcode: de[1], country: 'DE' };
    const be = text.match(/\b([1-9]\d{3})\b/);
    if (be && parseInt(be[1], 10) < 9999) return { postcode: be[1], country: 'BE' };
    return null;
  }

  function scrapeLocation() {
    const selectors = [
      '[data-testid="seller-info"]',
      '[data-testid="vendor-contact"]',
      '[class*="SellerInfo"]',
      '[class*="dealer-address"]',
      '[class*="LocationWithPin"]',
      'address',
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const loc = parseLocationText(el.textContent.trim());
        if (loc) return loc;
      }
    }
    return { postcode: null, country: null };
  }

  // ---------------------------------------------------------------------------
  // Listing page
  // ---------------------------------------------------------------------------

  function scrapeListingPage() {
    const price = scrapePrice();
    if (!price) return null;

    const firstRegRaw = scrapeDetailValue(['Erstzulassung', 'First registration', 'Eerste registratie', '1\u00e8re mise en circulation']);
    const fuelRaw     = scrapeDetailValue(['Kraftstoff', 'Fuel type', 'Brandstof', 'Carburant']) ?? '';
    const co2Raw      = scrapeDetailValue(['CO2-Emissionen', 'CO2 emissions', 'CO2-uitstoot', '\u00c9missions CO2', 'CO\u2082']);
    const powerRaw    = scrapeDetailValue(['Leistung', 'Power', 'Vermogen', 'Puissance']);
    const euroRaw     = scrapeDetailValue(['Schadstoffklasse', 'Emission class', 'Emissieklasse', 'Classe d\u2019\u00e9mission', 'Euro']);
    const mileageRaw  = scrapeDetailValue(['Kilometerstand', 'Mileage', 'Kilom\u00e9trage']);

    const fuelType   = normalizeFuelType(fuelRaw);
    const powerKw    = parsePowerKw(powerRaw);
    const co2Scraped = co2Raw ? parseNumber(co2Raw) : null;
    const year       = firstRegRaw ? parseInt(firstRegRaw.match(/\d{4}/)?.[0]) : null;
    const location   = scrapeLocation();

    const listing = {
      price:        { value: price, unit: 'EUR' },
      firstRegDate: firstRegRaw ? { value: firstRegRaw, unit: 'MM/YYYY' } : null,
      fuelType:     { value: fuelType },
      mileage:      mileageRaw ? { value: parseNumber(mileageRaw), unit: 'km' } : null,
      powerKw:      powerKw    ? { value: powerKw, unit: 'kW' }              : null,
      euroNorm:     euroRaw    ? { value: euroRaw }                           : null,
      co2:          buildCO2Field(fuelType, euroRaw, powerKw, year, co2Scraped),
      postcode:     location.postcode,
      country:      location.country,
    };

    console.log('[CarImport] ListingInfo:', listing);
    return listing;
  }

  // ---------------------------------------------------------------------------
  // Search results page
  // ---------------------------------------------------------------------------

  function scrapeSearchPage() {
    const cards = document.querySelectorAll(
      'article[data-testid="listing-item"], article[class*="ListItem"], article[id*="listing"]'
    );
    if (!cards.length) return null;

    const results = [];
    for (const card of cards) {
      let price = null;
      const priceEl = card.querySelector('[data-testid="price-label"], [class*="Price"], [class*="price"]');
      const searchIn = priceEl ?? card;
      for (const el of searchIn.querySelectorAll('*')) {
        if (el.children.length > 0) continue;
        const text = el.textContent.trim();
        if (!text || text.length > 20) continue;
        const val = parsePrice(text);
        if (val && val > 500 && val < 10_000_000) { price = val; break; }
      }
      if (!price) continue;

      const allText  = card.textContent;
      const yearM    = allText.match(/(19|20)\d{2}/);
      const year     = yearM ? parseInt(yearM[0], 10) : null;
      const fuelType = normalizeFuelType(allText);
      const loc      = parseLocationText(allText);

      results.push({
        el:           card,
        price:        { value: price, unit: 'EUR' },
        firstRegDate: year ? { value: `01/${year}`, unit: 'MM/YYYY' } : null,
        fuelType:     { value: fuelType },
        mileage:      null,
        powerKw:      null,
        euroNorm:     null,
        co2:          buildCO2Field(fuelType, null, null, year, null),
        postcode:     loc?.postcode ?? null,
        country:      loc?.country  ?? 'DE',
      });
    }
    return results.length ? results : null;
  }

  root.CIC_AS24 = { scrapeListingPage, scrapeSearchPage };
})(window);
