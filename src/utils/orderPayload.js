/* utils/orderPayload.js — REF-APP-01 · Onda 5.2 (Trilha B · order-domain). + REF-CHECKOUT-02.
   FONTE ÚNICA de derivação/formatação do pedido (INV-CK). Lógica PURA movida de dentro do
   CheckoutPage.submit (App.jsx) SEM alteração de comportamento — apenas realocada:
     - buildOrderArgs              → monta os args de DS.savePedido (customer/order/items) — antes inline no submit;
     - buildOrderConfirmationMessage→ monta a mensagem do WhatsApp reaproveitando buildComanda/comandaTexto
                                      (REF-CHECKOUT-02 — substituiu a antiga buildWhatsAppMessage, que tinha
                                      payload próprio e divergia da comanda do Admin);
     - buildCheckoutView           → view-model do resumo (linhas + total já formatados) — antes calculado no render.
   Compõe pricing/format/ids (permitido a folha de domínio em utils/; G-CK3 exige só PUREZA — sem
   React/IO/DataService/hooks). É consumidor de domínio (pricing) → entra na allowlist D1 do test:deps.
   buildOrderArgs é byte-equivalente ao espelho congelado em tests/checkout.golden.mjs (por isso o golden
   troca o espelho pelo import real mantendo GOLDEN_PAYLOAD idêntico); buildOrderConfirmationMessage é
   coberta por tests/checkout.golden.mjs (§C) + tests/comanda.golden.mjs (view-model/texto). */
import { precoUnitario, precoLinha } from './pricing.js';
import { fmt } from './format.js';
import { isUuid } from './ids.js';
/* REF-CHECKOUT-02: reaproveita a MESMA camada de domínio da comanda (Admin) para montar a mensagem
   de confirmação do cliente — única fonte de verdade, ver buildOrderConfirmationMessage abaixo.
   comandaModel/comandaTexto são módulos PUROS (sem React/IO — só compõem utils/format), moram em
   components/admin/comanda/ por onde foram usados primeiro; nada impede reuso fora do Admin. */
import { buildComanda } from '../components/admin/comanda/comandaModel.js';
import { comandaTexto } from '../components/admin/comanda/comandaTexto.js';

export function buildOrderArgs(cart, form, endereco, requestId, enderecoId) {
  const customer = { name: form.nome, phone: form.telefone };
  /* REF-CHECKOUT-ADDRESS-01: o endereco vem da FONTE UNICA (dominio Address), passado explicitamente —
     nunca mais de um form.endereco paralelo. O que e persistido no pedido e EXATAMENTE o exibido/confirmado.
     REF-ADDRESS-02 · Onda 6: enderecoId (uuid de addresses, ou null p/ retirada/offline/legado) viaja dentro
     do MESMO p_order jsonb — create_order le p_order->>'endereco_id' e grava em orders.endereco_id. */
  const order = { total: cart.total, status: 'recebido', payment_method: form.pagamento,
                  address: endereco, observacoes: form.obs || null, endereco_id: enderecoId ?? null };
  const items = cart.items.map(i => {
    const pu = precoUnitario(i);
    return {
      product_id:     isUuid(i.id) ? i.id : null,
      nome_produto:   i.nome,
      quantity:       i.qty,
      price:          pu,
      preco_unitario: pu,
      adicionais:     i.adicionais || [],
      observacoes:    i.obs || null,
    };
  });
  return { customer, order, items, requestId };
}

/* REF-CHECKOUT-02: mensagem de confirmação automática do WhatsApp — substitui a antiga
   buildWhatsAppMessage (payload próprio, campos limitados). Monta um snapshot do pedido no MESMO
   formato que buildComanda já consome (order + order_items + customers, igual ao que o Admin lê do
   banco) a partir dos dados JÁ calculados por buildOrderArgs + o orderId confirmado pela persistência
   — sem query adicional, sem duplicar regra de negócio. buildComanda/comandaTexto(contexto:'cliente')
   são a MESMA função pura usada na comanda do Admin (ver comandaModel.js/comandaTexto.js).
   troco: só o checkout tem esse dado (nunca persistido, ver ADR REF-ORDER-01 §5 — gap honesto).
   opts.enderecoEstruturado (REF-CHECKOUT-03): o objeto do domínio Address (rua/numero/complemento/
   bairro/cidade/estado/cep/referência — mesmo shape que DS.getPedidoEndereco devolve pro Admin, ver
   comandaModel.enderecoEstruturadoEmLinhas) já disponível no CheckoutPage no instante do submit —
   nenhuma query nova, só deixa de descartar um dado que já existia. null/ausente (retirada, ou
   endereço sem detalhamento) cai no fallback de texto livre de sempre.
   opts.createdAt (opcional): injeta o instante da montagem — default new Date() (o momento real da
   confirmação); parametrizável só para o golden test determinístico (tests/checkout.golden.mjs).
   opts.deliveryEtaMin (REF-GOLIVE-01): tempo de entrega configurado pelo Admin (useDeliveryEta, lido
   uma vez em StoreApp e repassado por CheckoutPage) — a mensagem que abre no WhatsApp do cliente deixa
   de mostrar "35 a 45 min" fixo e passa a bater com o mesmo valor da comanda/Admin. Ausente cai no
   fallback de buildComanda/textoTempoEntrega (compatível com chamadas antigas, ex.: testes). */
export function buildOrderConfirmationMessage(customer, order, items, orderId, opts = {}) {
  const orderSnapshot = {
    id: orderId,
    created_at: (opts.createdAt || new Date()).toISOString(),
    total: order.total,
    address: order.address,
    payment_method: order.payment_method,
    observacoes: order.observacoes,
    order_items: items,
    customers: { name: customer.name, phone: customer.phone },
  };
  const vm = buildComanda(orderSnapshot, {
    companyInfo: opts.companyInfo,
    troco: opts.troco,
    enderecoEstruturado: opts.enderecoEstruturado,
    deliveryEtaMin: opts.deliveryEtaMin,
  });
  return comandaTexto(vm, { contexto: 'cliente' });
}

/* Resumo do checkout: reproduz EXATAMENTE o que o render calculava inline
   (`{i.nome} x{i.qty}` + `fmt(precoLinha(i))`; total `fmt(cart.total)`).
   O componente passa a só consumir este view-model (não recalcula preço). */
export function buildCheckoutView(cart) {
  return {
    itens: cart.items.map(i => ({ key: i._key, nome: i.nome, qty: i.qty, valor: fmt(precoLinha(i)) })),
    total: fmt(cart.total),
  };
}
