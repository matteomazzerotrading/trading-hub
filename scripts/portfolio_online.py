#!/usr/bin/env python3
"""
portfolio_online.py — modalità "online" per portfolio.json, quando il PC è spento.

Il task serale legge portfolio.json da TradingView via browser sul PC (fonte
"tradingview"). Quando il PC non è disponibile, questo script stima il valore
del portafoglio partendo dall'ultima fotografia TradingView (`snapshot`) e dai
prezzi di mercato correnti (connettore TradingView, mcp-tv-get-symbol-data-batch).

Ogni posizione viene rivalutata in proporzione al movimento del suo prezzo
(e del cambio EUR/USD per i titoli in euro) rispetto alla fotografia, così i
valori restano allineati con quelli di TradingView invece di saltare.

Uso:
  python scripts/portfolio_online.py symbols
      → stampa la lista JSON dei simboli da chiedere al connettore
  python scripts/portfolio_online.py snapshot PREZZI.json
      → dopo un aggiornamento da TradingView: salva la fotografia di riferimento
  python scripts/portfolio_online.py online PREZZI.json
      → stima i valori di oggi e aggiorna summary, periods, positions, history

PREZZI.json è il campo `data` restituito dal connettore:
  {"NASDAQ:NFLX": {"close": 63.41, "currency": "USD"}, ..., "FX_IDC:EURUSD": {...}}
"""

import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

FILE = 'portfolio.json'
FX = 'FX_IDC:EURUSD'
MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']


def today():
    return datetime.now(ZoneInfo('Europe/Rome')).date()


def sym(p):
    return f"{p['exchange']}:{p['ticker']}"


def asset_class(p):
    """Tipologia come in TradingView: Azioni, Obbligazioni, ETF/Dr, Fund."""
    return p.get('class') or ('Obbligazioni' if p['type'] == 'bond' else 'Azioni')


def load():
    with open(FILE, encoding='utf-8') as f:
        return json.load(f)


def save(d):
    # `history` ha un punto per ogni seduta: lo si scrive compatto, una riga per punto
    hist = d.get('history') or []
    text = json.dumps({**d, 'history': '@@HISTORY@@'}, ensure_ascii=False, indent=2)
    rows = ',\n'.join('    ' + json.dumps(h, ensure_ascii=False) for h in hist)
    text = text.replace('"@@HISTORY@@"', '[\n' + rows + '\n  ]' if hist else '[]')
    with open(FILE, 'w', encoding='utf-8') as f:
        f.write(text + '\n')


def load_prices(path):
    with open(path, encoding='utf-8') as f:
        prices = json.load(f)
    if 'data' in prices and isinstance(prices['data'], dict):
        prices = prices['data']
    if FX not in prices:
        sys.exit(f'Manca {FX} nei prezzi')
    return prices


def add_history(d, value, source):
    """Punto di oggi: valore, rendimento totale % (al netto dei versamenti, come lo calcola TradingView)
    e profitto totale in USD. Il grafico del sito usa `perf` per il rendimento e `value` per il valore."""
    day = today().isoformat()
    h = d.setdefault('history', [])
    s = d.get('summary', {})
    point = {'date': day, 'value': round(value, 2)}
    if s.get('total_pl_pct') is not None:
        point['perf'] = s['total_pl_pct']
    if s.get('total_pl_usd') is not None:
        point['pl'] = s['total_pl_usd']
    point['source'] = source
    if h and h[-1].get('date') == day:
        h[-1] = point
    else:
        h.append(point)


def cmd_symbols():
    d = load()
    print(json.dumps([sym(p) for p in d['positions']] + [FX]))


def cmd_snapshot(path):
    """Fotografia di riferimento: valori TradingView + prezzi di mercato dello stesso momento."""
    d = load()
    prices = load_prices(path)
    total = d['summary']['total_value_usd']
    missing = [sym(p) for p in d['positions'] if sym(p) not in prices]
    if missing:
        sys.exit(f'Prezzi mancanti: {missing}')
    s = d['summary']
    d['snapshot'] = {
        'date': today().isoformat(),
        'eurusd': prices[FX]['close'],
        'summary': dict(s),
        'periods': json.loads(json.dumps(d.get('periods', {}))),
        # base dei rendimenti %, ricavata dai valori TradingView
        'unrealized_base': s['unrealized_pl_usd'] / (s['unrealized_pl_pct'] / 100) if s['unrealized_pl_pct'] else None,
        'positions': {
            p['ticker']: {
                'price': prices[sym(p)]['close'],
                'value_usd': round(p['alloc_pct'] / 100 * total, 2),
                'unrealized_pl': p['unrealized_pl'],
                'qty': p['qty'],
            } for p in d['positions']
        },
    }
    d['source'] = 'tradingview'
    add_history(d, total, 'tradingview')
    save(d)
    print(f"Snapshot salvato: {len(d['positions'])} posizioni, EURUSD {prices[FX]['close']}")


