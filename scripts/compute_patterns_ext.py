"""
compute_patterns_ext.py — Pattern Scanner sugli altri titoli (quelli di tbo_state_ext.json: società americane ed
europee che il sito non segue). Stessa logica di scripts/compute_patterns.mjs: correlazione di Pearson tra le ultime
171 chiusure e ogni finestra della stessa lunghezza nelle 3000 sedute precedenti; la proiezione applica al prezzo di
oggi le variazioni che seguirono il periodo più simile. Scarica 13 anni di chiusure da Yahoo Finance a lotti, senza
tenerle in memoria tutte insieme, e scrive:
  patterns_ext.json          sintesi per titolo (chiave come in fv_ext.json), con nome e simbolo TradingView
  patterns_ext/<x>.json      i punti dei grafici, divisi per iniziale della chiave (il sito scarica solo quella che serve)
Eseguito ogni sera dopo i segnali TBO; se qualcosa va storto restano i file della sera prima.
"""
import json, os, sys
from datetime import datetime, timezone

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = {"LUNGHEZZA": 171, "PROFONDITA": 3000, "SOGLIA": 0.90, "PROIEZIONE": 252}


def scan(c):
    L, last = P["LUNGHEZZA"], len(c) - 1
    lookback = min(P["PROFONDITA"], last - L - P["PROIEZIONE"] - 1)
    if lookback <= L:
        return None
    x = c[last - L + 1:]
    i = np.arange(L + 2, lookback + 1)
    Y = sliding_window_view(c, L)[last - i - L + 1]           # finestra che finisce i sedute fa
    sx, sx2 = x.sum(), (x * x).sum()
    sy, sy2, sxy = Y.sum(1), (Y * Y).sum(1), Y @ x
    den = np.sqrt(np.maximum(0, L * sx2 - sx * sx) * np.maximum(0, L * sy2 - sy * sy))
    r = np.where(den == 0, 0.0, (L * sxy - sx * sy) / np.where(den == 0, 1, den))
    j = int(np.argmax(r))                                       # a parità, il periodo più recente (come nel JavaScript)
    best_r, best_i = float(r[j]), int(i[j])
    limite, base, oggi = min(P["PROIEZIONE"], best_i), c[last - best_i], c[last]
    proj = oggi * (1 + (c[last - best_i + 1:last - best_i + limite + 1] - base) / base)
    return {"r": best_r, "i": best_i, "limite": limite, "proj": proj, "inizio": last - best_i - L + 1, "fine": last - best_i}


def ogni(a, k):
    return [v for n, v in enumerate(a) if n % k == 0 or n == len(a) - 1]


r5 = lambda v: float(f"{float(v):.5g}")


def main():
    stato = json.load(open(os.path.join(ROOT, "tbo_state_ext.json"), encoding="utf-8"))["titoli"]
    dati = json.load(open(os.path.join(ROOT, "data.json"), encoding="utf-8"))
    db, alias = dati.get("db", {}), dati.get("aliases", {})

    def chiave(sym, tv):                                       # come chiaveExt in scripts/compute_fv.mjs
        if "." in sym:
            return sym
        t = (tv or "").split(":")[-1] or sym
        return t + ".US" if t in db or t in alias else t

    import yfinance as yf
    simboli = sorted(s for s, x in stato.items() if x.get("tv"))
    sintesi, dettaglio, n_ok = {}, {}, 0
    for k in range(0, len(simboli), 150):
        lotto = simboli[k:k + 150]
        try:
            df = yf.download(lotto, period="13y", interval="1d", auto_adjust=False, group_by="ticker", threads=True, progress=False)
        except Exception as e:                                  # noqa: BLE001
            print(f"Lotto {k // 150 + 1}: {e}", file=sys.stderr); continue
        for s in lotto:
            try:
                b = df[s]["Close"].dropna()
            except Exception:                                   # noqa: BLE001
                continue
            c = b.values.astype(float)
            if len(c) < 800 or not np.all(c > 0) or np.any((c[1:] / c[:-1] > 4) | (c[1:] / c[:-1] < 0.25)):
                continue
            res = scan(c)
            if not res:
                continue
            d = [x.strftime("%Y-%m-%d") for x in b.index]
            last, oggi, L = len(c) - 1, c[-1], P["LUNGHEZZA"]
            proj = res["proj"]
            ok = res["r"] >= P["SOGLIA"]; n_ok += ok
            key = chiave(s, stato[s]["tv"])
            sintesi[key] = {"r": round(res["r"], 4), "ok": bool(ok), "data": d[last], "prezzo": r5(oggi), "dal": d[res["inizio"]], "al": d[res["fine"]],
                            "sedute": res["limite"], "var": round((proj[-1] / oggi - 1) * 100, 1),
                            "min": round((proj.min() / oggi - 1) * 100, 1), "max": round((proj.max() / oggi - 1) * 100, 1),
                            "n": stato[s].get("n") or key, "tv": stato[s]["tv"]}
            scala = oggi / c[res["fine"]]
            dettaglio[key] = {"att": [r5(v) for v in ogni(c[last - L + 1:], 2)],
                              "sto": [r5(v * scala) for v in ogni(c[res["inizio"]:res["fine"] + 1], 2)],
                              "pro": [r5(v) for v in ogni(list(proj), 3)]}
        print(f"Lotto {k // 150 + 1}: {len(sintesi)} titoli finora")
    if len(sintesi) < 300:
        sys.exit(f"Solo {len(sintesi)} titoli analizzati: restano i file precedenti.")
    run = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    json.dump({"aggiornato": run, "parametri": P, "titoli": sintesi}, open(os.path.join(ROOT, "patterns_ext.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    cartella = os.path.join(ROOT, "patterns_ext")
    os.makedirs(cartella, exist_ok=True)
    gruppi = {}
    for key, v in dettaglio.items():
        g = key[0].lower() if key[0].isalnum() else "_"
        gruppi.setdefault(g, {})[key] = v
    for f in os.listdir(cartella):
        if f.endswith(".json") and f[:-5] not in gruppi:
            os.remove(os.path.join(cartella, f))
    for g, v in gruppi.items():
        json.dump({"aggiornato": run, "titoli": v}, open(os.path.join(cartella, g + ".json"), "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"Pattern Scanner, altri titoli: {len(sintesi)} analizzati, {n_ok} con somiglianza di almeno il 90%")


if __name__ == "__main__":
    main()
