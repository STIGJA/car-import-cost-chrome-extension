/**
 * transport.js — Transport cost estimation using Haversine crow-distance.
 *
 * Methodology mirrors CarImportArbitrageTool/Services/ImportCostCalculator.cs:
 *   transport = fixedCost + (crowDistance × DRIVING_RATIO) × costPerKm
 *
 * Postal-code coordinates are looked up from bundled lookup tables.
 * If a postcode cannot be resolved the function returns null so the
 * caller can decide whether to show an estimate or hide the row.
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants — mirror CarImportArbitrageTool defaults
// ---------------------------------------------------------------------------

export const TRANSPORT_DEFAULTS = {
  fixedCost:    300,   // euros, regardless of distance
  costPerKm:    0.55,  // euros per km of estimated driving distance
  drivingRatio: 1.35,  // crow-distance → driving-distance multiplier
  referencePostcode: '9367VA', // fallback when user has not set a postcode
};

// ---------------------------------------------------------------------------
// Haversine distance (km) between two lat/lon pairs
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371.0088;

function toRad(deg) {
  return deg * Math.PI / 180;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------
// Postcode → coordinates lookup
//
// The extension bundles a lightweight postcode table as a JS object so no
// file I/O is needed in the browser context.  The table lives in
// utils/postcode-coords.js and is imported lazily on first use.
//
// Format: { 'NL': { '9367': [lat, lon], … }, 'DE': { '10115': [lat, lon], … } }
// ---------------------------------------------------------------------------

let _coordTable = null;

async function getCoordTable() {
  if (_coordTable) return _coordTable;
  // Dynamic import so the large table is only loaded when needed.
  const mod = await import('./postcode-coords.js').catch(() => null);
  _coordTable = mod?.POSTCODE_COORDS ?? {};
  return _coordTable;
}

/**
 * Resolves a postcode string and country code to [lat, lon].
 * Normalises NL postcodes to 4-digit prefix, DE to 5 digits.
 * Returns null when not found.
 */
async function resolveCoords(postcode, countryCode) {
  const table = await getCoordTable();
  const byCountry = table[countryCode] ?? {};

  // Normalise
  let key = postcode.trim().toUpperCase().replace(/\s|-/g, '');
  if (countryCode === 'NL') key = key.replace(/\D.*$/, '').slice(0, 4); // first 4 digits
  if (countryCode === 'DE') key = key.replace(/\D/g, '').padStart(5, '0').slice(0, 5);

  if (byCountry[key]) return byCountry[key];

  // Fuzzy fallback: find closest numeric postcode
  const target = parseInt(key, 10);
  if (isNaN(target)) return null;
  const closest = Object.keys(byCountry)
    .filter((k) => !isNaN(parseInt(k, 10)))
    .sort((a, b) => Math.abs(parseInt(a, 10) - target) - Math.abs(parseInt(b, 10) - target))[0];
  return closest ? byCountry[closest] : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Estimates transport cost from a car's postcode (any supported country)
 * to the user's reference postcode (NL).
 *
 * @param {string}  carPostcode        Postcode of the car's location
 * @param {string}  carCountry         ISO-2 country code, e.g. 'DE', 'BE'
 * @param {string}  referencePostcode  User's NL postcode (from settings)
 * @param {object}  [opts]             Override TRANSPORT_DEFAULTS
 * @returns {Promise<number|null>}     Estimated cost in euros, or null if unresolvable
 */
export async function estimateTransportCost(carPostcode, carCountry, referencePostcode, opts = {}) {
  const { fixedCost, costPerKm, drivingRatio } = { ...TRANSPORT_DEFAULTS, ...opts };

  const fromCoords = await resolveCoords(carPostcode, carCountry);
  const toCoords   = await resolveCoords(referencePostcode, 'NL');

  if (!fromCoords || !toCoords) return null;

  const crowKm    = haversineKm(fromCoords[0], fromCoords[1], toCoords[0], toCoords[1]);
  const drivingKm = crowKm * drivingRatio;
  return Math.round(fixedCost + drivingKm * costPerKm);
}
