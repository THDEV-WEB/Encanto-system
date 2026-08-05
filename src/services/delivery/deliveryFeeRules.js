/* services/delivery/deliveryFeeRules.js — REF-DELIVERY-FEE-01.
   CAMADA UNICA da regra de negocio da taxa de entrega automatica por distancia: localizar a faixa,
   calcular a taxa, calcular o acrescimo de retorno da maquininha e montar o resumo financeiro do pedido.
   Modulo 100% PURO (sem React/IO/Supabase/Date.now, mesma disciplina de utils/pricing.js) — recebe a
   distancia e a configuracao JA carregados (a camada de IO fica em deliveryFeeConfig.js/
   useDeliveryFeeConfig.js) e devolve numeros crus. TODOS os consumidores (Checkout em tempo real,
   persistencia do pedido, comanda, mensagem WhatsApp) usam ESTE modulo — exigencia da REF-DELIVERY-FEE-01
   de nunca duplicar a regra de negocio.

   Distancia: o haversine mora em address/utils/coordinates.js (dominio Address ja possui lat/lng/
   formatarCoord/CENTRO_PADRAO) — este modulo so CONSOME distanciaKm (numero ou null), nunca recalcula
   geometria.

   FALLBACK (decisao do dono, 2026-08-05): quando a distancia nao pode ser determinada (endereco sem
   coordenadas mesmo apos tentar geocodificar de novo) OU a distancia calculada ultrapassa a maior faixa
   cadastrada, o pedido NUNCA e bloqueado — segue com taxa de entrega R$0,00 e o `status` do resumo avisa a
   UI para mostrar "confirmamos o valor da entrega pelo WhatsApp" (nunca finge um valor que nao foi
   calculado). O acrescimo de maquininha e INDEPENDENTE do estado da taxa por distancia (toggle proprio no
   Admin) — so nao se aplica na retirada (sem motoboy) ou fora das formas de pagamento com cartao. */

/* Formas de pagamento que exigem o motoboy levar a maquininha fisica (a central de motoboys so cobra o
   retorno nesses casos — dinheiro e troco em especie, PIX e QR code, nenhum dos dois usa o aparelho). */
export const MAQUININHA_METODOS = ['cartao_debito', 'cartao_credito'];

/* Localiza a faixa de MENOR "ate" que seja >= distanciaKm — as faixas sao contiguas por design (cada "de"
   comeca logo apos o "ate" anterior, ex. 5.0 -> 5.1 na tabela padrao), entao este criterio nunca deixa uma
   distancia continua cair num buraco de cobertura entre 2 faixas cadastradas. null quando a distancia for
   invalida ou maior que a maior faixa cadastrada (fora de alcance). */
export function localizarFaixa(distanciaKm, faixas) {
  if (!Number.isFinite(distanciaKm) || distanciaKm < 0) return null;
  const lista = Array.isArray(faixas) ? faixas : [];
  const ordenadas = lista.slice().sort((a, b) => a.ate - b.ate);
  return ordenadas.find((f) => distanciaKm <= f.ate) || null;
}

/* Acrescimo de retorno da maquininha — depende SOMENTE da forma de pagamento + do toggle do Admin, nunca
   da distancia/faixa. */
export function calcularMaquininhaFee(paymentMethod, maquininhaConfig) {
  const cfg = maquininhaConfig || {};
  if (!cfg.ativo) return 0;
  if (!MAQUININHA_METODOS.includes(paymentMethod)) return 0;
  return Number(cfg.valor) || 0;
}

/* Resumo financeiro do pedido — FONTE UNICA consumida por Checkout (tempo real)/buildOrderArgs
   (persistencia)/buildOrderConfirmationMessage (WhatsApp)/comandaModel (Admin + comanda impressa).
   entrada:
     subtotal      : Number — cart.total (soma dos itens, de utils/pricing.js)
     retirada      : boolean — retirada na loja nunca tem taxa de entrega nem maquininha (sem motoboy)
     distanciaKm   : number|null — null quando nao foi possivel calcular (sem coordenadas do cliente/loja)
     config        : objeto delivery_fee_config { ativo, maquininha:{ativo,valor}, faixas:[{de,ate,valor}] }
     paymentMethod : string — forma de pagamento escolhida no checkout
   saida (sempre preenchida, nunca undefined):
     { subtotal, distanciaKm, faixa, deliveryFee, maquininhaFee, total, status }
     status: 'retirada' | 'desativado' | 'sem_coordenadas' | 'fora_de_alcance' | 'ok' */
export function montarResumoFinanceiro({ subtotal, retirada, distanciaKm, config, paymentMethod }) {
  const sub = Number(subtotal) || 0;
  const cfg = config || {};

  if (retirada) {
    return { subtotal: sub, distanciaKm: null, faixa: null, deliveryFee: 0, maquininhaFee: 0, total: sub, status: 'retirada' };
  }

  const maquininhaFee = calcularMaquininhaFee(paymentMethod, cfg.maquininha);

  if (!cfg.ativo) {
    return { subtotal: sub, distanciaKm: Number.isFinite(distanciaKm) ? distanciaKm : null, faixa: null, deliveryFee: 0, maquininhaFee, total: sub + maquininhaFee, status: 'desativado' };
  }
  if (!Number.isFinite(distanciaKm)) {
    return { subtotal: sub, distanciaKm: null, faixa: null, deliveryFee: 0, maquininhaFee, total: sub + maquininhaFee, status: 'sem_coordenadas' };
  }

  const faixa = localizarFaixa(distanciaKm, cfg.faixas);
  if (!faixa) {
    return { subtotal: sub, distanciaKm, faixa: null, deliveryFee: 0, maquininhaFee, total: sub + maquininhaFee, status: 'fora_de_alcance' };
  }

  const deliveryFee = Number(faixa.valor) || 0;
  return { subtotal: sub, distanciaKm, faixa, deliveryFee, maquininhaFee, total: sub + deliveryFee + maquininhaFee, status: 'ok' };
}
