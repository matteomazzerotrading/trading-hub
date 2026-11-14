/*
 * fv_engine.js — formula dell'indicatore Pine Script "FAIR VALUE (dati realizzati)"
 * di matteomazzero2002, con le impostazioni usate sul suo grafico (layout "FV+TBO"):
 * mediana dei margini, inflazione realizzata (CPI), margine di sicurezza 10%, beta manuale 0,95.
 * Replica il comportamento sul grafico SETTIMANALE (10 anni di bilanci, campioni mensili
 * presi dalle barre settimanali), come suggerito nel Pine stesso.
 *
 * Usato in due posti, con lo stesso codice:
 *   • scripts/compute_fv.mjs (GitHub Actions) → calcola i fair value e li scrive in data.json
 *   • index.html (sito)                       → calcola il verdetto con il prezzo live
 *
 * Differenze note rispetto all'indicatore sul grafico TradingView:
 *   • ROIC medio: TradingView espone solo l'ultimo anno → si usa quello.
 *   • Azioni degli anni con EPS < 0,05: si usano le azioni attuali (il Pine usa quelle dell'anno).
 *   • Ultimo bilancio: conta dalla data di pubblicazione (se non nota, chiusura + 45 giorni); i precedenti dalla chiusura.
 *   • Oscillatore z-score: non calcolato.
 */
