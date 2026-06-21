/**
 * calculator.js — BPM + BTW + import duty + transport + fixed costs.
 *
 * BPM is calculated from CO2 emissions (g/km) and fuel type,
 * based on the Dutch BPM table 2024/2025.
 *
 * Transport cost uses the Haversine crow-distance method, mirroring
 * CarImportArbitrageTool/Services/ImportCostCalculator.cs.
 *
 * Sources:
 *   https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/auto_en_vervoer/belastingen_op_auto_en_motor/bpm/
 *   https://www.autoweek.nl/autonieuws/algemeen/a47264/bpm-tabel-2024/
 *
 * @param {{ price, year, fuelType, co2, carPostcode, carCountry }} carData
 * @param {{ originIsOutsideEU, postcode, fixedCosts }} settings
 * @returns {{ lineItems: LineItem[], total: number }}
 */

import { estimateTransportCost, TRANSPORT_DEFAULTS } from './transport.js';
import { SETTING_DEFAULTS } from './settings.js';

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function calculateImportCosts(carData, settings = {}) {
  const { price, year, fuelType, co2, carPostcode, carCountry } = carData;
  const originIsOutsideEU = settings.originIsOutsideEU ?? true;
  const referencePostcode = settings.postcode || TRANSPORT_DEFAULTS.referencePostcode;
  const fixedCosts        = settings.fixedCosts ?? SETTING_DEFAULTS.fixedCosts;

  const lineItems = [];

  // --- Vraagprijs ---
  lineItems.push({ label: 'Vraagprijs', value: price, included: true });

  // --- Invoerrechten (6.5% for non-EU origin, 0% for EU) ---
  const importDutyRate = originIsOutsideEU ? 6.5 : 0;
  const importDuty = Math.round(price * (importDutyRate / 100));
  lineItems.push({
    label:    `Invoerrechten (${importDutyRate}%)`,
    value:    importDuty,
    included: originIsOutsideEU,
  });

  // --- BTW (21% over price + import duty) ---
  const vatBase = price + importDuty;
  const vat = Math.round(vatBase * 0.21);
  lineItems.push({ label: 'BTW (21%)', value: vat, included: true });

  // --- BPM ---
  const { bpm, co2Used, co2Estimated } = calcBPM({ price, year, fuelType, co2 });
  const bpmNote = fuelType === 'electric' ? null : {
    valueTooltip: `o.b.v. ${co2Used}\u00a0g/km CO\u2082`,
    warning:      co2Estimated ? `CO\u2082 geschat (${co2Used}\u00a0g/km)` : null,
  };
  lineItems.push({
    label:    'BPM',
    value:    bpm,
    included: fuelType !== 'electric',
    note:     bpmNote,
  });

  // --- Transport ---
  let transport = null;
  if (carPostcode && carCountry) {
    transport = await estimateTransportCost(carPostcode, carCountry, referencePostcode);
  }
  lineItems.push({
    label:    'Transport (schatting)',
    value:    transport ?? TRANSPORT_DEFAULTS.fixedCost,
    included: true,
    note:     transport == null
      ? { warning: 'Postcode onbekend, vaste schatting gebruikt' }
      : null,
  });

  // --- Vaste kosten (RDW, keuring, etc.) ---
  lineItems.push({
    label:    'Vaste kosten (RDW e.d.)',
    value:    fixedCosts,
    included: true,
  });

  // --- Totaal ---
  const includedSum = lineItems
    .filter((i) => i.included)
    .reduce((sum, i) => sum + i.value, 0);

  lineItems.push({ label: 'Totaal', value: Math.round(includedSum), included: true, isTotal: true });

  return { lineItems, total: Math.round(includedSum) };
}

// ---------------------------------------------------------------------------
// BPM calculation
// ---------------------------------------------------------------------------

function calcBPM({ price, year, fuelType, co2 }) {
  if (fuelType === 'electric') return { bpm: 0, co2Used: 0, co2Estimated: false };

  const currentYear  = new Date().getFullYear();
  const age          = Math.max(0, currentYear - (year ?? currentYear));
  const co2Estimated = co2 == null;
  const co2Used      = co2 ?? estimateCO2(fuelType);
  const gross        = co2ToBPM(co2Used, fuelType);
  const depreciation = getDepreciation(age);

  return { bpm: Math.round(gross * (1 - depreciation)), co2Used, co2Estimated };
}

/**
 * CO2 (g/km) → gross BPM amount using the simplified 2025 bracket table.
 * Diesel gets a 15% surcharge.
 */
function co2ToBPM(co2, fuelType) {
  let bpm = 0;
  if      (co2 > 150) { bpm += (co2 - 150) * 18 + 50 * 7 + 18 * 4; }
  else if (co2 > 100) { bpm += (co2 - 100) * 7  + 18 * 4; }
  else if (co2 > 82)  { bpm += (co2 - 82)  * 4; }
  if (fuelType === 'diesel') bpm = Math.round(bpm * 1.15);
  return bpm;
}

/** Conservative CO2 fallback when the value is not available. */
function estimateCO2(fuelType) {
  const estimates = { petrol: 145, diesel: 155, hybrid: 110, electric: 0 };
  return estimates[fuelType] ?? 145;
}

/**
 * BPM age depreciation table (approximation of the RDW table).
 * Source: https://www.rdw.nl/zakelijk/voertuigen/registreren/bpm
 */
function getDepreciation(ageYears) {
  const table = [0, 0.09, 0.17, 0.25, 0.33, 0.41, 0.50, 0.57, 0.63, 0.68, 0.73, 0.77, 0.81, 0.84, 0.87, 0.90];
  return table[Math.min(ageYears, table.length - 1)];
}
