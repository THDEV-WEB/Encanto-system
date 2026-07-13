/* tests/recompra.smoke.mjs — REF-CLIENTE-02 Onda 4. Guarda as regras PURAS da recompra:
   - resolve pelo CATALOGO ATUAL (retorna o objeto de produto atual -> preco atual, nunca o antigo);
   - PULA: produto inexistente hoje, indisponivel, custom (product_id null) e que exige escolha (tamanhos/variantes). */
import assert from 'node:assert/strict';
import { montarRecompra } from '../src/components/pedidos/recompra.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ✓ ' + m); } catch (e) { fail++; console.error('  ✗ ' + m + ' — ' + (e?.message ?? e)); } };

const catalogo = [
  { id: 'p1', nome: 'Água', preco: 5, preco_promo: 4, disponivel: true },       // simples, promo (preco atual)
  { id: 'p2', nome: 'Açaí', tamanhos: [{ label: 'P', preco: 10 }] },            // exige tamanho -> pular
  { id: 'p3', nome: 'Bebida', variantes: ['300ml', '500ml'] },                  // exige variante -> pular
  { id: 'p4', nome: 'Marmita', preco: 20, disponivel: false },                  // indisponivel -> pular
  { id: 'p5', nome: 'Bife', preco: 29.99 },                                     // simples ok
];

const itens = [
  { product_id: 'p1', nome_produto: 'Água (antiga)', quantity: 2, price: 99, preco_unitario: 99, observacoes: 'gelada' }, // preco antigo 99 deve ser IGNORADO
  { product_id: 'p2', nome_produto: 'Açaí', quantity: 1 },
  { product_id: 'p3', nome_produto: 'Bebida', quantity: 1 },
  { product_id: 'p4', nome_produto: 'Marmita', quantity: 1 },
  { product_id: null, nome_produto: 'Monte seu Copo (custom)', quantity: 1 },
  { product_id: 'inexistente', nome_produto: 'Removido do catálogo', quantity: 1 },
  { product_id: 'p5', nome_produto: 'Bife', quantity: 3, observacoes: 'bem passado' },
];

const { adicionar, pulados } = montarRecompra(itens, catalogo);

check('adiciona SO os simples disponiveis (p1, p5)', () => {
  assert.deepStrictEqual(adicionar.map(a => a.prod.id), ['p1', 'p5']);
});
check('carrega o PRODUTO ATUAL (nao o snapshot) -> preco atual', () => {
  assert.equal(adicionar[0].prod.preco, 5);       // atual
  assert.equal(adicionar[0].prod.preco_promo, 4); // atual
  assert.ok(!('price' in adicionar[0]), 'nao deve carregar o price antigo do item');
});
check('preserva quantidade e observacoes', () => {
  assert.equal(adicionar[0].qty, 2); assert.equal(adicionar[0].obs, 'gelada');
  assert.equal(adicionar[1].qty, 3); assert.equal(adicionar[1].obs, 'bem passado');
});
check('pula tamanho/variante/indisponivel/custom/inexistente (5)', () => {
  assert.equal(pulados.length, 5);
  const nomes = pulados.map(p => p.nome);
  ['Açaí', 'Bebida', 'Marmita', 'Monte seu Copo (custom)', 'Removido do catálogo'].forEach(n => assert.ok(nomes.includes(n), 'faltou pular ' + n));
});
check('motivo "personalizar" para tamanho/variante; "indisponivel" para o resto', () => {
  const m = Object.fromEntries(pulados.map(p => [p.nome, p.motivo]));
  assert.equal(m['Açaí'], 'personalizar');
  assert.equal(m['Bebida'], 'personalizar');
  assert.equal(m['Marmita'], 'indisponivel');
  assert.equal(m['Removido do catálogo'], 'indisponivel');
});
check('entradas vazias nao quebram', () => {
  assert.deepStrictEqual(montarRecompra(null, null), { adicionar: [], pulados: [] });
  assert.deepStrictEqual(montarRecompra([], catalogo), { adicionar: [], pulados: [] });
});

console.log(fail === 0 ? '\n✅ recompra.smoke OK — resolve pelo catalogo atual, pula inexistente/indisponivel/custom/escolha' : `\n❌ ${fail} falha(s)`);
process.exit(fail === 0 ? 0 : 1);
