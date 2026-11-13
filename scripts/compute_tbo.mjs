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

// Storico delle operazioni di un titolo: la strategia parte senza posizioni dalla prima seduta disponibile e si
// applicano le stesse impostazioni. Come nell'elenco delle operazioni di TradingView, ogni vendita chiude uno o più
// acquisti (dal più vecchio) e ogni coppia acquisto-vendita è un'operazione. Restituisce le operazioni chiuse
// { da, a, r (rendimento), usd } e gli acquisti ancora aperti { da, r } valutati all'ultima chiusura.
export function storicoOperazioni(s, r, capitale = 1e6) {
  let cash = capitale; const lotti = [], chiuse = [];
  for (let i = 0; i < s.d.length; i++) {
    const C = s.c[i], Q = lotti.reduce((a, b) => a + b.n, 0);
    if (r.setup[i] && lotti.length < IMP.MAX_ACQUISTI) {
      const n = Math.floor(IMP.QUOTA * (cash + Q * C) / C);
      if (n >= 1 && n * C <= cash) { lotti.push({ n, p: C, d: s.d[i] }); cash -= n * C + IMP.COMMISSIONE; }
    } else if (r.uscita[i] && Q > 0) {
      let vendi = Math.max(1, Math.floor(IMP.CHIUSURA * Q));
      cash += vendi * C - IMP.COMMISSIONE;
      while (vendi > 0 && lotti.length) {
        const L = lotti[0], t = Math.min(vendi, L.n);
        chiuse.push({ da: L.d, a: s.d[i], r: C / L.p - 1, usd: t * (C - L.p) });
        L.n -= t; vendi -= t; if (L.n === 0) lotti.shift();
      }
    }
  }
  const ult = s.c.at(-1);
  return { chiuse, aperte: lotti.map(L => ({ da: L.d, r: ult / L.p - 1 })) };
}

// Termine di paragone: comprare in un giorno qualsiasi e tenere per `sedute` sedute, sugli stessi titoli.
// Dice quanta parte del risultato viene dal mercato (e dalla scelta di titoli che oggi sono in elenco).
export function confronto(serie, sedute) {
  let n = 0, pos = 0; const camp = [];
  for (const s of serie) for (let i = 0; i + sedute < s.c.length; i += 5) {      // un acquisto ogni 5 sedute
    const r = s.c[i + sedute] / s.c[i] - 1; n++; if (r > 0) pos++; camp.push(r);
  }
  camp.sort((a, b) => a - b);
  return n ? { sedute, acquisti: n, positivi_pct: Math.round(pos / n * 1000) / 10, rendimento_mediano_pct: Math.round(camp[camp.length >> 1] * 1000) / 10 } : null;
}

