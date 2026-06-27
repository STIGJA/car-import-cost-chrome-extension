/**
 * nl-import.js — Berekening importkosten Nederland (EU-scope)
 *
 * Transport: vaste kosten instelbaar in popup-instellingen.
 */

"use strict";

(function (root) {
  const DEFAULT_FIXED_COSTS = 200;
  const DEFAULT_TRANSPORT_COST = 350;

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
    return d
      ? (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      : null;
  }
  function ageYearsFrom(v) {
    const m = ageMonthsFrom(v);
    return m != null ? m / 12 : 3;
  }
  function registrationYearFrom(v) {
    const d = parseDate(v);
    return d ? d.getFullYear() : new Date().getFullYear();
  }

  // ---------------------------------------------------------------------------
  // Main
  // ---------------------------------------------------------------------------
  function calculate(listing, settings = {}) {
    const { bpmBruto, bpmNetto, estimateCO2 } = root.CIC_BPM;

    const price = listing.price.value;
    const fuelType = listing.fuelType.value;
    const firstReg = listing.firstRegDate?.value ?? null;
    const fixedCosts = settings.fixedCosts ?? DEFAULT_FIXED_COSTS;
    const transport = settings.transportCost ?? DEFAULT_TRANSPORT_COST;

    const co2 = listing.co2.value ?? estimateCO2(fuelType, listing.year?.value);
    const co2Estimated =
      listing.co2.source === "estimated" || listing.co2.value == null;
    const co2Method = listing.co2.method ?? null;

    const months = ageMonthsFrom(firstReg);
    const isNew = months != null && months < 6;
    const years = ageYearsFrom(firstReg);
    const regYear = registrationYearFrom(firstReg) ?? listing.year?.value ?? new Date().getFullYear();

    const vat = isNew ? Math.round(price * 0.21) : 0;
    const gross = bpmBruto(co2, fuelType, regYear);
    const bpmExact = bpmNetto(co2, fuelType, years, regYear);

    // Als CO2 geschat is: afronden op dichtstbijzijnde €100 en ~ prefix tonen
    const bpmDisplay = co2Estimated
      ? Math.round(bpmExact / 100) * 100
      : bpmExact;
    const bpmApprox = co2Estimated;

    const total = Math.round(price + vat + bpmExact + transport + fixedCosts);
    // Totaal afronden op €100 en ~ tonen als BPM geschat is
    const totalDisplay = bpmApprox ? Math.round(total / 100) * 100 : total;

    return {
      settings: { country: { value: "NL", label: "Bestemmingsland" } },
      lineItems: [
        {
          key: "price",
          label: "Vraagprijs",
          value: price,
          unit: "EUR",
          included: true,
        },
        {
          key: "vat",
          label: "BTW (21%)",
          value: vat,
          unit: "EUR",
          included: isNew,
          reason: !isNew ? "Niet van toepassing (gebruikte auto)" : null,
        },
        {
          key: "bpm",
          label: "BPM",
          value: bpmDisplay,
          approx: bpmApprox,
          unit: "EUR",
          included: true,
          note:
            bpmExact > 0
              ? {
                  valueTooltip: `o.b.v. ${co2}\u00a0g/km CO\u2082 (bruto \u20ac${gross.toLocaleString("nl-NL")})`,
                  warning: co2Estimated
                    ? `CO\u2082/km niet gevonden. BPM geschat o.b.v. ${co2Method ?? "bouwjaar"}`
                    : null,
                }
              : null,
        },
        {
          key: "transport",
          label: "Transport",
          value: transport,
          unit: "EUR",
          included: transport > 0,
        },
        {
          key: "fixedCosts",
          label: "Vaste kosten (RDW etc.)",
          value: fixedCosts,
          unit: "EUR",
          included: fixedCosts > 0,
        },
        {
          key: "total",
          label: "Totaal",
          value: totalDisplay,
          approx: bpmApprox,
          unit: "EUR",
          included: true,
          isTotal: true,
        },
      ],
    };
  }

  root.CIC_NL = { calculate };
})(window);
