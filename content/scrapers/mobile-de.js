/**
 * Scraper plugin: Mobile.de
 *
 * Mobile.de gebruikt server-side rendered HTML met
 * data-* attributen en een JSON-LD script block.
 *
 * @returns {CarData|null}
 */
export function scrapeMobileDe() {
  try {
    // Probeer eerst JSON-LD (meest betrouwbaar)
    const jsonLd = extractJsonLd();
    if (jsonLd) return jsonLd;

    // Fallback: DOM scraping
    return scrapeDom();
  } catch (e) {
    console.warn('[CarImport] Mobile.de scrape fout:', e);
    return null;
  }
}

function extractJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      const vehicle = Array.isArray(data) ? data.find((d) => d['@type'] === 'Car') : data;
      if (!vehicle) continue;

      const price = vehicle.offers?.price ?? vehicle.price;
      if (!price) continue;

      const fuelRaw = vehicle.fuelType ?? '';
      return {
        price: parseInt(price, 10),
        year: vehicle.vehicleModelDate ? parseInt(vehicle.vehicleModelDate, 10) : null,
        fuelType: normalizeFuelType(fuelRaw),
        co2: null, // niet in JSON-LD spec
        make: vehicle.brand?.name ?? vehicle.manufacturer ?? 'Onbekend',
        model: vehicle.model ?? 'Onbekend',
        mileage: vehicle.mileageFromOdometer?.value
          ? parseInt(vehicle.mileageFromOdometer.value, 10)
          : null,
        currency: vehicle.offers?.priceCurrency ?? 'EUR',
      };
    } catch (_) {
      continue;
    }
  }
  return null;
}

function scrapeDom() {
  const priceEl =
    document.querySelector('[data-testid="prime-price"]') ??
    document.querySelector('.price-block__price') ??
    document.querySelector('[class*="price"]');

  const price = priceEl ? parseInt(priceEl.textContent.replace(/[^0-9]/g, ''), 10) : null;
  if (!price) return null;

  return {
    price,
    year: null,
    fuelType: 'petrol',
    co2: null,
    make: 'Onbekend',
    model: 'Onbekend',
    mileage: null,
    currency: 'EUR',
  };
}

function normalizeFuelType(raw) {
  const l = raw.toLowerCase();
  if (l.includes('elektr') || l.includes('electric')) return 'electric';
  if (l.includes('diesel')) return 'diesel';
  if (l.includes('hybrid')) return 'hybrid';
  return 'petrol';
}
