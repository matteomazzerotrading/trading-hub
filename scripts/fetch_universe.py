"""
fetch_universe.py — barre giornaliere di un campione largo di azioni, per il track record della TBO Strategy.

Il campione: le società degli indici S&P 500, S&P 400 e S&P 600 (grandi, medie e piccole americane, dagli elenchi
di Wikipedia) più i titoli europei e italiani seguiti dal sito (data.json). Scrive nella cartella indicata dei file
daily_N.json ({simbolo: {d, h, l, c}}) e meta.json con il gruppo di ogni simbolo. Sono file temporanei.
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
gruppo = {}
for nome, pagina in INDICI:
    try:
        html = urllib.request.urlopen(urllib.request.Request("https://en.wikipedia.org/wiki/" + pagina, headers=UA), timeout=40).read().decode("utf-8")
        tab = next(t for t in pd.read_html(io.StringIO(html)) if any(str(c).strip().lower() in ("symbol", "ticker symbol", "ticker") for c in t.columns))
        col = next(c for c in tab.columns if str(c).strip().lower() in ("symbol", "ticker symbol", "ticker"))
        sim = [str(x).strip().upper().replace(".", "-") for x in tab[col] if isinstance(x, str) and 0 < len(x.strip()) <= 6]
        for s in sim:
            gruppo.setdefault(s, nome)
        print(f"{nome}: {len(sim)} simboli")
    except Exception as e:
        print(f"{nome}: elenco non disponibile ({e})")

data = json.load(open(os.path.join(ROOT, "data.json"), encoding="utf-8"))
for t, e in data["db"].items():
    if e.get("tv"):
        s = e.get("yf") or t
        gruppo.setdefault(s, "Europa e Italia (titoli del sito)" if "." in s else "USA, altri titoli del sito")

simboli = sorted(gruppo)
if sum(1 for g in gruppo.values() if g.startswith("USA ") and "S&P" in g) < 800:
    sys.exit("Elenchi degli indici incompleti: il campione largo non è disponibile, nessun calcolo.")

import yfinance as yf
r4 = lambda s: [round(float(v), 4) for v in s.values]
presi, n_file = {}, 0
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
    json.dump(out, open(os.path.join(OUT, f"daily_{n_file}.json"), "w"), separators=(",", ":")); n_file += 1
    print(f"Lotto {i // 150 + 1}: {len(out)}/{len(lotto)}")
json.dump({"gruppo": presi, "descrizione": "società degli indici S&P 500, 400 e 600 più i titoli europei e italiani seguiti dal sito"},
          open(os.path.join(OUT, "meta.json"), "w"), ensure_ascii=False)
print(f"Campione: {len(presi)} titoli con almeno 6 anni di barre, in {n_file} file")
if len(presi) < 800:
    sys.exit("Troppi titoli senza barre: nessun calcolo.")
