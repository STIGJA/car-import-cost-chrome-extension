// Service Worker — draait op de achtergrond, geen DOM toegang
// Luistert naar berichten van content scripts en popup

chrome.runtime.onInstalled.addListener(() => {
  console.log('[CarImport] Extension installed.');
});

// Voorbeeld: ontvang berichten van content script of popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PAGE_DATA') {
    // Hier kun je data ophalen van externe API's (bijv. BPM tabellen, RDW)
    sendResponse({ status: 'ok', data: null });
  }
  return true; // Houdt de message channel open voor async responses
});
