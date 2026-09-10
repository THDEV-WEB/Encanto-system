// supabase/functions/mp-criar-cobranca/index.ts — REF-PAGAMENTO-01 · Onda 3.
// EDGE FUNCTION (Deno) = UNICO ponto onde MP_ACCESS_TOKEN vive (segredo do servidor). Recebe o
// resultado da tokenizacao do Payment Brick (token/payment_method_id/installments/issuer_id/payer —
// a tokenizacao em si acontece no NAVEGADOR do cliente, direto com o SDK do Mercado Pago usando a
// Public Key, nunca passa por aqui) + payment_intent_id (criado antes via RPC iniciar_pagamento_pedido,
// migration da Onda 3), chama a API classica /v1/payments do Mercado Pago, e grava o resultado via
// _registrar_criacao_pagamento (RPC interna, service_role).
//
// PONTO DE CREDENCIAL (unico secret manual):
//   supabase secrets set MP_ACCESS_TOKEN=...   (projeto E2E enquanto esta REF nao chega em producao)
// (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY sao injetados automaticamente pela plataforma em toda Edge
// Function, mesmo precedente de route-distance/invite-store-admin — nenhum `supabase secrets set`
// necessario pra esses dois.)
//
// ACHADO da Onda 3: MP_ACCESS_TOKEN NAO fica no Vault do Postgres (onde a Onda 2 tinha colocado por
// analogia ao WhatsApp) — o WhatsApp fala com a API de dentro do proprio Postgres via pg_net, nunca
// passa por uma Edge Function. Aqui, quem fala com a API e esta funcao Deno, entao o secret vive
// exatamente onde toda Edge Function existente no projeto ja busca segredo: `supabase secrets set` /
// Deno.env — nao existe precedente no projeto de Edge Function lendo o Vault do Postgres direto.
//
// DECISAO DE API: /v1/payments (classica), nao a Orders API unificada — e' a integracao server-side
// OFICIALMENTE documentada pelo Mercado Pago pra uso com Payment Brick. Orders API fica mapeada pra
// quando/se Split 1:1 avancar (multiplos recebedores por pagamento).
//
// STORE_ID/ORDER_ID/AMOUNT: NUNCA confiados do corpo da requisicao — sempre relidos de
// payment_intents (service_role, bypassa RLS por design) usando SO' o payment_intent_id recebido.
// Cliente nao pode inflar/deflacionar o valor cobrado nem apontar pra loja errada.
//
// IDEMPOTENCY-KEY: sempre a idempotency_key JA GRAVADA no payment_intent (nunca gerada aqui) — um
// retry de rede do MESMO payment_intent_id reaproveita a MESMA chave, entao o Mercado Pago devolve o
// MESMO pagamento em vez de criar um 2o (protecao oficial da API, exigida desde 2024).

import { createClient } from "npm:@supabase/supabase-js@2";

