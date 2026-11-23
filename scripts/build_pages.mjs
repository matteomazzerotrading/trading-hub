// build_pages.mjs — genera una pagina statica per ogni titolo (titoli/<ticker>.html), l'indice
// titoli/index.html e sitemap.xml, a partire da data.json. Le pagine servono ai motori di ricerca:
// la home mostra i dati solo dopo il caricamento, queste invece contengono già testo e numeri.
// Eseguito da GitHub Actions dopo compute_fv.mjs. Node 20+, nessuna dipendenza.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('./fv_engine.js');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = 'https://matteomazzerotrading.github.io/trading-hub/';
const OUT = path.join(ROOT, 'titoli');

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const db = data.db;
const leggiSe = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { return null; } };
// Società americane ed europee che non seguo personalmente (fv_ext.json): stessa pagina, con un avviso
const ext = (leggiSe('fv_ext.json') || {}).titoli || {};
// verifica del modello titolo per titolo (scripts/compute_verifica.mjs)
const VER = leggiSe('verifica_fv.json') || {};
// nome del bot Telegram (scritto dal workflow del bot): ogni pagina ha il link per ricevere gli avvisi su quel titolo
const BOT = (leggiSe('telegram_bot.json') || {}).username || null;
for (const t of Object.keys(ext)) if (db[t]) delete ext[t];
const tutti = { ...db, ...ext };
// Storico del fair value rispetto al prezzo (fv_history.json e fv_history_ext.json)
const storici = [leggiSe('fv_history.json'), leggiSe('fv_history_ext.json')].filter(Boolean);
const storicoDi = t => { for (const h of storici) if (h.titoli && h.titoli[t]) return { date: h.date, ...h.titoli[t] }; return null; };
let held = new Set();
try { held = new Set((JSON.parse(fs.readFileSync(path.join(ROOT, 'portfolio.json'), 'utf8')).positions || []).map(p => p.ticker)); } catch (e) {}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const num = x => x == null ? '—' : Number(x).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const pc = x => x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toLocaleString('it-IT', { maximumFractionDigits: 0 }) + '%';
const dataIt = iso => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
const sigle = s => s.replace(/\bfcf\b/gi, 'FCF').replace(/\bfv\b/gi, 'FV');
const minuscolo = s => sigle(s.charAt(0) + s.slice(1).toLowerCase());      // "Sottovalutata"
const basso = s => sigle(s.toLowerCase());                                   // "sottovalutata"
const cap = m => !m || m === 'N/D' ? '—' : /T$/.test(m) ? Math.round(parseFloat(m) * 1000).toLocaleString('it-IT', { useGrouping: 'always' }) + ' mld'
  : /B$/.test(m) ? parseFloat(m).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' mld' : /M$/.test(m) ? parseFloat(m).toLocaleString('it-IT') + ' mln' : m;

