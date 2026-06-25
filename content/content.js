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
      // Listing URL path segments per locale:
      //   DE : /angebote/
      //   FR : /offres/
      //   BE NL: /aanbod/
      //   BE FR: /annonces/
      //   IT : /annunci/
      isListing: () =>
        /\/(angebote|annonces|aanbod|annunci|offres)\//.test(path),
      listingAnchor: () => {
        // AutoScout24 detail page — the price block sits inside an <aside>
        // or a sticky sidebar div. Try known selectors in order of specificity.
        // NOTE: [data-testid="price-section"] exists only on search cards, NOT
        // on detail pages. On the detail page the price lives in a section/div
        // with class containing "cldt-price" or inside an <aside>.
        return (
          document.querySelector('[data-testid="price-section"]') ??
          document.querySelector('[class*="cldt-price-section"]') ??
          document.querySelector('[class*="PriceSection"]') ??
          document.querySelector('[class*="price-section"]') ??
          document.querySelector('aside [class*="price"]') ??
          document.querySelector("aside") ??
          document.querySelector('[data-testid="seller-section"]') ??
          null
        );
      },
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
      listingAnchor: () => {
        // mobile.de detail page — there is no article[data-testid="vip-price-box"].
        // The price label [data-testid="vip-price-label"] is the most reliable
        // anchor. Walk up to its nearest section or div container so we can
        // insert the widget after the entire price block, not just the label.
        const priceLabel =
          document.querySelector('[data-testid="vip-price-label"]') ??
          document.querySelector('[data-testid="price-label"]') ??
          document.querySelector('[data-testid="vip-price"]');

        if (priceLabel) {
          // Walk up max 4 levels to find a meaningful container
          // (section, article, or a div that is a direct child of the sidebar)
          let el = priceLabel;
          for (let i = 0; i < 4; i++) {
            const parent = el.parentElement;
            if (!parent) break;
            const tag = parent.tagName.toLowerCase();
            if (tag === "section" || tag === "article") return parent;
            // Stop if the parent is clearly the sidebar/page root
            if (tag === "aside" || tag === "main" || tag === "body") return el;
            el = parent;
          }
          return el;
        }

        // Broad fallbacks
        return (
          document.querySelector('[data-testid="vehicle-detail-main"]') ??
          document.querySelector('[data-testid="vip-contact-box"]') ??
          null
        );
      },
      listingInsertMethod: () => "afterend",
      searchCardWrapper: (cardEl) => cardEl,
    },
  ];

  const site = SITES.find((s) => s.match());
  if (!site) return;

  const scraper = site.scraper();
  const calc = site.calc();
  const isListing = site.isListing();

  // For mobile.de: only run the search scraper on the actual search results page.
  // For autoscout24: /lst/ (FR) and standard search paths are search pages.
  let isSearchPage;
  if (site.name === "mobile.de") {
    isSearchPage = path.startsWith("/fahrzeuge/search.html");
  } else {
    // autoscout24: treat any non-listing page as a potential search page
    // common search paths: /lst/, /results/, /search/
    isSearchPage = !isListing;
  }

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
