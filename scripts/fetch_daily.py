"""
fetch_daily.py — scarica 14 anni di prezzi giornalieri (apertura, massimo, minimo, chiusura) di tutti i titoli
e li salva in market_daily.json (file temporaneo, non nel repo). Serve a scripts/compute_signals.mjs
(segnali della TBO Strategy e MM Pattern Scanner).
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data = json.load(open(os.path.join(ROOT, "data.json"), encoding="utf-8"))
symbols = sorted({e.get("yf") or t for t, e in data["db"].items() if e.get("tv")})
out = {}
import yfinance as yf
for i in range(0, len(symbols), 100):                      # a blocchi, per non perdere tutto se un blocco fallisce
    blocco = symbols[i:i + 100]
    try:
        df = yf.download(blocco, period="14y", interval="1d", auto_adjust=False, group_by="ticker", threads=True, progress=False)
    except Exception as e:
        print(f"Blocco {i} non scaricato: {e}")
        continue
    for s in blocco:
        try:
            d = df[s][["Open", "High", "Low", "Close"]].dropna()
        except Exception:
            continue
        if len(d) < 300:
            continue
        out[s] = {"d": [x.strftime("%Y-%m-%d") for x in d.index],
                  "o": [round(float(v), 4) for v in d["Open"]], "h": [round(float(v), 4) for v in d["High"]],
                  "l": [round(float(v), 4) for v in d["Low"]], "c": [round(float(v), 4) for v in d["Close"]]}
json.dump(out, open(os.path.join(ROOT, "market_daily.json"), "w"))
print(f"Prezzi giornalieri: {len(out)}/{len(symbols)} simboli")