const CSS = `
:root{--bg:#0B1520;--card:rgba(22,37,53,.62);--bd:rgba(148,178,209,.14);--tx:#E9EEF3;--mu:#93A4B6;--gr:#4CC38A;--oro:#D9AE57;--oro2:#F0C978;--ink:#13202B;--disp:'Bricolage Grotesque','IBM Plex Sans',system-ui,sans-serif}
*{box-sizing:border-box}html{background:#0B1520}
body{margin:0;color:var(--tx);font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.65;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;min-height:100vh;
background:radial-gradient(60vw 45vw at 0% -10%,rgba(217,174,87,.13),transparent 70%),radial-gradient(60vw 55vw at 100% 0%,rgba(52,108,172,.32),transparent 70%),linear-gradient(180deg,#102031 0%,#0B1520 50%,#08111A 100%) fixed}
a{color:var(--oro)}a:hover{color:var(--oro2)}
.wrap{max-width:900px;margin:0 auto;padding:0 22px 64px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;font-size:.92em;padding:18px 0;margin-bottom:40px;border-bottom:1px solid var(--bd)}
.top nav{display:flex;gap:18px;flex-wrap:wrap}.top nav a{color:#C3CEDA;text-decoration:none}.top nav a:hover{color:#fff}
.logo{display:inline-flex;align-items:center;gap:10px;font-family:var(--disp);font-weight:700;color:#F2F5F8;font-size:1.12em;text-decoration:none}
h1{font-family:var(--disp);color:#F4F6F9;font-size:clamp(2rem,5vw,3rem);font-weight:800;line-height:1.05;margin:0 0 12px;letter-spacing:-.03em}
h2{font-family:var(--disp);color:#F2F5F8;font-size:1.45em;font-weight:700;letter-spacing:-.015em;margin:52px 0 12px;padding-top:28px;border-top:1px solid var(--bd)}
p{max-width:72ch}
.mu{color:var(--mu);font-size:.95em}
.badge{display:inline-block;padding:4px 12px;border-radius:8px;font-weight:600;font-size:.95em;margin-top:4px}
.card{background:linear-gradient(180deg,rgba(30,49,70,.6),rgba(17,30,44,.6));border:1px solid var(--bd);border-radius:16px;padding:20px 22px;margin-top:18px;box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-top:26px;border-top:1px solid var(--bd)}
.box{padding:18px 20px 18px 0;border-bottom:1px solid var(--bd)}
.box .l{font-size:.86em;color:var(--mu)}
.box .v{font-family:var(--disp);font-size:1.5em;font-weight:700;color:#F4F6F9;margin-top:2px;letter-spacing:-.01em}
.box .s{font-size:.82em;color:var(--mu);margin-top:2px}
ul{padding-left:20px;margin:8px 0}.warn li{color:#E8B04A}
.dia{margin-top:22px;background:linear-gradient(180deg,rgba(30,49,70,.5),rgba(17,30,44,.5));border:1px solid var(--bd);border-radius:16px;padding:16px 12px 8px}.dia svg{width:100%;height:auto;display:block;font-family:'IBM Plex Sans',sans-serif}.dia-n{display:none}@media(max-width:600px){.dia-w{display:none}.dia-n{display:block}}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.chips a{border:1px solid var(--bd);border-radius:999px;padding:6px 14px;font-size:.88em;background:rgba(20,34,49,.6);color:#C3CEDA;text-decoration:none}.chips a:hover{border-color:rgba(217,174,87,.5);color:#fff}
.aff{display:inline-block;padding:3px 10px;border-radius:7px;font-size:.82em;font-weight:600;margin-left:8px;vertical-align:middle}
.cta{display:inline-block;margin-top:26px;background:linear-gradient(180deg,#E4BD6C,#C99A42);color:var(--ink);font-weight:600;padding:13px 24px;border-radius:999px;text-decoration:none;box-shadow:0 8px 22px -10px rgba(217,174,87,.8)}
.cta:hover{color:var(--ink);filter:brightness(1.06)}
.held{display:inline-block;font-family:'IBM Plex Sans',sans-serif;font-size:.36em;font-weight:500;letter-spacing:0;color:#C3CEDA;background:rgba(148,178,209,.1);border:1px solid rgba(148,178,209,.25);border-radius:7px;padding:3px 9px;margin-left:12px;vertical-align:middle}
table{width:100%;border-collapse:collapse;font-size:.94em}th,td{padding:11px 10px;text-align:left;border-top:1px solid var(--bd)}th{color:var(--mu);font-size:.84em;font-weight:500;border-top:none}
tbody tr:hover{background:linear-gradient(90deg,rgba(217,174,87,.07),transparent 70%)}
td.n{text-align:right;white-space:nowrap}th.n{text-align:right}
.tw{overflow-x:auto}
footer{margin-top:64px;padding-top:20px;border-top:1px solid var(--bd);color:var(--mu);font-size:.86em}
@media(max-width:600px){.box{padding-right:10px}.top nav{gap:12px}}
`.trim();

const head = (title, desc, url, extra = '') => `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="author" content="Matteo Mazzero">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#0B1520">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="manifest" href="../manifest.webmanifest">
<link rel="apple-touch-icon" href="../icons/apple-touch-icon-v2.png">
<meta property="og:type" content="article">
<meta property="og:locale" content="it_IT">
<meta property="og:site_name" content="Matteo Mazzero | Trading Hub">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}og-image.png">
<meta name="twitter:card" content="summary_large_image">${extra}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header class="top"><a class="logo" href="../" aria-label="Matteo Mazzero, Trading Hub"><img src="../favicon.svg" alt="" width="30" height="30" style="display:block;border-radius:8px"><span>Matteo Mazzero</span></a><nav aria-label="Sezioni"><a href="../#oggi">Oggi</a><a href="../#analizza">Analizza</a><a href="./">Tutti i fair value</a><a href="../#faq">Come leggere i valori</a></nav></header>
`;

const foot = `
<footer>
<p>Matteo Mazzero Trading © ${new Date().getFullYear()} · Analisi a scopo didattico: i valori sono il risultato di un modello e non costituiscono consulenza finanziaria né una raccomandazione di acquisto o vendita. Posso avere posizioni aperte sui titoli analizzati; quelli che possiedo sono indicati.</p>
<p><a href="../disclaimer.html">Disclaimer</a> · <a href="../privacy.html">Privacy</a> · <a href="../">Torna al Trading Hub</a></p>
</footer>
</div>
</body>
</html>
`;

const AFF = { alta: ['#4CC38A', 'Affidabilità della stima: alta'], media: ['#E8B04A', 'Affidabilità della stima: media'], bassa: ['#E8873A', 'Affidabilità della stima: bassa'] };

