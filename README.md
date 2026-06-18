# 🚗 Car Import Cost Chrome Extension

Een Chrome-extensie die de totale importkosten van een auto naar Nederland berekent — inclusief BPM, BTW en invoerrechten.

## Functies

- Bereken BPM, BTW (21%) en invoerrechten
- Ondersteuning voor benzine, diesel, elektrisch en hybride
- Leeftijdsafhankelijke BPM-afschrijving
- (Toekomst) Automatisch uitlezen van autoprijzen op Marktplaats, AutoScout24, Mobile.de

## Lokaal installeren

1. Clone deze repo
2. Open Chrome → `chrome://extensions/`
3. Zet **Developer mode** aan (toggle rechtsboven)
4. Klik **Load unpacked** en selecteer de projectfolder

## Projectstructuur

```
car-import-cost-chrome-extension/
├── manifest.json          # Extensie configuratie (MV3)
├── popup/
│   ├── popup.html         # UI van de extensie popup
│   ├── popup.css          # Styling
│   └── popup.js           # Popup logica
├── background/
│   └── background.js      # Service Worker
├── content/
│   └── content.js         # Geïnjecteerd op webpagina's
├── utils/
│   └── calculator.js      # BPM/BTW berekeningslogica
└── icons/                 # Extensie-iconen (16, 48, 128px)
```

## Notities over berekeningen

- **BPM**: Vereenvoudigd model op basis van aankoopprijs en brandstoftype. In de praktijk is BPM gebaseerd op CO2-uitstoot (g/km) — dit moet verder worden uitgewerkt.
- **Invoerrechten**: EU-standaardtarief van 6,5% voor personenwagens van buiten de EU. Pas aan op basis van het land van herkomst.
- **BTW**: 21% over aankoopprijs + invoerrechten.

## Roadmap

- [ ] Integratie met RDW API voor nauwkeurige BPM-berekening
- [ ] Automatisch kenteken/prijs uitlezen van ondersteunde sites
- [ ] Exportfunctie naar PDF/CSV
- [ ] Ondersteuning voor meerdere herkomstlanden
