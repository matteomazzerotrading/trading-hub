// compute_fv.mjs — calcola i fair value di tutti i titoli di data.json con la formula
// dell'indicatore "FAIR VALUE (dati realizzati)" (scripts/fv_engine.js) e li salva in data.json.
// Eseguito da GitHub Actions (.github/workflows/compute-fv.yml). Node 20+, nessuna dipendenza.
//
// Fonti: bilanci, cassa, debito, ROIC e decennale → screener pubblico TradingView;
//        CPI USA (CPIAUCNS, la stessa serie di ECONOMICS:USCPI) → FRED;
//        prezzi settimanali (beta e fair value storico) → Yahoo Finance.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('./fv_engine.js');
import { storicoFv, fineTrimestri, valAt } from './fv_history.mjs';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data.json');
const REPORT = path.join(ROOT, 'fv_report.json');
const CHANGES = path.join(ROOT, 'fv_changes.json');
const CPI_PAESI = path.join(ROOT, 'cpi_paesi.json');
const HISTORY = path.join(ROOT, 'fv_history.json');
const MACRO = path.join(ROOT, 'macro.json');
const EXT = path.join(ROOT, 'fv_ext.json'), HISTORY_EXT = path.join(ROOT, 'fv_history_ext.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const COLS = ['close', 'currency', 'fiscal_period_fy_h', 'fiscal_period_end_fy', 'free_cash_flow_fy_h',
  'total_revenue_fy_h', 'net_income_fy_h', 'earnings_per_share_diluted_fy_h', 'total_revenue_fy',
  'cash_n_short_term_invest_fq', 'cash_n_short_term_invest_fy', 'total_debt_fq', 'total_debt_fy',
  'return_on_invested_capital_fy', 'total_shares_outstanding', 'earnings_release_date', 'fiscal_period_end_fq',
  'price_earnings_ttm', 'earnings_per_share_diluted_ttm', 'market_cap_basic', 'dividends_yield_current',
  'total_revenue_yoy_growth_ttm', 'sector', 'earnings_release_next_date'];

// Dati per i riquadri della scheda (P/E, EPS, capitalizzazione, crescita ricavi, dividendo)
function fundamentals(f) {
  const capDiv = f.currency === 'GBX' ? 100 : 1;          // capitalizzazione in pence → sterline
  const big = x => x == null ? 'N/D' : x >= 1e12 ? (x / 1e12).toFixed(2) + 'T' : x >= 1e9 ? (x / 1e9).toFixed(1) + 'B' : (x / 1e6).toFixed(0) + 'M';
  return {
    pe: f.price_earnings_ttm != null && f.price_earnings_ttm > 0 ? f.price_earnings_ttm.toFixed(1) : 'N/D',
    eps: f.earnings_per_share_diluted_ttm != null ? f.earnings_per_share_diluted_ttm.toFixed(2) : 'N/D',
    mcap: f.market_cap_basic != null ? big(f.market_cap_basic / capDiv) : 'N/D',
    rev: f.total_revenue_yoy_growth_ttm != null ? (f.total_revenue_yoy_growth_ttm > 0 ? '+' : '') + f.total_revenue_yoy_growth_ttm.toFixed(1) + '%' : 'N/D'
  };
}

async function get(url, opts = {}, tries = 3, timeoutMs = 30000) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return r;
      last = new Error(`HTTP ${r.status}`);
    } catch (e) { last = e; }
    if (i < tries - 1) await sleep(2000 * (i + 1));
  }
  throw new Error(`${url.slice(0, 90)}: ${last && last.message}`);
}

async function tvScan(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 50) {
    const body = JSON.stringify({ symbols: { tickers: symbols.slice(i, i + 50) }, columns: COLS, price_conversion: { to_symbol: true } });
    const j = await (await get('https://scanner.tradingview.com/global/scan', { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } })).json();
    for (const row of j.data || []) out[row.s] = Object.fromEntries(COLS.map((c, k) => [c, row.d[k]]));
  }
  return out;
}