// Diagramma: prezzo e fair value sulla stessa scala
function svgUno(d, close, W, righe) {
  const H = 96 + righe * 19, L = 20, R = 20, y = 62;
  const punti = [['Prezzo', close, '#F4F6F9'], ['FV pavimento', d.fv, '#F0C978'], ['FV mercato', d.fv_mkt, '#9DBBF5'], ['FV storico', d.fv_sto > 0 ? d.fv_sto : null, '#C3A6F0']].filter(p => p[1] > 0);
  const max = Math.max(...punti.map(p => p[1]), d.fv_high || 0) * 1.08;
  const x = v => L + (W - L - R) * Math.min(1, Math.max(0, v / max));
  const lo = d.fv_low != null ? Math.max(0, d.fv_low) : 0, hi = d.fv_high != null ? d.fv_high : d.fv;
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Prezzo e fair value di ${esc(d.name)} sulla stessa scala"><rect x="${L}" y="${y - 3}" width="${W - L - R}" height="6" rx="3" fill="rgba(148,178,209,.16)"/>`;
  out += `<rect x="${x(lo).toFixed(1)}" y="${y - 12}" width="${Math.max(2, x(hi) - x(lo)).toFixed(1)}" height="24" rx="5" fill="#D9AE57" fill-opacity=".16" stroke="#D9AE57" stroke-opacity=".45"/>`;
  out += `<text x="${((x(lo) + x(hi)) / 2).toFixed(1)}" y="${y - 20}" fill="#93A4B6" font-size="12" text-anchor="middle">banda peggiore – migliore</text>`;
  punti.slice().sort((a, b) => a[1] - b[1]).forEach((p, i) => {
    const px = x(p[1]), ty = y + 34 + (i % righe) * 19, prezzo = p[0] === 'Prezzo';
    const anc = px < 100 ? 'start' : px > W - 100 ? 'end' : 'middle';
    out += prezzo ? `<path d="M${(px - 8).toFixed(1)} ${y - 15}h16l-8 13z" fill="#F4F6F9"/><line x1="${px.toFixed(1)}" y1="${y - 4}" x2="${px.toFixed(1)}" y2="${ty - 13}" stroke="#F4F6F9" stroke-width="2"/>`
                  : `<line x1="${px.toFixed(1)}" y1="${y - 13}" x2="${px.toFixed(1)}" y2="${ty - 13}" stroke="${p[2]}" stroke-width="2.5"/>`;
    out += `<text x="${px.toFixed(1)}" y="${ty}" fill="${p[2]}" font-size="13" font-weight="${prezzo ? 700 : 500}" text-anchor="${anc}">${p[0]} ${num(p[1])}</text>`;
  });
  return out + '</svg>';
}
// Versione larga per computer e stretta per smartphone (scritte leggibili in entrambi i casi)
const svgBanda = (d, close) => `<div class="dia"><div class="dia-w">${svgUno(d, close, 820, 3)}</div><div class="dia-n">${svgUno(d, close, 380, 4)}</div></div>`;

// Frase che descrive dove si trova il prezzo rispetto alle soglie
function frasePosizione(t, d, v, pos, close) {
  const c = d.curr, nome = esc(d.name);
  const p = `<strong>${num(close)} ${c}</strong>`;
  if (pos.zona === 1) return `Al prezzo di ${p}, ${nome} quota sotto anche lo scenario peggiore degli ultimi 10 anni (${num(d.fv_low)} ${c}): il mercato sconta un peggioramento più forte di quanto visto nel decennio.`;
  if (pos.zona === 2) {
    const sopraPav = close > d.fv;
    return `Al prezzo di ${p}, ${nome} quota ${sopraPav ? 'sopra' : 'sotto'} il fair value pavimento (${num(d.fv)} ${c}) e ${d.fv_low != null ? `dentro la banda tra scenario peggiore e migliore (${num(d.fv_low)} – ${num(d.fv_high)} ${c})` : `sotto lo scenario migliore (${num(d.fv_high)} ${c})`}: il mercato la paga all'incirca come un'azienda che non crescerà più in termini reali.`;
  }
  if (pos.zona === 3) return `Al prezzo di ${p}, ${nome} quota sopra la banda a crescita zero ma sotto il fair value di mercato (${num(d.fv_mkt)} ${c}): il prezzo sconta una crescita inferiore a quella di un'azienda media.`;
  if (pos.zona === 4) return `Al prezzo di ${p}, ${nome} quota sopra il fair value di mercato (${num(d.fv_mkt)} ${c}): il prezzo chiede una crescita superiore a quella dell'economia.`;
  return '';
}

