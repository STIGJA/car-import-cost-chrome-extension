/**
 * mobile_de.js — Scraper voor Mobile.de
 *
 * Selectors geverifieerd via opgeslagen detailpagina (Mazda CX-5, juni 2026).
 *
 * DETAILPAGINA (suchen.mobile.de/fahrzeuge/details.html?id=XXXXX):
 *   Prijs (prim.)    : [data-testid="vip-price-label"]        → "16.990\u00a0€"
 *   Prijs (alt.)     : [data-testid="price-label"],
 *                      [data-testid="vip-price"],
 *                      [class*="price"] containing € sign
 *   Kilometerstand   : [data-testid="mileage-item"]
 *   Vermogen         : [data-testid="power-item"]
 *   Brandstof        : [data-testid="envkv.engineType-item"] / [data-testid="fuel-item"]
 *   CO2              : [data-testid="envkv.co2Emissions-item"]
 *   Eerste registratie: [data-testid="firstRegistration-item"]
 *   Euro-norm        : [data-testid="emissionClass-item"]
 *   Adres (locatie)  : [data-testid="vip-dealer-box-seller-address2"]
 *                      fallback: [data-testid="vehicle-location-badge"]
 *
 * ZOEKPAGINA (suchen.mobile.de/fahrzeuge/search.html):
 *   Kaart container  : [data-testid^="result-listing-"] filtered on /^result-listing-\d+$/
 *   Prijs            : [data-testid="price-label"]
 *   Kenmerken        : [data-testid="listing-details-attributes"]
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
    const val = cleaned ? parseInt(cleaned, 10) : null;
    return val && val > 100 && val < 10_000_000 ? val : null;
  }

  function parseNumber(raw) {
    if (!raw) return null;
    const digits = raw.replace(/[^0-9]/g, "");
    return digits ? parseInt(digits, 10) : null;
  }

  function cleanText(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll("sup, button, svg").forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
  }

  function readItemValue(testid, labelStrings) {
    const el = document.querySelector(`[data-testid="${testid}"]`);
    if (!el) return null;
    const dt = el.querySelector("dt");
    if (dt) {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === "DD") return cleanText(dd);
    }
    const dd = el.querySelector("dd");
    if (dd) return cleanText(dd);
    const full = cleanText(el);
    if (labelStrings) {
      for (const lbl of labelStrings) {
        const idx = full.indexOf(lbl);
        if (idx !== -1) {
          const val = full.slice(idx + lbl.length).trim();
          if (val) return val;
        }
      }
    }
    return full || null;
  }

  function normalizeFuelType(raw) {
    if (!raw) return "petrol";
    const l = raw.toLowerCase();
    if (/elektromotor|\belektro\b|\bbev\b|\bev\b|\belectric\b/.test(l)) return "electric";
    if (/diesel/.test(l)) return "diesel";
    if (/hybrid|phev|plug.?in/.test(l)) return "hybrid";
    return "petrol";
  }

  function parsePowerKw(raw) {
    if (!raw) return null;
    const kwM = raw.match(/(\d+)\s*kW/);
    if (kwM) return parseInt(kwM[1], 10);
    const psM = raw.match(/(\d+)\s*(PS|hp|cv)/i);
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
  // Detailpagina
  // ---------------------------------------------------------------------------

  function scrapePrice() {
    // Try primary testid first, then several fallbacks
    const selectors = [
      '[data-testid="vip-price-label"]',
      '[data-testid="price-label"]',
      '[data-testid="vip-price"]',
      '[data-testid="vehicle-price"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const val = parsePrice(cleanText(el));
      if (val) return val;
    }
    // Broad fallback: any element with class containing "price" that has a € sign
    for (const el of document.querySelectorAll('[class*="price"], [class*="Price"]')) {
      const text = cleanText(el);
      if (!/[\u20ac]/.test(text)) continue;
      if (text.length > 40) continue;
      const val = parsePrice(text);
      if (val) return val;
    }
    return null;
  }

  function scrapeListingPage() {
    const price = scrapePrice();
    if (!price) {
      console.warn("[CarImport] mobile.de: prijs niet gevonden");
      return null;
    }

    const mileageRaw = readItemValue("mileage-item", ["Kilometerstand", "Mileage", "Km-Stand"]);
    const mileage = mileageRaw ? parseNumber(mileageRaw) : null;

    const powerRaw = readItemValue("power-item", ["Leistung", "Power", "Puissance"]);
    const powerKw = parsePowerKw(powerRaw);

    const engineRaw =
      readItemValue("envkv.engineType-item", ["Antriebsart"]) ??
      readItemValue("fuel-item", ["Kraftstoffart", "Fuel type", "Carburant"]);
    const fuelType = normalizeFuelType(engineRaw);

    const co2Raw = readItemValue("envkv.co2Emissions-item", [
      "CO\u2082-Emissionen (komb.)",
      "CO2-Emissionen",
      "CO2",
    ]);
    const co2Scraped = co2Raw ? parseNumber(co2Raw) : null;

    // Eerste registratie: probeer meerdere testids
    let firstRegDate = null;
    const regTestids = [
      ["firstRegistration-item", ["Erstzulassung", "First registration", "Mise en circulation"]],
      ["firstRegistration", ["Erstzulassung", "First registration"]],
    ];
    for (const [tid, labels] of regTestids) {
      const raw = readItemValue(tid, labels);
      if (!raw) continue;
      const m = raw.match(/(\d{1,2}[\/.\-]\d{4})/);
      if (m) {
        firstRegDate = { value: m[1].replace(/[.\-]/, "/"), unit: "MM/YYYY" };
        break;
      }
    }
    // Fallback: scan body text for "EZ MM/YYYY"
    if (!firstRegDate) {
      const ezM = document.body.innerText.match(/EZ\s+(\d{2}\/\d{4})/);
      if (ezM) firstRegDate = { value: ezM[1], unit: "MM/YYYY" };
    }

    const euroRaw = readItemValue("emissionClass-item", [
      "Schadstoffklasse",
      "Emission class",
      "Norme Euro",
    ]);
    const euroNorm = euroRaw
      ? (euroRaw.match(/Euro\s*\d[a-z]?/i)?.[0] ?? null)
      : null;

    const addrSelectors = [
      '[data-testid="vip-dealer-box-seller-address2"]',
      '[data-testid="vehicle-location-badge"]',
      '[data-testid="seller-title-address"]',
      '[data-testid="seller-address"]',
    ];
    let postcode = null;
    let country = "DE"; // mobile.de is het Duitse platform
    for (const sel of addrSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = cleanText(el);
      const m = text.match(/(?:([A-Z]{2})-)?\b(\d{5})\b/);
      if (m) {
        postcode = m[2];
        country = m[1] ?? "DE";
        break;
      }
    }

    const year = firstRegDate
      ? parseInt(firstRegDate.value.split("/")[1])
      : null;

    const listing = {
      price: { value: price, unit: "EUR" },
      firstRegDate,
      fuelType: { value: fuelType },
      mileage: mileage ? { value: mileage, unit: "km" } : null,
      powerKw: powerKw ? { value: powerKw, unit: "kW" } : null,
      euroNorm: euroNorm ? { value: euroNorm } : null,
      co2: buildCO2Field(fuelType, euroNorm, powerKw, year, co2Scraped),
      postcode,
      country,
    };

    console.log("[CarImport] ListingInfo (mobile.de):", listing);
    return listing;
  }

  // ---------------------------------------------------------------------------
  // Zoekpagina
  // ---------------------------------------------------------------------------

  function parseAttributesText(text) {
    if (!text) return {};
    const result = {};
    const ezM = text.match(/EZ\s+(\d{1,2}[\/.\-]\d{4})/);
    if (ezM) {
      const norm = ezM[1].replace(/[.\-]/, "/");
      result.firstRegDate = { value: norm, unit: "MM/YYYY" };
    }
    const kmM = text.match(/(\d[\d.,]*)\s*km\b/i);
    if (kmM) result.mileage = { value: parseNumber(kmM[1]), unit: "km" };
    const kwM = text.match(/(\d+)\s*kW/);
    if (kwM) result.powerKw = { value: parseInt(kwM[1], 10), unit: "kW" };
    const fuelM = text.match(
      /\b(Benzin|Diesel|Elektro|Hybrid|PHEV|Plug-in|Wasserstoff)\b/i,
    );
    if (fuelM) result.fuelType = { value: normalizeFuelType(fuelM[1]) };
    return result;
  }

  function scrapeSearchPage() {
    // Primary selector: <a data-testid="result-listing-N">
    // Also try <article> wrappers in case mobile.de restructures the card
    const primaryCards = Array.from(
      document.querySelectorAll('[data-testid^="result-listing-"]'),
    ).filter((el) =>
      /^result-listing-\d+$/.test(el.getAttribute("data-testid")),
    );

    // Fallback: <article> cards that contain a price-label
    const fallbackCards = primaryCards.length === 0
      ? Array.from(document.querySelectorAll(
          'article[class*="result"], article[class*="listing"], article[data-testid^="ad-"]'
        )).filter((el) => el.querySelector('[data-testid="price-label"]'))
      : [];

    const cards = primaryCards.length ? primaryCards : fallbackCards;

    if (!cards.length) {
      console.warn("[CarImport] mobile.de: geen kaarten gevonden (primary + fallback)");
      return null;
    }

    console.log(`[CarImport] mobile.de: ${cards.length} kaarten gevonden`);

    const results = [];
    for (const card of cards) {
      const priceEl =
        card.querySelector('[data-testid="price-label"]') ??
        card.querySelector('[data-testid="price"]');
      const price = parsePrice(priceEl ? cleanText(priceEl) : null);
      if (!price) continue;

      const attrsEl = card.querySelector('[data-testid="listing-details-attributes"]');
      const attrsText = attrsEl ? cleanText(attrsEl) : cleanText(card);
      const attrs = parseAttributesText(attrsText);

      const cardText = cleanText(card);
      const postcodeM = cardText.match(/\b(\d{5})\b/);
      const postcode = postcodeM ? postcodeM[1] : null;

      const year = attrs.firstRegDate
        ? parseInt(attrs.firstRegDate.value.split("/")[1])
        : null;
      const fuelType = attrs.fuelType?.value ?? "petrol";
      const powerKw = attrs.powerKw?.value ?? null;

      results.push({
        el: card,
        price: { value: price, unit: "EUR" },
        firstRegDate: attrs.firstRegDate ?? null,
        fuelType: { value: fuelType },
        mileage: attrs.mileage ?? null,
        powerKw: attrs.powerKw ?? null,
        euroNorm: null,
        co2: buildCO2Field(fuelType, null, powerKw, year, null),
        postcode,
        country: "DE",
      });
    }

    console.log(`[CarImport] mobile.de: ${results.length} resultaten met prijs`);
    return results.length ? results : null;
  }

  root.CIC_MDE = { scrapeListingPage, scrapeSearchPage };

})(window);
