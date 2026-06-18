# 🇳🇱 Car Import Cost — Chrome Extension

Toont de totale importkosten naar Nederland direct op AutoScout24 advertenties en zoekresultaten.

## Wat het doet

- **Advertentiepagina**: injecteert een widget naast de prijs met invoerrechten, BTW en BPM
- **Zoekresultaten**: toont een compacte badge met het totaalbedrag per kaart
- **Popup**: handmatige berekening + instelling voor EU/niet-EU oorsprong

## BPM berekening

BPM wordt berekend op basis van CO₂ g/km en brandstoftype (conform BPM-staffel 2025).  
Als CO₂ niet beschikbaar is op de advertentie, wordt een conservatieve schatting gebruikt.  
EV's zijn volledig vrijgesteld van BPM.

## Ondersteunde sites

| Site | Status |
|---|---|
| autoscout24.de | ✅ |
| autoscout24.nl | ✅ |
| autoscout24.be | ✅ |
| autoscout24.fr | ✅ |

## Lokaal installeren

1. Clone de repo
2. `chrome://extensions/` → Developer mode aan → Load unpacked
3. Selecteer de projectfolder

## Projectstructuur

```
├── manifest.json
├── content/
│   ├── content.js              # Orkestrator
│   ├── widget.js               # Widget + badge injectie
│   ├── widget.css              # Stijlen (cic- prefix)
│   └── scrapers/
│       └── autoscout24.js      # Listing + zoekpagina scraper
├── popup/                      # Popup UI
├── utils/
│   ├── calculator.js           # BPM/BTW/invoerrechten
│   └── settings.js             # chrome.storage wrapper
└── background/
    └── background.js
```

## Toekomstige uitbreiding

Een nieuwe site toevoegen:
1. Maak `content/scrapers/nieuwe-site.js`
2. Registreer in `content/content.js` → `SCRAPERS`-array