// Altri titoli dello stesso settore (prima quelli dello stesso mercato): collegamenti utili a chi legge e ai motori di ricerca
function simili(t, d) {
  if (!d.settore) return '';
  const altri = Object.keys(tutti).filter(x => x !== t && tutti[x].settore === d.settore && tutti[x].price > 0)
    .sort((a, b) => (db[a] ? 0 : 1) - (db[b] ? 0 : 1) || (E.mercato(tutti[a]) === E.mercato(d) ? 0 : 1) - (E.mercato(tutti[b]) === E.mercato(d) ? 0 : 1) || a.localeCompare(b)).slice(0, 10);
  if (!altri.length) return '';
  return `<h2>Altri titoli del settore ${esc(d.settore)}</h2><div class="chips">${altri.map(x => `<a href="${slug(x)}.html">${esc(tutti[x].name)}</a>`).join('')}</div>`;
}

// Grafico statico (SVG) del fair value pavimento e del prezzo a ogni fine trimestre degli ultimi 6 anni
function svgStorico(t, d) {
  const h = storicoDi(t); if (!h) return '';
  const idx = h.fv.map((v, i) => (v != null && h.p[i] != null ? i : -1)).filter(i => i >= 0);
  if (idx.length < 4) return '';
  const i0 = idx[0], date = h.date.slice(i0), fv = h.fv.slice(i0), p = h.p.slice(i0), c = d.curr;
  const val = fv.concat(p).filter(v => v != null);
  let lo = Math.min(...val), hi = Math.max(...val); const m = (hi - lo) * 0.08 || hi * 0.1; lo = Math.max(0, lo - m); hi += m;
  const svg = (W, H) => {
    const L = 46, R = 10, T = 26, B = 24;
    const x = i => L + (W - L - R) * i / (date.length - 1), y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const pt = a => a.map((v, i) => v == null ? '' : x(i).toFixed(1) + ',' + y(v).toFixed(1)).filter(Boolean).join(' ');
    const tick = [0, 0.25, 0.5, 0.75, 1].map(k => lo + (hi - lo) * k);
    const gy = tick.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="rgba(255,255,255,.06)"/><text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" fill="#93A4B6" font-size="11" text-anchor="end">${Number(v.toPrecision(3)).toLocaleString('it-IT', { useGrouping: 'always' })}</text>`).join('');
    let ultimoX = -99;
    const gx = date.map((dd, i) => [dd.slice(0, 4), i]).filter(([a], i, A) => i > 0 && a !== A[i - 1][0])
      .filter(([, i]) => { if (x(i) - ultimoX < 34) return false; ultimoX = x(i); return true; })
      .map(([a, i]) => `<text x="${x(i).toFixed(1)}" y="${H - 7}" fill="#93A4B6" font-size="11" text-anchor="middle">${a}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fair value pavimento e prezzo di ${esc(d.name)} a ogni fine trimestre">${gy}
<polygon fill="rgba(217,174,87,.10)" points="${pt(fv)} ${x(fv.length - 1).toFixed(1)},${y(lo).toFixed(1)} ${x(0).toFixed(1)},${y(lo).toFixed(1)}"/>
<polyline fill="none" stroke="#D9AE57" stroke-width="2.2" stroke-linejoin="round" points="${pt(fv)}"/><polyline fill="none" stroke="#E9EEF3" stroke-width="2" stroke-linejoin="round" points="${pt(p)}"/>${gx}
<g font-size="12"><rect x="${L}" y="7" width="12" height="3" fill="#E9EEF3"/><text x="${L + 17}" y="12" fill="#C3CEDA">Prezzo</text><rect x="${L + 76}" y="7" width="12" height="3" fill="#D9AE57"/><text x="${L + 93}" y="12" fill="#C3CEDA">Fair value pavimento</text></g></svg>`;
  };
  const n = fv.length - 1, dFv = (fv[n] / fv[0] - 1) * 100, dP = (p[n] / p[0] - 1) * 100;
  const lettura = dFv <= 0 ? 'la stima di valore non è cresciuta' + (dP > 0 ? ', mentre il prezzo è salito' : '')
    : dP > dFv ? 'il prezzo è salito più della stima di valore, quindi il titolo è diventato più caro'
    : dP >= 0 ? 'la stima di valore è cresciuta più del prezzo, quindi il titolo è diventato più conveniente' : 'la stima di valore è cresciuta mentre il prezzo scendeva';
  const mese = dd => new Date(dd + 'T12:00:00Z').toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `<h2>Fair value e prezzo negli ultimi 6 anni</h2>
<div class="dia"><div class="dia-w">${svg(820, 260)}</div><div class="dia-n">${svg(380, 240)}</div></div>
<p>Da ${mese(date[0])} il fair value è passato da ${num(fv[0])} a <strong>${num(fv[n])} ${c}</strong> (${pc(dFv)}) e il prezzo da ${num(p[0])} a ${num(p[n])} ${c} (${pc(dP)}): ${lettura}.</p>
<p class="mu">Il fair value è ricalcolato a ogni fine trimestre con i soli dati disponibili allora (bilanci già pubblicati, decennale e inflazione di quel momento); cassa e debito sono noti solo a oggi, quindi l'ultimo punto può staccarsi un po' dalla linea.</p>`;
}

// Cosa sconta il prezzo (DCF inverso) e com'è andato il modello su questo titolo
function scontaProva(t, d, close) {
  const pc1 = x => (x >= 0 ? '+' : '−') + Math.abs(x).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%';
  const r = E.crescitaImplicita(d, close), gh = d.ind && d.ind.g_hist, x = VER.titoli && VER.titoli[t];
  let h = '';
  if (r && !r.fuori) h += `<h2>Cosa sta scontando il prezzo</h2>
<p>Al prezzo di ${num(close)} ${d.curr}, il mercato si aspetta che il free cash flow per azione di ${esc(d.name)} cresca del <strong>${pc1(r.g * 100)} l'anno</strong> per i prossimi 10 anni (poi solo con l'inflazione)${gh != null ? `; negli ultimi ${d.ind.anni || ''} anni i ricavi per azione sono cresciuti del ${pc1(gh * 100)} l'anno, quindi ${r.g < gh - 0.01 ? 'le aspettative sono più basse di quanto l\'azienda ha già fatto' : r.g > gh + 0.01 ? 'il prezzo scommette su un futuro migliore del passato' : 'il prezzo chiede più o meno quanto già fatto'}` : ''}. <a href="../?t=${encodeURIComponent(t)}">Prova altre ipotesi di crescita nella scheda</a></p>`;
  if (x && (x.s >= 2 || x.o >= 2)) h += `<h2>Il mio modello alla prova su questo titolo</h2>
<p>Dal ${dataIt(VER.dal)}, ${[x.s >= 2 ? `nei ${x.s} trimestri in cui il prezzo era sotto il fair value il titolo ha reso nei 12 mesi successivi ${pc1(x.sm)} in mediana (${pc1(x.sx)} rispetto alla mediana di tutti i titoli)` : '', x.o >= 2 ? `nei ${x.o} trimestri sopra il fair value ${pc1(x.om)} (${pc1(x.ox)} rispetto al mercato)` : ''].filter(Boolean).join('; ')}. <a href="../#laboratorio">La verifica su oltre ${Math.floor((VER.titoli_n || 0) / 100) * 100} titoli</a></p>`;
  return h;
}

