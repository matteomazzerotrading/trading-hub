"""
dump_market.py — prezzi settimanali di lungo periodo (chiusure e chiusure rettificate per i dividendi),
S&P 500, rendimento del decennale USA (^TNX) e CPI USA, in backtest_inputs/market.json.
Serve alla verifica sul passato della formula del fair value (workflow "Dump Inputs").
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_market_data import cpi_fred, cpi_bls

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data = json.load(open(os.path.join(ROOT, "data.json"), encoding="utf-8"))
symbols = sorted({e.get("yf") or t for t, e in data["db"].items() if e.get("tv")} | {"^GSPC", "^TNX"})
out = {"weekly": {}, "adj": {}, "cpi": []}
for name, fn in (("FRED", cpi_fred), ("BLS", cpi_bls)):
    try:
        cpi = fn()
        if len(cpi) > 60:
            out["cpi"] = cpi
            break
    except Exception as e:
        print(f"CPI {name} non disponibile: {e}")

import yfinance as yf
df = yf.download(symbols, period="19y", interval="1wk", auto_adjust=False, group_by="ticker", threads=True, progress=False)
for s in symbols:
    try:
        c = df[s]["Close"].dropna()
        a = df[s]["Adj Close"].dropna()
    except Exception:
        continue
    out["weekly"][s] = [[i.strftime("%Y-%m-%d"), round(float(v), 4)] for i, v in c.items()]
    out["adj"][s] = [[i.strftime("%Y-%m-%d"), round(float(v), 4)] for i, v in a.items()]
os.makedirs(os.path.join(ROOT, "backtest_inputs"), exist_ok=True)
json.dump(out, open(os.path.join(ROOT, "backtest_inputs", "market.json"), "w"))
print(f"Prezzi: {sum(1 for v in out['weekly'].values() if len(v) > 100)}/{len(symbols)} simboli; CPI {len(out['cpi'])} mesi")
