/**
 * Bereken de totale importkosten voor een auto naar Nederland.
 *
 * @param {object} params
 * @param {number} params.price       - Aankoopprijs in EUR
 * @param {number} params.year        - Bouwjaar van de auto
 * @param {'petrol'|'diesel'|'electric'|'hybrid'} params.fuelType
 * @returns {{ price, bpm, btw, importDuty, total }}
 */
export function calculateImportCosts({ price, year, fuelType }) {
  const currentYear = new Date().getFullYear();
  const age = currentYear - year;

  // --- BPM (vereenvoudigd model) ---
  // BPM is in werkelijkheid afhankelijk van CO2-uitstoot; dit is een benadering.
  let bpmRate = 0;
  if (fuelType === 'electric') {
    bpmRate = 0; // EV vrijgesteld van BPM
  } else if (fuelType === 'diesel') {
    bpmRate = 0.20;
  } else {
    bpmRate = 0.17; // benzine / hybride
  }

  // Afschrijving op BPM op basis van leeftijd (RDW tabel, benaderd)
  const depreciation = Math.min(age * 0.06, 0.90); // max 90% afschrijving
  const bpm = price * bpmRate * (1 - depreciation);

  // --- Invoerrechten (EU tarief: 6.5% voor personenwagens buiten EU) ---
  // Pas dit aan op basis van het land van herkomst
  const importDuty = price * 0.065;

  // --- BTW 21% over aankoopprijs + invoerrechten ---
  const btw = (price + importDuty) * 0.21;

  const total = price + bpm + importDuty + btw;

  return {
    price: Math.round(price),
    bpm: Math.round(bpm),
    btw: Math.round(btw),
    importDuty: Math.round(importDuty),
    total: Math.round(total),
  };
}
