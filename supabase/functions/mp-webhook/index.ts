// supabase/functions/mp-webhook/index.ts — REF-PAGAMENTO-01 · Onda 4.
// EDGE FUNCTION (Deno) pública — endpoint que o Mercado Pago chama de verdade quando o status de um
// pagamento muda (aprovado, recusado, contestado, etc.). Zero migration nova nesta onda: toda a
// lógica de validação/máquina de estados/idempotência já existe e já foi testada na Onda 2
// (_validar_assinatura_webhook_mp, _transicao_payment_status_valida,
// _processar_webhook_payment_intent, _webhook_mercadopago_recebido) — esta função só é o TRANSPORTE
// que alimenta aquelas funções com dados reais.
//
// PONTO DE CREDENCIAL (2 secrets manuais):
//   supabase secrets set MP_WEBHOOK_SECRET=...   (obtido registrando a URL desta função no painel
//                                                  "Webhooks" da aplicação do Mercado Pago)
//   MP_ACCESS_TOKEN já existe (Onda 3) — reaproveitado aqui pra consultar o pagamento real.
//
// POR QUE UMA CHAMADA GET /v1/payments/{id} DEPOIS DO WEBHOOK: a notificação do Mercado Pago NUNCA
// traz o status no corpo -- só {type, action, data:{id}}. O status TEM que ser buscado de volta na
// API (recomendação oficial do MP, evita confiar em payload que poderia ter sido adulterado antes
// da validação de assinatura cobrir só a integridade do ID, não do status).
//
// VALIDACAO DE ASSINATURA REIMPLEMENTADA EM TS (Web Crypto), NAO via chamada SQL: o objetivo e'
// nunca tocar o banco (nem leitura) para uma assinatura forjada -- mesmo principio "assinatura
// invalida nunca toca o banco" ja documentado na Onda 2, levado um passo adiante (nem uma consulta
// de leitura acontece antes da validacao). Mesmo manifest/algoritmo EXATO da funcao SQL
// _validar_assinatura_webhook_mp (Onda 2) -- testado par-a-par contra ela em
// scripts/pagamento-01-onda4-webhook-real-test.mjs antes do deploy (2 implementacoes independentes
// concordando, mesmo padrao ja usado pro HMAC em si na Onda 2).
//
// STORE_ID: resolvido por LEITURA em payment_intents (service_role) usando o mp_payment_id do
// proprio payload -- SO' depois da assinatura validada. Payload legitimo do MP mas sem
// payment_intent correspondente (evento de outro produto/teste antigo) -> 200 "ignorado", nunca erro
// (Mercado Pago reenvia em retry agressivo qualquer coisa que nao seja 2xx).
//
// _webhook_mercadopago_recebido e' chamada mesmo apos a validacao propria em TS -- redundancia
// deliberada (defesa em profundidade): se as duas implementacoes um dia divergirem por um bug, o
// processamento para em vez de prosseguir so' na confianca de uma delas.

import { createClient } from "npm:@supabase/supabase-js@2";

