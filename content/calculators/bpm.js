/**
 * content/calculators/bpm.js — Gedeelde BPM-berekeningslogica
 *
 * Laadt als klassiek script (content_scripts in manifest).
 * Zet alles op window.CIC_BPM zodat nl-import.js en popup.js
 * beiden dezelfde staffel en tabellen gebruiken.
 *
 * Bronnen:
 *   - Belastingdienst: https://www.belastingdienst.nl/wps/wcm/connect/nl/bpm/content/personenauto-bpm-tarief-berekenen
 *   - Historische tarieven: https://download.belastingdienst.nl/belastingdienst/docs/bpm_tarieven_bpm0651z12fd.pdf
 *   - Autoweek/AutoRAI staffels 2016-2020
 *
 * Bij import van een gebruikt voertuig mag het LAAGSTE bruto BPM-bedrag
 * worden gebruikt tussen het tarief van het registratiejaar en het huidige
 * tarief (Wet BPM 1992, art. 10).
 */

"use strict";

(function (root) {
  // -------------------------------------------------------------------------
  // Historische BPM-staffels per jaar (benzine én diesel, zelfde CO2-schijven)
  // Formule per schijf: base + (co2 - from) * rate
  // Diesel toeslag is apart gedefinieerd in DIESEL_SURCHARGE_BY_YEAR
  // -------------------------------------------------------------------------
  const BPM_TABLES_BY_YEAR = {
    // Bron: Belastingdienst tarieven 2016 / AutoRAI / autoweek.nl
    2016: [
      { from: 0,   to: 79,   base: 175,   rate: 6   },
      { from: 79,  to: 106,  base: 649,   rate: 69  },
      { from: 106, to: 155,  base: 2512,  rate: 124 },
      { from: 155, to: 174,  base: 8588,  rate: 239 },
      { from: 174, to: null, base: 13129, rate: 478 },
    ],
    2017: [
      { from: 0,   to: 76,   base: 350,   rate: 2   },
      { from: 76,  to: 102,  base: 502,   rate: 66  },
      { from: 102, to: 150,  base: 2218,  rate: 145 },
      { from: 150, to: 168,  base: 9178,  rate: 238 },
      { from: 168, to: null, base: 13462, rate: 476 },
    ],
    2018: [
      { from: 0,   to: 73,   base: 350,   rate: 2   },
      { from: 73,  to: 98,   base: 496,   rate: 66  },
      { from: 98,  to: 144,  base: 2146,  rate: 145 },
      { from: 144, to: 162,  base: 8816,  rate: 238 },
      { from: 162, to: null, base: 13100, rate: 476 },
    ],
    2019: [
      { from: 0,   to: 71,   base: 350,   rate: 2   },
      { from: 71,  to: 95,   base: 390,   rate: 66  },
      { from: 95,  to: 139,  base: 1974,  rate: 145 },
      { from: 139, to: 156,  base: 8354,  rate: 238 },
      { from: 156, to: null, base: 12398, rate: 476 },
    ],
    2020: [
      { from: 0,   to: 68,   base: 350,   rate: 2   },
      { from: 68,  to: 91,   base: 416,   rate: 66  },
      { from: 91,  to: 133,  base: 1934,  rate: 145 },
      { from: 133, to: 150,  base: 8024,  rate: 238 },
      { from: 150, to: null, base: 12068, rate: 476 },
    ],
    // Bron: Belastingdienst 2021
    2021: [
      { from: 0,   to: 65,   base: 360,   rate: 2   },
      { from: 65,  to: 88,   base: 410,   rate: 70  },
      { from: 88,  to: 117,  base: 2020,  rate: 156 },
      { from: 117, to: 160,  base: 6544,  rate: 220 },
      { from: 160, to: null, base: 16004, rate: 440 },
    ],
    2022: [
      { from: 0,   to: 67,   base: 360,   rate: 2   },
      { from: 67,  to: 96,   base: 394,   rate: 72  },
      { from: 96,  to: 128,  base: 2482,  rate: 168 },
      { from: 128, to: 150,  base: 7858,  rate: 240 },
      { from: 150, to: null, base: 13138, rate: 480 },
    ],
    2023: [
      { from: 0,   to: 73,   base: 490,   rate: 2   },
      { from: 73,  to: 100,  base: 636,   rate: 78  },
      { from: 100, to: 133,  base: 2742,  rate: 175 },
      { from: 133, to: 150,  base: 8517,  rate: 271 },
      { from: 150, to: null, base: 13124, rate: 542 },
    ],
    2024: [
      { from: 0,   to: 75,   base: 540,   rate: 2   },
      { from: 75,  to: 98,   base: 690,   rate: 80  },
      { from: 98,  to: 136,  base: 2530,  rate: 178 },
      { from: 136, to: 152,  base: 9294,  rate: 286 },
      { from: 152, to: null, base: 13870, rate: 572 },
    ],
    2025: [
      { from: 0,   to: 76,   base: 667,   rate: 2   },
      { from: 76,  to: 99,   base: 819,   rate: 80  },
      { from: 99,  to: 137,  base: 2659,  rate: 180 },
      { from: 137, to: 154,  base: 9499,  rate: 296 },
      { from: 154, to: null, base: 14531, rate: 592 },
    ],
    // Huidig (2026) — bron Belastingdienst
    2026: [
      { from: 0,   to: 77,   base: 687,   rate: 2   },
      { from: 77,  to: 100,  base: 841,   rate: 82  },
      { from: 100, to: 139,  base: 2727,  rate: 181 },
      { from: 139, to: 155,  base: 9786,  rate: 297 },
      { from: 155, to: null, base: 14538, rate: 594 },
    ],
  };

  // Oudere auto's (voor 2016) hadden CO2-staffels gebaseerd op catalogusprijs,
  // niet op CO2. Voor schattingen gebruiken we 2016 als laagste historische
  // CO2-staffel — dit is altijd gunstiger dan 2026 voor hoge CO2-waarden.
  const OLDEST_CO2_TABLE_YEAR = 2016;
  const CURRENT_YEAR = 2026;

  // -------------------------------------------------------------------------
  // Diesel toeslag per jaar
  // Bron: Belastingdienst / autoweek.nl / AutoRAI
  // -------------------------------------------------------------------------
  const DIESEL_SURCHARGE_BY_YEAR = {
    2016: { from: 67, rate: 86.43 },
    2017: { from: 65, rate: 86.00 },
    2018: { from: 63, rate: 86.00 },
    2019: { from: 61, rate: 86.00 },
    2020: { from: 59, rate: 86.00 },
    2021: { from: 57, rate: 87.00 },
    2022: { from: 59, rate: 93.00 },
    2023: { from: 64, rate: 103.00 },
    2024: { from: 66, rate: 110.00 },
    2025: { from: 68, rate: 113.00 },
    2026: { from: 69, rate: 114.83 },
  };

  // -------------------------------------------------------------------------
  // EV starttarief per registratiejaar
  // -------------------------------------------------------------------------
  const EV_STARTTARIEF = {
    2025: 667,
    2026: 687,
  };
  const EV_STARTTARIEF_DEFAULT = 687;

  // -------------------------------------------------------------------------
  // Forfaitaire afschrijvingstabel BPM (Wet BPM 1992, Bijlage)
  // [vanMaand, totMaand, basisPct, incrementPerMaand]
  // -------------------------------------------------------------------------
  const DEPRECIATION_TABLE = [
    [0,   1,        0,  12.00],
    [1,   3,       12,   4.00],
    [3,   5,       20,   3.50],
    [5,   9,       27,   1.50],
    [9,   18,      33,   1.00],
    [18,  30,      42,   0.75],
    [30,  42,      51,   0.50],
    [42,  54,      57,   0.42],
    [54,  66,      62,   0.42],
    [66,  78,      67,   0.42],
    [78,  90,      72,   0.25],
    [90,  102,     75,   0.25],
    [102, 114,     78,   0.25],
    [114, Infinity, 81,  0.19],
  ];

  // -------------------------------------------------------------------------
  // Geschatte CO2-waarden per brandstof + bouwjaar (fallback)
  // -------------------------------------------------------------------------
  const CO2_FALLBACK = {
    petrol: {
      2026: 135, 2025: 136, 2024: 138, 2023: 142, 2022: 146,
      2021: 150, 2020: 152, 2019: 155, 2018: 158, 2017: 162,
      2016: 166, 2015: 170, 2014: 175, 2013: 180, 2012: 185,
      2011: 190, 2010: 196, 2009: 202, 2008: 210, 2007: 218,
      2006: 225, 2005: 232,
    },
    diesel: {
      2026: 125, 2025: 126, 2024: 128, 2023: 132, 2022: 136,
      2021: 140, 2020: 143, 2019: 147, 2018: 151, 2017: 155,
      2016: 159, 2015: 162, 2014: 167, 2013: 171, 2012: 175,
      2011: 179, 2010: 184, 2009: 190, 2008: 198, 2007: 206,
      2006: 214, 2005: 222,
    },
    hybrid: {
      2026: 92, 2025: 93, 2024: 95, 2023: 98, 2022: 102,
      2021: 106, 2020: 108, 2019: 112, 2018: 116, 2017: 120,
      2016: 125, 2015: 130, 2014: 135, 2013: 140, 2012: 145,
      2011: 150, 2010: 156,
    },
    electric: {},
  };

  // -------------------------------------------------------------------------
  // Hulpfunctie: bereken bruto BPM voor een specifiek jaar-tarief
  // -------------------------------------------------------------------------
  function _bpmBrutoForYear(co2, fuelType, year) {
    const clampedYear = Math.max(OLDEST_CO2_TABLE_YEAR, Math.min(CURRENT_YEAR, year));
    const table = BPM_TABLES_BY_YEAR[clampedYear];
    if (!table) return null;

    let bpm = 0;
    for (const { from, to, base, rate } of table) {
      if (co2 > from) {
        bpm = base + (co2 - from) * rate;
        if (to === null || co2 <= to) break;
      }
    }

    if (fuelType === "diesel") {
      const surcharge = DIESEL_SURCHARGE_BY_YEAR[clampedYear]
        ?? DIESEL_SURCHARGE_BY_YEAR[OLDEST_CO2_TABLE_YEAR];
      if (co2 > surcharge.from) {
        bpm += (co2 - surcharge.from) * surcharge.rate;
      }
    }

    return Math.round(bpm);
  }

  // -------------------------------------------------------------------------
  // Publieke functies
  // -------------------------------------------------------------------------

  /**
   * Bereken bruto BPM met het historisch gunstigste tarief.
   * Bij import mag het LAAGSTE bedrag tussen registratiejaar en huidig jaar
   * worden gebruikt (Wet BPM 1992, art. 10).
   *
   * @param {number} co2 - CO2-uitstoot in g/km
   * @param {string} fuelType - 'petrol' | 'diesel' | 'hybrid' | 'electric'
   * @param {number} registrationYear - Bouwjaar / eerste registratiejaar
   * @returns {number} Laagste bruto BPM in €
   */
  function bpmBruto(co2, fuelType, registrationYear) {
    if (fuelType === "electric") {
      const year = registrationYear ?? new Date().getFullYear();
      return EV_STARTTARIEF[year] ?? EV_STARTTARIEF_DEFAULT;
    }
    if (!co2 || co2 <= 0) return 0;

    const regYear = registrationYear ?? CURRENT_YEAR;

    // Bereken voor elk jaar tussen registratiejaar en nu, kies het laagste
    const startYear = Math.max(OLDEST_CO2_TABLE_YEAR, regYear);
    let lowest = Infinity;
    for (let y = startYear; y <= CURRENT_YEAR; y++) {
      const amount = _bpmBrutoForYear(co2, fuelType, y);
      if (amount !== null && amount < lowest) lowest = amount;
    }

    return lowest === Infinity ? 0 : lowest;
  }

  /**
   * Bereken de forfaitaire afschrijvingsfractie op basis van leeftijd in jaren.
   * @param {number} ageYears - Leeftijd in jaren (decimaal)
   * @returns {number} Afgeschreven fractie [0.00 – 1.00]
   */
  function depreciationFactor(ageYears) {
    if (ageYears >= 25) return 1.0;
    const months = Math.ceil(ageYears * 12);

    for (const [min, max, base, incr] of DEPRECIATION_TABLE) {
      if (months >= min && months < max) {
        return Math.min((base + (months - min) * incr) / 100, 1.0);
      }
    }
    return 0;
  }

  /**
   * Bereken netto BPM (na forfaitaire afschrijving).
   * @param {number} co2
   * @param {string} fuelType
   * @param {number} ageYears
   * @param {number} registrationYear
   */
  function bpmNetto(co2, fuelType, ageYears, registrationYear) {
    return Math.round(
      bpmBruto(co2, fuelType, registrationYear) * (1 - depreciationFactor(ageYears)),
    );
  }

  /**
   * Schat CO2-uitstoot op basis van brandstoftype en bouwjaar (fallback).
   */
  function estimateCO2(fuelType, year) {
    if (fuelType === "electric") return 0;
    const table = CO2_FALLBACK[fuelType] ?? CO2_FALLBACK.petrol;
    const y = Math.max(2005, Math.min(2026, year ?? 2020));
    return table[y] ?? 155;
  }

  // -------------------------------------------------------------------------
  // Exporteer op window
  // -------------------------------------------------------------------------
  root.CIC_BPM = {
    bpmBruto,
    bpmNetto,
    depreciationFactor,
    estimateCO2,
    BPM_TABLES_BY_YEAR,
    DIESEL_SURCHARGE_BY_YEAR,
    DEPRECIATION_TABLE,
    CO2_FALLBACK,
    EV_STARTTARIEF,
  };
})(typeof window !== "undefined" ? window : globalThis);