def cmd_online(path):
    d = load()
    snap = d.get('snapshot')
    if not snap:
        sys.exit('Nessuno snapshot TradingView: serve prima un aggiornamento dal PC')
    prices = load_prices(path)
    fx_now, fx_ref = prices[FX]['close'], snap['eurusd']

    missing = [sym(p) for p in d['positions'] if sym(p) not in prices]
    if missing:
        sys.exit(f'Prezzi mancanti, nessuna modifica: {missing}')

    total_pos = 0.0
    for p in d['positions']:
        q = prices[sym(p)]
        eur = q.get('currency') == 'EUR'
        ref = snap['positions'].get(p['ticker'])
        if ref and ref['qty'] == p['qty'] and ref['price']:
            # rivaluta in proporzione al prezzo (e al cambio per i titoli in EUR)
            ratio = q['close'] / ref['price'] * ((fx_now / fx_ref) if eur else 1)
            value = ref['value_usd'] * ratio
            p['unrealized_pl'] = round(ref['unrealized_pl'] + value - ref['value_usd'], 2)
        else:
            # posizione nuova o quantità cambiata dopo lo snapshot
            fx = fx_now if eur else 1
            value = p['qty'] * q['close'] * fx
            p['unrealized_pl'] = round(value - p['qty'] * p['avg_price'] * fx, 2)
        p['_value'] = value
        total_pos += value

    s0 = snap['summary']
    cash = d['summary']['cash_usd']
    total = total_pos + cash
    delta = total - s0['total_value_usd']

    for p in d['positions']:
        p['alloc_pct'] = round(p.pop('_value') / total * 100, 2)
    d['positions'].sort(key=lambda p: -p['alloc_pct'])

    s = d['summary']
    s['total_value_usd'] = round(total, 2)
    s['unrealized_pl_usd'] = round(s0['unrealized_pl_usd'] + delta, 2)
    s['total_pl_usd'] = round(s0['total_pl_usd'] + delta, 2)
    if snap.get('unrealized_base'):
        s['unrealized_pl_pct'] = round(s['unrealized_pl_usd'] / snap['unrealized_base'] * 100, 2)
    # Rendimento totale %: quello di TradingView alla fotografia, concatenato con la variazione da allora.
    # (Il rapporto profitto/percentuale non è una base affidabile: vicino allo zero cambia perfino segno.)
    var = delta / s0['total_value_usd'] if s0['total_value_usd'] else 0
    s['total_pl_pct'] = round(((1 + s0['total_pl_pct'] / 100) * (1 + var) - 1) * 100, 2)
    # realized_pl, dividends, cash, annualized_return restano quelli dell'ultimo dato TradingView

    # periodi: valore TradingView dello snapshot + variazione da allora (stima)
    for k, v in snap.get('periods', {}).items():
        per = d.setdefault('periods', {}).setdefault(k, {})
        if 'pl_usd' in v:
            per['pl_usd'] = round(v['pl_usd'] + delta, 2)
        if 'pl_pct' in v:
            per['pl_pct'] = round(((1 + v['pl_pct'] / 100) * (1 + var) - 1) * 100, 2)

    # allocazione per tipologia (campo `class` di ogni posizione, come in TradingView)
    for a in d.get('allocation', []):
        val = sum(p['alloc_pct'] / 100 * total for p in d['positions'] if asset_class(p) == a['label'])
        a['value_usd'] = round(val, 2)
        a['pct'] = round(val / total * 100, 2)

    t = today()
    d['updated'] = f"{t.day:02d} {MESI[t.month - 1]} {t.year}"
    d['source'] = 'online'
    add_history(d, total, 'online')
    save(d)
    print(json.dumps({'total_value_usd': s['total_value_usd'],
                      'delta_since_snapshot': round(delta, 2),
                      'snapshot_date': snap['date']}))


if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] not in ('symbols', 'snapshot', 'online'):
        sys.exit(__doc__)
    if sys.argv[1] == 'symbols':
        cmd_symbols()
    elif len(sys.argv) < 3:
        sys.exit('Serve il file dei prezzi')
    elif sys.argv[1] == 'snapshot':
        cmd_snapshot(sys.argv[2])
    else:
        cmd_online(sys.argv[2])
