/* e2e/support/fixture-order.js — REF-E2E-02 · Onda 4.
   Cria 1 pedido real para o cliente FIXTURE, direto pela RPC create_order (mesma que o checkout usa),
   sem passar pela UI — setup rápido para specs que só precisam LER o resultado (Meus Pedidos,
   Fidelidade), não reexercitar o fluxo de checkout em si (isso já é o objetivo de
   checkout-logado.spec.js). create_order associa o pedido por TELEFONE, nunca por auth_user_id
   (ver comentário em src/components/checkout/CheckoutPage.jsx) — por isso nem precisa de sessão
   autenticada aqui: basta `p_customer.phone === CLIENTE_FIXTURE.telefone`, o mesmo telefone que
   support/fixture-customer.js já vinculou ao auth do fixture. */
import { randomUUID } from 'node:crypto';
import { supabaseAnon, E2E_ENV_PRONTO, avisarAmbientePendente } from './supabaseAdmin.js';
import { CLIENTE_FIXTURE } from './fixture-accounts.js';
import { PROD_MARMITA_P } from './fixture-catalog.js';
import { PREFIXO_TESTE } from './cleanup.js';

/** Cria 1 pedido (retirada, R$15,99, 1x Marmita P fixture) vinculado ao cliente fixture pelo telefone.
    Retorna o order_id. {ok:false, skipped:true} se o ambiente de E2E não estiver configurado. */
export async function criarPedidoFixture() {
  if (!E2E_ENV_PRONTO) { avisarAmbientePendente('pedido do cliente fixture'); return { ok: false, skipped: true }; }
  const anon = supabaseAnon();
  const total = 15.99;
  const { data, error } = await anon.rpc('create_order', {
    p_customer: { name: CLIENTE_FIXTURE.nome, phone: CLIENTE_FIXTURE.telefone },
    p_order: { total, status: 'recebido', payment_method: 'dinheiro', address: 'Retirada na loja — E2E', observacoes: null },
    p_items: [{
      product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1,
      price: total, preco_unitario: total, adicionais: [], observacoes: null,
    }],
    p_request_id: randomUUID(), // p_request_id e coluna uuid no banco (orders.request_id) — nao aceita string livre
  });
  if (error) throw new Error(`[e2e] create_order (fixture) falhou: ${error.message}`);
  if (data?.ok === false) throw new Error(`[e2e] create_order (fixture) recusado: ${data.error}`);
  return { ok: true, skipped: false, orderId: data.order_id };
}

/** REF-E2E-03 · Onda 1 (+ Onda 2: parâmetro `endereco`). Cria 1 pedido "avulso" (R$12,50, 1x Marmita P
    fixture) para um cliente GENÉRICO (nome com PREFIXO_TESTE, telefone gerado por execução) — SEM
    vínculo com CLIENTE_FIXTURE. Usado por specs de Admin que precisam de um pedido real no backend
    sem tocar Meus Pedidos/Fidelidade do cliente fixture (que usam criarPedidoFixture, acima). Limpo
    por `limparDadosDeTeste()` (já existente, já filtra customers por PREFIXO_TESTE). `endereco`
    controla o TIPO detectado por `comandaModel.js` (tipoDoPedido): o default replica o padrão
    "Retirada na loja — ..." (retirada); passar um endereço de entrega real produz um pedido tipo
    'entrega' (ver admin-pedidos-status.spec.js, que precisa dos 2 tipos p/ provar as 2 trilhas).
    Retorna o order_id e o telefone gerado. {ok:false, skipped:true} se o ambiente de E2E não estiver
    configurado. */
export async function criarPedidoAvulso({ endereco = 'Retirada na loja — E2E' } = {}) {
  if (!E2E_ENV_PRONTO) { avisarAmbientePendente('pedido avulso (Admin)'); return { ok: false, skipped: true }; }
  const anon = supabaseAnon();
  const total = 12.5;
  const telefone = `4799${Date.now().toString().slice(-7)}`; // gerado por execucao - nunca colide com CLIENTE_FIXTURE
  const { data, error } = await anon.rpc('create_order', {
    p_customer: { name: `${PREFIXO_TESTE}Avulso`, phone: telefone },
    p_order: { total, status: 'recebido', payment_method: 'dinheiro', address: endereco, observacoes: null },
    p_items: [{
      product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1,
      price: total, preco_unitario: total, adicionais: [], observacoes: null,
    }],
    p_request_id: randomUUID(),
  });
  if (error) throw new Error(`[e2e] create_order (avulso) falhou: ${error.message}`);
  if (data?.ok === false) throw new Error(`[e2e] create_order (avulso) recusado: ${data.error}`);
  return { ok: true, skipped: false, orderId: data.order_id, telefone };
}
