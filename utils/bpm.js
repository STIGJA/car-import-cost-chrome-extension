/**
 * utils/bpm.js — Gedeelde BPM-berekeningslogica
 *
 * Werkt zowel als ES module (popup) als als IIFE via <script> (content scripts).
 * Content scripts: window.CIC_BPM
 * Popup/modules:   import { bpmBruto, bpmNetto, CO2_FALLBACK, DEPRECIATION } from '../utils/bpm.js'
 *
 * Bron staffel: https://www.belastingdienst.nl/wps/wcm/connect/nl/bpm/content/personenauto-bpm-tarief-berekenen
 * Geldig:       2026
 */

'use strict';

// ---------------------------------------------------------------------------
// BPM-staffel 2026 (Belastingdienst, tabel personenauto's)
// Formule per schijf: (co2 - from) * rate + base
// ---------------------------------------------------------------------------
export const BPM_TABLE = [
  { from:   0, to:  77, base:   687, rate:   2 },
  { from:  77, to: 100, base:   841, rate:  82 },
  { from: 100, to: 139, base:  2727, rate: 181 },
  { from: 139, to: 155, base:  9786, rate: 297 },
  { from: 155, to: null, base: 14538, rate: 594 },
];

// Diesel toeslag 2026: €114,83 per gram boven 69 g/km
export const DIESEL_SURCHARGE_RATE = 114.83;
export const DIESEL_SURCHARGE_FROM = 69;

// ---------------------------------------------------------------------------
// Forfaitaire afschrijvingstabel BPM (Belastingdienst)
// Index = leeftijd in volle jaren, waarde = afgeschreven fractie
// ---------------------------------------------------------------------------
export const DEPRECIATION = [
  0, 0.09, 0.17, 0.25, 0.33, 0.41, 0.50,
  0.57, 0.63, 0.68, 0.73, 0.77, 0.81, 0.84, 0.87, 0.90,
];

// ---------------------------------------------------------------------------
// Geschatte CO2-waarden per brandstof + bouwjaar (fallback als niet bekend)
// ---------------------------------------------------------------------------
export const CO2_FALLBACK = {
  petrol:  { 2024:138, 2023:142, 2022:146, 2021:150, 2020:152, 2019:155, 2018:158, 2017:162, 2016:166, 2015:170, 2014:175, 2013:180, 2012:185, 2011:190, 2010:196, 2009:202, 2008:210, 2007:218, 2006:225, 2005:232 },
  diesel:  { 2024:128, 2023:132, 2022:136, 2021:140, 2020:143, 2019:147, 2018:151, 2017:155, 2016:159, 2015:162, 2014:167, 2013:171, 2012:175, 2011:179, 2010:184, 2009:190, 2008:198, 2007:206, 2006:214, 2005:222 },
  hybrid:  { 2024: 95, 2023: 98, 2022:102, 2021:106, 2020:108, 2019:112, 2018:116, 2017:120, 2016:125, 2015:130, 2014:135, 2013:140, 2012:145, 2011:150, 2010:156 },
  electric: {},
};

/**
 * Bruto BPM voor een nieuwe auto (geen afschrijving).
 * @param {number} co2       CO2-uitstoot in g/km
 * @param {string} fuelType  'petrol' | 'diesel' | 'hybrid' | 'electric'
 * @returns {number}  Afgerond op hele euro's
 */
export function bpmBruto(co2, fuelType) {
  if (!co2 || co2 <= 0 || fuelType === 'electric') return 0;

  let bpm = 0;
  for (const { from, to, base, rate } of BPM_TABLE) {
    if (co2 > from) {
      bpm = base + (co2 - from) * rate;
      if (to === null || co2 <= to) break;
    }
  }

  if (fuelType === 'diesel' && co2 > DIESEL_SURCHARGE_FROM) {
    bpm += (co2 - DIESEL_SURCHARGE_FROM) * DIESEL_SURCHARGE_RATE;
  }

  return Math.round(bpm);
}

/**
 * Afschrijvingsfactor o.b.v. leeftijd in jaren (forfaitaire tabel).
 * @param {number} ageYears
 * @returns {number}  0.0 – 0.90
 */
export function depreciationFactor(ageYears) {
  return DEPRECIATION[Math.max(0, Math.min(Math.floor(ageYears), DEPRECIATION.length - 1))];
}

/**
 * Netto BPM na afschrijving.
 * @param {number} co2
 * @param {string} fuelType
 * @param {number} ageYears
 * @returns {number}
 */
export function bpmNetto(co2, fuelType, ageYears) {
  return Math.round(bpmBruto(co2, fuelType) * (1 - depreciationFactor(ageYears)));
}

/**
 * Schat CO2 o.b.v. brandstoftype en bouwjaar (als echte waarde niet bekend is).
 * @param {string} fuelType
 * @param {number|null} year
 * @returns {number}
 */
export function estimateCO2(fuelType, year) {
  if (fuelType === 'electric') return 0;
  const table = CO2_FALLBACK[fuelType] ?? CO2_FALLBACK.petrol;
  const y = Math.max(2005, Math.min(2024, year ?? 2020));
  return table[y] ?? 155;
}

// ---------------------------------------------------------------------------
// IIFE-export voor content scripts (geen ES module support)
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window.CIC_BPM = { bpmBruto, bpmNetto, depreciationFactor, estimateCO2, BPM_TABLE, DEPRECIATION, CO2_FALLBACK };
}
