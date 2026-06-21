/**
 * content.js — Orchestrator
 */

(async function () {
  'use strict';

  async function waitForData(scrapeFn, retries = 20, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
      const result = scrapeFn();
      if (result && (result.price || (Array.isArray(result) && result.length))) return result;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    console.warn('[CarImport] Data niet gevonden na', retries, 'pogingen.');
    return null;
  }

  const settings = await new Promise((resolve) =>
    chrome.storage.sync.get(
      { postcode: '', fixedCosts: 170, transportByCountry: null },
      resolve
    )
  );

  const host = window.location.hostname;
  const path = window.location.pathname;

  const SITES = [
    {
      match:     () => host.includes('autoscout24'),
      scraper:   () => window.CIC_AS24,
      calc:      () => window.CIC_NL,
      isListing: () => /\/(angebote|annonces|aanbod|annunci)\//.test(path),
    },
  ];

  const site = SITES.find((s) => s.match());
  if (!site) return;

  const scraper   = site.scraper();
  const calc      = site.calc();
  const isListing = site.isListing();

  console.log('[CarImport] Gestart op', host, isListing ? '(advertentie)' : '(zoekresultaten)');

  if (isListing) {
    const listing = await waitForData(() => scraper.scrapeListingPage());
    if (!listing?.price) return;
    const result = calc.calculate(listing, settings);
    const anchor = document.querySelector('[data-testid="price-section"]');
    window.CIC_Renderer.injectListingWidget(result, anchor);
    return;
  }

  const cards = await waitForData(() => scraper.scrapeSearchPage());
  if (!cards?.length) return;

  for (const listing of cards) {
    const result = calc.calculate(listing, settings);
    window.CIC_Renderer.injectSearchWidget(result, listing.el);
  }

  const observer = new MutationObserver(() => {
    const newCards = scraper.scrapeSearchPage();
    if (!newCards) return;
    for (const listing of newCards) {
      if (listing.el.querySelector('.cic-compact')) continue;
      const result = calc.calculate(listing, settings);
      window.CIC_Renderer.injectSearchWidget(result, listing.el);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
