# Matteo Mazzero | Trading Hub 📈

Sito personale di **Matteo Mazzero**: il mio portafoglio reale, il fair value di qualsiasi azione (oltre 400 seguite ogni giorno) e le mie analisi dei mercati.

🔗 **Sito:** [matteomazzerotrading.github.io/trading-hub](https://matteomazzerotrading.github.io/trading-hub/)
📺 **Canale YouTube:** [Investire con Matteo Mazzero](https://www.youtube.com/@investireconmatteomazzero)

## Cosa c'è sul sito

* **Editoriale:** l'ultimo video del canale e il pensiero della settimana, con l'archivio dei precedenti.
* **Il mio portafoglio:** posizioni reali, allocazione e andamento.
* **Fair value e screener:** per ogni titolo fair value pavimento, banda, fair value di mercato e storico, potenziale ed esito del modello. I valori sono calcolati con il mio indicatore "FAIR VALUE (dati realizzati)" di TradingView; la spiegazione è nel Glossario del sito.
* **Una pagina per titolo:** cartella `titoli/`, pensata per i motori di ricerca.
* **Strumenti:** simulatore di portafoglio, calcolatore PAC e position sizing.
* **Mercati:** notizie, calendario macro, termometro del mercato (VIX) e watchlist.

## Come si aggiorna

| Cosa | Dove | Quando |
|---|---|---|
| Fair value, pagine dei titoli, sitemap | `data.json`, `titoli/`, `sitemap.xml` | Ogni sera dei giorni di borsa (workflow *Compute Fair Value*) |
| Prezzi salvati | `data.json` | Ogni 2 ore nei giorni di borsa (workflow *Update Prices*) |
| Ultimo video | `latest_video.json` | Ogni 6 ore (workflow *Update YouTube*) |
| Pensiero della settimana | `pensiero.json` | A mano: basta modificare testo e data |
| Archivio dei pensieri | `pensieri.json` | Da solo, quando cambia `pensiero.json` (workflow *Archivia Pensiero*) |
| Portafoglio | `portfolio.json` | Ogni sera dei giorni di borsa, con `scripts/portfolio_online.py`; `history` è lo storico giornaliero (valore, rendimento %, profitto) |
| Pattern Scanner | `patterns.json`, `patterns_detail.json` | Ogni sera dei giorni di borsa (workflow *Compute Patterns*) |
| Storico del fair value | `fv_history.json` | Con i fair value: ricalcolo a ogni fine trimestre degli ultimi 6 anni (`scripts/fv_history.mjs`) |
| Rischio del portafoglio | `portfolio_risk.json` | Nel workflow *Compute Patterns*: correlazione tra i titoli (`scripts/compute_risk.mjs`) |
| Track record TBO | `tbo_stats.json` | Nel workflow *Compute Patterns*, solo se esiste il segreto `TBO_RULES` |
| Segnali della TBO Strategy (Compra, chiusa all'80%) | `tbo_signals.json`, `tbo_state.json` | Nello stesso workflow, solo se esiste il segreto `TBO_RULES` |

Le regole della TBO Strategy **non sono in questo repository**: `scripts/compute_tbo.mjs` contiene solo la contabilità
della posizione (10% del capitale per acquisto, al massimo 12 acquisti, uscita dell'80%) e riceve le regole dal segreto
`TBO_RULES` delle GitHub Actions (Settings → Secrets and variables → Actions), che contiene il modulo JavaScript in base64.
`tbo_state.json` è lo stato della strategia titolo per titolo (acquisti aperti e liquidità), letto da TradingView e poi
fatto avanzare una seduta alla volta: se col tempo si scosta dal grafico va riletto da TradingView.

Sul sito i prezzi usati per i confronti arrivano da TradingView con 15 minuti di ritardo.

## File principali

* `index.html`: la home, con tutta l'interfaccia.
* `scripts/fv_engine.js`: la formula del fair value, usata sia dal sito sia dal calcolo serale.
* `scripts/compute_fv.mjs`: calcola i fair value di tutti i titoli.
* `scripts/build_pages.mjs`: genera le pagine dei singoli titoli e la sitemap.
* `disclaimer.html`, `privacy.html`: note legali e informativa sulla privacy.

I contenuti hanno scopo didattico e non costituiscono consulenza finanziaria.

## App installabile

Il sito è anche una PWA: `manifest.webmanifest` descrive l'app (nome, icone in `icons/`, scorciatoie) e `sw.js` tiene una copia
della pagina e dei file di dati. Con la rete si usa sempre la versione aggiornata; senza rete si apre l'ultima copia salvata
(senza prezzi in tempo reale). Per cambiare la strategia di cache basta alzare `VERSIONE` in `sw.js`.
