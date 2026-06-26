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
      // Only strip trailing footnote numbers (1-2 digits), not price parts like " 700"
      .replace(/\s+\d{1,2}$/, "")
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
    if (/\bstrom\b/.test(l)) return "electric";
    // FR: "électrique" als zelfstandig token
    if (/\belectrique\b/.test(l)) return "electric";
    if (/\belektrisch\b/.test(l)) return "electric";
    if (/\bstroom\b/.test(l)) return "electric";
    if (l.includes("diesel")) return "diesel";
    if (l.includes("hybrid") || l.includes("phev") || l.includes("hybride"))
      return "hybrid";
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
   *  1. Try [data-testid="price-section"] (all locales incl. FR)
   *  2. Fall back to [data-testid="regular-price"]
   *  3. Generic span/strong scan
   */
  function scrapePrice() {
    // Strategy 1: dedicated price section wrapper (present on all locales)
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

    // Strategy 2: [data-testid="regular-price"] fallback
    const regularPriceEl = document.querySelector(
      '[data-testid="regular-price"]',
    );
    if (regularPriceEl) {
      const val = parsePrice(regularPriceEl.textContent);
      if (val && val > 500 && val < 10_000_000) return val;
    }

    // Strategy 3: Generic — scan all spans for a \u20ac-price pattern
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

    const country = detectListingPageCountry();
    const importRelevant = country !== "nl";

    const firstRegRaw = scrapeDetailValue([
      "Erstzulassung", // DE
      "First registration", // EN
      "Eerste registratie", // NL (.nl)
      "Eerste inschrijving", // NL-BE (.be/nl) \u2190 the fix
      "1\u00e8re mise en circulation", // FR
      "Bouwjaar",
      "Mise en circulation", // FR fallback
      "Année",
    ]);
    const fuelRaw =
      scrapeDetailValue([
        "Kraftstoff", // DE
        "Anderer Energieträger",
        "Andere brandstoftypes",
        "Fuel type", // EN
        "Brandstof", // NL/BE
        "Carburant", // FR
        "Alimentation", // FR alt
      ]) ?? "";
    const co2Raw = scrapeDetailValue([
      "CO2-Emissionen", // DE
      "CO2 emissions", // EN
      "CO2-uitstoot", // NL
      "CO2-emissies", // NL-BE \u2190 added
      "CO2-emissie",
      "\u00c9missions CO2", // FR (uppercase \u00c9)
      "Émissions de CO2",
      "Emissions CO2", // FR plain
      "\u00e9missions de CO2", // FR lower
      "CO\u2082", // generic fallback
    ]);
    const powerRaw = scrapeDetailValue([
      "Leistung", // DE
      "Power", // EN
      "Vermogen", // NL/BE
      "Puissance", // FR
      "Puissance kW (CH)",
    ]);
    const euroRaw = scrapeDetailValue([
      "Schadstoffklasse", // DE
      "Emission class", // EN
      "Emissieklasse", // NL
      "Emissieklasse", // NL-BE (same)
      "Classe d\u2019\u00e9mission", // FR
      "Classe d'emission", // FR plain
      "Carburant",
      "Euro", // generic fallback
    ]);
    const mileageRaw = scrapeDetailValue([
      "Kilometerstand", // DE/NL/BE
      "Mileage", // EN
      "Kilom\u00e9trage", // FR
      "Kilometrage", // FR plain
    ]);

    // Op de advertentiepagina is fuelRaw een specifiek veld, geef null mee als fuelEl
    const fuelType = normalizeFuelType(fuelRaw, null);
    const powerKw = parsePowerKw(powerRaw);
    const co2Scraped = co2Raw ? parseNumber(co2Raw) : null;
    const year = firstRegRaw ? parseInt(firstRegRaw.match(/\d{4}/)?.[0]) : null;

    const listing = {
      country,
      importRelevant,
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

  function detectListingPageCountry() {
    // 1. Dealer address prefix, e.g. "NL-9502 EC STADSKANAAL"
    const addressEl = document.querySelector(
      '[data-testid="dealer-address"], [data-testid="vendor-contact-address"]',
    );
    const addressText = addressEl?.textContent?.trim() ?? "";
    const prefixMatch = addressText.match(/\b([A-Z]{2})-/i);
    if (prefixMatch) {
      const c = normalizeCountryCode(prefixMatch[1]);
      if (c) return c;
    }

    // 2. JSON-LD schema — addressCountry on the offer
    const jsonEl = document.querySelector('script[type="application/ld+json"]');
    if (jsonEl) {
      try {
        const data = JSON.parse(jsonEl.textContent);
        const addressCountry =
          data?.offers?.offeredBy?.address?.addressCountry ??
          data?.offeredBy?.address?.addressCountry;
        if (addressCountry) {
          const c = normalizeCountryCode(addressCountry);
          if (c) return c;
        }
      } catch (_) {}
    }

    // 3. Last resort: hostname TLD (locale, not car origin — least reliable)
    const tldMatch = window.location.hostname.match(/\.([a-z]{2})$/);
    return tldMatch ? tldMatch[1] : null;
  }

  /**
   * Parses the first-registration date from a search card.
   *
   * FR search cards store the date as the text content of the
   * data-testid="VehicleDetails-calendar" pill, formatted as "MMYYYY"
   * (e.g. "032021" or "04 2026" \u2014 no separator guaranteed).
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

    // 2. Calendar pill text \u2014 FR renders "MMYYYY" (digits only, no separator)
    const calPill = card.querySelector(
      '[data-testid="VehicleDetails-calendar"]',
    );
    if (calPill) {
      const raw = calPill.textContent.trim().replace(/\s+/g, "");
      // "MMYYYY" \u2014 exactly 6 digits
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
    // 1. data-mileage attribute \u2014 already an integer km value on FR cards
    const attr = card.getAttribute("data-mileage");
    if (attr) {
      const val = parseInt(attr, 10);
      if (!isNaN(val) && val >= 0) return val;
    }

    // 2. Mileage pill text
    const mileEl =
      card.querySelector('[data-testid="VehicleDetails-mileageodometer"]') ??
      card.querySelector('[data-testid="listing-item-mileage"]') ??
      card.querySelector('[class*="Mileage"]');
    if (mileEl) {
      const val = parseNumber(mileEl.textContent);
      if (val != null && val >= 0) return val;
    }

    return null;
  }

  function normalizeCountryCode(raw) {
    if (!raw) return null;
    const v = raw.trim().toLowerCase();

    if (v === "de" || v.includes("germany") || v.includes("duitsland"))
      return "de";
    if (v === "nl" || v.includes("netherlands") || v.includes("nederland"))
      return "nl";

    return v.length === 2 ? v : null;
  }

  function detectListingCountry(card) {
    // 1. Beste bron: expliciet attribuut op de kaart
    const attrCountry = card.getAttribute("data-listing-country");
    const normalizedAttr = normalizeCountryCode(attrCountry);
    if (normalizedAttr) return normalizedAttr;

    // 2. Fallback: dealer-adres, bv. "NL-3972 KB DRIEBERGEN-RIJSENBURG"
    const addressEl = card.querySelector('[data-testid="dealer-address"]');
    const addressText = addressEl?.textContent?.trim() ?? "";
    const prefixMatch = addressText.match(/\b([A-Z]{2})-/i);
    if (prefixMatch) {
      const normalizedPrefix = normalizeCountryCode(prefixMatch[1]);
      if (normalizedPrefix) return normalizedPrefix;
    }

    // 3. Optionele fallback: locale/domein, alleen als laatste redmiddel
    const host = window.location.hostname.toLowerCase();
    if (host.endsWith(".de")) return "de";
    if (host.endsWith(".nl")) return "nl";

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

      const country = detectListingCountry(card);
      const importRelevant = country !== "nl";

      const allText = Array.from(card.querySelectorAll("*"))
        .map((el) => el.childNodes)
        .reduce((acc, nodes) => {
          for (const n of nodes)
            if (n.nodeType === Node.TEXT_NODE) acc.push(n.textContent.trim());
          return acc;
        }, [])
        .filter(Boolean)
        .join(" ");

      const firstRegDate = parseFirstRegFromCard(card);
      const year = firstRegDate
        ? parseInt(firstRegDate.split("/")[1], 10)
        : null;

      const fuelEl =
        card.querySelector('[data-testid="VehicleDetails-gaspump"]') ??
        card.querySelector('[data-testid="listing-item-fuel-type"]') ??
        card.querySelector('[data-testid="fuel-type"]') ??
        card.querySelector('[class*="FuelType"]') ??
        card.querySelector('[class*="fuel"]');
      const fuelType = normalizeFuelType(allText, fuelEl);

      const powerEl =
        card.querySelector('[data-testid="VehicleDetails-speedometer"]') ??
        card.querySelector('[data-testid="listing-item-power"]') ??
        card.querySelector('[class*="Power"]') ??
        card.querySelector('[class*="power"]');
      const powerKw = parsePowerKw(powerEl?.textContent ?? allText);

      const mileage = parseMileageFromCard(card);

      results.push({
        el: card,
        country, // nieuw
        importRelevant, // nieuw
        price: { value: price, unit: "EUR" },
        firstRegDate: firstRegDate
          ? { value: firstRegDate, unit: "MM/YYYY" }
          : null,
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
