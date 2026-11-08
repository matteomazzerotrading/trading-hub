"""
fetch_market_data.py — scarica i dati di mercato per il calcolo dei fair value
(scripts/compute_fv.mjs) e li salva in market_data.json (file temporaneo, non nel repo).

  • Prezzi settimanali di 11 anni di tutti i titoli + S&P 500  → yfinance
    (yfinance si presenta a Yahoo come un browser: le richieste dirette da GitHub vengono rifiutate)
  • CPI USA mensile (CPI-U non destagionalizzato, la stessa serie di ECONOMICS:USCPI)
    → FRED (CPIAUCNS), in alternativa BLS (CUUR0000SA0)
"""
import csv, io, json, os, sys, urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "market_data.json")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}


def cpi_fred():
    req = urllib.request.Request("https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS", headers=UA)
    txt = urllib.request.urlopen(req, timeout=30).read().decode()
    out = []
    for r in csv.reader(io.StringIO(txt)):
        if len(r) == 2 and r[0][:4].isdigit() and r[1] not in (".", ""):
            out.append([r[0][:7] + "-01", float(r[1])])
    return out


def cpi_bls():
    out = {}
    this = date.today().year
    for start in (this - 19, this - 9):                 # due finestre da 10 anni (limite senza chiave)
        body = json.dumps({"seriesid": ["CUUR0000SA0"], "startyear": str(start), "endyear": str(min(start + 9, this))}).encode()
        req = urllib.request.Request("https://api.bls.gov/publicAPI/v2/timeseries/data/", data=body,
                                     headers={**UA, "Content-Type": "application/json"})
        j = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
        for s in j.get("Results", {}).get("series", []):
            for p in s.get("data", []):
                if p["period"].startswith("M") and p["period"] != "M13" and p["value"] not in ("-", ""):
                    out[f"{p['year']}-{p['period'][1:]}-01"] = float(p["value"])
    return sorted([k, v] for k, v in out.items())


def main():
    data = json.load(open(os.path.join(ROOT, "data.json"), encoding="utf-8"))
    symbols = sorted({e.get("yf") or t for t, e in data["db"].items() if e.get("tv")} | {"^GSPC"})
    result = {"weekly": {}, "cpi": [], "fonti": {}}

    # CPI
    for name, fn in (("FRED", cpi_fred), ("BLS", cpi_bls)):
        try:
            cpi = fn()
            if len(cpi) > 60:
                result["cpi"], result["fonti"]["cpi"] = cpi, name
                break
        except Exception as e:
            print(f"CPI {name} non disponibile: {e}")
    print(f"CPI: {len(result['cpi'])} mesi da {result['fonti'].get('cpi')}, ultimo {result['cpi'][-1] if result['cpi'] else None}")

    # Prezzi settimanali
    try:
        import yfinance as yf
        df = yf.download(symbols, period="11y", interval="1wk", auto_adjust=False, group_by="ticker",
                         threads=True, progress=False)
        for s in symbols:
            try:
                col = df[s]["Close"].dropna()
            except Exception:
                continue
            result["weekly"][s] = [[idx.strftime("%Y-%m-%d"), round(float(v), 6)] for idx, v in col.items()]
        result["fonti"]["prezzi"] = "yfinance"
    except Exception as e:
        print(f"Prezzi settimanali non disponibili: {e}")
    ok = sum(1 for v in result["weekly"].values() if len(v) > 100)
    print(f"Prezzi settimanali: {ok}/{len(symbols)} simboli con oltre 100 settimane")

    json.dump(result, open(OUT, "w", encoding="utf-8"))


if __name__ == "__main__":
    main()
