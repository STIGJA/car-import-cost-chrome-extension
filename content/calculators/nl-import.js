/**
 * nl-import.js — Berekening importkosten Nederland
 *
 * Input:  ListingInfo  (zie sites/autoscout24.js voor de shape)
 * Output: ImportResult (geordende list van kostenposten)
 *
 * Geëxporteerd als window.CIC_NL.calculate(listingInfo, settings)
 *
 * Afhankelijkheden (moeten eerder geladen zijn):
 *   window.CIC_Lookups      (co2-lookup.js)
 *   window.CIC_Depreciation (depreciation.js)
 */

'use strict';

(function (root) {
  // -------------------------------------------------------------------------
  // BPM CO2-staffel 2025
  // Bron: Belastingdienst — Tabel BPM personenauto's 2025
  // Brackets zijn cumulatief: elke schijf berekent het deel boven de grens.
  //
  //   0  –  82 g/km : €  0 / g
  //  82  – 100 g/km : €  4 / g
  // 100  – 150 g/km : €  7 / g
  // 150+      g/km  : € 18 / g
  //
  // Dieseltoeslag: factor 1.15 over het totale BPM-bedrag
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
      if (co2 > from) {
        bpm += (Math.min(co2, to) - from) * rate;
      }
    }
    if (fuelType === 'diesel') bpm = Math.round(bpm * DIESEL_SURCHARGE);
    return Math.round(bpm);
  }

  // BTW (21%) is alleen van toepassing bij auto's jonger dan 6 maanden
  function isNewCar(firstRegDate) {
    if (!firstRegDate) return false;
    let d;
    if (firstRegDate instanceof Date) {
      d = firstRegDate;
    } else {
      const parts = String(firstRegDate).match(/(\d{1,2})[\/-](\d{4})/);
      if (parts) d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, 1);
      else d = new Date(firstRegDate);
    }
    if (isNaN(d)) return false;
    const ageMonths = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    return ageMonths < 6;
  }

  function getAgeYears(firstRegDate) {
    if (!firstRegDate) return 3; // veilige standaard
    let d;
    const parts = String(firstRegDate).match(/(\d{1,2})[\/-](\d{4})/);
    if (parts) d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, 1);
    else d = new Date(firstRegDate);
    if (isNaN(d)) return 3;
    return Math.max(0, (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  }

  /**
   * @param {ListingInfo} listing
   * @param {{ originIsOutsideEU: boolean }} settings
   * @returns {ImportResult}
   */
  function calculate(listing, settings = {}) {
    const outsideEU      = settings.originIsOutsideEU ?? true;
    const importDutyRate = outsideEU ? 6.5 : 0;

    const price      = listing.price.value;
    const fuelType   = listing.fuelType.value;
    const firstReg   = listing.firstRegDate?.value ?? null;

    // CO2: gebruik gescrapete waarde of schatting
    let co2, co2IsEstimated, co2Method, co2Confidence;
    if (listing.co2.source === 'scraped') {
      co2              = listing.co2.value;
      co2IsEstimated   = false;
      co2Method        = null;
      co2Confidence    = 'scraped';
    } else {
      co2              = listing.co2.value;
      co2IsEstimated   = true;
      co2Method        = listing.co2.method;
      co2Confidence    = listing.co2.confidence;
    }

    const importDuty = Math.round(price * importDutyRate / 100);
    const newCar     = isNewCar(firstReg);
    const vat        = newCar ? Math.round((price + importDuty) * 0.21) : 0;

    const ageYears   = getAgeYears(firstReg);
    const bpmGross   = fuelType === 'electric' ? 0 : co2ToBPM(co2, fuelType);
    const bpm        = Math.round(bpmGross * (1 - root.CIC_Depreciation.getFactor(ageYears)));

    const total      = Math.round(price + importDuty + vat + bpm);

    /** @type {ImportResult} */
    return {
      settings: {
        originIsOutsideEU: { value: outsideEU,  label: 'Buiten EU',          type: 'boolean' },
        country:           { value: 'NL',        label: 'Bestemmingsland' },
      },
      lineItems: [
        {
          key:      'price',
          label:    'Vraagprijs',
          value:    price,
          unit:     'EUR',
          included: true,
        },
        {
          key:      'importDuty',
          label:    `Invoerrechten (${importDutyRate}%)`,
          value:    importDuty,
          unit:     'EUR',
          included: importDuty > 0,
          reason:   importDuty === 0 ? 'Niet van toepassing (auto binnen EU gekocht)' : null,
        },
        {
          key:      'vat',
          label:    'BTW (21%)',
          value:    vat,
          unit:     'EUR',
          included: newCar,
          reason:   !newCar ? 'Niet van toepassing (gebruikte auto, marge-regeling)' : null,
        },
        {
          key:      'bpm',
          label:    'BPM',
          value:    bpm,
          unit:     'EUR',
          included: bpm > 0,
          note: bpm > 0 ? {
            text:    `o.b.v. ${co2}\u00a0g/km CO\u2082`,
            warning: co2IsEstimated
              ? `CO\u2082 niet gevonden op pagina \u2014 geschat via ${co2Method}`
              : null,
          } : null,
        },
        {
          key:      'total',
          label:    'Totaal',
          value:    total,
          unit:     'EUR',
          included: true,
          isTotal:  true,
        },
      ],
    };
  }

  root.CIC_NL = { calculate };
})(window);
