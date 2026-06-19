/**
 * settings.js — Lees/schrijf extensie-instellingen via chrome.storage.sync
 *
 * Beschikbare instellingen:
 *   postcode  {string}  Referentiepostcode (voor toekomstige transportkostenschatting)
 */

'use strict';

const DEFAULTS = {
  postcode: '',
};

export function getSettings() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, resolve));
}

export function saveSettings(partial) {
  return new Promise((resolve) => chrome.storage.sync.set(partial, resolve));
}
