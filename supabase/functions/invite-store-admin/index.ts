// supabase/functions/invite-store-admin/index.ts — REF-STORE-ONBOARD-01 · Onda 2.
//
// UNICO ponto do sistema que usa service_role (achado da auditoria REF-STORE-ONBOARD-01: hoje a criacao
// da identidade Auth de um administrador so acontece manualmente no Supabase Dashboard). Escopo estrito:
// so cria a identidade Auth via convite (auth.admin.inviteUserByEmail) quando o caller ja provou ser
// super admin -- NUNCA duplica a logica de autorizacao/vinculo que a RPC link_store_admin ja tem.
//
// DESENHO (por que e por que NAO precisa de RPC nova nem de checagem de is_super_admin() propria):
//   1) Chama link_store_admin(p_store_id, p_admin_email) com o JWT de quem invocou a funcao (nunca com
//      service_role) -- exatamente a mesma chamada que o botao "Vincular" ja faz hoje.
//      - Se o caller NAO for super admin, a propria RPC lanca 42501 aqui -- a funcao nunca chega perto
//        de service_role. A autorizacao e' 100% delegada a essa RPC ja auditada, sem duplicar logica.
//      - Se o e-mail JA EXISTIR em auth.users, a RPC vincula na hora (vinculado:true) -- mesmo
//        comportamento de hoje, a funcao devolve e termina. service_role nunca e' tocado neste caso.
//   2) So' quando a RPC volta {vinculado:false, motivo:"nao existe nenhuma conta..."} -- ou seja, so'
//      depois de confirmar (pela RPC, nao por conta propria) que o caller E' super admin E que a conta
//      realmente nao existe -- a funcao usa service_role para UMA UNICA chamada:
//      auth.admin.inviteUserByEmail(email, {redirectTo}) -- redirectTo varia por padrao de dominio da
//      loja (legado admin.{slug}.valionsistemas.com.br vs. novo admin-{slug}.lojas.valionsistemas.com.br,
//      ver REF-STORE-ONBOARD-01 Onda 2 · Opcao C, comentario junto da construcao do redirectTo abaixo).
//   3) Chama link_store_admin de novo (com o JWT do caller, nao service_role) para completar o vinculo
//      agora que a identidade existe. Se essa 2a chamada falhar (rede, corrida), devolve
//      {convidado:true, vinculado:false} -- o fluxo normal de "Vincular" (ja existente) resolve depois,
//      sem necessidade de rollback: um auth.users sem vinculo e' um estado ja tolerado hoje (e o motivo
//      de o botao "Vincular" existir).
//
// PRIMEIRO ACESSO: o link de convite consome o token numa pagina isolada (convite.html/ConviteApp.jsx),
// nunca no bundle do Admin -- ver comentario de cabecalho de src/ConviteApp.jsx para o racional completo
// (LOGIN-ARCH-02.2/REF-STABILITY-02 protegem o boot do Admin, esta pagina fica fora dessa arvore).
//
// SECRETS: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY sao injetados automaticamente pela plataforma em TODA
// Edge Function (nao precisa de `supabase secrets set` para eles, diferente de OPENROUTESERVICE_API_KEY
// em route-distance). Nenhum segredo novo a configurar.
//
// REDIRECT URL: confirmado e aplicado em producao (2026-08-19) na allow-list de "Redirect URLs" do
// Supabase Auth -- https://admin.*.valionsistemas.com.br/** + entradas explicitas por loja existente.
// Ver README.md desta pasta para o historico e o valor exato aplicado.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  // Mesmo padrao de route-distance: CORS nunca e' a fronteira de seguranca real aqui -- quem protege e'
  // o JWT do caller + a RPC link_store_admin (is_super_admin(), server-side, ignora o que o CORS deixa
  // passar). Um cliente nao-navegador (curl/script) ja contorna CORS de qualquer forma.
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

// Throttle LEVE por usuario (nunca a fronteira de seguranca -- so' amortece abuso de uma sessao super
// admin comprometida). Chave = sub do JWT, extraido SEM verificar assinatura (so' pra agrupar tentativas;
// a verificacao real de identidade acontece server-side, dentro de link_store_admin). Mesmo formato de
// janela deslizante de route-distance.
const RATE_LIMIT_JANELA_MS = 5 * 60_000;
const RATE_LIMIT_MAX_POR_JANELA = 10;
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

