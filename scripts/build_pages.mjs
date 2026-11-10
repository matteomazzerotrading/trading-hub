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
:root{--bg:#050505;--card:#111316;--bd:rgba(255,255,255,.09);--tx:#d6d9de;--mu:#8b93a6;--gr:#00e676}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.65}
a{color:var(--gr);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:860px;margin:0 auto;padding:24px 20px 60px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;font-size:.9em;margin-bottom:28px}
.logo{font-weight:800;color:#fff;font-size:1.15em}.logo span{color:var(--gr)}
h1{color:#fff;font-size:1.9em;line-height:1.2;margin:0 0 6px;letter-spacing:-.5px}
h2{color:#fff;font-size:1.15em;margin:34px 0 10px}
.mu{color:var(--mu);font-size:.9em}
.badge{display:inline-block;padding:5px 14px;border-radius:8px;font-weight:800;font-size:.85em;letter-spacing:.3px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:20px 22px;margin-top:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:18px}
.box{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px 16px}
.box .l{font-size:.72em;text-transform:uppercase;letter-spacing:1px;color:var(--mu)}
.box .v{font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;font-size:1.08em;font-weight:700;color:#fff;margin-top:4px}
.box .s{font-size:.78em;color:var(--mu);margin-top:2px}
ul{padding-left:20px;margin:8px 0}.warn li{color:#f9a825}
.cta{display:inline-block;margin-top:18px;background:var(--gr);color:#000;font-weight:800;padding:12px 22px;border-radius:10px}
.cta:hover{text-decoration:none;opacity:.9}
.held{display:inline-block;font-size:.75em;font-weight:700;color:#80cbc4;background:rgba(128,203,196,.1);border:1px solid rgba(128,203,196,.35);border-radius:6px;padding:2px 8px;margin-left:8px;vertical-align:middle}
table{width:100%;border-collapse:collapse;font-size:.92em}th,td{padding:9px 10px;text-align:left;border-top:1px solid var(--bd)}th{color:var(--mu);font-size:.75em;text-transform:uppercase;letter-spacing:.8px;border-top:none}
td.n{text-align:right;font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;white-space:nowrap}th.n{text-align:right}
.tw{overflow-x:auto}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--bd);color:var(--mu);font-size:.82em}
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
<meta name="theme-color" content="#050505">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<meta property="og:type" content="article">
<meta property="og:locale" content="it_IT">
<meta property="og:site_name" content="Matteo Mazzero | Trading Hub">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}og-image.png">
<meta name="twitter:card" content="summary_large_image">${extra}
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<div class="top"><a class="logo" href="../">MM<span>Trading</span></a><span><a href="../">Home</a> · <a href="./">Tutti i fair value</a> · <a href="../#faq">Come leggere i valori</a></span></div>
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

function paginaTitolo(t, d) {
  const close = Number(d.price), c = d.curr, ind = d.ind || {};
  const v = E.verdict(d, close), pos = E.posizione(d, close), pt = E.potenziale(d, close);
  const ok = ind.status === 'ok' && d.fv != null;
  const fin = E.FINANZIARI.includes(t);
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
    const banda = d.fv_low != null ? `${num(d.fv_low)} – ${num(d.fv_high)} ${c}` : `fino a ${num(d.fv_high)} ${c}`;
    corpo += `<div class="grid">
${box('Prezzo', `${num(close)} ${c}`, `al ${agg}`)}
${box('FV pavimento', `${num(d.fv)} ${c}`, 'crescita reale zero')}
${box('Banda', banda, 'anno peggiore – migliore')}
${box('FV di mercato', `${num(d.fv_mkt)} ${c}`, "se cresce come l'economia")}
${box('FV storico', d.fv_sto ? `${num(d.fv_sto)} ${c}` : '—', 'ai multipli medi di 10 anni')}
${box('Potenziale', pc(pt.pot), pt.rif ? `sul FV ${pt.rif} · ${pc(pt.potMkt)} sul FV di mercato` : '')}
</div>
<h2>Come leggere il risultato</h2>
<p>${frasePosizione(t, d, v, pos, close)}</p>
<p>Esito del modello: <strong style="color:${v.colore}">${esc(basso(v.titolo))}</strong>${v.sotto ? ` (${esc(v.sotto)})` : ''}. ${pt.pot != null ? `Per arrivare al più basso tra fair value pavimento e storico (${num(pt.fvRif)} ${c}) il prezzo dovrebbe ${pt.pot >= 0 ? 'salire' : 'scendere'} del ${Math.abs(pt.pot).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%.` : ''}</p>`;
    const cat = E.categoria(v.key);
    if (pt.pot != null && ((cat === 'sotto' && pt.pot < 0) || (cat === 'sopra' && pt.pot > 0)))
      corpo += `<p class="mu">Le due letture qui non coincidono: l'esito guarda ai tassi di oggi (la banda a crescita zero), il potenziale tiene conto anche di come il mercato ha prezzato il titolo negli ultimi 10 anni (fair value storico). Quando divergono, la valutazione è meno netta.</p>`;
    const det = v.dettagli.filter(x => x.startsWith('crescita') || x.startsWith('ROIC'));
    if (det.length) corpo += `<p class="mu">${det.map(esc).join(' · ')}. La crescita scontata è quella che il prezzo di oggi dà per acquisita; la storica è quella dei ricavi per azione realizzata negli ultimi anni.</p>`;
    const avv = (fin ? [E.AVVISO_FIN] : []).concat(ind.avvisi || []);
    if (avv.length) corpo += `<h2>Avvisi sull'affidabilità della stima</h2><ul class="warn">${avv.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
<p class="mu">Il modello parte dal margine di free cash flow tipico degli ultimi 10 anni e somma la cassa senza sottrarre il debito: quando compaiono questi avvisi il fair value va letto con più cautela.</p>`;
    corpo += `<h2>Dati di base</h2><div class="grid">
${box('Rendimento richiesto (Ke)', ind.ke != null ? (ind.ke * 100).toFixed(1).replace('.', ',') + '%' : '—', `beta ${ind.beta != null ? String(ind.beta).replace('.', ',') : '—'}`)}
${box('FCF normalizzato', ind.fcf_norm != null ? `${num(ind.fcf_norm)} ${c}` : '—', 'per azione')}
${box('Cassa', ind.cassa_az != null ? `${num(ind.cassa_az)} ${c}` : '—', 'per azione')}
${box('Dividendo', d.divYield > 0 ? num(d.divYield) + '%' : '—', 'rendimento annuo')}
${box('P/E', d.fund && d.fund.pe && d.fund.pe !== 'N/D' ? String(d.fund.pe).replace('.', ',') : '—', 'ultimi 12 mesi')}
${box('Capitalizzazione', cap(d.fund && d.fund.mcap), d.curr)}
</div>`;
  } else {
    corpo += `<div class="card"><strong style="color:#fff">${esc(minuscolo(v.titolo))}</strong>${v.sotto ? `: ${esc(v.sotto)}` : ''}.<br>
Per ${esc(d.name)} il modello non produce un fair value: ${ind.status === 'fcf_negativo' ? 'il free cash flow normalizzato degli ultimi 10 anni è negativo' : 'i dati di bilancio disponibili non sono sufficienti'}. Prezzo al ${agg}: ${num(close)} ${c}.</div>`;
  }

  return head(title, desc, url, ld) + `<h1>Fair value di ${esc(d.name)} (${esc(t)})${held.has(t) ? '<span class="held">💼 nel mio portafoglio</span>' : ''}</h1>
<p class="mu">Aggiornato al ${agg} · calcolato con il mio indicatore FAIR VALUE (dati realizzati) su TradingView</p>
<p><span class="badge" style="color:${v.colore};background:${v.colore}1f;border:1px solid ${v.colore}73">${esc(v.titolo)}</span></p>
${corpo}
<a class="cta" href="../?t=${encodeURIComponent(t)}">Apri la scheda con il prezzo aggiornato →</a>
<h2>Il metodo in breve</h2>
<p>Il <strong>fair value pavimento</strong> è quanto vale l'azienda se da oggi non crescesse più in termini reali: il margine di free cash flow tipico degli ultimi 10 anni, applicato ai ricavi attuali e capitalizzato al rendimento richiesto al netto dell'inflazione, più la cassa per azione. Il <strong>fair value di mercato</strong> ipotizza una crescita pari a quella dell'economia; il <strong>fair value storico</strong> è il prezzo che il titolo avrebbe al suo rendimento di free cash flow mediano degli ultimi 10 anni. <a href="../#faq">Spiegazione completa nel glossario</a>.</p>
` + foot;
}

function paginaIndice(righe) {
  const agg = dataIt(data.fv_updated ? data.fv_updated.slice(0, 10) : righe[0] && righe[0].d.fv_updated);
  const title = `Fair value di oltre ${Math.floor(righe.length / 50) * 50} azioni, aggiornati ogni giorno | Matteo Mazzero`;
  const desc = `Elenco dei fair value di ${righe.length} azioni italiane, europee e americane calcolati con l'indicatore FAIR VALUE (dati realizzati): pavimento, fair value di mercato, potenziale ed esito del modello. Aggiornato al ${agg}.`;
  const tr = righe.map(({ t, d, v, pt }) => `<tr><td><a href="${slug(t)}.html"><strong>${esc(t)}</strong></a>${held.has(t) ? ' 💼' : ''}<br><span class="mu">${esc(d.name)}</span></td>
<td class="n">${num(d.price)} ${d.curr}</td><td class="n">${d.fv != null ? num(d.fv) + ' ' + d.curr : '—'}</td><td class="n">${d.fv_mkt != null ? num(d.fv_mkt) + ' ' + d.curr : '—'}</td>
<td class="n" style="color:${pt.pot == null ? 'inherit' : pt.pot >= 0 ? '#43a047' : '#d32f2f'}">${pc(pt.pot)}</td><td style="color:${v.colore};font-weight:700;font-size:.85em">${esc(minuscolo(v.titolo))}</td></tr>`).join('\n');
  return head(title, desc, `${SITE}titoli/`) + `<h1>Fair value di ${righe.length} azioni</h1>
<p class="mu">Aggiornati al ${agg} · in ordine alfabetico · 💼 = titolo nel mio portafoglio</p>
<p>Ogni titolo ha la sua pagina con fair value pavimento, banda, fair value di mercato e storico, potenziale e avvisi sull'affidabilità della stima. Per ordinare e filtrare usa lo <a href="../#screener">screener</a> sulla home.</p>
<div class="card tw"><table>
<thead><tr><th>Titolo</th><th class="n">Prezzo</th><th class="n">FV pavimento</th><th class="n">FV mercato</th><th class="n">Potenziale</th><th>Esito del modello</th></tr></thead>
<tbody>
${tr}
</tbody></table></div>
` + foot;
}

fs.mkdirSync(OUT, { recursive: true });
const tickers = Object.keys(db).filter(t => db[t].tv && db[t].price > 0).sort();
const slugs = new Set(tickers.map(slug));
if (slugs.size !== tickers.length) throw new Error('Due ticker producono lo stesso nome di pagina');

// Toglie le pagine di titoli non più presenti
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.html') && f !== 'index.html' && !slugs.has(f.slice(0, -5))) fs.unlinkSync(path.join(OUT, f));

const righe = [];
for (const t of tickers) {
  const d = db[t];
  fs.writeFileSync(path.join(OUT, slug(t) + '.html'), paginaTitolo(t, d));
  righe.push({ t, d, v: E.verdict(d, Number(d.price)), pt: E.potenziale(d, Number(d.price)) });
}
fs.writeFileSync(path.join(OUT, 'index.html'), paginaIndice(righe));

// sitemap.xml
const oggi = new Date().toISOString().slice(0, 10);
const u = (loc, lastmod, freq, prio) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${prio}</priority>\n  </url>`;
const voci = [u(SITE, oggi, 'daily', '1.0'), u(SITE + 'titoli/', oggi, 'daily', '0.8')]
  .concat(tickers.map(t => u(`${SITE}titoli/${slug(t)}.html`, db[t].fv_updated || oggi, 'daily', '0.6')))
  .concat([u(SITE + 'disclaimer.html', '2026-11-08', 'yearly', '0.3'), u(SITE + 'privacy.html', '2026-11-10', 'yearly', '0.3')]);
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${voci.join('\n')}\n</urlset>\n`);

console.log(`Pagine generate: ${tickers.length} titoli + indice; sitemap con ${voci.length} indirizzi.`);
