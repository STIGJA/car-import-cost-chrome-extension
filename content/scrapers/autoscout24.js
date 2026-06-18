/**
 * Scraper: AutoScout24
 *
 * Twee functies:
 *   scrapeListingPage() — volledige data van één advertentie
 *   scrapeSearchPage()  — basisdata per kaart in zoekresultaten
 *
 * AutoScout24 gebruikt voor .de/.nl/.be/.fr grotendeels dezelfde
 * HTML-structuur. Meertalige labels zijn als array opgegeven.
 *
 * Let op: AS24 is een React SPA. De DOM kan na pageload nog laden.
 * content.js gebruikt waitForData() om hiermee om te gaan.
 */

// ---------------------------------------------------------------------------
// Advertentiepagina
// ---------------------------------------------------------------------------

export function scrapeListingPage() {
  try {
    const price = parseNumber(
      document.querySelector('[data-testid="price-section"] .cldt-price')?.textContent ??
      document.querySelector('[data-testid="price"]')?.textContent ??
      document.querySelector('.cldt-price')?.textContent
    );
    if (!price) return null;

    const year = parseYear(
      scrapeDetailValue(['Erstzulassung', 'First registration', 'Eerste registratie', '1ère mise en circulation'])
    );

    const fuelRaw = scrapeDetailValue(['Kraftstoff', 'Fuel type', 'Brandstof', 'Carburant']) ?? '';
    const fuelType = normalizeFuelType(fuelRaw);

    // CO2 g/km — basis voor BPM berekening
    const co2Raw = scrapeDetailValue(['CO2-Emissionen', 'CO2 emissions', 'CO2-uitstoot', 'Émissions CO2']);
    const co2 = co2Raw ? parseNumber(co2Raw) : null;

    const mileageRaw = scrapeDetailValue(['Kilometerstand', 'Mileage', 'Kilométrage']);
    const mileage = mileageRaw ? parseNumber(mileageRaw) : null;

    const h1 = document.querySelector('h1')?.textContent?.trim() ?? '';
    const [make, ...rest] = h1.split(' ');
    const model = rest.slice(0, 2).join(' ');

    return { price, year, fuelType, co2, mileage, make: make || '?', model: model || '' };
  } catch (e) {
    console.warn('[CarImport] scrapeListingPage fout:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Zoekresultatenpagina
// ---------------------------------------------------------------------------

export function scrapeSearchPage() {
  // AS24 zoekkaarten: elk resultaat zit in een article[data-item-name] of een
  // listitem met een prijs-element. We returnen een array van { el, price, year, fuelType }.
  const cards = document.querySelectorAll('article[data-item-name], [data-testid="listing-item"]');
  if (!cards.length) return null;

  const results = [];
  for (const card of cards) {
    const priceEl = card.querySelector('[data-testid="price"], .cldt-price, [class*="price"]');
    const price = parseNumber(priceEl?.textContent);
    if (!price) continue;

    // Bouwjaar uit de spec-tekst in de kaart (bijv. "01/2019 • 120.000 km")
    const specsText = card.querySelector('[data-testid="listing-specs"], [class*="spec"]')?.textContent ?? '';
    const yearMatch = specsText.match(/(19|20)\d{2}/);
    const year = yearMatch ? parseInt(yearMatch[0], 10) : null;

    const fuelRaw = card.querySelector('[data-testid="fuel-type"], [class*="fuel"]')?.textContent ?? '';
    const fuelType = normalizeFuelType(fuelRaw);

    results.push({ el: card, price, year, fuelType, co2: null });
  }

  return results.length ? results : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scrapeDetailValue(labels) {
  for (const dt of document.querySelectorAll('dt')) {
    const text = dt.textContent.trim().toLowerCase();
    if (labels.some((l) => text.includes(l.toLowerCase()))) {
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

function parseYear(raw) {
  if (!raw) return null;
  const m = raw.match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

export function normalizeFuelType(raw) {
  const l = raw.toLowerCase();
  if (l.includes('elektr') || l.includes('electric') || l.includes('bev')) return 'electric';
  if (l.includes('diesel')) return 'diesel';
  if (l.includes('hybrid') || l.includes('phev') || l.includes('hev')) return 'hybrid';
  return 'petrol';
}
