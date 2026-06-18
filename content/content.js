// Content Script — draait in de context van de webpagina
// Heeft toegang tot de DOM, maar NIET tot chrome.storage direct

(function () {
  'use strict';

  // Stuur paginadata naar de background service worker
  function sendPageData(data) {
    chrome.runtime.sendMessage({ type: 'PAGE_DATA', payload: data });
  }

  // Voorbeeld: detecteer autoprijzen op de huidige pagina
  function detectCarData() {
    // TODO: implementeer site-specifieke selectors
    // bijv. voor AutoScout24, Marktplaats, Mobile.de etc.
    const data = {
      url: window.location.href,
      title: document.title,
    };
    sendPageData(data);
  }

  detectCarData();
})();
