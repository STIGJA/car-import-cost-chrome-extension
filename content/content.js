/**
 * content.js — Orchestrator
 *
 * Site-detectie:
 *  AutoScout24 : host bevat 'autoscout24'
 *                isListing → URL pad bevat /angebote/ | /annonces/ | /aanbod/ | /annunci/
 *
 *  Mobile.de   : hostname === 'suchen.mobile.de'
 *                isListing → pad begint met /fahrzeuge/details.html
 *                isSearch  → pad begint met /fahrzeuge/search.html
 */

(async function () {
  "use strict";

  async function waitFor(scrapeFn, validate, retries = 25, delayMs = 400) {
    for (let i = 0; i < retries; i++) {
      try {
        const result = scrapeFn();
        if (validate(result)) return result;
      } catch (e) {
        console.warn("[CarImport] scrape poging", i + 1, "fout:", e);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  }

  const settings = await new Promise((resolve) =>
    chrome.storage.sync.get(
      { postcode: "", fixedCosts: 170, transportByCountry: null },
      resolve,
    ),
  );

  const host = window.location.hostname; // bijv. 'suchen.mobile.de'
  const path = window.location.pathname;

  const SITES = [
    {
      name: "autoscout24",
      match: () => host.includes("autoscout24"),
      scraper: () => window.CIC_AS24,
      calc: () => window.CIC_NL,
      isListing: () => /\/(angebote|annonces|aanbod|annunci)\//.test(path),
    },
    {
      name: "mobile.de",
      // Mobile.de zoekpagina en detailpagina draaien op suchen.mobile.de
      match: () => host === "suchen.mobile.de" || host === "www.mobile.de" || host === "mobile.de",
      scraper: () => window.CIC_MDE,
      calc: () => window.CIC_NL,
      // Detailpagina: suchen.mobile.de/fahrzeuge/details.html?id=XXXXX
      isListing: () => path.startsWith("/fahrzeuge/details.html"),
    },
  ];

  const site = SITES.find((s) => s.match());
  if (!site) {
    console.log("[CarImport] Site niet herkend:", host, path);
    return;
  }

  const scraper = site.scraper();
  const calc = site.calc();
  const isListing = site.isListing();

  if (!scraper) {
    console.error("[CarImport] Scraper niet geladen voor:", site.name);
    return;
  }
  if (!calc) {
    console.error("[CarImport] Calculator (CIC_NL) niet geladen");
    return;
  }

  console.log(
    `[CarImport] Actief op ${site.name} —`,
    isListing ? "detailpagina" : "zoekresultaten",
    `| ${host}${path}`,
  );

  // -------------------------------------------------------------------------
  // Detailpagina
  // -------------------------------------------------------------------------
  if (isListing) {
    const listing = await waitFor(
      () => scraper.scrapeListingPage(),
      (r) => r?.price?.value > 0,
    );
    if (!listing) {
      console.warn("[CarImport] Listing data niet gevonden na meerdere pogingen");
      return;
    }
    const result = calc.calculate(listing, settings);
    if (!result) return;

    // Anchor voor widget-injectie
    // AutoScout24 : [data-testid="price-section"]
    // Mobile.de   : [data-testid="vip-price-box"]
    const anchor =
      document.querySelector('[data-testid="price-section"]') ??
      document.querySelector('[data-testid="vip-price-box"]') ??
      document.querySelector('[data-testid="vip-price-label"]') ??
      document.querySelector('[data-testid="price"]');

    if (!anchor) {
      console.warn("[CarImport] Prijs-anchor niet gevonden — widget niet injecteerbaar");
    }
    window.CIC_Renderer.injectListingWidget(result, anchor);
    return;
  }

  // -------------------------------------------------------------------------
  // Zoekpagina
  // -------------------------------------------------------------------------
  const cards = await waitFor(
    () => scraper.scrapeSearchPage(),
    (r) => Array.isArray(r) && r.length > 0,
  );
  if (!cards) {
    console.warn("[CarImport] Geen zoekresultaten gevonden na meerdere pogingen");
    return;
  }

  for (const listing of cards) {
    const result = calc.calculate(listing, settings);
    if (result) window.CIC_Renderer.injectSearchWidget(result, listing.el);
  }

  // Herinjection bij dynamisch laden (infinite scroll / paginering)
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
