/**
 * Scraper plugin: AutoScout24
 * Werkt op alle landversies (.de, .it, .be, .nl, .fr, .es)
 *
 * @returns {CarData|null}
 */
export function scrapeAutoscout24() {
  try {
    // --- Prijs ---
    const priceEl =
      document.querySelector('[data-testid="price-section"] .cldt-price') ??
      document.querySelector('[data-testid="price"]') ??
      document.querySelector('.cldt-price');

    const price = parseNumber(priceEl?.textContent);
    if (!price) return null;

    // --- Bouwjaar ---
    const yearRaw = scrapeDetailValue([
      'Erstzulassung', 'First registration', 'Immatricolazione',
      'Eerste registratie', '1ère mise en circulation', 'Primera matriculación',
    ]);
    const year = yearRaw ? parseInt(yearRaw.slice(-4), 10) : null;

    // --- Brandstof ---
    const fuelRaw = scrapeDetailValue([
      'Kraftstoff', 'Fuel type', 'Carburante', 'Brandstof', 'Carburant', 'Combustible',
    ]) ?? '';
    const fuelType = normalizeFuelType(fuelRaw);

    // --- CO2 (voor nauwkeurigere BPM) ---
    const co2Raw = scrapeDetailValue(['CO2-Emissionen', 'CO2 emissions', 'Emissioni CO2', 'CO2-uitstoot']);
    const co2 = co2Raw ? parseNumber(co2Raw) : null;

    // --- Kilometerstand ---
    const mileageRaw = scrapeDetailValue([
      'Kilometerstand', 'Mileage', 'Chilometri', 'Kilométrage', 'Kilometraje',
    ]);
    const mileage = mileageRaw ? parseNumber(mileageRaw) : null;

    // --- Merk & model ---
    const titleEl = document.querySelector('h1');
    const titleParts = titleEl?.textContent?.trim().split(' ') ?? [];
    const make = titleParts[0] ?? 'Onbekend';
    const model = titleParts.slice(1, 3).join(' ') || 'Onbekend';

    return { price, year, fuelType, co2, make, model, mileage, currency: 'EUR' };
  } catch (e) {
    console.warn('[CarImport] AutoScout24 scrape fout:', e);
    return null;
  }
}

// --- Helpers ---

function scrapeDetailValue(labels) {
  for (const dt of document.querySelectorAll('dt')) {
    if (labels.some((l) => dt.textContent.trim().toLowerCase().includes(l.toLowerCase()))) {
      return dt.nextElementSibling?.textContent?.trim() ?? null;
    }
  }
  return null;
}

function parseNumber(raw) {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

function normalizeFuelType(raw) {
  const l = raw.toLowerCase();
  if (l.includes('elektr') || l.includes('electric') || l.includes('bev')) return 'electric';
  if (l.includes('diesel')) return 'diesel';
  if (l.includes('hybrid') || l.includes('phev') || l.includes('hev')) return 'hybrid';
  return 'petrol';
}
