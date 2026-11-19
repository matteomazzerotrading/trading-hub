// bot_telegram.mjs — il bot Telegram del sito in chat privata: chi gli scrive può seguire dei titoli e ricevere un
// avviso quando su quei titoli arriva un segnale della TBO Strategy o cambia l'esito del fair value.
// Comandi: /start, /segui TICKER [TICKER…], /smetti TICKER | tutto, /lista, /aiuto. Dal sito si arriva con
// t.me/<bot>?start=segui_TICKER (il punto del ticker diventa "_", es. segui_SAN_MC).
//
// Le iscrizioni (id della chat Telegram e titoli seguiti) sono dati personali: stanno nel repository solo cifrate
// (iscrizioni.enc, AES-256-GCM) con una chiave derivata dal token del bot, che è un segreto di GitHub.
// Uso:  node scripts/bot_telegram.mjs            → legge i messaggi nuovi e risponde (workflow telegram-bot.yml)
//       import { leggiIscrizioni } …             → per gli avvisi serali (scripts/notify_telegram.mjs)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILE = path.join(ROOT, 'iscrizioni.enc');
const SITE = 'https://matteomazzerotrading.github.io/trading-hub/';
const MAX_TITOLI = 30;
const chiave = token => crypto.createHash('sha256').update('trading-hub/iscrizioni/' + token).digest();

export function leggiIscrizioni(token) {
  if (!fs.existsSync(FILE)) return { offset: 0, utenti: {} };
  const b = Buffer.from(fs.readFileSync(FILE, 'utf8').trim(), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', chiave(token), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}
export function scriviIscrizioni(token, dati) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', chiave(token), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(dati), 'utf8'), c.final()]);
  fs.writeFileSync(FILE, Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64') + '\n');
}

// elenco dei titoli riconosciuti: quelli che seguo (data.json) e gli altri (fv_ext.json), con gli alias
export function catalogo() {
  const leggi = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return {}; } };
  const data = leggi('data.json'), ext = (leggi('fv_ext.json').titoli) || {};
  const nomi = {};
  for (const [t, e] of Object.entries(data.db || {})) if (e.tv) nomi[t] = e.name;
  for (const [t, e] of Object.entries(ext)) if (!nomi[t]) nomi[t] = e.name;
  return { nomi, alias: data.aliases || {} };
}
export function trova(cat, testo) {
  const q = String(testo || '').trim().toUpperCase().replace(/^\$/, '');
  if (!q || q.length > 14) return null;
  for (const k of [q, cat.alias[q], q.replace('-', '.'), q.replace('.', '-')]) if (k && cat.nomi[k]) return k;
  return null;
}

