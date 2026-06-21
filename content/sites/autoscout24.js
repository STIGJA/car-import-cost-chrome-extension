/**
 * autoscout24.js — Scraper voor AutoScout24
 *
 * ListingInfo shape:
 * {
 *   price:        { value: number, unit: 'EUR' }
 *   firstRegDate: { value: string, unit: 'MM/YYYY' } | null
 *   fuelType:     { value: 'petrol'|'diesel'|'hybrid'|'electric' }
 *   mileage:      { value: number, unit: 'km' } | null
 *   powerKw:      { value: number, unit: 'kW' } | null
 *   euroNorm:     { value: string } | null
 *   co2:          { value: number, unit: 'g/km', source, method, confidence }
 *   postcode:     string | null    ← location postcode of the car
 *   country:      string | null    ← ISO-2 country code
 *   el:           Element          ← (search page only) the card DOM element
 * }
 */

'use strict';

(function (root) {

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  function parseNumber(raw) {
    if (!raw) return null;
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : null;
  }

  function normalizeFuelType(raw) {
    const l = (raw ?? '').toLowerCase();
    if (l.includes('elektr') || l.includes('electric') || l.includes('bev')) return 'electric';
    if (l.includes('diesel'))                                                  return 'diesel';
    if (l.includes('hybrid') || l.includes('phev'))                           return 'hybrid';
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

  function parsePowerKw(raw) {
    if (!raw) return null;
    const kwM = raw.match(/(\d+)\s*kW/);
    const psM = raw.match(/(\d+)\s*(PS|pk|hp|cv)/i);
    if (kwM) return parseInt(kwM[1], 10);
    if (psM) return Math.round(parseInt(psM[1], 10) * 0.7355);
    return null;
  }

  function buildCO2Field(fuelType, euroNormRaw, powerKw, year, co2Scraped) {
    const estimation = root.CIC_Lookups.estimateCO2({ fuelType, euroNorm: euroNormRaw, powerKw, year });
    if (co2Scraped && co2Scraped > 0) {
      root.CIC_Lookups.checkCO2Deviation(co2Scraped, estimation.co2, null);
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

  /**
   * Scrape the seller's location from the listing page.
   * AS24 renders location in a <p> or <span> near the seller info block.
   * We try multiple selectors and extract a postcode + country from the text.
   */
  function scrapeLocation() {
    // Listing page: seller address block
    const candidates = [
      document.querySelector('[data-testid="seller-info"]'),
      document.querySelector('[data-testid="vendor-contact"]'),
      document.querySelector('[class*="SellerInfo"]'),
      document.querySelector('[class*="dealer-address"]'),
      document.querySelector('[class*="LocationWithPin"]'),
    ];
    for (const el of candidates) {
      if (!el) continue;
      const text = el.textContent.trim();
      const loc  = parseLocationText(text);
      if (loc) return loc;
    }
    // Fallback: scan all small text blocks for a postcode pattern
    for (const el of document.querySelectorAll('address, [class*="location"], [class*="Location"]')) {
      const loc = parseLocationText(el.textContent.trim());
      if (loc) return loc;
    }
    return { postcode: null, country: null };
  }

  /**
   * Parses a raw text fragment for a postcode and derives the country.
   * Supports German (5-digit) and Belgian (4-digit) postcodes for now.
   * Returns { postcode, country } or null.
   */
  function parseLocationText(text) {
    if (!text) return null;
    // German postcode: 5 digits
    const de = text.match(/\b(\d{5})\b/);
    if (de) return { postcode: de[1], country: 'DE' };
    // Belgian postcode: 4 digits (avoid matching years like 2020)
    const be = text.match(/\b([1-9]\d{3})\b/);
    if (be && parseInt(be[1], 10) < 9999) return { postcode: be[1], country: 'BE' };
    return null;
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
      price:        { value: price,    unit: 'EUR' },
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
    // AS24 uses article elements for result cards; data-testid may vary
    const cards = document.querySelectorAll(
      'article[data-testid="listing-item"], article[class*="ListItem"], article[id*="listing"]'
    );
    if (!cards.length) return null;

    const results = [];
    for (const card of cards) {
      // Price
      let price = null;
      for (const span of card.querySelectorAll('span, p, div')) {
        const text = span.textContent.trim();
        if (text.length < 20 && /[\u20ac0-9]/.test(text)) {
          const val = parseNumber(text);
          if (val && val > 500) { price = val; break; }
        }
      }
      if (!price) continue;

      const allText  = card.textContent;
      const yearM    = allText.match(/(19|20)\d{2}/);
      const year     = yearM ? parseInt(yearM[0], 10) : null;
      const fuelType = normalizeFuelType(allText);

      // Location: try to find a postcode in the card text
      const loc = parseLocationText(allText);

      results.push({
        el:           card,
        price:        { value: price,   unit: 'EUR' },
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