// Ultimo valore e mese di riferimento di una serie economica (es. ECONOMICS:ITIRYY)
async function tvUltimo(symbol) {
  const j = await (await get('https://scanner.tradingview.com/symbol?symbol=' + encodeURIComponent(symbol) + '&fields=close,time&no_404=true')).json();
  if (!j || j.close == null || !j.time) return null;
  return { mese: new Date(j.time * 1000).toISOString().slice(0, 7) + '-01', valore: j.close };
}

async function tvClose(symbol) {
  const j = await (await get('https://scanner.tradingview.com/symbol?symbol=' + encodeURIComponent(symbol) + '&fields=close&no_404=true')).json();
  return j && j.close != null ? j.close : null;
}

async function fredCpi() {
  const txt = await (await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS')).text();
  return txt.split('\n').map(l => l.trim().split(',')).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && r[1] && r[1] !== '.')
    .map(r => [r[0].slice(0, 7) + '-01', Number(r[1])]);
}

// Yahoo: un tentativo per host (query1, poi query2); dopo 5 errori di fila non lo si chiama più
let yahooErrors = 0, yahooOff = false;
async function yahooWeekly(sym) {
  if (yahooOff) throw new Error('Yahoo disattivato dopo troppi errori');
  let j = null, lastErr;
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1wk&range=11y`;
      j = await (await get(url, {}, 1, 15000)).json();
      break;
    } catch (e) { lastErr = e; }
  }
  if (!j) {
    if (++yahooErrors >= 5) { yahooOff = true; console.log('Yahoo non risponde: da qui beta manuale e niente FV storico'); }
    throw lastErr;
  }
  yahooErrors = 0;
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp) return [];
  const off = (res.meta && res.meta.gmtoffset) || 0, c = res.indicators.quote[0].close;
  const out = [];
  res.timestamp.forEach((t, i) => { if (c[i] != null) out.push([new Date((t + off) * 1000).toISOString().slice(0, 10), c[i]]); });
  return out;
}

const r2 = (x, k = 2) => x == null || !isFinite(x) ? null : Number(x.toFixed(k));

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const db = data.db;
  const today = new Date().toISOString().slice(0, 10);
  const tickers = Object.entries(db).filter(([, e]) => e.tv);
  console.log(`Titoli: ${tickers.length}`);

  const fund = await tvScan(tickers.map(([, e]) => e.tv));
  let rf = await tvClose('TVC:US10Y'); rf = rf != null ? rf / 100 : null;

  // Dati di mercato scaricati prima da scripts/fetch_market_data.py (yfinance + FRED/BLS)
  const MD = path.join(ROOT, 'market_data.json');
  const md = fs.existsSync(MD) ? JSON.parse(fs.readFileSync(MD, 'utf8')) : { weekly: {}, cpi: [], fonti: {} };
  const weeklyOf = async sym => {
    if (md.weekly && md.weekly[sym] && md.weekly[sym].length) return md.weekly[sym];
    return yahooWeekly(sym);                       // ripiego: richiesta diretta (spesso rifiutata da Yahoo)
  };
  let cpi = md.cpi || [];
  if (!cpi.length) { try { cpi = await fredCpi(); } catch (e) { console.log('CPI non disponibile:', e.message); } }
  let bench = [];
  try { bench = await weeklyOf('^GSPC'); } catch (e) { console.log('S&P 500 non disponibile:', e.message); }
  // Decennale e inflazione del paese di quotazione: tasso da TradingView, indice dei prezzi ricostruito dall'inflazione annua
  let paesi = { yoy: {} };
  try { paesi = JSON.parse(fs.readFileSync(CPI_PAESI, 'utf8')); } catch (e) { console.log('cpi_paesi.json non leggibile:', e.message); }
  const rfPaesi = { US: rf }, cpiPaesi = { US: cpi };
  for (const [cod, p] of Object.entries(E.PAESI)) {
    if (cod === 'US') continue;
    try { const x = await tvClose(p.rf); if (x != null) rfPaesi[cod] = x / 100; } catch (e) { console.log(`Decennale ${cod} non disponibile:`, e.message); }
    const serie = paesi.yoy[cod] || (paesi.yoy[cod] = []);
    try {
      const u = await tvUltimo(p.yoy);
      const ultimo = serie.length ? serie[serie.length - 1][0] : '';
      if (u && u.mese > ultimo) serie.push([u.mese, u.valore]);
      else if (u && u.mese === ultimo) serie[serie.length - 1][1] = u.valore;      // eventuale revisione
    } catch (e) { console.log(`Inflazione ${cod} non aggiornata:`, e.message); }
    if (serie.length > 24) cpiPaesi[cod] = E.indiceDaYoy(serie);
    console.log(`${cod}: decennale ${rfPaesi[cod]}  inflazione fino a ${serie.length ? serie[serie.length - 1].join(' = ') : 'n.d.'}`);
  }
  fs.writeFileSync(CPI_PAESI, JSON.stringify(paesi) + '\n');
  // Decennali e CPI USA per il calcolo fatto nel browser sui titoli fuori elenco (index.html, fvFuoriElenco)
  if (rf != null && cpi.length > 120)
    fs.writeFileSync(MACRO, JSON.stringify({ aggiornato: new Date().toISOString(), rf: rfPaesi, cpi_us: cpi.slice(-330) }) + '\n');
  console.log(`Decennale ${rf}  CPI ultimo ${JSON.stringify(cpi[cpi.length - 1])}  S&P 500 ${bench.length} settimane`);

  const report = { run: new Date().toISOString(), rf, cpi_ultimo: cpi[cpi.length - 1] || null, fonti: md.fonti || {},
    sp500_settimane: bench.length, parametri: E.P, titoli: {} };
  let ok = 0;
  const cambi = [];
  // Storico del fair value: decennale di allora (USA: ^TNX settimanale; Germania, Regno Unito, Svizzera: serie
  // mensili OCSE). Se la serie di un paese manca si usa il suo decennale di oggi per tutte le date.
  const trimestri = fineTrimestri(today), storico = {};
  const tnx = (md.weekly && md.weekly['^TNX']) || [], rfHist = md.rf_hist || {};
  const rfAllora = cod => {
    const g = cod === 'US' ? null : cod === 'GB' || cod === 'CH' ? cod : 'DE';
    const serie = g ? rfHist[g] : tnx;
    return D => { const v = serie && serie.length ? valAt(serie, D) : null; return v != null ? v / 100 : (rfPaesi[cod] != null ? rfPaesi[cod] : rf); };
  };
  const catDi = en => { const k = E.verdict(en, Number(en.price)).key; return { key: k, cat: E.categoria(k) }; };
  for (const [t, e] of tickers) {
    const f = fund[e.tv];
    const prima = e.ind && e.price > 0 ? catDi(e) : null;        // esito prima dell'aggiornamento
    let r;
    if (!f) r = { status: 'simbolo_non_trovato' };
    else {
      let weekly = [], yerr = null;
      try { weekly = await weeklyOf(e.yf || t); } catch (ex) { yerr = String(ex.message).slice(0, 120); }
      // Tassi e inflazione del paese di quotazione; se mancano, quelli USA
      const cod = E.paese(e), rfP = rfPaesi[cod] != null ? rfPaesi[cod] : rf, cpiP = cpiPaesi[cod] || cpi;
      try { r = E.compute(f, cpiP, rfP, null, weekly, bench, weekly, today, { PI_ATTESA: E.PAESI[cod].piAttesa }); r.settimane = weekly.length; r.paese = rfPaesi[cod] != null && cpiPaesi[cod] ? cod : 'US'; if (yerr) r.prezzi = 'Yahoo: ' + yerr; }
      catch (ex) { r = { status: 'errore', errore: String(ex.message).slice(0, 200) }; }
      if (f.close != null) e.price = r2(f.close, f.close < 10 ? 3 : 2);
      e.fund = fundamentals(f);
      if (f.dividends_yield_current != null) e.divYield = r2(f.dividends_yield_current, 2);
      if (f.sector) e.settore = E.SETTORI[f.sector] || f.sector;
      // Prossima trimestrale (solo se futura)
      const en = f.earnings_release_next_date;
      e.earn_next = en && en * 1000 > Date.now() - 86400000 ? new Date(en * 1000).toISOString().slice(0, 10) : null;
    }
    report.titoli[t] = r;
    if (r.status !== 'errore' && r.status !== 'simbolo_non_trovato') {
      for (const k of ['fv', 'fv_low', 'fv_high', 'fv_mkt', 'fv_sto']) e[k] = r[k] != null ? r[k] : null;
      e.ind = Object.fromEntries(['status', 'paese', 'rf', 'ke', 'pi', 'beta', 'fcf_norm', 'cassa_az', 'g_hist', 'roic_m',
        'marg_n', 'marg_now', 'anni', 'avvisi'].map(k => [k, r[k] != null ? r[k] : null]));
      e.fv_source = 'indicatore';
      e.fv_updated = today;
      if (r.status === 'ok') ok++;
      if (r.status === 'ok' && r.fv > 0 && e.price > 0 && md.weekly && md.weekly[e.yf || t]) {
        const cod = E.paese(e), usaPaese = r.paese === cod;
        try {
          const s = storicoFv(f, md.weekly[e.yf || t], bench, usaPaese ? (cpiPaesi[cod] || cpi) : cpi, rfAllora(usaPaese ? cod : 'US'),
            trimestri, { PI_ATTESA: E.PAESI[cod].piAttesa });
          if (s.fv.filter(x => x != null).length >= 4) storico[t] = { fv: [...s.fv, r.fv], p: [...s.p, e.price] };
        } catch (ex) {}
      }
      // Cambio di esito (sottovalutata / equità / sopravvalutata) rispetto al calcolo precedente
      const dopo = e.price > 0 ? catDi(e) : null;
      // Non si registra se il prezzo è a meno del 2% da una soglia: basterebbe un'oscillazione per tornare indietro
      const vicino = [e.fv_low != null ? e.fv_low * (1 - E.P.MOS) : null, e.fv_high, e.fv_mkt].some(x => x > 0 && Math.abs(e.price / x - 1) < 0.02);
      if (prima && dopo && prima.cat !== 'na' && dopo.cat !== 'na' && prima.cat !== dopo.cat && !vicino)
        cambi.push({ data: today, t, nome: e.name, da: prima.key, a: dopo.key });
    }
    console.log(`${t.padEnd(6)} ${String(r.status).padEnd(20)} FV ${r.fv} [${r.fv_low} – ${r.fv_high}] MKT ${r.fv_mkt} STO ${r.fv_sto} beta ${r.beta}`);
    if (!(md.weekly && md.weekly[e.yf || t])) await sleep(150);
  }
  data.fv_updated = report.run;
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1) + '\n');
  // Registro dei cambi di esito: i più recenti in cima, al massimo 300; un solo cambio al giorno per titolo
  let reg = [];
  try { reg = JSON.parse(fs.readFileSync(CHANGES, 'utf8')).cambi || []; } catch (e) {}
  reg = cambi.concat(reg.filter(x => !cambi.some(c => c.t === x.t && c.data === x.data))).slice(0, 300);
  fs.writeFileSync(CHANGES, JSON.stringify({ aggiornato: report.run, cambi: reg }, null, 1) + '\n');
  if (Object.keys(storico).length > 50)
    fs.writeFileSync(HISTORY, JSON.stringify({ aggiornato: report.run, date: [...trimestri, today], titoli: storico }) + '\n');
  console.log(`Storico del fair value: ${Object.keys(storico).length} titoli, ${trimestri.length + 1} date`);
  console.log(`Cambi di esito in questo calcolo: ${cambi.length}`);
  console.log(`\nFatto: ${ok}/${tickers.length} titoli con fair value calcolato.`);

  // Titoli degli indici S&P 500, 400 e 600 che il sito non segue (gli stessi dei segnali TBO, tbo_state_ext.json):
  // stesso calcolo, scritto a parte (fv_ext.json, fv_history_ext.json) per non mescolarli con il mio elenco.
  let elenco = {};
  try { elenco = JSON.parse(fs.readFileSync(path.join(ROOT, 'tbo_state_ext.json'), 'utf8')).titoli || {}; } catch (e) {}
  const ext = {}, storicoExt = {}; let okExt = 0;
  // stesso ticker di un titolo del mio elenco su un'altra borsa (es. AMP: Ameriprise a New York, Amplifon a Milano): si aggiunge .US
  const chiaveExt = t => (db[t] || (data.aliases && data.aliases[t]) ? t + '.US' : t);
  const voci = Object.entries(elenco).filter(([, x]) => x.tv && x.tv.includes(':')).map(([sym, x]) => [chiaveExt(x.tv.split(':')[1]), sym, x]);
  const fundExt = voci.length ? await tvScan(voci.map(([, , x]) => x.tv)) : {};
  for (const [t, sym, x] of voci) {
    const f = fundExt[x.tv]; if (!f || !(f.close > 0)) continue;
    const weekly = (md.weekly && md.weekly[sym]) || [];
    const e = { name: x.n || t, tv: x.tv, ex: x.tv.split(':')[0], yf: sym, curr: '$', price: r2(f.close, f.close < 10 ? 3 : 2), fund: fundamentals(f),
      divYield: f.dividends_yield_current != null ? r2(f.dividends_yield_current, 2) : 0, settore: f.sector ? (E.SETTORI[f.sector] || f.sector) : '' };
    const en = f.earnings_release_next_date;
    e.earn_next = en && en * 1000 > Date.now() - 86400000 ? new Date(en * 1000).toISOString().slice(0, 10) : null;
    let r;
    try { r = E.compute(f, cpi, rf, null, weekly, bench, weekly, today, { PI_ATTESA: E.PAESI.US.piAttesa }); r.paese = 'US'; }
    catch (ex) { continue; }
    for (const k of ['fv', 'fv_low', 'fv_high', 'fv_mkt', 'fv_sto']) e[k] = r[k] != null ? r[k] : null;
    e.ind = Object.fromEntries(['status', 'paese', 'rf', 'ke', 'pi', 'beta', 'fcf_norm', 'cassa_az', 'g_hist', 'roic_m',
      'marg_n', 'marg_now', 'anni', 'avvisi'].map(k => [k, r[k] != null ? r[k] : null]));
    e.fv_source = 'indicatore'; e.fv_updated = today;
    ext[t] = e;
    if (r.status === 'ok') okExt++;
    if (r.status === 'ok' && r.fv > 0 && weekly.length) {
      try {
        const st = storicoFv(f, weekly, bench, cpi, rfAllora('US'), trimestri, { PI_ATTESA: E.PAESI.US.piAttesa });
        if (st.fv.filter(v => v != null).length >= 4) storicoExt[t] = { fv: [...st.fv, r.fv], p: [...st.p, e.price] };
      } catch (ex) {}
    }
  }
  if (Object.keys(ext).length > 300) {
    fs.writeFileSync(EXT, JSON.stringify({ aggiornato: report.run, descrizione: 'società degli indici S&P 500, 400 e 600 che non seguo personalmente', titoli: ext }) + '\n');
    fs.writeFileSync(HISTORY_EXT, JSON.stringify({ aggiornato: report.run, date: [...trimestri, today], titoli: storicoExt }) + '\n');
  }
  console.log(`Titoli aggiunti: ${Object.keys(ext).length} (${okExt} con fair value, ${Object.keys(storicoExt).length} con storico)`);
}

main().catch(e => { console.error(e); process.exit(1); });
