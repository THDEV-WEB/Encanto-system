/* tests/catsection.golden.mjs — REF-UI-CATEGORY-01 · Fase 1. Roda: node tests/catsection.golden.mjs (npm run test:catnav)
   GOLDEN da FONTE UNICA de id de ancora de secao (utils/catSection.js). Congela que catSection(cat)
   produz EXATAMENTE os ids sec-* que o catalogo da loja ja renderizava — a prova mecanica de que a
   Fase 1 (unificar o mapeamento nome->sec-id) NAO alterou nenhum id existente. Pura, Node-safe, sem
   banco/rede/React (catSection e folha pura). */
import assert from 'node:assert/strict';
import { catSection } from '../src/utils/catSection.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

/* As 8 categorias oficiais (MOCK_CATS / Supabase) -> id de secao que o catalogo ja usava. */
const CASOS = [
  ['Cardapio de Marmitas', 'sec-marmitas'],
  ['Destaques',            'sec-destaques'],
  ['Copos Prontos',        'sec-prontos'],
  ['Monte seu Copo',       'sec-monte'],
  ['Batidinhas',           'sec-batidinha'],
  ['Combos',               'sec-combos'],
  ['Pedido Fitness',       'sec-fitness'],
  ['Bebidas',              'sec-bebidas'],
];
for (const [nome, esperado] of CASOS)
  check(`"${nome}" -> ${esperado}`, () => assert.equal(catSection({ id: 'x', nome }), esperado));

/* Desambiguacao copo: "Copos Prontos" casa 'pronto'; "Monte seu Copo" tem 'monte' e NAO cai em prontos. */
check('desambiguacao copo: Monte seu Copo != prontos', () => {
  assert.equal(catSection({ id: 'c3', nome: 'Monte seu Copo' }), 'sec-monte');
  assert.equal(catSection({ id: 'c4', nome: 'Copos Prontos' }), 'sec-prontos');
});

/* Categoria desconhecida -> fallback deterministico sec-<id> (identico ao default antigo do catalogo). */
check('categoria desconhecida -> sec-<id> (fallback igual ao antigo)', () => {
  assert.equal(catSection({ id: 'c99', nome: 'Categoria Nova' }), 'sec-c99');
});

/* Primeiro-match: a ORDEM da cadeia manda (destaque antes de combo, como no catalogo original). */
check('primeiro match respeita a ordem (destaque antes de combo)', () => {
  assert.equal(catSection({ id: 'z', nome: 'Combos em Destaque' }), 'sec-destaques');
});

console.log(fail === 0 ? '\nOK catsection.golden — ids sec-* preservados (fonte unica)' : `\nFALHA catsection.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
