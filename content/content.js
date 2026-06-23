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
       * Mobile.de sidebar-structuur (live DOM, jun 2026):
       *
       *   <div>                                     ← sidebar wrapper
       *     <div>                                   ← dealer-box wrapper  ← anchor
       *       <article data-testid="vip-dealer-box">
       *         ...dealer info, telefoonnummer, e-mail, parken, teilen...
       *       </article>
       *     </div>
       *     <div>                                   ← widget komt hier (afterend)
       *       ...prijs info...
       *       [data-testid="vip-price-label"]
       *     </div>
       *   </div>
       *
       * Waarom vorige pogingen faalden:
       *   - vip-price-box bestaat NIET in de live DOM (alleen in opgeslagen HTML)
       *   - vip-price-label komt TWEE KEER voor: één keer in de linker
       *     hoofdkolom (Preis/Finanzierung sectie) en één keer in de sidebar.
       *     querySelector() pakt altijd de eerste = linker kolom. ✗
       *
       * Oplossing: gebruik vip-dealer-box als sidebar-ankerpunt.
       *   - vip-dealer-box is aantoonbaar aanwezig in de live DOM (de scraper
       *     gebruikt hem al voor vip-dealer-box-seller-address2).
       *   - vip-dealer-box.parentElement = de <div> wrapper rondom de article.
       *   - insertAdjacentElement("afterend") op die wrapper plaatst de widget
       *     als volgende sibling: direct ónder de dealer-box, nog steeds
       *     binnen de sidebar. ✓
       *
       * Prioriteitsvolgorde:
       *  1. vip-dealer-box.parentElement → afterend ✓  (ideaal)
       *  2. vip-dealer-box zelf          → afterend ✓  (bijna hetzelfde)
       *  3. sidebar-container via breedte-heuristiek → beforeend ✓
       *  4. absolute fallback: eerste vip-price-label (links, beter dan niets)
       */
      listingAnchor: () => {
        const dealerBox = document.querySelector(
          '[data-testid="vip-dealer-box"]',
        );
        if (dealerBox) {
          return dealerBox.parentElement ?? dealerBox;
        }

        // Fallback: zoek de sidebar via breedte van vip-dealer-box-seller-address2
        const addrEl = document.querySelector(
          '[data-testid="vip-dealer-box-seller-address2"]',
        );
        if (addrEl) {
          let el = addrEl;
          while (el.parentElement && el.parentElement !== document.body) {
            el = el.parentElement;
            const rect = el.getBoundingClientRect();
            // Sidebar is smaller dan de hoofdkolom (< 55% viewport breedte)
            // en heeft een zinvolle breedte (> 200px)
            if (rect.width > 200 && rect.width < window.innerWidth * 0.55) {
              return el;
            }
          }
        }

        // Absolute fallback
        return document.querySelector('[data-testid="vip-price-label"]') ?? null;
      },
      listingInsertMethod: (anchorEl) => {
        if (!anchorEl) return "afterend";
        // parentElement van dealer-box of dealer-box zelf → afterend (sibling)
        // sidebar container → beforeend (als laatste kind)
        const testid = anchorEl.getAttribute?.("data-testid") ?? "";
        if (testid === "vip-dealer-box") return "afterend";
        // Als het een grote container is (sidebar) → beforeend
        const rect = anchorEl.getBoundingClientRect();
        if (rect.width > 200 && rect.width < window.innerWidth * 0.55) {
          return "beforeend";
        }
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
