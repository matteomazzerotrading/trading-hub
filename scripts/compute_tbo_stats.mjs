// compute_tbo_stats.mjs — track record della TBO Strategy su un campione largo (tbo_stats.json).
// Legge le barre scaricate da scripts/fetch_universe.py; le regole arrivano dal segreto TBO_RULES, come per i
// segnali (scripts/compute_tbo.mjs). Qui c'è solo la contabilità: operazioni, confronti, raggruppamenti.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { storicoOperazioni, statistiche, confronto, efficacia } from './compute_tbo.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.resolve(process.argv[2] || path.join(ROOT, 'universe'));
const REGOLE = process.env.TBO_RULES_FILE || path.join(ROOT, 'scripts', 'private', 'tbo_rules.mjs');
if (!fs.existsSync(REGOLE)) { console.log('Regole TBO non configurate: nessun calcolo.'); process.exit(0); }
let segnali;
try { ({ segnali } = await import(pathToFileURL(REGOLE).href)); if (typeof segnali !== 'function') throw 0; }
catch { console.error('Regole TBO non leggibili: nessun calcolo.'); process.exit(1); }

const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'));
const oggi = new Date().toISOString().slice(0, 10);
const per = [], serie = [], coppie = [], gruppi = {}; let dal = '9999', al = '', errori = 0, scartati = 0;
for (const f of fs.readdirSync(DIR).filter(x => /^daily_\d+\.json$/.test(x)).sort()) {
  const blocco = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const [sim, b] of Object.entries(blocco)) {
    if (!b || !b.c || b.d.length < 1500) continue;
    let n = b.d.length; if (b.d[n - 1] >= oggi) n--;                     // la seduta di oggi può essere ancora aperta
    const s = { d: b.d.slice(0, n), h: b.h.slice(0, n), l: b.l.slice(0, n), c: b.c.slice(0, n) };
    // barre sospette (frazionamenti non corretti, prezzi sbagliati): un salto di oltre 4 volte in un giorno esclude il titolo
    let salto = false; for (let i = 1; i < n; i++) { const q = s.c[i] / s.c[i - 1]; if (!(q > 0.25 && q < 4) || !(s.h[i] >= s.l[i]) || !(s.c[i] > 0)) { salto = true; break; } }
    if (salto) { scartati++; continue; }
    let r; try { r = segnali(s); } catch { errori++; continue; }
    if (!r || !r.setup || !r.uscita) { errori++; continue; }
    per.push(storicoOperazioni(s, r)); serie.push(s); coppie.push({ s, r });
    (gruppi[meta.gruppo[sim] || 'Altri'] = gruppi[meta.gruppo[sim] || 'Altri'] || []).push({ s, r });
    if (s.d[0] < dal) dal = s.d[0]; if (s.d.at(-1) > al) al = s.d.at(-1);
  }
}
if (per.length < 300 || errori > per.length / 10) { console.error(`Campione insufficiente (${per.length} titoli, ${errori} errori): file non aggiornato.`); process.exit(1); }
const st = statistiche(per, dal, al);
st.confronto = confronto(serie, Math.round(st.chiuse.durata_mediana_giorni * 252 / 365));
st.efficacia = efficacia(coppie);
st.universo = meta.descrizione;
// lo stesso confronto, gruppo per gruppo: serve a vedere se il risultato dipende dal tipo di società
st.gruppi = Object.entries(gruppi).filter(([, S]) => S.length >= 30).map(([nome, S]) => {
  const e = efficacia(S), p = e.portafoglio[0], sei = e.orizzonti.find(o => o.mesi === 6);
  return { nome, titoli: S.length, strategia: p ? p.strategia : null, tieni: p ? p.tieni : null,
    dopo_acquisto_6m_pct: sei && sei.acquisto ? sei.acquisto.mediana_pct : null, giorno_qualsiasi_6m_pct: sei && sei.qualsiasi ? sei.qualsiasi.mediana_pct : null };
}).sort((a, b) => b.titoli - a.titoli);
fs.writeFileSync(path.join(ROOT, 'tbo_stats.json'), JSON.stringify({ aggiornato: new Date().toISOString(), ...st }) + '\n');
st.scartati = scartati;
console.log(`Track record TBO: ${scartati} titoli scartati per barre sospette; ${per.length} titoli dal ${dal} al ${al}; gruppi: ${st.gruppi.map(g => g.nome + ' ' + g.titoli).join(', ')}`);
