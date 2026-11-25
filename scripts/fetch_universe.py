"""
fetch_universe.py — barre giornaliere di un campione largo di azioni, per il track record della TBO Strategy.

Il campione: le società degli indici S&P 500, S&P 400 e S&P 600 (grandi, medie e piccole americane, dagli elenchi
di Wikipedia), le altre società quotate negli Stati Uniti con capitalizzazione di almeno 2 miliardi (comprese le
straniere quotate a New York e le nuove quotazioni), le società quotate a Milano con almeno 300 milioni di
capitalizzazione, quelle delle altre borse europee (Francoforte, Parigi, Amsterdam, Bruxelles, Lisbona, Madrid, Londra,
Zurigo, Vienna, Stoccolma, Copenaghen, Helsinki, Oslo) con almeno 1 miliardo, più i titoli seguiti dal sito (data.json).
Per i segnali giornalieri, non per il track record delle azioni, anche i principali indici di borsa e le materie prime
(MACRO, qui sotto). Scrive nella cartella indicata dei file daily_N.json ({simbolo: {d, h, l, c}})
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

# Altre società americane ed europee dallo screener pubblico di TradingView, con una capitalizzazione minima nella
# valuta di quotazione (per corone svedesi, norvegesi e danesi la soglia equivale a circa 1 miliardo di euro).
# Simbolo Yahoo: ticker con "-" al posto di "." (e di "_", come VOLV_B → VOLV-B.ST) e il suffisso della borsa.
tv = {}
MERCATI = [("america", ["NYSE", "NASDAQ", "AMEX"], "", "USA, altre società (oltre 2 miliardi)", 2e9),
           ("italy", ["MIL"], ".MI", "Europa: Italia", 3e8), ("germany", ["XETR"], ".DE", "Europa: Germania", 1e9),
           ("france", ["EURONEXT"], ".PA", "Europa: Francia", 1e9), ("netherlands", ["EURONEXT"], ".AS", "Europa: Paesi Bassi", 1e9),
           ("belgium", ["EURONEXT"], ".BR", "Europa: Belgio", 1e9), ("portugal", ["EURONEXT"], ".LS", "Europa: Portogallo", 1e9),
           ("spain", ["BME"], ".MC", "Europa: Spagna", 1e9), ("uk", ["LSE"], ".L", "Europa: Regno Unito", 1e9),
           ("switzerland", ["SIX"], ".SW", "Europa: Svizzera", 1e9), ("austria", ["VIE"], ".VI", "Europa: Austria", 1e9),
           ("sweden", ["OMXSTO"], ".ST", "Europa: Svezia", 1.2e10), ("denmark", ["OMXCOP"], ".CO", "Europa: Danimarca", 7.5e9),
           ("finland", ["OMXHEX"], ".HE", "Europa: Finlandia", 1e9), ("norway", ["OSL"], ".OL", "Europa: Norvegia", 1.2e10)]
def scansiona(mercato, borse, primaria=True, minimo=2e9):
    filtri = [{"left": "market_cap_basic", "operation": "egreater", "right": minimo},
              {"left": "type", "operation": "in_range", "right": ["stock", "dr"]},
              {"left": "exchange", "operation": "in_range", "right": borse}]
    if primaria:
        filtri.append({"left": "is_primary", "operation": "equal", "right": True})
    corpo = json.dumps({"filter": filtri, "columns": ["name", "description", "exchange", "market_cap_basic"],
                        "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"}, "range": [0, 2500]}).encode()
    rq = urllib.request.Request(f"https://scanner.tradingview.com/{mercato}/scan", data=corpo, headers={**UA, "Content-Type": "text/plain"})
    return json.loads(urllib.request.urlopen(rq, timeout=60).read().decode()).get("data", [])
for mercato, borse, suffisso, nome, minimo in MERCATI:
    try:
        try:
            righe = scansiona(mercato, borse, minimo=minimo)
        except Exception:
            righe = scansiona(mercato, borse, primaria=False, minimo=minimo)
        nuovi = 0
        for x in righe:
            ticker, descr = x["d"][0], x["d"][1]
            if not ticker or len(ticker) > 8:
                continue
            s = ticker.replace(".", "-").replace("/", "-").replace("_", "-") + suffisso
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

# Indici di borsa e materie prime: solo segnali giornalieri e precedenti, fuori dal track record delle azioni.
# Simbolo Yahoo → (nome, gruppo, valuta mostrata, simboli TradingView possibili: vale il primo che lo screener riconosce,
# per il prezzo aggiornato e il link al grafico). Per le materie prime i contratti futures continui, come su Yahoo.
MACRO = {
    "^GSPC": ("S&P 500", "Indici", "", ["SP:SPX"]),
    "^NDX": ("Nasdaq 100", "Indici", "", ["NASDAQ:NDX"]),
    "^DJI": ("Dow Jones Industrial", "Indici", "", ["DJ:DJI", "TVC:DJI"]),
    "^RUT": ("Russell 2000", "Indici", "", ["TVC:RUT", "RUSSELL:RUT"]),
    "FTSEMIB.MI": ("FTSE MIB", "Indici", "", ["INDEX:FTSEMIB", "TVC:FTSEMIB", "MIL:FTSEMIB", "TVC:FTMIB"]),
    "^STOXX50E": ("Euro Stoxx 50", "Indici", "", ["TVC:SX5E", "INDEX:SX5E"]),
    "^STOXX": ("Stoxx Europe 600", "Indici", "", ["TVC:SXXP", "INDEX:SXXP"]),
    "^GDAXI": ("DAX", "Indici", "", ["XETR:DAX", "TVC:DEU40"]),
    "^FCHI": ("CAC 40", "Indici", "", ["EURONEXT:PX1", "TVC:CAC40"]),
    "^FTSE": ("FTSE 100", "Indici", "", ["TVC:UKX", "FTSE:UKX"]),
    "^IBEX": ("IBEX 35", "Indici", "", ["BME:IBC", "TVC:IBEX35"]),
    "^SSMI": ("SMI", "Indici", "", ["SIX:SMI", "TVC:SMI"]),
    "^AEX": ("AEX", "Indici", "", ["EURONEXT:AEX", "TVC:AEX"]),
    "^N225": ("Nikkei 225", "Indici", "", ["TVC:NI225", "INDEX:NKY"]),
    "^HSI": ("Hang Seng", "Indici", "", ["TVC:HSI", "HSI:HSI"]),
    "GC=F": ("Oro", "Materie prime", "$", ["COMEX:GC1!", "TVC:GOLD"]),
    "SI=F": ("Argento", "Materie prime", "$", ["COMEX:SI1!", "TVC:SILVER"]),
    "PL=F": ("Platino", "Materie prime", "$", ["NYMEX:PL1!", "TVC:PLATINUM"]),
    "PA=F": ("Palladio", "Materie prime", "$", ["NYMEX:PA1!", "TVC:PALLADIUM"]),
    "HG=F": ("Rame", "Materie prime", "$", ["COMEX:HG1!", "TVC:COPPER"]),
    "BZ=F": ("Petrolio Brent", "Materie prime", "$", ["ICEEUR:BRN1!", "TVC:UKOIL"]),
    "NG=F": ("Gas naturale", "Materie prime", "$", ["NYMEX:NG1!", "TVC:NATURALGAS"]),
    "ZW=F": ("Grano", "Materie prime", "¢", ["CBOT:ZW1!"]),
    "ZC=F": ("Mais", "Materie prime", "¢", ["CBOT:ZC1!"]),
    "ZS=F": ("Soia", "Materie prime", "¢", ["CBOT:ZS1!"]),
    "KC=F": ("Caffè", "Materie prime", "¢", ["ICEUS:KC1!"]),
    "CC=F": ("Cacao", "Materie prime", "$", ["ICEUS:CC1!"]),
    "SB=F": ("Zucchero", "Materie prime", "¢", ["ICEUS:SB1!"]),
}
validi = set()
try:
    candidati = sorted({x for v in MACRO.values() for x in v[3]})
    corpo = json.dumps({"symbols": {"tickers": candidati}, "columns": ["close"]}).encode()
    rq = urllib.request.Request("https://scanner.tradingview.com/global/scan", data=corpo, headers={**UA, "Content-Type": "text/plain"})
    validi = {x["s"] for x in json.loads(urllib.request.urlopen(rq, timeout=40).read().decode()).get("data", []) if x.get("d") and x["d"][0]}
except Exception as e:
    print(f"Simboli TradingView di indici e materie prime non verificati ({e})")
macro = {}
for s, (nome, grp, valuta, cand) in MACRO.items():
    scelto = next((x for x in cand if x in validi), cand[0])
    gruppo[s] = grp; nomi[s] = nome; tv[s] = scelto; macro[s] = {"cat": grp, "cur": valuta}
print(f"Indici e materie prime: {len(MACRO)}, simboli TradingView riconosciuti {sum(1 for v in MACRO.values() if any(x in validi for x in v[3]))}")

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
           "giovani": giovani, "sito": sorted(sito & set(presi)), "macro": {k: v for k, v in macro.items() if k in tutti},
           "descrizione": "società degli indici S&P 500, 400 e 600, altre società americane con almeno 2 miliardi di capitalizzazione, italiane con almeno 300 milioni ed europee con almeno 1 miliardo, e i titoli seguiti dal sito"},
          open(os.path.join(OUT, "meta.json"), "w"), ensure_ascii=False)
print(f"Campione: {len(presi)} titoli con almeno 6 anni di barre, in {n_file} file; {len(giovani)} con storia più breve")
if len(presi) < 800:
    sys.exit("Troppi titoli senza barre: nessun calcolo.")
