/**
 * Instellingen via chrome.storage.sync
 *
 * Huidig ondersteunde instellingen:
 *   originIsOutsideEU  {boolean}  true = invoerrechten 6,5% van toepassing
 */

const DEFAULTS = {
  originIsOutsideEU: true,
};

export function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, resolve);
  });
}

export function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settings, resolve);
  });
}
