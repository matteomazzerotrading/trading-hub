// compute_patterns.mjs — Pattern Scanner: per ogni titolo cerca nel passato il periodo più simile all'andamento
// recente e riporta che cosa accadde dopo. Stessa logica dell'indicatore "MM Pattern Scanner" su TradingView:
// correlazione di Pearson tra le ultime LUNGHEZZA chiusure giornaliere e ogni finestra della stessa lunghezza
// nelle PROFONDITA sedute precedenti; la proiezione applica al prezzo di oggi le variazioni percentuali
// che seguirono il periodo trovato. Eseguito da GitHub Actions dopo scripts/fetch_daily.py.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = { LUNGHEZZA: 171, PROFONDITA: 3000, SOGLIA: 0.90, PROIEZIONE: 252 };     // impostazioni del grafico

export function scan(c, O = P) {
  const L = O.LUNGHEZZA, last = c.length - 1;
  const lookback = Math.min(O.PROFONDITA, last - L - O.PROIEZIONE - 1);
  if (lookback <= L) return null;
  let sx = 0, sx2 = 0;
  for (let j = 0; j < L; j++) { const v = c[last - j]; sx += v; sx2 += v * v; }
  let bestR = -1, bestI = -1;
  for (let i = L + 2; i <= lookback; i++) {
    let sy = 0, sy2 = 0, sxy = 0;
    for (let j = 0; j < L; j++) { const vx = c[last - j], vy = c[last - i - j]; sy += vy; sy2 += vy * vy; sxy += vx * vy; }
    const den = Math.sqrt(Math.max(0, L * sx2 - sx * sx) * Math.max(0, L * sy2 - sy * sy));
    const r = den === 0 ? 0 : (L * sxy - sx * sy) / den;
    if (r > bestR) { bestR = r; bestI = i; }
  }
  if (bestI < 0) return null;
  const limite = Math.min(O.PROIEZIONE, bestI), base = c[last - bestI], oggi = c[last];
  const proj = [];
  for (let p = 1; p <= limite; p++) proj.push(oggi * (1 + (c[last - bestI + p] - base) / base));
  return { r: bestR, i: bestI, limite, proj, inizio: last - bestI - L + 1, fine: last - bestI };
}

const ogni = (a, k) => a.filter((_, i) => i % k === 0 || i === a.length - 1);
const r4 = x => Number(x.toPrecision(5));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8')).db;
  const daily = JSON.parse(fs.readFileSync(path.join(ROOT, 'daily.json'), 'utf8'));
  const sintesi = {}, dettaglio = {};
  let n = 0, trovati = 0;
  for (const [t, e] of Object.entries(db)) {
    const s = daily[e.yf || t];
    if (!s || !e.tv) continue;
    const res = scan(s.c);
    if (!res) continue;
    n++;
    const last = s.c.length - 1, oggi = s.c[last], L = P.LUNGHEZZA;
    const fine = res.proj[res.proj.length - 1];
    const ok = res.r >= P.SOGLIA;
    if (ok) trovati++;
    sintesi[t] = {
      r: Number(res.r.toFixed(4)), ok, data: s.d[last], prezzo: r4(oggi),
      dal: s.d[res.inizio], al: s.d[res.fine], sedute: res.limite,
      var: Number(((fine / oggi - 1) * 100).toFixed(1)),
      min: Number(((Math.min(...res.proj) / oggi - 1) * 100).toFixed(1)),
      max: Number(((Math.max(...res.proj) / oggi - 1) * 100).toFixed(1))
    };
    // Per il grafico: andamento attuale, periodo storico riportato alla scala di oggi, proiezione (un punto ogni 2-3 sedute)
    const scala = oggi / s.c[res.fine];
    dettaglio[t] = {
      att: ogni(s.c.slice(last - L + 1), 2).map(r4),
      sto: ogni(s.c.slice(res.inizio, res.fine + 1), 2).map(v => r4(v * scala)),
      pro: ogni(res.proj, 3).map(r4)
    };
  }
  const run = new Date().toISOString();
  fs.writeFileSync(path.join(ROOT, 'patterns.json'), JSON.stringify({ aggiornato: run, parametri: P, titoli: sintesi }) + '\n');
  fs.writeFileSync(path.join(ROOT, 'patterns_detail.json'), JSON.stringify({ aggiornato: run, titoli: dettaglio }) + '\n');
  console.log(`Pattern Scanner: ${n} titoli analizzati, ${trovati} con somiglianza di almeno ${P.SOGLIA * 100}%`);
}
