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
       * AutoScout24: injecteer ná [data-testid="price-section"].
       * De widget belandt in de rechterzijbalk omdat price-section zelf
       * al een child is van de sticky sidebar.
       */
      listingAnchor: () =>
        document.querySelector('[data-testid="price-section"]'),
      listingInsertMethod: () => "afterend",
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
       * Mobile.de layout (geverifieerd op opgeslagen HTML):
       *
       *   <div class="lAeeF">                ← rechterzijbalk
       *     <div>
       *       <article data-testid="vip-dealer-box"> ... </article>
       *     </div>
       *     <div>
       *       <article data-testid="vip-price-box">  ← prijsblok
       *         <section>                            ← prijs + knoppen
       *           ...
       *           [data-testid="vip-price-label"]
       *         </section>
       *       </article>
       *     </div>
       *   </div>
       *
       * Prioriteitsvolgorde:
       *  1. <section> binnen vip-price-box → insertMethod "afterend"
       *     Plaatst de widget als sibling ná de section, maar nog steeds
       *     binnen de <article> (en dus de rechterzijbalk). ✓
       *  2. vip-price-box zelf → insertMethod "beforeend"
       *     Widget wordt als laatste kind van de article toegevoegd. ✓
       *  3. vip-price-label → insertMethod "afterend"
       *     Uiterste fallback; widget komt direct na het prijslabel. ✓
       *
       * De vroegere generieke DOM-walk (zoekende naar een breed block-element)
       * is verwijderd omdat die te vaak in de hoofdkolom terechtkwam.
       */
      listingAnchor: () => {
        const priceBox = document.querySelector(
          '[data-testid="vip-price-box"]',
        );
        if (priceBox) {
          const section = priceBox.querySelector("section");
          if (section) return section;
          return priceBox;
        }
        // Laatste fallback: direct ná het prijslabel
        return document.querySelector('[data-testid="vip-price-label"]') ?? null;
      },
      /**
       * insertMethod bepaalt hoe de widget t.o.v. de anchor wordt geplaatst:
       *  - "afterend"  → als sibling NA de anchor (buiten anchor-element)
       *  - "beforeend" → als laatste kind BINNEN de anchor
       */
      listingInsertMethod: (anchorEl) => {
        if (!anchorEl) return "afterend";
        const tag = anchorEl.tagName.toLowerCase();
        // <section> binnen de article → afterend blijft binnen de article ✓
        if (tag === "section") return "afterend";
        // vip-price-box article zelf → append als laatste kind ✓
        if (tag === "article") return "beforeend";
        // vip-price-label of ander element → afterend (dicht bij de prijs)
        return "afterend";
      },
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

    const insertMethod =
      typeof site.listingInsertMethod === "function"
        ? site.listingInsertMethod(anchor)
        : site.listingInsertMethod ?? "afterend";

    window.CIC_Renderer.injectListingWidget(result, anchor, insertMethod);
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
