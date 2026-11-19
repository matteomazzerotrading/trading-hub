// compute_diario.mjs — Diario delle mie operazioni (diario.json): per ogni acquisto e vendita del portafoglio
// (portfolio.json → operazioni) il contesto del giorno e com'è andata dopo:
//   fv    fair value pavimento di allora (ultima fine trimestre fino a quel giorno, da fv_history*.json) e distanza
//         del prezzo dell'operazione da quel valore;
//   tbo   segnale della strategia TBO nei 7 giorni fino all'operazione ("Compra" per un acquisto, "Chiusa all'80%"
//         per una vendita), dalla storia ricostruita sul titolo;
//   amp   ampiezza del mercato quel giorno (quota di titoli sopra la media delle ultime 200 chiusure);
//   dopo  variazione del prezzo da allora a oggi, nella valuta del titolo; sp500 la stessa variazione dello S&P 500.
// Eseguito ogni sera da compute-patterns dopo i segnali TBO (serve il modulo delle regole, come compute_tbo.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { precedenti, ampiezzaMercato } from './compute_tbo.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const leggi = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const REGOLE = process.env.TBO_RULES_FILE || path.join(ROOT, 'scripts', 'private', 'tbo_rules.mjs');
let segnali = null;
try { ({ segnali } = await import(pathToFileURL(REGOLE).href)); } catch { console.log('Regole TBO non disponibili: diario senza segnali.'); }

const port = leggi('portfolio.json', {}), ops = port.operazioni || [];
if (!ops.length) { console.log('Nessuna operazione nel portafoglio.'); process.exit(0); }
const db = (leggi('data.json', { db: {} }).db) || {}, ext = (leggi('fv_ext.json', {}) || {}).titoli || {};
const daily = leggi('daily.json', {}) || {}, dailyExt = leggi('daily_ext.json', {}) || {};
const H = leggi('fv_history.json', { date: [], titoli: {} }), HX = leggi('fv_history_ext.json', { date: [], titoli: {} });
const bench = (leggi('benchmarks.json', {}) || {}).serie || {};

// titolo del sito (o degli altri) con la stessa borsa e lo stesso ticker dell'operazione
const perTv = {};
for (const [k, e] of Object.entries(db)) if (e.tv) perTv[e.tv] = { k, e, s: daily[e.yf || k], H };
for (const [k, e] of Object.entries(ext)) if (e.tv && !perTv[e.tv]) perTv[e.tv] = { k, e, s: dailyExt[e.yf] || dailyExt[k], H: HX, ext: true };

const chiusuraAl = (s, d) => { let r = null; for (let i = 0; i < s.d.length && s.d[i] <= d; i++) r = s.c[i]; return r; };
const ultima = s => s.c[s.c.length - 1];
const amp = ampiezzaMercato([...Object.values(daily), ...Object.values(dailyExt)].filter(s => s && s.c && s.c.length > 250), 300);
const r1 = x => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 10);
const sp = bench.sp500;

const storiaTbo = {};
function tboDi(t, s) {
  if (!segnali || !s || s.c.length < 300) return null;
  if (!storiaTbo[t]) { try { const P = precedenti(s, segnali(s)); storiaTbo[t] = { c: P.acquisti.map(a => a.d), x: P.uscite.map(u => u.d) }; } catch { storiaTbo[t] = { c: [], x: [] }; } }
  return storiaTbo[t];
}
const giorniPrima = (d, giorni) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - giorni); return x.toISOString().slice(0, 10); };

const righe = ops.map(o => {
  const m = perTv[`${o.exchange}:${o.ticker}`], r = { ...o };
  if (!m) return r;
  r.k = m.k; r.nome = m.e.name; if (m.ext) r.altro = 1;
  const s = m.s;
  // fair value di allora: l'ultima fine trimestre fino al giorno dell'operazione (l'ultimo punto della serie è "oggi")
  const st = m.H.titoli && m.H.titoli[m.k];
  if (st) {
    let j = -1; for (let i = 0; i < m.H.date.length - 1; i++) if (m.H.date[i] <= o.date && st.fv[i] != null) j = i;
    // distanze oltre +300% o sotto −95% indicano un dato di allora non confrontabile (es. frazionamenti): si omettono
    const gap = j >= 0 ? o.price / st.fv[j] - 1 : null;
    if (j >= 0 && gap < 3 && gap > -0.95) r.fv = { val: st.fv[j], data: m.H.date[j], gap: r1(gap) };
  }
  if (m.e.fv != null) r.fv_oggi = m.e.fv;
  if (s) {
    const ora = ultima(s); r.prezzo_oggi = ora; r.dopo = r1(ora / o.price - 1);
    const T = tboDi(m.k, s);
    if (T) {
      const da = giorniPrima(o.date, 7), lista = o.side === 'buy' ? T.c : T.x, trovati = lista.filter(d => d >= da && d <= o.date);
      r.tbo = trovati.length ? { d: trovati.at(-1), n: trovati.length } : null;
    }
  }
  const q = [...amp.keys()].filter(d => d <= o.date).sort().at(-1);
  if (q) r.amp = r1(amp.get(q));
  if (sp && sp.d.length) { const a = chiusuraAl(sp, o.date), b = sp.c.at(-1); if (a) r.sp500 = r1(b / a - 1); }
  return r;
});
fs.writeFileSync(path.join(ROOT, 'diario.json'), JSON.stringify({ aggiornato: new Date().toISOString(), operazioni: righe }) + '\n');
console.log(`Diario: ${righe.length} operazioni, ${righe.filter(r => r.fv).length} con fair value di allora, ${righe.filter(r => r.tbo).length} con un segnale TBO vicino.`);
