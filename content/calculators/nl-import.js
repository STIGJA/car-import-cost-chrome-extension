/**
 * nl-import.js — Berekening importkosten Nederland (EU-scope)
 *
 * Transport: Haversine crow-distance × 1.35 (rijfactor) × (transportPer100km / 100) + transportFixed
 */

'use strict';

(function (root) {

  // Defaults — must match SETTING_DEFAULTS in utils/settings.js
  const DEFAULT_FIXED_COSTS        = 170;
  const DEFAULT_TRANSPORT_FIXED    = 300;
  const DEFAULT_TRANSPORT_PER100KM = 55;    // euros per 100 km
  const DRIVING_RATIO              = 1.35;
  const EARTH_RADIUS_KM            = 6371.0088;

  // ---------------------------------------------------------------------------
  // Haversine
  // ---------------------------------------------------------------------------
  function toRad(d) { return d * Math.PI / 180; }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
  }

  // ---------------------------------------------------------------------------
  // Postcode → [lat, lon]  (linear interpolation per country)
  // ---------------------------------------------------------------------------
  const COUNTRY_CENTROIDS = {
    DE: [51.1657, 10.4515], BE: [50.5039, 4.4699], FR: [46.2276, 2.2137],
    ES: [40.4637, -3.7492], IT: [41.8719, 12.5674], NL: [52.1326, 5.2913],
    AT: [47.5162, 14.5501], CH: [46.8182, 8.2275],  PL: [51.9194, 19.1451],
    PT: [39.3999, -8.2245], LU: [49.8153, 6.1296],  CZ: [49.8175, 15.4730],
    HU: [47.1625, 19.5033], RO: [45.9432, 24.9668],
  };

  function resolveCoords(postcode, countryCode) {
    if (countryCode === 'DE' && postcode) {
      const num = parseInt(postcode.replace(/\D/g, '').padStart(5, '0').slice(0, 5), 10);
      const t   = Math.max(0, Math.min(1, (num - 1001) / (99998 - 1001)));
      return [54.9 - t * (54.9 - 47.3), 6.1 + t * (15.0 - 6.1)];
    }
    if (countryCode === 'BE' && postcode) {
      const num = parseInt(postcode.replace(/\D/g, ''), 10);
      if (!isNaN(num)) {
        const t = Math.max(0, Math.min(1, (num - 1000) / (9999 - 1000)));
        return [49.5 + t * (51.5 - 49.5), 2.5 + t * (6.4 - 2.5)];
      }
    }
    if (countryCode === 'NL' && postcode) {
      const num = parseInt(postcode.replace(/\D/g, '').slice(0, 4), 10);
      if (!isNaN(num)) {
        const t = Math.max(0, Math.min(1, (num - 1000) / (9999 - 1000)));
        return [50.75 + t * (53.6 - 50.75), 3.36 + t * (7.22 - 3.36)];
      }
    }
    return COUNTRY_CENTROIDS[countryCode] ?? null;
  }

  function estimateTransport(carPostcode, carCountry, refPostcode, transportFixed, transportPer100km) {
    const from = resolveCoords(carPostcode, carCountry);
    const to   = resolveCoords(refPostcode, 'NL');
    if (!from || !to) return transportFixed;
    const crow    = haversineKm(from[0], from[1], to[0], to[1]);
    const driving = crow * DRIVING_RATIO;
    return Math.round(transportFixed + driving * (transportPer100km / 100));
  }

  // ---------------------------------------------------------------------------
  // Date helpers
  // ---------------------------------------------------------------------------
  function parseDate(v) {
    if (!v) return null;
    const p = String(v).match(/(\d{1,2})[\/-](\d{4})/);
    if (p) return new Date(parseInt(p[2]), parseInt(p[1]) - 1, 1);
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  function ageMonthsFrom(v) {
    const d = parseDate(v);
    return d ? (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44) : null;
  }
  function ageYearsFrom(v) {
    const m = ageMonthsFrom(v);
    return m != null ? m / 12 : 3;
  }

  // ---------------------------------------------------------------------------
  // Main
  // ---------------------------------------------------------------------------
  function calculate(listing, settings = {}) {
    const { bpmBruto, bpmNetto, estimateCO2 } = root.CIC_BPM;

    const price            = listing.price.value;
    const fuelType         = listing.fuelType.value;
    const firstReg         = listing.firstRegDate?.value ?? null;
    const carCountry       = listing.country  ?? 'DE';
    const carZip           = listing.postcode ?? null;
    const refZip           = settings.postcode          || '9203';
    const fixedCosts       = settings.fixedCosts        ?? DEFAULT_FIXED_COSTS;
    const transportFixed   = settings.transportFixed    ?? DEFAULT_TRANSPORT_FIXED;
    const transportPer100  = settings.transportPer100km ?? DEFAULT_TRANSPORT_PER100KM;

    const co2          = listing.co2.value ?? estimateCO2(fuelType, listing.year?.value);
    const co2Estimated = listing.co2.source === 'estimated' || listing.co2.value == null;
    const co2Method    = listing.co2.method ?? null;

    const months = ageMonthsFrom(firstReg);
    const isNew  = months != null && months < 6;
    const years  = ageYearsFrom(firstReg);

    const vat       = isNew ? Math.round(price * 0.21) : 0;
    const gross     = bpmBruto(co2, fuelType);
    const bpm       = bpmNetto(co2, fuelType, years);
    const transport = estimateTransport(carZip, carCountry, refZip, transportFixed, transportPer100);
    const total     = Math.round(price + vat + bpm + transport + fixedCosts);

    return {
      settings: { country: { value: 'NL', label: 'Bestemmingsland' } },
      lineItems: [
        {
          key: 'price', label: 'Vraagprijs',
          value: price, unit: 'EUR', included: true,
        },
        {
          key: 'vat', label: 'BTW (21%)',
          value: vat, unit: 'EUR', included: isNew,
          reason: !isNew ? 'Niet van toepassing (gebruikte auto)' : null,
        },
        {
          key: 'bpm', label: 'BPM',
          value: bpm, unit: 'EUR', included: bpm > 0,
          note: bpm > 0 ? {
            valueTooltip: `o.b.v. ${co2}\u00a0g/km CO\u2082 (bruto \u20ac${gross.toLocaleString('nl-NL')})`,
            warning: co2Estimated
              ? `CO\u2082 niet gevonden op pagina \u2014 geschat via ${co2Method ?? 'bouwjaar'}`
              : null,
          } : null,
        },
        {
          key: 'transport', label: 'Transport (schatting)',
          value: transport, unit: 'EUR', included: true,
          note: !carZip ? { warning: 'Postcode auto onbekend \u2014 schatting o.b.v. land' } : null,
        },
        {
          key: 'fixedCosts', label: 'Vaste kosten (RDW e.d.)',
          value: fixedCosts, unit: 'EUR', included: true,
        },
        {
          key: 'total', label: 'Totaal',
          value: total, unit: 'EUR', included: true, isTotal: true,
        },
      ],
    };
  }

  root.CIC_NL = { calculate };
})(window);
