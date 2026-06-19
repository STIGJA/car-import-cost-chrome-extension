/**
 * renderer.js — Zet een ImportResult om naar HTML en injecteert het in de DOM
 *
 * Weet niets van berekeningen, sites of CO2 — puur een view-laag.
 *
 * Geëxporteerd als:
 *   window.CIC_Renderer.injectListingWidget(importResult, anchorEl)
 *   window.CIC_Renderer.injectSearchBadge(importResult, cardEl)
 */

'use strict';

(function (root) {
  const fmt = (n) =>
    new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

  // -------------------------------------------------------------------------
  // Advertentiepagina — volledig widget
  // -------------------------------------------------------------------------

  function injectListingWidget(result, anchorEl) {
    if (document.getElementById('cic-listing-widget')) return;

    const rows = result.lineItems.map((item) => {
      // Overgeslagen posten (bijv. BTW bij gebruikte auto) geheel weglaten
      if (!item.included && !item.isTotal) return '';

      // Label: waarschuwingsicoon als CO2 geschat is
      let labelHtml = item.label;
      if (item.note?.warning) {
        labelHtml +=
          ` <span title="${item.note.warning}" ` +
          `style="cursor:help;" aria-label="Geschatte waarde">\u26a0\ufe0f</span>`;
      }

      // Waarde-cel: tooltip met CO2-basis
      let valueHtml;
      if (item.note?.valueTooltip) {
        valueHtml =
          `<span title="${item.note.valueTooltip}" style="cursor:help;text-decoration:underline dotted;">` +
          `${fmt(item.value)}</span>`;
      } else {
        valueHtml = fmt(item.value);
      }

      const style = item.isTotal
        ? 'font-weight:700;border-top:1px solid #ff9800;padding-top:4px;'
        : '';

      return `<tr style="${style}"><td>${labelHtml}</td><td style="text-align:right">${valueHtml}</td></tr>`;
    }).join('');

    const widget = document.createElement('div');
    widget.id = 'cic-listing-widget';
    widget.style.cssText = [
      'background:#fff3e0', 'border:2px solid #ff9800', 'border-radius:8px',
      'padding:12px 16px',  'margin:12px 0',            'font-family:sans-serif',
      'font-size:14px',     'line-height:1.7',
    ].join(';');

    widget.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px;">\ud83c\uddf3\ud83c\uddf1 Importkosten naar Nederland</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    `;

    if (anchorEl) anchorEl.insertAdjacentElement('afterend', widget);
    else          document.body.prepend(widget);
  }

  // -------------------------------------------------------------------------
  // Zoekresultatenpagina — klein badge op kaart
  // -------------------------------------------------------------------------

  function injectSearchBadge(result, cardEl) {
    if (cardEl.querySelector('.cic-badge')) return;

    const total = result.lineItems.find((i) => i.isTotal);
    if (!total) return;

    const badge = document.createElement('div');
    badge.className = 'cic-badge';
    badge.style.cssText = [
      'background:#ff9800', 'color:#fff',         'border-radius:4px',
      'padding:2px 8px',    'font-size:12px',      'font-weight:700',
      'display:inline-block', 'margin-top:4px',
    ].join(';');
    badge.textContent = `\ud83c\uddf3\ud83c\uddf1 ${fmt(total.value)}`;

    for (const span of cardEl.querySelectorAll('span')) {
      const val = parseInt(span.textContent.replace(/[^0-9]/g, ''), 10);
      if (val && val > 500) { span.insertAdjacentElement('afterend', badge); break; }
    }
  }

  root.CIC_Renderer = { injectListingWidget, injectSearchBadge };
})(window);
