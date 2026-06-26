/**
 * mobile_de.js — Scraper voor Mobile.de
 *
 * Selectors geverifieerd via opgeslagen detailpagina (Mazda CX-5, juni 2026).
 *
 * DETAILPAGINA (suchen.mobile.de/fahrzeuge/details.html?id=XXXXX):
 *   Prijs            : [data-testid="vip-price-label"]        → "16.990\u00a0€"
 *   Kilometerstand   : [data-testid="mileage-item"]           → label+waarde als één blok
 *   Vermogen         : [data-testid="power-item"]             → dt zelf; dd is nextElementSibling
 *   Brandstof        : [data-testid="fuel-item"]              → "KraftstoffartDiesel"
 *   Motortype        : [data-testid="envkv.engineType-item"]  → "AntriebsartVerbrennungsmotor"
 *   CO2              : [data-testid="envkv.co2Emissions-item"]→ "CO\u2082-Emissionen (komb.)\u00b2143\u00a0g/km"
 *   Eerste registratie: [data-testid="firstRegistration-item"] → dt zelf; dd is nextElementSibling → "05/2018"
 *   Euro-norm        : [data-testid="emissionClass-item"]     → dt zelf; dd is nextElementSibling → "Euro6"
 *   Umweltplakette   : [data-testid="emissionsSticker-item"]  → dt zelf; dd is nextElementSibling → "4 Grün"
 *
 * Mobile.de DOM structuur technische data (<dl>):
 *   <dt data-testid="power-item">Leistung</dt>
 *   <dd class="nuAmT">115 kW 156 PS</dd>
 *   De data-testid zit op de <dt> zelf, niet op een wrapper. readItemValue
 *   detecteert dit via tagName === "DT" en leest de nextElementSibling <dd>.
 *
 * ZOEKPAGINA (suchen.mobile.de/fahrzeuge/search.html):
 *   Kaart container  : [data-testid^="result-listing-"] gefilterd op /^result-listing-\d+$/
 *   Prijs            : [data-testid="price-label"]            → "14.990 €"
 *   Kenmerken        : [data-testid="listing-details-attributes"]
 *                      → "Unfallfrei • EZ 10/2013 • 102.696 km • 162 kW (220 PS) • Benzin"
 *
 * ListingInfo shape (identiek aan autoscout24.js).
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

  /**
   * Kloon het element, verwijder <sup>, <button> en <svg> (voetnoten / iconen),
   * geef genormaliseerde tekst terug.
   */
  function cleanText(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll("sup, button, svg").forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
  }

  /**
   * Lees de waarde uit een Mobile.de *-item element.
   *
   * Mobile.de heeft twee DOM-patronen voor [data-testid="X-item"]:
   *
   *  A) data-testid op een wrapper-div die zowel label als waarde bevat
   *     (bijv. mileage-item, fuel-item in de key-features box).
   *     Strategie: zoek interne <dt>/<dd>, of knip het label weg uit de tekst.
   *
   *  B) data-testid op de <dt> zelf in de technische-data <dl>
   *     (bijv. power-item, firstRegistration-item, emissionClass-item).
   *     Structuur:  <dt data-testid="X-item">Label</dt>
   *                 <dd class="nuAmT">Waarde</dd>
   *     Strategie: element IS de <dt>; lees nextElementSibling <dd>.
   */
  function readItemValue(testid, labelStrings) {
    const el = document.querySelector(`[data-testid="${testid}"]`);
    if (!el) return null;

    // Patroon B: het element zelf is een <dt> → waarde zit in de volgende <dd>
    if (el.tagName === "DT") {
      const dd = el.nextElementSibling;
      if (dd && dd.tagName === "DD") return cleanText(dd);
    }

    // Patroon A – Strategie 1: semantische <dt>/<dd> binnen het element
    const dt = el.querySelector("dt");
    if (dt) {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === "DD") return cleanText(dd);
    }
    const dd = el.querySelector("dd");
    if (dd) return cleanText(dd);

    // Patroon A – Strategie 2: label weghalen uit gecleande tekst
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

    // Patroon A – Strategie 3: geef volledige tekst (label + waarde) terug
    return full || null;
  }

  function normalizeFuelType(raw) {
    if (!raw) return "petrol";
    const l = raw.toLowerCase();
    // Elektrisch — let op: "Verbrennungsmotor" moet NIET matchen op elektrisch
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
  // Detailpagina — suchen.mobile.de/fahrzeuge/details.html?id=XXXXX
  // ---------------------------------------------------------------------------

  function scrapeListingPage() {
    // --- Prijs ---
    // [data-testid="vip-price-label"] → "16.990\u00a0€"
    const priceEl = document.querySelector('[data-testid="vip-price-label"]');
    const price = parsePrice(priceEl ? cleanText(priceEl) : null);
    if (!price) {
      console.warn("[CarImport] mobile.de: vip-price-label niet gevonden");
      return null;
    }

    // --- Kilometerstand ---
    // [data-testid="mileage-item"] → wrapper-div, label+waarde aaneengesloten
    const mileageRaw = readItemValue("mileage-item", ["Kilometerstand", "Mileage"]);
    const mileage = mileageRaw ? parseNumber(mileageRaw) : null;

    // --- Vermogen ---
    // [data-testid="power-item"] → <dt> in technische-data <dl>; <dd> is nextElementSibling
    // Waarde: "115 kW 156 PS"
    const powerRaw = readItemValue("power-item", ["Leistung", "Power"]);
    const powerKw = parsePowerKw(powerRaw);

    // --- Brandstof ---
    // Voorkeur: [data-testid="envkv.engineType-item"] → "AntriebsartVerbrennungsmotor" / "Elektromotor"
    // Fallback : [data-testid="fuel-item"]           → "KraftstoffartDiesel"
    const engineRaw =
      readItemValue("envkv.engineType-item", ["Antriebsart"]) ??
      readItemValue("fuel-item", ["Kraftstoffart", "Fuel type"]);
    const fuelType = normalizeFuelType(engineRaw);

    // --- CO2 ---
    // [data-testid="envkv.co2Emissions-item"] → "CO\u2082-Emissionen (komb.)\u00b2143\u00a0g/km"
    // Na cleanText (sup verwijderd): "CO\u2082-Emissionen (komb.) 143 g/km"
    const co2Raw = readItemValue("envkv.co2Emissions-item", [
      "CO\u2082-Emissionen (komb.)",
      "CO2-Emissionen",
      "CO2",
    ]);
    const co2Scraped = co2Raw ? parseNumber(co2Raw) : null;

    // --- Eerste registratie ---
    // [data-testid="firstRegistration-item"] → <dt> in technische-data <dl>
    // <dd> bevat: "052018" (aaneengesloten) of "05/2018"
    let firstRegDate = null;
    const regRaw = readItemValue("firstRegistration-item", [
      "Erstzulassung",
      "First registration",
    ]);
    if (regRaw) {
      // Formaat uit <dd>: "052018" (geen scheidingsteken) of "05/2018" of "05.2018"
      const m = regRaw.match(/(\d{1,2})[\/.\-]?(\d{4})/);
      if (m) {
        firstRegDate = { value: `${m[1].padStart(2, "0")}/${m[2]}`, unit: "MM/YYYY" };
      }
    }
    // Fallback: zoek in paginatekst naar "EZ MM/YYYY"
    if (!firstRegDate) {
      const ezM = document.body.innerText.match(/EZ\s+(\d{2}\/\d{4})/);
      if (ezM) firstRegDate = { value: ezM[1], unit: "MM/YYYY" };
    }

    // --- Euro-norm ---
    // [data-testid="emissionClass-item"] → <dt> in technische-data <dl>
    // <dd> bevat: "Euro6"
    const euroRaw = readItemValue("emissionClass-item", [
      "Schadstoffklasse",
      "Emission class",
    ]);
    // Normaliseer naar "Euro6" / "Euro5" etc.
    const euroNorm = euroRaw
      ? (euroRaw.match(/Euro\s*\d[a-z]?/i)?.[0] ?? null)
      : null;

    // --- Umweltplakette ---
    // [data-testid="emissionsSticker-item"] → <dt> in technische-data <dl>
    // <dd> bevat: "4 Grün" — wordt gebruikt door de CO2-schatting via euroNorm
    // (geen apart veld nodig; euroNorm is leidend voor de berekening)

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
    };

    console.log("[CarImport] ListingInfo (mobile.de):", listing);
    return listing;
  }

  // ---------------------------------------------------------------------------
  // Zoekpagina — suchen.mobile.de/fahrzeuge/search.html
  // ---------------------------------------------------------------------------

  /**
   * Parseer de listing-details-attributes tekst van een zoekkaart.
   * Formaat: "Unfallfrei • EZ 10/2013 • 102.696 km • 162 kW (220 PS) • Benzin"
   */
  function parseAttributesText(text) {
    if (!text) return {};
    const result = {};

    // Eerste registratie
    const ezM = text.match(/EZ\s+(\d{1,2}[\/.\-]\d{4})/);
    if (ezM) {
      const norm = ezM[1].replace(/[.\-]/, "/");
      result.firstRegDate = { value: norm, unit: "MM/YYYY" };
    }

    // Kilometerstand
    const kmM = text.match(/(\d[\d.,]*)\s*km\b/i);
    if (kmM) result.mileage = { value: parseNumber(kmM[1]), unit: "km" };

    // Vermogen
    const kwM = text.match(/(\d+)\s*kW/);
    if (kwM) result.powerKw = { value: parseInt(kwM[1], 10), unit: "kW" };

    // Brandstof
    const fuelM = text.match(
      /\b(Benzin|Diesel|Elektro|Hybrid|PHEV|Plug-in|Wasserstoff)\b/i,
    );
    if (fuelM) result.fuelType = { value: normalizeFuelType(fuelM[1]) };

    return result;
  }

  function scrapeSearchPage() {
    /**
     * Mobile.de zoekkaarten: <a data-testid="result-listing-N">
     * N loopt van 1 oplopend. Afbeeldingcontainers heten result-listing-image-N.
     * We filteren op exact patroon /^result-listing-\d+$/ om die uit te sluiten.
     */
    const cards = Array.from(
      document.querySelectorAll('[data-testid^="result-listing-"]'),
    ).filter((el) =>
      /^result-listing-\d+$/.test(el.getAttribute("data-testid")),
    );

    if (!cards.length) {
      console.warn("[CarImport] mobile.de: geen result-listing-N kaarten gevonden");
      return null;
    }

    console.log(`[CarImport] mobile.de: ${cards.length} kaarten gevonden`);

    const results = [];
    for (const card of cards) {
      // Prijs
      const priceEl = card.querySelector('[data-testid="price-label"]');
      const price = parsePrice(priceEl ? cleanText(priceEl) : null);
      if (!price) continue;

      // Kenmerken
      const attrsEl = card.querySelector(
        '[data-testid="listing-details-attributes"]',
      );
      const attrsText = attrsEl ? cleanText(attrsEl) : "";
      const attrs = parseAttributesText(attrsText);

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
      });
    }

    console.log(
      `[CarImport] mobile.de: ${results.length} resultaten met prijs`,
    );
    return results.length ? results : null;
  }

  root.CIC_MDE = { scrapeListingPage, scrapeSearchPage };

})(window);
