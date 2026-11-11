// compute_tbo.mjs — segnali della TBO Strategy: "Compra" e "Operazione chiusa all'80%", come li mostra la strategia
// sul grafico giornaliero di TradingView.
//
// Le regole della strategia (quando una seduta dà una condizione di acquisto o di uscita) NON sono in questo
// repository, che è pubblico: il flusso di lavoro le riceve dal segreto TBO_RULES e le scrive in
// scripts/private/tbo_rules.mjs solo per la durata del calcolo. Quel modulo esporta
// segnali({o,h,l,c}) -> { setup: bool[], uscita: bool[] }. Senza il modulo lo script non fa nulla.
//
// Qui c'è il resto, che non è riservato: la contabilità della posizione con le impostazioni del grafico
// (capitale 1.000.000, ogni acquisto il 10% del capitale, al massimo 12 acquisti aperti, ordini eseguiti alla
// chiusura, uscita = vendita dell'80% della posizione a partire dagli acquisti più vecchi). Un acquisto compare
// solo se c'è ancora liquidità e non sono già aperti 12 acquisti, proprio come sul grafico.
// tbo_state.json conserva per ogni titolo gli acquisti aperti e la liquidità: è stato inizializzato con lo stato
// letto da TradingView e da lì prosegue una seduta alla volta.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const IMP = { QUOTA: 0.10, MAX_ACQUISTI: 12, CHIUSURA: 0.80, COMMISSIONE: 1 };
const BARRE = 420;                     // quante sedute passare alle regole (ne servono poco più di 250)

// Fa avanzare lo stato di un titolo (st = { q: [quantità degli acquisti aperti, dal più vecchio], cash, fino })
// sulle sedute successive a st.fino e restituisce gli eventi: { d, k: 'c' compra | 'x' chiusa all'80%, p }.
export function avanza(st, s, r) {
  const ev = [];
  for (let i = 0; i < s.d.length; i++) {
    if (s.d[i] <= st.fino) continue;
    const C = s.c[i], Q = st.q.reduce((a, b) => a + b, 0);
    if (r.setup[i] && st.q.length < IMP.MAX_ACQUISTI) {
      const n = Math.floor(IMP.QUOTA * (st.cash + Q * C) / C);
      if (n >= 1 && n * C <= st.cash) { st.q.push(n); st.cash -= n * C + IMP.COMMISSIONE; ev.push({ d: s.d[i], k: 'c', p: C }); }
    } else if (r.uscita[i] && Q > 0) {
      let vendi = Math.max(1, Math.floor(IMP.CHIUSURA * Q));
      st.cash += vendi * C - IMP.COMMISSIONE;
      while (vendi > 0 && st.q.length) { const t = Math.min(vendi, st.q[0]); st.q[0] -= t; vendi -= t; if (st.q[0] === 0) st.q.shift(); }
      ev.push({ d: s.d[i], k: 'x', p: C });
    }
    st.fino = s.d[i];
  }
  st.cash = Math.round(st.cash * 100) / 100;
  return ev;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const REGOLE = process.env.TBO_RULES_FILE || path.join(ROOT, 'scripts', 'private', 'tbo_rules.mjs');
  if (!fs.existsSync(REGOLE)) { console.log('Regole TBO non configurate: nessun calcolo.'); process.exit(0); }
  let segnali;
  try { ({ segnali } = await import(pathToFileURL(REGOLE).href)); if (typeof segnali !== 'function') throw 0; }
  catch { console.error('Regole TBO non leggibili: nessun calcolo.'); process.exit(1); }   // niente dettagli nel registro pubblico

  const leggi = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const db = leggi('data.json').db, daily = leggi('daily.json');
  const stato = leggi('tbo_state.json'), prima = fs.existsSync(path.join(ROOT, 'tbo_signals.json')) ? leggi('tbo_signals.json') : { segnali: [] };
  const ora = process.env.TBO_NOW ? new Date(process.env.TBO_NOW) : new Date();
  const oggi = ora.toISOString().slice(0, 10), minuti = ora.getUTCHours() * 60 + ora.getUTCMinutes();
  // La barra di oggi vale solo a mercato chiuso: Europa dalle 16:50 UTC, Stati Uniti dalle 21:10 UTC.
  const chiuso = sym => minuti >= (/\.[A-Z]+$/.test(sym) ? 16 * 60 + 50 : 21 * 60 + 10);
  const lunedi = s => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d; };

  const nuovi = []; let ultima = stato.ultima_seduta || '', titoli = 0, errori = 0;
  for (const [t, e] of Object.entries(db)) {
    const st = stato.titoli[t];
    if (!e.tv || !st) continue;
    const sym = e.yf || t, b = daily[sym];
    if (!b || !b.h || b.d.length < 300) continue;
    let n = b.d.length;
    if (b.d[n - 1] === oggi && !chiuso(sym)) n--;                    // seduta ancora aperta
    const da = Math.max(0, n - BARRE), taglia = a => a.slice(da, n);
    const s = { d: taglia(b.d), o: taglia(b.o), h: taglia(b.h), l: taglia(b.l), c: taglia(b.c) };
    if (s.d.at(-1) <= st.fino) { titoli++; continue; }               // niente di nuovo per questo titolo
    if (s.d[0] > st.fino) { errori++; continue; }                     // stato troppo vecchio: serve una nuova lettura da TradingView
    let r;
    try { r = segnali(s); if (!r || !r.setup || !r.uscita) throw 0; } catch { errori++; continue; }
    for (const ev of avanza(st, s, r)) nuovi.push({ t, ...ev });
    titoli++;
    if (st.fino > ultima) ultima = st.fino;
  }
  if (!titoli || errori > titoli) { console.error('Troppi errori nel calcolo: file non aggiornati.'); process.exit(1); }
  const dal = lunedi(ultima); dal.setUTCDate(dal.getUTCDate() - 7);   // si tengono questa settimana e la precedente
  const dalS = dal.toISOString().slice(0, 10), visti = new Set();
  const righe = [...nuovi, ...(prima.segnali || [])].filter(r => r.d >= dalS && db[r.t] && !visti.has(r.t + r.d + r.k) && visti.add(r.t + r.d + r.k));
  righe.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.t.localeCompare(b.t)));
  stato.aggiornato = ora.toISOString(); stato.ultima_seduta = ultima;
  fs.writeFileSync(path.join(ROOT, 'tbo_state.json'), JSON.stringify(stato) + '\n');
  fs.writeFileSync(path.join(ROOT, 'tbo_signals.json'), JSON.stringify({ aggiornato: ora.toISOString(), ultima_seduta: ultima, dal: dalS, titoli, segnali: righe }) + '\n');
  console.log(`TBO: ${titoli} titoli, ${nuovi.filter(r => r.k === 'c').length} nuovi "compra" e ${nuovi.filter(r => r.k === 'x').length} nuove chiusure; in elenco ${righe.length} segnali dal ${dalS} al ${ultima}` + (errori ? ` (${errori} titoli saltati)` : ''));
}
