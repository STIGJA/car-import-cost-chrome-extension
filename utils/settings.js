/**
 * Instellingen opslaan/lezen via chrome.storage.sync
 *
 * Standaardinstellingen:
 *   destinationCountry: 'NL'
 *   originIsOutsideEU:  true  (bepaalt of invoerrechten gelden)
 */

const DEFAULTS = {
  destinationCountry: 'NL',
  originIsOutsideEU: true,
};

export function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (result) => {
      resolve(result);
    });
  });
}

export function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settings, resolve);
  });
}
