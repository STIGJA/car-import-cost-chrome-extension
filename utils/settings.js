/**
 * settings.js — Read/write extension settings via chrome.storage.sync.
 *
 * Available settings:
 *   postcode   {string}  Reference postcode for transport cost estimation
 *   fixedCosts {number}  Fixed administrative costs (RDW fees, inspection, etc.)
 */

'use strict';

// Default values — single source of truth, referenced by the reset button in popup.js.
export const SETTING_DEFAULTS = {
  postcode:   '',
  fixedCosts: 170,   // euros — mirrors DEFAULT_FIXED_COSTS in ImportCostCalculator.cs
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