function paginaTitolo(t, d) {
  const close = Number(d.price), c = d.curr, ind = d.ind || {};
  const v = E.verdict(d, close), pos = E.posizione(d, close), pt = E.potenziale(d, close);
  const ok = ind.status === 'ok' && d.fv != null;
  const fin = E.FINANZIARI.includes(t);
  const aff = E.affidabilita(t, d);
  const agg = dataIt(d.fv_updated);
  const url = `${SITE}titoli/${slug(t)}.html`;
  const title = ok ? `Fair value di ${d.name} (${t}): ${num(d.fv)} ${c} | Matteo Mazzero`
                   : `Fair value di ${d.name} (${t}) | Matteo Mazzero`;
  const desc = ok
    ? `Fair value di ${d.name} (${t}) aggiornato al ${agg}: pavimento ${num(d.fv)} ${c}, fair value di mercato ${num(d.fv_mkt)} ${c}, prezzo ${num(close)} ${c}. Esito del modello: ${basso(v.titolo)}.`
    : `Fair value di ${d.name} (${t}): il modello sul free cash flow non è applicabile a questo titolo. Aggiornato al ${agg}.`;
  const ld = `
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: title, description: desc, url, inLanguage: 'it-IT',
    dateModified: d.fv_updated || undefined, author: { '@type': 'Person', name: 'Matteo Mazzero', url: SITE },
    isPartOf: { '@type': 'WebSite', name: 'Matteo Mazzero | Trading Hub', url: SITE } })}</script>`;

  const box = (l, val, s = '') => `<div class="box"><div class="l">${l}</div><div class="v">${val}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  let corpo = '';
  if (ok) {
    const banda = d.fv_low != null ? `${num(d.fv_low)} – ${num(d.fv_high)}\u00a0${c}` : `fino a ${num(d.fv_high)}\u00a0${c}`;
    corpo += `<div class="grid">
${box('Prezzo', `${num(close)} ${c}`, `al ${agg}`)}
${box('FV pavimento', `${num(d.fv)} ${c}`, 'crescita reale zero')}
${box('Banda', banda, 'anno peggiore – migliore')}
${box('FV di mercato', `${num(d.fv_mkt)} ${c}`, "se cresce come l'economia")}
${box('FV storico', d.fv_sto ? `${num(d.fv_sto)} ${c}` : '—', 'ai multipli medi di 10 anni')}
${box('Potenziale', pc(pt.pot), pt.rif ? `sul FV ${pt.rif} · ${pc(pt.potMkt)} sul FV di mercato` : '')}
</div>
${svgBanda(d, close)}
${svgStorico(t, d)}
${scontaProva(t, d, close)}
<h2>Come leggere il risultato</h2>
<p>${frasePosizione(t, d, v, pos, close)}</p>
<p>Esito del modello: <strong style="color:${v.colore}">${esc(basso(v.titolo))}</strong>${v.sotto ? ` (${esc(v.sotto)})` : ''}. ${pt.pot != null ? `Per arrivare al più basso tra fair value pavimento e storico (${num(pt.fvRif)} ${c}) il prezzo dovrebbe ${pt.pot >= 0 ? 'salire' : 'scendere'} del ${Math.abs(pt.pot).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%.` : ''}</p>`;
    const cat = E.categoria(v.key);
    if (pt.pot != null && ((cat === 'sotto' && pt.pot < 0) || (cat === 'sopra' && pt.pot > 0)))
      corpo += `<p class="mu">Le due letture qui non coincidono: l'esito guarda ai tassi di oggi (la banda a crescita zero), il potenziale tiene conto anche di come il mercato ha prezzato il titolo negli ultimi 10 anni (fair value storico). Quando divergono, la valutazione è meno netta.</p>`;
    const det = v.dettagli.filter(x => x.startsWith('crescita') || x.startsWith('ROIC'));
    if (det.length) corpo += `<p class="mu">${det.map(esc).join(' · ')}. La crescita scontata è quella che il prezzo di oggi dà per acquisita; la storica è quella dei ricavi per azione realizzata negli ultimi anni.</p>`;
    corpo += `<h2>Quanto è affidabile questa stima</h2><p>Affidabilità <strong style="color:${AFF[aff.livello][0]}">${aff.livello}</strong>. ${aff.motivi.length
      ? 'Elementi che rendono il modello meno adatto a questo titolo:' : 'Non ci sono elementi che rendono il modello poco adatto a questo titolo: flussi di cassa regolari, debito contenuto e margini in linea con la storia.'}</p>`;
    if (aff.motivi.length) corpo += `<ul class="warn">${aff.motivi.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
<p class="mu">Il modello parte dal margine di free cash flow tipico degli ultimi 10 anni e non sottrae il debito (gli interessi sono già nei flussi): più elementi compaiono qui, più il fair value va letto con cautela.</p>`;
    corpo += `<h2>Dati di base</h2><div class="grid">
${box('Rendimento richiesto (Ke)', ind.ke != null ? (ind.ke * 100).toFixed(1).replace('.', ',') + '%' : '—', `beta ${ind.beta != null ? String(ind.beta).replace('.', ',') : '—'}`)}
${box('Decennale', ind.rf != null ? (ind.rf * 100).toFixed(2).replace('.', ',') + '%' : '—', `${(E.PAESI[ind.paese] || E.PAESI.US).rfNome} · inflazione attesa ${ind.pi != null ? (ind.pi * 100).toFixed(1).replace('.', ',') + '%' : '—'}`)}
${box('FCF normalizzato', ind.fcf_norm != null ? `${num(ind.fcf_norm)} ${c}` : '—', 'per azione')}
${box('Cassa netta', ind.cassa_az != null ? `${num(ind.cassa_az)} ${c}` : '—', 'per azione, se supera il debito')}
${box('Dividendo', d.divYield > 0 ? num(d.divYield) + '%' : '—', 'rendimento annuo')}
${box('P/E', d.fund && d.fund.pe && d.fund.pe !== 'N/D' ? String(d.fund.pe).replace('.', ',') : '—', 'ultimi 12 mesi')}
${box('Capitalizzazione', cap(d.fund && d.fund.mcap), d.curr)}
</div>`;
  } else {
    corpo += `<div class="card"><strong style="color:#F4F6F9">${esc(minuscolo(v.titolo))}</strong>${v.sotto ? `: ${esc(v.sotto)}` : ''}.<br>
Per ${esc(d.name)} il modello non produce un fair value: ${ind.status === 'fcf_negativo' ? 'il free cash flow normalizzato degli ultimi 10 anni è negativo' : 'i dati di bilancio disponibili non sono sufficienti'}. Prezzo al ${agg}: ${num(close)} ${c}.</div>`;
  }

  return head(title, desc, url, ld) + `<h1>Fair value di ${esc(d.name)} (${esc(t)})${held.has(t) ? '<span class="held">nel mio portafoglio</span>' : ''}</h1>
<p class="mu">${d.settore ? esc(d.settore) + ' · ' : ''}${{ it: 'Borsa Italiana', eu: 'Europa', us: 'Stati Uniti' }[E.mercato(d)]} · aggiornato al ${agg} · calcolato con il mio indicatore FAIR VALUE (dati realizzati) su TradingView${d.earn_next ? ` · prossima trimestrale: ${dataIt(d.earn_next)}` : ''}</p>
${ext[t] ? `<p class="card mu" style="margin-top:10px">Non è tra i titoli che seguo personalmente: è una delle società americane ed europee (indici S&amp;P 500, 400 e 600 e le altre con almeno 2 miliardi di capitalizzazione) per cui calcolo ogni giorno fair value e segnali della mia strategia con lo stesso metodo. <a href="altri.html">Tutti gli altri titoli</a></p>${ext[t].giovane ? `<p class="card mu" style="margin-top:10px">Quotata da poco: la storia dei prezzi e dei bilanci è ancora breve, quindi il fair value può mancare o essere poco affidabile. I segnali della strategia TBO partono quando ci sono abbastanza sedute (oltre un anno di borsa).</p>` : ''}` : ''}
<p><span class="badge" style="color:${v.colore};background:${v.colore}1f;border:1px solid ${v.colore}73">${esc(minuscolo(v.titolo))}</span>${aff.livello ? `<span class="aff" style="color:${AFF[aff.livello][0]};border:1px solid ${AFF[aff.livello][0]}73">${AFF[aff.livello][1]}</span>` : ''}</p>
${corpo}
<a class="cta" href="../?t=${encodeURIComponent(t)}">Apri la scheda con il prezzo aggiornato</a>${BOT ? `
<p class="mu" style="margin-top:12px"><a href="https://t.me/${BOT}?start=segui_${t.replace(/\./g, '_')}" rel="noopener">Avvisami su Telegram</a> quando su ${esc(t)} arriva un segnale della mia strategia o cambia il fair value.</p>` : ''}
${simili(t, d)}
<h2>Il metodo in breve</h2>
<p>Il <strong>fair value pavimento</strong> è quanto vale l'azienda se da oggi non crescesse più in termini reali: il margine di free cash flow tipico degli ultimi 10 anni, applicato ai ricavi attuali e capitalizzato al rendimento richiesto al netto dell'inflazione attesa, più la cassa che eccede il debito. Il decennale è quello della valuta del titolo (Bund per l'area euro) e l'inflazione attesa è l'obiettivo della banca centrale. Il <strong>fair value di mercato</strong> ipotizza una crescita pari a quella dell'economia; il <strong>fair value storico</strong> è il prezzo che il titolo avrebbe al suo rendimento di free cash flow mediano degli ultimi 10 anni. <a href="../#faq">Spiegazione completa nel glossario</a>.</p>
` + foot;
}

