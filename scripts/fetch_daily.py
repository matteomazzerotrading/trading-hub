"""
fetch_daily.py — chiusure giornaliere degli ultimi 14 anni di tutti i titoli, in daily.json
(file temporaneo, non nel repository). Serve al Pattern Scanner (scripts/compute_patterns.mjs).
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data = json.load(open(os.path.join(ROOT, "data.json"), encoding="utf-8"))
symbols = sorted({e.get("yf") or t for t, e in data["db"].items() if e.get("tv")})
out = {}
import yfinance as yf
df = yf.download(symbols, period="14y", interval="1d", auto_adjust=False, group_by="ticker", threads=True, progress=False)
for s in symbols:
    try:
        col = df[s]["Close"].dropna()
    except Exception:
        continue
    if len(col) > 300:
        out[s] = {"d": [i.strftime("%Y-%m-%d") for i in col.index], "c": [round(float(v), 4) for v in col.values]}
json.dump(out, open(os.path.join(ROOT, "daily.json"), "w"))
print(f"Chiusure giornaliere: {len(out)}/{len(symbols)} simboli")
