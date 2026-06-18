/**
 * BPM + BTW + invoerrechten berekening voor import naar Nederland.
 *
 * BPM wordt berekend op basis van CO₂-uitstoot (g/km) en brandstoftype,
 * conform de Nederlandse BPM-tabel 2024/2025.
 *
 * Bronnen:
 *   https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/auto_en_vervoer/belastingen_op_auto_en_motor/bpm/
 *   https://www.autoweek.nl/autonieuws/algemeen/a47264/bpm-tabel-2024/
 *
 * @param {{ price, year, fuelType, co2 }} carData
 * @param {{ originIsOutsideEU }} settings
 */
export function calculateImportCosts(carData, settings = {}) {
  const { price, year, fuelType, co2 } = carData;
  const originIsOutsideEU = settings.originIsOutsideEU ?? true;

  // --- Invoerrechten ---
  // 6.5% voor personenwagens van buiten de EU (GN-code 8703)
  // 0% voor EU-oorsprong
  const importDutyRate = originIsOutsideEU ? 6.5 : 0;
  const importDuty = Math.round(price * (importDutyRate / 100));

  // --- BTW ---
  // 21% over aankoopprijs + invoerrechten
  const vatBase = price + importDuty;
  const vat = Math.round(vatBase * 0.21);

  // --- BPM ---
  const bpm = calcBPM({ price, year, fuelType, co2 });

  const total = price + importDuty + vat + bpm;

  return {
    price,
    importDuty,
    importDutyRate,
    vat,
    bpm,
    total: Math.round(total),
  };
}

// ---------------------------------------------------------------------------
// BPM berekening
// ---------------------------------------------------------------------------

/**
 * Berekent BPM op basis van CO₂ g/km en brandstoftype.
 *
 * Methode:
 *   1. Bepaal de BPM-grondslag via de CO₂-staffel
 *   2. Pas de leeftijdsafschrijving toe (vaste tabel RDW)
 *
 * Als CO₂ niet bekend is, wordt een conservatieve schatting gebruikt.
 */
function calcBPM({ price, year, fuelType, co2 }) {
  if (fuelType === 'electric') return 0; // EV volledig vrijgesteld

  const currentYear = new Date().getFullYear();
  const age = Math.max(0, currentYear - (year ?? currentYear));

  // CO₂-staffel BPM 2025 (benaderd lineair model)
  // Bron: Autoweek BPM-tabel + Belastingdienst
  const co2Value = co2 ?? estimateCO2(fuelType); // fallback als CO₂ onbekend
  const bpmGross = co2ToBPM(co2Value, fuelType);

  // Leeftijdsafschrijving (vaste tabel, benaderd)
  // 0 jaar = 0%, 1 jaar ≈ 9%, oplopend tot max 90%
  const depreciation = getDepreciation(age);

  return Math.round(bpmGross * (1 - depreciation));
}

/**
 * CO₂ → bruto BPM bedrag (2025 staffel)
 * Benzine en hybride: zelfde tabel
 * Diesel: toeslag van ~€90 per 100km/l (vereenvoudigd: +15%)
 */
function co2ToBPM(co2, fuelType) {
  // Vereenvoudigde lineaire staffel:
  //   0–82 g/km:   €0
  //   83–100 g/km: €4 per g/km boven 82
  //  101–150 g/km: €7 per g/km boven 100
  //  151+ g/km:   €18 per g/km boven 150
  let bpm = 0;

  if (co2 > 150) {
    bpm += (co2 - 150) * 18;
    bpm += (150 - 100) * 7;
    bpm += (100 - 82) * 4;
  } else if (co2 > 100) {
    bpm += (co2 - 100) * 7;
    bpm += (100 - 82) * 4;
  } else if (co2 > 82) {
    bpm += (co2 - 82) * 4;
  }

  // Dieseltoeslag
  if (fuelType === 'diesel') bpm = Math.round(bpm * 1.15);

  return bpm;
}

/**
 * Schatting van CO₂ als het niet beschikbaar is.
 * Conservatief (hoog) om de gebruiker niet te verrassen.
 */
function estimateCO2(fuelType) {
  const estimates = { petrol: 145, diesel: 155, hybrid: 110, electric: 0 };
  return estimates[fuelType] ?? 145;
}

/**
 * Leeftijdsafschrijving BPM (benaderd op basis van RDW-tabel).
 * Werkelijke tabel: https://www.rdw.nl/zakelijk/voertuigen/registreren/bpm
 */
function getDepreciation(ageYears) {
  // Eerste 5 jaar snel afschrijven, daarna afvlakken tot max 90%
  const table = [0, 0.09, 0.17, 0.25, 0.33, 0.41, 0.50, 0.57, 0.63, 0.68, 0.73, 0.77, 0.81, 0.84, 0.87, 0.90];
  const idx = Math.min(ageYears, table.length - 1);
  return table[idx];
}
