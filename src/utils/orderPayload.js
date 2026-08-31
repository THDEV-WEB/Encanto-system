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
import { precoUnitario, precoLinha, precoBaseItem } from './pricing.js';
import { fmt, precoTamanho } from './format.js';
import { isUuid } from './ids.js';
/* REF-CHECKOUT-02: reaproveita a MESMA camada de domínio da comanda (Admin) para montar a mensagem
   de confirmação do cliente — única fonte de verdade, ver buildOrderConfirmationMessage abaixo.
   comandaModel/comandaTexto são módulos PUROS (sem React/IO — só compõem utils/format), moram em
   components/admin/comanda/ por onde foram usados primeiro; nada impede reuso fora do Admin. */
import { buildComanda } from '../components/admin/comanda/comandaModel.js';
import { comandaTexto } from '../components/admin/comanda/comandaTexto.js';

export function buildOrderArgs(cart, form, endereco, requestId, enderecoId, resumo) {
  const customer = { name: form.nome, phone: form.telefone };
  /* REF-CHECKOUT-ADDRESS-01: o endereco vem da FONTE UNICA (dominio Address), passado explicitamente —
     nunca mais de um form.endereco paralelo. O que e persistido no pedido e EXATAMENTE o exibido/confirmado.
     REF-ADDRESS-02 · Onda 6: enderecoId (uuid de addresses, ou null p/ retirada/offline/legado) viaja dentro
     do MESMO p_order jsonb — create_order le p_order->>'endereco_id' e grava em orders.endereco_id.
     REF-DELIVERY-FEE-01: resumo (services/delivery/deliveryFeeRules.montarResumoFinanceiro) e OPCIONAL —
     ausente cai no total antigo (cart.total, sem taxa), compat com qualquer chamador que ainda nao calcule
     a taxa (ex.: golden tests). Quando presente, e a FONTE UNICA de total/delivery_fee/maquininha_fee —
     nunca recalculado aqui.
     REF-DELIVERY-FEE-04: delivery_fee/maquininha_fee/retirada enviados aqui sao ADVISORY apenas — o
     servidor (create_order) sempre recalcula os dois primeiros do zero (_resolve_delivery_fee), ignorando
     por completo o que o client mandar; retirada (novo campo, derivado do MESMO resumo.status que ja
     existia) e o unico dos tres que o servidor de fato LE, pra decidir se zera a taxa incondicionalmente. */
  const order = { total: resumo ? resumo.total : cart.total, status: 'recebido', payment_method: form.pagamento,
                  address: endereco, observacoes: form.obs || null, endereco_id: enderecoId ?? null,
                  delivery_fee: resumo ? resumo.deliveryFee : 0, maquininha_fee: resumo ? resumo.maquininhaFee : 0,
                  retirada: resumo ? resumo.status === 'retirada' : false };
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
      /* REF-PRICE-SOURCE-01: identifica QUAL tamanho foi escolhido (dado de escolha do cliente, não
         financeiro) para o servidor localizar o preço autoritativo em products.tamanhos[].preco —
         nunca o preço em si, que o servidor sempre recalcula do banco. Derivado do item do carrinho
         (nunca alterado no momento da adição — ver ProductModalInner.jsx): casa o `preco` já resolvido
         do item com o `tamanhos[].preco` original do produto (mesma função precoTamanho, tolerante a
         legado 'price'). Cobre tanto item novo quanto item de carrinho persistido antes desta REF
         (localStorage, TTL 12h) — ambos guardam `tamanhos` completo + `preco` do tamanho escolhido.
         Sem correspondência (ou produto sem tamanhos) → null, e o servidor cai no 1º tamanho, mesmo
         fallback que o client já usa (tamanho||prod.tamanhos[0]). */
      tamanho_label: Array.isArray(i.tamanhos)
        ? (i.tamanhos.find(t => precoTamanho(t) === Number(i.preco))?.label ?? null)
        : null,
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
    /* REF-DELIVERY-FEE-01: mesmos valores JA calculados por buildOrderArgs/montarResumoFinanceiro (order
       vem do MESMO submit, sem query nova) — a mensagem bate com o que foi persistido no pedido. */
    delivery_fee: order.delivery_fee,
    maquininha_fee: order.maquininha_fee,
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
   O componente passa a só consumir este view-model (não recalcula preço).
   REF-DELIVERY-FEE-01: `resumo` (montarResumoFinanceiro) é OPCIONAL — ausente preserva o contrato antigo
   (só itens + total = subtotal). Presente, acrescenta subtotal/entrega/maquininha formatados (fmt), e o
   `total` passa a refletir o TOTAL do resumo (subtotal + taxa + maquininha) — o valor real cobrado do
   cliente. entregaFmt/maquininhaFmt ficam `null` quando a parcela é zero (o componente decide se omite a
   linha) — nunca uma string "R$ 0,00" enganosa. */
export function buildCheckoutView(cart, resumo) {
  const itens = cart.items.map(i => ({ key: i._key, nome: i.nome, qty: i.qty, valor: fmt(precoLinha(i)) }));
  if (!resumo) return { itens, total: fmt(cart.total) };
  return {
    itens,
    subtotal: fmt(resumo.subtotal),
    entregaFmt: resumo.deliveryFee > 0 ? fmt(resumo.deliveryFee) : null,
    maquininhaFmt: resumo.maquininhaFee > 0 ? fmt(resumo.maquininhaFee) : null,
    total: fmt(resumo.total),
  };
}

/* REF-DELIVERY-FEE-04 · Onda 2: view-model da divergência de valor (create_order recalculou e
   recusou persistir silenciosamente — ver DataService.savePedido). Reaproveita fmt() deste módulo
   (G-CK2: CheckoutPage não importa format.js diretamente). `resumoExibido` é o resumo local (o que
   o cliente via na tela); `autoritativo` vem de DS.savePedido ({ deliveryFee, maquininhaFee }, os
   valores que o servidor de fato vai cobrar). Mensagem descreve só a(s) parcela(s) que realmente
   mudou(aram) — nunca inventa uma mudança que não ocorreu. */
export function buildDivergenciaView(resumoExibido, autoritativo) {
  const partes = [];
  if (autoritativo.deliveryFee !== resumoExibido.deliveryFee) {
    partes.push(`entrega de ${fmt(resumoExibido.deliveryFee)} para ${fmt(autoritativo.deliveryFee)}`);
  }
  if (autoritativo.maquininhaFee !== resumoExibido.maquininhaFee) {
    partes.push(`retorno da maquininha de ${fmt(resumoExibido.maquininhaFee)} para ${fmt(autoritativo.maquininhaFee)}`);
  }
  const totalNovo = resumoExibido.subtotal + autoritativo.deliveryFee + autoritativo.maquininhaFee;
  return {
    mensagem: partes.length
      ? `Para garantir o valor correto, atualizamos o valor de ${partes.join(' e ')}.`
      : 'Atualizamos o valor do seu pedido — confira antes de continuar.',
    totalFmt: fmt(totalNovo),
  };
}

/* REF-CART-PRICE-DRIFT-01: aviso não-bloqueante quando o preço CONGELADO no carrinho (no instante
   em que o item foi adicionado, ver ProductModalInner.jsx) diverge do preço ATUAL do mesmo produto
   no catálogo vivo — pura transparência pro cliente, o servidor (create_order/_resolve_item_pricing)
   já é a única autoridade financeira e sempre recalcula certo independente disto. Reaproveita
   precoBaseItem (pricing.js) + precoTamanho/fmt (format.js) deste módulo (G-CK2: CheckoutPage não
   importa pricing/format direto).
   Escopo: preço BASE do produto (cheio, promoção, ou do tamanho escolhido) — adicionais ficam de
   fora (mudança de preço de adicional é cenário mais raro; cobri-la exigiria carregar a lista viva
   de adicionais no checkout, hoje não usada ali).
   produtosVivos ausente/vazio (catálogo ainda carregando) -> null, nunca falso positivo. Produto do
   carrinho sem correspondência em produtosVivos (removido do catálogo) -> ignorado (não é "preço
   mudou", é "produto não existe mais", tratado à parte por create_order()). Item com tamanhos: acha
   o tamanho escolhido comparando precoTamanho(t) === Number(item.preco) — MESMA técnica já usada em
   buildOrderArgs (acima) para achar tamanho_label — e busca esse label no produto vivo; sem
   correspondência de label, ignora esse item (evita falso positivo por rename/remoção do tamanho). */
export function buildPrecoDivergenteView(cart, produtosVivos) {
  if (!Array.isArray(produtosVivos) || produtosVivos.length === 0) return null;
  const porId = new Map(produtosVivos.map(p => [p.id, p]));
  const partes = [];
  for (const item of cart.items) {
    const vivo = porId.get(item.id);
    if (!vivo) continue;
    let precoAtual;
    if (Array.isArray(item.tamanhos) && item.tamanhos.length > 0) {
      const label = item.tamanhos.find(t => precoTamanho(t) === Number(item.preco))?.label;
      const tamanhoVivo = label && Array.isArray(vivo.tamanhos) ? vivo.tamanhos.find(t => t.label === label) : null;
      if (!tamanhoVivo) continue;
      precoAtual = precoTamanho(tamanhoVivo);
    } else {
      precoAtual = Number(vivo.preco_promo || vivo.preco);
    }
    const precoAntigo = precoBaseItem(item);
    if (precoAtual !== precoAntigo) partes.push(`${item.nome} de ${fmt(precoAntigo)} para ${fmt(precoAtual)}`);
  }
  if (partes.length === 0) return null;
  return { mensagem: `Atualizamos o preço de ${partes.join(', ')}. O valor final é sempre conferido na confirmação.` };
}
