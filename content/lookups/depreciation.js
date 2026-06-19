/**
 * depreciation.js — BPM-afschrijvingstabel (leeftijd in jaren → factor)
 *
 * Geëxporteerd als window.CIC_Depreciation.getFactor(ageYears)
 *
 * Bron: RDW/Belastingdienst afschrijvingstabel voor gebruikte auto's.
 * Waarden gelden voor normale gebruikte auto's; classic cars en exoten
 * hebben aparte regelgeving (buiten scope).
 */

'use strict';

(function (root) {
  // Index = leeftijd in volle jaren (0 = nieuw, 15+ = maximaal afgeschreven)
  // Waarde = afschrijvingspercentage (0.00 = geen afschrijving, 0.90 = 90% afgeschreven)
  const DEPRECIATION_TABLE = [
    0.00, // 0 jaar  (nieuw)
    0.09, // 1 jaar
    0.17, // 2 jaar
    0.25, // 3 jaar
    0.33, // 4 jaar
    0.41, // 5 jaar
    0.50, // 6 jaar
    0.57, // 7 jaar
    0.63, // 8 jaar
    0.68, // 9 jaar
    0.73, // 10 jaar
    0.77, // 11 jaar
    0.81, // 12 jaar
    0.84, // 13 jaar
    0.87, // 14 jaar
    0.90, // 15+ jaar
  ];

  /**
   * @param {number} ageYears  Leeftijd in volle jaren
   * @returns {number}         Afschrijvingsfactor (0.00 – 0.90)
   */
  function getFactor(ageYears) {
    const idx = Math.max(0, Math.min(Math.floor(ageYears), DEPRECIATION_TABLE.length - 1));
    return DEPRECIATION_TABLE[idx];
  }

  root.CIC_Depreciation = { getFactor };
})(window);
