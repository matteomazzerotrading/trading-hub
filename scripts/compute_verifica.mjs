// compute_verifica.mjs — "Il mio modello sotto esame" (verifica_fv.json): il fair value ha funzionato?
//
// Materiale: lo storico trimestrale del fair value pavimento (fv_history.json e fv_history_ext.json), ricalcolato a
// ogni fine trimestre con i soli dati disponibili allora (bilanci già pubblicati, prezzi, tassi di allora), e i prezzi
// delle stesse date. Per ogni titolo e trimestre si guarda dove stava il prezzo rispetto al fair value e quanto ha reso
// il titolo nei 4 trimestri successivi (8 per i 24 mesi). Per togliere l'effetto del mercato, ogni rendimento si
// confronta anche con la mediana di tutti i titoli nello stesso trimestre ("rendimento in eccesso").
// Limiti: prezzi senza dividendi; solo società quotate oggi (quelle fallite o tolte dai listini non ci sono).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const leggi = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };
const H = leggi('fv_history.json'), HX = leggi('fv_history_ext.json'), db = (leggi('data.json') || {}).db || {};
if (!H || !H.date) { console.log('Storico del fair value non disponibile.'); process.exit(0); }

// Fasce del prezzo rispetto al fair value pavimento (rapporto prezzo / FV)
const FASCE = [
  { k: 'molto_sotto', nome: 'oltre il 30% sotto il fair value', da: 0, a: 0.7 },
  { k: 'sotto', nome: 'fino al 30% sotto il fair value', da: 0.7, a: 1 },
  { k: 'poco_sopra', nome: 'fino al 50% sopra', da: 1, a: 1.5 },
  { k: 'sopra', nome: 'dal 50% al doppio del fair value', da: 1.5, a: 2.5 },
  { k: 'molto_sopra', nome: 'oltre due volte e mezzo il fair value', da: 2.5, a: Infinity },
];
const fascia = q => FASCE.find(f => q >= f.da && q < f.a);
const mediana = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const pc = x => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 10);
const mercatoDi = (t, ext) => { const e = ext ? null : db[t]; const ex = e ? e.ex : null; if (ex === 'MIL') return 'it'; if (ex && !['NYSE', 'NASDAQ', 'AMEX'].includes(ex)) return 'eu'; if (!e && t.includes('.') && !t.endsWith('.US')) return t.endsWith('.MI') ? 'it' : 'eu'; return 'us'; };

// osservazioni: titolo, trimestre, rapporto prezzo/FV, rendimento a 12 e 24 mesi
const date = H.date.slice(0, -1);                     // l'ultimo punto è "oggi", non una fine trimestre
const oss = [];
for (const [src, ext] of [[H, false], [HX, true]]) {
  if (!src || !src.titoli) continue;
  for (const [t, s] of Object.entries(src.titoli)) {
    if (ext && db[t]) continue;
    // titoli con dati incoerenti (es. frazionamenti non allineati tra prezzo e fair value): il rapporto salta di
    // oltre 5 volte da un trimestre all'altro → si scarta tutto il titolo
    let salto = false, prec = null;
    for (let i = 0; i < date.length; i++) { const f = s.fv[i], p = s.p[i]; if (f > 0 && p > 0) { const q = p / f; if (prec && (q / prec > 5 || prec / q > 5)) salto = true; prec = q; } }
    if (salto) continue;
    for (let i = 0; i < date.length; i++) {
      const f = s.fv[i], p = s.p[i];
      if (!(f > 0 && p > 0)) continue;
      const q = p / f; if (q < 0.05 || q > 20) continue;
      const p4 = i + 4 < date.length ? s.p[i + 4] : null, p8 = i + 8 < date.length ? s.p[i + 8] : null;   // solo fine trimestre, non "oggi"
      oss.push({ t, i, q, f: fascia(q).k, r12: p4 > 0 ? p4 / p - 1 : null, r24: p8 > 0 ? p8 / p - 1 : null, m: mercatoDi(t, ext) });
    }
  }
}
// mediana di tutti i titoli trimestre per trimestre, per il rendimento in eccesso
const medTrim = {};
for (const h of ['r12', 'r24']) { medTrim[h] = {}; for (let i = 0; i < date.length; i++) medTrim[h][i] = mediana(oss.filter(o => o.i === i && o[h] != null).map(o => o[h])); }
for (const o of oss) { o.x12 = o.r12 != null ? o.r12 - medTrim.r12[o.i] : null; o.x24 = o.r24 != null ? o.r24 - medTrim.r24[o.i] : null; }

