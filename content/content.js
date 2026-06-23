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
       * Mobile.de sidebar-structuur (bevestigd via DevTools, jun 2026):
       *
       *   <div data-testid="vip-desktop-p">    ← desktop wrapper
       *     <aside>                            ← DE sidebar (enige <aside> hierin)
       *       <article>
       *         <section>
       *           <h2>BMW M5</h2>
       *           ...prijs, dealer info...
       *           <div data-testid="seller-title-address">
       *         </section>
       *       </article>
       *                                        ← widget komt hier (beforeend)
       *     </aside>
       *   </div>
       *
       * Selector: [data-testid="vip-desktop-p"] aside
       * insertMethod: "beforeend" → appended als laatste kind van de aside.
       *
       * Fallback-keten:
       *  1. aside binnen vip-desktop-p  → beforeend  ✓
       *  2. vip-desktop-p zelf          → beforeend  ✓
       *  3. vip-dealer-box.parentElement → afterend  ✓
       *  4. vip-dealer-box              → afterend  ✓
       */
      listingAnchor: () => {
        // Primaire selector: de <aside> binnen de desktop price wrapper
        const desktopWrapper = document.querySelector(
          '[data-testid="vip-desktop-p"]',
        );
        if (desktopWrapper) {
          const aside = desktopWrapper.querySelector("aside");
          if (aside) return aside;
          return desktopWrapper;
        }

        // Fallback 1: vip-dealer-box.parentElement (vorige strategie)
        const dealerBox = document.querySelector(
          '[data-testid="vip-dealer-box"]',
        );
        if (dealerBox) {
          return dealerBox.parentElement ?? dealerBox;
        }

        // Absolute fallback
        return document.querySelector('[data-testid="vip-price-label"]') ?? null;
      },
      listingInsertMethod: (anchorEl) => {
        if (!anchorEl) return "afterend";
        const tag = anchorEl.tagName.toLowerCase();
        // <aside> of wrapper-div → beforeend (append als laatste kind)
        if (tag === "aside" || tag === "div") return "beforeend";
        // vip-dealer-box article of parentElement → afterend
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
