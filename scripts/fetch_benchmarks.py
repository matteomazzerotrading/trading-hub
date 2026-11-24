"""Chiusure giornaliere degli indici di confronto per il portafoglio (benchmarks.json).

S&P 500, FTSE MIB e MSCI World, ognuno nella sua valuta, da inizio 2025; il cambio EUR/USD e le chiusure
delle azioni in euro del portafoglio. Il sito le usa per contare in quanti giorni
il portafoglio ha fatto meglio o peggio di ciascun indice. Si aggiunge allo storico già salvato: se Yahoo Finance non
risponde per un indice, quell'indice resta com'era.
"""
import json, os, re, sys
from datetime import date, timedelta

import yfinance as yf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PERCORSO = os.path.join(ROOT, 'benchmarks.json')
INDICI = [
    ('sp500', 'S&P 500', 'USD', ['^GSPC']),
    ('ftsemib', 'FTSE MIB', 'EUR', ['FTSEMIB.MI']),
    # l'indice MSCI World (prezzo, in dollari); se Yahoo non lo dà, l'ETF iShares MSCI World che lo replica
    ('msciworld', 'MSCI World', 'USD', ['^990100-USD-STRD', 'URTH']),
]


def scarica(simbolo, inizio='2025-01-01'):
    df = yf.download(simbolo, start=inizio, interval='1d', auto_adjust=False, progress=False, threads=False)
    if df is None or df.empty:
        return {}
    col = df['Close']
    if hasattr(col, 'columns'):          # colonne a più livelli nelle versioni recenti di yfinance
        col = col.iloc[:, 0]
    return {i.strftime('%Y-%m-%d'): round(float(v), 4) for i, v in col.dropna().items() if float(v) > 0}


# Azioni in euro del portafoglio, comprese quelle già vendute. TradingView le conta in dollari al cambio fissato
# all'acquisto; per mostrare il portafoglio in euro il sito usa il loro valore in euro, giorno per giorno: servono le
# chiusure in euro dal primo acquisto.
SUFFISSI = {'MIL': '.MI', 'XETR': '.DE', 'EURONEXT': '.PA', 'BME': '.MC', 'FWB': '.F', 'EURONEXT_AMS': '.AS'}
ISIN = re.compile(r'^[A-Z]{2}[A-Z0-9]{9}[0-9]$')


def azioni_eur(prima):
    try:
        ops = json.load(open(os.path.join(ROOT, 'portfolio.json'))).get('operazioni') or []
    except Exception:                                    # noqa: BLE001
        return prima
    inizi, borse = {}, {}
    for o in ops:
        t = o.get('ticker') or ''
        if o.get('curr') != 'EUR' or ISIN.match(t) or o.get('exchange') not in SUFFISSI:
            continue
        inizi[t] = min(inizi.get(t, o['date']), o['date'])
        borse[t] = o['exchange']
    out = dict(prima)
    for t, d0 in inizi.items():
        simbolo = t.replace('.', '-') + SUFFISSI[borse[t]]
        inizio = (date.fromisoformat(d0) - timedelta(days=10)).isoformat()
        try:
            dati = scarica(simbolo, inizio)
        except Exception as e:                           # noqa: BLE001
            print(f'{t}: {simbolo} non disponibile ({e})', file=sys.stderr)
            continue
        if not dati:
            print(f'{t}: {simbolo} senza dati, resta lo storico salvato', file=sys.stderr)
            continue
        vecchie = prima.get(t, {})
        unite = dict(zip(vecchie.get('d', []), vecchie.get('c', []))) if vecchie.get('simbolo') == simbolo else {}
        unite.update(dati)
        giorni = sorted(unite)
        out[t] = {'simbolo': simbolo, 'd': giorni, 'c': [unite[g] for g in giorni]}
        print(f'{t}: {simbolo}, {len(giorni)} sedute dal {giorni[0]}')
    return out


def main():
    vecchio = json.load(open(PERCORSO)) if os.path.exists(PERCORSO) else {'serie': {}}
    serie = vecchio.get('serie', {})
    for k, nome, valuta, simboli in INDICI:
        prima = serie.get(k, {})
        for s in simboli:
            try:
                dati = scarica(s)
            except Exception as e:                       # noqa: BLE001
                print(f'{nome}: {s} non disponibile ({e})', file=sys.stderr)
                dati = {}
            if len(dati) >= 100:
                if prima.get('simbolo') not in (None, s):
                    unite = dati                         # cambiato simbolo: niente misture tra serie diverse
                else:
                    unite = dict(zip(prima.get('d', []), prima.get('c', [])))
                    unite.update(dati)
                giorni = sorted(unite)
                serie[k] = {'nome': nome, 'valuta': valuta, 'simbolo': s, 'd': giorni, 'c': [unite[g] for g in giorni]}
                print(f'{nome}: {s}, {len(giorni)} sedute fino al {giorni[-1]}')
                break
            print(f'{nome}: {s} con {len(dati)} sedute, provo il simbolo successivo', file=sys.stderr)
        else:
            print(f'{nome}: nessun dato nuovo, resta lo storico salvato', file=sys.stderr)
    if not serie:
        sys.exit('Nessun indice scaricato')
    # cambio EUR/USD giornaliero: serve al sito per mostrare il portafoglio (in dollari su TradingView) anche in euro
    cambi = vecchio.get('cambi', {})
    try:
        dati = scarica('EURUSD=X')
        if len(dati) >= 100:
            prima = cambi.get('eurusd', {})
            unite = dict(zip(prima.get('d', []), prima.get('c', []))); unite.update(dati)
            giorni = sorted(unite)
            cambi['eurusd'] = {'nome': 'EUR/USD', 'simbolo': 'EURUSD=X', 'd': giorni, 'c': [unite[g] for g in giorni]}
            print(f'EUR/USD: {len(giorni)} sedute fino al {giorni[-1]}')
    except Exception as e:                               # noqa: BLE001
        print(f'EUR/USD non disponibile ({e})', file=sys.stderr)
    titoli_eur = azioni_eur(vecchio.get('titoli_eur', {}))
    with open(PERCORSO, 'w') as f:
        json.dump({'aggiornato': date.today().isoformat(), 'serie': serie, 'cambi': cambi, 'titoli_eur': titoli_eur},
                  f, separators=(',', ':'))
        f.write('\n')


if __name__ == '__main__':
    main()
