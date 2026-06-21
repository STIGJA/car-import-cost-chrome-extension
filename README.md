# 🇳🇱 Car Import Cost — Chrome Extension

Toont de geschatte totale importkosten naar Nederland direct op AutoScout24 advertenties en zoekresultaten.

## Wat het doet

- **Advertentiepagina**: injecteert een widget naast de prijs met BPM, transport en vaste kosten
- **Zoekresultaten**: toont een compacte kostenoverzicht per kaart, inclusief geschatte BPM
- **BPM-schatting**: automatisch op basis van CO₂, euronorm en vermogen — afgerond op ~€100 als geschat
- **Popup**: handmatige berekening + instellingen voor transportkosten per land

## BPM berekening

BPM wordt berekend conform de Belastingdienst staffel 2026. De nauwkeurigheid hangt af van beschikbare data:

| Beschikbare data | Methode | Betrouwbaarheid |
|---|---|---|
| CO₂ van advertentie | Directe berekening | ✅ Exact |
| Euronorm + vermogen | Lookup tabel | 🟡 Gemiddeld |
| Vermogen + bouwjaar | Euronorm afgeleid uit jaar | 🟡 Geschat |
| Alleen bouwjaar | Europees vlootgemiddelde | 🟠 Laag |

Geschatte BPM-bedragen worden weergegeven met een `~` prefix en afgerond op €100. EV's zijn volledig vrijgesteld.

**Bekende beperking:** op de zoekpagina is de euronorm niet beschikbaar. Het vermogen wordt wel geparsed uit de kaart, waarna de euronorm wordt afgeleid uit het bouwjaar. De BPM-schatting kan daardoor afwijken van de advertentiepagina.

## Ondersteunde sites

| Site | Status |
|---|---|
| autoscout24.de | ✅ |
| autoscout24.nl | ✅ |
| autoscout24.be | ✅ |
| autoscout24.fr | ✅ |

## Lokaal installeren

1. Clone de repo
2. Open `chrome://extensions/` → zet Developer mode aan → klik Load unpacked
3. Selecteer de projectfolder

## Projectstructuur

```
├── manifest.json
├── content/
│   ├── content.js                  # Orkestrator: detecteert pagina, roept scraper + calculator aan
│   ├── renderer.js                 # Zet ImportResult om naar HTML en injecteert in DOM
│   ├── widget.css                  # Stijlen (cic- prefix, geen conflicten met AS24)
│   ├── calculators/
│   │   ├── bpm.js                  # BPM-staffel 2026, afschrijvingstabel, bruto/netto berekening
│   │   └── nl-import.js            # Totaalberekening: BPM + transport + BTW + vaste kosten
│   ├── lookups/
│   │   └── co2-lookup.js           # CO₂-schatting o.b.v. euronorm × vermogensklasse (WLTP)
│   └── sites/
│       └── autoscout24.js          # Scraper voor listing- en zoekpagina
├── popup/                          # Popup UI + handmatige calculator
├── background/
│   └── background.js
├── utils/
└── icons/
```

## Een nieuwe site toevoegen

1. Maak `content/sites/nieuwe-site.js` met `scrapeListingPage()` en `scrapeSearchPage()`
2. Exporteer via `window.CIC_[SITENAAM]`
3. Registreer in `content/content.js` in de `SCRAPERS`-array met het bijbehorende URL-patroon

## Toekomstige ideeën

- Sorteren op totaalprijs of BPM binnen de zoekresultaten (DOM re-sortering, geen backend nodig)
- Meer bronlanden (Zweden, Portugal, …)
- Handmatige CO₂-invoer als override
