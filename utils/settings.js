/**
 * settings.js — Read/write extension settings via chrome.storage.sync.
 *
 * Available settings:
 *   fixedCosts          {number}  Fixed administrative costs (RDW fees, inspection, etc.)
 *   transportByCountry  {object}  Fixed transport cost per origin country code

 */

'use strict';

export const TRANSPORT_DEFAULTS = {
  DE: 350,
  BE: 150,
  FR: 500,
};

export const SETTING_DEFAULTS = {
  fixedCosts:         200,
  transportByCountry: TRANSPORT_DEFAULTS,

};

export function getSettings() {
  return new Promise((resolve) => chrome.storage.sync.get(SETTING_DEFAULTS, resolve));
}

export function saveSettings(partial) {
  return new Promise((resolve) => chrome.storage.sync.set(partial, resolve));
}

export function resetSettings() {
  return new Promise((resolve) => chrome.storage.sync.set(SETTING_DEFAULTS, resolve));
}
