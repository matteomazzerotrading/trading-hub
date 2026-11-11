// compute_tbo.mjs — segnali della TBO Strategy sulle barre giornaliere di tutti i titoli (ultime due settimane).
//
// Le regole della strategia NON sono in questo repository, che è pubblico: il flusso di lavoro le riceve dal
// segreto TBO_RULES e le scrive in scripts/private/tbo_rules.mjs solo per la durata del calcolo. Quel modulo
// esporta segnali({o,h,l,c}) -> { setup: bool[], uscita: bool[] }. Senza il modulo lo script non fa nulla
// e lascia intatto tbo_signals.json. Qui c'è solo il contorno: lettura delle barre, date, scrittura del file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REGOLE = process.env.TBO_RULES_FILE || path.join(ROOT, 'scripts', 'private', 'tbo_rules.mjs');
const BARRE = 420;                     // quante sedute passare alle regole (ne servono poco più di 250)

if (!fs.existsSync(REGOLE)) { console.log('Regole TBO non configurate: nessun calcolo.'); process.exit(0); }
let segnali;
try { ({ segnali } = await import(pathToFileURL(REGOLE).href)); if (typeof segnali !== 'function') throw 0; }
catch { console.error('Regole TBO non leggibili: nessun calcolo.'); process.exit(1); }   // niente dettagli nel registro pubblico

const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8')).db;
const daily = JSON.parse(fs.readFileSync(path.join(ROOT, 'daily.json'), 'utf8'));
const ora = process.env.TBO_NOW ? new Date(process.env.TBO_NOW) : new Date();
const oggi = ora.toISOString().slice(0, 10), minuti = ora.getUTCHours() * 60 + ora.getUTCMinutes();
// La barra di oggi vale solo a mercato chiuso: Europa dalle 16:50 UTC, Stati Uniti dalle 21:10 UTC.
const chiuso = sym => minuti >= (/\.[A-Z]+$/.test(sym) ? 16 * 60 + 50 : 21 * 60 + 10);
const lunedi = s => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d; };

const righe = []; let ultima = '', titoli = 0, errori = 0;
const serie = {};
for (const [t, e] of Object.entries(db)) {
  if (!e.tv) continue;
  const sym = e.yf || t, b = daily[sym];
  if (!b || !b.h || b.d.length < 300) continue;
  let n = b.d.length;
  if (b.d[n - 1] === oggi && !chiuso(sym)) n--;                    // seduta ancora aperta
  const da = Math.max(0, n - BARRE), taglia = a => a.slice(da, n);
  serie[t] = { d: taglia(b.d), o: taglia(b.o), h: taglia(b.h), l: taglia(b.l), c: taglia(b.c) };
  if (serie[t].d.at(-1) > ultima) ultima = serie[t].d.at(-1);
}
if (!ultima) { console.error('Nessuna barra giornaliera: nessun calcolo.'); process.exit(1); }
const dal = lunedi(ultima); dal.setUTCDate(dal.getUTCDate() - 7);   // dal lunedì della settimana precedente
const dalS = dal.toISOString().slice(0, 10);
for (const [t, s] of Object.entries(serie)) {
  if (s.d.at(-1) < dalS) continue;                                 // titolo fermo da troppo tempo
  let r;
  try { r = segnali(s); } catch { errori++; continue; }
  titoli++;
  for (let i = s.d.length - 1; i >= 0 && s.d[i] >= dalS; i--) {
    if (r.setup[i]) righe.push({ t, d: s.d[i], k: 's', p: s.c[i] });
    if (r.uscita[i]) righe.push({ t, d: s.d[i], k: 'u', p: s.c[i] });
  }
}
if (errori > titoli) { console.error('Troppi errori nel calcolo: file non aggiornato.'); process.exit(1); }
righe.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.t.localeCompare(b.t)));
const out = { aggiornato: ora.toISOString(), ultima_seduta: ultima, dal: dalS, titoli, segnali: righe };
fs.writeFileSync(path.join(ROOT, 'tbo_signals.json'), JSON.stringify(out) + '\n');
console.log(`TBO: ${titoli} titoli, ${righe.filter(r => r.k === 's').length} setup e ${righe.filter(r => r.k === 'u').length} condizioni di uscita dal ${dalS} al ${ultima}`);
