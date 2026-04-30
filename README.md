# 📈 Calendario Trimestrali

Sito statico — HTML + CSS + JS vanilla — per visualizzare il calendario delle trimestrali (earnings) di un portafoglio di titoli. Funziona aprendo `index.html` direttamente o servendolo da GitHub Pages. Nessun backend, nessuna build, nessun framework.

Dati forniti da [Financial Modeling Prep](https://financialmodelingprep.com).

## Caratteristiche

- 💼 **Portafoglio personalizzato** — aggiungi ticker manualmente o via upload CSV. Supporta mercati globali (USA, IT, UK, DE, NL, FR, ecc.).
- 🔑 **API key locale** — la tua API key FMP è salvata **solo** nel `localStorage` del browser, mai inviata ad altri server tranne FMP stesso.
- 📅 **Vista calendario** — calendario mensile navigabile con badge per ticker, codici colore per BMO/AMC e per surprise positive/negative.
- 📋 **Vista lista/timeline** — earnings raggruppati per settimana, con tutti i dati disponibili (EPS, fatturato, surprise, settore, link IR, storico ultime 4 trimestrali).
- 🎚 **Filtri completi** — settore, range data (con preset rapidi), solo future/passate, ricerca testuale.
- 📤 **Export `.ics`** — scarica il calendario in formato standard RFC 5545, importabile in Google Calendar, Outlook, Apple Calendar.
- 🌓 **Tema chiaro/scuro** — segue le preferenze di sistema, salvato in `localStorage`.
- 🇮🇹 **Interfaccia in italiano**, layout responsive (desktop + mobile).
- 💾 **Cache locale** con TTL di 6 ore per non bruciare la quota API.

## 🚀 Deploy su GitHub Pages

1. Crea un repository GitHub (es. `calendario-trimestrali`).
2. Carica i file (`index.html`, `style.css`, `app.js`, `README.md`, `.gitignore`):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<utente>/calendario-trimestrali.git
   git push -u origin main
   ```
3. Su GitHub vai su **Settings → Pages**.
4. Sotto **Source**, seleziona branch `main` e cartella `/ (root)`. Salva.
5. Dopo 1-2 minuti il sito è online su `https://<utente>.github.io/calendario-trimestrali/`.

> 🔒 **L'API key FMP non viene mai committata** — viene inserita dall'utente nel browser e salvata solo nel suo `localStorage`. Il file `.gitignore` è già configurato per escludere file di segreti.

## 🔑 Come ottenere una API key FMP

1. Vai su [financialmodelingprep.com](https://site.financialmodelingprep.com/developer/docs).
2. Registra un account gratuito (tier free: 250 chiamate/giorno).
3. Dalla dashboard copia la tua API key.
4. Apri il sito, incollala nel campo **API key FMP** nel pannello sinistro, clicca **Salva** e poi **Verifica**.

> ⚠️ **Quota tier free**: ogni ticker richiede 2 chiamate (profile + earnings calendar). 125 ticker / giorno è il massimo teorico. La cache da 6 ore aiuta a non riconsumarla a ogni refresh.

## 📂 Uso

### Aggiungere ticker

- **Manuale**: incolla i simboli separati da virgola, spazio o invio.
  ```
  AAPL, MSFT, GOOGL
  ENI.MI, ISP.MI
  HSBA.L
  ASML.AS, SAP.DE
  ```
- **CSV**: carica un file con una colonna `ticker` (header opzionale). Separatori `,` `;` tab.

### Suffissi mercato supportati

| Suffisso | Mercato | | Suffisso | Mercato |
|---|---|---|---|---|
| _(nessuno)_ | USA (NYSE/Nasdaq) | | `.AS` | Amsterdam |
| `.MI` | Borsa Italiana | | `.PA` | Parigi |
| `.L` | Londra | | `.BR` | Bruxelles |
| `.DE` / `.F` | Francoforte (Xetra) | | `.MC` | Madrid |
| `.SW` | SIX Svizzera | | `.ST` | Stoccolma |
| `.HE` | Helsinki | | `.OL` | Oslo |
| `.CO` | Copenhagen | | `.VI` | Vienna |
| `.TO` / `.V` | Toronto | | `.AX` | Sydney |
| `.T` | Tokyo | | `.HK` | Hong Kong |
| `.KS` | Seoul | | `.SS` / `.SZ` | Shanghai/Shenzhen |

### Export calendario

Pulsanti in basso nel pannello sinistro:
- **⬇ Solo filtrate**: esporta solo le trimestrali che corrispondono ai filtri attivi.
- **⬇ Tutto il portafoglio**: esporta tutte le trimestrali disponibili (passate + future).

Ogni evento `.ics` include: titolo `[TICKER] Trimestrale - Nome Azienda`, data/ora (BMO=mattina, AMC=pomeriggio nel fuso del mercato), descrizione con EPS/fatturato stimati e riportati, link IR.

## 🔒 Privacy

- L'API key è salvata in `localStorage` del browser, mai trasmessa al di fuori delle chiamate dirette a FMP.
- I dati delle trimestrali sono cachati in `localStorage` con TTL 6 ore.
- Nessun analytics, nessun cookie, nessun tracker.
- Il sito può girare anche **completamente offline** (dopo il primo caricamento) per consultare la cache.

## 🛠 Struttura file

```
calendario-trimestrali/
├── index.html      # struttura HTML
├── style.css       # tema chiaro/scuro, responsive
├── app.js          # logica completa (FMP client, render, ICS export)
├── README.md       # questo file
└── .gitignore
```

Tutto il codice è in **vanilla JavaScript**, nessuna dipendenza npm, nessun CDN obbligatorio. Per modificarlo basta un editor.

## 📸 Screenshot

> _(Aggiungi qui screenshot di vista calendario e vista lista dopo il primo deploy. Suggerimento: cattura schermate sia in tema chiaro che scuro.)_

```
docs/
├── screenshot-calendar-light.png
├── screenshot-calendar-dark.png
├── screenshot-list-light.png
└── screenshot-list-dark.png
```

E referenziali in questa sezione, ad esempio:
```markdown
![Vista calendario](docs/screenshot-calendar-light.png)
![Vista lista](docs/screenshot-list-dark.png)
```

## 📜 Licenza

Codice rilasciato come materiale di pubblico dominio / MIT (a tua scelta — aggiungi un file `LICENSE` se necessario). I dati provengono da Financial Modeling Prep e sono soggetti ai loro [Terms of Service](https://site.financialmodelingprep.com/terms-of-service).
