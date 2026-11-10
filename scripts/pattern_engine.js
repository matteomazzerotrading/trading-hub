/*
 * pattern_engine.js — "MM Pattern Scanner" (Pine Script di matteomazzero2002) su chiusure giornaliere.
 * Cerca nel passato la finestra di `length` sedute più simile alle ultime `length` (correlazione di Pearson
 * sulle chiusure) e proietta in avanti quello che è successo dopo, in percentuale.
 * close = chiusure in ordine cronologico (indice 0 = più vecchia).
 */
'use strict';

function pattern(close, opt) {
  const length = (opt && opt.length) || 171, lookback = (opt && opt.lookback) || 3000, projLen = (opt && opt.projLen) || 171;
  const N = close.length, last = N - 1;
  const c = k => close[last - k];                         // come close[k] nel Pine: k barre fa
  const actual = Math.min(lookback, last - length - projLen - 1);
  if (!(actual > length)) return null;
  let sx = 0, sx2 = 0;
  for (let j = 0; j < length; j++) { const v = c(j); sx += v; sx2 += v * v; }
  // somme mobili della finestra storica: si aggiornano a ogni passo invece di ricalcolarle
  let bestR = -1, bestI = -1;
  for (let i = length + 2; i <= actual; i++) {
    let sy = 0, sy2 = 0, sxy = 0;
    for (let j = 0; j < length; j++) { const vx = c(j), vy = c(i + j); sy += vy; sy2 += vy * vy; sxy += vx * vy; }
    const num = length * sxy - sx * sy;
    const den = Math.sqrt(Math.max(0, length * sx2 - sx * sx) * Math.max(0, length * sy2 - sy * sy));
    const r = den === 0 ? 0 : num / den;
    if (r > bestR) { bestR = r; bestI = i; }
  }
  if (bestI < 0) return null;
  const limit = Math.min(projLen, bestI), base = c(bestI);
  const proj = [];                                         // variazione % attesa rispetto al prezzo di oggi, seduta per seduta
  for (let p = 1; p <= limit; p++) proj.push((c(bestI - p) - base) / base * 100);
  const att = [], sto = [];                                // i due andamenti, in % dal primo giorno della finestra
  for (let j = length - 1; j >= 0; j--) { att.push((c(j) / c(length - 1) - 1) * 100); sto.push((c(bestI + j) / c(bestI + length - 1) - 1) * 100); }
  return { r: bestR, iInizio: last - (bestI + length - 1), iFine: last - bestI, proj, att, sto };
}
module.exports = { pattern };