function paginaAltri(righe) {
  const agg = dataIt(righe[0] && righe[0].d.fv_updated);
  const title = `Fair value di azioni americane ed europee, aggiornati ogni giorno | Matteo Mazzero`;
  const desc = `Fair value di ${righe.length} azioni americane ed europee (indici S&P 500, 400 e 600 e società con almeno 2 miliardi di capitalizzazione) calcolati ogni giorno con l'indicatore FAIR VALUE (dati realizzati). Aggiornato al ${agg}.`;
  const tr = righe.map(({ t, d, v, pt }) => `<tr><td><a href="${slug(t)}.html"><strong>${esc(t)}</strong></a><br><span class="mu">${esc(d.name)}</span></td>
<td class="n">${num(d.price)} ${d.curr}</td><td class="n">${d.fv != null ? num(d.fv) + ' ' + d.curr : '—'}</td>
<td class="n" style="color:${pt.pot == null ? 'inherit' : pt.pot >= 0 ? '#4CC38A' : '#F0716A'}">${pc(pt.pot)}</td><td style="color:${v.colore};font-weight:700;font-size:.85em">${esc(minuscolo(v.titolo))}</td></tr>`).join('\n');
  return head(title, desc, `${SITE}titoli/altri.html`) + `<h1>Fair value di ${righe.length.toLocaleString('it-IT', { useGrouping: 'always' })} azioni americane ed europee</h1>
<p class="mu">Indici S&amp;P 500, 400 e 600 e altre società americane ed europee con almeno 2 miliardi di capitalizzazione · aggiornati al ${agg} · in ordine alfabetico</p>
<p>Non sono i titoli che seguo personalmente (quelli sono nell'<a href="index.html">elenco principale</a>), ma per ciascuno calcolo ogni giorno il fair value con lo stesso metodo e i segnali della mia strategia TBO.</p>
<div class="card tw"><table>
<thead><tr><th>Titolo</th><th class="n">Prezzo</th><th class="n">FV pavimento</th><th class="n">Potenziale</th><th>Esito del modello</th></tr></thead>
<tbody>
${tr}
</tbody></table></div>
` + foot;
}

