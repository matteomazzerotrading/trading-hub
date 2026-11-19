// avvisi_telegram.mjs — avvisi personali del bot Telegram: a chi segue un titolo (iscrizioni.enc, vedi
// scripts/bot_telegram.mjs) arriva un messaggio in chat privata quando su quel titolo c'è un nuovo segnale della TBO
// Strategy (tbo_signals.json) o un cambio di esito del fair value (fv_changes.json → cambi e cambi_altri).
// Il registro avvisi_stato.json (senza dati personali) tiene i segnali e i cambi già considerati: alla prima
// esecuzione segna tutto come già visto, per non mandare arretrati.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leggiIscrizioni, catalogo } from './bot_telegram.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = 'https://matteomazzerotrading.github.io/trading-hub/';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.log('Token del bot non impostato: nessun avviso personale.'); process.exit(0); }
const leggi = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const PERCORSO = path.join(ROOT, 'avvisi_stato.json');
const primaVolta = !fs.existsSync(PERCORSO);
const reg = leggi('avvisi_stato.json', { segnali: [], cambi: [] });
const visti = new Set([...(reg.segnali || []), ...(reg.cambi || [])]);

const sig = (leggi('tbo_signals.json', {}) || {}).segnali || [];
const ch = leggi('fv_changes.json', {}) || {};
const db = (leggi('data.json', {}).db) || {}, ext = (leggi('fv_ext.json', {}).titoli) || {};
// chiave del titolo come sul sito: europei degli altri titoli = simbolo Yahoo; americani = ticker (.US se doppione)
const chiaveSegnale = r => (!r.ext ? r.t : String(r.t).includes('.') ? r.t : (() => { const tk = String(r.tv || '').split(':')[1] || r.t; return db[tk] ? tk + '.US' : tk; })());
const kS = r => `s|${r.t}|${r.d}|${r.k}`, kC = c => `c|${c.t}|${c.data}|${c.a}`;
const eventi = [
  ...sig.filter(r => (r.k === 'c' || r.k === 'x') && !r.tardi).map(r => ({ id: kS(r), t: chiaveSegnale(r), tipo: 'tbo', r })),
  ...[...(ch.cambi || []), ...(ch.cambi_altri || [])].map(c => ({ id: kC(c), t: c.t, tipo: 'fv', c })),
].filter(e => !visti.has(e.id));

const ESITI = { molto_sotto: 'molto sottovalutata', molto_sotto_declino: 'molto sottovalutata ma in declino', sotto: 'sottovalutata',
  equa_declino: "equa per un'azienda in declino", banda: 'nella banda del fair value', equita: 'in zona di equità', sopra: 'sopravvalutata',
  sopra_nd: 'sopra il fair value di mercato', premio_sostenuto: 'con un premio sostenuto', premio_dubbio: 'con un premio dubbio' };
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pagina = t => `${SITE}titoli/${t.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`;
const num = x => Number(x).toLocaleString('it-IT', { maximumFractionDigits: 2 });
const giorno = s => new Date(s + 'T12:00:00Z').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' });

let inviati = 0;
if (!primaVolta && eventi.length) {
  const stato = leggiIscrizioni(TOKEN), cat = catalogo();
  const base = process.env.TELEGRAM_API || 'https://api.telegram.org';
  for (const [id, u] of Object.entries(stato.utenti || {})) {
    const miei = eventi.filter(e => (u.t || []).includes(e.t));
    if (!miei.length) continue;
    const righe = miei.map(e => {
      const nome = esc(cat.nomi[e.t] || e.t), link = `<a href="${pagina(e.t)}"><b>${esc(e.t)}</b></a> ${nome}`;
      if (e.tipo === 'tbo') {
        const d = db[e.t] || ext[e.t] || {}, P = e.r.pr;
        return `${e.r.k === 'c' ? '🟢 <b>Compra</b>' : "🟡 <b>Chiusa all'80%</b>"} su ${link} · seduta di ${giorno(e.r.d)}, chiusura ${num(e.r.p)} ${esc(d.curr || '')}`
          + (e.r.k === 'c' && P && P.n12 >= 3 ? `\n   <i>precedenti: in guadagno a 12 mesi nel ${Math.round(P.p12)}% dei ${P.n12} casi</i>` : '');
      }
      return `⚖️ <b>Fair value</b>: ${link} passa da ${ESITI[e.c.da] || e.c.da} a <b>${ESITI[e.c.a] || e.c.a}</b>`;
    });
    const testo = `🔔 <b>I tuoi titoli</b>\n\n${righe.join('\n\n')}\n\n<i>Spunti, non consigli di acquisto né consulenza finanziaria.</i> /lista per i titoli che segui.`;
    try {
      const r = await fetch(`${base}/bot${TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: Number(id), text: testo.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }) });
      const j = await r.json().catch(() => ({}));
      if (j.ok) inviati++; else console.log(`Avviso non consegnato: ${j.description || r.status}`);
    } catch (e) { console.log('Avviso non consegnato:', e.message); }
    await new Promise(ok => setTimeout(ok, 400));
  }
}
// registro: ultimi 60 giorni
const limite = new Date(); limite.setUTCDate(limite.getUTCDate() - 60); const L = limite.toISOString().slice(0, 10);
const tutti = [...visti, ...eventi.map(e => e.id)].filter(k => (k.split('|')[2] || '') >= L);
fs.writeFileSync(PERCORSO, JSON.stringify({ aggiornato: new Date().toISOString(),
  segnali: tutti.filter(k => k.startsWith('s|')), cambi: tutti.filter(k => k.startsWith('c|')) }) + '\n');
console.log(primaVolta ? `Prima esecuzione: ${eventi.length} eventi segnati come già visti.` : `Avvisi personali: ${inviati} messaggi, ${eventi.length} eventi nuovi.`);
