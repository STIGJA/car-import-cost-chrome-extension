/**
 * nl-import.js — Berekening importkosten Nederland (EU-scope)
 *
 * Aannames:
 *   - Auto is altijd binnen de EU gekocht → geen invoerrechten
 *   - BTW (21%) alleen bij nieuwe auto's (<6 maanden na eerste registratie)
 *   - BPM o.b.v. CO2-staffel 2026 met forfaitaire afschrijving
 *
 * Input:  ListingInfo  (zie sites/autoscout24.js)
 * Output: ImportResult (geordende list van kostenposten)
 *
 * Geëxporteerd als window.CIC_NL.calculate(listingInfo, settings)
 *
 * Afhankelijkheden:
 *   window.CIC_BPM  (utils/bpm.js — via manifest content_scripts)
 */

'use strict';

(function (root) {
  function parseDate(firstRegDate) {
    if (!firstRegDate) return null;
    const parts = String(firstRegDate).match(/(\d{1,2})[\/-](\d{4})/);
    if (parts) return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, 1);
    const d = new Date(firstRegDate);
    return isNaN(d) ? null : d;
  }

  function ageMonths(firstRegDate) {
    const d = parseDate(firstRegDate);
    if (!d) return null;
    return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  }

  function ageYears(firstRegDate) {
    const months = ageMonths(firstRegDate);
    return months != null ? months / 12 : 3;
  }

  /**
   * @param {ListingInfo} listing
   * @param {object} settings
   * @returns {ImportResult}
   */
  function calculate(listing, settings = {}) {
    const { bpmBruto, bpmNetto, estimateCO2 } = root.CIC_BPM;

    const price    = listing.price.value;
    const fuelType = listing.fuelType.value;
    const firstReg = listing.firstRegDate?.value ?? null;

    const co2          = listing.co2.value ?? estimateCO2(fuelType, listing.year?.value);
    const co2Estimated = listing.co2.source === 'estimated' || listing.co2.value == null;
    const co2Method    = listing.co2.method ?? null;

    const months   = ageMonths(firstReg);
    const isNew    = months != null && months < 6;
    const years    = ageYears(firstReg);

    const vat      = isNew ? Math.round(price * 0.21) : 0;
    const gross    = bpmBruto(co2, fuelType);
    const bpm      = bpmNetto(co2, fuelType, years);
    const total    = Math.round(price + vat + bpm);

    return {
      settings: {
        country: { value: 'NL', label: 'Bestemmingsland' },
      },
      lineItems: [
        {
          key: 'price', label: 'Vraagprijs',
          value: price, unit: 'EUR', included: true,
        },
        {
          key: 'vat', label: 'BTW (21%)',
          value: vat, unit: 'EUR', included: isNew,
          reason: !isNew ? 'Niet van toepassing (gebruikte auto)' : null,
        },
        {
          key: 'bpm', label: 'BPM',
          value: bpm, unit: 'EUR', included: bpm > 0,
          note: bpm > 0 ? {
            valueTooltip: `o.b.v. ${co2}\u00a0g/km CO\u2082 (bruto \u20ac${gross.toLocaleString('nl-NL')})`,
            warning: co2Estimated
              ? `CO\u2082 niet gevonden op pagina \u2014 geschat via ${co2Method ?? 'bouwjaar'}`
              : null,
          } : null,
        },
        {
          key: 'total', label: 'Totaal',
          value: total, unit: 'EUR', included: true, isTotal: true,
        },
      ],
    };
  }

  root.CIC_NL = { calculate };
})(window);
