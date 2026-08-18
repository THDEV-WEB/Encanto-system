/* services/notifications/WhatsAppService.js — REF-ORDER-01 · Parte 3 (integracao WhatsApp Cloud API).
   SERVICO DEDICADO que ISOLA toda a comunicacao com a WhatsApp Cloud API oficial da Meta. Baixo
   acoplamento: nenhuma outra parte do sistema fala com a Meta diretamente — passam por aqui.

   ── DECISAO ARQUITETURAL (atualizada, REF-SEC-DATA-01 R13) ────────────────────────────────────────
   O ENVIO REAL roda no BANCO (pg_net + pg_cron, funcao public.enc_dispatch_notifications, cron job
   "enc-dispatch-whatsapp" a cada ~30s — ver migrations/REF-ORDER-01b-whatsapp-dispatch.sql), lendo o
   token da Meta do Supabase Vault. Este modulo (JS, roda no browser) NUNCA envia nada — e a copia
   CANONICA/de referencia do contrato da Cloud API, usada so por testes (paridade) e como documentacao
   viva do shape esperado:
   - buildCloudApiRequest(): monta { url, method, headers, body } exatos da Cloud API (testavel, sem rede);
   - sendViaCloudApi(): envia usando um `fetchImpl`/`config` INJETADOS — nunca chamado em producao hoje,
     mantido pra permitir um envio alternativo no futuro sem redesenhar o contrato;
   - isConfigured(): valida se ha credenciais.
   Existiu uma Edge Function (`whatsapp-notify`) que reimplementava este contrato — nunca foi ligada a
   nada real (nenhum invoke, nenhum cron apontando pra ela) e foi removida por estar morta/orfa.

   ── PONTO DE CREDENCIAIS ───────────────────────────────────────────────────────────────────────────
   O token vive no Supabase Vault (secrets `whatsapp_token`/`whatsapp_phone_number_id`, opcional
   `whatsapp_api_version`), consumido direto por enc_dispatch_notifications via vault.decrypted_secrets.
   Sem o secret configurado, a infra fica pronta e o envio simplesmente nao ocorre (outbox acumula
   'pending'). Ver: migrations/REF-ORDER-01b-whatsapp-dispatch.sql.

   ── CONTRATO CANONICO ──────────────────────────────────────────────────────────────────────────
   Este e o contrato CANONICO da Cloud API. O dispatcher SQL (enc_render_message/enc_dispatch_notifications)
   reimplementa o mesmo shape em PL/pgSQL. A PARIDADE das mensagens (nao do transporte HTTP) e travada
   por tests/whatsapp-templates.golden.mjs contra migrations/REF-COMPANY-02-notify-empresa.sql. Ao mudar
   o contrato aqui, avalie se o dispatcher SQL tambem precisa mudar. */

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