function paginaIndice(righe) {
  const agg = dataIt(data.fv_updated ? data.fv_updated.slice(0, 10) : righe[0] && righe[0].d.fv_updated);
  const title = `Fair value di oltre ${Math.floor(righe.length / 50) * 50} azioni, aggiornati ogni giorno | Matteo Mazzero`;
  const desc = `Elenco dei fair value di ${righe.length} azioni italiane, europee e americane calcolati con l'indicatore FAIR VALUE (dati realizzati): pavimento, fair value di mercato, potenziale ed esito del modello. Aggiornato al ${agg}.`;
  const tr = righe.map(({ t, d, v, pt }) => `<tr><td><a href="${slug(t)}.html"><strong>${esc(t)}</strong></a>${held.has(t) ? ' <span class="held" style="font-size:.72em">in portafoglio</span>' : ''}<br><span class="mu">${esc(d.name)}</span></td>
<td class="n">${num(d.price)} ${d.curr}</td><td class="n">${d.fv != null ? num(d.fv) + ' ' + d.curr : '—'}</td><td class="n">${d.fv_mkt != null ? num(d.fv_mkt) + ' ' + d.curr : '—'}</td>
<td class="n" style="color:${pt.pot == null ? 'inherit' : pt.pot >= 0 ? '#4CC38A' : '#F0716A'}">${pc(pt.pot)}</td><td style="color:${v.colore};font-weight:700;font-size:.85em">${esc(minuscolo(v.titolo))}</td></tr>`).join('\n');
  return head(title, desc, `${SITE}titoli/`) + `<h1>Fair value di ${righe.length} azioni</h1>
<p class="mu">Aggiornati al ${agg} · in ordine alfabetico</p>
<p>Ogni titolo ha la sua pagina con fair value pavimento, banda, fair value di mercato e storico, potenziale e avvisi sull'affidabilità della stima. Per ordinare e filtrare usa lo <a href="../#screener">screener</a> sulla home.${Object.keys(ext).length ? ` Ci sono anche le pagine di <a href="altri.html">${Object.keys(ext).length.toLocaleString('it-IT', { useGrouping: 'always' })} azioni americane ed europee</a> che non seguo personalmente.` : ''}</p>
<div class="card tw"><table>
<thead><tr><th>Titolo</th><th class="n">Prezzo</th><th class="n">FV pavimento</th><th class="n">FV mercato</th><th class="n">Potenziale</th><th>Esito del modello</th></tr></thead>
<tbody>
${tr}
</tbody></table></div>
` + foot;
}

