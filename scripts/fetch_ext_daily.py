"""
fetch_ext_daily.py — ultime barre giornaliere (circa due anni) dei titoli che il sito non segue ma su cui si calcolano
i segnali della TBO Strategy (tbo_state_ext.json). Scrive daily_ext.json ({simbolo: {d, o, h, l, c}}), file temporaneo.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
percorso = os.path.join(ROOT, "tbo_state_ext.json")
if not os.path.exists(percorso):
    raise SystemExit("Nessun titolo aggiunto: niente da scaricare.")
simboli = sorted(json.load(open(percorso, encoding="utf-8"))["titoli"])

import yfinance as yf
r4 = lambda s: [round(float(v), 4) for v in s.values]
out = {}
for i in range(0, len(simboli), 200):
    lotto = simboli[i:i + 200]
    try:
        df = yf.download(lotto, period="2y", interval="1d", auto_adjust=False, group_by="ticker", threads=True, progress=False)
    except Exception as e:
        print(f"Lotto {i // 200 + 1}: {e}"); continue
    for s in lotto:
        try:
            b = df[s][["Open", "High", "Low", "Close"]].dropna()
        except Exception:
            continue
        if len(b) > 300:
            out[s] = {"d": [x.strftime("%Y-%m-%d") for x in b.index], "o": r4(b["Open"]), "h": r4(b["High"]), "l": r4(b["Low"]), "c": r4(b["Close"])}
json.dump(out, open(os.path.join(ROOT, "daily_ext.json"), "w"), separators=(",", ":"))
print(f"Barre dei titoli aggiunti: {len(out)}/{len(simboli)}")
