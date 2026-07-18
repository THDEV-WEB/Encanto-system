/* tests/scrollspy.golden.mjs — REF-UI-CATEGORY-01 (correcao do marcador). node tests/scrollspy.golden.mjs
   (npm run test:spy). Congela a correcao do bug "Monte seu Copo": a linha de deteccao do scroll-spy DEVE
   ficar abaixo do pouso do scroll para a secao recem-navegada nao cair na fronteira. Pura, Node-safe. */
import assert from 'node:assert/strict';
import { pickActiveSection } from '../src/utils/scrollSpyPick.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const nav = 200;   // navTopOffset simulado (header + chrome fixa)
/* secoes em ordem de DOM apos rolar para "Monte seu Copo" (prontos ficou acima; batidinha abaixo) */
const entries = (monteTop) => [
  { id: 'sec-marmitas',  top: -1400 },
  { id: 'sec-destaques', top: -900 },
  { id: 'sec-prontos',   top: -300 },
  { id: 'sec-monte',     top: monteTop },
  { id: 'sec-batidinha', top: monteTop + 520 },
];

/* Documenta o BUG antigo: linha coincidindo com o pouso (nav+12) + top fracionario -> trava em prontos. */
check('BUG antigo: linha coincidente (nav+12) trava em prontos com top fracionario', () => {
  assert.equal(pickActiveSection(entries(213), nav + 12), 'sec-prontos');
});

/* FIX: linha com folga (nav+40) detecta sec-monte, com top exato OU fracionario. */
check('FIX: linha com folga (nav+40) detecta sec-monte (exato e fracionario)', () => {
  assert.equal(pickActiveSection(entries(212), nav + 40), 'sec-monte');
  assert.equal(pickActiveSection(entries(212.5), nav + 40), 'sec-monte');
  assert.equal(pickActiveSection(entries(213), nav + 40), 'sec-monte');
});

/* Copos Prontos permanece correto quando E a secao no topo (nao houve regressao). */
check('Copos Prontos permanece ativo quando e a secao do topo', () => {
  const e = [{ id: 'sec-destaques', top: -300 }, { id: 'sec-prontos', top: 213 }, { id: 'sec-monte', top: 733 }];
  assert.equal(pickActiveSection(e, nav + 40), 'sec-prontos');
});

/* Ordem preservada: a ULTIMA que cruzou a linha vence (secoes em ordem de DOM). */
check('a ultima secao acima da linha vence', () => {
  const e = [{ id: 'a', top: -100 }, { id: 'b', top: -10 }, { id: 'c', top: 500 }];
  assert.equal(pickActiveSection(e, 240), 'b');
});

check('lista vazia -> null', () => assert.equal(pickActiveSection([], 240), null));

console.log(fail === 0 ? '\nOK scrollspy.golden — marcador robusto (linha fora da fronteira do pouso)' : `\nFALHA scrollspy.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
