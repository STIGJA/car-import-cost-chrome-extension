/**
 * content.js — Orchestrator
 */

(async function () {
  "use strict";

  async function waitForListing(scrapeFn, retries = 20, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
      try {
        const result = scrapeFn();
        if (result?.price?.value) return result;
      } catch (e) {
        console.warn("[CarImport] scrape poging", i + 1, "fout:", e);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    console.warn("[CarImport] Listing data niet gevonden.");
    return null;
  }

  async function waitForCards(scrapeFn, retries = 20, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
      try {
        const result = scrapeFn();
        if (Array.isArray(result) && result.length) return result;
      } catch (e) {
        console.warn("[CarImport] scrape poging", i + 1, "fout:", e);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    console.warn("[CarImport] Zoekresultaten niet gevonden.");
    return null;
  }

  const settings = await new Promise((resolve) =>
    chrome.storage.sync.get(
      { postcode: "", fixedCosts: 170, transportByCountry: null },
      resolve,
    ),
  );

  const host = window.location.hostname;
  const path = window.location.pathname;

  const SITES = [
    {
      match: () => host.includes("autoscout24"),
      scraper: () => window.CIC_AS24,
      calc: () => window.CIC_NL,
      isListing: () => /\/(angebote|annonces|aanbod|annunci)\//.test(path),
    },
    {
      match: () => host.includes("mobile.de"),
      scraper: () => window.CIC_MDE,
      calc: () => window.CIC_NL,
      // Mobile.de advertentiepagina's bevatten "/fahrzeug-inserate/" of "/auto/" in het pad
      isListing: () => /\/fahrzeug-inserate\/|fahrzeugdetails\/|\/auto\/[^/]+-[0-9]+/.test(path),
    },
  ];

  const site = SITES.find((s) => s.match());
  if (!site) {
    console.log("[CarImport] Site niet herkend:", host);
    return;
  }

  const scraper = site.scraper();
  const calc = site.calc();
  const isListing = site.isListing();

  if (!scraper) {
    console.error("[CarImport] Scraper niet geladen:", host);
    return;
  }
  if (!calc) {
    console.error("[CarImport] Calculator niet geladen (CIC_NL undefined)");
    return;
  }

  console.log(
    "[CarImport] Gestart op",
    host,
    isListing ? "(advertentie)" : "(zoekresultaten)",
  );

  if (isListing) {
    const listing = await waitForListing(() => scraper.scrapeListingPage());
    if (!listing) return;
    const result = calc.calculate(listing, settings);
    if (!result) return;
    // Probeer platform-specifieke anchor, val terug op eerste prijs-element
    const anchor =
      document.querySelector('[data-testid="price-section"]') ??
      document.querySelector('[data-testid="price"]') ??
      document.querySelector('[class*="PriceInfo"]') ??
      document.querySelector('[class*="VehiclePrice"]');
    if (!anchor) {
      console.warn("[CarImport] prijs-anchor niet gevonden");
    }
    window.CIC_Renderer.injectListingWidget(result, anchor);
    return;
  }

  const cards = await waitForCards(() => scraper.scrapeSearchPage());
  if (!cards) return;

  for (const listing of cards) {
    const result = calc.calculate(listing, settings);
    if (result) window.CIC_Renderer.injectSearchWidget(result, listing.el);
  }

  const observer = new MutationObserver(() => {
    const newCards = scraper.scrapeSearchPage();
    if (!newCards) return;
    for (const listing of newCards) {
      if (listing.el.querySelector(".cic-compact")) continue;
      const result = calc.calculate(listing, settings);
      if (result) window.CIC_Renderer.injectSearchWidget(result, listing.el);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
