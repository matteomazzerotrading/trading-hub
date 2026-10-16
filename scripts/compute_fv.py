#!/usr/bin/env python3
"""
compute_fv.py — Calcola il Fair Value per tutti i ticker del portafoglio
e aggiorna data.json sul repo GitHub.

Replica le formule dell'indicatore Pine Script "FAIR VALUE (dati realizzati)"
di matteomazzero2002, usando yfinance per i dati fondamentali.

Formula principale:
  spread   = max(Ke - PI, spread_min)       dove Ke = RF + beta * ERP
  FV       = FCF_norm * (1 + PI) / spread * (1 ± qualità) + cassa/az
  FV_LOW   = stesso con FCF minimo storico
  FV_HIGH  = stesso con FCF massimo storico
  FV_MKT   = FCF_norm * (1 + RF) / max(beta*ERP, spread_min) * (1 ± qualità) + cassa/az
  FV_STO   = FCF_norm / yld_mediano_storico
"""

import json, os, base64, time, math
from datetime import datetime
import urllib.request, urllib.error

# ── Parametri (allineati agli input del Pine Script) ─────────────────────────
ERP        = 0.0423   # Damodaran implied ERP — aggiorna manualmente se cambia
SPREAD_MIN = 0.02     # spread minimo Ke − inflazione
ANNI       = 10       # anni fiscali da usare
PREMIO_PCT = 0.03     # premio/sconto qualità
INFL_FIX   = 0.025    # inflazione fissa di fallback

# Ticker del portafoglio (solo azioni/ETF, non obbligazioni)
TICKERS_PORTAFOGLIO = [
    "TTD", "TRI", "DIA.MI", "PFE", "SAP",
    "BR", "BF-B", "PDD", "BSX", "QCOM",
    "EL.PA", "LULU", "BLDR", "RACE.MI",
    "FUN", "CE", "INTU", "CPRT", "ADBE", "FMC"
]

# Mappa ticker TradingView → yfinance (dove divergono)
TV_TO_YF = {
    "DIA":   "DIA.MI",
    "RACE":  "RACE.MI",
    "EL":    "EL.PA",
    "BF.B":  "BF-B",
    "SGBS":  "SGBS.L",
}

