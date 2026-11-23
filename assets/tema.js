// =============================================================================
// Trading Hub, tema 2026: viste, ricerca rapida, home "Oggi" e animazioni.
// Si appoggia alle funzioni e ai dati della pagina (db, portfolioData, perfPoints, tboData, ...),
// caricata dopo lo script principale.
// =============================================================================
(function () {
    'use strict';
    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
    const calmo = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tatto = () => window.matchMedia('(hover: none)').matches;
    const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (x, d = 2) => Number(x).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' });
    const pcs = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
    const ease = t => 1 - Math.pow(1 - t, 4);
    const giorno = (d, o) => d.toLocaleDateString('it-IT', o || { day: 'numeric', month: 'long' });
    const dataIso = s => new Date(s + 'T12:00:00');
    const maiusc = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

    // ---------------------------------------------------------------- profondità: sfondo e luce sulle card
    let mx = 0, my = 0, rafSf = 0;
    window.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch') return;
        const card = e.target.closest && e.target.closest('.card');
        if (card) { const r = card.getBoundingClientRect(); card.style.setProperty('--px', (e.clientX - r.left) + 'px'); card.style.setProperty('--py', (e.clientY - r.top) + 'px'); }
        if (calmo()) return;
        mx = e.clientX / innerWidth * 2 - 1; my = e.clientY / innerHeight * 2 - 1;
        if (!rafSf) rafSf = requestAnimationFrame(() => { rafSf = 0; const s = document.documentElement.style; s.setProperty('--mx', mx.toFixed(3)); s.setProperty('--my', my.toFixed(3)); });
    }, { passive: true });
    // inclinazione leggera per le superfici in primo piano
    document.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch' || calmo()) return;
        const el = e.target.closest && e.target.closest('.inclina'); if (!el) return;
        const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        el.classList.add('attivo'); el.style.setProperty('--ry', (x * 5).toFixed(2) + 'deg'); el.style.setProperty('--rx', (-y * 4).toFixed(2) + 'deg');
    }, { passive: true });
    document.addEventListener('pointerout', e => {
        const el = e.target.closest && e.target.closest('.inclina'); if (!el || el.contains(e.relatedTarget)) return;
        el.classList.remove('attivo'); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg');
    });

    // ---------------------------------------------------------------- viste
    const VISTE = {
        oggi:        { sez: ['oggi-home', 'editoriale', 'oggi-strumenti', 'strumenti', 'faq'] },
        analizza:    { sez: ['fv-section'], titolo: 'Analizza un titolo', testo: "Fair value, cosa sta scontando il prezzo e com'è andato il mio modello, per oltre 2.400 società americane ed europee.", unica: true },
        mercato:     { sez: ['mappa', 'screener', 'pattern', 'news', 'total-watchlist'], titolo: 'Il mercato', testo: "Dov'è caro e dov'è conveniente: la mappa per settore, lo screener, i pattern e le notizie del giorno." },
        segnali:     { sez: ['tbo', 'indicatore'], titolo: 'I segnali', testo: 'I segnali della mia TBO Strategy su oltre 2.400 titoli, con i precedenti di ogni titolo e il contesto di mercato.' },
        laboratorio: { sez: ['laboratorio'], titolo: 'Il Laboratorio', testo: 'Il mio modello messo alla prova sui dati, le aspettative scontate nei prezzi e il radar delle convergenze.', unica: true },
        portafoglio: { sez: ['portfolio', 'myportfolio', 'i-miei-dati'], titolo: 'Il mio portafoglio', testo: 'Ogni posizione, ogni operazione e ogni dividendo, con soldi veri. Più lo spazio per simulare il tuo.', unica: true },
    };
    const vistaDi = {};
    // ogni vista mostra le sue sezioni nell'ordine scelto qui, a meno che il visitatore non abbia un suo ordine (Personalizza)
    let ordineProprio = false; try { ordineProprio = !!localStorage.getItem('mm_layout'); } catch (e) {}
    if (!ordineProprio) for (const c of Object.values(VISTE)) {
        const els = c.sez.map(id => document.getElementById(id)).filter(Boolean); if (els.length < 2) continue;
        const primo = els.reduce((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? b : a));
        const segno = document.createComment(''); primo.parentNode.insertBefore(segno, primo);
        els.forEach(el => segno.parentNode.insertBefore(el, segno)); segno.remove();
    }
    for (const [v, c] of Object.entries(VISTE)) {
        c.sez.forEach((id, i) => {
            const el = document.getElementById(id); if (!el) return;
            el.dataset.vista = v; vistaDi[id] = v;
            if (i === 0 && c.unica) el.classList.add('senza-titolo');
        });
        if (c.titolo) {
            // il titolo della vista va prima della sua sezione che viene prima nella pagina
            const els = c.sez.map(id => document.getElementById(id)).filter(Boolean); if (!els.length) continue;
            const primo = els.reduce((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? b : a));
            const t = document.createElement('div'); t.className = 'vista-testa'; t.dataset.vista = v;
            t.innerHTML = `<h1>${escH(c.titolo)}</h1><p>${escH(c.testo)}</p>`;
            primo.parentNode.insertBefore(t, primo);
        }
    }
    // contenitori che diventano piatti: il contenuto sta sulla griglia della pagina
    ['#fv-section > .card', '#screener > .card', '#laboratorio > .card', '#pattern > .card', '#faq > .card', '#tbo-segnali', '#tbo-stats', '#indicatore > .card', '#myportfolio > .card']
        .forEach(q => $$(q).forEach(el => el.classList.add('piatta')));
    const st = document.createElement('style');
    st.textContent = '.senza-titolo > .section-header .section-title { display: none; } .senza-titolo > .section-header { border-bottom: 0; padding-bottom: 0; margin-bottom: 18px; }';
    document.head.appendChild(st);

    let vistaOra = null;
    function applica(v) {
        vistaOra = v; document.body.dataset.vista = v;
        $$('[data-vista]').forEach(el => el.classList.toggle('vista-on', el.dataset.vista === v));
        const vis = $$('.container.vista-on').filter(el => !el.classList.contains('sez-nascosta') && getComputedStyle(el).display !== 'none');
        $$('.container.primo-in-vista').forEach(el => el.classList.remove('primo-in-vista'));
        if (vis[0]) vis[0].classList.add('primo-in-vista');
        $$('[data-v]').forEach(a => { const on = a.dataset.v === v; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
        muoviIndicatore();
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        if (v === 'oggi') requestAnimationFrame(disegnaOggi);
    }
    function mostra(v, o = {}) {
        if (!VISTE[v]) v = 'oggi';
        const vai = () => { if (o.el) { if (o.el.tagName === 'DETAILS') o.el.open = true; scrollTo(0, Math.max(0, o.el.getBoundingClientRect().top + scrollY - 84)); } else if (!o.resta) scrollTo(0, 0); };
        if (v === vistaOra) { vai(); return; }
        const cambia = () => { applica(v); vai(); };
        if (o.subito || calmo() || !vistaOra) { cambia(); return; }
        if (document.startViewTransition) { document.startViewTransition(cambia); return; }
        cambia();
        $$('.vista-on').forEach(el => { el.classList.remove('entra'); void el.offsetWidth; el.classList.add('entra'); });
    }
    window.mostraVista = mostra;
    // dove porta un indirizzo: una vista (#mercato) oppure un elemento dentro una vista (#tbo, #diario-box)
    function daHash(subito) {
        const h = decodeURIComponent(location.hash.slice(1));
        if (!h) return mostra('oggi', { subito });
        if (VISTE[h] && !document.getElementById(h)) return mostra(h, { subito });
        const el = document.getElementById(h);
        const sez = el && el.closest('[data-vista]');
        if (sez) { const primo = VISTE[sez.dataset.vista].sez[0] === sez.id && el === sez; return mostra(sez.dataset.vista, { subito, el: primo ? null : el }); }
        if (VISTE[h]) return mostra(h, { subito });
        mostra(vistaOra || 'oggi', { subito, resta: true });
    }
    window.addEventListener('hashchange', () => daHash(false));
    // lo script della pagina porta spesso a una sezione con scrollIntoView: prima si apre la sua vista
    const scorriOrig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (o) {
        const sez = this.closest && this.closest('[data-vista]');
        if (sez && sez.dataset.vista !== vistaOra) { applica(sez.dataset.vista); history.replaceState(null, '', '#' + sez.dataset.vista); }
        // la sezione principale di una vista si mostra dall'inizio, con il titolo della vista
        if (sez && this === sez && VISTE[sez.dataset.vista].unica) { scrollTo(0, 0); return; }
        return scorriOrig.call(this, o);
    };
    daHash(true);

    // indicatore che scivola sotto la voce attiva
    function muoviIndicatore() {
        const ind = $('.nav-ind'), a = $('.nav-links .nav-link.active');
        if (!ind) return;
        if (!a || !a.offsetParent) { ind.style.opacity = '0'; return; }
        ind.style.left = a.offsetLeft + 'px'; ind.style.width = a.offsetWidth + 'px'; ind.style.opacity = '1';
    }
    window.addEventListener('resize', muoviIndicatore);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { muoviIndicatore(); pillPeriodo(); });

    // ---------------------------------------------------------------- ricerca rapida (Ctrl K, /)
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    $$('.nav-cerca kbd').forEach(k => k.textContent = mac ? '⌘ K' : 'Ctrl K');
    const box = document.createElement('div');
    box.className = 'cmdk'; box.id = 'cmdk';
    box.innerHTML = `<div class="cmdk-sfondo" data-chiudi></div>
        <div class="cmdk-box" role="dialog" aria-modal="true" aria-label="Cerca un titolo o una sezione">
          <div class="cmdk-campo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
            <label for="cmdk-in" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Cerca</label>
            <input id="cmdk-in" type="search" autocomplete="off" spellcheck="false" placeholder="Cerca un titolo o una sezione: Eni, ASML, mappa…" role="combobox" aria-expanded="true" aria-controls="cmdk-lista">
            <kbd>Esc</kbd>
          </div>
          <ul class="cmdk-lista" id="cmdk-lista" role="listbox"></ul>
          <div class="cmdk-piede"><span>↑ ↓ per scegliere</span><span>Invio per aprire</span></div>
        </div>`;
    document.body.appendChild(box);
    const inp = $('#cmdk-in'), lista = $('#cmdk-lista');
    let voci = [], sel = 0, prima = null;
    const NOMI_VISTE = { oggi: 'Oggi', analizza: 'Analizza un titolo', mercato: 'Mercato: mappa, screener, pattern', segnali: 'Segnali TBO', laboratorio: 'Laboratorio', portafoglio: 'Il mio portafoglio' };
    const SCORCIATOIE = [['mappa', 'Mappa del mercato'], ['screener', 'Screener'], ['pattern', 'Pattern scanner'], ['diario-box', 'Diario delle mie operazioni'], ['myportfolio', 'Simula il tuo portafoglio'], ['total-watchlist', 'La tua watchlist'], ['faq', 'Glossario e metodo']];
    function catalogo() {
        const out = [];
        try { for (const t of Object.keys(db || {})) { const d = db[t]; if (d && !d.ext) out.push({ t, n: d.name || t, d, ext: false }); } } catch (e) {}
        try { if (typeof fvExtDati !== 'undefined' && fvExtDati) for (const [k, d] of Object.entries(fvExtDati)) out.push({ t: k, n: d.name || k, d, ext: true }); } catch (e) {}
        return out;
    }
    function verdettoBreve(d) {
        try { const v = fvVerdict(d, d.price); if (!v || v.key === 'na') return ''; return `<span class="vd" style="color:${v.colore}">${escH(maiusc(String(v.breve).toLowerCase()))}</span>`; } catch (e) { return ''; }
    }
    function cerca(q) {
        q = q.trim(); const Q = q.toUpperCase(), ql = q.toLowerCase();
        const out = [];
        if (!q) {
            out.push({ g: 'Vai a' });
            Object.entries(NOMI_VISTE).forEach(([v, n]) => out.push({ tipo: 'v', v, n }));
            return out;
        }
        const ris = [];
        for (const c of catalogo()) {
            const T = c.t.toUpperCase(), base = T.split('.')[0], nome = String(c.n).toLowerCase();
            let s = -1;
            if (T === Q || base === Q) s = 0; else if (T.startsWith(Q)) s = 1;
            else if (new RegExp('(^|[\\s\\-&.(])' + ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(nome)) s = 2;
            else if (q.length > 2 && nome.includes(ql)) s = 3;
            if (s >= 0) ris.push({ ...c, s: s + (c.ext ? 0.5 : 0) });
        }
        ris.sort((a, b) => a.s - b.s || a.t.length - b.t.length).splice(9);
        if (ris.length) { out.push({ g: 'Titoli' }); ris.forEach(r => out.push({ tipo: 't', ...r })); }
        const sc = [...Object.entries(NOMI_VISTE).map(([v, n]) => ({ tipo: 'v', v, n })), ...SCORCIATOIE.map(([id, n]) => ({ tipo: 's', id, n }))]
            .filter(x => x.n.toLowerCase().includes(ql));
        if (sc.length) { out.push({ g: 'Sezioni' }); out.push(...sc.slice(0, 5)); }
        if (!ris.length && /^[A-Z0-9.\-]{1,12}$/.test(Q)) { out.push({ g: 'Non è in elenco' }); out.push({ tipo: 't', t: Q, n: 'Calcola il fair value al momento', d: null }); }
        return out;
    }
    function disegna() {
        voci = cerca(inp.value);
        const scelte = voci.filter(x => !x.g); sel = Math.min(sel, Math.max(0, scelte.length - 1));
        let i = 0;
        lista.innerHTML = voci.length ? voci.map(x => {
            if (x.g) return `<li class="cmdk-gruppo" role="presentation">${escH(x.g)}</li>`;
            const k = i++;
            const corpo = x.tipo === 't'
                ? `<span class="tk">${escH(x.t)}</span><span class="nm">${escH(x.n)}</span>${x.d ? verdettoBreve(x.d) : ''}`
                : `<span class="nm" style="color:var(--text-main)">${escH(x.n)}</span><span class="vd" style="color:var(--text-muted)">${x.tipo === 'v' ? 'vista' : 'sezione'}</span>`;
            return `<li class="cmdk-voce" role="option" id="cmdk-o${k}" data-k="${k}" aria-selected="${k === sel}" style="--i:${k}">${corpo}</li>`;
        }).join('') : '<li class="cmdk-vuoto">Nessun risultato. Prova con il ticker, per esempio ENI o AAPL.</li>';
        inp.setAttribute('aria-activedescendant', 'cmdk-o' + sel);
    }
    function scegli(k) {
        const x = voci.filter(v => !v.g)[k]; if (!x) return;
        chiudiCerca();
        if (x.tipo === 'v') { location.hash = x.v; return; }
        if (x.tipo === 's') { location.hash = x.id; return; }
        try { apriTitolo(x.t); } catch (e) { location.hash = 'analizza'; }
    }
    function apriCerca() {
        prima = document.activeElement; box.classList.add('aperto'); inp.value = ''; sel = 0; disegna();
        setTimeout(() => inp.focus(), 10);
        try { caricaFvExt().then(() => { if (box.classList.contains('aperto')) disegna(); }); } catch (e) {}
    }
    function chiudiCerca() { box.classList.remove('aperto'); if (prima && prima.focus) prima.focus(); }
    window.apriCerca = apriCerca;
    inp.addEventListener('input', () => { sel = 0; disegna(); });
    inp.addEventListener('keydown', e => {
        const n = voci.filter(v => !v.g).length;
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, n); aggiornaSel(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + n) % Math.max(1, n); aggiornaSel(); }
        else if (e.key === 'Enter') { e.preventDefault(); scegli(sel); }
        else if (e.key === 'Escape') { e.preventDefault(); chiudiCerca(); }
    });
    function aggiornaSel() {
        $$('.cmdk-voce', lista).forEach(li => li.setAttribute('aria-selected', String(+li.dataset.k === sel)));
        const li = $('#cmdk-o' + sel); if (li) li.scrollIntoView({ block: 'nearest' });
        inp.setAttribute('aria-activedescendant', 'cmdk-o' + sel);
    }
    lista.addEventListener('click', e => { const li = e.target.closest('.cmdk-voce'); if (li) scegli(+li.dataset.k); });
    lista.addEventListener('pointermove', e => { const li = e.target.closest('.cmdk-voce'); if (li && +li.dataset.k !== sel) { sel = +li.dataset.k; aggiornaSel(); } });
    box.addEventListener('click', e => { if (e.target.hasAttribute('data-chiudi')) chiudiCerca(); });
    document.addEventListener('keydown', e => {
        const scrive = /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) || e.target.isContentEditable;
        if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); box.classList.contains('aperto') ? chiudiCerca() : apriCerca(); }
        else if (e.key === '/' && !scrive && !box.classList.contains('aperto')) { e.preventDefault(); apriCerca(); }
    });

    // ---------------------------------------------------------------- OGGI: il valore del portafoglio
    const PERIODI = [['1M', '1 mese', 1], ['3M', '3 mesi', 3], ['YTD', "Dall'anno", 0], ['1A', '1 anno', 12], ['ALL', 'Tutto', -1]];
    let periodo = '1M';
    try { const p = localStorage.getItem('mm_oggi_periodo'); if (PERIODI.some(x => x[0] === p)) periodo = p; } catch (e) {}
    const N = 140;                      // punti della linea, ricampionati, per animare il passaggio da un periodo all'altro
    let Yora = null, animY = 0, valMostrato = null, animV = 0, primaVolta = true, sub = [], scorre = -1;

    function periodiHtml() {
        const g = $('#oggi-periodi'); if (!g || g.dataset.pronto) return;
        g.dataset.pronto = '1';
        g.innerHTML = '<span class="pill" aria-hidden="true"></span>' + PERIODI.map(([k, n]) => `<button type="button" data-p="${k}" aria-pressed="${k === periodo}">${n}</button>`).join('');
        g.addEventListener('click', e => {
            const b = e.target.closest('button'); if (!b) return;
            periodo = b.dataset.p; try { localStorage.setItem('mm_oggi_periodo', periodo); } catch (er) {}
            $$('button', g).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            pillPeriodo(); disegnaOggi();
        });
        pillPeriodo();
    }
    function pillPeriodo() {
        const g = $('#oggi-periodi'); if (!g) return;
        const b = $('button[aria-pressed="true"]', g), p = $('.pill', g); if (!b || !p) return;
        p.style.left = b.offsetLeft + 'px'; p.style.width = b.offsetWidth + 'px';
    }
    function tagliaPeriodo(pts) {
        if (!pts.length) return [];
        const ult = pts[pts.length - 1].d, def = PERIODI.find(x => x[0] === periodo);
        let da;
        if (def[2] === -1) return pts.slice();
        if (def[2] === 0) da = new Date(ult.getFullYear(), 0, 1);
        else { da = new Date(ult); da.setMonth(da.getMonth() - def[2]); }
        let i = pts.findIndex(p => p.d >= da); if (i < 0) i = pts.length - 1;
        return pts.slice(Math.max(0, i - 1));      // compreso l'ultimo punto prima del periodo, come base
    }
    // variazione tra due punti: rendimento dall'indice (senza versamenti e prelievi), importo dal guadagno cumulato
    function variazione(a, b) {
        let pct = null, imp = null;
        if (a.perf != null && b.perf != null) pct = ((1 + b.perf / 100) / (1 + a.perf / 100) - 1) * 100; else if (a.v > 0) pct = (b.v / a.v - 1) * 100;
        if (a.pl != null && b.pl != null) imp = b.pl - a.pl; else imp = b.v - a.v;
        return { pct, imp };
    }
    function valoreHtml(v) {
        const s = fmtRaw(v), i = s.lastIndexOf(',');
        return i < 0 ? escH(s) : `${escH(s.slice(0, i))}<span class="dec">${escH(s.slice(i))}</span>`;
    }
    function animaValore(a, durata) {
        const el = $('#oggi-valore'); if (!el) return;
        cancelAnimationFrame(animV);
        const da = valMostrato == null ? a * 0.94 : valMostrato;
        if (calmo() || Math.abs(da - a) < 0.005) { valMostrato = a; el.innerHTML = valoreHtml(a); return; }
        const t0 = performance.now();
        const passo = t => { const k = Math.min(1, (t - t0) / durata); valMostrato = da + (a - da) * ease(k); el.innerHTML = valoreHtml(valMostrato); if (k < 1) animV = requestAnimationFrame(passo); else valMostrato = a; };
        animV = requestAnimationFrame(passo);
    }
    function ricampiona(vals) {
        if (!vals.length) return new Array(N).fill(0.5);
        const lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1;
        const out = [];
        for (let i = 0; i < N; i++) {
            const x = i / (N - 1) * (vals.length - 1), j = Math.floor(x), f = x - j;
            const v = vals[j] + ((vals[Math.min(j + 1, vals.length - 1)]) - vals[j]) * f;
            out.push(1 - (v - lo) / sp);                        // 0 in alto, 1 in basso
        }
        return out;
    }
    const H = 200, PAD = 12;
    const yPx = y => PAD + y * (H - 2 * PAD);
    function tracciato(Y) { return 'M' + Y.map((y, i) => `${(i / (N - 1) * 1000).toFixed(1)},${yPx(y).toFixed(1)}`).join(' L'); }
    function disegnaLinea(Y) {
        const d = tracciato(Y), l = $('#oggi-linea'), a = $('#oggi-area');
        if (l) l.setAttribute('d', d); if (a) a.setAttribute('d', d + ` L1000,${H} L0,${H} Z`);
    }
    function svela() {
        const r = $('#oggi-clip rect'); if (!r) return;
        if (calmo()) { r.setAttribute('width', '1000'); return; }
        r.setAttribute('width', '0'); const t0 = performance.now();
        const passo = t => { const k = Math.min(1, (t - t0) / 1500); r.setAttribute('width', (1000 * ease(k)).toFixed(1)); posPunto(sub.length - 1, k); if (k < 1) requestAnimationFrame(passo); };
        requestAnimationFrame(passo);
    }
    // posizione di un punto del periodo sul grafico (in %), per il cursore e il punto luminoso
    function coord(i) {
        if (!sub.length) return { x: 100, y: 50 };
        const vals = sub.map(p => p.v), lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1;
        const x = sub.length > 1 ? i / (sub.length - 1) : 1;
        return { x: x * 100, y: yPx(1 - (vals[i] - lo) / sp) / H * 100 };
    }
    function posPunto(i, k) {
        const p = $('#oggi-punto'); if (!p) return;
        if (k != null && k < 1) { p.style.opacity = '0'; return; }
        const c = coord(i); p.style.opacity = '1'; p.style.left = c.x + '%'; p.style.top = c.y + '%';
    }
    function testoVariazione(a, b, quando) {
        const el = $('#oggi-var'); if (!el) return;
        const v = variazione(a, b), cl = (v.pct != null ? v.pct : v.imp) >= 0 ? 'pos' : 'neg';
        el.innerHTML = `<span class="delta ${cl}">${escH(fmtRaw(v.imp, { segno: true }))}${v.pct != null ? ` (${pcs(v.pct)})` : ''}</span><span class="quando">${escH(quando)}</span>`;
    }
    function riposo() {
        if (!sub.length) return;
        const ult = sub[sub.length - 1], pen = sub[sub.length - 2] || ult, ini = sub[0];
        const def = PERIODI.find(x => x[0] === periodo), vP = variazione(ini, ult);
        testoVariazione(pen, ult, `dal ${giorno(pen.d)}`);
        const el = $('#oggi-var');
        if (el && vP.pct != null) el.insertAdjacentHTML('beforeend', `<span class="quando">${def[0] === 'ALL' ? "dall'inizio" : def[1].toLowerCase()}: <strong class="${vP.pct >= 0 ? 'pos' : 'neg'}" style="font-weight:600">${pcs(vP.pct)}</strong></span>`);
        animaValore(ult.v, primaVolta ? 1300 : 600);
        posPunto(sub.length - 1);
        const ax = $('#oggi-assi'); if (ax) ax.innerHTML = `<span>${escH(giorno(ini.d, { day: 'numeric', month: 'short', year: periodo === 'ALL' || periodo === '1A' ? 'numeric' : undefined }))}</span><span>${ult.live ? 'adesso' : escH(giorno(ult.d, { day: 'numeric', month: 'short' }))}</span>`;
    }
    function disegnaOggi() {
        if (vistaOra !== 'oggi' || typeof perfPoints !== 'function') return;
        let pts = [];
        try { pts = perfPoints(); } catch (e) { return; }
        if (!pts.length) return;
        periodiHtml();
        sub = tagliaPeriodo(pts);
        const Y = ricampiona(sub.map(p => p.v));
        const base = $('#oggi-base');
        if (base && sub.length) { const y = coord(0).y; base.setAttribute('y1', y / 100 * H); base.setAttribute('y2', y / 100 * H); }
        cancelAnimationFrame(animY);
        if (!Yora || calmo()) { Yora = Y; disegnaLinea(Y); if (primaVolta) svela(); }
        else {
            const Y0 = Yora.slice(), t0 = performance.now();
            const passo = t => { const k = Math.min(1, (t - t0) / 650), e = ease(k); Yora = Y0.map((y, i) => y + (Y[i] - y) * e); disegnaLinea(Yora); if (k < 1) animY = requestAnimationFrame(passo); };
            animY = requestAnimationFrame(passo);
        }
        if (scorre < 0) riposo();
        primaVolta = false;
    }
    // cursore: scorrendo sul grafico il numero grande segue il giorno indicato
    function preparaGrafico() {
        const g = $('#oggi-graf'); if (!g || g.dataset.pronto) return; g.dataset.pronto = '1';
        const cur = $('.cursore', g), dat = $('.data', g), punto = $('#oggi-punto');
        const su = e => {
            if (!sub.length) return;
            const r = g.getBoundingClientRect(), x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
            const i = Math.round(x * (sub.length - 1)); if (i === scorre) return; scorre = i;
            const c = coord(i), p = sub[i];
            g.classList.add('scorre'); punto.classList.remove('ora');
            cur.style.left = c.x + '%'; dat.style.left = Math.min(92, Math.max(8, c.x)) + '%';
            dat.textContent = p.live ? 'adesso' : giorno(p.d, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
            posPunto(i);
            cancelAnimationFrame(animV); valMostrato = p.v; $('#oggi-valore').innerHTML = valoreHtml(p.v);
            testoVariazione(sub[0], p, i ? `da inizio periodo a ${giorno(p.d)}` : 'inizio del periodo');
        };
        const giu = () => { if (scorre < 0) return; scorre = -1; g.classList.remove('scorre'); punto.classList.add('ora'); riposo(); };
        g.addEventListener('pointermove', su);
        g.addEventListener('pointerdown', su);
        g.addEventListener('pointerleave', giu);
        g.addEventListener('pointercancel', giu);
        g.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') giu(); });
        // da tastiera: frecce per spostarsi tra i giorni
        g.addEventListener('keydown', e => {
            if (!sub.length || !/Arrow(Left|Right)|Escape/.test(e.key)) return;
            e.preventDefault(); if (e.key === 'Escape') return giu();
            const i = scorre < 0 ? sub.length - 1 : scorre + (e.key === 'ArrowLeft' ? -1 : 1);
            const r = g.getBoundingClientRect(), k = Math.min(sub.length - 1, Math.max(0, i));
            scorre = -2; su({ clientX: r.left + r.width * (sub.length > 1 ? k / (sub.length - 1) : 1) });
        });
        g.addEventListener('blur', giu);
    }

    // ---------------------------------------------------------------- OGGI: il quadro della sera e i segnali
    function quadro() {
        const el = $('#oggi-quadro-corpo'); if (!el || typeof tboData === 'undefined' || !tboData) return;
        const m = tboData.mercato, righe = [];
        if (m && m.ampiezza_pct != null) {
            let esito = null; try { esito = tboEsitoFascia(m.fascia); } catch (e) {}
            const st = (m.storia || []).slice(-80), vals = st.map(x => x[1]);
            let sp = '';
            if (vals.length > 2) {
                const lo = Math.min(...vals, 30), hi = Math.max(...vals, 70);
                sp = `<svg class="ampiezza-storia" viewBox="0 0 400 40" preserveAspectRatio="none" role="img" aria-label="Ampiezza del mercato nelle ultime ${vals.length} sedute, da ${num(vals[0], 0)}% a ${num(vals[vals.length - 1], 0)}%">
                    <line x1="0" x2="400" y1="${(40 - (50 - lo) / (hi - lo) * 40).toFixed(1)}" y2="${(40 - (50 - lo) / (hi - lo) * 40).toFixed(1)}" stroke="rgba(148,178,209,.3)" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>
                    <path d="M${vals.map((v, i) => `${(i / (vals.length - 1) * 400).toFixed(1)},${(40 - (v - lo) / (hi - lo) * 40).toFixed(1)}`).join(' L')}"/></svg>`;
            }
            righe.push(`<div class="q-riga">
                <div class="q-testa"><strong>${escH(maiusc(m.nome || ''))}</strong><span>${num(m.ampiezza_pct, 0)}% dei titoli sopra la media a 200 sedute</span></div>
                <div class="gauge" aria-hidden="true"><div class="riemp" data-w="${Math.min(100, m.ampiezza_pct)}"></div>
                  <span class="tacca" style="left:30%"><b>30</b></span><span class="tacca" style="left:50%"><b>50</b></span><span class="tacca" style="left:70%"><b>70</b></span></div>
                ${sp}
                ${esito ? `<p class="q-nota">Con il ${escH(m.nome)} i “Compra” della strategia sono stati in guadagno dopo 12 mesi nel ${num(esito.p12, 0)}% dei casi, contro il ${num(tboStatsDati.contesto.tutti.p12, 0)}% di tutti i segnali.</p>` : ''}
            </div>`);
        }
        const ult = tboData.ultima_seduta, oggiS = (tboData.segnali || []).filter(r => r.d === ult && (r.k === 'c' || r.k === 'x'));
        if (ult) {
            const nC = oggiS.filter(r => r.k === 'c').length, nX = oggiS.length - nC;
            righe.push(`<div class="q-riga"><div class="q-testa"><strong>${oggiS.length} segnal${oggiS.length === 1 ? 'e' : 'i'} TBO</strong><span>seduta di ${escH(giorno(dataIso(ult), { weekday: 'long', day: 'numeric', month: 'long' }))}</span></div>
                <p class="q-nota">${nC} “Compra” e ${nX} chiusur${nX === 1 ? 'a' : 'e'} all'80%, su ${num(tboData.titoli, 0)} titoli esaminati. <a href="#segnali">Vedi i segnali</a></p></div>`);
        }
        const V = typeof labVerifica !== 'undefined' && labVerifica, f = V && (V.fasce || []).find(x => x.k === 'molto_sotto');
        if (f && f.x12 != null) {
            righe.push(`<div class="q-riga"><div class="q-testa"><strong>Il mio modello, alla prova</strong><span>dal ${escH(String(V.dal || '').slice(0, 4) * 1 + 1 || '')}</span></div>
                <p class="q-nota">I titoli oltre il 30% sotto il mio fair value hanno fatto ${f.x12 >= 0 ? 'il ' + num(f.x12, 1) + '% in più' : 'il ' + num(-f.x12, 1) + '% in meno'} del loro mercato nei 12 mesi successivi, su ${num(f.casi, 0)} casi. <a href="#laboratorio">Come l'ho verificato</a></p></div>`);
        }
        el.innerHTML = righe.join('');
        requestAnimationFrame(() => requestAnimationFrame(() => $$('.gauge .riemp', el).forEach(r => r.style.width = r.dataset.w + '%')));
    }
    function precedentiTesto(r) {
        const p = r.pr; if (!p) return '<span style="color:var(--text-muted)">nessun precedente</span>';
        if (r.k === 'c') return p.n12 >= 5 ? `in guadagno dopo 12 mesi nel <strong>${num(p.p12, 0)}%</strong> dei ${p.n12} casi` : '<span style="color:var(--text-muted)">pochi precedenti sul titolo</span>';
        return p.u >= 3 ? `dopo ${p.u} chiusure, prezzo più basso a 3 mesi nel <strong>${num(p.uc, 0)}%</strong> dei casi` : '<span style="color:var(--text-muted)">pochi precedenti sul titolo</span>';
    }
    function segnaliOggi() {
        const tb = $('#oggi-segnali-corpo'); if (!tb || typeof tboData === 'undefined' || !tboData || !tboData.segnali) return;
        const ult = tboData.ultima_seduta;
        const tit = $('#oggi-segnali-titolo'); if (tit && ult) tit.textContent = `I segnali di ${giorno(dataIso(ult), { weekday: 'long', day: 'numeric', month: 'long' })}`;
        const righe = tboData.segnali.filter(r => r.d === ult && (r.k === 'c' || r.k === 'x') && (db[r.t] || r.ext))
            .sort((a, b) => (a.k === b.k ? 0 : a.k === 'c' ? -1 : 1) || ((b.pr && b.pr.p12) || 0) - ((a.pr && a.pr.p12) || 0));
        if (!righe.length) { tb.innerHTML = `<tr><td colspan="5" class="segnali-vuoto">Nessun segnale nell'ultima seduta: la strategia non ha comprato né chiuso posizioni.</td></tr>`; return; }
        const extPronti = typeof fvExtDati !== 'undefined' && fvExtDati;
        if (righe.some(r => r.ext) && !extPronti) { try { caricaFvExt().then(segnaliOggi); } catch (e) {} }
        tb.innerHTML = righe.slice(0, 8).map(r => {
            const altro = !(db[r.t] && !r.ext), chiave = altro ? (chiaveExt(r.tv, r.t) || r.t) : r.t;
            const e = altro ? (extPronti && fvExtDati[chiave]) : db[r.t];
            const nome = (e && e.name) || r.n || r.t, curr = (e && e.curr) || (String(r.t).includes('.') ? '' : '$');
            let fv = '<span style="color:var(--text-muted)">—</span>';
            try { if (e) { const v = fvVerdict(e, r.p); if (v && v.key !== 'na') fv = `<span style="color:${v.colore}">${escH(maiusc(String(v.breve).toLowerCase()))}</span>`; } } catch (er) {}
            const prezzo = curr === 'GBp' ? num(r.p, 0) + ' p' : (curr === '$' ? '$' + num(r.p) : num(r.p) + (curr ? ' ' + curr : ''));
            return `<tr tabindex="0" role="link" data-t="${escH(chiave)}" aria-label="Apri l'analisi di ${escH(nome)}">
                <td><span class="nome">${escH(String(nome).replace(/\s+(S\.?p\.?A\.?|SE|plc|PLC|Inc\.?|AG|Aktiengesellschaft|N\.?V\.?|S\.?A\.?|Corporation|Corp\.?)$/, ''))}</span><span class="tk">${escH(chiave)}</span><span class="prec-mob">${precedentiTesto(r)}</span></td>
                <td><span class="etichetta ${r.k === 'c' ? 'compra' : 'chiusa'}">${r.k === 'c' ? 'Compra' : "Chiusa all'80%"}</span></td>
                <td class="col-media mono-font" style="white-space:nowrap">${escH(prezzo)}</td>
                <td class="col-media" style="white-space:nowrap">${fv}</td>
                <td class="col-larga">${precedentiTesto(r)}</td>
                <td style="text-align:right"><span class="vai" aria-hidden="true">→</span></td></tr>`;
        }).join('');
    }
    document.addEventListener('click', e => { const tr = e.target.closest && e.target.closest('#oggi-segnali-corpo tr[data-t]'); if (tr) apriTitolo(tr.dataset.t); });
    document.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const tr = e.target.closest && e.target.closest('#oggi-segnali-corpo tr[data-t]'); if (tr) apriTitolo(tr.dataset.t); });

    // ---------------------------------------------------------------- scheda: la scala dei valori
    function disegnaScala() {
        const box = $('#fv-scala'), t = typeof currentFVTicker !== 'undefined' && currentFVTicker; if (!box || !t || !db[t]) return;
        const d = db[t], p = window._fvPrezzo;
        const voci = [['Pavimento', d.fv, '#F0C978'], ['FV di mercato', d.fv_mkt, '#9DBBF5'], ['FV storico', d.fv_sto, '#C3A6F0']].filter(x => x[1] > 0);
        const tutti = [d.fv_low, d.fv_high, p, ...voci.map(x => x[1])].filter(x => x > 0);
        if (tutti.length < 2) { box.innerHTML = ''; return; }
        const lo = Math.min(...tutti) * 0.9, hi = Math.max(...tutti) * 1.06, X = v => ((v - lo) / (hi - lo) * 100);
        const c = x => Math.min(97, Math.max(3, x));
        let h = '<div class="asse"></div>';
        if (d.fv_low > 0 && d.fv_high > 0) h += `<div class="banda" style="left:${X(d.fv_low)}%; width:${X(d.fv_high) - X(d.fv_low)}%"></div>`;
        voci.sort((a, b) => a[1] - b[1]).forEach((x, i) => {
            h += `<span class="tacca" style="left:${X(x[1])}%; --c:${x[2]}"></span><span class="etic ${i % 2 ? 'giu' : 'su'}" style="left:${c(X(x[1]))}%; --c:${x[2]}">${escH(x[0])}</span>`;
        });
        if (p > 0) h += `<span class="prezzo" style="left:0%"></span><span class="etic ${voci.length % 2 ? 'giu' : 'su'}" style="left:${c(X(p))}%; --c:#F4F6F9; font-weight:600">Prezzo</span>`;
        box.innerHTML = h;
        box.setAttribute('role', 'img');
        box.setAttribute('aria-label', `Prezzo ${p > 0 ? num(p) : 'non disponibile'}, banda del fair value da ${d.fv_low > 0 ? num(d.fv_low) : '—'} a ${d.fv_high > 0 ? num(d.fv_high) : '—'}`);
        const pr = $('.prezzo', box);
        if (pr) requestAnimationFrame(() => requestAnimationFrame(() => { pr.style.left = X(p) + '%'; }));
    }

    // ---------------------------------------------------------------- aggancio alle funzioni della pagina
    function dopo(nome, fn) {
        const orig = window[nome]; if (typeof orig !== 'function') return;
        window[nome] = function () { const r = orig.apply(this, arguments); try { if (r && typeof r.then === 'function') r.then(() => fn()); else fn(); } catch (e) {} return r; };
    }
    dopo('renderPortKpi', () => { preparaGrafico(); disegnaOggi(); });
    dopo('renderTbo', () => { quadro(); segnaliOggi(); });
    dopo('renderTboStats', quadro);
    dopo('setValuta', () => { valMostrato = null; disegnaOggi(); });
    dopo('calculateFV', disegnaScala);
    window.addEventListener('load', () => {
        preparaGrafico();
        try { caricaVerifica().then(quadro); } catch (e) {}
        setTimeout(() => { disegnaOggi(); quadro(); segnaliOggi(); }, 50);
    });
    window.addEventListener('resize', () => { pillPeriodo(); if (scorre < 0) posPunto(sub.length - 1); });
})();
