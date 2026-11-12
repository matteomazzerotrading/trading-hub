// compute_risk.mjs — correlazione tra i titoli del portafoglio (portfolio_risk.json).
// Usa i rendimenti settimanali degli ultimi due anni, dalle barre giornaliere di daily.json: su base settimanale
// il confronto tra titoli americani ed europei non risente degli orari di chiusura diversi.
// Obbligazioni e titoli fuori dall'elenco del sito non hanno barre e restano esclusi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const leggi = f => JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8'));
const SETTIMANE = 104;
const db = leggi('data.json').db, pf = leggi('portfolio.json');
const daily = leggi(process.env.DAILY_FILE || 'daily.json');

// chiave della settimana ISO (anno-settimana) di una data
const sett = s => { const d = new Date(s + 'T00:00:00Z'); const g = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - g + 3); const y = d.getUTCFullYear(); const w = 1 + Math.round(((d - Date.UTC(y, 0, 4)) / 86400000 - 3 + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7)) / 7); return y * 100 + w; };
const serie = {};                       // ticker -> Map(settimana -> ultima chiusura)
for (const p of pf.positions || []) {
  const e = db[p.ticker]; if (!e) continue;
  const b = daily[e.yf || p.ticker]; if (!b || b.d.length < 60) continue;
  const m = new Map(); b.d.forEach((d, i) => m.set(sett(d), b.c[i]));
  serie[p.ticker] = m;
}
const titoli = (pf.positions || []).filter(p => serie[p.ticker]).sort((a, b) => b.alloc_pct - a.alloc_pct).map(p => p.ticker);
if (titoli.length < 3) { console.log('Troppi pochi titoli con barre: nessun calcolo.'); process.exit(0); }
// settimane presenti per tutti i titoli, le ultime SETTIMANE + 1; la settimana in corso (incompleta) resta fuori
let comuni = [...serie[titoli[0]].keys()].filter(k => titoli.every(t => serie[t].has(k))).sort((a, b) => a - b);
const oggi = sett(new Date().toISOString().slice(0, 10));
if (comuni.at(-1) === oggi && new Date().getUTCDay() >= 1 && new Date().getUTCDay() <= 5) comuni.pop();
comuni = comuni.slice(-(SETTIMANE + 1));
const rend = titoli.map(t => comuni.slice(1).map((k, i) => serie[t].get(k) / serie[t].get(comuni[i]) - 1));
const media = a => a.reduce((x, y) => x + y, 0) / a.length;
const dev = a => { const m = media(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const corr = (a, b) => { const ma = media(a), mb = media(b); let c = 0, va = 0, vb = 0; for (let i = 0; i < a.length; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : 0; };
const r2 = x => Math.round(x * 100) / 100;
const M = titoli.map((_, i) => titoli.map((_, j) => (i === j ? 1 : r2(corr(rend[i], rend[j])))));
const peso = Object.fromEntries(pf.positions.map(p => [p.ticker, p.alloc_pct]));
let num = 0, den = 0; const coppie = [];
for (let i = 0; i < titoli.length; i++) for (let j = i + 1; j < titoli.length; j++) {
  const w = peso[titoli[i]] * peso[titoli[j]]; num += w * M[i][j]; den += w; coppie.push([titoli[i], titoli[j], M[i][j]]);
}
coppie.sort((a, b) => b[2] - a[2]);
const out = { aggiornato: new Date().toISOString(), settimane: comuni.length - 1, titoli, peso: titoli.map(t => peso[t]),
  vol: titoli.map((_, i) => r2(dev(rend[i]) * Math.sqrt(52) * 100)), corr: M, media: r2(num / den),
  piu: coppie.slice(0, 3), meno: coppie.slice(-3).reverse(), coperto: r2(titoli.reduce((s, t) => s + peso[t], 0)) };
fs.writeFileSync(path.join(ROOT, 'portfolio_risk.json'), JSON.stringify(out) + '\n');
console.log(`Rischio: ${titoli.length} titoli, ${out.settimane} settimane, correlazione media ${out.media}; più legati ${JSON.stringify(out.piu[0])}, meno ${JSON.stringify(out.meno[0])}`);
