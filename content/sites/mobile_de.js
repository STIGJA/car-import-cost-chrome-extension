/**
 * mobile_de.js — Scraper voor Mobile.de
 *
 * ListingInfo shape (identiek aan autoscout24.js):
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
 *   el:           Element  (zoekpagina only)
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

  function normalizeFuelType(raw, fuelEl) {
    if (fuelEl) {
      const t = fuelEl.textContent.trim().toLowerCase();
      if (t.includes("elektr") || t.includes("electric") || t.includes("bev"))
        return "electric";
      if (t.includes("diesel")) return "diesel";
      if (t.includes("hybrid") || t.includes("phev")) return "hybrid";
    }
    const l = (raw ?? "").toLowerCase();
    if (/\belectric\b|\bbev\b|\bev\b/.test(l)) return "electric";
    if (/\belektro\b/.test(l)) return "electric";
    if (l.includes("diesel")) return "diesel";
    if (l.includes("hybrid") || l.includes("phev")) return "hybrid";
    return "petrol";
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

  /**
   * Zoek een rij op in de specificatietabel op de detailpagina.
   * Mobile.de gebruikt doorgaans <dl> of een tabel-achtige lijst met labels.
   */
  function scrapeDetailValue(labels) {
    // Variant 1: <dt>/<dd> patroon (nieuw mobile.de design)
    for (const dt of document.querySelectorAll("dt")) {
      const text = dt.textContent.trim().toLowerCase();
      if (labels.some((l) => text.includes(l.toLowerCase()))) {
        return dt.nextElementSibling?.textContent?.trim() ?? null;
      }
    }
    // Variant 2: data-testid of class-gebaseerde key-value rijen
    for (const row of document.querySelectorAll(
      '[data-testid*="detail"], [class*="DataTable"] [class*="row"], [class*="data-row"]',
    )) {
      const key = row.querySelector(
        '[class*="key"], [class*="label"], [class*="Key"], [class*="Label"]',
      );
      const val = row.querySelector(
        '[class*="value"], [class*="Value"]',
      );
      if (!key || !val) continue;
      const keyText = key.textContent.trim().toLowerCase();
      if (labels.some((l) => keyText.includes(l.toLowerCase()))) {
        return val.textContent.trim();
      }
    }
    // Variant 3: vrije <span>-paren in feature-lijsten
    const spans = Array.from(document.querySelectorAll("span"));
    for (let i = 0; i < spans.length - 1; i++) {
      const t = spans[i].textContent.trim().toLowerCase();
      if (labels.some((l) => t.includes(l.toLowerCase()))) {
        return spans[i + 1].textContent.trim();
      }
    }
    return null;
  }

  function scrapePrice() {
    // Detailpagina: prijs staat in een element met data-testid="price" of class "PriceInfo"
    const candidates = [
      document.querySelector('[data-testid="price"]'),
      document.querySelector('[class*="PriceInfo"]'),
      document.querySelector('[class*="price-block"]'),
      document.querySelector('[class*="VehiclePrice"]'),
      document.querySelector('[class*="asking-price"]'),
      document.querySelector('[id*="price"]'),
    ];
    for (const el of candidates) {
      if (!el) continue;
      const val = parsePrice(el.textContent);
      if (val && val > 500 && val < 10_000_000) return val;
    }
    // Fallback: zoek €-teken in de pagina
    for (const el of document.querySelectorAll("span, strong, b, p")) {
      const text = el.textContent.trim();
      if (!/[\u20ac]/.test(text) || text.length > 30) continue;
      const val = parsePrice(text);
      if (val && val > 500 && val < 10_000_000) return val;
    }
    return null;
  }

  function scrapeLocation() {
    const candidates = [
      document.querySelector('[data-testid="seller-info"]'),
      document.querySelector('[data-testid="vendor-contact"]'),
      document.querySelector('[class*="SellerInfo"]'),
      document.querySelector('[class*="seller-address"]'),
      document.querySelector('[class*="DealerInfo"]'),
      document.querySelector('[class*="LocationInfo"]'),
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
  // Listing (advertentie) pagina
  // ---------------------------------------------------------------------------

  function scrapeListingPage() {
    const price = scrapePrice();
    if (!price) return null;

    const firstRegRaw = scrapeDetailValue([
      "Erstzulassung",
      "First registration",
      "Eerste registratie",
    ]);
    const fuelRaw =
      scrapeDetailValue(["Kraftstoff", "Fuel type", "Brandstof"]) ?? "";
    const co2Raw = scrapeDetailValue([
      "CO2-Emissionen",
      "CO2 emissions",
      "CO2-uitstoot",
      "CO\u2082",
    ]);
    const powerRaw = scrapeDetailValue(["Leistung", "Power", "Vermogen"]);
    const euroRaw = scrapeDetailValue([
      "Schadstoffklasse",
      "Emission class",
      "Emissieklasse",
      "Euro",
    ]);
    const mileageRaw = scrapeDetailValue([
      "Kilometerstand",
      "Mileage",
      "Laufleistung",
    ]);

    const fuelType = normalizeFuelType(fuelRaw, null);
    const powerKw = parsePowerKw(powerRaw);
    const co2Scraped = co2Raw ? parseNumber(co2Raw) : null;
    const year = firstRegRaw ? parseInt(firstRegRaw.match(/\d{4}/)?.[0]) : null;
    const location = scrapeLocation();

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
      postcode: location.postcode,
      country: location.country,
    };

    console.log("[CarImport] ListingInfo (mobile.de):", listing);
    return listing;
  }

  // ---------------------------------------------------------------------------
  // Zoekresultaten pagina
  // ---------------------------------------------------------------------------

  function scrapePriceFromCard(card) {
    const priceEl =
      card.querySelector('[data-testid="price"]') ??
      card.querySelector('[class*="Price"]') ??
      card.querySelector('[class*="price"]');

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
      if (!/[\u20ac]/.test(text) || text.length > 30) continue;
      const val = parsePrice(text);
      if (val && val > 500 && val < 10_000_000) return val;
    }
    return null;
  }

  function scrapeSearchPage() {
    // Mobile.de search: artikelen staan in <article> of <div> met data-testid of class
    const cards = document.querySelectorAll(
      'article[data-testid], article[class*="result"], article[class*="Result"], ' +
      '[data-testid="result-item"], [class*="caris-srp"] article, ' +
      '[class*="VehicleItem"], [class*="vehicle-item"], [class*="SearchResult"]',
    );
    if (!cards.length) return null;

    const results = [];
    for (const card of cards) {
      const price = scrapePriceFromCard(card);
      if (!price) continue;

      const allText = card.textContent;

      const yearM = allText.match(/(19|20)\d{2}/);
      const year = yearM ? parseInt(yearM[0], 10) : null;

      const fuelEl =
        card.querySelector('[data-testid*="fuel"]') ??
        card.querySelector('[class*="FuelType"]') ??
        card.querySelector('[class*="fuel"]');
      const fuelType = normalizeFuelType(allText, fuelEl);

      const powerEl =
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

  root.CIC_MDE = { scrapeListingPage, scrapeSearchPage };
})(window);