(function (root) {
  'use strict';

  // ── Input dell'indicatore (default del Pine Script) ──────────────────────────
  const P = {
    ERP: 0.0423,          // premio per il rischio implicito (Damodaran) — aggiornalo quando cambia
    SPREAD_MIN: 0.035,    // rendimento reale minimo richiesto (Ke − inflazione attesa)
    ANNI: 10,             // anni fiscali massimi
    PREMIO_PCT: 0.03,     // premio/sconto qualità
    INFL_FIX: 0.025,      // inflazione fissa se nessun dato
    BETA_SETT: 260,       // settimane per il beta
    BETA_MAN: 0.95,       // beta se non calcolabile
    MESI_YLD: 120,        // mesi per il FCF yield storico
    NORM_MED: true,       // mediana dei margini invece della media
    INFL_SRC: 'realizzata', // 'realizzata' (CPI del periodo) oppure 'breakeven'
    MOS: 0.10,            // margine di sicurezza sotto la banda
    TOLL_G: 0.01,         // tolleranza crescita implicita vs storica
    CONV_MIN: 0.7,        // conversione FCF/utile minima
    LEV_MAX: 4.0,         // debito netto massimo (anni di FCF)
    LAG_FY_DAYS: 45,      // giorni tra chiusura esercizio e pubblicazione
    // ── Opzioni del modello (i valori qui sono quelli in uso; compute() accetta sostituzioni) ──
    MARG: 'mediana',      // 'mediana' = margine tipico dei 10 anni; 'prudente' = il più basso tra quello e la media degli ultimi 3
    BANDA: 'minmax',      // 'minmax' = anno peggiore/migliore; 'quartili' = 25° e 75° percentile dei margini
    PI_ATTESA: 0.02,      // inflazione attesa per la capitalizzazione (obiettivo della banca centrale); null = inflazione realizzata
    CASSA: 'netta',       // 'netta' = cassa meno debito, solo se positiva; 'lorda' = tutta la cassa
    H: 0,                 // anni di crescita in esaurimento per il fair value centrale (modello H); 0 = non calcolato
    G_CAP: 0.04,          // tetto alla crescita reale usata nel fair value centrale
    ROIC_GATE: true,      // crescita riconosciuta solo se ROIC > Ke
    BETA_MIN: null        // beta minimo dopo la correzione di Blume (null = nessuno)
  };
  const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };

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

  // CPI come lo vede request.economic: l'ultimo valore già pubblicato alla data s.
  // Il CPI di un mese esce verso metà del mese successivo (qui: il 15).
  // cpi = [['YYYY-MM-01', valore], ...] in ordine crescente
  const cpiRelease = m => { const d = new Date(m + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(15); return iso(d); };
  const _relCache = new WeakMap();                 // date di pubblicazione già calcolate, per serie
  function cpiAt(cpi, s) {
    if (!cpi || !cpi.length) return null;
    let rel = _relCache.get(cpi);
    if (!rel || rel.length !== cpi.length) { rel = cpi.map(r => cpiRelease(r[0])); _relCache.set(cpi, rel); }
    let lo = 0, hi = rel.length - 1, best = -1;      // ultimo valore con pubblicazione <= s
    while (lo <= hi) { const m = (lo + hi) >> 1; if (rel[m] <= s) { best = m; lo = m + 1; } else hi = m - 1; }
    return best >= 0 ? cpi[best][1] : cpi[0][1];
  }

  // Anni fiscali validi, più recente per primo (come 'nuovoFY' nel Pine).
  // f = riga dello screener TradingView (valori già nella valuta del titolo)
  // Come su TradingView: i bilanci passati contano dalla chiusura dell'esercizio, l'ultimo
  // dalla data di pubblicazione (se non nota: chiusura + 45 giorni, mai oltre oggi).
  function annualHistory(f, today) {
    const years = f.fiscal_period_fy_h || [];
    const fcf = f.free_cash_flow_fy_h || [], rev = f.total_revenue_fy_h || [];
    const ni = f.net_income_fy_h || [], eps = f.earnings_per_share_diluted_fy_h || [];
    const tso = f.total_shares_outstanding;
    if (!years.length || !f.fiscal_period_end_fy) return [];
    const lastEnd = iso(new Date(f.fiscal_period_end_fy * 1000));
    let lastAvail = addDays(lastEnd, P.LAG_FY_DAYS);
    if (f.earnings_release_date && f.fiscal_period_end_fq === f.fiscal_period_end_fy) {
      const rel = iso(new Date(f.earnings_release_date * 1000));
      if (rel >= lastEnd) lastAvail = rel;
    }
    // Bilancio appena chiuso e non ancora pubblicato: conta da oggi. Non vale per date precedenti alla chiusura
    // (calcoli a una data passata): in quel caso l'ultimo bilancio resta fuori dalla finestra.
    if (today && lastAvail > today && today >= lastEnd) lastAvail = today;
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
      out.push({ year: y, avail: k === 0 ? lastAvail : end, fcf: F * fact, rev: R * fact, earn: E, az });
    });
    return out;
  }

  const windowAt = (hist, s) => hist.filter(h => h.avail <= s).slice(0, P.ANNI);

  // FCF normalizzato (metodo margine × ricavi per azione attuali rivalutati al CPI)
  function fcfNormAt(win, cpi, s, O) {
    O = O || P;
    const marg = win.map(h => h.fcf / h.rev);
    const c0 = cpiAt(cpi, win[0].avail), cn = cpiAt(cpi, s);
    const fatt0 = c0 && cn && c0 > 0 ? cn / c0 : 1;
    const revNow = win[0].rev / win[0].az * fatt0;
    let margN = O.NORM_MED ? median(marg) : avg(marg);
    if (O.MARG === 'prudente' && marg.length >= 3) margN = Math.min(margN, avg(marg.slice(0, 3)));
    let lo = Math.min(...marg), hi = Math.max(...marg);
    if (O.BANDA === 'quartili') { lo = Math.min(quantile(marg, 0.25), margN); hi = Math.max(quantile(marg, 0.75), margN); }
    return { fcfNorm: margN * revNow, fcfMin: lo * revNow, fcfMax: hi * revNow, margN, margNow: marg[0] };
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

  // Chiusura della prima barra di ogni mese (timeframe.change("M")): sul settimanale è la
  // prima settimana che inizia nel nuovo mese, con la sua chiusura di fine settimana
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
   *   bars     [['YYYY-MM-DD', close], ...] barre settimanali di almeno 11 anni (data = inizio settimana)
   *   today    'YYYY-MM-DD'
   */
  function compute(f, cpi, rf, be, weeklyS, weeklyB, bars, today, opts) {
    const O = Object.assign({}, P, opts || {});
    const res = { status: 'ok', avvisi: [] };
    let hist = annualHistory(f, today);
    // Titoli quotati da meno di 10 anni: sul grafico la storia parte dalla quotazione, quindi il Pine
    // registra solo il bilancio in vigore in quel momento (con il CPI di allora) e non quelli precedenti.
    if (bars && bars.length) {
      const start = bars[0][0], limite = addDays(today, -Math.round(365.25 * 10.5));
      if (start > limite) {
        const prima = hist.filter(h => h.avail < start), dopo = hist.filter(h => h.avail >= start);
        hist = prima.length ? dopo.concat([Object.assign({}, prima[0], { avail: start })]) : dopo;
      }
    }
    const win = windowAt(hist, today);
    const n = win.length;
    res.anni = n;
    if (n < 4) { res.status = 'dati_insufficienti'; return res; }

    const { beta: bCalc, raw: betaRaw } = betaFrom(weeklyS, weeklyB);
    const betaSospetto = betaRaw != null && (betaRaw < 0.3 || betaRaw > 3);
    let beta = bCalc != null ? bCalc : O.BETA_MAN;
    if (O.BETA_MIN != null && beta < O.BETA_MIN) beta = O.BETA_MIN;
    const ke = rf != null ? rf + beta * O.ERP : null;

    const { fcfNorm, fcfMin, fcfMax, margN, margNow } = fcfNormAt(win, cpi, today, O);

    const fcfps = win.map(h => h.fcf / h.az), revps = win.map(h => h.rev / h.az);
    const anniNeg = fcfps.filter(x => x < 0).length;
    let gFcf = null, gRev = null;
    const rec = (fcfps[0] + fcfps[1]) / 2, vec = (fcfps[n - 1] + fcfps[n - 2]) / 2;
    if (rec > 0 && vec > 0) gFcf = Math.pow(rec / vec, 1 / (n - 2)) - 1;
    if (revps[0] > 0 && revps[n - 1] > 0) gRev = Math.pow(revps[0] / revps[n - 1], 1 / (n - 1)) - 1;
    const gHist = gRev;

    const c0 = cpiAt(cpi, win[0].avail), cN = cpiAt(cpi, win[n - 1].avail);
    const inflAnn = c0 && cN && cN > 0 ? Math.pow(c0 / cN, 1 / (n - 1)) - 1 : O.INFL_FIX;
    const useBe = O.INFL_SRC === 'breakeven' && be != null;
    const pi = O.PI_ATTESA != null ? O.PI_ATTESA : useBe ? be : inflAnn;
    const piSrc = O.PI_ATTESA != null ? 'attesa' : useBe ? 'breakeven' : 'CPI realizzata';
    const spread = ke != null ? Math.max(ke - pi, O.SPREAD_MIN) : null;

    const earn = win.map(h => h.earn);
    const sumNI = earn.reduce((a, e) => a + (e != null ? e : 0), 0);
    const conv = sumNI > 0 ? win.reduce((a, h) => a + h.fcf, 0) / sumNI : null;
    const roicM = f.return_on_invested_capital_fy != null ? f.return_on_invested_capital_fy / 100 : null;

    const cash = f.cash_n_short_term_invest_fq != null ? f.cash_n_short_term_invest_fq : f.cash_n_short_term_invest_fy;
    const debt = f.total_debt_fq != null ? f.total_debt_fq : f.total_debt_fy;
    const az0 = win[0].az;
    const cassaUtile = O.CASSA === 'netta' ? Math.max((cash || 0) - (debt || 0), 0) : cash;
    const cassaAz = cassaUtile != null && az0 > 0 ? cassaUtile / az0 : 0;
    const debnet = (debt || 0) - (cash || 0);
    const levAnni = fcfNorm > 0 ? (debnet / az0) / fcfNorm : null;

    let qual;
    const avgRev = avg(win.slice(1).map(h => h.rev));
    if (earn.some(e => e == null)) qual = -O.PREMIO_PCT;
    else qual = win[0].rev > avgRev && earn[0] > avg(earn.slice(1)) ? O.PREMIO_PCT : -O.PREMIO_PCT;

    const capitalizza = x => x > 0 && spread ? x * (1 + pi) / spread : null;
    const valore = x => { const c = capitalizza(x); return c != null ? c * (1 + qual) + cassaAz : null; };
    const fv = valore(fcfNorm), fvLow = valore(fcfMin), fvHigh = valore(fcfMax);
    // Fair value centrale (modello H): la crescita reale storica dei ricavi per azione, entro un tetto e solo se
    // il ROIC supera il Ke, si esaurisce in modo lineare in 2·H anni. Con crescita zero coincide con il pavimento.
    const gReale = gHist != null ? (1 + gHist) / (1 + inflAnn) - 1 : null;
    let gStar = gReale != null ? Math.min(Math.max(gReale, 0), O.G_CAP) : 0;
    if (O.ROIC_GATE && roicM != null && ke != null && roicM <= ke) gStar = 0;
    const fvC = O.H > 0 ? valore(fcfNorm * (1 + O.H * gStar)) : null;
    const spreadMkt = rf != null ? Math.max(beta * O.ERP, O.SPREAD_MIN) : null;
    const fvMkt = fcfNorm > 0 && spreadMkt ? fcfNorm * (1 + rf) / spreadMkt * (1 + qual) + cassaAz : null;

    // Fair value storico: mediana del FCF yield mensile (FCF normalizzato di allora / prezzo di allora)
    let ylds = [];
    for (const [d, c] of monthFirstCloses(bars)) {
      const w = windowAt(hist, d);
      if (w.length < 4 || !(c > 0)) continue;
      const fn = fcfNormAt(w, cpi, d, O).fcfNorm;
      if (fn > 0) ylds.push(fn / c);
    }
    ylds = ylds.slice(-O.MESI_YLD);
    const yldMed = ylds.length >= 36 ? median(ylds) : null;
    const fvSto = yldMed && yldMed > 0 ? fcfNorm / yldMed : null;

    if (fcfNorm <= 0) res.status = 'fcf_negativo';
    else if (ke == null) res.status = 'tasso_non_disponibile';

    const pct = x => (x * 100).toFixed(1).replace('.', ',') + '%';
    if (betaSospetto) res.avvisi.push(`beta calcolato ${betaRaw.toFixed(2).replace('.', ',')}: verifica l'indice`);
    if (margNow < margN * 0.75) res.avvisi.push(`margine attuale ${pct(margNow)} molto sotto la media ${pct(margN)}`);
    if (conv != null && conv < O.CONV_MIN) res.avvisi.push(`FCF solo ${Math.round(conv * 100)}% dell'utile`);
    if (anniNeg > 0) res.avvisi.push(`${anniNeg} ${anniNeg === 1 ? 'anno' : 'anni'} con FCF negativo`);
    if (levAnni != null && levAnni > O.LEV_MAX) res.avvisi.push(`debito netto = ${levAnni.toFixed(1).replace('.', ',')} anni di FCF`);

    const r = (x, k = 4) => x == null || !isFinite(x) ? null : Number(x.toFixed(k));
    Object.assign(res, {
      fv: r(fv, 2), fv_low: r(fvLow, 2), fv_high: r(fvHigh, 2), fv_mkt: r(fvMkt, 2), fv_sto: r(fvSto, 2), fv_c: r(fvC, 2), g_star: r(gStar),
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
   *   | 'molto_sotto_declino' | 'banda' | 'equita' | 'sopra' | 'premio_sostenuto' | 'premio_dubbio' | 'sopra_nd' | 'na'
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
    // "Sottovalutata" solo se il prezzo è sotto la stima prudente: il più basso tra pavimento e fair value storico,
    // lo stesso riferimento del potenziale. Così esito e potenziale non possono più contraddirsi.
    const sogliaSotto = d.fv_sto > 0 ? Math.min(d.fv, d.fv_sto) : d.fv;
    const hasBand = d.fv_low != null && d.fv_high != null && d.fv_high > d.fv_low;
    // Soglia alta della zona "sottovalutata": lo scenario migliore della banda, ma mai oltre il fair value di mercato
    // (se il FV di mercato è sotto il pavimento, cosa possibile con tassi reali negativi, vale il pavimento)
    const hiBanda = d.fv_high != null ? d.fv_high : d.fv;
    const sogliaSu = d.fv_mkt != null ? Math.min(hiBanda, Math.max(d.fv_mkt, d.fv)) : hiBanda;
    const roicOk = ind.roic_m != null && ke != null && ind.roic_m > ke;
    const declino = gHist != null && gHist < 0;
    const det = [`crescita scontata ${pct(gImpl)} | storica ${pct(gHist)}`];
    const detRoic = `ROIC ${pct(ind.roic_m)} vs Ke ${pct(ke)}`;

    if (hasBand && close < d.fv_low * (1 - P.MOS) && close <= sogliaSotto) {
      Object.assign(out, declino
        ? { key: 'molto_sotto_declino', titolo: 'MOLTO SOTTOVALUTATA, MA IN DECLINO', sotto: "sotto anche l'anno peggiore a crescita zero", colore: '#ffeb3b' }
        : { key: 'molto_sotto', titolo: 'MOLTO SOTTOVALUTATA', sotto: "sotto anche l'anno peggiore a crescita zero", colore: '#1b5e20' });
    } else if (close > sogliaSotto && close <= sogliaSu) {
      // Dentro la banda ma sopra la stima prudente: non è "sottovalutata" (il potenziale sarebbe negativo)
      Object.assign(out, { key: 'banda', titolo: 'NELLA BANDA DEL FAIR VALUE', sotto: 'sopra la stima prudente, entro lo scenario migliore', colore: '#00897b' });
      if (declino) det.push('in calo: rischio value trap');
    } else if (close <= sogliaSu) {
      Object.assign(out, declino
        ? { key: 'equa_declino', titolo: "EQUA PER UN'AZIENDA IN DECLINO", sotto: 'prezzata come se non crescesse più', colore: '#ffeb3b' }
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
    : ['banda', 'equita', 'premio_sostenuto', 'sopra_nd'].includes(key) ? 'equa' : 'na';

  // Banche e assicurazioni: un fair value sul free cash flow è poco significativo
  const FINANZIARI = ['JPM', 'BAC', 'C', 'GS', 'ISP', 'G', 'CB', 'L', 'AXP'];
  const AVVISO_FIN = 'modello poco affidabile per banche e assicurazioni';

  /*
   * Potenziale = FV / prezzo − 1, in %. Per prudenza il fair value di riferimento è il più basso
   * tra pavimento e storico; potMkt è lo stesso calcolo sul fair value di mercato.
   */
  function potenziale(d, close) {
    const out = { pot: null, potMkt: null, rif: null, fvRif: null };
    const ok = d && (d.ind ? d.ind.status === 'ok' : d.fv != null);
    if (!ok || !(close > 0)) return out;
    const usaSto = d.fv_sto > 0 && d.fv_sto < d.fv;
    out.fvRif = usaSto ? d.fv_sto : d.fv;
    out.rif = usaSto ? 'storico' : 'pavimento';
    if (out.fvRif > 0) out.pot = (out.fvRif / close - 1) * 100;
    if (d.fv_mkt > 0) out.potMkt = (d.fv_mkt / close - 1) * 100;
    return out;
  }

  // Posizione del prezzo rispetto alle soglie dell'indicatore (stesse zone del verdetto)
  function posizione(d, close) {
    const p = Number(close), n = x => x != null ? x.toFixed(2).replace('.', ',') + (d && d.curr ? ' ' + d.curr : '') : '';
    const out = { zona: 9, ord: 9, testo: '—', sotto: '' };
    if (!d || d.fv == null || !(p > 0) || (d.ind && d.ind.status !== 'ok')) return out;
    const lo = d.fv_low, hi = d.fv_high != null ? d.fv_high : d.fv, mkt = d.fv_mkt;
    if (lo != null && hi > lo && p < lo) {
      return { zona: 1, ord: 1 + p / lo, testo: 'Sotto la banda', sotto: `${((1 - p / lo) * 100).toFixed(0)}% sotto lo scenario peggiore` };
    }
    const soglia = mkt != null ? Math.min(hi, Math.max(mkt, d.fv)) : hi;      // come nel verdetto
    if (p <= soglia) {
      const pct = lo != null && hi > lo ? Math.max(0, (p - lo) / (hi - lo)) : null;
      return { zona: 2, ord: 2 + (pct != null ? pct : p / hi), testo: 'Nella banda', sotto: pct != null ? `al ${Math.round(pct * 100)}% della banda` : `sotto lo scenario migliore (${n(hi)})` };
    }
    if (mkt == null || p <= mkt) {
      return { zona: 3, ord: 3 + (mkt && mkt > hi ? (p - hi) / (mkt - hi) : 0), testo: 'Tra banda e FV mercato', sotto: mkt ? `${((mkt / p - 1) * 100).toFixed(0)}% sotto il FV di mercato` : '' };
    }
    return { zona: 4, ord: 4 + (p / mkt - 1), testo: 'Sopra FV mercato', sotto: `+${((p / mkt - 1) * 100).toFixed(0)}% sopra il FV di mercato` };
  }

  /*
   * Affidabilità della stima: quanto ci si può fidare del fair value di questo titolo.
   * Ogni condizione che rende il modello meno adatto aggiunge punti; 0-1 = alta, 2-3 = media, 4 o più = bassa.
   */
  function affidabilita(ticker, d) {
    const ind = d && d.ind;
    if (!d || d.fv == null || !ind || ind.status !== 'ok') return { livello: null, punti: null, motivi: [] };
    const avv = ind.avvisi || [], motivi = [];
    let punti = 0;
    const add = (n, testo) => { punti += n; motivi.push(testo); };
    if (FINANZIARI.includes(ticker)) add(3, 'banca o assicurazione: il free cash flow è poco significativo');
    if (avv.some(a => a.startsWith('margine attuale'))) add(2, 'margine attuale molto sotto la media storica');
    const neg = avv.map(a => a.match(/^(\d+) ann[oi] con FCF negativo/)).find(Boolean);
    if (neg) add(Number(neg[1]) >= 3 ? 2 : 1, neg[1] + (neg[1] === '1' ? ' anno' : ' anni') + ' su 10 con free cash flow negativo');
    const deb = avv.map(a => a.match(/^debito netto = ([\d,]+) anni di FCF/)).find(Boolean);
    if (deb) {
      const anni = parseFloat(deb[1].replace(',', '.'));
      add(anni >= 15 ? 4 : anni >= 8 ? 2 : 1, 'debito netto elevato (' + deb[1] + ' anni di free cash flow), non sottratto dal fair value');
    }
    if (avv.some(a => a.startsWith('FCF solo'))) add(1, "free cash flow molto inferiore all'utile");
    if (avv.some(a => a.startsWith('beta calcolato'))) add(1, 'beta molto basso: il rendimento richiesto potrebbe essere sottostimato');
    if (ind.anni != null && ind.anni < 8) add(1, 'meno di 8 anni di bilanci disponibili');
    if (d.fv_sto > 0 && d.fv > 0 && Math.max(d.fv, d.fv_sto) / Math.min(d.fv, d.fv_sto) > 2) add(1, 'fair value pavimento e storico molto distanti tra loro');
    if (d.fv_high > 0 && d.fv_mkt > 0 && d.fv_high > 1.5 * d.fv_mkt) add(2, 'banda molto larga: lo scenario migliore supera di molto il fair value di mercato (margini molto variabili)');
    return { livello: punti <= 1 ? 'alta' : punti <= 3 ? 'media' : 'bassa', punti, motivi };
  }

  // ── Tassi e inflazione del paese di quotazione ───────────────────────────────
  // Decennale privo di rischio della VALUTA (per l'area euro il Bund) e inflazione attesa = obiettivo della banca centrale.
  // L'indice dei prezzi del paese (yoy) serve solo a rivalutare i ricavi e a misurare la crescita reale passata.
  const PAESI = {
    US: { nome: 'Stati Uniti', rf: 'TVC:US10Y', rfNome: 'Treasury USA', piAttesa: 0.02 },
    IT: { nome: 'Italia', rf: 'TVC:DE10Y', rfNome: 'Bund (area euro)', piAttesa: 0.02, yoy: 'ECONOMICS:ITIRYY' },
    DE: { nome: 'Germania', rf: 'TVC:DE10Y', rfNome: 'Bund (area euro)', piAttesa: 0.02, yoy: 'ECONOMICS:DEIRYY' },
    FR: { nome: 'Francia', rf: 'TVC:DE10Y', rfNome: 'Bund (area euro)', piAttesa: 0.02, yoy: 'ECONOMICS:FRIRYY' },
    ES: { nome: 'Spagna', rf: 'TVC:DE10Y', rfNome: 'Bund (area euro)', piAttesa: 0.02, yoy: 'ECONOMICS:ESIRYY' },
    NL: { nome: 'Paesi Bassi', rf: 'TVC:DE10Y', rfNome: 'Bund (area euro)', piAttesa: 0.02, yoy: 'ECONOMICS:NLIRYY' },
    GB: { nome: 'Regno Unito', rf: 'TVC:GB10Y', rfNome: 'Gilt britannico', piAttesa: 0.02, yoy: 'ECONOMICS:GBIRYY' },
    CH: { nome: 'Svizzera', rf: 'TVC:CH10Y', rfNome: 'Confederazione svizzera', piAttesa: 0.01, yoy: 'ECONOMICS:CHIRYY' }
  };
  // Paese in cui il titolo è quotato (come syminfo.country nel Pine)
  function paese(d) {
    const ex = d && d.ex, yf = (d && d.yf) || '';
    if (ex === 'MIL') return 'IT';
    if (ex === 'XETR') return 'DE';
    if (ex === 'BME') return 'ES';
    if (ex === 'SIX') return 'CH';
    if (ex === 'LSE') return 'GB';
    if (ex === 'EURONEXT' || ex === 'EPA') return yf.endsWith('.AS') ? 'NL' : 'FR';
    return 'US';
  }
  /*
   * Indice dei prezzi ricostruito dall'inflazione annua (YoY): indice[m] = indice[m − 12] × (1 + YoY[m]).
   * Si usa per i paesi diversi dagli USA perché le serie CPI nazionali cambiano base (es. Italia a gennaio 2026)
   * e il salto falserebbe i rapporti; l'inflazione annua non ne risente. I 12 mesi iniziali partono da 100;
   * un mese mancante riusa l'ultimo YoY noto. Stessa costruzione nel Pine.
   * yoy = [['YYYY-MM-01', percento], ...] in ordine crescente → [['YYYY-MM-01', indice], ...]
   */
  function indiceDaYoy(yoy) {
    if (!yoy || !yoy.length) return [];
    const mesi = s => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
    const iso = m => String(Math.floor(m / 12)).padStart(4, '0') + '-' + String(m % 12 + 1).padStart(2, '0') + '-01';
    const coda = new Array(12).fill(100), out = [];
    let prec = mesi(yoy[0][0]) - 1;
    for (const [d, v] of yoy) {
      const m = mesi(d);
      for (let k = prec + 1; k <= m; k++) {            // i mesi saltati riusano lo stesso YoY
        const val = coda.shift() * (1 + v / 100);
        coda.push(val); out.push([iso(k), val]);
      }
      prec = m;
    }
    return out;
  }

  // Settori di TradingView in italiano
  const SETTORI = {
    'Health Technology': 'Farmaci e dispositivi medici', 'Health Services': 'Servizi sanitari', 'Utilities': 'Utility',
    'Consumer Durables': 'Beni durevoli e auto', 'Consumer Non-Durables': 'Beni di consumo', 'Technology Services': 'Software e servizi IT',
    'Electronic Technology': 'Tecnologia e semiconduttori', 'Retail Trade': 'Commercio al dettaglio', 'Process Industries': 'Chimica e materiali',
    'Producer Manufacturing': 'Industria', 'Finance': 'Finanza', 'Energy Minerals': 'Energia', 'Consumer Services': 'Servizi ai consumatori',
    'Transportation': 'Trasporti', 'Industrial Services': 'Servizi industriali', 'Commercial Services': 'Servizi alle imprese',
    'Communications': 'Telecomunicazioni', 'Non-Energy Minerals': 'Materie prime', 'Distribution Services': 'Distribuzione', 'Miscellaneous': 'Altro'
  };
  const mercato = d => d.ex === 'MIL' ? 'it' : (d.ex === 'NYSE' || d.ex === 'NASDAQ') ? 'us' : 'eu';

  const api = { P, compute, verdict, categoria, potenziale, posizione, affidabilita, PAESI, paese, indiceDaYoy, SETTORI, mercato, FINANZIARI, AVVISO_FIN, annualHistory, betaFrom, monthFirstCloses, cpiAt, isoWeek };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FVEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
