// supabase/functions/platform-set-store-admin-password/index.ts — REF-PROD-READINESS-01 (A6).
//
// Segundo ponto do sistema que usa service_role (o primeiro e' invite-store-admin). Escopo estrito:
// so' define a senha de um admin de loja JA vinculado (public.admins), via
// auth.admin.updateUserById(uid, {password}), depois de confirmar -- pela RPC ja auditada
// is_super_admin(), com o JWT de quem invocou, NUNCA por conta propria -- que o caller e' super admin.
//
// MOTIVACAO (REF-PROD-READINESS-01, achado A6): antes disso, a UNICA forma de definir a senha de um
// admin de loja sem acesso ao e-mail de convite era um script ad-hoc (scripts/store-onboard-01-onda2-
// validacao-final.mjs) que gerava uma senha aleatoria e IMPRIMIA em texto puro no console -- a senha
// real da Aquarios Bar ficou exposta assim. Esta funcao substitui esse padrao por um fluxo oficial,
// auditavel, que nunca loga a senha em lugar nenhum.
//
// DESENHO (mesmo espirito de invite-store-admin -- autorizacao delegada, nunca duplicada):
//   1) callerClient.rpc('is_super_admin') com o JWT de quem chamou -- se nao for true, para aqui,
//      service_role nunca e' tocado.
//   2) Confirma (via serviceClient, leitura) que o userId alvo esta em public.admins -- guarda extra
//      pra esta funcao nunca virar um "resetar senha de QUALQUER usuario" caso o payload seja
//      adulterado direto (sem passar pela UI, que so' oferece o botao pra admins ja vinculados).
//   3) SO' entao service_role: auth.admin.updateUserById(userId, {password}).
//
// NUNCA loga a senha (nem em console.log, nem no corpo da resposta de erro) -- exatamente o problema
// que esta funcao existe pra evitar.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Throttle mais estrito que invite-store-admin (acao mais sensivel) -- mesmo desenho de janela
// deslizante por sub do JWT, nunca a fronteira de seguranca real (essa e' is_super_admin()).
const RATE_LIMIT_JANELA_MS = 5 * 60_000;
const RATE_LIMIT_MAX_POR_JANELA = 5;
const MAX_ENTRADAS = 500;
const chamadasPorUsuario = new Map<string, number[]>();

function subDoJwt(authHeader: string | null): string {
  try {
    const token = (authHeader || "").replace(/^Bearer\s+/i, "");
    const payload = token.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.sub === "string" ? json.sub : "desconhecido";
  } catch {
    return "desconhecido";
  }
}

function permitido(chave: string): boolean {
  const agora = Date.now();
  if (chamadasPorUsuario.size >= MAX_ENTRADAS) chamadasPorUsuario.clear();
  const chamadas = (chamadasPorUsuario.get(chave) ?? []).filter((t) => agora - t < RATE_LIMIT_JANELA_MS);
  if (chamadas.length >= RATE_LIMIT_MAX_POR_JANELA) { chamadasPorUsuario.set(chave, chamadas); return false; }
  chamadas.push(agora);
  chamadasPorUsuario.set(chave, chamadas);
  return true;
}

// Respostas SEMPRE 200 (mesmo em erro/recusa) -- mesmo motivo de invite-store-admin: supabase-js
// `functions.invoke()` so' entrega o corpo em `data` quando o status e' 2xx.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: true, reason: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: true, reason: "sem_autenticacao" });

  if (!permitido(subDoJwt(authHeader))) {
    return jsonResponse({ error: true, reason: "rate_limited" });
  }

  let body: { userId?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: true, reason: "json_invalido" });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!userId) return jsonResponse({ error: true, reason: "userId_obrigatorio" });
  if (newPassword.length < 8) return jsonResponse({ error: true, reason: "senha_deve_ter_pelo_menos_8_caracteres" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Cliente do CALLER: roda AS o usuario autenticado (auth.uid() correto dentro da RPC).
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  // Passo 1: autorizacao 100% delegada a RPC ja auditada -- service_role nunca e' tocado se isto falhar.
  const { data: souSuperAdmin, error: authErr } = await callerClient.rpc("is_super_admin");
  if (authErr || souSuperAdmin !== true) {
    return jsonResponse({ error: true, reason: "apenas super admin pode definir senha de administrador" });
  }

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Passo 2: guarda extra -- so' aceita definir senha de quem JA e' admin de alguma loja (nunca um
  // usuario arbitrario, mesmo que o caller seja super admin e o payload venha adulterado).
  const { data: vinculo, error: vinculoErr } = await serviceClient
    .from("admins").select("user_id").eq("user_id", userId).limit(1).maybeSingle();
  if (vinculoErr) return jsonResponse({ error: true, reason: vinculoErr.message });
  if (!vinculo) return jsonResponse({ error: true, reason: "usuario_nao_e_admin_de_nenhuma_loja" });

  // Passo 3: SO' AQUI a senha e' de fato alterada. Nunca logada -- nem aqui, nem no corpo de erro.
  const { error: updErr } = await serviceClient.auth.admin.updateUserById(userId, { password: newPassword });
  if (updErr) return jsonResponse({ error: true, reason: updErr.message });

  return jsonResponse({ ok: true });
});