# ── Fetch US 10Y da FRED ──────────────────────────────────────────────────────
def get_rf():
    """Tasso risk-free: US 10Y da FRED."""
    try:
        url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"
        req = urllib.request.Request(url, headers={"User-Agent": "FV-Bot/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            lines = r.read().decode().strip().split("\n")
        for line in reversed(lines):
            parts = line.split(",")
            if len(parts) == 2 and parts[1].strip() not in (".", ""):
                return float(parts[1].strip()) / 100
    except Exception as e:
        print(f"  RF fallback 4.3% ({e})")
    return 0.043  # fallback

# ── Calcolo FV ────────────────────────────────────────────────────────────────
def compute_fv(ticker_yf, ticker_tv, rf, pi=None):
    """
    Calcola FV per un singolo ticker.
    Restituisce dict con fv, fv_low, fv_high, fv_mkt, fv_sto oppure None.
    """
    try:
        import yfinance as yf
    except ImportError:
        raise RuntimeError("yfinance non installato")

    tk = yf.Ticker(ticker_yf)
    info = tk.info or {}

    # ── Dati fondamentali ────────────────────────────────────────────────
    # Flussi di cassa e bilancio
    try:
        cf = tk.cashflow        # colonne = anni fiscali, righe = voci
        inc = tk.income_stmt
        bal = tk.balance_sheet
    except Exception as e:
        print(f"  {ticker_tv}: errore dati ({e})")
        return None

    def row(df, *keys):
        """Cerca una riga nel dataframe per nome (case-insensitive, alias multipli)."""
        if df is None or df.empty:
            return None
        idx_lower = {k.lower(): k for k in df.index}
        for k in keys:
            orig = idx_lower.get(k.lower())
            if orig:
                return df.loc[orig]
        return None

    fcf_row  = row(cf,  "Free Cash Flow", "freeCashFlow")
    rev_row  = row(inc, "Total Revenue", "totalRevenue")
    earn_row = row(inc, "Net Income", "netIncome")
    cash_row = row(bal, "Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments",
                        "Cash And Short Term Investments")
    tso      = info.get("sharesOutstanding") or info.get("impliedSharesOutstanding")

    if fcf_row is None or rev_row is None or tso is None or tso == 0:
        print(f"  {ticker_tv}: dati insufficienti (FCF/REV/azioni mancanti)")
        return None

    # Serie storiche (fino a ANNI anni, più recente per primo)
    def series(row_):
        if row_ is None:
            return []
        vals = [float(v) for v in row_.values if v is not None and not math.isnan(v)]
        return vals[:ANNI]

    fcf_s  = series(fcf_row)
    rev_s  = series(rev_row)
    earn_s = series(earn_row)

    if len(fcf_s) < 4 or len(rev_s) < 4:
        print(f"  {ticker_tv}: storia troppo corta ({len(fcf_s)} anni FCF)")
        return None

    n = min(len(fcf_s), len(rev_s), ANNI)
    fcf_s, rev_s = fcf_s[:n], rev_s[:n]

    # ── FCF normalizzato (metodo margine, come default Pine Script) ───────
    marges = [fcf_s[i] / rev_s[i] for i in range(n) if rev_s[i] > 0]
    if not marges:
        return None

    marg_n   = sum(marges) / len(marges)  # media (non mediana, come default)
    marg_min = min(marges)
    marg_max = max(marges)
    rev_now  = rev_s[0]                   # ricavi più recenti

    fcf_norm = marg_n   * rev_now / tso
    fcf_min  = marg_min * rev_now / tso
    fcf_max  = marg_max * rev_now / tso

    # ── Cassa per azione ──────────────────────────────────────────────────
    cash_val = 0.0
    if cash_row is not None:
        v = float(list(cash_row.values)[0]) if list(cash_row.values) else 0
        if not math.isnan(v):
            cash_val = max(v, 0) / tso

    # ── Beta (da yfinance, con correzione Blume) ──────────────────────────
    beta_raw = info.get("beta") or 1.0
    if beta_raw < 0.3 or beta_raw > 3.0:
        beta_raw = 1.0
    beta = 0.67 * beta_raw + 0.33  # correzione Blume

    # ── Tasso richiesto e inflazione ──────────────────────────────────────
    pi_val = pi if pi else INFL_FIX
    ke = rf + beta * ERP
    spread = max(ke - pi_val, SPREAD_MIN)

    # ── Qualità: ricavi e utili ultimo anno vs media precedenti ───────────
    qual = 0.0
    if len(earn_s) >= 4 and len(rev_s) >= 4:
        avg_rev  = sum(rev_s[1:]) / (n - 1)
        avg_earn = sum(earn_s[1:n]) / (n - 1) if earn_s and len(earn_s) >= n else 0
        if rev_s[0] > avg_rev and earn_s and earn_s[0] > avg_earn:
            qual = PREMIO_PCT
        else:
            qual = -PREMIO_PCT

    # ── Formula FV ───────────────────────────────────────────────────────
    def capitalizza(fcf):
        if fcf <= 0 or spread <= 0:
            return None
        return fcf * (1 + pi_val) / spread

    def valore(fcf):
        epv = capitalizza(fcf)
        if epv is None:
            return None
        return round(epv * (1 + qual) + cash_val, 2)

    fv      = valore(fcf_norm)
    fv_low  = valore(fcf_min)
    fv_high = valore(fcf_max)

    # FV di mercato: spread_mkt = beta * ERP
    spread_mkt = max(beta * ERP, SPREAD_MIN)
    fv_mkt = None
    if fcf_norm > 0 and spread_mkt > 0:
        fv_mkt = round(fcf_norm * (1 + rf) / spread_mkt * (1 + qual) + cash_val, 2)

    # FV storico: usa prezzo attuale e yield mediano
    price = info.get("currentPrice") or info.get("regularMarketPrice")
    fv_sto = None
    if price and price > 0 and fcf_norm > 0:
        # Stima il yield mediano dai dati disponibili
        # (non abbiamo 120 mesi come nel Pine Script, usiamo il yield attuale come proxy)
        yld_now = fcf_norm / price
        # Yield mediano approssimato: media tra yield attuale e quello dell'anno precedente
        if len(fcf_s) >= 2:
            hist_prices = []
            try:
                hist = tk.history(period="5y", interval="1mo")
                if not hist.empty:
                    closes = hist["Close"].dropna().tolist()
                    ylds = []
                    for p in closes:
                        if p > 0:
                            ylds.append(fcf_norm / p)
                    if len(ylds) >= 12:
                        ylds_sorted = sorted(ylds)
                        mid = len(ylds_sorted) // 2
                        yld_med = (ylds_sorted[mid - 1] + ylds_sorted[mid]) / 2 if len(ylds_sorted) % 2 == 0 else ylds_sorted[mid]
                        if yld_med > 0:
                            fv_sto = round(fcf_norm / yld_med, 2)
            except:
                pass

    result = {}
    if fv      is not None: result["fv"]      = fv
    if fv_low  is not None: result["fv_low"]  = fv_low
    if fv_high is not None: result["fv_high"] = fv_high
    if fv_mkt  is not None: result["fv_mkt"]  = fv_mkt
    if fv_sto  is not None: result["fv_sto"]  = fv_sto

    return result if result else None


# ── GitHub API ────────────────────────────────────────────────────────────────
REPO     = "matteomazzerotrading/trading-hub"
API_BASE = f"https://api.github.com/repos/{REPO}/contents"

def gh_headers():
    token = os.environ.get("GITHUB_TOKEN", "")
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "FV-Bot/1.0",
        "Content-Type": "application/json",
    }

def gh_get(path):
    req = urllib.request.Request(f"{API_BASE}/{path}", headers=gh_headers())
    with urllib.request.urlopen(req, timeout=15) as r:
        meta = json.loads(r.read())
    content = json.loads(base64.b64decode(meta["content"].replace("\n", "")))
    return content, meta["sha"]

def gh_put(path, content, sha, message):
    encoded = base64.b64encode(json.dumps(content, indent=2, ensure_ascii=False).encode()).decode()
    body = json.dumps({
        "message": message,
        "content": encoded,
        "sha": sha,
        "committer": {"name": "FV Bot", "email": "bot@tradinghub.local"}
    }).encode()
    req = urllib.request.Request(f"{API_BASE}/{path}", data=body, headers=gh_headers(), method="PUT")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


# ── Inflazione breakeven US da FRED ───────────────────────────────────────────
def get_breakeven():
    try:
        url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=T10YIE"
        req = urllib.request.Request(url, headers={"User-Agent": "FV-Bot/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            lines = r.read().decode().strip().split("\n")
        for line in reversed(lines):
            parts = line.split(",")
            if len(parts) == 2 and parts[1].strip() not in (".", ""):
                return float(parts[1].strip()) / 100
    except:
        pass
    return INFL_FIX


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=== FV Bot avviato ===")
    print(f"Data: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")

    rf = get_rf()
    pi = get_breakeven()
    print(f"RF (US10Y): {rf*100:.2f}%  |  Inflazione breakeven: {pi*100:.2f}%")

    # Leggi data.json attuale
    try:
        data, sha = gh_get("data.json")
    except Exception as e:
        print(f"Errore lettura data.json: {e}")
        return

    if "db" not in data:
        data["db"] = {}

    updated = []
    failed  = []

    for ticker_tv in TICKERS_PORTAFOGLIO:
        ticker_yf = TV_TO_YF.get(ticker_tv, ticker_tv)
        print(f"\n→ {ticker_tv} ({ticker_yf})")
        try:
            result = compute_fv(ticker_yf, ticker_tv, rf, pi)
            if result:
                if ticker_tv not in data["db"]:
                    data["db"][ticker_tv] = {}
                data["db"][ticker_tv].update(result)
                fv_str = f"fv={result.get('fv','—')}"
                print(f"  ✅ {fv_str}  low={result.get('fv_low','—')}  high={result.get('fv_high','—')}")
                updated.append(ticker_tv)
            else:
                print(f"  ⚠️  nessun risultato")
                failed.append(ticker_tv)
        except Exception as e:
            print(f"  ❌ errore: {e}")
            failed.append(ticker_tv)
        time.sleep(0.5)  # gentile con yfinance

    data["fv_updated"]    = datetime.utcnow().isoformat() + "Z"
    data["fv_tickers_ok"] = updated
    data["fv_rf"]         = round(rf * 100, 3)
    data["fv_pi"]         = round(pi * 100, 3)

    msg = f"FV auto: {len(updated)} ticker aggiornati [{datetime.utcnow().strftime('%Y-%m-%d')}]"
    try:
        gh_put("data.json", data, sha, msg)
        print(f"\n✅ data.json aggiornato — {len(updated)} OK, {len(failed)} saltati")
        if failed:
            print(f"   Saltati: {', '.join(failed)}")
    except Exception as e:
        print(f"\n❌ Errore scrittura data.json: {e}")
        raise

if __name__ == "__main__":
    main()
