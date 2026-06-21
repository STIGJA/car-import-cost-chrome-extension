/**
 * nl-import.js — Berekening importkosten Nederland (EU-scope)
 *
 * Afhankelijkheden (via window globals, geladen vóór dit script):
 *   window.CIC_BPM    — utils/bpm.js        (bpmBruto, bpmNetto)
 *   window.CIC_Lookups — content/lookups/co2-lookup.js (estimateCO2)
 */

'use strict';

(function (root) {

  const DEFAULT_FIXED_COSTS = 170;
  const DEFAULT_TRANSPORT_BY_COUNTRY = {
    DE: 350, BE: 150, FR: 500, IT: 900,
    ES: 950, AT: 450, CH: 500, PL: 400, OTHER: 600,
  };

  // ---------------------------------------------------------------------------
  // Date helpers
  // ---------------------------------------------------------------------------
  function parseDate(v) {
    if (!v) return null;
    const p = String(v).match(/(\d{1,2})[\/-](\d{4})/);
    if (p) return new Date(parseInt(p[2]), parseInt(p[1]) - 1, 1);
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  function ageMonthsFrom(v) {
    const d = parseDate(v);
    return d ? (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44) : null;
  }
  function ageYearsFrom(v) {
    const m = ageMonthsFrom(v);
    return m != null ? m / 12 : 3;
  }

  // ---------------------------------------------------------------------------
  // Transport lookup
  // ---------------------------------------------------------------------------
  function getTransportCost(country, transportByCountry) {
    const map = transportByCountry ?? DEFAULT_TRANSPORT_BY_COUNTRY;
    return map[country] ?? map['OTHER'] ?? 600;
  }

  // ---------------------------------------------------------------------------
  // Resolve dependencies at call time (not at parse time) so load order
  // doesn't matter as long as all scripts are loaded before calculate() runs.
  // ---------------------------------------------------------------------------
  function getBPM() {
    const bpm = root.CIC_BPM;
    if (!bpm) throw new Error('[CarImport] CIC_BPM niet geladen — controleer manifest script-volgorde.');
    return bpm;
  }

  function getEstimateCO2() {
    // estimateCO2 lives in CIC_Lookups in content scripts
    const fn = root.CIC_Lookups?.estimateCO2 ?? root.CIC_BPM?.estimateCO2;
    if (!fn) throw new Error('[CarImport] estimateCO2 niet beschikbaar.');
    return fn;
  }

  // ---------------------------------------------------------------------------
  // Main
  // ---------------------------------------------------------------------------
  function calculate(listing, settings = {}) {
    try {
      const { bpmBruto, bpmNetto } = getBPM();
      const estimateCO2            = getEstimateCO2();

      const price      = listing.price.value;
      const fuelType   = listing.fuelType.value;
      const firstReg   = listing.firstRegDate?.value ?? null;
      const carCountry = listing.country ?? 'DE';
      const fixedCosts = settings.fixedCosts ?? DEFAULT_FIXED_COSTS;
      const transport  = getTransportCost(carCountry, settings.transportByCountry);

      // CO2: use scraped value when available, otherwise estimate
      let co2, co2Estimated, co2Method;
      if (listing.co2?.value && listing.co2.value > 0) {
        co2          = listing.co2.value;
        co2Estimated = listing.co2.source === 'estimated';
        co2Method    = listing.co2.method ?? null;
      } else {
        const year = firstReg ? parseInt(firstReg.match(/\d{4}/)?.[0]) : null;
        const est  = estimateCO2({ fuelType, year });
        co2          = est.co2 ?? est;   // estimateCO2 may return a number or { co2 }
        co2Estimated = true;
        co2Method    = est.method ?? null;
      }

      const months = ageMonthsFrom(firstReg);
      const isNew  = months != null && months < 6;
      const years  = ageYearsFrom(firstReg);

      const vat   = isNew ? Math.round(price * 0.21) : 0;
      const gross = bpmBruto(co2, fuelType);
      const bpm   = bpmNetto(co2, fuelType, years);
      const total = Math.round(price + vat + bpm + transport + fixedCosts);

      return {
        settings: { country: { value: 'NL', label: 'Bestemmingsland' } },
        lineItems: [
          { key: 'price',      label: 'Vraagprijs',             value: price,      unit: 'EUR', included: true },
          { key: 'vat',        label: 'BTW (21%)',               value: vat,        unit: 'EUR', included: isNew },
          {
            key: 'bpm', label: 'BPM', value: bpm, unit: 'EUR', included: bpm > 0,
            note: bpm > 0 ? {
              valueTooltip: `o.b.v. ${co2}\u00a0g/km CO\u2082 (bruto \u20ac${gross.toLocaleString('nl-NL')})`,
              warning: co2Estimated
                ? `CO\u2082 niet gevonden — geschat via ${co2Method ?? 'bouwjaar'}`
                : null,
            } : null,
          },
          { key: 'transport',  label: 'Transport',               value: transport,  unit: 'EUR', included: true },
          { key: 'fixedCosts', label: 'Vaste kosten (RDW e.d.)', value: fixedCosts, unit: 'EUR', included: true },
          { key: 'total',      label: 'Totaal',                  value: total,      unit: 'EUR', included: true, isTotal: true },
        ],
      };
    } catch (err) {
      console.error('[CarImport] calculate() gefaald:', err);
      return null;
    }
  }

  root.CIC_NL = { calculate };
})(window);
