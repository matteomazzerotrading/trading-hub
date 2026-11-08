/*
 * fv_engine.js — formula dell'indicatore Pine Script "FAIR VALUE (dati realizzati)"
 * di matteomazzero2002 (impostazioni di default), tradotta in JavaScript.
 *
 * Usato in due posti, con lo stesso codice:
 *   • scripts/compute_fv.mjs (GitHub Actions) → calcola i fair value e li scrive in data.json
 *   • index.html (sito)                       → calcola il verdetto con il prezzo live
 *
 * Differenze note rispetto all'indicatore sul grafico TradingView:
 *   • ROIC medio: TradingView espone solo l'ultimo anno → si usa quello.
 *   • Azioni degli anni con EPS < 0,05: si usano le azioni attuali (il Pine usa quelle dell'anno).
 *   • Un bilancio annuale "entra" nel calcolo 45 giorni dopo la chiusura dell'esercizio.
 *   • Oscillatore z-score: non calcolato.
 */
(function (root) {
  'use strict';

  // ── Input dell'indicatore (default del Pine Script) ──────────────────────────
  const P = {
    ERP: 0.0423,          // premio per il rischio implicito (Damodaran) — aggiornalo quando cambia
    SPREAD_MIN: 0.02,     // spread minimo Ke − inflazione
    ANNI: 10,             // anni fiscali massimi
    PREMIO_PCT: 0.03,     // premio/sconto qualità
    INFL_FIX: 0.025,      // inflazione fissa se nessun dato
    BETA_SETT: 260,       // settimane per il beta
    BETA_MAN: 1.0,        // beta se non calcolabile
    MESI_YLD: 120,        // mesi per il FCF yield storico
    MOS: 0.0,             // margine di sicurezza sotto la banda
    TOLL_G: 0.01,         // tolleranza crescita implicita vs storica
    CONV_MIN: 0.7,        // conversione FCF/utile minima
    LEV_MAX: 4.0,         // debito netto massimo (anni di FCF)
    LAG_FY_DAYS: 45       // giorni tra chiusura esercizio e pubblicazione
  };

  // ── Date (stringhe ISO 'YYYY-MM-DD') ─────────────────────────────────────────
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const isoWeek = s => {
    const d = new Date(s + 'T00:00:00Z');
    const day = (d.getUTCDay() + 6) % 7;            // lunedì = 0
    d.setUTCDate(d.getUTCDate() - day + 3);         // giovedì della stessa settimana
    const y = d.getUTCFullYear();
    const first = new Date(Date.UTC(y, 0, 4));
    const w = 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
    return y * 100 + w;
  };
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // CPI come lo vede request.economic: valore del mese della data (o l'ultimo disponibile prima).
  // cpi = [['YYYY-MM-01', valore], ...] in ordine crescente
  function cpiAt(cpi, s) {
    if (!cpi || !cpi.length) return null;
    const key = s.slice(0, 7) + '-01';
    let best = null;
    for (const [m, v] of cpi) { if (m <= key) best = v; else break; }
    return best;
  }

  // Anni fiscali validi, più recente per primo (come 'nuovoFY' nel Pine).
  // f = riga dello screener TradingView (valori già nella valuta del titolo)
  function annualHistory(f) {
    const years = f.fiscal_period_fy_h || [];
    const fcf = f.free_cash_flow_fy_h || [], rev = f.total_revenue_fy_h || [];
    const ni = f.net_income_fy_h || [], eps = f.earnings_per_share_diluted_fy_h || [];
    const tso = f.total_shares_outstanding;
    if (!years.length || !f.fiscal_period_end_fy) return [];
    const lastEnd = iso(new Date(f.fiscal_period_end_fy * 1000));
    // Fattore per portare i valori storici nella valuta del titolo (es. GBP → GBX = 100)
    let fact = 1;
    if (f.total_revenue_fy && rev[0]) { fact = f.total_revenue_fy / rev[0]; if (Math.abs(fact - 1) < 0.02) fact = 1; }
    const out = [];
    years.forEach((y, k) => {
      const F = fcf[k], R = rev[k], E = ni[k], EP = eps[k];
      if (R == null || R <= 0 || F == null) return;
      let az = tso;
      if (E != null && EP != null && Math.abs(EP) > 0.05 && E / EP > 0) az = E / EP;
      if (!az || az <= 0) return;
      const end = (Number(lastEnd.slice(0, 4)) - (years[0] - y)) + lastEnd.slice(4).replace('-02-29', '-02-28');
      out.push({ year: y, avail: addDays(end, P.LAG_FY_DAYS), fcf: F * fact, rev: R * fact, earn: E, az });
    });
    return out;
  }

  const windowAt = (hist, s) => hist.filter(h => h.avail <= s).slice(0, P.ANNI);

  // FCF normalizzato (metodo margine × ricavi per azione attuali rivalutati al CPI)
  function fcfNormAt(win, cpi, s) {
    const marg = win.map(h => h.fcf / h.rev);
    const c0 = cpiAt(cpi, win[0].avail), cn = cpiAt(cpi, s);
    const fatt0 = c0 && cn && c0 > 0 ? cn / c0 : 1;
    const revNow = win[0].rev / win[0].az * fatt0;
    const margN = avg(marg);
    return { fcfNorm: margN * revNow, fcfMin: Math.min(...marg) * revNow, fcfMax: Math.max(...marg) * revNow, margN, margNow: marg[0] };
  }

  // Beta dai rendimenti settimanali delle ultime 260 settimane chiuse vs S&P 500, con Blume
  function betaFrom(weeklyS, weeklyB) {
    const byWeek = rows => { const m = new Map(); for (const [d, c] of rows) m.set(isoWeek(d), c); return m; };
    const s = byWeek(weeklyS), b = byWeek(weeklyB);
    let weeks = [...s.keys()].filter(w => b.has(w)).sort((x, y) => x - y);
    if (weeks.length < 3) return { beta: null, raw: null };
    weeks = weeks.slice(0, -1);                    // la settimana in corso non è ancora registrata
    let rs = [], rb = [];
    for (let i = 1; i < weeks.length; i++) {
      const s0 = s.get(weeks[i - 1]), b0 = b.get(weeks[i - 1]);
      if (s0 > 0 && b0 > 0) { rs.push(s.get(weeks[i]) / s0 - 1); rb.push(b.get(weeks[i]) / b0 - 1); }
    }
    rs = rs.slice(-P.BETA_SETT); rb = rb.slice(-P.BETA_SETT);
    if (rs.length < 52) return { beta: null, raw: null };
    const ms = avg(rs), mb = avg(rb);
    let cov = 0, vr = 0;
    for (let i = 0; i < rs.length; i++) { cov += (rs[i] - ms) * (rb[i] - mb); vr += (rb[i] - mb) ** 2; }
    if (vr <= 0) return { beta: null, raw: null };
    const raw = cov / vr;
    return { beta: 0.67 * raw + 0.33, raw };
  }

  // Chiusura del primo giorno di borsa di ogni mese (timeframe.change("M") sul giornaliero)
  function monthFirstCloses(daily) {
    const seen = new Set(), out = [];
    for (const [d, c] of daily) { const k = d.slice(0, 7); if (!seen.has(k)) { seen.add(k); out.push([d, c]); } }
    return out;
  }

  /*
   * Calcolo completo per un titolo.
   *   f        riga screener TradingView
   *   cpi      [['YYYY-MM-01', v], ...]
   *   rf, be   decennale e breakeven in decimali (es. 0.0486)
   *   weeklyS / weeklyB  [['YYYY-MM-DD', close], ...] titolo e S&P 500
   *   daily    [['YYYY-MM-DD', close], ...] almeno 11 anni (o già i primi giorni del mese)
   *   today    'YYYY-MM-DD'
   */
  function compute(f, cpi, rf, be, weeklyS, weeklyB, daily, today) {
    const res = { status: 'ok', avvisi: [] };
    const hist = annualHistory(f);
    const win = windowAt(hist, today);
    const n = win.length;
    res.anni = n;
    if (n < 4) { res.status = 'dati_insufficienti'; return res; }

    const { beta: bCalc, raw: betaRaw } = betaFrom(weeklyS, weeklyB);
    const betaSospetto = betaRaw != null && (betaRaw < 0.3 || betaRaw > 3);
    const beta = bCalc != null ? bCalc : P.BETA_MAN;
    const ke = rf != null ? rf + beta * P.ERP : null;

    const { fcfNorm, fcfMin, fcfMax, margN, margNow } = fcfNormAt(win, cpi, today);

    const fcfps = win.map(h => h.fcf / h.az), revps = win.map(h => h.rev / h.az);
    const anniNeg = fcfps.filter(x => x < 0).length;
    let gFcf = null, gRev = null;
    const rec = (fcfps[0] + fcfps[1]) / 2, vec = (fcfps[n - 1] + fcfps[n - 2]) / 2;
    if (rec > 0 && vec > 0) gFcf = Math.pow(rec / vec, 1 / (n - 2)) - 1;
    if (revps[0] > 0 && revps[n - 1] > 0) gRev = Math.pow(revps[0] / revps[n - 1], 1 / (n - 1)) - 1;
    const gHist = gRev;

    const c0 = cpiAt(cpi, win[0].avail), cN = cpiAt(cpi, win[n - 1].avail);
    const inflAnn = c0 && cN && cN > 0 ? Math.pow(c0 / cN, 1 / (n - 1)) - 1 : P.INFL_FIX;
    const pi = be != null ? be : inflAnn;
    const piSrc = be != null ? 'breakeven' : 'CPI realizzata';
    const spread = ke != null ? Math.max(ke - pi, P.SPREAD_MIN) : null;

    const earn = win.map(h => h.earn);
    const sumNI = earn.reduce((a, e) => a + (e != null ? e : 0), 0);
    const conv = sumNI > 0 ? win.reduce((a, h) => a + h.fcf, 0) / sumNI : null;
    const roicM = f.return_on_invested_capital_fy != null ? f.return_on_invested_capital_fy / 100 : null;

    const cash = f.cash_n_short_term_invest_fq != null ? f.cash_n_short_term_invest_fq : f.cash_n_short_term_invest_fy;
    const debt = f.total_debt_fq != null ? f.total_debt_fq : f.total_debt_fy;
    const az0 = win[0].az;
    const cassaAz = cash != null && az0 > 0 ? cash / az0 : 0;
    const debnet = (debt || 0) - (cash || 0);
    const levAnni = fcfNorm > 0 ? (debnet / az0) / fcfNorm : null;

    let qual;
    const avgRev = avg(win.slice(1).map(h => h.rev));
    if (earn.some(e => e == null)) qual = -P.PREMIO_PCT;
    else qual = win[0].rev > avgRev && earn[0] > avg(earn.slice(1)) ? P.PREMIO_PCT : -P.PREMIO_PCT;

    const capitalizza = x => x > 0 && spread ? x * (1 + pi) / spread : null;
    const valore = x => { const c = capitalizza(x); return c != null ? c * (1 + qual) + cassaAz : null; };
    const fv = valore(fcfNorm), fvLow = valore(fcfMin), fvHigh = valore(fcfMax);
    const spreadMkt = rf != null ? Math.max(beta * P.ERP, P.SPREAD_MIN) : null;
    const fvMkt = fcfNorm > 0 && spreadMkt ? fcfNorm * (1 + rf) / spreadMkt * (1 + qual) + cassaAz : null;

    // Fair value storico: mediana del FCF yield mensile (FCF normalizzato di allora / prezzo di allora)
    let ylds = [];
    for (const [d, c] of monthFirstCloses(daily)) {
      const w = windowAt(hist, d);
      if (w.length < 4 || !(c > 0)) continue;
      const fn = fcfNormAt(w, cpi, d).fcfNorm;
      if (fn > 0) ylds.push(fn / c);
    }
    ylds = ylds.slice(-P.MESI_YLD);
    const yldMed = ylds.length >= 36 ? median(ylds) : null;
    const fvSto = yldMed && yldMed > 0 ? fcfNorm / yldMed : null;

    if (fcfNorm <= 0) res.status = 'fcf_negativo';
    else if (ke == null) res.status = 'tasso_non_disponibile';

    const pct = x => (x * 100).toFixed(1).replace('.', ',') + '%';
    if (betaSospetto) res.avvisi.push(`beta calcolato ${betaRaw.toFixed(2)}: verifica l'indice`);
    if (margNow < margN * 0.75) res.avvisi.push(`margine attuale ${pct(margNow)} molto sotto la media ${pct(margN)}`);
    if (conv != null && conv < P.CONV_MIN) res.avvisi.push(`FCF solo ${Math.round(conv * 100)}% dell'utile`);
    if (anniNeg > 0) res.avvisi.push(`${anniNeg} anni con FCF negativo`);
    if (levAnni != null && levAnni > P.LEV_MAX) res.avvisi.push(`debito netto = ${levAnni.toFixed(1).replace('.', ',')} anni di FCF`);

    const r = (x, k = 4) => x == null || !isFinite(x) ? null : Number(x.toFixed(k));
    Object.assign(res, {
      fv: r(fv, 2), fv_low: r(fvLow, 2), fv_high: r(fvHigh, 2), fv_mkt: r(fvMkt, 2), fv_sto: r(fvSto, 2),
      ke: r(ke), rf: r(rf), beta: r(beta, 3), beta_raw: r(betaRaw, 3), pi: r(pi), pi_src: piSrc,
      spread: r(spread), spread_mkt: r(spreadMkt), fcf_norm: r(fcfNorm, 4), marg_n: r(margN), marg_now: r(margNow),
      cassa_az: r(cassaAz, 4), lev_anni: r(levAnni, 2), qual, g_hist: r(gHist), g_fcf: r(gFcf),
      infl_ann: r(inflAnn), conv: r(conv), roic_m: r(roicM), anni_neg: anniNeg, mesi_yld: ylds.length,
      anno_ultimo_bilancio: win[0].year
    });
    return res;
  }

  /*
   * Verdetto a quattro zone dell'indicatore, con il prezzo attuale.
   *   d     = voce di data.json (fv, fv_low, fv_high, fv_mkt + d.ind con ke, pi, fcf_norm, cassa_az, g_hist, roic_m, status, avvisi)
   *   close = prezzo attuale
   * Ritorna { key, titolo, sotto, colore, dettagli[], gImpl } — key: 'molto_sotto' | 'sotto' | 'equa_declino'
   *   | 'molto_sotto_declino' | 'equita' | 'sopra' | 'premio_sostenuto' | 'premio_dubbio' | 'sopra_nd' | 'na'
   */
  function verdict(d, close) {
    const ind = d.ind || {};
    const pct = x => x == null || !isFinite(x) ? 'n.d.' : (x * 100).toFixed(1).replace('.', ',') + '%';
    const out = { key: 'na', titolo: 'DATI INSUFFICIENTI', sotto: '', colore: '#9e9e9e', dettagli: [], gImpl: null };
    if (ind.status === 'fcf_negativo') return Object.assign(out, { titolo: 'FCF NORMALIZZATO NEGATIVO', sotto: 'modello non applicabile' });
    if (ind.status === 'tasso_non_disponibile') return Object.assign(out, { titolo: 'TASSO NON DISPONIBILE', sotto: 'controlla il decennale' });
    if (d.fv == null || !(close > 0)) return out;

    const fcfNorm = ind.fcf_norm, ke = ind.ke, cassa = ind.cassa_az || 0, gHist = ind.g_hist;
    const pOp = close - cassa;
    const gImpl = fcfNorm > 0 && ke != null && pOp > 0 ? (ke * pOp - fcfNorm) / (pOp + fcfNorm) : null;
    out.gImpl = gImpl;
    const hasBand = d.fv_low != null && d.fv_high != null && d.fv_high > d.fv_low;
    const sogliaSu = d.fv_high != null ? d.fv_high : d.fv;
    const roicOk = ind.roic_m != null && ke != null && ind.roic_m > ke;
    const declino = gHist != null && gHist < 0;
    const det = [`crescita scontata ${pct(gImpl)} | storica ${pct(gHist)}`];
    const detRoic = `ROIC ${pct(ind.roic_m)} vs Ke ${pct(ke)}`;

    if (hasBand && close < d.fv_low * (1 - P.MOS)) {
      Object.assign(out, declino
        ? { key: 'molto_sotto_declino', titolo: 'MOLTO SOTTOVALUTATA, MA IN DECLINO', sotto: "sotto anche l'anno peggiore a crescita zero", colore: '#827717' }
        : { key: 'molto_sotto', titolo: 'MOLTO SOTTOVALUTATA', sotto: "sotto anche l'anno peggiore a crescita zero", colore: '#1b5e20' });
    } else if (close <= sogliaSu) {
      Object.assign(out, declino
        ? { key: 'equa_declino', titolo: "EQUA PER UN'AZIENDA IN DECLINO", sotto: 'prezzata come se non crescesse più', colore: '#827717' }
        : { key: 'sotto', titolo: 'SOTTOVALUTATA', sotto: 'prezzata come se non crescesse più', colore: '#43a047' });
    } else if (d.fv_mkt == null || close <= d.fv_mkt) {
      Object.assign(out, { key: 'equita', titolo: 'ZONA DI EQUITÀ', sotto: "sconta meno crescita dell'azienda media", colore: '#546e7a' });
    } else if (gHist == null) {
      Object.assign(out, { key: 'sopra_nd', titolo: 'SOPRA IL FAIR VALUE DI MERCATO', sotto: 'crescita storica n.d.: non valutabile', colore: '#9e9e9e' });
    } else if (gImpl > gHist + P.TOLL_G) {
      Object.assign(out, { key: 'sopra', titolo: 'SOPRAVVALUTATA', sotto: 'chiede una crescita mai realizzata', colore: '#d32f2f' });
      det.push(detRoic);
    } else if (roicOk) {
      Object.assign(out, { key: 'premio_sostenuto', titolo: 'PREMIO SOSTENUTO', sotto: 'crescita già realizzata e ROIC > Ke', colore: '#f9a825' });
      det.push(detRoic);
    } else {
      Object.assign(out, { key: 'premio_dubbio', titolo: 'PREMIO DUBBIO', sotto: 'crescita realizzata ma ROIC ≤ Ke', colore: '#ef6c00' });
      det.push(detRoic);
    }
    if (declino && out.key === 'equita') det.push('in calo: rischio value trap');   // come avv_decl nel Pine
    if (gHist != null && ke != null && gHist >= ke && ['sopra', 'premio_sostenuto', 'premio_dubbio'].includes(out.key)) det.push('crescita storica ≥ Ke: confronto poco affidabile');
    out.dettagli = det.concat(ind.avvisi || []);
    return out;
  }

  // Categoria semplice per screener e filtri
  const categoria = key => ['molto_sotto', 'sotto', 'molto_sotto_declino', 'equa_declino'].includes(key) ? 'sotto'
    : ['sopra', 'premio_dubbio'].includes(key) ? 'sopra'
    : ['equita', 'premio_sostenuto', 'sopra_nd'].includes(key) ? 'equa' : 'na';

  const api = { P, compute, verdict, categoria, annualHistory, betaFrom, monthFirstCloses, cpiAt, isoWeek };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FVEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
