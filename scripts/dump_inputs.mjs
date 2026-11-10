// dump_inputs.mjs — salva in backtest_inputs/fund.json i dati di bilancio (con 20 anni di storia) di tutti i titoli.
// Serve alla verifica sul passato della formula del fair value (workflow "Dump Inputs", avviato a mano).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };
const COLS = ['close', 'currency', 'fiscal_period_fy_h', 'fiscal_period_end_fy', 'free_cash_flow_fy_h', 'total_revenue_fy_h', 'net_income_fy_h',
  'earnings_per_share_diluted_fy_h', 'total_revenue_fy', 'cash_n_short_term_invest_fq', 'cash_n_short_term_invest_fy', 'total_debt_fq', 'total_debt_fy',
  'return_on_invested_capital_fy', 'total_shares_outstanding', 'earnings_release_date', 'fiscal_period_end_fq', 'sector',
  'total_debt_fy_h', 'total_assets_fy_h', 'ebitda_fy_h', 'gross_profit_fy_h', 'dps_common_stock_prim_issue_fy_h', 'net_debt_fy', 'total_equity_fq',
  'book_value_per_share_fq', 'return_on_equity_fy', 'market_cap_basic'];

const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8')).db;
const syms = Object.entries(db).filter(([, e]) => e.tv);
const out = {};
for (let i = 0; i < syms.length; i += 50) {
  const body = JSON.stringify({ symbols: { tickers: syms.slice(i, i + 50).map(([, e]) => e.tv) }, columns: COLS, price_conversion: { to_symbol: true } });
  const r = await fetch('https://scanner.tradingview.com/global/scan', { method: 'POST', body, headers: { ...UA, 'Content-Type': 'text/plain' } });
  const j = await r.json();
  for (const row of j.data || []) {
    const t = syms.find(([, e]) => e.tv === row.s)[0];
    out[t] = Object.fromEntries(COLS.map((c, k) => [c, row.d[k]]));
  }
}
const rf = {};
for (const s of ['TVC:US10Y', 'TVC:DE10Y', 'TVC:GB10Y', 'TVC:CH10Y', 'TVC:IT10Y']) {
  const j = await (await fetch('https://scanner.tradingview.com/symbol?symbol=' + encodeURIComponent(s) + '&fields=close&no_404=true', { headers: UA })).json();
  rf[s] = j && j.close;
}
fs.mkdirSync(path.join(ROOT, 'backtest_inputs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'backtest_inputs', 'fund.json'), JSON.stringify({ run: new Date().toISOString(), rf, fund: out }));
console.log(`Bilanci salvati: ${Object.keys(out).length} titoli`);
