// supabase/functions/whatsapp-notify/index.ts — REF-ORDER-01 · Parte 3.
// EDGE FUNCTION (Deno) = UNICO ponto onde as credenciais da Meta vivem (segredos do servidor). Drena a
// fila public.notification_outbox (state='pending'), renderiza a mensagem pelos templates e envia pela
// WhatsApp Cloud API oficial. Marca cada linha como 'sent' | 'failed' | 'skipped' (auditavel).
//
// FUNCIONA 24/7, SEM depender de navegador/WhatsApp Web: agende-a (Supabase Scheduled Function / pg_cron)
// e/ou dispare por Database Webhook no INSERT de notification_outbox. Ver README.md deste diretorio.
//
// PONTO DE CREDENCIAIS (preencher no futuro, sem tocar em codigo):
//   supabase secrets set WHATSAPP_TOKEN=...  WHATSAPP_PHONE_NUMBER_ID=...  [WHATSAPP_API_VERSION=v21.0]
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao injetados automaticamente no runtime das Edge Functions.)
//
// Enquanto os segredos da Meta nao existirem, a funcao retorna cedo SEM tocar na fila — as linhas ficam
// 'pending' e sao enviadas assim que os segredos forem configurados. A infra fica pronta e nada e perdido.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderTemplate } from "./templates.ts";

const WA_API_VERSION_DEFAULT = "v21.0";
const MAX_ATTEMPTS = 5;
const BATCH = 25;

function normalizePhoneBR(phone: string | null): string {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 11) d = "55" + d;
  return d;
}

interface WaConfig { token?: string; phoneNumberId?: string; apiVersion?: string; }
const isConfigured = (c: WaConfig) => !!(c.token && c.phoneNumberId);

async function sendViaCloudApi(cfg: WaConfig, to: string, message: string) {
  if (!isConfigured(cfg)) return { ok: false, skipped: true, error: "whatsapp_not_configured" };
  const dest = normalizePhoneBR(to);
  if (!dest) return { ok: false, skipped: true, error: "phone_missing" };
  const version = cfg.apiVersion || WA_API_VERSION_DEFAULT;
  const url = `https://graph.facebook.com/${version}/${cfg.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: dest,
    type: "text",
    text: { preview_url: false, body: message },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* corpo vazio */ }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data?.error?.message || `http_${res.status}`) };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "network_error" };
  }
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,   // service_role -> ignora RLS (drena a fila)
    { auth: { persistSession: false } },
  );
  const cfg: WaConfig = {
    token: Deno.env.get("WHATSAPP_TOKEN") ?? undefined,
    phoneNumberId: Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? undefined,
    apiVersion: Deno.env.get("WHATSAPP_API_VERSION") ?? undefined,
  };

  // F3: SEM credenciais -> NAO drena nada. As linhas ficam 'pending' e serao enviadas quando os segredos
  // existirem ("nada e perdido"). 'not configured' e transitorio, nunca terminal.
  if (!isConfigured(cfg)) {
    return new Response(JSON.stringify({ ok: true, skipped_run: "whatsapp_not_configured", enviado: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // F2: CLAIM atomico via RPC (UPDATE pending -> 'sending' com FOR UPDATE SKIP LOCKED). Invocacoes
  // concorrentes (cron + webhook) nunca reivindicam a mesma linha -> sem envio duplicado.
  const { data: claimed, error } = await supabase.rpc("enc_claim_notifications", { p_limit: BATCH });
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });

  let sent = 0, failed = 0, skipped = 0;
  for (const row of (claimed ?? []) as any[]) {
    const attempts = (row.attempts ?? 0) + 1;
    const message = renderTemplate(row.status, row.vars ?? {});
    if (!message) {
      await supabase.from("notification_outbox").update({
        state: "skipped", last_error: "sem_template", attempts, sent_at: new Date().toISOString(),
      }).eq("id", row.id);
      skipped++; continue;
    }

    const r = await sendViaCloudApi(cfg, row.to_phone, message);
    if (r.ok) {
      await supabase.from("notification_outbox").update({
        state: "sent", message, sent_at: new Date().toISOString(), attempts, last_error: null,
      }).eq("id", row.id);
      sent++;
    } else if (r.skipped) {
      // aqui so cai 'phone_missing' (nao-configurado ja saiu no early-return): sem telefone e terminal.
      await supabase.from("notification_outbox").update({
        state: "skipped", message, last_error: r.error, attempts,
      }).eq("id", row.id);
      skipped++;
    } else {
      // falha real de envio: volta a 'pending' (re-tentavel) ate MAX_ATTEMPTS, depois 'failed'.
      await supabase.from("notification_outbox").update({
        state: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        message, last_error: r.error, attempts,
      }).eq("id", row.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ ok: true, processados: (claimed ?? []).length, sent, failed, skipped }), {
    headers: { "Content-Type": "application/json" },
  });
});
