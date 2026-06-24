(async function () {
  "use strict";

  async function waitFor(scrapeFn, validate, retries = 25, delayMs = 400) {
    for (let i = 0; i < retries; i++) {
      try {
        const result = scrapeFn();
        if (validate(result)) return result;
      } catch (e) {
        console.warn("[CarImport] scrape attempt", i + 1, "failed:", e);
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
      // Only activate on suchen.mobile.de — www.mobile.de and mobile.de
      // are the homepage/redirects and contain no car cards.
      match: () => host === "suchen.mobile.de",
      scraper: () => window.CIC_MDE,
      calc: () => window.CIC_NL,
      isListing: () => path.startsWith("/fahrzeuge/details.html"),
      /**
       * Anchor resolution order (most to least specific):
       *  1. <section> inside vip-price-box          → afterend
       *  2. <div> direct child of vip-price-box     → afterend
       *  3. vip-price-box article itself             → beforeend
       *  4. vip-price-label (standalone price el)   → afterend
       *  5. vehicle-detail-main (last resort)        → afterend
       */
      listingAnchor: () => {
        const priceBox = document.querySelector(
          'article[data-testid="vip-price-box"]',
        );
        if (priceBox) {
          const section = priceBox.querySelector("section");
          if (section) return section;
          const div = priceBox.querySelector(":scope > div");
          if (div) return div;
          return priceBox;
        }
        return (
          document.querySelector('[data-testid="vip-price-label"]') ??
          document.querySelector('[data-testid="vehicle-detail-main"]') ??
          null
        );
      },
      listingInsertMethod: (anchorEl) => {
        if (!anchorEl) return "afterend";
        if (
          anchorEl.tagName.toLowerCase() === "article" &&
          anchorEl.dataset?.testid === "vip-price-box"
        )
          return "beforeend";
        return "afterend";
      },
      searchCardWrapper: (cardEl) => cardEl,
    },
  ];

  const site = SITES.find((s) => s.match());
  if (!site) return;

  const scraper = site.scraper();
  const calc = site.calc();
  const isListing = site.isListing();

  // For mobile.de: only run search scraper on the actual search results page.
  const isSearchPage =
    site.name === "mobile.de"
      ? path.startsWith("/fahrzeuge/search.html")
      : true;

  if (!scraper) {
    console.error("[CarImport] Scraper not loaded for:", site.name);
    return;
  }
  if (!calc) {
    console.error("[CarImport] Calculator (CIC_NL) not loaded");
    return;
  }

  // Bail out silently if not on a listing or search page we handle.
  if (!isListing && !isSearchPage) return;

  console.log(
    `[CarImport] Active on ${site.name} —`,
    isListing ? "listing" : "search",
    `| ${host}${path}`,
  );

  if (isListing) {
    const listing = await waitFor(
      () => scraper.scrapeListingPage(),
      (r) => r?.price?.value > 0,
    );
    if (!listing) {
      console.warn("[CarImport] Listing data not found after retries");
      return;
    }

    const result = calc.calculate(listing, settings);
    if (!result) return;

    let anchor = null;
    for (let i = 0; i < 20; i++) {
      anchor = site.listingAnchor();
      if (anchor) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!anchor) {
      console.warn("[CarImport] Price anchor not found — widget not injectable");
      return;
    }

    const insertMethod =
      typeof site.listingInsertMethod === "function"
        ? site.listingInsertMethod(anchor)
        : (site.listingInsertMethod ?? "afterend");

    window.CIC_Renderer.injectListingWidget(result, anchor, insertMethod);
    return;
  }

  const cards = await waitFor(
    () => scraper.scrapeSearchPage(),
    (r) => Array.isArray(r) && r.length > 0,
  );
  if (!cards) {
    console.warn("[CarImport] No search results found after retries");
    return;
  }

  for (const listing of cards) {
    const result = calc.calculate(listing, settings);
    if (result) {
      const wrapper = site.searchCardWrapper(listing.el);
      window.CIC_Renderer.injectSearchWidget(result, listing.el, wrapper);
    }
  }

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