fs.mkdirSync(OUT, { recursive: true });
const tickers = Object.keys(db).filter(t => db[t].tv && db[t].price > 0).sort();
const tickersExt = Object.keys(ext).filter(t => ext[t].price > 0 && !['index', 'altri'].includes(slug(t))).sort();
const slugs = new Set(tickers.map(slug));
if (slugs.size !== tickers.length) throw new Error('Due ticker producono lo stesso nome di pagina');
for (const t of [...tickersExt]) { if (slugs.has(slug(t))) tickersExt.splice(tickersExt.indexOf(t), 1); else slugs.add(slug(t)); }

// Toglie le pagine di titoli non più presenti
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.html') && !['index.html', 'altri.html'].includes(f) && !slugs.has(f.slice(0, -5))) fs.unlinkSync(path.join(OUT, f));

const righe = [];
for (const t of tickers) {
  const d = db[t];
  fs.writeFileSync(path.join(OUT, slug(t) + '.html'), paginaTitolo(t, d));
  righe.push({ t, d, v: E.verdict(d, Number(d.price)), pt: E.potenziale(d, Number(d.price)) });
}
fs.writeFileSync(path.join(OUT, 'index.html'), paginaIndice(righe));
const righeExt = [];
for (const t of tickersExt) {
  const d = ext[t];
  fs.writeFileSync(path.join(OUT, slug(t) + '.html'), paginaTitolo(t, d));
  righeExt.push({ t, d, v: E.verdict(d, Number(d.price)), pt: E.potenziale(d, Number(d.price)) });
}
if (righeExt.length) fs.writeFileSync(path.join(OUT, 'altri.html'), paginaAltri(righeExt));

// sitemap.xml
const oggi = new Date().toISOString().slice(0, 10);
const u = (loc, lastmod, freq, prio) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${prio}</priority>\n  </url>`;
const voci = [u(SITE, oggi, 'daily', '1.0'), u(SITE + 'titoli/', oggi, 'daily', '0.8')]
  .concat(tickers.map(t => u(`${SITE}titoli/${slug(t)}.html`, db[t].fv_updated || oggi, 'daily', '0.6')))
  .concat(righeExt.length ? [u(SITE + 'titoli/altri.html', oggi, 'daily', '0.6')] : [])
  .concat(tickersExt.map(t => u(`${SITE}titoli/${slug(t)}.html`, ext[t].fv_updated || oggi, 'daily', '0.5')))
  .concat([u(SITE + 'disclaimer.html', '2026-11-08', 'yearly', '0.3'), u(SITE + 'privacy.html', '2026-11-10', 'yearly', '0.3')]);
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${voci.join('\n')}\n</urlset>\n`);

console.log(`Pagine generate: ${tickers.length} titoli seguiti + ${tickersExt.length} altri + indici; sitemap con ${voci.length} indirizzi.`);
