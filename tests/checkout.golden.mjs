/* tests/checkout.golden.mjs — REF-APP-01 · B2 · roda com: node tests/checkout.golden.mjs
   GOLDEN DO CHECKOUT (fluxo sagrado submit → savePedido → create_order). Test-first,
   PRÉ-Onda 2 — congela o comportamento ATUAL do payload/mensagem antes de qualquer extração.

   ── ESTRATÉGIA (por que assim) ─────────────────────────────────────────────
   O `submit` e o objeto `DS` vivem DENTRO de src/App.jsx (JSX, não importável em Node) e a
   extração dos builders para utils/orderPayload.js é GATED (ADR B2 §3.1 — "não agora"). Sem
   tocar produção, este golden garante detecção de regressão em DUAS camadas:
     (A) DOMÍNIO REAL: importa pricing.js/ids.js/format.js REAIS (as MESMAS funções que o
         submit usa) e congela payload + mensagem + reconciliação + product_id + idempotência.
         Os builders abaixo são ESPELHO FIEL da montagem do submit (App.jsx L873-890 / L914-923);
         na Onda 5, quando orderPayload.js for extraído, troca-se o espelho pelo import real.
     (B) PIN DE FONTE: lê src/App.jsx e trava, por asserção, as expressões-chave da montagem
         REAL do submit e do savePedido. Qualquer alteração na montagem real quebra o pin →
         força atualizar o golden. É o elo golden↔código-real possível SEM extração.
   NÃO usa mocks que escondam comportamento: o cálculo é 100% domínio real; a estrutura é
   espelho verificado contra a fonte. Sem banco, rede, React ou localStorage.
   ADR: docs/adr/REF-APP-01-B2-checkout-golden.md */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { totalCarrinho } from '../src/utils/pricing.js';
import { fmt } from '../src/utils/format.js';
import { buildOrderArgs, buildWhatsAppMessage, buildCheckoutView } from '../src/utils/orderPayload.js';

let fail = 0;
const check = (m, fn) => { try { fn(); } catch (e) { fail++; console.error('✗', m, '—', e?.message ?? e); } };

/* ── (A) BUILDERS — IMPORT REAL do order-domain (Onda 5.2 · Trilha B) ──
   buildOrderArgs / buildWhatsAppMessage / buildCheckoutView agora vêm de src/utils/orderPayload.js.
   O espelho (antes fiel à montagem inline do submit) foi substituído pelo IMPORT REAL; os pins de
   fonte (§B) garantem que a montagem real mora no order-domain. buildRpcPayload segue local (só mapeia
   buildOrderArgs → chaves p_ da RPC create_order de services/DataService.js). */
function buildRpcPayload(cart, form, requestId) {
  const { customer, order, items } = buildOrderArgs(cart, form, requestId);
  return { p_customer: customer, p_order: order, p_items: items, p_request_id: requestId ?? null };
}

/* ── FIXTURES determinísticas (ADR B2 §2): 1 item uuid c/ 2 adicionais pagos (qty 2) + 1 item mock (qty 1) ── */
const REQ = '00000000-0000-4000-8000-000000000001';
const mkCart = () => {
  const items = [
    { id: '11111111-1111-4111-8111-111111111111', nome: 'Açaí 500ml', qty: 2, preco: 18, preco_promo: null,
      adicionais: [{ nome: 'Leite Ninho', preco: 2 }, { nome: 'Granola', preco: 2 }], obs: 'sem cebola' },
    { id: 'pb-morango', nome: 'Batidinha Morango', qty: 1, preco: 12, preco_promo: null, adicionais: [], obs: null },
  ];
  return { items, total: totalCarrinho(items) };
};
const FORM = { nome: 'Maria Teste', telefone: '38999990000', endereco: 'Rua A, 100, Centro', pagamento: 'pix', troco: '', obs: 'sem cebola' };

const GOLDEN_PAYLOAD = {
  p_customer: { name: 'Maria Teste', phone: '38999990000' },
  p_order: { total: 56, status: 'recebido', payment_method: 'pix', address: 'Rua A, 100, Centro', observacoes: 'sem cebola' },
  p_items: [
    { product_id: '11111111-1111-4111-8111-111111111111', nome_produto: 'Açaí 500ml', quantity: 2, price: 22, preco_unitario: 22,
      adicionais: [{ nome: 'Leite Ninho', preco: 2 }, { nome: 'Granola', preco: 2 }], observacoes: 'sem cebola' },
    { product_id: null, nome_produto: 'Batidinha Morango', quantity: 1, price: 12, preco_unitario: 12, adicionais: [], observacoes: null },
  ],
  p_request_id: REQ,
};
const GOLDEN_MSG = [
  '*🛍️ Novo Pedido - Encanto*', '',
  '*Cliente:* Maria Teste', '*Telefone:* 38999990000', '*Endereço:* Rua A, 100, Centro', '', '*📋 Itens:*',
  `• Açaí 500ml x2 — ${fmt(44)}`, '  ↳ Leite Ninho, Granola', '  ↳ Obs: sem cebola',
  `• Batidinha Morango x1 — ${fmt(12)}`, '',
  `*💰 Total: ${fmt(56)}*`, '*Pagamento:* pix', '*Obs:* sem cebola',
].join('\n');