async function api(token, metodo, corpo) {
  const base = process.env.TELEGRAM_API || 'https://api.telegram.org';
  const r = await fetch(`${base}/bot${token}/${metodo}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) });
  return r.json().catch(() => ({}));
}
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pagina = t => `${SITE}titoli/${t.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`;
const AIUTO = `Ti avviso quando su un titolo che segui arriva un segnale della mia <b>TBO Strategy</b> ("Compra" o "Chiusa all'80%") o quando cambia l'esito del mio <b>fair value</b>.

<b>/segui</b> AAPL ENI SAN.MC → segui uno o più titoli (fino a ${MAX_TITOLI})
<b>/smetti</b> AAPL → smetti di seguire un titolo (<b>/smetti tutto</b> cancella tutto quello che so di te)
<b>/lista</b> → i titoli che segui

Gli avvisi arrivano la sera, a mercati chiusi. Sono spunti, non consigli di acquisto né consulenza finanziaria.
<a href="${SITE}">Il sito</a>`;

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.log('Token del bot non impostato.'); return; }
  const stato = leggiIscrizioni(token), cat = catalogo(), prima = JSON.stringify(stato);
  // nome del bot per i link del sito (dato pubblico)
  const me = await api(token, 'getMe');
  if (me.ok) fs.writeFileSync(path.join(ROOT, 'telegram_bot.json'), JSON.stringify({ username: me.result.username }) + '\n');
  const up = await api(token, 'getUpdates', { offset: (stato.offset || 0) + 1, timeout: 0, allowed_updates: ['message'] });
  if (!up.ok) { console.error('getUpdates non riuscito:', up.description); process.exit(1); }
  let risposte = 0;
  for (const u of up.result || []) {
    stato.offset = Math.max(stato.offset || 0, u.update_id);
    const m = u.message;
    if (!m || !m.chat || m.chat.type !== 'private' || typeof m.text !== 'string') continue;
    const id = String(m.chat.id), [cmdGrezzo, ...arg] = m.text.trim().split(/\s+/), cmd = cmdGrezzo.split('@')[0].toLowerCase();
    const utente = stato.utenti[id] || { t: [] };
    let testo;
    const segui = lista => {
      const presi = [], ignoti = [];
      for (const a of lista) { const k = trova(cat, a); if (!k) ignoti.push(a); else if (!utente.t.includes(k)) { if (utente.t.length >= MAX_TITOLI) break; utente.t.push(k); presi.push(k); } else presi.push(k); }
      if (utente.t.length) { utente.dal = utente.dal || new Date().toISOString().slice(0, 10); stato.utenti[id] = utente; }
      return (presi.length ? `🔔 Segui: ${presi.map(k => `<a href="${pagina(k)}">${esc(k)}</a> (${esc(cat.nomi[k])})`).join(', ')}.` : '')
        + (ignoti.length ? `\nNon trovo: ${ignoti.map(esc).join(', ')}. Scrivi il ticker come sul sito (es. AAPL, ENI, SAN.MC).` : '')
        + (utente.t.length >= MAX_TITOLI ? `\nHai raggiunto il massimo di ${MAX_TITOLI} titoli.` : '');
    };
    if (cmd === '/start') {
      const p = arg[0] || '';
      testo = p.startsWith('segui_') ? segui([p.slice(6).replace(/_/g, '.')]) + '\n\n' + AIUTO : `Ciao! Sono il bot di Matteo Mazzero.\n\n${AIUTO}`;
    } else if (cmd === '/segui') testo = arg.length ? segui(arg) : 'Scrivi il ticker dopo il comando, per esempio: /segui AAPL ENI';
    else if (cmd === '/smetti') {
      if (!arg.length) testo = 'Scrivi il ticker dopo il comando (es. /smetti AAPL) oppure /smetti tutto.';
      else if (arg[0].toLowerCase() === 'tutto') { delete stato.utenti[id]; testo = 'Fatto: non seguo più nessun titolo per te e ho cancellato la tua iscrizione.'; }
      else { const via = arg.map(a => trova(cat, a) || a.toUpperCase()); utente.t = utente.t.filter(k => !via.includes(k)); if (utente.t.length) stato.utenti[id] = utente; else delete stato.utenti[id]; testo = `Non segui più: ${via.map(esc).join(', ')}.`; }
    } else if (cmd === '/lista') testo = utente.t.length ? `Segui ${utente.t.length} titoli:\n` + utente.t.map(k => `• <a href="${pagina(k)}">${esc(k)}</a> ${esc(cat.nomi[k] || '')}`).join('\n') : 'Non segui ancora nessun titolo. Prova con /segui AAPL';
    else if (cmd === '/aiuto' || cmd === '/help') testo = AIUTO;
    else { const k = trova(cat, cmd.replace(/^\//, '')); testo = k ? segui([k]) : `Non ho capito. ${AIUTO}`; }
    await api(token, 'sendMessage', { chat_id: m.chat.id, text: testo, parse_mode: 'HTML', disable_web_page_preview: true });
    risposte++;
    await new Promise(ok => setTimeout(ok, 300));
  }
  if (JSON.stringify(stato) !== prima) scriviIscrizioni(token, stato);       // il file cambia solo se cambia qualcosa
  console.log(`Bot: ${risposte} messaggi gestiti, ${Object.keys(stato.utenti).length} iscritti.`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
