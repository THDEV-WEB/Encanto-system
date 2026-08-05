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
   ADR: docs/adr/REF-APP-01-B2-checkout-golden.md

   REF-ADDRESS-02 · Onda 6: order.endereco_id (uuid opcional, viaja dentro de p_order) — pin novo (pinCk)
   trava que CheckoutPage.jsx só chama addressRepository.salvar() em entrega (nunca em retirada) e nunca
   deixa essa chamada bloquear o checkout (contrato de addressRepository.salvar: nunca lança, null em
   falha). Ver docs/adr/REF-ADDRESS-02-arquitetura-profissional.md §20. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { totalCarrinho } from '../src/utils/pricing.js';
import { fmt } from '../src/utils/format.js';
import { buildOrderArgs, buildOrderConfirmationMessage, buildCheckoutView } from '../src/utils/orderPayload.js';
import { buildComanda } from '../src/components/admin/comanda/comandaModel.js';
import { comandaTexto } from '../src/components/admin/comanda/comandaTexto.js';

let fail = 0;
const check = (m, fn) => { try { fn(); } catch (e) { fail++; console.error('✗', m, '—', e?.message ?? e); } };

/* ── (A) BUILDERS — IMPORT REAL do order-domain (Onda 5.2 · Trilha B) ──
   buildOrderArgs / buildWhatsAppMessage / buildCheckoutView agora vêm de src/utils/orderPayload.js.
   O espelho (antes fiel à montagem inline do submit) foi substituído pelo IMPORT REAL; os pins de
   fonte (§B) garantem que a montagem real mora no order-domain. buildRpcPayload segue local (só mapeia
   buildOrderArgs → chaves p_ da RPC create_order de services/DataService.js). */
