/* utils/orderPayload.js — REF-APP-01 · Onda 5.2 (Trilha B · order-domain).
   FONTE ÚNICA de derivação/formatação do pedido (INV-CK). Lógica PURA movida de dentro do
   CheckoutPage.submit (App.jsx) SEM alteração de comportamento — apenas realocada:
     - buildOrderArgs      → monta os args de DS.savePedido (customer/order/items) — antes inline no submit;
     - buildWhatsAppMessage→ monta a string do WhatsApp — antes inline no submit;
     - buildCheckoutView   → view-model do resumo (linhas + total já formatados) — antes calculado no render.
   Compõe pricing/format/ids (permitido a folha de domínio em utils/; G-CK3 exige só PUREZA — sem
   React/IO/DataService/hooks). É consumidor de domínio (pricing) → entra na allowlist D1 do test:deps.
   buildOrderArgs/buildWhatsAppMessage são byte-equivalentes ao espelho congelado em tests/checkout.golden.mjs
   (por isso o golden troca o espelho pelo import real mantendo GOLDEN_PAYLOAD/GOLDEN_MSG idênticos). */
import { precoUnitario, precoLinha } from './pricing.js';
import { fmt } from './format.js';
import { isUuid } from './ids.js';

export function buildOrderArgs(cart, form, requestId) {
  const customer = { name: form.nome, phone: form.telefone };
  const order = { total: cart.total, status: 'recebido', payment_method: form.pagamento,
                  address: form.endereco, observacoes: form.obs || null };
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

export function buildWhatsAppMessage(cart, form) {
  let msg = `*🛍️ Novo Pedido - Encanto*\n\n`;
  msg += `*Cliente:* ${form.nome}\n*Telefone:* ${form.telefone}\n*Endereço:* ${form.endereco}\n\n*📋 Itens:*\n`;
  cart.items.forEach(i => {
    msg += `• ${i.nome} x${i.qty} — ${fmt(precoLinha(i))}\n`;
    if (i.adicionais?.length) msg += `  ↳ ${i.adicionais.map(a => a.nome).join(', ')}\n`;
    if (i.obs) msg += `  ↳ Obs: ${i.obs}\n`;
  });
  msg += `\n*💰 Total: ${fmt(cart.total)}*\n*Pagamento:* ${form.pagamento}`;
  if (form.troco) msg += ` (troco p/ ${form.troco})`;
  if (form.obs) msg += `\n*Obs:* ${form.obs}`;
  return msg;
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
