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

  const host = window.location.hostname;
  const path = window.location.pathname;

  const SITES = [
    {
      name: "autoscout24",
      match: () => host.includes("autoscout24"),
      scraper: () => window.CIC_AS24,
      calc: () => window.CIC_NL,
      isListing: () => /\/(angebote|annonces|aanbod|annunci)\//.test(path),
      /**
       * Geeft het anchor-element terug waarná de widget wordt geïnjecteerd.
       * AutoScout24: [data-testid="price-section"]
       */
      listingAnchor: () =>
        document.querySelector('[data-testid="price-section"]'),
      /**
       * Geeft voor een zoekkaart het wrapper-element terug waaróp de widget
       * als sibling wordt geplaatst (insertAdjacentElement afterend).
       * AutoScout24: de kaart zelf (article element).
       */
      searchCardWrapper: (cardEl) => cardEl,
    },
    {
      name: "mobile.de",
      match: () =>
        host === "suchen.mobile.de" ||
        host === "www.mobile.de" ||
        host === "mobile.de",
      scraper: () => window.CIC_MDE,
      calc: () => window.CIC_NL,
      isListing: () => path.startsWith("/fahrzeuge/details.html"),
      /**
       * Mobile.de detailpagina: de prijs staat in [data-testid="vip-price-label"].
       * De parent van dat element is de prijs-box. We injecteren ná die parent
       * zodat de widget direct onder de prijs verschijnt, net als op AutoScout24.
       *
       * Fallback-keten:
       *  1. Parent van vip-price-label (de hele prijs-box)
       *  2. vip-price-label zelf
       *  3. vip-price-box
       */
      listingAnchor: () => {
        const priceLabel = document.querySelector(
          '[data-testid="vip-price-label"]',
        );
        if (priceLabel) {
          // Klim omhoog totdat we een wrapper vinden die breed genoeg is
          // (niet een inline <span> maar een block-level container)
          let el = priceLabel;
          while (el.parentElement) {
            el = el.parentElement;
            const style = window.getComputedStyle(el);
            const display = style.display;
            if (
              (display === "block" || display === "flex" || display === "grid") &&
              el.offsetWidth > 100
            ) {
              return el;
            }
          }
          return priceLabel;
        }
        return (
          document.querySelector('[data-testid="vip-price-box"]') ??
          document.querySelector('[data-testid="price"]')
        );
      },
      /**
       * Mobile.de zoekkaart: de kaart is een <a data-testid="result-listing-N">.
       * We geven de kaart zelf terug — de widget wordt ná de kaart geplaatst
       * als een sibling, op dezelfde breedte als de kaart.
       */
      searchCardWrapper: (cardEl) => cardEl,
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
      console.warn(
        "[CarImport] Listing data niet gevonden na meerdere pogingen",
      );
      return;
    }
    const result = calc.calculate(listing, settings);
    if (!result) return;

    // Wacht ook op de anchor (Mobile.de laadt prijs soms na DOM-ready)
    let anchor = null;
    for (let i = 0; i < 20; i++) {
      anchor = site.listingAnchor();
      if (anchor) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!anchor)
      console.warn(
        "[CarImport] Prijs-anchor niet gevonden — widget niet injecteerbaar",
      );

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
    console.warn(
      "[CarImport] Geen zoekresultaten gevonden na meerdere pogingen",
    );
    return;
  }

  for (const listing of cards) {
    const result = calc.calculate(listing, settings);
    if (result) {
      const wrapper = site.searchCardWrapper(listing.el);
      window.CIC_Renderer.injectSearchWidget(result, listing.el, wrapper);
    }
  }

  // Herinjection bij dynamisch laden (infinite scroll / paginering)
  const observer = new MutationObserver(() => {
    const newCards = scraper.scrapeSearchPage();
    if (!newCards) return;
    for (const listing of newCards) {
      if (listing.el.querySelector(".cic-compact")) continue;
      // Check ook of er al een sibling widget is (voor Mobile.de wrapper-injectie)
      const wrapper = site.searchCardWrapper(listing.el);
      if (wrapper?.nextElementSibling?.classList?.contains("cic-compact"))
        continue;
      const result = calc.calculate(listing, settings);
      if (result)
        window.CIC_Renderer.injectSearchWidget(result, listing.el, wrapper);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
