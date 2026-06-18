/**
 * Scraper voor AutoScout24 advertentiepagina's.
 *
 * AutoScout24 gebruikt voor alle landsites (.de, .it, .be, etc.)
 * grotendeels dezelfde HTML-structuur. De selectors hieronder
 * zijn gebaseerd op de huidige DOM (juni 2026). Controleer bij
 * een layout-update of de selectors nog kloppen.
 *
 * @returns {CarData|null}
 *
 * @typedef {Object} CarData
 * @property {number}  price      - Vraagprijs in EUR
 * @property {number|null} year   - Bouwjaar
 * @property {string}  fuelType   - 'petrol'|'diesel'|'electric'|'hybrid'
 * @property {string}  make       - Merk (bijv. 'BMW')
 * @property {string}  model      - Model (bijv. '3 Series')
 * @property {number|null} mileage - Kilometerstand
 * @property {string}  currency   - ISO-valutacode (bijv. 'EUR')
 */
export function scrapeAutoscout24() {
  try {
    // --- Prijs ---
    // AutoScout24 plaatst de prijs in [data-testid="price-section"] of een <span> met klasse die 'price' bevat
    const priceEl =
      document.querySelector('[data-testid="price-section"] .cldt-price') ??
      document.querySelector('[data-testid="price"]') ??
      document.querySelector('.cldt-price');

    const priceRaw = priceEl?.textContent ?? '';
    // Verwijder alles wat geen cijfer is (€, punt, komma, spaties)
    const price = parsePrice(priceRaw);

    if (!price) return null;

    // --- Bouwjaar ---
    const year = scrapeDetailValue(['Erstzulassung', 'First registration', 'Immatricolazione',
      'Eerste registratie', '1ère mise en circulation', 'Primera matriculación']);
    const parsedYear = year ? parseInt(year.slice(-4), 10) : null; // "01/2019" → 2019

    // --- Brandstof ---
    const fuelRaw = scrapeDetailValue(['Kraftstoff', 'Fuel type', 'Carburante',
      'Brandstof', 'Carburant', 'Combustible']) ?? '';
    const fuelType = normalizeFuelType(fuelRaw);

    // --- Kilometerstand ---
    const mileageRaw = scrapeDetailValue(['Kilometerstand', 'Mileage', 'Chilometri',
      'Kilometerstand', 'Kilométrage', 'Kilometraje']) ?? '';
    const mileage = parsePrice(mileageRaw); // zelfde parselogica: strip non-digits

    // --- Merk & Model uit paginatitel ---
    const titleEl = document.querySelector('h1');
    const titleParts = titleEl?.textContent?.trim().split(' ') ?? [];
    const make = titleParts[0] ?? 'Onbekend';
    const model = titleParts.slice(1, 3).join(' ') || 'Onbekend';

    return { price, year: parsedYear, fuelType, make, model, mileage, currency: 'EUR' };
  } catch (e) {
    console.warn('[CarImport] Scrape fout:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Zoekt een waarde in de detail-tabel op basis van een lijst van labelnamen.
 * AutoScout24 toont specs als <dt>Label</dt><dd>Waarde</dd> paren.
 */
function scrapeDetailValue(labels) {
  const dts = document.querySelectorAll('dt');
  for (const dt of dts) {
    const text = dt.textContent.trim();
    if (labels.some((l) => text.toLowerCase().includes(l.toLowerCase()))) {
      return dt.nextElementSibling?.textContent?.trim() ?? null;
    }
  }
  return null;
}

/** Strip alles behalve cijfers en zet om naar number. */
function parsePrice(raw) {
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

/** Normaliseer brandstoftypes naar onze interne waarden. */
function normalizeFuelType(raw) {
  const lower = raw.toLowerCase();
  if (lower.includes('elektr') || lower.includes('electric') || lower.includes('bev')) return 'electric';
  if (lower.includes('diesel')) return 'diesel';
  if (lower.includes('hybrid') || lower.includes('phev') || lower.includes('hev')) return 'hybrid';
  return 'petrol'; // benzine / LPG / overig → petrol als fallback
}
