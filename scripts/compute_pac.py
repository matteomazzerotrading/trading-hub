"""Piani di accumulo (pac.json → stato).

Per ogni piano e ogni strumento ricostruisce le quote rata per rata: la rata scatta il giorno indicato del mese (o la
prima seduta utile dopo) al prezzo di chiusura di quel giorno. Con quote_intere si comprano solo quote intere (il resto
della rata non viene investito). Se per uno strumento ci sono quote e investito a una certa data ('foto'), si parte da
quelli e si aggiungono solo le rate successive.

Scrive in pac.json → stato: quote, investito, prezzo e valore per strumento, totali per piano, prossima rata e lo
storico giornaliero (valore, versato). I prezzi vengono da Yahoo Finance: se uno strumento non ha prezzi, il piano
resta com'era e lo si segnala.
"""
import json, math, os
from datetime import date, datetime, timedelta

import yfinance as yf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PERCORSO = os.path.join(ROOT, 'pac.json')


def chiusure(simboli, dal):
    """Prima serie non vuota tra i simboli indicati, oppure cercando l'ISIN su Yahoo."""
    for s in simboli:
        try:
            df = yf.download(s, start=dal, interval='1d', auto_adjust=False, progress=False, threads=False)
        except Exception:
            df = None
        if df is None or df.empty:
            continue
        col = df['Close']
        if hasattr(col, 'columns'):
            col = col.iloc[:, 0]
        serie = {i.strftime('%Y-%m-%d'): float(v) for i, v in col.dropna().items() if float(v) > 0}
        if serie:
            return s, serie
    return None, {}


