/**
 * renderer.js — Converts an ImportResult into HTML and injects it into the DOM.
 *
 * Responsibilities: rendering only.
 * No calculation logic, no site-specific scraping, no CO2 lookups.
 *
 * Exports (via window.CIC_Renderer):
 *   injectListingWidget(importResult, anchorEl)  — full widget on car detail page
 *   injectSearchBadge(importResult, cardEl)       — compact badge on search result cards
 */

'use strict';

(function (root) {

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const fmt = (n) =>
    new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

  /**
   * Builds a single <tr> for the cost breakdown table.
   * Returns an empty string for line items that are excluded and not the total.
   */
  function buildTableRow(item) {
    if (!item.included && !item.isTotal) return '';

    // Label cell — add warning icon when CO2 value was estimated
    let labelHtml = item.label;
    if (item.note?.warning) {
      labelHtml +=
        ` <span class="cic-warning-icon" title="${item.note.warning}" aria-label="Estimated value">\u26a0\ufe0f</span>`;
    }

    // Value cell — add dotted underline when a tooltip with calculation detail is available
    let valueHtml;
    if (item.note?.valueTooltip) {
      valueHtml =
        `<span class="cic-tooltip-trigger" title="${item.note.valueTooltip}">` +
        `${fmt(item.value)}</span>`;
    } else {
      valueHtml = fmt(item.value);
    }

    const rowClass = item.isTotal ? ' class="cic-total-row"' : '';
    return `<tr${rowClass}><td>${labelHtml}</td><td class="cic-val">${valueHtml}</td></tr>`;
  }

  // ---------------------------------------------------------------------------
  // Listing widget — full cost breakdown on the car detail page
  // ---------------------------------------------------------------------------

  function injectListingWidget(result, anchorEl) {
    if (document.getElementById('cic-listing-widget')) return;

    const rows = result.lineItems.map(buildTableRow).join('');

    const widget = document.createElement('div');
    widget.id = 'cic-listing-widget';
    widget.innerHTML = `
      <div class="cic-header">
        <span class="cic-flag">\ud83c\uddf3\ud83c\uddf1</span>
        <span class="cic-title">Import costs to the Netherlands</span>
      </div>
      <table class="cic-table">${rows}</table>
    `;

    if (anchorEl) anchorEl.insertAdjacentElement('afterend', widget);
    else          document.body.prepend(widget);
  }

  // ---------------------------------------------------------------------------
  // Search badge — compact total shown on each search result card
  // ---------------------------------------------------------------------------

  function injectSearchBadge(result, cardEl) {
    if (cardEl.querySelector('.cic-badge')) return;

    const total = result.lineItems.find((item) => item.isTotal);
    if (!total) return;

    const badge = document.createElement('div');
    badge.className = 'cic-badge';
    badge.innerHTML =
      `<span class="cic-badge-label">\ud83c\uddf3\ud83c\uddf1 Total NL</span>` +
      `<span class="cic-badge-value">${fmt(total.value)}</span>`;

    // Insert after the first element that looks like a price (numeric value > 500)
    for (const span of cardEl.querySelectorAll('span')) {
      const val = parseInt(span.textContent.replace(/[^0-9]/g, ''), 10);
      if (val && val > 500) {
        span.insertAdjacentElement('afterend', badge);
        break;
      }
    }
  }

  root.CIC_Renderer = { injectListingWidget, injectSearchBadge };

})(window);
