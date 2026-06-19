/**
 * co2-lookup.js
 *
 * Client-side CO2-schatting op basis van:
 *   1. Euronorm + brandstoftype + vermogensklasse (kW)
 *   2. Fallback: brandstoftype + bouwjaar
 *
 * Bronnen: ADAC Autokosten, EU typegoedkeuringsstatistieken,
 *          RDW open data gemiddelden per segment (geen API nodig).
 *
 * Gebruik:
 *   const result = estimateCO2FromSpecs({ fuelType, euroNorm, powerKw, weightKg, cc, year });
 *   // => { co2: 142, method: 'euronorm+power', confidence: 'medium' }
 */

'use strict';

// ---------------------------------------------------------------------------
// Tabel 1: Euronorm × Brandstof × Vermogensklasse → mediaan CO2 (g/km WLTP)
// Klassen: 0-74kW, 75-99kW, 100-129kW, 130-159kW, 160-199kW, 200+kW
// ---------------------------------------------------------------------------
const EURO_POWER_TABLE = {
  //          [<75, 75-99, 100-129, 130-159, 160-199, 200+]
  petrol: {
    'euro6d':      [118, 130,  142,    158,    175,   210],
    'euro6d-temp': [122, 135,  148,    165,    182,   218],
    'euro6c':      [126, 140,  154,    172,    190,   228],
    'euro6b':      [130, 146,  162,    180,    200,   240],
    'euro6':       [130, 146,  162,    180,    200,   240],
    'euro5':       [138, 154,  172,    192,    215,   258],
    'euro4':       [148, 166,  186,    208,    232,   278],
    'euro3':       [160, 180,  202,    226,    252,   300],
  },
  diesel: {
    'euro6d':      [112, 122,  132,    145,    162,   190],
    'euro6d-temp': [116, 126,  138,    152,    170,   200],
    'euro6c':      [120, 132,  145,    160,    178,   210],
    'euro6b':      [125, 138,  152,    168,    188,   222],
    'euro6':       [125, 138,  152,    168,    188,   222],
    'euro5':       [132, 146,  162,    180,    200,   238],
    'euro4':       [140, 156,  174,    194,    216,   258],
    'euro3':       [152, 170,  190,    212,    236,   282],
  },
  hybrid: {
    'euro6d':      [ 88,  98,  108,    118,    132,   155],
    'euro6d-temp': [ 92, 102,  114,    125,    140,   165],
    'euro6c':      [ 96, 108,  120,    132,    148,   175],
    'euro6b':      [100, 112,  126,    140,    158,   188],
    'euro6':       [100, 112,  126,    140,    158,   188],
    'euro5':       [108, 122,  138,    154,    172,   205],
    'euro4':       [118, 134,  152,    170,    190,   228],
    'euro3':       [128, 146,  166,    186,    208,   250],
  },
};

// Vermogensklasse index bepalen
function powerBracket(kw) {
  if (!kw || kw < 75)  return 0;
  if (kw < 100)        return 1;
  if (kw < 130)        return 2;
  if (kw < 160)        return 3;
  if (kw < 200)        return 4;
  return 5;
}

// ---------------------------------------------------------------------------
// Tabel 2: Fallback — brandstoftype + bouwjaar → gemiddeld CO2 (g/km)
// Gebaseerd op Europees vlootgemiddelde per jaar
// ---------------------------------------------------------------------------
const YEAR_FALLBACK = {
  petrol: {
    2024: 138, 2023: 142, 2022: 146, 2021: 150, 2020: 152,
    2019: 155, 2018: 158, 2017: 162, 2016: 166, 2015: 170,
    2014: 175, 2013: 180, 2012: 185, 2011: 190, 2010: 196,
    2009: 202, 2008: 210, 2007: 218, 2006: 225, 2005: 232,
  },
  diesel: {
    2024: 132, 2023: 136, 2022: 140, 2021: 144, 2020: 146,
    2019: 150, 2018: 154, 2017: 158, 2016: 162, 2015: 165,
    2014: 170, 2013: 174, 2012: 178, 2011: 183, 2010: 188,
    2009: 194, 2008: 202, 2007: 210, 2006: 218, 2005: 226,
  },
  hybrid: {
    2024:  95, 2023:  98, 2022: 102, 2021: 106, 2020: 108,
    2019: 112, 2018: 116, 2017: 120, 2016: 125, 2015: 130,
    2014: 135, 2013: 140, 2012: 145, 2011: 150, 2010: 156,
  },
  electric: {
    // altijd 0, alle jaren
  },
};

