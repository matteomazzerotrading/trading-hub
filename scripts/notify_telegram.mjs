// notify_telegram.mjs — pubblica sul canale Telegram i nuovi segnali della TBO Strategy (Compra e chiusure all'80%).
// Gira dopo il calcolo serale dei segnali (workflow Compute Patterns). Servono due segreti delle GitHub Actions:
//   TELEGRAM_BOT_TOKEN  il token del bot (da @BotFather), che deve essere amministratore del canale
//   TELEGRAM_CHAT_ID    il canale, per esempio @nomecanale
// Senza segreti non fa nulla. I segnali già pubblicati sono in tbo_notified.json, così nessuno parte due volte.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const E = createRequire(import.meta.url)('./fv_engine.js');
const SITE = 'https://matteomazzerotrading.github.io/trading-hub/';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;
if (!TOKEN || !CHAT) { console.log('Segreti Telegram non impostati: nessuna notifica.'); process.exit(0); }

const leggi = (f, def) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { return def; } };
const sig = leggi('tbo_signals.json', null);
if (!sig || !Array.isArray(sig.segnali)) { console.log('Nessun file dei segnali.'); process.exit(0); }
const db = leggi('data.json', { db: {} }).db, ext = (leggi('fv_ext.json', {}) || {}).titoli || {};
const PERCORSO = path.join(ROOT, 'tbo_notified.json'), primaVolta = !fs.existsSync(PERCORSO);
const fatti = new Set((leggi('tbo_notified.json', { inviati: [] }).inviati) || []);
const chiave = r => `${r.t}|${r.d}|${r.k}`;

// Solo i segnali degli ultimi giorni; alla prima esecuzione solo quelli dell'ultima seduta, per non inondare il canale
const limite = new Date(sig.ultima_seduta + 'T00:00:00Z'); limite.setUTCDate(limite.getUTCDate() - 4);
const dal = primaVolta ? sig.ultima_seduta : limite.toISOString().slice(0, 10);
// alla prima esecuzione i segnali delle sedute precedenti contano come già pubblicati
if (primaVolta) for (const r of sig.segnali) if (r.d < dal) fatti.add(chiave(r));
const nuovi = sig.segnali.filter(r => (r.k === 'c' || r.k === 'x') && r.d >= dal && !fatti.has(chiave(r)));
if (!nuovi.length) { console.log('Nessun nuovo segnale da pubblicare.'); process.exit(0); }

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const num = (x, d = 2) => Number(x).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' });
function scheda(r) {
  if (!r.ext && db[r.t]) return { t: r.t, d: db[r.t], mio: true };
  const tk = String(r.tv || '').split(':')[1] || r.t, k = db[tk] ? tk + '.US' : tk;
  return { t: tk, k, d: ext[k] || { name: r.n || tk, curr: '$' }, mio: false };
}
const riga = r => {
  const s = scheda(r), d = s.d, v = d.fv > 0 ? E.verdict(d, r.p) : null;
  const esito = v && v.key !== 'na' ? ` · <i>${esc(v.titolo.toLowerCase())}</i>` : '';
  const pagina = ext[s.k] || s.mio ? `${SITE}titoli/${slug(s.k || s.t)}.html` : `${SITE}?t=${encodeURIComponent(s.t)}`;
  return `${s.mio ? '⭐ ' : ''}<a href="${pagina}"><b>${esc(s.t)}</b></a> ${esc(d.name)} · ${num(r.p)} ${esc(d.curr || '$')}${esito}`;
};
const giorno = s => new Date(s + 'T12:00:00Z').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

const messaggi = [];
for (const dd of [...new Set(nuovi.map(r => r.d))].sort()) {
  const delGiorno = nuovi.filter(r => r.d === dd), ordina = a => a.sort((x, y) => (scheda(y).mio - scheda(x).mio) || x.t.localeCompare(y.t));
  const compra = ordina(delGiorno.filter(r => r.k === 'c')), chiuse = ordina(delGiorno.filter(r => r.k === 'x'));
  const blocchi = [`🫖 <b>TBO Strategy</b> · seduta di ${giorno(dd)}`];
  if (compra.length) blocchi.push(`\n🟢 <b>Compra</b> (${compra.length})`, ...compra.map(riga));
  if (chiuse.length) blocchi.push(`\n🟡 <b>Chiusa all'80%</b> (${chiuse.length})`, ...chiuse.map(riga));
  const coda = `\n⭐ = titolo che seguo · prezzo di chiusura della seduta\n<i>Spunti da cui parto io stesso per le mie valutazioni: non sono consigli di acquisto né consulenza finanziaria.</i>\n<a href="${SITE}#tbo">Tutti i segnali e il track record →</a>`;
  // Telegram accetta al massimo 4096 caratteri per messaggio: se serve, l'elenco si divide in più messaggi
  let corrente = '';
  for (const b of blocchi) {
    if ((corrente + '\n' + b).length > 3600) { messaggi.push(corrente); corrente = '🫖 <b>TBO Strategy</b> · continua'; }
    corrente += (corrente ? '\n' : '') + b;
  }
  messaggi.push(corrente + '\n' + coda);
}

for (const testo of messaggi) {
  const r = await fetch(`${process.env.TELEGRAM_API || 'https://api.telegram.org'}/bot${TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: testo, parse_mode: 'HTML', disable_web_page_preview: true }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) { console.error(`Telegram ha rifiutato il messaggio: ${j.description || r.status}`); process.exit(1); }
  await new Promise(ok => setTimeout(ok, 1200));
}
// registro dei segnali pubblicati (ultimi 60 giorni)
const vecchio = new Date(); vecchio.setUTCDate(vecchio.getUTCDate() - 60);
const inviati = [...fatti, ...nuovi.map(chiave)].filter(k => k.split('|')[1] >= vecchio.toISOString().slice(0, 10));
fs.writeFileSync(PERCORSO, JSON.stringify({ aggiornato: new Date().toISOString(), inviati }) + '\n');
console.log(`Pubblicati ${nuovi.length} segnali in ${messaggi.length} messaggi.`);
