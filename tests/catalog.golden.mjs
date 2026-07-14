/* tests/catalog.golden.mjs — REF-ADMIN-CATALOG-01. Roda: node tests/catalog.golden.mjs (npm run test:catalog)
   GOLDEN da arquitetura de MULTIPLAS CATEGORIAS (categoria_ids) — a que JA existia no codigo de leitura
   (utils/catalog.js) e foi CONCLUIDA nesta referencia (coluna no DB + escrita no Admin). Congela o
   contrato de prodInCat/getProdCatIds: um produto com categoria_ids pertence a TODAS as categorias
   listadas (aparece em N vitrines com UMA identidade); sem categoria_ids, cai no legado categoria_id.
   Pura, Node-safe (catalog.js compoe so utils/format). Sem banco/rede/React. */
import assert from 'node:assert/strict';
import { prodInCat, getProdCatIds } from '../src/utils/catalog.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

check('prodInCat: sem catId -> true (nao filtra)', () => {
  assert.equal(prodInCat({ categoria_id: 'c1' }, null), true);
  assert.equal(prodInCat({ categoria_id: 'c1' }, ''), true);
});

check('prodInCat: LEGADO (categoria_id unico)', () => {
  assert.equal(prodInCat({ categoria_id: 'c1' }, 'c1'), true);
  assert.equal(prodInCat({ categoria_id: 'c1' }, 'c2'), false);
});

check('prodInCat: MULTI (categoria_ids) pertence a TODAS as listadas', () => {
  const p = { categoria_id: 'c4', categoria_ids: ['c4', 'c8'] };   // Copos Prontos + Destaques
  assert.equal(prodInCat(p, 'c4'), true);
  assert.equal(prodInCat(p, 'c8'), true);   // aparece na vitrine Destaques
  assert.equal(prodInCat(p, 'c9'), false);
});

check('prodInCat: categoria_ids (nao-vazio) PREVALECE sobre categoria_id', () => {
  const p = { categoria_id: 'c1', categoria_ids: ['c4'] };
  assert.equal(prodInCat(p, 'c4'), true);
  assert.equal(prodInCat(p, 'c1'), false);   // categoria_ids manda quando presente
});

check('prodInCat: categoria_ids VAZIO cai no legado categoria_id', () => {
  assert.equal(prodInCat({ categoria_id: 'c1', categoria_ids: [] }, 'c1'), true);
  assert.equal(prodInCat({ categoria_id: 'c1', categoria_ids: [] }, 'c2'), false);
});

check('getProdCatIds: legado -> [categoria_id]', () => {
  assert.deepEqual(getProdCatIds({ categoria_id: 'c1' }), ['c1']);
});
check('getProdCatIds: multi -> o array', () => {
  assert.deepEqual(getProdCatIds({ categoria_id: 'c4', categoria_ids: ['c4', 'c8'] }), ['c4', 'c8']);
});
check('getProdCatIds: categoria_ids vazio -> [categoria_id]', () => {
  assert.deepEqual(getProdCatIds({ categoria_id: 'c1', categoria_ids: [] }), ['c1']);
});
check('getProdCatIds: sem categoria -> []', () => {
  assert.deepEqual(getProdCatIds({ categoria_id: null }), []);
  assert.deepEqual(getProdCatIds({}), []);
});

/* Cenario da referencia: "Encanto Mineiro" consolidado (Copos Prontos + Destaques) numa unica linha
   aparece nas DUAS secoes da loja via prodInCat — sem duplicar o produto. */
check('cenario: produto multi-categoria aparece em ambas as vitrines (fim da duplicacao)', () => {
  const encantoMineiro = { nome: 'Encanto Mineiro', categoria_id: 'c4', categoria_ids: ['c4', 'c8'], destaque: true };
  assert.equal(prodInCat(encantoMineiro, 'c4'), true);   // Copos Prontos
  assert.equal(prodInCat(encantoMineiro, 'c8'), true);   // Destaques
  assert.equal(getProdCatIds(encantoMineiro).length, 2); // uma identidade, duas categorias
});

console.log(fail === 0 ? '\nOK catalog.golden — multi-categoria (categoria_ids) congelada' : `\nFALHA catalog.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