// La domanda che conta: i segnali individuano momenti migliori degli altri? Per ogni orizzonte si confronta il
// rendimento dopo una condizione di acquisto (o di uscita) con quello di un giorno qualsiasi sugli stessi titoli,
// e la strategia completa con il semplice "compra e tieni" titolo per titolo. S = [{ s: barre, r: segnali }].
export function efficacia(S) {
  const media = a => a.reduce((x, y) => x + y, 0) / a.length, mediana = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
  const pc = x => Math.round(x * 1000) / 10, INIZIO = 260;
  const orizzonti = [[21, 1], [63, 3], [126, 6], [252, 12]].map(([h, mesi]) => {
    const g = { q: [0, 0, 0], c: [0, 0, 0], u: [0, 0, 0] };            // somma, positivi, numero
    for (const { s, r } of S) for (let i = INIZIO; i + h < s.c.length; i++) {
      const y = s.c[i + h] / s.c[i] - 1;
      for (const k of ['q', r.setup[i] ? 'c' : null, r.uscita[i] ? 'u' : null]) if (k) { g[k][0] += y; if (y > 0) g[k][1]++; g[k][2]++; }
    }
    const f = x => (x[2] ? { media_pct: pc(x[0] / x[2]), positivi_pct: pc(x[1] / x[2]), casi: x[2] } : null);
    return { sedute: h, mesi, qualsiasi: f(g.q), acquisto: f(g.c), uscita: f(g.u) };
  });
  // Strategia completa contro "compra e tieni" (solo titoli con almeno 12 anni di barre)
  const righe = [], giorni = new Map();          // giorni: data -> [somma rend. strategia, somma rend. compra e tieni, titoli]
  for (const { s, r } of S) {
    const n = s.c.length; if (n < 3000) continue;
    let cash = 1e6, picco = 1e6, dd = 0, espo = 0, bp = s.c[INIZIO], bdd = 0, k = 0, eqPrima = 1e6; const lotti = [];
    for (let i = INIZIO; i < n; i++) {
      const C = s.c[i], Q = lotti.reduce((a, b) => a + b, 0);
      if (r.setup[i] && lotti.length < IMP.MAX_ACQUISTI) { const m = Math.floor(IMP.QUOTA * (cash + Q * C) / C); if (m >= 1 && m * C <= cash) { lotti.push(m); cash -= m * C; } }
      else if (r.uscita[i] && Q > 0) { let v = Math.max(1, Math.floor(IMP.CHIUSURA * Q)); cash += v * C; while (v > 0 && lotti.length) { const t = Math.min(v, lotti[0]); lotti[0] -= t; v -= t; if (!lotti[0]) lotti.shift(); } }
      const q = lotti.reduce((a, b) => a + b, 0), eq = cash + q * C;
      espo += q * C / eq; k++;
      if (i > INIZIO) { const g = giorni.get(s.d[i]) || [0, 0, 0]; g[0] += eq / eqPrima - 1; g[1] += C / s.c[i - 1] - 1; g[2]++; giorni.set(s.d[i], g); }
      eqPrima = eq;
      if (eq > picco) picco = eq; dd = Math.min(dd, eq / picco - 1);
      if (C > bp) bp = C; bdd = Math.min(bdd, C / bp - 1);
    }
    const anni = k / 252, fin = cash + lotti.reduce((a, b) => a + b, 0) * s.c[n - 1];
    righe.push({ st: Math.pow(fin / 1e6, 1 / anni) - 1, bh: Math.pow(s.c[n - 1] / s.c[INIZIO], 1 / anni) - 1, espo: espo / k, dd, bdd });
  }
  const tieni = righe.length > 20 ? { titoli: righe.length, strategia_annuo_pct: pc(mediana(righe.map(x => x.st))), tieni_annuo_pct: pc(mediana(righe.map(x => x.bh))),
    investito_pct: pc(mediana(righe.map(x => x.espo))), ribasso_strategia_pct: pc(mediana(righe.map(x => x.dd))), ribasso_tieni_pct: pc(mediana(righe.map(x => x.bdd))),
    meglio_pct: pc(righe.filter(x => x.st > x.bh).length / righe.length) } : null;
  // Come portafoglio: tutti i titoli con lo stesso peso, la strategia su ciascuno contro il compra e tieni
  const date = [...giorni.keys()].sort().filter(d => giorni.get(d)[2] >= 50);
  const misura = (dal, k) => {
    let v = 1, picco = 1, dd = 0, n = 0, somma = 0, quad = 0;
    for (const d of date) { if (d < dal) continue; const g = giorni.get(d), x = g[k] / g[2]; v *= 1 + x; n++; somma += x; quad += x * x; if (v > picco) picco = v; dd = Math.min(dd, v / picco - 1); }
    if (n < 252) return null;
    const mu = somma / n, sd = Math.sqrt(quad / n - mu * mu);
    return { annuo_pct: pc(Math.pow(v, 252 / n) - 1), ribasso_pct: pc(dd), volatilita_pct: pc(sd * Math.sqrt(252)) };
  };
  const portafoglio = date.length > 500 ? [['dall\'inizio', date[0]], ['dal 2020', '2020-01-01']].map(([nome, dal]) => ({ nome, dal: dal < date[0] ? date[0] : dal, strategia: misura(dal, 0), tieni: misura(dal, 1) })).filter(x => x.strategia) : [];
  return { orizzonti, tieni, portafoglio };
}

// Statistiche d'insieme su tutti i titoli (tbo_stats.json)
export function statistiche(perTitolo, dal, al) {
  const ch = perTitolo.flatMap(x => x.chiuse), ap = perTitolo.flatMap(x => x.aperte);
  const media = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const mediana = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const giorni = o => (new Date(o.a) - new Date(o.da)) / 86400000;
  const pc = x => (x == null ? null : Math.round(x * 1000) / 10);
  const blocco = ops => {
    const v = ops.filter(o => o.r > 0), p = ops.filter(o => o.r <= 0);
    const gv = v.reduce((a, o) => a + o.usd, 0), gp = -p.reduce((a, o) => a + o.usd, 0);
    return { operazioni: ops.length, vincenti_pct: pc(ops.length ? v.length / ops.length : null), guadagno_medio_pct: pc(media(v.map(o => o.r))),
      perdita_media_pct: pc(media(p.map(o => o.r))), rapporto: v.length && p.length ? Math.round(media(v.map(o => o.r)) / -media(p.map(o => o.r)) * 100) / 100 : null,
      fattore_profitto: gp > 0 ? Math.round(gv / gp * 100) / 100 : null, rendimento_mediano_pct: pc(mediana(ops.map(o => o.r))),
      durata_mediana_giorni: ops.length ? Math.round(mediana(ops.map(giorni))) : null };
  };
  const anni = {};
  for (const o of ch) (anni[o.a.slice(0, 4)] = anni[o.a.slice(0, 4)] || []).push(o);
  return { dal, al, titoli: perTitolo.length, titoli_con_operazioni: perTitolo.filter(x => x.chiuse.length).length, chiuse: blocco(ch),
    per_anno: Object.keys(anni).sort().map(y => ({ anno: +y, operazioni: anni[y].length, vincenti_pct: pc(anni[y].filter(o => o.r > 0).length / anni[y].length), rendimento_mediano_pct: pc(mediana(anni[y].map(o => o.r))) })),
    aperte: { acquisti: ap.length, in_perdita_pct: pc(ap.length ? ap.filter(o => o.r < 0).length / ap.length : null), rendimento_medio_pct: pc(media(ap.map(o => o.r))),
      rendimento_mediano_pct: pc(mediana(ap.map(o => o.r))), peggiore_pct: pc(ap.length ? Math.min(...ap.map(o => o.r)) : null) } };
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

  // Il track record (tbo_stats.json) si calcola a parte, su un campione più largo: scripts/compute_tbo_stats.mjs

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
