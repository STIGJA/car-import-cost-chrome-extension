/**
 * renderer.js — Converts an ImportResult into HTML and injects it into the DOM.
 *
 * Exports via window.CIC_Renderer:
 *   injectListingWidget(result, anchorEl)  — full widget on car detail page
 *   injectSearchWidget(result, cardEl)     — compact cost breakdown on search result cards
 */

'use strict';

(function (root) {

  const fmt = (n) =>
    new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

  // ---------------------------------------------------------------------------
  // Listing widget — full cost breakdown
  // ---------------------------------------------------------------------------

  function buildListingRow(item) {
    if (!item.included && !item.isTotal) return '';

    let labelHtml = item.label;
    if (item.note?.warning) {
      labelHtml += ` <span class="cic-warn" title="${item.note.warning}">&#x26A0;&#xFE0F;</span>`;
    }

    let valueHtml;
    if (item.note?.valueTooltip) {
      valueHtml = `<span class="cic-tip" title="${item.note.valueTooltip}">${fmt(item.value)}</span>`;
    } else {
      valueHtml = fmt(item.value);
    }

    const cls = item.isTotal ? ' class="cic-total-row"' : '';
    return `<tr${cls}><td>${labelHtml}</td><td class="cic-val">${valueHtml}</td></tr>`;
  }

  function injectListingWidget(result, anchorEl) {
    if (document.getElementById('cic-listing-widget')) return;

    const rows = result.lineItems.map(buildListingRow).join('');

    const widget = document.createElement('div');
    widget.id = 'cic-listing-widget';
    widget.innerHTML =
      `<div class="cic-header"><span class="cic-title">Importkosten schatting</span></div>` +
      `<table class="cic-table">${rows}</table>`;

    if (anchorEl) anchorEl.insertAdjacentElement('afterend', widget);
    else document.body.prepend(widget);
  }

  // ---------------------------------------------------------------------------
  // Compact search widget
  // ---------------------------------------------------------------------------

  function buildCompactRow(item) {
    if (!item.included && !item.isTotal) return '';

    let valueHtml = fmt(item.value);
    if (item.note?.valueTooltip) {
      valueHtml = `<span class="cic-tip" title="${item.note.valueTooltip}">${valueHtml}</span>`;
    }
    if (item.note?.warning) {
      valueHtml += ` <span class="cic-warn" title="${item.note.warning}">&#x26A0;&#xFE0F;</span>`;
    }

    const cls = item.isTotal ? ' class="cic-compact-total"' : '';
    return `<tr${cls}><td>${item.label}</td><td>${valueHtml}</td></tr>`;
  }

function injectSearchWidget(result, cardEl) {
  if (!cardEl || cardEl.querySelector('.cic-compact')) return;

  const rows = result.lineItems.map(buildCompactRow).join('');

  const widget = document.createElement('div');
  widget.className = 'cic-compact';
  widget.innerHTML =
    `<div class="cic-compact-title">Geschatte importkosten</div>` +
    `<table class="cic-compact-table">${rows}</table>`;

  // Altijd onderaan de kaart toevoegen, niet naast de prijs
  cardEl.appendChild(widget);
}

  root.CIC_Renderer = { injectListingWidget, injectSearchWidget };

})(window);
