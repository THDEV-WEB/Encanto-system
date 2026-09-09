/* pagamento/services/pagamentoService.js — REF-PAGAMENTO-01 · Onda 5.
   Camada ÚNICA que o checkout consome para pagamento online — mesmo princípio de
   routeDistanceService.js (checkout nunca fala com Supabase/Edge Function diretamente, só por aqui).

   3 operações, nesta ordem no fluxo real:
     1) iniciarPagamento(orderId)      -> RPC iniciar_pagamento_pedido (cria/reaproveita payment_intent)
     2) criarCobranca({...})           -> Edge Function mp-criar-cobranca (ÚNICA chamada real ao Mercado
                                           Pago, com o token que o Brick devolveu no onSubmit)
     3) consultarStatusPagamento(id)   -> RPC consultar_status_pagamento (polling da tela de espera)

   `{invocar}` injetado em cada função — mesmo precedente de criarCalculadoraDistancia
   (routeDistanceService.js) — permite testar toda a orquestração com fakes determinísticos, sem rede/
   Supabase real. */
import { db } from '../../lib/supabase.js';
import { buildStorefrontRpcParam } from '../../services/storefrontStore.js';

const TIMEOUT_MS = 15000; // mesma ordem de grandeza do timeout da própria Edge Function (Onda 3)

async function invocarIniciarPagamento(orderId) {
  if (!db) return { data: null, error: new Error('supabase_indisponivel') };
  return db.rpc('iniciar_pagamento_pedido', { p_order_id: orderId, ...buildStorefrontRpcParam() });
}
export function criarIniciarPagamento({ invocar = invocarIniciarPagamento } = {}) {
  return async function iniciarPagamento(orderId) {
    try {
      const { data, error } = await invocar(orderId);
      if (error || !data) return { ok: false, error: 'falha ao iniciar pagamento' };
      return data; // {ok, payment_intent_id, idempotency_key, amount} | {ok:false, error}
    } catch {
      return { ok: false, error: 'falha ao iniciar pagamento' };
    }
  };
}
export const iniciarPagamento = criarIniciarPagamento();

async function invocarCriarCobranca(body, timeoutMs) {
  if (!db) return { data: null, error: new Error('supabase_indisponivel') };
  return db.functions.invoke('mp-criar-cobranca', { body, timeout: timeoutMs });
}
export function criarCriarCobranca({ invocar = invocarCriarCobranca, timeoutMs = TIMEOUT_MS } = {}) {
  return async function criarCobranca({ paymentIntentId, paymentMethodId, token, installments, issuerId, payer }) {
    try {
      const { data, error } = await invocar({
        payment_intent_id: paymentIntentId, payment_method_id: paymentMethodId,
        ...(token ? { token } : {}), ...(installments ? { installments } : {}), ...(issuerId ? { issuer_id: issuerId } : {}),
        ...(payer ? { payer } : {}),
      }, timeoutMs);
      if (error) return { ok: false, error: data?.error || error.message || 'falha ao criar cobranca' };
      return data; // {ok, mp_payment_id, status, status_detail} | {ok:false, error}
    } catch {
      return { ok: false, error: 'falha ao criar cobranca' };
    }
  };
}
export const criarCobranca = criarCriarCobranca();

async function invocarConsultarStatus(paymentIntentId) {
  if (!db) return { data: null, error: new Error('supabase_indisponivel') };
  return db.rpc('consultar_status_pagamento', { p_payment_intent_id: paymentIntentId });
}
export function criarConsultarStatusPagamento({ invocar = invocarConsultarStatus } = {}) {
  return async function consultarStatusPagamento(paymentIntentId) {
    try {
      const { data, error } = await invocar(paymentIntentId);
      if (error || !data) return { ok: false, error: 'falha ao consultar status' };
      return data; // {ok, status, order_id} | {ok:false, error}
    } catch {
      return { ok: false, error: 'falha ao consultar status' };
    }
  };
}
export const consultarStatusPagamento = criarConsultarStatusPagamento();
