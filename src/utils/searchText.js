/* utils/searchText.js — REF-UI-SEARCH-01. Helpers PUROS de texto para a busca inteligente.
   FOLHA pura (zero imports): so operacoes de string.

   deburr(s): minusculas + remove acentos (faixa de diacriticos combinantes U+0300..U+036F). Cada
   caractere acentuado do portugues (a a a a e e i o o o u u c ...) e precomposto (1 code unit em texto
   NFC normal) e, via NFD, decompoe em base+diacritico; removendo o diacritico volta a 1 code unit base.
   Logo, para texto NFC, deburr(s).length === s.length (mapeamento 1:1 por caractere) — o que permite
   REALCAR o trecho no texto ORIGINAL usando os indices calculados sobre o texto normalizado.

   textMatches(text, dq): substring tolerante a acento/caixa/parcial (dq ja deve vir deburrado).
   splitMatch(text, dq): parte o texto ORIGINAL (normalizado NFC) em { before, hit, after } no 1o
   casamento — para o realce discreto — ou null se nao casar. */
const DIACRITICOS = /[̀-ͯ]/g;

export function deburr(s) {
  return (s || '').normalize('NFD').replace(DIACRITICOS, '').toLowerCase();
}

export function textMatches(text, dq) {
  if (!dq) return false;
  return deburr(text).includes(dq);
}

export function splitMatch(text, dq) {
  if (!dq) return null;
  const t = (text || '').normalize('NFC');
  const i = deburr(t).indexOf(dq);
  if (i < 0) return null;
  return { before: t.slice(0, i), hit: t.slice(i, i + dq.length), after: t.slice(i + dq.length) };
}
