/**
 * content.js — Orchestrator
 *
 * Volgorde van uitvoering:
 *   1. Detecteer site en paginatype
 *   2. Laad settings uit chrome.storage
 *   3. Wacht op DOM-data (AS24 is een React SPA)
 *   4. Scrape → ListingInfo
 *   5. Bereken → ImportResult  (calculator o.b.v. bestemmingsland)
 *   6. Render → widget of badge
 *
 * Afhankelijkheden (geladen via manifest content_scripts in volgorde):
 *   content/lookups/co2-lookup.js      → window.CIC_Lookups
 *   content/lookups/depreciation.js    → window.CIC_Depreciation
 *   content/calculators/nl-import.js   → window.CIC_NL
 *   content/sites/autoscout24.js       → window.CIC_AS24
 *   content/renderer.js                → window.CIC_Renderer
 */

(async function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Hulpfunctie: wacht tot scrapeFn iets teruggeeft (React SPA laadt async)
  // -------------------------------------------------------------------------
  async function waitForData(scrapeFn, retries = 15, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
      const result = scrapeFn();
      if (result && (result.price || (Array.isArray(result) && result.length))) return result;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    console.warn('[CarImport] Data niet gevonden na', retries, 'pogingen.');
    return null;
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  const settings = await new Promise((resolve) =>
    chrome.storage.sync.get({ originIsOutsideEU: true }, resolve)
  );

  // -------------------------------------------------------------------------
  // Site- en paginatype-detectie
  // -------------------------------------------------------------------------
  const host = window.location.hostname;
  const path = window.location.pathname;

  const SITES = [
    {
      match:      () => host.includes('autoscout24'),
      scraper:    () => window.CIC_AS24,
      calculator: () => window.CIC_NL,
      isListing:  () => /\/(angebote|annonces|aanbod|annunci)\//.test(path),
    },
    // Toekomstige sites:
    // { match: () => host.includes('mobile.de'),   scraper: () => window.CIC_MobileDe,  ... },
    // { match: () => host.includes('2dehands.be'), scraper: () => window.CIC_2deHands,  ... },
  ];

  const site = SITES.find((s) => s.match());
  if (!site) {
    console.log('[CarImport] Geen ondersteunde site:', host);
    return;
  }

  const scraper    = site.scraper();
  const calculator = site.calculator();
  const isListing  = site.isListing();

  console.log('[CarImport] Gestart op', host, isListing ? '(advertentie)' : '(zoekresultaten)');

  // -------------------------------------------------------------------------
  // Advertentiepagina
  // -------------------------------------------------------------------------
  if (isListing) {
    const listing = await waitForData(() => scraper.scrapeListingPage());
    if (!listing?.price) return;

    const result  = calculator.calculate(listing, settings);
    const anchor  = document.querySelector('[data-testid="price-section"]');
    window.CIC_Renderer.injectListingWidget(result, anchor);
    return;
  }

  // -------------------------------------------------------------------------
  // Zoekresultatenpagina
  // -------------------------------------------------------------------------
  const cards = await waitForData(() => scraper.scrapeSearchPage());
  if (!cards?.length) return;

  for (const listing of cards) {
    const result = calculator.calculate(listing, settings);
    window.CIC_Renderer.injectSearchBadge(result, listing.el);
  }
})();
