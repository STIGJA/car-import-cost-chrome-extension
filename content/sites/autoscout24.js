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
 *   postcode:     string | null
 *   country:      string | null
 *   el:           Element  (search page only)
 * }
 */

"use strict";

(function (root) {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function parsePrice(raw) {
    if (!raw) return null;
    const cleaned = raw
      .replace(/[\u00b9\u00b2\u00b3\u2070-\u2079]/g, "")
      .replace(/\s+\d+$/, "")
      .replace(/[^0-9]/g, "");
    return cleaned ? parseInt(cleaned, 10) : null;
  }

  function parseNumber(raw) {
    if (!raw) return null;
    const digits = raw.replace(/[^0-9]/g, "");
    return digits ? parseInt(digits, 10) : null;
  }

  /**
   * Bepaalt brandstoftype uit een string.
   *
   * Op de zoekpagina wordt allText (hele kaart) meegegeven, maar de omschrijving
   * kan woorden als "Elektrische Sitzeinstellung" bevatten die niets met het
   * brandstoftype te maken hebben.
   *
   * Strategie:
   *  1. Probeer een specifiek brandstof-element te lezen (data-testid of class).
   *  2. Val terug op de volledige tekst, maar pas dan alleen op duidelijke
   *     woorden die als zelfstandig token staan (bijv. "Diesel" als woord,
   *     niet als onderdeel van "Dieselpartikelfilter").
   *  3. "elektrisch" / "electric" / "BEV" als zelfstandige term, NIET als
   *     onderdeel van bijv. "elektrische stoelverstelling".
   */
  function normalizeFuelType(raw, fuelEl) {
    // Eerst: specifiek element (meest betrouwbaar)
    if (fuelEl) {
      const t = fuelEl.textContent.trim().toLowerCase();
      if (t.includes("elektr") || t.includes("electric") || t.includes("bev")) return "electric";
      if (t.includes("diesel")) return "diesel";
      if (t.includes("hybrid") || t.includes("phev")) return "hybrid";
    }
    // Fallback op vrije tekst — gebruik woordgrens-matching voor elektrisch
    const l = (raw ?? "").toLowerCase();
    // Elektrisch: alleen als zelfstandig woord/afkorting, NIET als bijvoeglijk naamwoord
    if (/\belectric\b|\bbev\b|\bev\b/.test(l)) return "electric";
    // "Elektro" (Duits voor elektrisch rijden) wel, "elektrische" (bijv. stoel) niet
    if (/\belektro\b/.test(l)) return "electric";
    if (l.includes("diesel")) return "diesel";
    if (l.includes("hybrid") || l.includes("phev")) return "hybrid";
    return "petrol";
  }

  function scrapeDetailValue(labels) {
    for (const dt of document.querySelectorAll("dt")) {
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

    for (const span of section.querySelectorAll("span")) {
      const directText = Array.from(span.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .join("");

      if (!directText) continue;

      const isPriceOnly =
        /^[\u20ac\s\u00a0\d.,\u00b9\u00b2\u00b3\u2070-\u2079]+$/.test(directText);
      if (!isPriceOnly) continue;

      const val = parsePrice(directText);
      if (val && val > 500 && val < 10_000_000) return val;
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
    const estimation = root.CIC_Lookups.estimateCO2({
      fuelType,
      euroNorm: euroNormRaw,
      powerKw,
      year,
    });
    if (co2Scraped && co2Scraped > 0) {
      root.CIC_Lookups.checkCO2Deviation(co2Scraped, estimation.co2, null);
      return {
        value: co2Scraped,
        unit: "g/km",
        source: "scraped",
        method: null,
        confidence: "scraped",
      };
    }
    return {
      value: estimation.co2,
      unit: "g/km",
      source: "estimated",
      method: estimation.method,
      confidence: estimation.confidence,
    };
  }

  function scrapeLocation() {
    const candidates = [
      document.querySelector('[data-testid="seller-info"]'),
      document.querySelector('[data-testid="vendor-contact"]'),
      document.querySelector('[class*="SellerInfo"]'),
      document.querySelector('[class*="dealer-address"]'),
      document.querySelector('[class*="LocationWithPin"]'),
    ];
    for (const el of candidates) {
      if (!el) continue;
      const loc = parseLocationText(el.textContent.trim());
      if (loc) return loc;
    }
    for (const el of document.querySelectorAll(
      'address, [class*="location"], [class*="Location"]',
    )) {
      const loc = parseLocationText(el.textContent.trim());
      if (loc) return loc;
    }
    return { postcode: null, country: null };
  }

  function parseLocationText(text) {
    if (!text) return null;
    const de = text.match(/\b(\d{5})\b/);
    if (de) return { postcode: de[1], country: "DE" };
    const be = text.match(/\b([1-9]\d{3})\b/);
    if (be && parseInt(be[1], 10) < 9999)
      return { postcode: be[1], country: "BE" };
    return null;
  }

  // ---------------------------------------------------------------------------
  // Listing page
  // ---------------------------------------------------------------------------

  function scrapeListingPage() {
    const price = scrapePrice();
    if (!price) return null;

    const firstRegRaw = scrapeDetailValue([
      "Erstzulassung",
      "First registration",
      "Eerste registratie",
      "1\u00e8re mise en circulation",
    ]);
    const fuelRaw =
      scrapeDetailValue(["Kraftstoff", "Fuel type", "Brandstof", "Carburant"]) ?? "";
    const co2Raw = scrapeDetailValue([
      "CO2-Emissionen",
      "CO2 emissions",
      "CO2-uitstoot",
      "\u00c9missions CO2",
      "CO\u2082",
    ]);
    const powerRaw = scrapeDetailValue(["Leistung", "Power", "Vermogen", "Puissance"]);
    const euroRaw = scrapeDetailValue([
      "Schadstoffklasse",
      "Emission class",
      "Emissieklasse",
      "Classe d\u2019\u00e9mission",
      "Euro",
    ]);
    const mileageRaw = scrapeDetailValue(["Kilometerstand", "Mileage", "Kilom\u00e9trage"]);

    // Op de advertentiepagina is fuelRaw een specifiek veld, geef null mee als fuelEl
    const fuelType = normalizeFuelType(fuelRaw, null);
    const powerKw = parsePowerKw(powerRaw);
    const co2Scraped = co2Raw ? parseNumber(co2Raw) : null;
    const year = firstRegRaw ? parseInt(firstRegRaw.match(/\d{4}/)?.[0]) : null;
    const location = scrapeLocation();

    const listing = {
      price: { value: price, unit: "EUR" },
      firstRegDate: firstRegRaw ? { value: firstRegRaw, unit: "MM/YYYY" } : null,
      fuelType: { value: fuelType },
      mileage: mileageRaw ? { value: parseNumber(mileageRaw), unit: "km" } : null,
      powerKw: powerKw ? { value: powerKw, unit: "kW" } : null,
      euroNorm: euroRaw ? { value: euroRaw } : null,
      co2: buildCO2Field(fuelType, euroRaw, powerKw, year, co2Scraped),
      postcode: location.postcode,
      country: location.country,
    };

    console.log("[CarImport] ListingInfo:", listing);
    return listing;
  }

  // ---------------------------------------------------------------------------
  // Search results page
  // ---------------------------------------------------------------------------

  function scrapePriceFromCard(card) {
    const priceEl =
      card.querySelector('[data-testid="price"]') ??
      card.querySelector('[data-testid="listing-item-price"]') ??
      card.querySelector('[data-testid="regular-price"]') ??
      card.querySelector('[class*="Price__value"]') ??
      card.querySelector('[class*="PriceInfo"]');

    if (priceEl) {
      const directText = Array.from(priceEl.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .join("");
      const val = parsePrice(directText || priceEl.textContent);
      if (val && val > 500 && val < 10_000_000) return val;
    }

    for (const el of card.querySelectorAll("span, strong, p")) {
      const text = el.textContent.trim();
      if (!/[\u20ac]/.test(text)) continue;
      if (text.length > 30) continue;
      const val = parsePrice(text);
      if (val && val > 500 && val < 10_000_000) return val;
    }
    return null;
  }

  function scrapeSearchPage() {
    const cards = document.querySelectorAll(
      'article[data-testid="listing-item"], article[class*="ListItem"], article[id*="listing"]',
    );
    if (!cards.length) return null;

    const results = [];
    for (const card of cards) {
      const price = scrapePriceFromCard(card);
      if (!price) continue;

      const allText = card.textContent;

      const yearM = allText.match(/(19|20)\d{2}/);
      const year = yearM ? parseInt(yearM[0], 10) : null;

      // Brandstof uit specifiek element lezen om valse 'electric' matches te vermijden
      const fuelEl =
        card.querySelector('[data-testid="listing-item-fuel-type"]') ??
        card.querySelector('[data-testid="fuel-type"]') ??
        card.querySelector('[class*="FuelType"]') ??
        card.querySelector('[class*="fuel"]');
      const fuelType = normalizeFuelType(allText, fuelEl);

      // Vermogen parsen uit kaart voor betere CO2 schatting
      const powerEl =
        card.querySelector('[data-testid="listing-item-power"]') ??
        card.querySelector('[class*="Power"]') ??
        card.querySelector('[class*="power"]');
      const powerKw = parsePowerKw(powerEl?.textContent ?? allText);

      const loc = parseLocationText(allText);

      results.push({
        el: card,
        price: { value: price, unit: "EUR" },
        firstRegDate: year ? { value: `01/${year}`, unit: "MM/YYYY" } : null,
        fuelType: { value: fuelType },
        mileage: null,
        powerKw: powerKw ? { value: powerKw, unit: "kW" } : null,
        euroNorm: null,
        co2: buildCO2Field(fuelType, null, powerKw, year, null),
        postcode: loc?.postcode ?? null,
        country: loc?.country ?? "DE",
      });
    }
    return results.length ? results : null;
  }

  root.CIC_AS24 = { scrapeListingPage, scrapeSearchPage };
})(window);