const MP_PAYMENTS_URL = "https://api.mercadopago.com/v1/payments/";
const MP_TIMEOUT_MS = 15000;
const JANELA_PASSADO_MS = 10 * 60 * 1000; // espelha _validar_assinatura_webhook_mp (Onda 2)
const JANELA_FUTURO_MS = 2 * 60 * 1000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const serviceClient = (SUPABASE_URL && SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

async function hmacSha256Hex(secret: string, mensagem: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(mensagem));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Mesmo manifest/janela de frescor EXATOS de _validar_assinatura_webhook_mp (Onda 2, migration
// REF-PAGAMENTO-01-onda2-webhook-fundacao.sql) -- qualquer mudanca aqui exige mudar la tambem (e
// reverificar par-a-par, ver scripts/pagamento-01-onda4-webhook-real-test.mjs).
export async function validarAssinatura(dataId: string, xRequestId: string, xSignature: string, secret: string): Promise<boolean> {
  if (!dataId || !xRequestId || !xSignature || !secret) return false;
  const tsMatch = xSignature.match(/ts=([0-9]+)/);
  const v1Match = xSignature.match(/v1=([0-9a-fA-F]+)/);
  if (!tsMatch || !v1Match) return false;
  const ts = tsMatch[1];
  const v1 = v1Match[1].toLowerCase();
  // FIX Onda 4: "ts" do Mercado Pago vem em SEGUNDOS desde epoch (confirmado empiricamente contra
  // um webhook real -- ver migration REF-PAGAMENTO-01-onda4-fix-timestamp-assinatura.sql), nao
  // milissegundos como Date.now(). Converte pra ms antes de comparar.
  const tsSegundos = Number(ts);
  if (!Number.isFinite(tsSegundos)) return false;
  const tsMs = tsSegundos * 1000;
  const agora = Date.now();
  if (tsMs < agora - JANELA_PASSADO_MS || tsMs > agora + JANELA_FUTURO_MS) return false;
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const esperado = await hmacSha256Hex(secret, manifest);
  return esperado === v1;
}

// Mesmo vocabulario/mapeamento de supabase/functions/mp-criar-cobranca/index.ts (Onda 3) --
// MIRRORADO de proposito (mesmo precedente de route-distance/routeCache.js), nao compartilhado via
// import: sao 2 Edge Functions independentes, cada uma implanta isolada.
// REF-PAYMENT-SEC-02 · Onda 2 (achado HIGH-02): refunded/charged_back/in_mediation nunca eram
// mapeados -- caiam no default 'pendente', que _transicao_payment_status_valida recusava vindo de
// 'aprovado' (nao e' uma transicao valida) -- o webhook de estorno real era descartado em silencio
// (a Edge Function ainda respondia 200 pro Mercado Pago, que entao nunca reenviava). in_mediation e'
// o estado intermediario de contestacao (disputa aberta, ainda sem resultado); refunded/charged_back
// sao a reversao efetiva do dinheiro -- ambos ja eram transicoes VALIDAS desde 'aprovado'/
// 'em_contestacao' (_transicao_payment_status_valida nao mudou, so o mapeamento estava quebrado).
function mapearStatusMp(status: string): string {
  switch (status) {
    case "approved": return "aprovado";
    case "rejected": return "recusado";
    case "cancelled": return "recusado";
    case "pending":
    case "in_process":
    case "authorized":
      return "pendente";
    case "in_mediation": return "em_contestacao";
    case "refunded":
    case "charged_back":
      return "estornado";
    default:
      return "pendente";
  }
}

function extrairDataId(url: URL, body: Record<string, unknown> | null): string | null {
  const daQuery = url.searchParams.get("data.id") || url.searchParams.get("id");
  if (daQuery) return daQuery;
  const data = body?.data as { id?: unknown } | undefined;
  if (data?.id !== undefined && data.id !== null) return String(data.id);
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "GET" || req.method === "HEAD") return new Response(null, { status: 200 }); // health check do MP ao registrar a URL
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405 });

  const url = new URL(req.url);
  let body: Record<string, unknown> | null = null;
  try { body = await req.json(); } catch { /* corpo vazio/invalido -- data.id pode vir so' da query */ }

  const dataId = extrairDataId(url, body);
  const xRequestId = req.headers.get("x-request-id") || "";
  const xSignature = req.headers.get("x-signature") || "";

  if (!dataId) return new Response(JSON.stringify({ ok: false, error: "data_id_ausente" }), { status: 400 });

  const secret = Deno.env.get("MP_WEBHOOK_SECRET");
  if (!secret) return new Response(JSON.stringify({ ok: false, error: "not_configured" }), { status: 503 });

  // 1) Assinatura ANTES de qualquer coisa -- nem uma leitura no banco acontece antes disto passar.
  const assinaturaValida = await validarAssinatura(dataId, xRequestId, xSignature, secret);
  if (!assinaturaValida) {
    console.error("[mp-webhook] assinatura invalida, data_id=", dataId);
    return new Response(JSON.stringify({ ok: false, error: "assinatura_invalida" }), { status: 401 });
  }

  if (!serviceClient) return new Response(JSON.stringify({ ok: false, error: "servico_indisponivel" }), { status: 503 });

  const accessToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!accessToken) return new Response(JSON.stringify({ ok: false, error: "not_configured" }), { status: 503 });

  // 2) Busca o pagamento REAL na API -- nunca confia em status vindo do corpo da notificacao.
  let mpJson: Record<string, unknown> | null;
  try {
    const mpResp = await fetch(MP_PAYMENTS_URL + encodeURIComponent(dataId), {
      headers: { "Authorization": `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(MP_TIMEOUT_MS),
    });
    mpJson = await mpResp.json().catch(() => null);
    if (!mpResp.ok || !mpJson || typeof mpJson.status !== "string") {
      console.error("[mp-webhook] falha ao consultar pagamento real, data_id=", dataId, "http=", mpResp.status);
      // 200 (nao 5xx): erro do NOSSO lado ao consultar nao deve virar retry infinito do MP por um
      // pagamento que pode nem existir mais (ex.: id de teste antigo) -- loga, nao processa, segue.
      return new Response(JSON.stringify({ ok: false, error: "falha_ao_consultar_pagamento" }), { status: 200 });
    }
  } catch {
    // Timeout/erro de rede falando com o MP -- o MP vai reenviar o webhook depois, entao um erro
    // aqui (nao-2xx) e' o comportamento CORRETO (retry legitimo, diferente do caso acima).
    return new Response(JSON.stringify({ ok: false, error: "timeout_consultando_mercadopago" }), { status: 502 });
  }

  // 3) Resolve store_id pelo NOSSO registro (mp_payment_id gravado na Onda 3/webhook anterior) --
  // evento sem payment_intent correspondente (produto diferente, teste antigo) -> ignora, 200.
  const { data: pi, error: piErr } = await serviceClient
    .from("payment_intents")
    .select("store_id")
    .eq("mp_payment_id", dataId)
    .maybeSingle();
  if (piErr) return new Response(JSON.stringify({ ok: false, error: "erro_ao_consultar_payment_intent" }), { status: 500 });
  if (!pi) return new Response(JSON.stringify({ ok: true, ignorado: true, motivo: "payment_intent_nao_encontrado" }), { status: 200 });

  const statusInterno = mapearStatusMp(String(mpJson.status));
  const statusDetail = typeof mpJson.status_detail === "string" ? mpJson.status_detail : null;

  // 4) Processa -- _webhook_mercadopago_recebido revalida a assinatura (defesa em profundidade) e
  // delega pra _processar_webhook_payment_intent (maquina de estados/idempotencia, Onda 2).
  const { data: resultado, error: rpcErr } = await serviceClient.rpc("_webhook_mercadopago_recebido", {
    p_data_id: dataId,
    p_x_request_id: xRequestId,
    p_x_signature: xSignature,
    p_novo_status: statusInterno,
    p_status_detail: statusDetail,
    p_store_id_esperado: pi.store_id,
    p_secret: secret,
    p_raw_payload: mpJson,
  });

  if (rpcErr) {
    console.error("[mp-webhook] erro ao processar:", rpcErr.message, "data_id=", dataId);
    return new Response(JSON.stringify({ ok: false, error: "erro_ao_processar" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, resultado }), { status: 200 });
});
