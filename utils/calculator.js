/**
 * Import kostenberekening — meerdere bestemmingslanden
 *
 * Ondersteunde landen:
 *   NL — Nederland (BPM + BTW 21% + invoerrechten)
 *   BE — België    (TMC + BTW 21% + invoerrechten)
 *   DE — Duitsland (BTW 19%, geen extra registratiebelasting)
 *
 * @param {object} p
 * @param {number} p.price
 * @param {number} p.year
 * @param {'petrol'|'diesel'|'electric'|'hybrid'} p.fuelType
 * @param {number|null} p.co2              - CO2 g/km (optioneel, voor nauwkeurigere BPM/TMC)
 * @param {'NL'|'BE'|'DE'} p.destinationCountry
 */
export function calculateImportCosts({ price, year, fuelType, co2 = null, destinationCountry = 'NL' }) {
  const calculators = { NL: calcNL, BE: calcBE, DE: calcDE };
  const calc = calculators[destinationCountry] ?? calcNL;
  return calc({ price, year, fuelType, co2 });
}

// ---------------------------------------------------------------------------
// Nederland
// ---------------------------------------------------------------------------
function calcNL({ price, year, fuelType, co2 }) {
  const age = new Date().getFullYear() - year;

  // BPM — vereenvoudigd (CO2-tabel benaderd)
  // Werkelijke BPM: https://www.rdw.nl/particulier/voertuigen/auto/bpm
  let bpmBase = 0;
  if (fuelType === 'electric') {
    bpmBase = 0;
  } else if (co2) {
    // Benaderd lineair model op basis van CO2
    bpmBase = co2 > 120 ? price * 0.22 : price * 0.14;
  } else {
    bpmBase = fuelType === 'diesel' ? price * 0.20 : price * 0.17;
  }
  const depreciation = Math.min(age * 0.06, 0.90);
  const bpm = Math.round(bpmBase * (1 - depreciation));

  // Invoerrechten: 6.5% (buiten EU), 0% (binnen EU)
  // Aanname: buiten EU import — pas aan via instellingen
  const importDutyRate = 6.5;
  const importDuty = Math.round(price * (importDutyRate / 100));

  // BTW 21% over prijs + invoerrechten
  const vatRate = 21;
  const vat = Math.round((price + importDuty) * (vatRate / 100));

  const total = price + bpm + importDuty + vat;

  return {
    price,
    bpm,
    importDuty, importDutyRate,
    vat, vatRate, vatLabel: 'BTW',
    roadsideTax: null,
    total: Math.round(total),
    disclaimer: '* BPM is een schatting op basis van aankoopprijs. Werkelijke BPM is CO₂-gebaseerd (RDW).',
  };
}

// ---------------------------------------------------------------------------
// België
// ---------------------------------------------------------------------------
function calcBE({ price, year, fuelType, co2 }) {
  const age = new Date().getFullYear() - year;

  // TMC (Taxe de Mise en Circulation / Belasting op Inverkeerstelling)
  // Berekend op fiscale PK, hier benaderd op prijs + leeftijd
  // Bron: https://financien.belgium.be/nl/particulieren/auto/taks_inverkeersstelling
  let tmcBase = 0;
  if (fuelType === 'electric') {
    tmcBase = 0; // EV vrijgesteld
  } else {
    // Benaderd: ~€61.50 per fiscale PK, gemiddeld auto ~10 PK fiscaal
    tmcBase = price * 0.04; // grove schatting ~4% van aankoopprijs
  }
  const depreciation = Math.min(age * 0.05, 0.85);
  const tmc = Math.round(tmcBase * (1 - depreciation));

  // Invoerrechten: 6.5% buiten EU
  const importDutyRate = 6.5;
  const importDuty = Math.round(price * (importDutyRate / 100));

  // BTW 21%
  const vatRate = 21;
  const vat = Math.round((price + importDuty) * (vatRate / 100));

  const total = price + tmc + importDuty + vat;

  return {
    price,
    bpm: 0,
    importDuty, importDutyRate,
    vat, vatRate, vatLabel: 'BTW',
    roadsideTax: tmc,
    roadsideTaxLabel: 'TMC (Belasting IVK)',
    total: Math.round(total),
    disclaimer: '* TMC is benaderd op basis van aankoopprijs. Exacte TMC hangt af van fiscale PK.',
  };
}

// ---------------------------------------------------------------------------
// Duitsland
// ---------------------------------------------------------------------------
function calcDE({ price, year, fuelType }) {
  // In Duitsland geen registratiebelasting of BPM equivalent.
  // Wel BTW (19%) bij import buiten EU.
  const importDutyRate = 6.5;
  const importDuty = Math.round(price * (importDutyRate / 100));

  const vatRate = 19;
  const vat = Math.round((price + importDuty) * (vatRate / 100));

  const total = price + importDuty + vat;

  return {
    price,
    bpm: 0,
    importDuty, importDutyRate,
    vat, vatRate, vatLabel: 'MwSt',
    roadsideTax: null,
    total: Math.round(total),
    disclaimer: '* Geen registratiebelasting in Duitsland. Alleen invoerrechten + MwSt.',
  };
}
