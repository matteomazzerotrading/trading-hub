// compute_tbo_stats.mjs — track record della TBO Strategy su un campione largo (tbo_stats.json).
// Legge le barre scaricate da scripts/fetch_universe.py; le regole arrivano dal segreto TBO_RULES, come per i
// segnali (scripts/compute_tbo.mjs). Qui c'è solo la contabilità: operazioni, confronti, raggruppamenti.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { storicoOperazioni, statistiche, confronto, efficacia, avanza, precedenti, riassumiPrecedenti, ampiezzaMercato, FASCE_AMPIEZZA, fasciaAmpiezza } from './compute_tbo.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.resolve(process.argv[2] || path.join(ROOT, 'universe'));
const REGOLE = process.env.TBO_RULES_FILE || path.join(ROOT, 'scripts', 'private', 'tbo_rules.mjs');
if (!fs.existsSync(REGOLE)) { console.log('Regole TBO non configurate: nessun calcolo.'); process.exit(0); }
let segnali;
try { ({ segnali } = await import(pathToFileURL(REGOLE).href)); if (typeof segnali !== 'function') throw 0; }
catch { console.error('Regole TBO non leggibili: nessun calcolo.'); process.exit(1); }

const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'));
const oggi = new Date().toISOString().slice(0, 10);
// Segnali giornalieri anche sui titoli del campione che il sito non segue (tbo_state_ext.json). Per questi lo stato
// della strategia non si legge da TradingView: si ricostruisce dalla prima seduta scaricata (14 anni), fermandosi
// RITARDO sedute prima della fine, così il calcolo serale riparte da lì e mostra subito i segnali delle ultime settimane.
// Lo stato di un titolo già presente non si tocca: prosegue una seduta alla volta come per i titoli del sito.
const STATO_EXT = path.join(ROOT, 'tbo_state_ext.json'), RITARDO = 12;
const ext = fs.existsSync(STATO_EXT) ? JSON.parse(fs.readFileSync(STATO_EXT, 'utf8')) : { titoli: {} };
const sito = new Set(meta.sito || []), nuovoExt = {};
// indici di borsa e materie prime (meta.macro): segnali giornalieri e precedenti, ma fuori dal track record delle azioni
const MACRO = meta.macro || {}, catDi = sim => (MACRO[sim] ? { cat: MACRO[sim].cat, cur: MACRO[sim].cur } : {});
const per = [], serie = [], coppie = [], gruppi = {}, prec = {}; let dal = '9999', al = '', errori = 0, scartati = 0;
for (const f of fs.readdirSync(DIR).filter(x => /^daily_\d+\.json$/.test(x)).sort()) {
  const blocco = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const [sim, b] of Object.entries(blocco)) {
    if (!b || !b.c) continue;
    let n = b.d.length; if (b.d[n - 1] >= oggi) n--;                     // la seduta di oggi può essere ancora aperta
    const s = { d: b.d.slice(0, n), h: b.h.slice(0, n), l: b.l.slice(0, n), c: b.c.slice(0, n) };
    // storia breve (nuove quotazioni): fuori dal track record, ma lo stato per i segnali giornalieri si ricostruisce
    if (b.d.length < 1500) { giovani(sim, s); continue; }
    if (MACRO[sim]) {
      if (!s.c.every(x => x > 0)) { scartati++; continue; }
      let r; try { r = segnali(s); if (!r || !r.setup || !r.uscita) throw 0; } catch { errori++; continue; }
      prec[sim] = precedenti(s, r);
      const vecchio = ext.titoli[sim], tv = (meta.tv && meta.tv[sim]) || (vecchio && vecchio.tv) || null, nome = (meta.nomi && meta.nomi[sim]) || sim;
      if (vecchio) nuovoExt[sim] = { ...vecchio, n: nome, tv, ...catDi(sim) };
      else if (s.d.length > RITARDO + 300) {
        const st = { q: [], cash: 1e6, fino: '0000' }, m = s.d.length - RITARDO;
        avanza(st, { d: s.d.slice(0, m), c: s.c.slice(0, m) }, { setup: r.setup.slice(0, m), uscita: r.uscita.slice(0, m) });
        nuovoExt[sim] = { ...st, n: nome, tv, ...catDi(sim) };
      }
      continue;
    }
    // barre sospette (frazionamenti non corretti, prezzi sbagliati): un salto di oltre 4 volte in un giorno esclude il titolo
    let salto = false; for (let i = 1; i < n; i++) { const q = s.c[i] / s.c[i - 1]; if (!(q > 0.25 && q < 4) || !(s.h[i] >= s.l[i]) || !(s.c[i] > 0)) { salto = true; break; } }
    if (salto) { scartati++; continue; }
    let r; try { r = segnali(s); } catch { errori++; continue; }
    if (!r || !r.setup || !r.uscita) { errori++; continue; }
    per.push(storicoOperazioni(s, r)); serie.push(s); coppie.push({ s, r }); prec[sim] = precedenti(s, r);
    if (!sito.has(sim) && meta.gruppo[sim] && !String(meta.gruppo[sim]).includes('sito')) {
      const vecchio = ext.titoli[sim], nome = (meta.nomi && meta.nomi[sim]) || sim, tv = (meta.tv && meta.tv[sim]) || (vecchio && vecchio.tv) || null;
      if (vecchio) nuovoExt[sim] = { ...vecchio, n: nome, tv };
      else if (s.d.length > RITARDO + 300) {
        const st = { q: [], cash: 1e6, fino: '0000' }, m = s.d.length - RITARDO;
        avanza(st, { d: s.d.slice(0, m), c: s.c.slice(0, m) }, { setup: r.setup.slice(0, m), uscita: r.uscita.slice(0, m) });
        nuovoExt[sim] = { ...st, n: nome, tv };
      }
    }
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
// Precedenti titolo per titolo (tbo_titoli.json): il calcolo serale li copia in ogni nuovo segnale
const riass = {}; for (const [sim, P] of Object.entries(prec)) riass[sim] = riassumiPrecedenti(P);
fs.writeFileSync(path.join(ROOT, 'tbo_titoli.json'), JSON.stringify({ aggiornato: new Date().toISOString(), dal, al,
  nota: 'Precedenti dei segnali della TBO Strategy titolo per titolo; legenda in scripts/compute_tbo.mjs (riassumiPrecedenti)', titoli: riass }) + '\n');
// Contesto di mercato: come sono andati i segnali "Compra" secondo l'ampiezza del mercato nel giorno del segnale
// e, dentro le fasi deboli e quelle normali, secondo la distanza del titolo dal massimo dell'ultimo anno
{
  const amp = ampiezzaMercato(serie, 300), pc = x => Math.round(x * 1000) / 10;
  const mediana = a => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const esiti = Object.values(prec).flatMap(P => P.acquisti).filter(a => amp.has(a.d)).map(a => ({ d: a.d, q: amp.get(a.d), r6: a.r[1], r12: a.r[2], sc: a.sc }));
  const misura = g => { const x6 = g.map(e => e.r6).filter(x => x != null), x12 = g.map(e => e.r12).filter(x => x != null);
    return x12.length >= 50 ? { casi: x12.length, mesi: new Set(g.filter(e => e.r12 != null).map(e => e.d.slice(0, 7))).size,
      p12: pc(x12.filter(x => x > 0).length / x12.length), m12: pc(mediana(x12)), p6: pc(x6.filter(x => x > 0).length / x6.length), m6: pc(mediana(x6)) } : null; };
  const perFascia = g => FASCE_AMPIEZZA.map(f => ({ k: f.k, nome: f.nome, ...(misura(g.filter(e => e.q >= f.da && e.q < f.a)) || { casi: 0 }) }));
  const debole = e => e.q < 0.5, scontato = e => e.sc != null && e.sc < -0.2;
  st.contesto = {
    nota: 'Ampiezza = quota di titoli del campione sopra la media delle ultime 200 chiusure nel giorno del segnale',
    tutti: misura(esiti), fasce: perFascia(esiti),
    sconto: [['debole', debole], ['normale', e => !debole(e)]].flatMap(([m, f]) => [['oltre il 20% sotto il massimo', scontato], ['entro il 20% dal massimo', e => !scontato(e)]]
      .map(([nome, g]) => ({ mercato: m, nome, ...(misura(esiti.filter(e => f(e) && g(e))) || { casi: 0 }) }))),
    periodi: [['2013-2019', '0000', '2019-12-31'], ['dal 2020', '2020-01-01', '9999']].map(([nome, a, b]) => ({ nome, fasce: perFascia(esiti.filter(e => e.d >= a && e.d <= b)) })),
  };
}
// Titoli con meno di 6 anni di barre: stato ricostruito come gli altri se ci sono abbastanza sedute, altrimenti in attesa
// (attesa: 1): il calcolo serale lo avvia quando le barre bastano, senza riportare come nuovi i segnali passati.
function giovani(sim, s) {
  if (sito.has(sim) || !(meta.tv && meta.tv[sim])) return false;
  const vecchio = ext.titoli[sim], nome = (meta.nomi && meta.nomi[sim]) || sim, tv = meta.tv[sim];
  if (vecchio) { nuovoExt[sim] = { ...vecchio, n: nome, tv, ...catDi(sim) }; return true; }
  if (s.d.length > RITARDO + 300) {
    try {
      const r = segnali(s); if (!r || !r.setup) throw 0;
      const st = { q: [], cash: 1e6, fino: '0000' }, m = s.d.length - RITARDO;
      avanza(st, { d: s.d.slice(0, m), c: s.c.slice(0, m) }, { setup: r.setup.slice(0, m), uscita: r.uscita.slice(0, m) });
      nuovoExt[sim] = { ...st, n: nome, tv, ...catDi(sim) }; return true;
    } catch { /* si riprova come titolo in attesa */ }
  }
  nuovoExt[sim] = { q: [], cash: 1e6, fino: '0000', attesa: 1, n: nome, tv, ...catDi(sim) }; return true;
}
for (const sim of Object.keys((meta.giovani) || {})) if (!nuovoExt[sim]) {
  // titoli senza barre scaricate (quotati da pochi giorni) o con meno di 320 sedute: non sono nei file daily
  if (!(meta.tv && meta.tv[sim]) || sito.has(sim)) continue;
  const vecchio = ext.titoli[sim];
  nuovoExt[sim] = vecchio ? { ...vecchio, n: (meta.nomi && meta.nomi[sim]) || vecchio.n || sim, tv: meta.tv[sim] }
    : { q: [], cash: 1e6, fino: '0000', attesa: 1, n: (meta.nomi && meta.nomi[sim]) || sim, tv: meta.tv[sim] };
}
// Convergenze: i "Compra" della strategia dati quando il prezzo era sotto il fair value pavimento di allora (ultima
// fine trimestre prima del segnale, storico ricalcolato con i dati disponibili allora) contro quelli dati sopra
{
  const leggiR = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };
  const H = leggiR('fv_history.json'), HX = leggiR('fv_history_ext.json'), dbS = (leggiR('data.json') || {}).db || {}, fx = (leggiR('fv_ext.json') || {}).titoli || {};
  const storia = {};
  for (const [t, e] of Object.entries(dbS)) if (H && H.titoli[t]) storia[e.yf || t] = { s: H.titoli[t], date: H.date };
  for (const [t, e] of Object.entries(fx)) if (HX && HX.titoli[t] && e.yf && !storia[e.yf]) storia[e.yf] = { s: HX.titoli[t], date: HX.date };
  const pc = x => Math.round(x * 1000) / 10;
  const mediana = a => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const gruppi = { sotto: [], sopra: [] };
  for (const [sim, P] of Object.entries(prec)) {
    const S = storia[sim]; if (!S) continue;
    const ultimo = S.date.length - 1;                                    // l'ultimo punto è "oggi": si escludono
    for (const a of P.acquisti) {
      if (a.r[2] == null) continue;
      let j = -1; for (let i = 0; i < ultimo; i++) if (S.date[i] < a.d) j = i;
      const f = j >= 0 ? S.s.fv[j] : null, p = j >= 0 ? S.s.p[j] : null;
      if (!(f > 0 && p > 0) || p / f > 20 || p / f < 0.05) continue;
      gruppi[p < f ? 'sotto' : 'sopra'].push(a.r[2]);
    }
  }
  const mis = a => a.length >= 50 ? { casi: a.length, p12: pc(a.filter(x => x > 0).length / a.length), m12: pc(mediana(a)) } : { casi: a.length };
  st.convergenze = { nota: 'Compra TBO dal 2021 con il prezzo sotto o sopra il fair value pavimento dell\'ultima fine trimestre precedente', sotto_fv: mis(gruppi.sotto), sopra_fv: mis(gruppi.sopra) };
  console.log('Convergenze TBO + fair value:', JSON.stringify(st.convergenze));
}
if (Object.keys(nuovoExt).length > 300) {
  fs.writeFileSync(STATO_EXT, JSON.stringify({ aggiornato: new Date().toISOString(), origine: 'ricostruito dalla storia scaricata (14 anni)', titoli: nuovoExt }) + '\n');
  console.log(`Titoli aggiunti ai segnali giornalieri: ${Object.keys(nuovoExt).length} (nuovi: ${Object.keys(nuovoExt).filter(k => !ext.titoli[k]).length})`);
}
fs.writeFileSync(path.join(ROOT, 'tbo_stats.json'), JSON.stringify({ aggiornato: new Date().toISOString(), ...st }) + '\n');
st.scartati = scartati;
console.log(`Track record TBO: ${scartati} titoli scartati per barre sospette; ${per.length} titoli dal ${dal} al ${al}; gruppi: ${st.gruppi.map(g => g.nome + ' ' + g.titoli).join(', ')}`);
