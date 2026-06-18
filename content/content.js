/**
 * Content Script — AutoScout24 scraper + widget injector
 *
 * Scrapet de advertentiepagina voor:
 *   - Prijs, bouwjaar, brandstoftype, merk/model, kilometerstand
 * Injecteert daarna een klein kostenwidget direct op de pagina.
 */

import { calculateImportCosts } from '../utils/calculator.js';
import { scrapeAutoscout24 } from './scrapers/autoscout24.js';
import { injectWidget, updateWidget } from './widget.js';

(async function () {
  'use strict';

  // Detecteer welke site we zijn op basis van hostname
  const host = window.location.hostname; // bijv. 'www.autoscout24.de'

  let carData = null;

  if (host.includes('autoscout24')) {
    carData = scrapeAutoscout24();
  }

  // Geen data gevonden — stil afsluiten
  if (!carData || !carData.price) return;

  // Bereken kosten
  const costs = calculateImportCosts({
    price: carData.price,
    year: carData.year ?? new Date().getFullYear() - 3,
    fuelType: carData.fuelType ?? 'petrol',
  });

  // Injecteer widget op de pagina
  injectWidget(carData, costs);
})();
