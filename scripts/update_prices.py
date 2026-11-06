"""
update_prices.py — aggiorna i prezzi in data.json usando yfinance.
Eseguito dal GitHub Action "Aggiorna Prezzi".

Non tocca i Fair Value (fv) — quelli rimangono quelli che hai impostato tu.
Aggiorna solo "price" (ultimo prezzo disponibile) e "updated".
Salta le voci senza nome/valuta (create per errore) e i ticker senza dati,
senza mai cancellare il prezzo precedente.
"""

import json
import sys
from datetime import datetime, timezone

try:
    import yfinance as yf
except ImportError:
    print("Installa yfinance: pip install yfinance")
    sys.exit(1)

DATA_FILE = 'data.json'


def last_price(yf_ticker):
    t = yf.Ticker(yf_ticker)
    # 1) prezzo intraday più recente
    try:
        p = t.fast_info.get('last_price')
        if p and p > 0:
            return float(p)
    except Exception:
        pass
    # 2) ultima chiusura
    hist = t.history(period='5d')
    if hist.empty:
        return None
    return float(hist['Close'].dropna().iloc[-1])


def main():
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    db = data.get('db', {})
    updated, errors = 0, 0
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    for ticker, entry in db.items():
        if 'curr' not in entry or 'yf' not in entry:
            print(f"  ⏭  {ticker}: voce incompleta, saltata")
            continue
        yf_ticker = entry['yf']
        try:
            price = last_price(yf_ticker)
            if not price:
                print(f"  ⚠  {ticker} ({yf_ticker}): nessun dato, tengo {entry.get('price')}")
                errors += 1
                continue
            old = entry.get('price')
            # Controllo di sicurezza: variazione > 60% rispetto al prezzo salvato = probabile errore di dati
            if old and abs(price - old) / old > 0.6:
                print(f"  ⚠  {ticker}: {old} → {price:.2f} (variazione anomala, aggiorno comunque — verifica)")
            entry['price'] = round(price, 3 if price < 10 else 2)
            entry['updated'] = today
            print(f"  ✓  {ticker}: {entry['price']} {entry.get('curr','')}")
            updated += 1
        except Exception as e:
            print(f"  ✗  {ticker} ({yf_ticker}): {e}")
            errors += 1

    data['prices_updated'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\nCompletato: {updated} prezzi aggiornati, {errors} errori.")


if __name__ == '__main__':
    main()
