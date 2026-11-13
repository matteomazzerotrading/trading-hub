// sw.js — service worker dell'app installabile (PWA).
// La pagina e i dati si prendono sempre dalla rete quando c'è (così l'app è aggiornata quanto il sito);
// se la rete manca o è lenta si usa l'ultima copia salvata. Prezzi in tempo reale, widget di TradingView e
// video non passano di qui: senza rete semplicemente non si caricano.
const VERSIONE = 'th-v2';
const GUSCIO = ['./', 'scripts/fv_engine.js', 'favicon.svg', 'manifest.webmanifest', 'icons/icon-192.png'];
const DATI_HOST = 'raw.githubusercontent.com';
const STATICI_ESTERNI = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(GUSCIO)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== VERSIONE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});

// chiave senza il parametro anti-cache (?v=...), così ogni file ha una sola copia salvata
const chiave = url => { const u = new URL(url); u.search = ''; return u.toString(); };
async function salva(req, res) {
  if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(VERSIONE); await c.put(chiave(req.url), res.clone()); }
  return res;
}
const dallaCopia = req => caches.match(chiave(req.url));
// rete prima, con un limite di tempo; poi la copia salvata
async function retePrima(req, ms) {
  const copia = await dallaCopia(req);
  try {
    const rete = fetch(req).then(r => salva(req, r));
    if (!copia) return await rete;
    return await Promise.race([rete, new Promise((_, no) => setTimeout(() => no(new Error('lenta')), ms))]);
  } catch (e) {
    if (copia) return copia;
    throw e;
  }
}
// copia salvata subito, aggiornata in sottofondo
async function copiaPrima(req) {
  const copia = await dallaCopia(req);
  const rete = fetch(req).then(r => salva(req, r)).catch(() => null);
  return copia || (await rete) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url), stessa = u.origin === self.location.origin;
  if (req.mode === 'navigate') {
    if (!stessa) return;
    e.respondWith(retePrima(req, 4000).catch(() => caches.match(chiave(new URL('./', self.location).toString()))).then(r => r || Response.error()));
  } else if (u.hostname === DATI_HOST || (stessa && u.pathname.endsWith('.json'))) {
    e.respondWith(retePrima(req, 6000).catch(() => new Response('null', { status: 503, headers: { 'Content-Type': 'application/json' } })));
  } else if (stessa || STATICI_ESTERNI.includes(u.hostname)) {
    e.respondWith(copiaPrima(req));
  }
});
