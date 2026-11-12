"""
fetch_daily.py — barre giornaliere (apertura, massimo, minimo, chiusura) degli ultimi 14 anni di tutti i titoli,
in daily.json (file temporaneo, non nel repository). Serve al Pattern Scanner (scripts/compute_patterns.mjs,
solo le chiusure) e ai segnali della TBO Strategy (scripts/compute_tbo.mjs).
Con l'argomento "coda" scrive anche backtest_inputs/daily_tail.json con le ultime 420 sedute (per le verifiche),
con "storia" backtest_inputs/daily_full.json con tutte le sedute scaricate.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data = json.load(open(os.path.join(ROOT, "data.json"), encoding="utf-8"))
symbols = sorted({e.get("yf") or t for t, e in data["db"].items() if e.get("tv")})
out = {}
import yfinance as yf
df = yf.download(symbols, period="14y", interval="1d", auto_adjust=False, group_by="ticker", threads=True, progress=False)
r4 = lambda s: [round(float(v), 4) for v in s.values]
for s in symbols:
    try:
        b = df[s][["Open", "High", "Low", "Close"]].dropna()
    except Exception:
        continue
    if len(b) > 300:
        out[s] = {"d": [i.strftime("%Y-%m-%d") for i in b.index],
                  "o": r4(b["Open"]), "h": r4(b["High"]), "l": r4(b["Low"]), "c": r4(b["Close"])}
json.dump(out, open(os.path.join(ROOT, "daily.json"), "w"))
print(f"Barre giornaliere: {len(out)}/{len(symbols)} simboli")

if "storia" in sys.argv[1:]:                       # tutta la storia scaricata, per le statistiche di lungo periodo
    os.makedirs(os.path.join(ROOT, "backtest_inputs"), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, "backtest_inputs", "daily_full.json"), "w"), separators=(",", ":"))

if "coda" in sys.argv[1:]:
    os.makedirs(os.path.join(ROOT, "backtest_inputs"), exist_ok=True)
    coda = {s: {k: v[-420:] for k, v in b.items()} for s, b in out.items()}
    json.dump(coda, open(os.path.join(ROOT, "backtest_inputs", "daily_tail.json"), "w"))
