"""Chiusure giornaliere degli indici di confronto per il portafoglio (benchmarks.json).

S&P 500, FTSE MIB e MSCI World, ognuno nella sua valuta, da inizio 2025. Il sito le usa per contare in quanti giorni
il portafoglio ha fatto meglio o peggio di ciascun indice. Si aggiunge allo storico già salvato: se Yahoo Finance non
risponde per un indice, quell'indice resta com'era.
"""
import json, os, sys
from datetime import date

import yfinance as yf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PERCORSO = os.path.join(ROOT, 'benchmarks.json')
INDICI = [
    ('sp500', 'S&P 500', 'USD', ['^GSPC']),
    ('ftsemib', 'FTSE MIB', 'EUR', ['FTSEMIB.MI']),
    # l'indice MSCI World (prezzo, in dollari); se Yahoo non lo dà, l'ETF iShares MSCI World che lo replica
    ('msciworld', 'MSCI World', 'USD', ['^990100-USD-STRD', 'URTH']),
]


def scarica(simbolo):
    df = yf.download(simbolo, start='2025-01-01', interval='1d', auto_adjust=False, progress=False, threads=False)
    if df is None or df.empty:
        return {}
    col = df['Close']
    if hasattr(col, 'columns'):          # colonne a più livelli nelle versioni recenti di yfinance
        col = col.iloc[:, 0]
    return {i.strftime('%Y-%m-%d'): round(float(v), 4) for i, v in col.dropna().items() if float(v) > 0}


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
    with open(PERCORSO, 'w') as f:
        json.dump({'aggiornato': date.today().isoformat(), 'serie': serie}, f, separators=(',', ':'))
        f.write('\n')


if __name__ == '__main__':
    main()
