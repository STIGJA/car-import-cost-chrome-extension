/**
 * Content Script — orkestrator
 *
 * Detecteert de huidige site, laadt de juiste scraper-plugin,
 * berekent importkosten voor het opgegeven doelland en injecteert het widget.
 */

import { scrapeAutoscout24 } from './scrapers/autoscout24.js';
import { scrapeMobileDe } from './scrapers/mobile-de.js';
import { injectWidget } from './widget.js';
import { calculateImportCosts } from '../utils/calculator.js';
import { getSettings } from '../utils/settings.js';

// ---------------------------------------------------------------------------
// Site-plugin registry
// Voeg hier simpelweg een nieuwe scraper toe voor elke nieuwe site.
// ---------------------------------------------------------------------------
const SCRAPERS = [
  {
    test: (host) => host.includes('autoscout24'),
    scrape: scrapeAutoscout24,
    siteName: 'AutoScout24',
  },
  {
    test: (host) => host.includes('mobile.de'),
    scrape: scrapeMobileDe,
    siteName: 'Mobile.de',
  },
  // TODO: Marktplaats.nl, La Centrale (FR), Autovit (PL), ...
];

// ---------------------------------------------------------------------------

(async function () {
  'use strict';

  const host = window.location.hostname;
  const plugin = SCRAPERS.find((s) => s.test(host));
  if (!plugin) return;

  // Wacht tot de DOM stabiel is (SPA's laden asynchroon)
  const carData = await waitForData(plugin.scrape);
  if (!carData || !carData.price) return;

  // Laad gebruikersinstellingen (doelland, instellingen)
  const settings = await getSettings();

  const costs = calculateImportCosts({
    price: carData.price,
    year: carData.year ?? new Date().getFullYear() - 3,
    fuelType: carData.fuelType ?? 'petrol',
    co2: carData.co2 ?? null,
    destinationCountry: settings.destinationCountry ?? 'NL',
  });

  injectWidget({ carData, costs, siteName: plugin.siteName, settings });
})();

/**
 * Probeert de scraper tot 10x (met 300ms pauze) totdat er data is.
 * Nodig voor React/Next.js SPA's die asynchroon renderen.
 */
async function waitForData(scrapeFn, retries = 10, delay = 300) {
  for (let i = 0; i < retries; i++) {
    const data = scrapeFn();
    if (data?.price) return data;
    await new Promise((r) => setTimeout(r, delay));
  }
  return null;
}
