/* tests/searchtext.golden.mjs — REF-UI-SEARCH-01. node tests/searchtext.golden.mjs (npm run test:searchtext).
   Congela a busca TOLERANTE (utils/searchText): sem acento, sem caixa, parcial — e o realce (splitMatch)
   mapeando os indices do texto normalizado de volta para o ORIGINAL acentuado. Puro, Node-safe. */
import assert from 'node:assert/strict';
import { deburr, textMatches, splitMatch } from '../src/utils/searchText.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };
const m = (text, q) => textMatches(text, deburr(q));

/* deburr: minusculas + sem acento, preservando comprimento por caractere (NFC) */
check('deburr remove acento e caixa', () => {
  assert.equal(deburr('Açaí'), 'acai');
  assert.equal(deburr('AÇAÍ'), 'acai');
  assert.equal(deburr('Pedido Fitness'), 'pedido fitness');
  assert.equal(deburr('Batidinha de Morango'), 'batidinha de morango');
  assert.equal(deburr('Açaí').length, 'Açaí'.length);   // 1:1 por caractere (indices batem)
});

/* Exemplos EXATOS do dono */
check('acai -> Açaí', () => assert.equal(m('Açaí Tradicional', 'acai'), true));
check('morang -> Morango', () => assert.equal(m('Batidinha de Morango', 'morang'), true));
check('fitness -> Pedido Fitness', () => assert.equal(m('Pedido Fitness', 'fitness'), true));
check('ACAI (caixa alta) -> Açaí', () => assert.equal(m('Açaí', 'ACAI'), true));
check('parcial no meio (tira) -> Batidinha', () => assert.equal(m('Batidinha de Morango', 'tira'), false));
check('nao casa', () => assert.equal(m('Marmita Fitness', 'pizza'), false));
check('query vazia nao casa', () => assert.equal(textMatches('Açaí', deburr('')), false));

/* splitMatch: realca o trecho no ORIGINAL acentuado usando indices do normalizado */
check('splitMatch acai em "Açaí Tradicional" -> hit acentuado', () => {
  assert.deepEqual(splitMatch('Açaí Tradicional', deburr('acai')), { before: '', hit: 'Açaí', after: ' Tradicional' });
});
check('splitMatch morang em "Batidinha de Morango"', () => {
  assert.deepEqual(splitMatch('Batidinha de Morango', deburr('morang')), { before: 'Batidinha de ', hit: 'Morang', after: 'o' });
});
check('splitMatch com acento ANTES do casamento mantem indices', () => {
  // "Açaí de Cupuaçu" — casar "cupua" deve realcar exatamente "Cupua" apesar dos acentos anteriores
  assert.deepEqual(splitMatch('Açaí de Cupuaçu', deburr('cupua')), { before: 'Açaí de ', hit: 'Cupua', after: 'çu' });
});
check('splitMatch sem casamento -> null', () => assert.equal(splitMatch('Marmita', deburr('xyz')), null));

console.log(fail === 0 ? '\nOK searchtext.golden — busca tolerante (acento/caixa/parcial) + realce estaveis' : `\nFALHA searchtext.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
