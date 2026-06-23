/**
 * renderer.js — Converts an ImportResult into HTML and injects it into the DOM.
 *
 * Exports via window.CIC_Renderer:
 *   injectListingWidget(result, anchorEl, insertMethod)
 *     — full widget on car detail page
 *     — insertMethod: "afterend" (default) | "beforeend"
 *         "afterend"  → widget als sibling NA anchorEl
 *         "beforeend" → widget als laatste kind BINNEN anchorEl
 *
 *   injectSearchWidget(result, cardEl, wrapperEl)
 *     — compact widget on search results
 *
 * Injectie-strategie:
 *
 *   DETAILPAGINA  — injectListingWidget:
 *     AutoScout24 : anchorEl = price-section, insertMethod = "afterend"
 *                   → widget belandt als sibling na de prijs-sectie
 *                     (nog steeds binnen de sticky sidebar).
 *     Mobile.de   : anchorEl = <section> binnen vip-price-box,
 *                   insertMethod = "afterend"
 *                   → widget belandt na de section maar nóg binnen de
 *                     <article data-testid="vip-price-box">, dus in de
 *                     rechter sticky sidebar.
 *                   Fallback: anchorEl = vip-price-box zelf,
 *                   insertMethod = "beforeend"
 *                   → widget wordt append’d als laatste kind van de box.
 *
 *   ZOEKPAGINA — injectSearchWidget:
 *     wrapperEl = het element warna de widget als sibling wordt geplaatst.
 */

"use strict";

(function (root) {
  const fmt = (n) =>
    new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);

  // ---------------------------------------------------------------------------
  // Listing widget — full cost breakdown (detailpagina)
  // ---------------------------------------------------------------------------

  function buildListingRow(item) {
    if (!item.included && !item.isTotal) return "";

    let labelHtml = item.label;
    if (item.note?.warning) {
      labelHtml += ` <span class="cic-warn" title="${item.note.warning}">&#x26A0;&#xFE0F;</span>`;
    }

    const prefix = item.approx ? "~" : "";
    let valueHtml;
    if (item.note?.valueTooltip) {
      valueHtml = `<span class="cic-tip" title="${item.note.valueTooltip}">${prefix}${fmt(item.value)}</span>`;
    } else {
      valueHtml = `${prefix}${fmt(item.value)}`;
    }

    const cls = item.isTotal ? ' class="cic-total-row"' : "";
    return `<tr${cls}><td>${labelHtml}</td><td class="cic-val">${valueHtml}</td></tr>`;
  }

  /**
   * @param {object}  result        - ImportResult van de calculator
   * @param {Element} anchorEl      - Anchor-element voor injectie
   * @param {string}  [insertMethod="afterend"] - "afterend" | "beforeend"
   */
  function injectListingWidget(result, anchorEl, insertMethod) {
    if (document.getElementById("cic-listing-widget")) return;

    const method = insertMethod ?? "afterend";
    const rows = result.lineItems.map(buildListingRow).join("");

    const widget = document.createElement("div");
    widget.id = "cic-listing-widget";
    widget.innerHTML =
      `<div class="cic-header"><span class="cic-title">Importkosten schatting</span></div>` +
      `<table class="cic-table">${rows}</table>`;

    if (anchorEl) {
      anchorEl.insertAdjacentElement(method, widget);
    } else {
      document.body.prepend(widget);
    }
  }

  // ---------------------------------------------------------------------------
  // Compact search widget (zoekpagina)
  // ---------------------------------------------------------------------------

  function buildCompactRow(item) {
    if (!item.included && !item.isTotal) return "";

    let labelHtml;
    if (item.note?.warning) {
      labelHtml = `${item.label} <span class="cic-compact-estimated">geschat, klik op de advertentie voor een betere schatting</span>`;
    } else {
      labelHtml = item.label;
    }

    const prefix = item.approx ? "~" : "";
    const valueHtml = `${prefix}${fmt(item.value)}`;

    const cls = item.isTotal ? ' class="cic-compact-total"' : "";
    return `<tr${cls}><td>${labelHtml}</td><td>${valueHtml}</td></tr>`;
  }

  /**
   * @param {object}  result       - ImportResult van de calculator
   * @param {Element} cardEl       - Het kaart-element (voor duplicate-check)
   * @param {Element} [wrapperEl]  - Element warna de widget als sibling wordt
   *                                 geplaatst. Fallback: appendChild op cardEl.
   */
  function injectSearchWidget(result, cardEl, wrapperEl) {
    if (!cardEl || cardEl.querySelector(".cic-compact")) return;
    if (wrapperEl?.nextElementSibling?.classList?.contains("cic-compact"))
      return;

    const rows = result.lineItems.map(buildCompactRow).join("");

    const widget = document.createElement("div");
    widget.className = "cic-compact";
    widget.innerHTML =
      `<div class="cic-compact-title">Geschatte importkosten</div>` +
      `<table class="cic-compact-table">${rows}</table>`;

    if (wrapperEl) {
      wrapperEl.insertAdjacentElement("afterend", widget);
    } else {
      cardEl.appendChild(widget);
    }
  }

  root.CIC_Renderer = { injectListingWidget, injectSearchWidget };
})(window);
