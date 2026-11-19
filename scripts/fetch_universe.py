"""
fetch_universe.py — barre giornaliere di un campione largo di azioni, per il track record della TBO Strategy.

Il campione: le società degli indici S&P 500, S&P 400 e S&P 600 (grandi, medie e piccole americane, dagli elenchi
di Wikipedia), le altre società quotate negli Stati Uniti con capitalizzazione di almeno 2 miliardi (comprese le
straniere quotate a New York e le nuove quotazioni), le società quotate nelle borse europee coperte dal fair value
(Milano, Francoforte, Parigi, Amsterdam, Madrid, Londra, Zurigo) con almeno 2 miliardi di capitalizzazione, più i
titoli seguiti dal sito (data.json). Scrive nella cartella indicata dei file daily_N.json ({simbolo: {d, h, l, c}})
e meta.json con il gruppo di ogni simbolo. Sono file temporanei.
Il track record usa solo i titoli con almeno 6 anni di barre; quelli più giovani (nuove quotazioni) entrano comunque
nei segnali giornalieri e nel fair value: in meta.json → "giovani" con il numero di barre disponibili.
Limite noto: sono le società presenti OGGI negli indici; quelle uscite o fallite negli anni non ci sono.
"""
import io, json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "universe")
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (compatible; trading-hub/1.0; +https://matteomazzerotrading.github.io/trading-hub/)"}
INDICI = [("USA grandi (S&P 500)", "List_of_S%26P_500_companies"), ("USA medie (S&P 400)", "List_of_S%26P_400_companies"),
          ("USA piccole (S&P 600)", "List_of_S%26P_600_companies")]

import pandas as pd
gruppo, nomi = {}, {}
for nome, pagina in INDICI:
    try:
        html = urllib.request.urlopen(urllib.request.Request("https://en.wikipedia.org/wiki/" + pagina, headers=UA), timeout=40).read().decode("utf-8")
        tab = next(t for t in pd.read_html(io.StringIO(html)) if any(str(c).strip().lower() in ("symbol", "ticker symbol", "ticker") for c in t.columns))
        col = next(c for c in tab.columns if str(c).strip().lower() in ("symbol", "ticker symbol", "ticker"))
        cn = next((c for c in tab.columns if str(c).strip().lower() in ("security", "company", "company name")), None)
        sim = []
        for k, x in enumerate(tab[col]):
            if not (isinstance(x, str) and 0 < len(x.strip()) <= 6):
                continue
            s = x.strip().upper().replace(".", "-")
            sim.append(s); gruppo.setdefault(s, nome)
            if cn is not None and isinstance(tab[cn].iloc[k], str):
                nomi.setdefault(s, tab[cn].iloc[k].strip())
        print(f"{nome}: {len(sim)} simboli")
    except Exception as e:
        print(f"{nome}: elenco non disponibile ({e})")

# Altre società americane ed europee dallo screener pubblico di TradingView (capitalizzazione di almeno 2 miliardi
# nella valuta di quotazione). Simbolo Yahoo: ticker con "-" al posto di "." e il suffisso della borsa.
tv = {}
MERCATI = [("america", ["NYSE", "NASDAQ", "AMEX"], "", "USA, altre società (oltre 2 miliardi)"),
           ("italy", ["MIL"], ".MI", "Europa: Italia"), ("germany", ["XETR"], ".DE", "Europa: Germania"),
           ("france", ["EURONEXT"], ".PA", "Europa: Francia"), ("netherlands", ["EURONEXT"], ".AS", "Europa: Paesi Bassi"),
           ("spain", ["BME"], ".MC", "Europa: Spagna"), ("uk", ["LSE"], ".L", "Europa: Regno Unito"),
           ("switzerland", ["SIX"], ".SW", "Europa: Svizzera")]
def scansiona(mercato, borse, primaria=True):
    filtri = [{"left": "market_cap_basic", "operation": "egreater", "right": 2e9},
              {"left": "type", "operation": "in_range", "right": ["stock", "dr"]},
              {"left": "exchange", "operation": "in_range", "right": borse}]
    if primaria:
        filtri.append({"left": "is_primary", "operation": "equal", "right": True})
    corpo = json.dumps({"filter": filtri, "columns": ["name", "description", "exchange", "market_cap_basic"],
                        "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"}, "range": [0, 2500]}).encode()
    rq = urllib.request.Request(f"https://scanner.tradingview.com/{mercato}/scan", data=corpo, headers={**UA, "Content-Type": "text/plain"})
    return json.loads(urllib.request.urlopen(rq, timeout=60).read().decode()).get("data", [])
for mercato, borse, suffisso, nome in MERCATI:
    try:
        try:
            righe = scansiona(mercato, borse)
        except Exception:
            righe = scansiona(mercato, borse, primaria=False)
        nuovi = 0
        for x in righe:
            ticker, descr = x["d"][0], x["d"][1]
            if not ticker or len(ticker) > 8:
                continue
            s = ticker.replace(".", "-").replace("/", "-") + suffisso
            if s in gruppo:
                continue
            gruppo[s] = nome; nuovi += 1
            if isinstance(descr, str) and descr.strip():
                nomi.setdefault(s, descr.strip())
            tv.setdefault(s, x["s"])
        print(f"{nome}: {nuovi} simboli in più (su {len(righe)})")
    except Exception as e:
        print(f"{nome}: elenco non disponibile ({e})")

