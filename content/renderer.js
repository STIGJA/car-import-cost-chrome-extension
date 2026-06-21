/**
 * renderer.js — Converts an ImportResult into HTML and injects it into the DOM.
 *
 * Responsibilities: rendering only.
 * No calculation logic, no site-specific scraping, no CO2 lookups.
 *
 * Exports (via window.CIC_Renderer):
 *   injectListingWidget(importResult, anchorEl)  — full widget on car detail page
 *   injectSearchWidget(importResult, cardEl)      — compact cost breakdown on search result cards
 */

'use strict';

(function (root) {

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const fmt = (n) =>
    new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

  /**
   * Builds a <tr> for the full listing widget cost table.
   * Returns empty string for excluded line items that are not the total.
   */
  function buildListingRow(item) {
    if (!item.included && !item.isTotal) return '';

    // Label cell — add warning icon when CO2 value was estimated
    let labelHtml = item.label;
    if (item.note?.warning) {
      labelHtml +=
        ` <span class="cic-warning-icon" title="${item.note.warning}" aria-label="Geschatte waarde">&#x26A0;&#xFE0F;</span>`;
    }

    // Value cell — dotted underline when a calculation tooltip is available
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

  /**
   * Builds a <tr> for the compact search widget table.
   * Skips rows that are not included and not the total.
   */
  function buildCompactRow(item) {
    if (!item.included && !item.isTotal) return '';

    const rowClass = item.isTotal ? ' class="cic-compact-total"' : '';
    const valueHtml = item.note?.valueTooltip
      ? `<span class="cic-tooltip-trigger" title="${item.note.valueTooltip}">${fmt(item.value)}</span>`
      : fmt(item.value);

    return `<tr${rowClass}><td>${item.label}</td><td>${valueHtml}</td></tr>`;
  }

  // ---------------------------------------------------------------------------
  // Listing widget — full cost breakdown on the car detail page
  // ---------------------------------------------------------------------------

  function injectListingWidget(result, anchorEl) {
    if (document.getElementById('cic-listing-widget')) return;

    const rows = result.lineItems.map(buildListingRow).join('');

    const widget = document.createElement('div');
    widget.id = 'cic-listing-widget';
    widget.innerHTML = `
      <div class="cic-header">
        <span class="cic-title">Geschatte importkosten</span>
      </div>
      <table class="cic-table">${rows}</table>
    `;

    if (anchorEl) anchorEl.insertAdjacentElement('afterend', widget);
    else          document.body.prepend(widget);
  }

  // ---------------------------------------------------------------------------
  // Compact search widget — cost breakdown on each search result card
  // ---------------------------------------------------------------------------

  function injectSearchWidget(result, cardEl) {
    if (cardEl.querySelector('.cic-compact')) return;

    const rows = result.lineItems.map(buildCompactRow).join('');

    const widget = document.createElement('div');
    widget.className = 'cic-compact';
    widget.innerHTML =
      `<div class="cic-compact-title">Geschatte importkosten</div>` +
      `<table class="cic-compact-table">${rows}</table>`;

    // Insert after the first element that looks like a price (numeric value > 500)
    for (const span of cardEl.querySelectorAll('span')) {
      const val = parseInt(span.textContent.replace(/[^0-9]/g, ''), 10);
      if (val && val > 500) {
        span.insertAdjacentElement('afterend', widget);
        return;
      }
    }

    // Fallback: append at the end of the card
    cardEl.appendChild(widget);
  }

  root.CIC_Renderer = { injectListingWidget, injectSearchWidget };

})(window);
