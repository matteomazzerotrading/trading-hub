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
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data.json');
const REPORT = path.join(ROOT, 'fv_report.json');
const CHANGES = path.join(ROOT, 'fv_changes.json');
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
  console.log(`Decennale ${rf}  CPI ultimo ${JSON.stringify(cpi[cpi.length - 1])}  S&P 500 ${bench.length} settimane`);

  const report = { run: new Date().toISOString(), rf, cpi_ultimo: cpi[cpi.length - 1] || null, fonti: md.fonti || {},
    sp500_settimane: bench.length, parametri: E.P, titoli: {} };
  let ok = 0;
  const cambi = [];
  const catDi = en => { const k = E.verdict(en, Number(en.price)).key; return { key: k, cat: E.categoria(k) }; };
  for (const [t, e] of tickers) {
    const f = fund[e.tv];
    const prima = e.ind && e.price > 0 ? catDi(e) : null;        // esito prima dell'aggiornamento
    let r;
    if (!f) r = { status: 'simbolo_non_trovato' };
    else {
      let weekly = [], yerr = null;
      try { weekly = await weeklyOf(e.yf || t); } catch (ex) { yerr = String(ex.message).slice(0, 120); }
      try { r = E.compute(f, cpi, rf, null, weekly, bench, weekly, today); r.settimane = weekly.length; if (yerr) r.prezzi = 'Yahoo: ' + yerr; }
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
      e.ind = Object.fromEntries(['status', 'ke', 'pi', 'beta', 'fcf_norm', 'cassa_az', 'g_hist', 'roic_m',
        'marg_n', 'marg_now', 'anni', 'avvisi'].map(k => [k, r[k] != null ? r[k] : null]));
      e.fv_source = 'indicatore';
      e.fv_updated = today;
      if (r.status === 'ok') ok++;
      // Cambio di esito (sottovalutata / equità / sopravvalutata) rispetto al calcolo precedente
      const dopo = e.price > 0 ? catDi(e) : null;
      if (prima && dopo && prima.cat !== 'na' && dopo.cat !== 'na' && prima.cat !== dopo.cat)
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
  console.log(`Cambi di esito in questo calcolo: ${cambi.length}`);
  console.log(`\nFatto: ${ok}/${tickers.length} titoli con fair value calcolato.`);
}

main().catch(e => { console.error(e); process.exit(1); });