# Nuove quotazioni da includere subito, anche prima che lo screener ne riporti la capitalizzazione
AGGIUNTE = {"ANT": ("NASDAQ:ANT", "Anthropic, PBC")}
for s, (simbolo, nome) in AGGIUNTE.items():
    if s not in gruppo:
        gruppo[s] = "USA, altre società (oltre 2 miliardi)"; tv[s] = simbolo; nomi.setdefault(s, nome)

data = json.load(open(os.path.join(ROOT, "data.json"), encoding="utf-8"))
sito = set()
for t, e in data["db"].items():
    if e.get("tv"):
        s = e.get("yf") or t
        sito.add(s)
        gruppo.setdefault(s, "Europa e Italia (titoli del sito)" if "." in s else "USA, altri titoli del sito")

# Simbolo TradingView (borsa:ticker) dei titoli americani che il sito non segue: serve per il prezzo aggiornato
try:
    fuori = [s for s in gruppo if s not in sito and s not in tv and "." not in s]
    for i in range(0, len(fuori), 500):
        corpo = json.dumps({"filter": [{"left": "name", "operation": "in_range", "right": [x.replace("-", ".") for x in fuori[i:i + 500]]},
                                       {"left": "exchange", "operation": "in_range", "right": ["NYSE", "NASDAQ", "AMEX", "NYSE ARCA", "CBOE"]}],
                            "columns": ["name", "exchange", "market_cap_basic"], "range": [0, 2000]}).encode()
        rq = urllib.request.Request("https://scanner.tradingview.com/america/scan", data=corpo, headers={**UA, "Content-Type": "text/plain"})
        for x in json.loads(urllib.request.urlopen(rq, timeout=40).read().decode()).get("data", []):
            tv.setdefault(x["d"][0].replace(".", "-"), x["s"])
    print(f"Simboli TradingView: {len(tv)}/{len(fuori)}")
except Exception as e:
    print(f"Simboli TradingView non disponibili ({e})")

simboli = sorted(gruppo)
if sum(1 for g in gruppo.values() if g.startswith("USA ") and "S&P" in g) < 800:
    sys.exit("Elenchi degli indici incompleti: il campione largo non è disponibile, nessun calcolo.")

import yfinance as yf
r4 = lambda s: [round(float(v), 4) for v in s.values]
presi, giovani, n_file = {}, {}, 0
for i in range(0, len(simboli), 150):
    lotto = simboli[i:i + 150]
    try:
        df = yf.download(lotto, period="14y", interval="1d", auto_adjust=False, group_by="ticker", threads=True, progress=False)
    except Exception as e:
        print(f"Lotto {i}: {e}"); continue
    out = {}
    for s in lotto:
        try:
            b = df[s][["High", "Low", "Close"]].dropna()
        except Exception:
            continue
        if len(b) >= 1500:
            out[s] = {"d": [x.strftime("%Y-%m-%d") for x in b.index], "h": r4(b["High"]), "l": r4(b["Low"]), "c": r4(b["Close"])}
            presi[s] = gruppo[s]
        elif s not in sito and s in tv:
            # nuova quotazione o storia breve: fuori dal track record, ma nei segnali e nel fair value
            giovani[s] = len(b)
            if len(b) >= 320:
                out[s] = {"d": [x.strftime("%Y-%m-%d") for x in b.index], "h": r4(b["High"]), "l": r4(b["Low"]), "c": r4(b["Close"])}
    json.dump(out, open(os.path.join(OUT, f"daily_{n_file}.json"), "w"), separators=(",", ":")); n_file += 1
    print(f"Lotto {i // 150 + 1}: {len(out)}/{len(lotto)}")
# le società americane senza barre su Yahoo (quotate da pochi giorni) entrano lo stesso, senza storia
for s in simboli:
    if s not in presi and s not in giovani and s not in sito and s in tv:
        giovani[s] = 0
tutti = set(presi) | set(giovani)
json.dump({"gruppo": {**{k: gruppo[k] for k in giovani}, **presi}, "nomi": {k: v for k, v in nomi.items() if k in tutti}, "tv": {k: v for k, v in tv.items() if k in tutti},
           "giovani": giovani, "sito": sorted(sito & set(presi)),
           "descrizione": "società degli indici S&P 500, 400 e 600, altre società americane ed europee con almeno 2 miliardi di capitalizzazione e i titoli seguiti dal sito"},
          open(os.path.join(OUT, "meta.json"), "w"), ensure_ascii=False)
print(f"Campione: {len(presi)} titoli con almeno 6 anni di barre, in {n_file} file; {len(giovani)} con storia più breve")
if len(presi) < 800:
    sys.exit("Troppi titoli senza barre: nessun calcolo.")