const misura = g => {
  const a = g.filter(o => o.r12 != null), b = g.filter(o => o.r24 != null);
  return { casi: a.length, titoli: new Set(a.map(o => o.t)).size, p12: pc(a.filter(o => o.r12 > 0).length / (a.length || 1)), m12: pc(mediana(a.map(o => o.r12))),
    x12: pc(mediana(a.map(o => o.x12))), batte12: pc(a.filter(o => o.x12 > 0).length / (a.length || 1)), casi24: b.length, m24: pc(mediana(b.map(o => o.r24))), x24: pc(mediana(b.map(o => o.x24))) };
};
const fasce = FASCE.map(f => ({ k: f.k, nome: f.nome, ...misura(oss.filter(o => o.f === f.k)) }));
// trimestre per trimestre: i titoli sotto il fair value hanno battuto quelli sopra?
const perTrim = [];
for (let i = 0; i < date.length; i++) {
  const sotto = oss.filter(o => o.i === i && o.q < 1 && o.r12 != null), sopra = oss.filter(o => o.i === i && o.q >= 1.5 && o.r12 != null);
  if (sotto.length >= 20 && sopra.length >= 20) perTrim.push({ data: date[i], sotto: pc(mediana(sotto.map(o => o.r12))), sopra: pc(mediana(sopra.map(o => o.r12))), n_sotto: sotto.length, n_sopra: sopra.length });
}
const perMercato = ['us', 'eu', 'it'].map(m => ({ m, sotto: misura(oss.filter(o => o.m === m && o.q < 1)), sopra: misura(oss.filter(o => o.m === m && o.q >= 1.5)) }));

// titolo per titolo: com'è andata quando il prezzo era sotto il fair value e quando era sopra
const titoli = {};
for (const t of new Set(oss.map(o => o.t))) {
  const mie = oss.filter(o => o.t === t && o.r12 != null), s = mie.filter(o => o.q < 1), o = mie.filter(o => o.q >= 1);
  if (mie.length < 4) continue;
  titoli[t] = { n: mie.length, s: s.length, sm: pc(mediana(s.map(x => x.r12))), sx: pc(mediana(s.map(x => x.x12))), sb: s.length ? Math.round(s.filter(x => x.x12 > 0).length / s.length * 100) : null,
    o: o.length, om: pc(mediana(o.map(x => x.r12))), ox: pc(mediana(o.map(x => x.x12))) };
}
const out = { aggiornato: new Date().toISOString(), dal: date[0], al: date[Math.max(0, date.length - 5)], osservazioni: oss.filter(o => o.r12 != null).length,
  titoli_n: new Set(oss.map(o => o.t)).size, tutti: misura(oss), fasce, per_trimestre: perTrim, per_mercato: perMercato, titoli,
  nota: 'p12 = % in guadagno dopo 12 mesi; m12 = rendimento mediano; x12 = rendimento in eccesso mediano sulla mediana di tutti i titoli dello stesso trimestre; batte12 = % di casi sopra quella mediana. Per titolo: s/o = trimestri sotto/sopra il fair value, sm/om = rendimento mediano a 12 mesi, sx/ox = in eccesso, sb = % di casi che battono la mediana.' };
fs.writeFileSync(path.join(ROOT, 'verifica_fv.json'), JSON.stringify(out) + '\n');
console.log(`Verifica del modello: ${out.osservazioni} osservazioni su ${out.titoli_n} titoli dal ${out.dal}; ` + fasce.map(f => `${f.k} ${f.m12}% (ecc. ${f.x12}%, n=${f.casi})`).join(' · '));
