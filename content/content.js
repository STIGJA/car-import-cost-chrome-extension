/**
 * Content Script — AutoScout24
 *
 * Werkt op zowel zoekresultaten- als advertentiepagina's.
 * Detecteert het paginatype en injecteert het widget op de juiste plek.
 */

import { scrapeListingPage, scrapeSearchPage } from './scrapers/autoscout24.js';
import { injectListingWidget, injectSearchWidgets } from './widget.js';
import { calculateImportCosts } from '../utils/calculator.js';
import { getSettings } from '../utils/settings.js';

(async function () {
  'use strict';

  const settings = await getSettings();
  const path = window.location.pathname;

  // Advertentiepagina: /angebote/... of /annonces/... etc.
  const isListing = /\/(angebote|annonces|aanbod|annunci)\//.test(path);

  if (isListing) {
    await handleListingPage(settings);
  } else {
    await handleSearchPage(settings);
  }
})();

// ---------------------------------------------------------------------------

async function handleListingPage(settings) {
  const carData = await waitForData(scrapeListingPage);
  if (!carData?.price) return;

  const costs = calculateImportCosts(carData, settings);
  injectListingWidget(carData, costs);
}

async function handleSearchPage(settings) {
  const cards = await waitForData(scrapeSearchPage);
  if (!cards?.length) return;

  injectSearchWidgets(cards, settings);
}

/**
 * Herprobeert scrapeFn totdat er data is (SPA-pagina's laden asynchroon).
 */
async function waitForData(scrapeFn, retries = 10, delayMs = 400) {
  for (let i = 0; i < retries; i++) {
    const result = scrapeFn();
    if (result && (result.price || result.length)) return result;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
