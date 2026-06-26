/**
 * content/calculators/bpm.js — Gedeelde BPM-berekeningslogica
 *
 * Laadt als klassiek script (content_scripts in manifest).
 * Zet alles op window.CIC_BPM zodat nl-import.js en popup.js
 * beiden dezelfde staffel en tabellen gebruiken.
 *
 * Bron staffel: https://www.belastingdienst.nl/wps/wcm/connect/nl/bpm/content/personenauto-bpm-tarief-berekenen
 * Geldig: 2026
 */

"use strict";

(function (root) {
  // -------------------------------------------------------------------------
  // BPM-staffel 2026 (Belastingdienst, tabel personenauto's)
  // Formule per schijf: (co2 - from) * rate + base
  // -------------------------------------------------------------------------
  const BPM_TABLE = [
    { from: 0,   to: 77,   base: 687,   rate: 2   },
    { from: 77,  to: 100,  base: 841,   rate: 82  },
    { from: 100, to: 139,  base: 2727,  rate: 181 },
    { from: 139, to: 155,  base: 9786,  rate: 297 },
    { from: 155, to: null, base: 14538, rate: 594 },
  ];

  // Diesel toeslag 2026: €114,83 per gram boven 69 g/km
  const DIESEL_SURCHARGE_RATE = 114.83;
  const DIESEL_SURCHARGE_FROM = 69;

  // BPM starttarief per jaar voor elektrische voertuigen (Wet BPM 1992)
  // Geldt voor nieuwe én gebruikte EV's — bij gebruikte auto's wordt het
  // starttarief ook afgeschreven via de normale forfaitaire tabel.
  const EV_STARTTARIEF = {
    2025: 667,
    2026: 687,
    // Voeg toekomstige jaren hier toe
  };
  const EV_STARTTARIEF_DEFAULT = 687;

  // -------------------------------------------------------------------------
  // Forfaitaire afschrijvingstabel BPM (Wet BPM 1992, Bijlage)
  // Indeling per maandband: [vanMaand, totMaand, basisPct, incrementPerMaand]
  // Gebruik: depreciationFactor(ageYears) → fractie [0.00 – 0.97]
  // -------------------------------------------------------------------------
  const DEPRECIATION_TABLE = [
  [0, 1, 0, 12.0],
  [1, 3, 12, 4.0],
  [3, 5, 20, 3.5],
  [5, 9, 27, 1.5],
  [9, 18, 33, 1.0],
  [18, 30, 42, 0.75],
  [30, 42, 51, 0.5],
  [42, 54, 57, 0.42],
  [54, 66, 62, 0.42],
  [66, 78, 67, 0.42],
  [78, 90, 72, 0.25],
  [90, 102, 75, 0.25],
  [102, 114, 78, 0.25],
  [114, Infinity, 81, 0.19],
];

  // -------------------------------------------------------------------------
  // Geschatte CO2-waarden per brandstof + bouwjaar (fallback)
  // -------------------------------------------------------------------------
  const CO2_FALLBACK = {
    petrol: {
      2026: 135,
      2025: 136,
      2024: 138,
      2023: 142,
      2022: 146,
      2021: 150,
      2020: 152,
      2019: 155,
      2018: 158,
      2017: 162,
      2016: 166,
      2015: 170,
      2014: 175,
      2013: 180,
      2012: 185,
      2011: 190,
      2010: 196,
      2009: 202,
      2008: 210,
      2007: 218,
      2006: 225,
      2005: 232,
    },
    diesel: {
      2026: 125,
      2025: 126,
      2024: 128,
      2023: 132,
      2022: 136,
      2021: 140,
      2020: 143,
      2019: 147,
      2018: 151,
      2017: 155,
      2016: 159,
      2015: 162,
      2014: 167,
      2013: 171,
      2012: 175,
      2011: 179,
      2010: 184,
      2009: 190,
      2008: 198,
      2007: 206,
      2006: 214,
      2005: 222,
    },
    hybrid: {
      2026: 92,
      2025: 93,
      2024: 95,
      2023: 98,
      2022: 102,
      2021: 106,
      2020: 108,
      2019: 112,
      2018: 116,
      2017: 120,
      2016: 125,
      2015: 130,
      2014: 135,
      2013: 140,
      2012: 145,
      2011: 150,
      2010: 156,
    },
    electric: {},
  };

  // -------------------------------------------------------------------------
  // Functies
  // -------------------------------------------------------------------------

  /**
   * Bereken bruto BPM op basis van CO2-uitstoot en brandstoftype.
   * Elektrische voertuigen betalen alleen het starttarief (geen CO2-schijven).
   * @param {number} co2 - CO2-uitstoot in g/km
   * @param {string} fuelType - 'petrol' | 'diesel' | 'hybrid' | 'electric'
   * @param {number} [registrationYear] - Bouwjaar voor EV-starttarief opzoeken
   */
  function bpmBruto(co2, fuelType, registrationYear) {
    if (fuelType === "electric") {
      const year = registrationYear ?? new Date().getFullYear();
      return EV_STARTTARIEF[year] ?? EV_STARTTARIEF_DEFAULT;
    }
    if (!co2 || co2 <= 0) return 0;

    let bpm = 0;
    for (const { from, to, base, rate } of BPM_TABLE) {
      if (co2 > from) {
        bpm = base + (co2 - from) * rate;
        if (to === null || co2 <= to) break;
      }
    }
    if (fuelType === "diesel" && co2 > DIESEL_SURCHARGE_FROM) {
      bpm += (co2 - DIESEL_SURCHARGE_FROM) * DIESEL_SURCHARGE_RATE;
    }
    return Math.round(bpm);
  }

  /**
   * Bereken de forfaitaire afschrijvingsfractie op basis van leeftijd in jaren.
   * Gebruikt de officiële maandband-tabel (Wet BPM 1992, Bijlage).
   * @param {number} ageYears - Leeftijd van het voertuig in jaren (decimaal)
   * @returns {number} Afgeschreven fractie tussen 0.00 en 0.97
   */
function depreciationFactor(ageYears) {
  if (ageYears >= 25) return 1.0;
  const months = Math.ceil(ageYears * 12);

  for (const [min, max, base, incr] of DEPRECIATION_TABLE) {
    if (months >= min && months < max) {
      const monthsInBand = months - min;
      return Math.min((base + monthsInBand * incr) / 100, 1);
    }
  }
  return 0;
}

  /**
   * Bereken netto BPM (na forfaitaire afschrijving).
   * @param {number} co2
   * @param {string} fuelType
   * @param {number} ageYears
   * @param {number} [registrationYear]
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
    BPM_TABLE,
    DEPRECIATION_TABLE,
    CO2_FALLBACK,
    EV_STARTTARIEF,
  };
})(typeof window !== "undefined" ? window : globalThis);
