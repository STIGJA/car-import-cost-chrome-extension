/**
 * nl-import.js — Berekening importkosten Nederland (EU-scope)
 *
 * Aannames:
 *   - Auto is altijd binnen de EU gekocht → geen invoerrechten
 *   - BTW (21%) alleen bij nieuwe auto's (<6 maanden na eerste registratie)
 *   - BPM o.b.v. CO2-staffel 2025 met afschrijving
 *
 * Input:  ListingInfo  (zie sites/autoscout24.js)
 * Output: ImportResult (geordende list van kostenposten)
 *
 * Geëxporteerd als window.CIC_NL.calculate(listingInfo, settings)
 *
 * Afhankelijkheden:
 *   window.CIC_Depreciation (depreciation.js)
 */

'use strict';

(function (root) {
  // -------------------------------------------------------------------------
  // BPM CO2-staffel 2025 (Belastingdienst)
  // Brackets zijn cumulatief; elke schijf telt het deel boven de ondergrens.
  //   0  –  82 g/km : €  0 / g
  //  82  – 100 g/km : €  4 / g
  // 100  – 150 g/km : €  7 / g
  // 150+      g/km  : € 18 / g
  // Dieseltoeslag: ×1.15 over het totale BPM-bedrag
  // -------------------------------------------------------------------------
  const BPM_BRACKETS = [
    { from:   0, to:  82, rate:  0 },
    { from:  82, to: 100, rate:  4 },
    { from: 100, to: 150, rate:  7 },
    { from: 150, to: Infinity, rate: 18 },
  ];
  const DIESEL_SURCHARGE = 1.15;

  function co2ToBPM(co2, fuelType) {
    let bpm = 0;
    for (const { from, to, rate } of BPM_BRACKETS) {
      if (co2 > from) bpm += (Math.min(co2, to) - from) * rate;
    }
    if (fuelType === 'diesel') bpm = Math.round(bpm * DIESEL_SURCHARGE);
    return Math.round(bpm);
  }

  // BTW alleen bij auto jonger dan 6 maanden
  function isNewCar(firstRegDate) {
    if (!firstRegDate) return false;
    let d;
    const parts = String(firstRegDate).match(/(\d{1,2})[\/-](\d{4})/);
    if (parts) d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, 1);
    else d = new Date(firstRegDate);
    if (isNaN(d)) return false;
    return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44) < 6;
  }

  function getAgeYears(firstRegDate) {
    if (!firstRegDate) return 3;
    let d;
    const parts = String(firstRegDate).match(/(\d{1,2})[\/-](\d{4})/);
    if (parts) d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, 1);
    else d = new Date(firstRegDate);
    if (isNaN(d)) return 3;
    return Math.max(0, (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  }

  /**
   * @param {ListingInfo} listing
   * @param {object} settings  (momenteel ongebruikt, klaarstaan voor toekomstige opties)
   * @returns {ImportResult}
   */
  function calculate(listing, settings = {}) {
    const price    = listing.price.value;
    const fuelType = listing.fuelType.value;
    const firstReg = listing.firstRegDate?.value ?? null;

    const co2          = listing.co2.value;
    const co2Estimated = listing.co2.source === 'estimated';
    const co2Method    = listing.co2.method ?? null;

    const newCar   = isNewCar(firstReg);
    const vat      = newCar ? Math.round(price * 0.21) : 0;

    const ageYears = getAgeYears(firstReg);
    const bpmGross = fuelType === 'electric' ? 0 : co2ToBPM(co2, fuelType);
    const bpm      = Math.round(bpmGross * (1 - root.CIC_Depreciation.getFactor(ageYears)));
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
          value: vat, unit: 'EUR', included: newCar,
          reason: !newCar ? 'Niet van toepassing (gebruikte auto, marge-regeling)' : null,
        },
        {
          key: 'bpm', label: 'BPM',
          value: bpm, unit: 'EUR', included: bpm > 0,
          note: bpm > 0 ? {
            // CO2-basis staat als tooltip op de waarde-cel, niet in de label
            valueTooltip: `o.b.v. ${co2}\u00a0g/km CO\u2082`,
            warning: co2Estimated
              ? `CO\u2082 niet gevonden op pagina \u2014 geschat via ${co2Method}`
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