console.error('— (A) GOLDEN DE DOMÍNIO (payload + mensagem + invariantes)');
const cart = mkCart();
check('1. snapshot do payload (byte-a-byte)', () => assert.deepStrictEqual(buildRpcPayload(cart, FORM, REQ), GOLDEN_PAYLOAD));
check('2. snapshot da mensagem WhatsApp',     () => assert.strictEqual(buildWhatsAppMessage(cart, FORM), GOLDEN_MSG));
check('3. reconciliação Σ(price×qty)=total',  () => {
  const p = buildRpcPayload(cart, FORM, REQ);
  const soma = p.p_items.reduce((a, it) => a + it.price * it.quantity, 0);
  assert.strictEqual(soma, p.p_order.total);
  assert.strictEqual(cart.total, totalCarrinho(cart.items));   // total do carrinho = domínio
});
check('4. product_id: uuid preservado / mock → null', () => {
  const p = buildRpcPayload(cart, FORM, REQ);
  assert.strictEqual(p.p_items[0].product_id, '11111111-1111-4111-8111-111111111111');
  assert.strictEqual(p.p_items[1].product_id, null);
});
check('5. idempotência: p_request_id passthrough',  () => assert.strictEqual(buildRpcPayload(cart, FORM, REQ).p_request_id, REQ));
check('5b. requestId ausente → p_request_id null',  () => assert.strictEqual(buildRpcPayload(cart, FORM, undefined).p_request_id, null));
check('6. pureza/idempotência (2ª montagem = 1ª)',  () => assert.deepStrictEqual(buildRpcPayload(mkCart(), FORM, REQ), buildRpcPayload(mkCart(), FORM, REQ)));
check('7. contratos null (adicionais [] / observacoes null / obs → null)', () => {
  const p = buildRpcPayload(cart, FORM, REQ);
  assert.deepStrictEqual(p.p_items[1].adicionais, []);
  assert.strictEqual(p.p_items[1].observacoes, null);
  assert.strictEqual(p.p_order.observacoes, 'sem cebola');
});
/* Onda 5.2: view-model do resumo (o componente passa a consumir buildCheckoutView, sem recalcular preço).
   Congela nome/qty/valor por item + total — o resumo renderizado deve permanecer idêntico ao anterior. */
check('8. buildCheckoutView reproduz o resumo (nome/qty/valor + total)', () => {
  const v = buildCheckoutView(cart);
  assert.strictEqual(v.total, fmt(56));
  assert.deepStrictEqual(v.itens.map(x => ({ nome: x.nome, qty: x.qty, valor: x.valor })), [
    { nome: 'Açaí 500ml', qty: 2, valor: fmt(44) },
    { nome: 'Batidinha Morango', qty: 1, valor: fmt(12) },
  ]);
});

/* ── (B) PIN DE FONTE — trava a montagem REAL do pedido (order-domain) e do savePedido (services/DataService.js) ──
   Onda 5.2 (Trilha B): a montagem do pedido saiu do submit (App.jsx) para src/utils/orderPayload.js; os pins do
   payload passam a ler esse módulo (pinOD). Os 2 pins de savePedido seguem em services/DataService.js (pinSvc,
   intocado). Regexes idênticas ao pré-move, exceto `pu` (era puComAdic no submit; no order-domain é precoUnitario). */
console.error('— (B) PIN DE FONTE (montagem em src/utils/orderPayload.js + savePedido em services/DataService.js)');
const OD  = readFileSync(new URL('../src/utils/orderPayload.js', import.meta.url), 'utf8');
const SVC = readFileSync(new URL('../src/services/DataService.js', import.meta.url), 'utf8');
const pinOD  = (m, re) => check('pin: ' + m, () => assert.ok(re.test(OD),  'expressão-chave ausente/alterada no order-domain — atualize o golden: ' + m));
const pinSvc = (m, re) => check('pin: ' + m, () => assert.ok(re.test(SVC), 'expressão-chave ausente/alterada no savePedido (DataService) — atualize o golden: ' + m));
pinOD("order.status 'recebido'",        /status:\s*'recebido'/);
pinOD('order.total = cart.total',       /total:\s*cart\.total/);
pinOD('order.observacoes = obs||null',  /observacoes:\s*form\.obs\s*\|\|\s*null/);
pinOD('item.product_id = isUuid?id:null', /product_id:\s*isUuid\(i\.id\)\s*\?\s*i\.id\s*:\s*null/);
pinOD('item.price = pu',                /price:\s*pu/);
pinOD('item.preco_unitario = pu',       /preco_unitario:\s*pu/);
pinOD('item.adicionais = i.adicionais||[]', /adicionais:\s*i\.adicionais\s*\|\|\s*\[\]/);
pinOD('item.observacoes = i.obs||null', /observacoes:\s*i\.obs\s*\|\|\s*null/);
pinOD('pu = precoUnitario(i)',          /const\s+pu\s*=\s*precoUnitario\(i\)/);
pinSvc('savePedido → rpc create_order',  /d\.rpc\('create_order',\s*\{/);
pinSvc('rpc args p_customer/p_order/p_items/p_request_id', /p_customer:\s*cliente,\s*p_order:\s*order,\s*p_items:\s*itens,\s*p_request_id:\s*requestId\s*\?\?\s*null/);

console.error(fail === 0
  ? '\n✅ checkout.golden OK — payload + mensagem + invariantes congelados; montagem real fixada (pin de fonte)'
  : `\n❌ checkout.golden — ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
