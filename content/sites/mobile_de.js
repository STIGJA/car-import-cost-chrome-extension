/**
 * mobile_de.js — Scraper voor Mobile.de
 *
 * Geverifieerde selectors via Wayback Machine snapshot (dec 2025 / feb 2026):
 *
 * ZOEKPAGINA (suchen.mobile.de/fahrzeuge/search.html):
 *   Kaart container : <a data-testid="result-listing-{N}">  (N = 1, 2, 3, ...)
 *   → Selector       : [data-testid^="result-listing-"]:not([data-testid*="image"])
 *   Prijs            : [data-testid="price-label"]  bijv. "14.990 €"
 *   Kenmerken        : [data-testid="listing-details-attributes"] plain tekst:
 *                      "Unfallfrei • EZ 10/2013 • 102.696 km • 162 kW (220 PS) • Benzin"
 *
 * DETAILPAGINA (suchen.mobile.de/fahrzeuge/details.html?id=XXXXX):
 *   isListing URL    : hostname === 'suchen.mobile.de' && path.startsWith('/fahrzeuge/details.html')
 *   Prijs            : [data-testid="vip-price-label"]  bijv. "27.980 €"
 *   Kilometerstand   : [data-testid="mileage-item"]     tekst: "Kilometerstand 0 km"
 *   Vermogen         : [data-testid="power-item"]        tekst: "Leistung 125 kW (170 PS)"
 *   Brandstof/motor  : [data-testid="envkv.engineType-item"] tekst: "Antriebsart Elektromotor"
 *                      (fallback: [data-testid="listing-details-attributes"] op zoekkaart)
 *   CO2              : [data-testid="envkv.co2Emissions-item"] tekst bevat g/km
 *   Locatie postcode : [data-testid="vip-dealer-box-seller-address2"] bijv. "DE-51379 Leverkusen"
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
    // Verwijder superscripts (¹²³), BTW-voetnoten achteraan, non-numeriek
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
   * Leest de tekst van een element maar stript superscripts/voetnoten.
   * Mobile.de plaatst ² achter CO2-waarden als wettelijke voetnoot.
   */
  function cleanText(el) {
    if (!el) return "";
    // Verwijder <sup> en <button> kinderen (voetnoot-nummers en info-buttons)
    const clone = el.cloneNode(true);
    clone.querySelectorAll("sup, button, svg").forEach(n => n.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
  }

  /**
   * Leest de value uit een *-item element.
   * De structuur is: <dt>Label</dt><dd>Waarde</dd> OF
   *                  data-testid="X-item" met label+waarde als eerste tekst.
   * Mobile.de patroon: "Label Waarde" als directe tekst van het item-element.
   * We knippen de label weg door te splitsen op het eerste cijfer of na een
   * bekende label-string.
   */
  function readItem(testid) {
    const el = document.querySelector(`[data-testid="${testid}"]`);
    if (!el) return null;
    // Zoek eerst een <dd> binnen het item
    const dd = el.querySelector("dd");
    if (dd) return cleanText(dd);
    // Zoek dt/dd op broer-niveau
    const dt = el.querySelector("dt");
    if (dt && dt.nextElementSibling && dt.nextElementSibling.tagName === "DD") {
      return cleanText(dt.nextElementSibling);
    }
    // Fallback: de gehele tekst van het element (label + waarde)
    return cleanText(el);
  }

  /**
   * Mobile.de *-item patroon: de container bevat "Label Waarde" als platte tekst.
   * De label staat ook als data-testid prefix. We extraheren de waarde door
   * de bekende labelstring weg te knippen.
   */
  function extractValueFromItem(testid, labelWords) {
    const raw = readItem(testid);
    if (!raw) return null;
    let val = raw;
    for (const lw of labelWords) {
      const idx = val.indexOf(lw);
      if (idx !== -1) {
        val = val.slice(idx + lw.length).trim();
        break;
      }
    }
    return val || null;
  }

  function normalizeFuelType(raw) {
    if (!raw) return "petrol";
    const l = raw.toLowerCase();
    if (/elektromotor|elektro|\bbev\b|\bev\b|electric/.test(l)) return "electric";
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
      fuelType, euroNorm: euroNormRaw, powerKw, year,
    });
    if (co2Scraped && co2Scraped > 0) {
      root.CIC_Lookups.checkCO2Deviation(co2Scraped, estimation.co2, null);
      return { value: co2Scraped, unit: "g/km", source: "scraped", method: null, confidence: "scraped" };
    }
    return { value: estimation.co2, unit: "g/km", source: "estimated", method: estimation.method, confidence: estimation.confidence };
  }

  // ---------------------------------------------------------------------------
  // Detailpagina — suchen.mobile.de/fahrzeuge/details.html?id=XXXXX
  // ---------------------------------------------------------------------------

  function scrapeListingPage() {
    // Prijs
    const priceEl = document.querySelector('[data-testid="vip-price-label"]');
    const price = parsePrice(priceEl ? cleanText(priceEl) : null);
    if (!price) {
      console.warn("[CarImport] mobile.de: vip-price-label niet gevonden");
      return null;
    }

    // Kilometerstand: [data-testid="mileage-item"] → "Kilometerstand 102.696 km"
    const mileageRaw = extractValueFromItem("mileage-item", ["Kilometerstand", "Mileage"]);
    const mileage = parseNumber(mileageRaw);

    // Vermogen: [data-testid="power-item"] → "Leistung 125 kW (170 PS)"
    const powerRaw = extractValueFromItem("power-item", ["Leistung", "Power"]);
    const powerKw = parsePowerKw(powerRaw);

    // Brandstof / motortype: [data-testid="envkv.engineType-item"] → "Antriebsart Elektromotor"
    const engineRaw = extractValueFromItem("envkv.engineType-item", ["Antriebsart", "Fuel type", "Fuel"]);
    const fuelType = normalizeFuelType(engineRaw);

    // CO2: [data-testid="envkv.co2Emissions-item"] → "CO₂-Emissionen (komb.) ² 0 g/km"
    const co2Raw = extractValueFromItem("envkv.co2Emissions-item", ["CO₂-Emissionen (komb.)", "CO2", "CO₂"]);
    const co2Scraped = co2Raw ? parseNumber(co2Raw) : null;

    // Eerste registratie: staat als "EZ MM/YYYY" in de key-features of attributes tekst
    // Mobile.de gebruikt geen apart testid voor Erstzulassung op de detailpagina;
    // het staat wel in de listing-details-attributes plain tekst als zoekkaart.
    // Op de VIP pagina proberen we de structured data of de availability sectie.
    let firstRegDate = null;
    const pageText = document.body.innerText;
    const ezM = pageText.match(/EZ\s+(\d{2}\/\d{4})/);
    if (ezM) firstRegDate = { value: ezM[1], unit: "MM/YYYY" };

    // Euro-norm: niet altijd aanwezig op VIP, maar emissionsSticker-item heeft Umweltplakette
    // Euroklasse is te schatten via envkv data
    const euroNorm = null; // wordt geëstimeerd in buildCO2Field

    // Locatie: [data-testid="vip-dealer-box-seller-address2"] → "DE-51379 Leverkusen"
    const addrEl = document.querySelector('[data-testid="vip-dealer-box-seller-address2"]');
    const addrText = addrEl ? cleanText(addrEl) : "";
    // Patroon: "DE-51379 Leverkusen" of gewoon "51379 Leverkusen"
    const postcodeM = addrText.match(/(?:DE-)?\b(\d{4,5})\b/);
    const postcode = postcodeM ? postcodeM[1] : null;
    const country = addrText.includes("DE-") || postcode ? "DE" : null;

    const year = firstRegDate ? parseInt(firstRegDate.value.split("/")[1]) : null;

    const listing = {
      price: { value: price, unit: "EUR" },
      firstRegDate,
      fuelType: { value: fuelType },
      mileage: mileage ? { value: mileage, unit: "km" } : null,
      powerKw: powerKw ? { value: powerKw, unit: "kW" } : null,
      euroNorm,
      co2: buildCO2Field(fuelType, euroNorm, powerKw, year, co2Scraped),
      postcode,
      country,
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
   * Segmenten zijn gescheiden door "•" of via <!-- --> comment nodes in de HTML,
   * maar na tekstextractie is het een gewone bullet-string.
   */
  function parseAttributesText(text) {
    if (!text) return {};
    const result = {};

    // EZ (eerste registratie)
    const ezM = text.match(/EZ\s+(\d{1,2}\/\d{4})/);
    if (ezM) result.firstRegDate = { value: ezM[1], unit: "MM/YYYY" };

    // Kilometerstand (bijv. "102.696 km" of "0 km")
    const kmM = text.match(/(\d[\d.,]*)\s*km\b/i);
    if (kmM) result.mileage = { value: parseNumber(kmM[1]), unit: "km" };

    // Vermogen (bijv. "162 kW" of "162 kW (220 PS)")
    const kwM = text.match(/(\d+)\s*kW/);
    if (kwM) result.powerKw = { value: parseInt(kwM[1], 10), unit: "kW" };

    // Brandstof (laatste woord / keyword)
    const fuelM = text.match(/\b(Benzin|Diesel|Elektro|Hybrid|PHEV|Plug-in|Wasserstoff)\b/i);
    if (fuelM) result.fuelType = { value: normalizeFuelType(fuelM[1]) };

    return result;
  }

  function scrapeSearchPage() {
    /**
     * Mobile.de zoekkaarten zijn <a data-testid="result-listing-N"> elementen.
     * N loopt van 1 oplopend. Image-containers zijn result-listing-image-N.
     * We selecteren alle result-listing-* ZONDER "image" in de testid.
     */
    const cards = Array.from(
      document.querySelectorAll('[data-testid^="result-listing-"]')
    ).filter(el => {
      const tid = el.getAttribute("data-testid");
      // Alleen de kaart-containers, niet de afbeeldingselementen
      return /^result-listing-\d+$/.test(tid);
    });

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

      // Kenmerken uit listing-details-attributes
      const attrsEl = card.querySelector('[data-testid="listing-details-attributes"]');
      const attrsText = attrsEl ? cleanText(attrsEl) : "";
      const attrs = parseAttributesText(attrsText);

      // Locatie uit listing-details-availability OF seller-info tekst
      // Mobile.de toont op zoekkaart de postcode in seller-info: "99189 Gebesee"
      const sellerEl = card.querySelector('[data-testid="seller-info"]') ??
                       card.querySelector('[class*="seller"], [class*="Seller"], [class*="dealer"]');
      const sellerText = sellerEl ? cleanText(sellerEl) : cleanText(card);
      const postcodeM = sellerText.match(/\b(\d{5})\b/);
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
        country: postcode ? "DE" : null,
      });
    }

    console.log(`[CarImport] mobile.de: ${results.length} resultaten met prijs`);
    return results.length ? results : null;
  }

  root.CIC_MDE = { scrapeListingPage, scrapeSearchPage };

})(window);