// ---------------------------------------------------------------------------
// Hulpfunctie: normaliseer euronorm string → sleutel
// ---------------------------------------------------------------------------
function normalizeEuroNorm(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/\s/g, '');
  if (s.includes('6d-temp') || s.includes('6dtemp')) return 'euro6d-temp';
  if (s.includes('6d'))   return 'euro6d';
  if (s.includes('6c'))   return 'euro6c';
  if (s.includes('6b'))   return 'euro6b';
  if (s.includes('6'))    return 'euro6';
  if (s.includes('5'))    return 'euro5';
  if (s.includes('4'))    return 'euro4';
  if (s.includes('3'))    return 'euro3';
  if (s.includes('2'))    return 'euro2';
  return null;
}

// ---------------------------------------------------------------------------
// Hoofdfunctie
// ---------------------------------------------------------------------------

/**
 * @param {object} specs
 * @param {string}  specs.fuelType   - 'petrol'|'diesel'|'hybrid'|'electric'
 * @param {string}  [specs.euroNorm] - bijv. 'Euro 6d', 'EURO 6D-TEMP'
 * @param {number}  [specs.powerKw]  - vermogen in kW
 * @param {number}  [specs.year]     - bouwjaar
 * @returns {{ co2: number, method: string, confidence: string }}
 */
function estimateCO2FromSpecs({ fuelType, euroNorm, powerKw, year }) {
  if (fuelType === 'electric') {
    return { co2: 0, method: 'electric', confidence: 'exact' };
  }

  const fuel = fuelType in EURO_POWER_TABLE ? fuelType : 'petrol';
  const normEuro = normalizeEuroNorm(euroNorm);

  // Methode 1: Euronorm + vermogen
  if (normEuro && EURO_POWER_TABLE[fuel][normEuro] && powerKw) {
    const bracket = powerBracket(powerKw);
    const co2 = EURO_POWER_TABLE[fuel][normEuro][bracket];
    return { co2, method: 'euronorm+power', confidence: 'medium' };
  }

  // Methode 2: Euronorm zonder vermogen (midden bracket)
  if (normEuro && EURO_POWER_TABLE[fuel][normEuro]) {
    const co2 = EURO_POWER_TABLE[fuel][normEuro][2]; // 100-129kW als midden
    return { co2, method: 'euronorm', confidence: 'low' };
  }

  // Methode 3: Bouwjaar fallback
  if (year && YEAR_FALLBACK[fuel]) {
    const yearKey = Math.max(2005, Math.min(2024, year));
    const co2 = YEAR_FALLBACK[fuel][yearKey];
    if (co2) return { co2, method: 'year-fallback', confidence: 'low' };
  }

  // Methode 4: Absolute fallback per brandstof
  const hardFallback = { petrol: 155, diesel: 160, hybrid: 120, electric: 0 };
  return { co2: hardFallback[fuel] ?? 155, method: 'hardcoded-fallback', confidence: 'very-low' };
}

/**
 * Vergelijk gescrapete CO2 met schatting.
 * Geeft een warning-object terug als de afwijking significant is.
 *
 * @param {number} scraped  - CO2 van de pagina (g/km)
 * @param {number} estimated - CO2 van de lookup (g/km)
 * @returns {{ warn: boolean, diff: number, pct: number, message: string }}
 */
function checkCO2Deviation(scraped, estimated) {
  const diff = Math.abs(scraped - estimated);
  const pct  = Math.round((diff / scraped) * 100);
  const warn = diff >= 20 || pct >= 15;
  const message = warn
    ? `Let op: opgegeven CO\u2082 (${scraped} g/km) wijkt ${diff} g/km (${pct}%) af van de schatting (${estimated} g/km). Controleer of de waarde WLTP is.`
    : null;
  return { warn, diff, pct, message };
}
