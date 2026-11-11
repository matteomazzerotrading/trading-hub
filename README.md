# Matteo Mazzero | Trading Hub 📈

Sito personale di **Matteo Mazzero**: il mio portafoglio reale, i fair value di oltre 400 azioni e le mie analisi dei mercati.

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
| Setup della TBO Strategy | `tbo_signals.json` | Nello stesso workflow, solo se esiste il segreto `TBO_RULES` |

Le regole della TBO Strategy **non sono in questo repository**: `scripts/compute_tbo.mjs` contiene solo il contorno
(lettura delle barre, date, scrittura del file) e riceve le regole dal segreto `TBO_RULES` delle GitHub Actions
(Settings → Secrets and variables → Actions), che contiene il modulo JavaScript in base64.

Sul sito i prezzi usati per i confronti arrivano da TradingView con 15 minuti di ritardo.

## File principali

* `index.html`: la home, con tutta l'interfaccia.
* `scripts/fv_engine.js`: la formula del fair value, usata sia dal sito sia dal calcolo serale.
* `scripts/compute_fv.mjs`: calcola i fair value di tutti i titoli.
* `scripts/build_pages.mjs`: genera le pagine dei singoli titoli e la sitemap.
* `disclaimer.html`, `privacy.html`: note legali e informativa sulla privacy.

I contenuti hanno scopo didattico e non costituiscono consulenza finanziaria.
