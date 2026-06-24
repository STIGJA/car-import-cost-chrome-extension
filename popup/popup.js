/**
 * popup.js
 */

import {
  getSettings,
  saveSettings,
  resetSettings,
  SETTING_DEFAULTS,
  TRANSPORT_DEFAULTS,
} from "../utils/settings.js";

const { bpmBruto, bpmNetto, estimateCO2 } = window.CIC_BPM;

const fmt = (n) =>
  new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
    });
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.add("hidden"));
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    document
      .getElementById(`tab-${tab.dataset.tab}`)
      .classList.remove("hidden");
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const settings = await getSettings();

const fixedCostsEl = document.getElementById("fixedCosts");
fixedCostsEl.value = settings.fixedCosts ?? SETTING_DEFAULTS.fixedCosts;

const TRANSPORT_COUNTRIES = [
  "DE",
  "BE",
  "FR",
  "IT",
  "ES",
  "AT",
  "CH",
  "PL",
  "OTHER",
];
const transportMap = {
  ...TRANSPORT_DEFAULTS,
  ...(settings.transportByCountry ?? {}),
};

for (const cc of TRANSPORT_COUNTRIES) {
  const el = document.getElementById(`t-${cc}`);
  if (el) el.value = transportMap[cc] ?? TRANSPORT_DEFAULTS[cc];
}

function saveTransport() {
  const map = {};
  for (const cc of TRANSPORT_COUNTRIES) {
    const el = document.getElementById(`t-${cc}`);
    const val = parseFloat(el?.value);
    map[cc] = isNaN(val) ? TRANSPORT_DEFAULTS[cc] : val;
  }
  saveSettings({ transportByCountry: map });
}

fixedCostsEl.addEventListener("change", () => {
  const val = parseFloat(fixedCostsEl.value);
  if (!isNaN(val) && val >= 0) saveSettings({ fixedCosts: val });
});

for (const cc of TRANSPORT_COUNTRIES) {
  document.getElementById(`t-${cc}`)?.addEventListener("change", saveTransport);
}

document
  .getElementById("resetSettingsBtn")
  .addEventListener("click", async () => {
    await resetSettings();
    fixedCostsEl.value = SETTING_DEFAULTS.fixedCosts;
    for (const cc of TRANSPORT_COUNTRIES) {
      const el = document.getElementById(`t-${cc}`);
      if (el) el.value = TRANSPORT_DEFAULTS[cc];
    }
  });

// ---------------------------------------------------------------------------
// Pre-fill current month + year
// ---------------------------------------------------------------------------
const now = new Date();
document.getElementById("regMonth").value = String(now.getMonth() + 1);
document.getElementById("regYear").value = String(now.getFullYear());

// ---------------------------------------------------------------------------
// Calculate
// ---------------------------------------------------------------------------
document.getElementById("calculateBtn").addEventListener("click", () => {
  const price = parseFloat(document.getElementById("carPrice").value);
  const regMonth =
    parseInt(document.getElementById("regMonth").value, 10) || null;
  const regYear =
    parseInt(document.getElementById("regYear").value, 10) || null;
  const fuelType = document.getElementById("fuelType").value;
  const co2Input = parseFloat(document.getElementById("co2").value) || null;
  const country = document.getElementById("calcCountry").value;

  if (!price) return;

  const co2Estimated = !co2Input;
  const co2 = co2Input ?? estimateCO2(fuelType, regYear);

  const ageMonths =
    regMonth && regYear
      ? (Date.now() - new Date(regYear, regMonth - 1, 1).getTime()) /
        (1000 * 60 * 60 * 24 * 30.44)
      : null;
  const ageYears = ageMonths != null ? ageMonths / 12 : 3;
  const isNew = ageMonths != null && ageMonths < 6;

  const currentFixed =
    parseFloat(fixedCostsEl.value) || SETTING_DEFAULTS.fixedCosts;
  const currentTransMap = {};
  for (const cc of TRANSPORT_COUNTRIES) {
    const el = document.getElementById(`t-${cc}`);
    const val = parseFloat(el?.value);
    currentTransMap[cc] = isNaN(val) ? TRANSPORT_DEFAULTS[cc] : val;
  }
  const transport = currentTransMap[country] ?? currentTransMap["OTHER"] ?? 600;

  const vat = isNew ? Math.round(price * 0.21) : 0;
  const gross = bpmBruto(co2, fuelType, regYear);
  const bpm = bpmNetto(co2, fuelType, ageYears, regYear);

  const total = Math.round(price + vat + bpm + transport + currentFixed);

  const rows = [];
  rows.push(["Vraagprijs", fmt(price), null]);
  if (isNew) rows.push(["BTW (21%)", fmt(vat), null]);

  if (fuelType === "electric") {
    rows.push(["BPM", fmt(bpm), { valueTooltip: `Starttarief ${regYear ?? new Date().getFullYear()}` }]);
  } else {
    const bpmTooltip = `o.b.v. ${co2}\u00a0g/km CO\u2082 (bruto ${fmt(gross)})`;
    const bpmWarning = co2Estimated
      ? `CO\u2082 geschat o.b.v. bouwjaar ${regYear ?? "?"}`
      : null;
    rows.push([
      "BPM",
      fmt(bpm),
      { valueTooltip: bpmTooltip, labelWarning: bpmWarning },
    ]);
  }

  rows.push(["Transport", fmt(transport), null]);
  rows.push(["Vaste kosten (RDW e.d.)", fmt(currentFixed), null]);

  const table = document.getElementById("results-table");
  table.innerHTML =
    rows
      .map(([label, value, meta]) => {
        const labelHtml = meta?.labelWarning
          ? `${label} <span title="${meta.labelWarning}" style="cursor:help">&#x26A0;&#xFE0F;</span>`
          : label;
        const valueHtml = meta?.valueTooltip
          ? `<span title="${meta.valueTooltip}" style="cursor:help;text-decoration:underline dotted">${value}</span>`
          : value;
        return `<tr><td>${labelHtml}</td><td>${valueHtml}</td></tr>`;
      })
      .join("") +
    `<tr class="row-total"><td>Totaal</td><td>${fmt(total)}</td></tr>`;

  document.getElementById("r-note").textContent = isNew
    ? ""
    : ageMonths != null
      ? "BTW niet van toepassing (gebruikte auto)."
      : "Registratiedatum onbekend \u2014 BTW niet berekend.";

  document.getElementById("results").hidden = false;
});