function buildRpcPayload(cart, form, endereco, requestId, enderecoId) {
  const { customer, order, items } = buildOrderArgs(cart, form, endereco, requestId, enderecoId);
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
const FORM = { nome: 'Maria Teste', telefone: '38999990000', pagamento: 'pix', troco: '', obs: 'sem cebola' };
/* REF-CHECKOUT-ADDRESS-01: o endereco NAO vem mais do form — vem da FONTE UNICA (dominio Address) e e
   passado explicitamente a buildOrderArgs/buildWhatsAppMessage (o que e exibido = confirmado = persistido). */
const ENDERECO = 'Rua A, 100, Centro';

const GOLDEN_PAYLOAD = {
  p_customer: { name: 'Maria Teste', phone: '38999990000' },
  p_order: { total: 56, status: 'recebido', payment_method: 'pix', address: 'Rua A, 100, Centro', observacoes: 'sem cebola', endereco_id: null, delivery_fee: 0, maquininha_fee: 0 },
  p_items: [
    { product_id: '11111111-1111-4111-8111-111111111111', nome_produto: 'Açaí 500ml', quantity: 2, price: 22, preco_unitario: 22,
      adicionais: [{ nome: 'Leite Ninho', preco: 2 }, { nome: 'Granola', preco: 2 }], observacoes: 'sem cebola' },
    { product_id: null, nome_produto: 'Batidinha Morango', quantity: 1, price: 12, preco_unitario: 12, adicionais: [], observacoes: null },
  ],
  p_request_id: REQ,
};
console.error('— (A) GOLDEN DE DOMÍNIO (payload + invariantes)');
const cart = mkCart();
check('1. snapshot do payload (byte-a-byte)', () => assert.deepStrictEqual(buildRpcPayload(cart, FORM, ENDERECO, REQ), GOLDEN_PAYLOAD));

/* ── (C) REF-CHECKOUT-02/03 — mensagem de confirmação automática do WhatsApp ──
   buildOrderConfirmationMessage substituiu a antiga buildWhatsAppMessage: em vez de um payload próprio,
   monta um snapshot no MESMO formato que buildComanda/comandaTexto já consomem (Admin) e delega a
   MESMA função pura — única fonte de verdade entre comanda e mensagem do cliente. REF-CHECKOUT-03
   trocou o layout por um formato comercial (cabeçalho PARA ENTREGA/RETIRADA, Pedido NNNNN sem hash,
   troco sempre explícito) — ver docs/adr/REF-CHECKOUT-03-*.md. */
console.error('— (C) GOLDEN DA MENSAGEM DE CONFIRMAÇÃO (reaproveita buildComanda/comandaTexto)');
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
check('C1. mensagem = EXATAMENTE buildComanda+comandaTexto(contexto:cliente) sobre o mesmo snapshot (sem lógica própria duplicada)', () => {
  const { customer, order, items } = buildOrderArgs(cart, FORM, ENDERECO, REQ);
  const createdAt = new Date('2026-08-04T14:30:00.000Z');
  const msg = buildOrderConfirmationMessage(customer, order, items, ORDER_ID, { createdAt });
  const snapshot = {
    id: ORDER_ID, created_at: createdAt.toISOString(), total: order.total, address: order.address,
    payment_method: order.payment_method, observacoes: order.observacoes, order_items: items,
    customers: { name: customer.name, phone: customer.phone },
    delivery_fee: order.delivery_fee, maquininha_fee: order.maquininha_fee,
  };
  const esperado = comandaTexto(buildComanda(snapshot, {}), { contexto: 'cliente' });
  assert.strictEqual(msg, esperado);
});
check('C2. mensagem contém os campos exigidos (cliente/telefone/tipo/endereço/pagamento/itens+adicionais+obs/subtotal/total), com "Cobrar do cliente" (quem lê é a loja)', () => {
  const { customer, order, items } = buildOrderArgs(cart, FORM, ENDERECO, REQ);
  const msg = buildOrderConfirmationMessage(customer, order, items, ORDER_ID, {});
  assert.ok(msg.includes('Maria Teste'));
  assert.ok(msg.includes('38999990000'));
  assert.ok(msg.startsWith('*PARA ENTREGA*'));
  assert.ok(msg.includes('Rua A'));
  assert.ok(msg.includes('PIX'));
  assert.ok(msg.includes('Açaí 500ml'));
  assert.ok(msg.includes('Leite Ninho'));
  assert.ok(msg.includes('Granola'));
  assert.ok(msg.includes('Batidinha Morango'));
  assert.ok(msg.includes('sem cebola'));
  assert.ok(msg.includes('Subtotal'));
  assert.ok(msg.includes('TOTAL'));
  assert.match(msg, /\*Pedido \d{5}\*/);
  assert.ok(msg.includes('*Cobrar do cliente*'));
});
check('C3. troco (só existe no checkout, nunca persistido) aparece na mensagem quando informado', () => {
  const { customer, order, items } = buildOrderArgs(cart, FORM, ENDERECO, REQ);
  const msg = buildOrderConfirmationMessage(customer, order, items, ORDER_ID, { troco: 'R$ 60,00' });
  assert.ok(msg.includes('Troco para: R$ 60,00'));
});
check('C4. ausência de troco mostra "Troco: Não precisa" (nunca omite a linha, REF-CHECKOUT-03)', () => {
  const { customer, order, items } = buildOrderArgs(cart, FORM, ENDERECO, REQ);
  const msg = buildOrderConfirmationMessage(customer, order, items, ORDER_ID, {});
  assert.ok(msg.includes('Troco: Não precisa'));
});
/* REF-COMPANY-02/03: nomeCompleto (nome comercial) continua chegando via opts.companyInfo. */
check('C5. companyInfo.nomeCompleto customizado aparece no cabeçalho/rodapé da mensagem', () => {
  const { customer, order, items } = buildOrderArgs(cart, FORM, ENDERECO, REQ);
  const msg = buildOrderConfirmationMessage(customer, order, items, ORDER_ID, { companyInfo: { nomeCurto: 'Empório', nomeCompleto: 'Empório Teste — Comida Boa' } });
  assert.ok(msg.includes('Empório Teste — Comida Boa'));
});
check('C6. pedido de retirada: mensagem usa RETIRADA (mesmo discriminador da comanda) e omite bloco "Entrega:"', () => {
  const cartRetirada = mkCart();
  const { customer, order, items } = buildOrderArgs(cartRetirada, FORM, 'Retirada na loja — Rua João Schley, 77', REQ);
  const msg = buildOrderConfirmationMessage(customer, order, items, ORDER_ID, {});
  assert.ok(msg.startsWith('*RETIRADA*'));
  assert.ok(!msg.includes('Entrega:'));
});
check('C7. endereco estruturado (dominio Address, ja disponivel no CheckoutPage) aparece formatado na mensagem', () => {
  const { customer, order, items } = buildOrderArgs(cart, FORM, ENDERECO, REQ);
  const msg = buildOrderConfirmationMessage(customer, order, items, ORDER_ID, {
    enderecoEstruturado: { rua: 'Rua das Palmeiras', numero: '55', bairro: 'Vila Nova', cidade: 'Timbó', referencia: 'Perto da praça' },
  });
  assert.ok(msg.includes('Entrega:'));
  assert.ok(msg.includes('Rua das Palmeiras, 55'));
  assert.ok(msg.includes('Ponto de referência: Perto da praça'));
});
check('3. reconciliação Σ(price×qty)=total',  () => {
  const p = buildRpcPayload(cart, FORM, ENDERECO, REQ);
  const soma = p.p_items.reduce((a, it) => a + it.price * it.quantity, 0);
  assert.strictEqual(soma, p.p_order.total);
  assert.strictEqual(cart.total, totalCarrinho(cart.items));   // total do carrinho = domínio
});
check('4. product_id: uuid preservado / mock → null', () => {
  const p = buildRpcPayload(cart, FORM, ENDERECO, REQ);
  assert.strictEqual(p.p_items[0].product_id, '11111111-1111-4111-8111-111111111111');
  assert.strictEqual(p.p_items[1].product_id, null);
});
check('5. idempotência: p_request_id passthrough',  () => assert.strictEqual(buildRpcPayload(cart, FORM, ENDERECO, REQ).p_request_id, REQ));
check('5b. requestId ausente → p_request_id null',  () => assert.strictEqual(buildRpcPayload(cart, FORM, ENDERECO, undefined).p_request_id, null));
check('5c. address = FONTE UNICA (arg endereco), nao form', () => {
  const p = buildRpcPayload(cart, { ...FORM, endereco: 'LIXO-NAO-USAR' }, ENDERECO, REQ);
  assert.strictEqual(p.p_order.address, ENDERECO);   // ignora qualquer form.endereco residual
});
check('6. pureza/idempotência (2ª montagem = 1ª)',  () => assert.deepStrictEqual(buildRpcPayload(mkCart(), FORM, ENDERECO, REQ), buildRpcPayload(mkCart(), FORM, ENDERECO, REQ)));
check('7. contratos null (adicionais [] / observacoes null / obs → null)', () => {
  const p = buildRpcPayload(cart, FORM, ENDERECO, REQ);
  assert.deepStrictEqual(p.p_items[1].adicionais, []);
  assert.strictEqual(p.p_items[1].observacoes, null);
  assert.strictEqual(p.p_order.observacoes, 'sem cebola');
});
check('7b. endereco_id (Onda 6): ausente -> null; presente -> passthrough', () => {
  assert.strictEqual(buildRpcPayload(cart, FORM, ENDERECO, REQ).p_order.endereco_id, null);
  const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  assert.strictEqual(buildRpcPayload(cart, FORM, ENDERECO, REQ, ID).p_order.endereco_id, ID);
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
  assert.strictEqual(v.subtotal, undefined);   // sem resumo: contrato antigo, sem quebra em subtotal/entrega
});
/* REF-DELIVERY-FEE-01: buildCheckoutView(cart, resumo) — resumo presente muda o total (subtotal+taxas) e
   acrescenta as linhas de detalhamento (null quando a parcela é zero — o componente decide se omite). */
check('8b. buildCheckoutView com resumo: total = subtotal+entrega+maquininha; linhas formatadas', () => {
  const resumo = { subtotal: 56, deliveryFee: 12, maquininhaFee: 2, total: 70, status: 'ok' };
  const v = buildCheckoutView(cart, resumo);
  assert.strictEqual(v.subtotal, fmt(56));
  assert.strictEqual(v.entregaFmt, fmt(12));
  assert.strictEqual(v.maquininhaFmt, fmt(2));
  assert.strictEqual(v.total, fmt(70));
});
check('8c. buildCheckoutView com resumo sem taxa/maquininha: linhas ficam null (nunca "R$ 0,00")', () => {
  const resumo = { subtotal: 56, deliveryFee: 0, maquininhaFee: 0, total: 56, status: 'retirada' };
  const v = buildCheckoutView(cart, resumo);
  assert.strictEqual(v.entregaFmt, null);
  assert.strictEqual(v.maquininhaFmt, null);
  assert.strictEqual(v.total, fmt(56));
});

/* ── (B) PIN DE FONTE — trava a montagem REAL do pedido (order-domain) e do savePedido (services/DataService.js) ──
   Onda 5.2 (Trilha B): a montagem do pedido saiu do submit (App.jsx) para src/utils/orderPayload.js; os pins do
   payload passam a ler esse módulo (pinOD). Os 2 pins de savePedido seguem em services/DataService.js (pinSvc,
   intocado). Regexes idênticas ao pré-move, exceto `pu` (era puComAdic no submit; no order-domain é precoUnitario). */
console.error('— (B) PIN DE FONTE (montagem em src/utils/orderPayload.js + savePedido em services/DataService.js)');
const OD  = readFileSync(new URL('../src/utils/orderPayload.js', import.meta.url), 'utf8');
const SVC = readFileSync(new URL('../src/services/DataService.js', import.meta.url), 'utf8');
const CK  = readFileSync(new URL('../src/components/checkout/CheckoutPage.jsx', import.meta.url), 'utf8');
const pinOD  = (m, re) => check('pin: ' + m, () => assert.ok(re.test(OD),  'expressão-chave ausente/alterada no order-domain — atualize o golden: ' + m));
const pinSvc = (m, re) => check('pin: ' + m, () => assert.ok(re.test(SVC), 'expressão-chave ausente/alterada no savePedido (DataService) — atualize o golden: ' + m));
const pinCk  = (m, re) => check('pin: ' + m, () => assert.ok(re.test(CK),  'expressão-chave ausente/alterada no submit (CheckoutPage) — atualize o golden: ' + m));
pinOD("order.status 'recebido'",        /status:\s*'recebido'/);
pinOD('order.total = resumo?.total : cart.total (REF-DELIVERY-FEE-01)', /total:\s*resumo\s*\?\s*resumo\.total\s*:\s*cart\.total/);
pinOD('order.delivery_fee/maquininha_fee vem do resumo (REF-DELIVERY-FEE-01)', /delivery_fee:\s*resumo\s*\?\s*resumo\.deliveryFee\s*:\s*0,\s*maquininha_fee:\s*resumo\s*\?\s*resumo\.maquininhaFee\s*:\s*0/);
pinOD('order.observacoes = obs||null',  /observacoes:\s*form\.obs\s*\|\|\s*null/);
pinOD('order.address = endereco (FONTE UNICA — nao form.endereco)', /address:\s*endereco\b/);
pinOD('order.endereco_id = enderecoId ?? null (REF-ADDRESS-02 Onda 6)', /endereco_id:\s*enderecoId\s*\?\?\s*null/);
check('pin: order.address NAO vem de form.endereco', () => assert.ok(!/address:\s*form\.endereco/.test(OD), 'address nao pode voltar a sair de form.endereco (fonte unica quebrada)'));
pinOD('item.product_id = isUuid?id:null', /product_id:\s*isUuid\(i\.id\)\s*\?\s*i\.id\s*:\s*null/);
pinOD('item.price = pu',                /price:\s*pu/);
pinOD('item.preco_unitario = pu',       /preco_unitario:\s*pu/);
pinOD('item.adicionais = i.adicionais||[]', /adicionais:\s*i\.adicionais\s*\|\|\s*\[\]/);
pinOD('item.observacoes = i.obs||null', /observacoes:\s*i\.obs\s*\|\|\s*null/);
pinOD('pu = precoUnitario(i)',          /const\s+pu\s*=\s*precoUnitario\(i\)/);
pinSvc('savePedido → rpc create_order',  /d\.rpc\('create_order',\s*\{/);
pinSvc('rpc args p_customer/p_order/p_items/p_request_id', /p_customer:\s*cliente,\s*p_order:\s*order,\s*p_items:\s*itens,\s*p_request_id:\s*requestId\s*\?\?\s*null/);
pinCk('endereco estruturado so persiste em entrega, nunca bloqueia (Onda 6)', /const\s+enderecoId\s*=\s*\(!retirada\s*&&\s*endereco\)\s*\?\s*await\s+addressRepository\.salvar\(endereco\)\s*:\s*null;/);
pinCk('buildOrderArgs recebe enderecoId + resumo (Onda 6 + REF-DELIVERY-FEE-01)', /buildOrderArgs\(cart,\s*form,\s*enderecoEntrega,\s*requestIdRef\.current,\s*enderecoId,\s*resumo\)/);

console.error(fail === 0
  ? '\n✅ checkout.golden OK — payload + mensagem + invariantes congelados; montagem real fixada (pin de fonte)'
  : `\n❌ checkout.golden — ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