// Respostas SEMPRE 200 (mesmo em erro/recusa) -- espelha de proposito o estilo de link_store_admin (RPC
// devolve um veredito em JSON, nunca lanca excecao pra "e-mail nao existe"): supabase-js `functions.
// invoke()` só entrega o corpo em `data` quando o status é 2xx; um 4xx/5xx faria o corpo cair em
// `error.context` (Response bruto), obrigando cada chamador a fazer parse manual. Só a linha 405
// (method_not_allowed) foge disso -- nunca alcançada via `functions.invoke()` (sempre POST), existe só
// como defesa contra chamada manual malformada.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: true, reason: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: true, reason: "sem_autenticacao" });

  if (!permitido(subDoJwt(authHeader))) {
    return jsonResponse({ error: true, reason: "rate_limited" });
  }

  let body: { storeId?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: true, reason: "json_invalido" });
  }

  const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!storeId || !email) {
    return jsonResponse({ error: true, reason: "storeId_e_email_obrigatorios" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Cliente do CALLER: roda AS o usuario autenticado (auth.uid() correto dentro da RPC), nunca service_role.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  // Passo 1: tenta vincular do jeito que ja funciona hoje. Autorizacao (is_super_admin) e' inteiramente
  // desta chamada -- se falhar por 42501/outro erro, devolve e PARA aqui, sem tocar service_role.
  //
  // BUG achado na validacao E2E real (REF-STORE-ONBOARD-01, 2026-08-19/20): link_store_admin tem 3
  // desfechos, nao 2 -- {vinculado:true} (link novo), {vinculado:false, motivo:"nao existe nenhuma
  // conta..."} (precisa convidar) E {vinculado:false, motivo:"este usuario ja e administrador desta
  // loja"} (JA satisfeito, nao precisa de nada). A versao anterior so checava vinculado===true e tratava
  // QUALQUER outro caso como "precisa convidar" -- repetir a chamada pra um admin ja vinculado disparava
  // um SEGUNDO convite real por e-mail (auth.admin.inviteUserByEmail de novo num usuario ja convidado),
  // falhando o teste de idempotencia (item 13 da validacao). Fix: so' avanca pro convite quando o motivo
  // e' especificamente "conta nao existe" -- qualquer outro vinculado:false (inclusive "ja e admin") e'
  // terminal, devolve na hora, nunca toca service_role.
  const tentativa1 = await callerClient.rpc("link_store_admin", { p_store_id: storeId, p_admin_email: email });
  if (tentativa1.error) {
    return jsonResponse({ error: true, reason: tentativa1.error.message });
  }
  if (tentativa1.data?.vinculado === true) {
    return jsonResponse({ ...tentativa1.data, convidado: false });
  }
  const contaNaoExiste = typeof tentativa1.data?.motivo === "string"
    && tentativa1.data.motivo.includes("nao existe nenhuma conta");
  if (!contaNaoExiste) {
    // Ex.: "este usuario ja e administrador desta loja" -- ja esta no estado desejado, nada a fazer.
    return jsonResponse({ ...tentativa1.data, convidado: false });
  }

  // Passo 2: conta nao existe -- SO' AQUI service_role entra em cena, e SO' para criar a identidade.
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: storeRow, error: storeErr } = await serviceClient
    .from("stores").select("slug, dominio").eq("id", storeId).single();
  if (storeErr || !storeRow?.slug) {
    return jsonResponse({ error: true, reason: "loja_nao_encontrada" });
  }
  // REF-STORE-ONBOARD-01 Onda 2 (Opcao C): padrao legado (Encanto -- dominio explicito no formato
  // antigo, congelado de proposito) vs. padrao novo (.lojas., automatico via wildcard, qualquer loja
  // sem dominio nesse formato antigo -- inclui toda loja provisionada depois desta mudanca). Nunca
  // hardcoded pro slug "encanto" especificamente -- generaliza pra qualquer excecao legada futura.
  const dominioLegado = typeof storeRow.dominio === "string"
    && storeRow.dominio.endsWith(".valionsistemas.com.br")
    && !storeRow.dominio.endsWith(".lojas.valionsistemas.com.br");
  const redirectTo = dominioLegado
    ? `https://admin.${storeRow.slug}.valionsistemas.com.br/convite.html`
    : `https://admin-${storeRow.slug}.lojas.valionsistemas.com.br/convite.html`;

  const { error: inviteErr } = await serviceClient.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (inviteErr) {
    return jsonResponse({ error: true, reason: inviteErr.message });
  }

  // Passo 3: identidade agora existe -- completa o vinculo com a MESMA RPC de sempre (JWT do caller).
  const tentativa2 = await callerClient.rpc("link_store_admin", { p_store_id: storeId, p_admin_email: email });
  if (tentativa2.error || tentativa2.data?.vinculado !== true) {
    // Sem rollback necessario: auth.users existe sem vinculo e' estado ja tolerado (o botao "Vincular"
    // existente resolve depois). Convite foi enviado com sucesso -- reporta isso, nao um erro fatal.
    return jsonResponse({ vinculado: false, convidado: true, email, motivo: "convite enviado, mas o vinculo automatico falhou -- clique em Vincular novamente" });
  }

  return jsonResponse({ ...tentativa2.data, convidado: true });
});
