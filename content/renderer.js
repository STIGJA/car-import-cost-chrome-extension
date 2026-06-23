/**
 * renderer.js — Converts an ImportResult into HTML and injects it into the DOM.
 *
 * Exports via window.CIC_Renderer:
 *   injectListingWidget(result, anchorEl)            — full widget on car detail page
 *   injectSearchWidget(result, cardEl, wrapperEl)    — compact widget on search results
 *
 * Injectie-strategie:
 *
 *   DETAILPAGINA  — injectListingWidget:
 *     Widget wordt ná anchorEl geplaatst met insertAdjacentElement("afterend").
 *     anchorEl is de prijs-box (block-level container van de prijs).
 *     Dit werkt identiek voor AutoScout24 en Mobile.de.
 *
 *   ZOEKPAGINA — injectSearchWidget:
 *     AutoScout24: de article-kaart is de wrapper; widget wordt ná de kaart
 *                  geplaatst als sibling → volledige breedte van de kaart.
 *     Mobile.de  : de <a data-testid="result-listing-N"> is de wrapper;
 *                  widget wordt eveneens ná de wrapper geplaatst als sibling.
 *
 *     wrapperEl  = het element waarná de widget als sibling wordt geplaatst
 *                  (meegegeven vanuit content.js via site.searchCardWrapper()).
 *     cardEl     = het element waarop we checken of de widget al bestaat
 *                  (voorkomt dubbele injectie).
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

  function injectListingWidget(result, anchorEl) {
    if (document.getElementById("cic-listing-widget")) return;

    const rows = result.lineItems.map(buildListingRow).join("");

    const widget = document.createElement("div");
    widget.id = "cic-listing-widget";
    widget.innerHTML =
      `<div class="cic-header"><span class="cic-title">Importkosten schatting</span></div>` +
      `<table class="cic-table">${rows}</table>`;

    if (anchorEl) anchorEl.insertAdjacentElement("afterend", widget);
    else document.body.prepend(widget);
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
   * @param {object} result     - ImportResult van de calculator
   * @param {Element} cardEl    - Het kaart-element (voor duplicate-check)
   * @param {Element} [wrapperEl] - Element waarná de widget als sibling wordt
   *                               geplaatst. Als niet opgegeven valt terug op
   *                               appendChild op cardEl (oud gedrag).
   */
  function injectSearchWidget(result, cardEl, wrapperEl) {
    // Voorkom dubbele injectie
    if (!cardEl || cardEl.querySelector(".cic-compact")) return;
    if (wrapperEl?.nextElementSibling?.classList?.contains("cic-compact"))
      return;

    const rows = result.lineItems.map(buildCompactRow).join("");

    const widget = document.createElement("div");
    widget.className = "cic-compact";
    widget.innerHTML =
      `<div class="cic-compact-title">Geschatte importkosten</div>` +
      `<table class="cic-compact-table">${rows}</table>`;

    if (wrapperEl && wrapperEl !== cardEl) {
      // Injecteer ná de wrapper als sibling — widget krijgt dezelfde breedte
      // als de wrapper/kaart doordat het in dezelfde parent-context zit.
      wrapperEl.insertAdjacentElement("afterend", widget);
    } else if (wrapperEl) {
      // wrapperEl === cardEl: ook als sibling plaatsen (Mobile.de & AS24 na refactor)
      wrapperEl.insertAdjacentElement("afterend", widget);
    } else {
      // Fallback: append binnen kaart (oud gedrag)
      cardEl.appendChild(widget);
    }
  }

  root.CIC_Renderer = { injectListingWidget, injectSearchWidget };
})(window);