const MP_API_URL = "https://api.mercadopago.com/v1/payments";
const MP_TIMEOUT_MS = 15000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const serviceClient = (SUPABASE_URL && SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

// Mesmo padrao de rate limit leve por IP ja usado em route-distance — aqui a chamada e mais cara
// (mutacao financeira real), teto mais conservador.
const RATE_LIMIT_JANELA_MS = 60_000;
const RATE_LIMIT_MAX_POR_JANELA = 10;
const MAX_ENTRADAS_RATE_LIMIT = 1000;
const rateLimitPorIp = new Map<string, number[]>();
function ipPermitido(ip: string): boolean {
  const agora = Date.now();
  if (rateLimitPorIp.size >= MAX_ENTRADAS_RATE_LIMIT) rateLimitPorIp.clear();
  const chamadas = (rateLimitPorIp.get(ip) ?? []).filter((t) => agora - t < RATE_LIMIT_JANELA_MS);
  if (chamadas.length >= RATE_LIMIT_MAX_POR_JANELA) { rateLimitPorIp.set(ip, chamadas); return false; }
  chamadas.push(agora);
  rateLimitPorIp.set(ip, chamadas);
  return true;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

// Vocabulario da API do Mercado Pago -> vocabulario interno (_transicao_payment_status_valida,
// Onda 2). 'in_mediation'/'refunded'/'charged_back' nao deveriam aparecer numa resposta de CRIACAO
// (sao estados pos-aprovacao, alcancados depois via webhook) -- mas REF-PAYMENT-SEC-02 · Onda 2
// (achado HIGH-02) mapeia mesmo assim, MIRRORADO com mp-webhook/index.ts (mesmo precedente de
// sempre manter as 2 funcoes identicas): se por algum motivo a API de criacao um dia devolver um
// desses valores, mapear pra 'estornado'/'em_contestacao' e' honesto (reflete o que realmente
// aconteceu) e nao "aprova/rejeita por engano" -- a preocupacao original deste comentario nunca
// se aplicou a esses 2 valores. O valor CRU do MP sempre vai integro em raw_payload de qualquer forma.
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

interface PayerInput { email?: string; identification?: { type?: string; number?: string } }
interface RequestBody {
  payment_intent_id?: string;
  token?: string;
  payment_method_id?: string;
  issuer_id?: string | number;
  installments?: number;
  payer?: PayerInput;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  if (!serviceClient) return jsonResponse({ ok: false, error: "servico_indisponivel" }, 503);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "desconhecido";
  if (!ipPermitido(ip)) return jsonResponse({ ok: false, error: "rate_limited" }, 429);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "json_invalido" }, 400);
  }

  const paymentIntentId = typeof body.payment_intent_id === "string" ? body.payment_intent_id : null;
  const token = typeof body.token === "string" ? body.token : null;
  const paymentMethodId = typeof body.payment_method_id === "string" ? body.payment_method_id : null;
  if (!paymentIntentId || !paymentMethodId) {
    return jsonResponse({ ok: false, error: "payment_intent_id/payment_method_id obrigatorios" }, 400);
  }
  // Pix (e outros metodos sem cartao) nao tem token -- so metodos de cartao exigem. Deixa a propria
  // API do Mercado Pago validar/recusar se faltar algo que ELA exige pro metodo escolhido (nunca
  // hardcoda aqui a lista completa de quais payment_method_id precisam de token).
  if (!token && paymentMethodId !== "pix") {
    return jsonResponse({ ok: false, error: "token obrigatorio para este metodo de pagamento" }, 400);
  }

  // Fonte autoritativa de store_id/order_id/amount/idempotency_key/status -- NUNCA confiado do
  // corpo da requisicao. service_role bypassa RLS por design (payment_intents e' deny-all pra
  // anon/authenticated) -- leitura direta aqui e' segura, so' escrita e' que passa por RPC dedicada
  // (ver _registrar_criacao_pagamento).
  const { data: pi, error: piErr } = await serviceClient
    .from("payment_intents")
    .select("id, store_id, order_id, mesa_session_id, amount, status, idempotency_key")
    .eq("id", paymentIntentId)
    .maybeSingle();

  if (piErr) return jsonResponse({ ok: false, error: "erro_ao_consultar_payment_intent" }, 500);
  if (!pi) return jsonResponse({ ok: false, error: "payment_intent_nao_encontrado" }, 404);
  if (pi.status !== "pendente") return jsonResponse({ ok: false, error: "payment_intent_ja_processado", status: pi.status }, 409);

  const accessToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!accessToken) return jsonResponse({ ok: false, error: "not_configured" }, 503);

  const mpBody: Record<string, unknown> = {
    transaction_amount: Number(pi.amount),
    description: "Pedido Encanto",
    payment_method_id: paymentMethodId,
    installments: typeof body.installments === "number" && body.installments > 0 ? body.installments : 1,
  };
  if (token) mpBody.token = token;
  if (body.issuer_id !== undefined && body.issuer_id !== null && body.issuer_id !== "") {
    mpBody.issuer_id = body.issuer_id;
  }
  if (body.payer?.email) {
    mpBody.payer = {
      email: body.payer.email,
      ...(body.payer.identification?.type && body.payer.identification?.number
        ? { identification: { type: body.payer.identification.type, number: body.payer.identification.number } }
        : {}),
    };
  }

  let mpResp: Response;
  let mpJson: Record<string, unknown> | null;
  try {
    mpResp = await fetch(MP_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "X-Idempotency-Key": pi.idempotency_key,
      },
      body: JSON.stringify(mpBody),
      signal: AbortSignal.timeout(MP_TIMEOUT_MS),
    });
    mpJson = await mpResp.json().catch(() => null);
  } catch (e) {
    const nome = (e as { name?: string })?.name;
    const motivo = nome === "TimeoutError" || nome === "AbortError" ? "timeout" : "network_error";
    // Nunca grava nada no payment_intent aqui -- ele continua 'pendente', cliente pode tentar de
    // novo com o MESMO payment_intent_id (mesma idempotency_key, o MP nao duplica a cobranca mesmo
    // que a 1a chamada tenha na verdade chegado la e so a RESPOSTA tenha se perdido na rede).
    return jsonResponse({ ok: false, error: motivo }, 502);
  }

  if (!mpResp.ok || !mpJson || typeof mpJson.id === "undefined" || typeof mpJson.status !== "string") {
    // Erro de VALIDACAO do Mercado Pago (cartao invalido, token expirado, etc.) -- devolve a
    // mensagem crua pro client tratar/exibir, nao grava nada (nunca houve um mp_payment_id real).
    return jsonResponse({ ok: false, error: "mercadopago_rejeitou", detalhe: mpJson?.message ?? mpResp.statusText, status_http: mpResp.status }, 402);
  }

  const mpPaymentId = String(mpJson.id);
  const statusInterno = mapearStatusMp(String(mpJson.status));
  const statusDetail = typeof mpJson.status_detail === "string" ? mpJson.status_detail : null;

  const { data: registro, error: regErr } = await serviceClient.rpc("_registrar_criacao_pagamento", {
    p_payment_intent_id: paymentIntentId,
    p_store_id_esperado: pi.store_id,
    p_mp_payment_id: mpPaymentId,
    p_status: statusInterno,
    p_status_detail: statusDetail,
    p_raw_payload: mpJson,
  });

  if (regErr) {
    // Pagamento JA foi criado no Mercado Pago (dinheiro real de teste em jogo) mas a gravacao local
    // falhou -- nunca esconder isso, devolve o mp_payment_id mesmo em erro pra permitir reconciliacao
    // manual/webhook cobrir depois (o webhook da Onda 2 tambem vai receber esse mesmo pagamento).
    console.error("[mp-criar-cobranca] falha ao registrar apos criacao real no MP:", regErr.message, "mp_payment_id=", mpPaymentId);
    return jsonResponse({ ok: false, error: "falha_ao_registrar_localmente", mp_payment_id: mpPaymentId, status_mercadopago: mpJson.status }, 500);
  }

  // Onda 5: dados do QR Pix (quando o metodo for pix) -- o Brick sozinho nao exibe o QR quando o
  // onSubmit e' tratado por conta propria (fluxo client-facing desta REF); o frontend precisa desses
  // campos crus da API pra renderizar o QR/copia-e-cola pro cliente.
  const pontoInteracao = mpJson.point_of_interaction as { transaction_data?: { qr_code?: unknown; qr_code_base64?: unknown; ticket_url?: unknown } } | undefined;
  const dadosPix = pontoInteracao?.transaction_data
    ? {
        qr_code: typeof pontoInteracao.transaction_data.qr_code === "string" ? pontoInteracao.transaction_data.qr_code : null,
        qr_code_base64: typeof pontoInteracao.transaction_data.qr_code_base64 === "string" ? pontoInteracao.transaction_data.qr_code_base64 : null,
        ticket_url: typeof pontoInteracao.transaction_data.ticket_url === "string" ? pontoInteracao.transaction_data.ticket_url : null,
      }
    : null;

  return jsonResponse({ ok: true, payment_intent_id: paymentIntentId, mp_payment_id: mpPaymentId, status: statusInterno, status_detail: statusDetail, ...(dadosPix ? { pix: dadosPix } : {}) });
});
