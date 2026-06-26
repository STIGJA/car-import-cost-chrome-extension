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
      if (t.includes("elektr") || t.includes("electric") || t.includes("bev"))
        return "electric";
      if (t.includes("diesel")) return "diesel";
      if (t.includes("hybrid") || t.includes("phev")) return "hybrid";
      // FR: "électrique" / "lectrique" (with or without leading é)
      if (t.includes("lectrique")) return "electric";
      // FR: "Hybride"
      if (t.includes("hybride")) return "hybrid";
      // FR: "Essence" — explicit return so it never falls through to the raw-text block
      if (t.includes("essence")) return "petrol";
    }
    // Fallback op vrije tekst — gebruik woordgrens-matching voor elektrisch
    const l = (raw ?? "").toLowerCase();
    // Elektrisch: alleen als zelfstandig woord/afkorting, NIET als bijvoeglijk naamwoord
    if (/\belectric\b|\bbev\b|\bev\b/.test(l)) return "electric";
    // "Elektro" (Duits voor elektrisch rijden) wel, "elektrische" (bijv. stoel) niet
    if (/\belektro\b/.test(l)) return "electric";
    // FR: "électrique" als zelfstandig token
    if (/\blectrique\b/.test(l)) return "electric";
    if (l.includes("diesel")) return "diesel";
    if (l.includes("hybrid") || l.includes("phev") || l.includes("hybride")) return "hybrid";
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

  /**
   * Scrapes the price from a detail/listing page.
   *
   * Strategy:
   *  1. Try [data-testid="price-section"] (autoscout24.de / .nl / .be)
   *  2. Fall back to [data-testid="regular-price"] which is present on
   *     autoscout24.fr and is the same element used in search cards.
   */
  function scrapePrice() {
    // Strategy 1: DE/NL/BE — dedicated price section wrapper
    const section = document.querySelector('[data-testid="price-section"]');
    if (section) {
      for (const span of section.querySelectorAll("span")) {
        const directText = Array.from(span.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent.trim())
          .join("");

        if (!directText) continue;

        const isPriceOnly =
          /^[\u20ac\s\u00a0\d.,\u00b9\u00b2\u00b3\u2070-\u2079]+$/.test(
            directText,
          );
        if (!isPriceOnly) continue;

        const val = parsePrice(directText);
        if (val && val > 500 && val < 10_000_000) return val;
      }
    }

    // Strategy 2: FR — [data-testid="regular-price"] is present directly on the page
    const regularPriceEl = document.querySelector('[data-testid="regular-price"]');
    if (regularPriceEl) {
      const val = parsePrice(regularPriceEl.textContent);
      if (val && val > 500 && val < 10_000_000) return val;
    }

    // Strategy 3: Generic — scan all spans for a €-price pattern
    for (const el of document.querySelectorAll("span, strong")) {
      const text = el.textContent.trim();
      if (!text || text.length > 30) continue;
      if (!/[\u20ac]/.test(text)) continue;
      const val = parsePrice(text);
      if (val && val > 500 && val < 10_000_000) return val;
    }

    return null;
  }

  function parsePowerKw(raw) {
    if (!raw) return null;
    const kwM = raw.match(/(\d+)\s*kW/);
    // FR uses "Ch" for chevaux (PS), also match cv
    const psM = raw.match(/(\d+)\s*(PS|pk|hp|cv|Ch)/i);
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
      "Mise en circulation",
    ]);
    const fuelRaw =
      scrapeDetailValue([
        "Kraftstoff",
        "Fuel type",
        "Brandstof",
        "Carburant",
        "Alimentation",
      ]) ?? "";
    const co2Raw = scrapeDetailValue([
      "CO2-Emissionen",
      "CO2 emissions",
      "CO2-uitstoot",
      "\u00c9missions CO2",
      "Emissions CO2",
      "CO\u2082",
    ]);
    const powerRaw = scrapeDetailValue([
      "Leistung",
      "Power",
      "Vermogen",
      "Puissance",
    ]);
    const euroRaw = scrapeDetailValue([
      "Schadstoffklasse",
      "Emission class",
      "Emissieklasse",
      "Classe d\u2019\u00e9mission",
      "Classe d'emission",
      "Euro",
    ]);
    const mileageRaw = scrapeDetailValue([
      "Kilometerstand",
      "Mileage",
      "Kilom\u00e9trage",
      "Kilometrage",
    ]);

    // Op de advertentiepagina is fuelRaw een specifiek veld, geef null mee als fuelEl
    const fuelType = normalizeFuelType(fuelRaw, null);
    const powerKw = parsePowerKw(powerRaw);
    const co2Scraped = co2Raw ? parseNumber(co2Raw) : null;
    const year = firstRegRaw ? parseInt(firstRegRaw.match(/\d{4}/)?.[0]) : null;

    const listing = {
      price: { value: price, unit: "EUR" },
      firstRegDate: firstRegRaw
        ? { value: firstRegRaw, unit: "MM/YYYY" }
        : null,
      fuelType: { value: fuelType },
      mileage: mileageRaw
        ? { value: parseNumber(mileageRaw), unit: "km" }
        : null,
      powerKw: powerKw ? { value: powerKw, unit: "kW" } : null,
      euroNorm: euroRaw ? { value: euroRaw } : null,
      co2: buildCO2Field(fuelType, euroRaw, powerKw, year, co2Scraped),
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

  /**
   * Parses the first-registration date from a search card.
   *
   * FR search cards store the date as the text content of the
   * data-testid="VehicleDetails-calendar" pill, formatted as "MMYYYY"
   * (e.g. "032021" or "04 2026" — no separator guaranteed).
   * We also check the data-first-registration attribute on the article
   * element itself (format "MM-YYYY") as a reliable fallback.
   *
   * DE/NL/BE cards may use a different format; the existing year-only
   * regex is kept as a final fallback so those locales are unaffected.
   */
  function parseFirstRegFromCard(card) {
    // 1. data-first-registration attribute on the article (FR: "MM-YYYY")
    const attr = card.getAttribute("data-first-registration");
    if (attr) {
      // Format: "MM-YYYY" e.g. "03-2021"
      const attrM = attr.match(/^(\d{2})-(\d{4})$/);
      if (attrM) return `${attrM[1]}/${attrM[2]}`;
    }

    // 2. Calendar pill text — FR renders "MMYYYY" (digits only, no separator)
    const calPill = card.querySelector('[data-testid="VehicleDetails-calendar"]');
    if (calPill) {
      const raw = calPill.textContent.trim().replace(/\s+/g, "");
      // "MMYYYY" — exactly 6 digits
      const sixDigM = raw.match(/^(\d{2})(\d{4})$/);
      if (sixDigM) return `${sixDigM[1]}/${sixDigM[2]}`;
      // "MM/YYYY" or "MM-YYYY" already formatted
      const slashM = raw.match(/^(\d{2})[\/\-](\d{4})$/);
      if (slashM) return `${slashM[1]}/${slashM[2]}`;
      // Fallback: just a year
      const yearOnlyM = raw.match(/(19|20)(\d{2})/);
      if (yearOnlyM) return `01/${yearOnlyM[0]}`;
    }

    // 3. Last resort: year regex on full card text
    const yearM = card.textContent.match(/(19|20)\d{2}/);
    if (yearM) return `01/${yearM[0]}`;

    return null;
  }

  /**
   * Parses the mileage from a search card.
   *
   * FR search cards expose mileage in the
   * data-testid="VehicleDetails-mileageodometer" pill (e.g. "72 405 km").
   * The data-mileage attribute on the article element is also reliable
   * (integer km value, already parsed).
   */
  function parseMileageFromCard(card) {
    // 1. data-mileage attribute — already an integer km value on FR cards
    const attr = card.getAttribute("data-mileage");
    if (attr) {
      const val = parseInt(attr, 10);
      if (!isNaN(val) && val >= 0) return val;
    }

    // 2. Mileage pill text
    const mileEl = card.querySelector('[data-testid="VehicleDetails-mileageodometer"]') ??
      card.querySelector('[data-testid="listing-item-mileage"]') ??
      card.querySelector('[class*="Mileage"]');
    if (mileEl) {
      const val = parseNumber(mileEl.textContent);
      if (val != null && val >= 0) return val;
    }

    return null;
  }

  function scrapeSearchPage() {
    const cards = document.querySelectorAll(
      'article[data-testid="list-item"], article[data-testid="listing-item"], article[class*="ListItem"], article[id*="listing"]',
    );
    if (!cards.length) return null;

    const results = [];
    for (const card of cards) {
      const price = scrapePriceFromCard(card);
      if (!price) continue;

      const allText = card.textContent;

      const firstRegDate = parseFirstRegFromCard(card);
      const year = firstRegDate
        ? parseInt(firstRegDate.split("/")[1], 10)
        : null;

      // Brandstof uit specifiek element lezen om valse 'electric' matches te vermijden.
      // FR search cards use data-testid="VehicleDetails-gaspump" for the fuel pill.
      const fuelEl =
        card.querySelector('[data-testid="VehicleDetails-gaspump"]') ??
        card.querySelector('[data-testid="listing-item-fuel-type"]') ??
        card.querySelector('[data-testid="fuel-type"]') ??
        card.querySelector('[class*="FuelType"]') ??
        card.querySelector('[class*="fuel"]');
      const fuelType = normalizeFuelType(allText, fuelEl);

      // Vermogen parsen — FR cards use data-testid="VehicleDetails-speedometer"
      const powerEl =
        card.querySelector('[data-testid="VehicleDetails-speedometer"]') ??
        card.querySelector('[data-testid="listing-item-power"]') ??
        card.querySelector('[class*="Power"]') ??
        card.querySelector('[class*="power"]');
      const powerKw = parsePowerKw(powerEl?.textContent ?? allText);

      const mileage = parseMileageFromCard(card);

      results.push({
        el: card,
        price: { value: price, unit: "EUR" },
        firstRegDate: firstRegDate ? { value: firstRegDate, unit: "MM/YYYY" } : null,
        fuelType: { value: fuelType },
        mileage: mileage != null ? { value: mileage, unit: "km" } : null,
        powerKw: powerKw ? { value: powerKw, unit: "kW" } : null,
        euroNorm: null,
        co2: buildCO2Field(fuelType, null, powerKw, year, null),
      });
    }
    return results.length ? results : null;
  }

  root.CIC_AS24 = { scrapeListingPage, scrapeSearchPage };
})(window);
