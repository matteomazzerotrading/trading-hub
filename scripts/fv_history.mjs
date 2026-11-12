// fv_history.mjs — come è cambiato il fair value di un titolo nel tempo, a confronto con il prezzo.
//
// Per ogni fine trimestre degli ultimi 6 anni si rifà il calcolo del fair value (pavimento) con il solo
// materiale disponibile a quella data: bilanci già pubblicati, prezzi, decennale e inflazione di allora.
// Cassa, debito e ROIC sono noti solo a oggi e quindi restano fuori dai punti passati (userebbero
// informazioni future): per questo l'ultimo punto, quello di oggi, può staccarsi di poco dalla serie.
import { createRequire } from 'node:module';
const E = createRequire(import.meta.url)('./fv_engine.js');

const iso = d => d.toISOString().slice(0, 10);
// indice dell'ultima riga con data <= s (righe [data, valore] in ordine crescente)
function idxAt(rows, s) { let lo = 0, hi = rows.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m][0] <= s) { a = m; lo = m + 1; } else hi = m - 1; } return a; }
export const valAt = (rows, s) => { const i = rows && rows.length ? idxAt(rows, s) : -1; return i >= 0 ? rows[i][1] : null; };
const upTo = (rows, s) => (rows ? rows.slice(0, idxAt(rows, s) + 1) : []);
const r2 = x => (x == null || !isFinite(x) ? null : Number(x.toFixed(Math.abs(x) < 10 ? 3 : 2)));

// Ultimi `n` fine trimestre già conclusi prima di `oggi` (in ordine crescente)
export function fineTrimestri(oggi, n = 24) {
  const out = [], d = new Date(oggi + 'T00:00:00Z');
  let y = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3);       // trimestre in corso
  while (out.length < n) {
    q--; if (q < 0) { q = 3; y--; }
    out.unshift(iso(new Date(Date.UTC(y, q * 3 + 3, 0))));
  }
  return out;
}

// Serie del titolo: { fv: [...], p: [...] } allineate a `date`; null dove il calcolo non è possibile.
export function storicoFv(f, weekly, bench, cpi, rfAt, date, opts) {
  const f0 = Object.assign({}, f, { cash_n_short_term_invest_fq: null, cash_n_short_term_invest_fy: null, total_debt_fq: null,
    total_debt_fy: null, return_on_invested_capital_fy: null, earnings_release_date: null });
  const fv = [], p = [];
  for (const D of date) {
    const w = upTo(weekly, D);
    let v = null;
    if (w.length >= 60) {
      const rf = rfAt(D);
      if (rf != null) { try { const r = E.compute(f0, cpi, rf, null, w, upTo(bench, D), w, D, opts); if (r.status === 'ok' && r.fv > 0) v = r.fv; } catch (e) {} }
    }
    fv.push(r2(v)); p.push(w.length ? r2(w[w.length - 1][1]) : null);
  }
  return { fv, p };
}