def date_rata(giorno, dal, al):
    """Date di addebito tra dal e al (comprese): il giorno indicato di ogni mese, o l'ultimo giorno se il mese è più corto."""
    out, a, m = [], dal.year, dal.month
    while True:
        ultimo = (date(a + (m // 12), m % 12 + 1, 1) - timedelta(days=1)).day
        d = date(a, m, min(giorno, ultimo))
        if d > al:
            break
        if d >= dal:
            out.append(d)
        m += 1
        if m > 12:
            a, m = a + 1, 1
    return out


def prossima(giorno, oggi):
    nxt = date_rata(giorno, oggi + timedelta(days=1), oggi + timedelta(days=62))
    return nxt[0].isoformat() if nxt else None


def main():
    with open(PERCORSO, encoding='utf-8') as f:
        cfg = json.load(f)
    vecchio = cfg.get('stato') or {}
    oggi = date.today()
    stato = {'aggiornato': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'), 'piani': []}
    for p in cfg['piani']:
        inizio = p.get('inizio')
        foto = p.get('foto') or {}
        sp = {'id': p['id'], 'nome': p['nome'], 'descrizione': p.get('descrizione'), 'giorno': p['giorno'], 'rata': sum(s['rata'] for s in p['strumenti']),
              'prossima': prossima(p['giorno'], oggi), 'strumenti': [], 'avvisi': []}
        if not inizio and not any(s.get('quote') for s in p['strumenti']):
            sp['avvisi'].append('in attesa della data di partenza o delle quote possedute')
            stato['piani'].append(sp)
            continue
        extra = p.get('versamenti_extra') or []                     # versamenti fuori calendario, es. quello iniziale: [[data, importo]]
        rata_piano = sum(x['rata'] for x in p['strumenti']) or 1
        dal = min(x for x in [inizio, foto.get('data')] + [e[0] for e in extra] if x)
        dal_dl = (date.fromisoformat(dal) - timedelta(days=10)).isoformat()
        serie_tot = {}
        for s in p['strumenti']:
            # se nessun simbolo funziona si prova con l'ISIN (yfinance lo cerca su Yahoo, utile per i fondi)
            simbolo, px = chiusure((s.get('yf') or []) + [s['isin']], dal_dl)
            if not px and s.get('prezzo_manuale'):
                # nessun prezzo da Yahoo: il valore della quota dell'ultimo estratto, uguale per ogni giorno feriale da allora
                pm = s['prezzo_manuale']; d0 = date.fromisoformat(pm['data'])
                px = {(d0 + timedelta(days=k)).isoformat(): float(pm['valore']) for k in range((oggi - d0).days + 1) if (d0 + timedelta(days=k)).weekday() < 5}
                simbolo = 'valore della quota al ' + pm['data']
            giorni = sorted(px)
            ss = {k: s.get(k) for k in ('isin', 'ticker', 'nome', 'rata', 'tipo', 'tv', 'paese', 'settore')}
            ss['simbolo'] = simbolo
            if not giorni:
                vs = next((x for x in (vecchio.get('piani') or []) for x in x.get('strumenti', []) if x.get('isin') == s['isin']), None)
                sp['avvisi'].append(f"{s['ticker']}: nessun prezzo disponibile")
                if vs:
                    sp['strumenti'].append(vs)
                continue
            def compra(d, importo):
                """Acquisto alla prima chiusura dal giorno d: [giorno, quote, prezzo, euro investiti], oppure None se non ancora eseguito."""
                g = next((x for x in giorni if x >= d.isoformat()), None)
                if not g:
                    return None
                prezzo = px[g]
                q = math.floor(importo / prezzo) if p.get('quote_intere') else importo / prezzo
                return [g, q, round(prezzo, 4), q * prezzo]
            def esegui(da, con_extra=False):
                """Rate dal giorno 'da' in poi (e, se richiesto, i versamenti fuori calendario dello stesso periodo)."""
                ordini = [(d, s['rata']) for d in date_rata(p['giorno'], da, oggi)]
                if con_extra:
                    ordini += [(date.fromisoformat(e[0]), e[1] * s['rata'] / rata_piano) for e in extra]
                rate = [r for r in (compra(d, imp) for d, imp in sorted(ordini)) if r]
                return rate
            # ricostruzione dalla data di inizio; se c'è la foto, da quel giorno valgono le sue quote
            ric = esegui(date.fromisoformat(inizio), True) if inizio and p.get('ricostruisci', True) else []
            con_foto = s.get('quote') is not None and foto.get('data')
            if con_foto:
                fd = foto['data']
                dopo = esegui(date.fromisoformat(fd) + timedelta(days=1))
                prima = [r for r in ric if r[0] <= fd]
                # la ricostruzione è tarata sulla foto: quote e investito alla data della foto coincidono con quelli reali,
                # così lo storico arriva alla foto senza salti (le differenze sono costi e arrotondamenti)
                qr, ir = sum(r[1] for r in prima), sum(r[3] for r in prima)
                kq = float(s['quote']) / qr if qr else 1.0
                ki = float(s.get('investito') or 0) / ir if ir else 1.0
                prima = [[r[0], r[1] * kq, r[2], r[3] * ki] for r in prima]
                pezzi = [(None, fd, 0.0, 0.0, prima), (fd, None, float(s['quote']), float(s.get('investito') or 0), dopo)]
                ss['origine'] = 'quote al ' + fd
                if ric:
                    ss['ricostruite_alla_foto'] = sum(r[1] for r in ric if r[0] <= fd)
            else:
                pezzi = [(None, None, 0.0, 0.0, ric)]
                ss['origine'] = 'ricostruito dal ' + inizio
            def stato_al(g, pezzi=pezzi):
                for da, a, q0, i0, rr in pezzi:
                    if (da is None or g >= da) and (a is None or g < a):      # dal giorno della foto valgono le sue quote
                        return q0 + sum(r[1] for r in rr if r[0] <= g), i0 + sum(r[3] for r in rr if r[0] <= g)
                return 0.0, 0.0
            ultimo = giorni[-1]
            # se l'ultimo prezzo è anteriore alla foto (fondi con NAV in ritardo) valgono comunque le quote della foto
            quote, investito = stato_al(max(ultimo, foto['data']) if con_foto else ultimo)
            ss.update({'quote': round(quote, 4), 'investito': round(investito, 2), 'prezzo': round(px[ultimo], 4), 'data_prezzo': ultimo,
                       'valore': round(quote * px[ultimo], 2), 'rate': [[r[0], round(r[1], 4), r[2], round(r[3], 2)] for r in pezzi[-1][4]]})
            sp['strumenti'].append(ss)
            serie_tot[s['isin']] = (px, stato_al)
        sp['investito'] = round(sum(x.get('investito') or 0 for x in sp['strumenti']), 2)
        sp['valore'] = round(sum(x.get('valore') or 0 for x in sp['strumenti']), 2)
        # storico giornaliero: quote possedute giorno per giorno × ultima chiusura nota (borse con festività diverse)
        tutte = sorted({g for (px, _f) in serie_tot.values() for g in px if g >= dal})
        storia, ultimo_px = [], {}
        for g in tutte:
            v = inv = 0.0
            for isin, (px, stato_al) in serie_tot.items():
                if g in px:
                    ultimo_px[isin] = px[g]
                if isin not in ultimo_px:
                    continue
                q, i = stato_al(g)
                v += q * ultimo_px[isin]
                inv += i
            if v > 0:
                storia.append([g, round(v, 2), round(inv, 2)])
        sp['storia'] = storia
        if foto.get('investito') is not None:
            sp['foto'] = foto
        stato['piani'].append(sp)
    cfg['stato'] = stato
    with open(PERCORSO, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=1)
    for sp in stato['piani']:
        print(sp['nome'], 'investito', sp.get('investito'), 'valore', sp.get('valore'), 'avvisi', sp['avvisi'])


if __name__ == '__main__':
    main()
