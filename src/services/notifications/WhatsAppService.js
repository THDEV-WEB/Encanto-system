/* services/notifications/WhatsAppService.js — REF-ORDER-01 · Parte 3 (integracao WhatsApp Cloud API).
   SERVICO DEDICADO que ISOLA toda a comunicacao com a WhatsApp Cloud API oficial da Meta. Baixo
   acoplamento: nenhuma outra parte do sistema fala com a Meta diretamente — passam por aqui.

   ── DECISAO ARQUITETURAL (importante) ─────────────────────────────────────────────────────────────
   O ENVIO REAL ocorre no SERVIDOR (Supabase Edge Function `whatsapp-notify`), NUNCA no browser: o token
   da Meta e SEGREDO e nao pode ir no bundle do cliente. Por isso este modulo e PURO/agnostico de runtime:
   - buildCloudApiRequest(): monta { url, method, headers, body } exatos da Cloud API (testavel, sem rede);
   - sendViaCloudApi(): envia usando um `fetchImpl` INJETADO (a Edge Function injeta o fetch do Deno) e um
     `config` INJETADO (token/phoneNumberId vindos de segredos do servidor) — este arquivo nunca le o token
     de import.meta.env, entao nada sensivel vaza para o frontend.
   - isConfigured(): valida se ha credenciais.

   ── PONTO DE CREDENCIAIS (preencher no futuro) ────────────────────────────────────────────────────
   As credenciais entram como SEGREDOS da Edge Function (supabase secrets set):
     WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID  (opcional: WHATSAPP_API_VERSION).
   Enquanto nao existirem, a infra fica pronta e o envio simplesmente nao ocorre (outbox acumula 'pending').
   Ver: supabase/functions/whatsapp-notify/ e migrations/REF-ORDER-01-order-ops.sql.

   ── CONTRATO CANONICO ──────────────────────────────────────────────────────────────────────────
   Este e o contrato CANONICO da Cloud API. A Edge Function (Deno) reimplementa o mesmo shape inline
   (nao importa o bundle do browser). A PARIDADE entre os dois e travada por tests/whatsapp-service.golden.mjs
   (assim como templates.ts x messageTemplates.js). Ao mudar o contrato aqui, atualize a Edge e rode o golden. */

export const WA_API_VERSION_DEFAULT = 'v21.0';

/* Normaliza telefone para o formato E.164 sem '+' que a Cloud API espera (so digitos).
   Aceita entradas com mascara ((38) 99220-3620) e prefixa DDI 55 (Brasil) quando ausente. PURO. */
export function normalizePhoneBR(phone) {
  let d = String(phone == null ? '' : phone).replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;   // sem DDI -> assume Brasil
  return d;
}

export function isConfigured(config) {
  return !!(config && config.token && config.phoneNumberId);
}

/* Monta a requisicao EXATA da WhatsApp Cloud API para mensagem de texto. PURO (sem efeito de rede).
   Doc: POST https://graph.facebook.com/<ver>/<PHONE_NUMBER_ID>/messages
        Authorization: Bearer <TOKEN>; body: messaging_product=whatsapp, to, type=text, text.body. */
export function buildCloudApiRequest(config, { to, message }) {
  const version = (config && config.apiVersion) || WA_API_VERSION_DEFAULT;
  const phoneNumberId = config && config.phoneNumberId;
  return {
    url: `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config && config.token}`,
      'Content-Type': 'application/json',
    },
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizePhoneBR(to),
      type: 'text',
      text: { preview_url: false, body: String(message == null ? '' : message) },
    },
  };
}

/* Envia via Cloud API. Runtime-agnostico: recebe `fetchImpl` (a Edge Function passa o fetch do Deno).
   NUNCA envia sem credenciais (retorna {ok:false, skipped:true}) — este e o ponto que "nao ocorre" ate
   as credenciais existirem. Retorno normalizado { ok, skipped?, status?, data?, error? }. */
export async function sendViaCloudApi(config, { to, message }, fetchImpl) {
  if (!isConfigured(config)) return { ok: false, skipped: true, error: 'whatsapp_not_configured' };
  const dest = normalizePhoneBR(to);
  if (!dest) return { ok: false, skipped: true, error: 'phone_missing' };
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return { ok: false, error: 'no_fetch_available' };

  const req = buildCloudApiRequest(config, { to: dest, message });
  try {
    const res = await doFetch(req.url, { method: req.method, headers: req.headers, body: JSON.stringify(req.body) });
    let data = null;
    try { data = await res.json(); } catch { /* corpo vazio/nao-json */ }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data?.error?.message || `http_${res.status}`) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'network_error' };
  }
}

export const WhatsAppService = {
  WA_API_VERSION_DEFAULT,
  normalizePhoneBR,
  isConfigured,
  buildCloudApiRequest,
  sendViaCloudApi,
};
