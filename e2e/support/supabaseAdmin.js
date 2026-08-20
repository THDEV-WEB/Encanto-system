/* e2e/support/supabaseAdmin.js — REF-E2E-01.
   Leitura do .env.e2e (raiz do projeto) + clientes Supabase para os scripts Node de setup/teardown
   (support/*.js, fixtures/index.js) — NUNCA importar isto de código que roda no browser: a chave
   service_role ignora RLS por completo. O Vite não expõe ao bundle nada fora do prefixo VITE_*, mas
   a garantia real aqui é arquitetural (só e2e/support e e2e/fixtures importam este módulo).

   Env-gated de propósito: enquanto o projeto Supabase dedicado a E2E (REF-E2E-01) não existir, TODAS
   as funções exportadas viram no-op previsível (retornam null/{skipped:true}) em vez de derrubar a
   suíte inteira — é assim que a Onda 1 (infra + specs read-only/locais) roda hoje sem o ambiente. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_FIXTURE } from './fixture-accounts.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function lerEnvArquivo(caminho) {
  let txt;
  try { txt = readFileSync(caminho, 'utf8'); } catch { return {}; }
  const out = {};
  for (const linha of txt.split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && m[1]) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const arquivo = lerEnvArquivo(`${ROOT}/.env.e2e`);
const get = (k) => process.env[k] || arquivo[k] || '';

export const E2E_ENV = {
  url: get('VITE_SUPABASE_URL'),
  anonKey: get('VITE_SUPABASE_KEY'),
  serviceRoleKey: get('E2E_SUPABASE_SERVICE_ROLE_KEY'),
};
export const E2E_ENV_PRONTO = !!(E2E_ENV.url && E2E_ENV.serviceRoleKey);

let avisado = new Set();
export function avisarAmbientePendente(acao) {
  if (avisado.has(acao)) return;
  avisado.add(acao);
  console.warn(`[e2e] .env.e2e incompleto — pulando "${acao}" (ver docs/adr/REF-E2E-01-auditoria-playwright.md, secao "Pre-requisitos manuais").`);
}

let _admin = null;
/** Client service_role (ignora RLS) — só para setup/teardown/seed. null se o ambiente ainda não existir. */
export function supabaseAdmin() {
  if (!E2E_ENV_PRONTO) { avisarAmbientePendente('cliente service_role'); return null; }
  if (!_admin) _admin = createClient(E2E_ENV.url, E2E_ENV.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

let _anon = null;
/** Client com a chave anon (mesma que o app usa) — para ações que devem respeitar RLS normalmente
    (ex.: login do cliente fixture). null se o ambiente ainda não existir.
    REF-ORDER-TENANT-01: header Origin fixo (mesmo domínio reconhecido pelo fixture Encanto do E2E,
    ver playwright.config.js) — este client roda em Node, nunca num navegador real, então nunca
    teria um Origin de verdade; create_order() deriva a loja do GUEST a partir desse header (nunca
    de um parâmetro do client), então chamadas Node-side (fixture-order.js) precisam de um valor
    realista aqui, do mesmo jeito que um navegador real enviaria ao visitar a loja. */
export function supabaseAnon() {
  if (!(E2E_ENV.url && E2E_ENV.anonKey)) { avisarAmbientePendente('cliente anon'); return null; }
  if (!_anon) _anon = createClient(E2E_ENV.url, E2E_ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { origin: 'https://encanto.localhost' } },
  });
  return _anon;
}

/* REF-SAAS-01 · Onda 7.1 (sincronização do E2E): admin_orders_search/admin_orders_stats/orders_health
   ganharam checagem explícita de is_admin_of(p_store_id) no CORPO da função (não é RLS — service_role
   não basta, pois auth.uid() vem nulo sem uma sessão real). Specs que provam essas RPCs direto contra
   o backend (sem passar pela UI) precisam de um JWT real de admin, não do client service_role. Instância
   NOVA a cada chamada (não é singleton do módulo): evita misturar essa sessão com o _anon compartilhado
   usado para outros fins (ex.: criarPedidoAvulso). */
export async function supabaseComoAdmin() {
  if (!(E2E_ENV.url && E2E_ENV.anonKey)) { avisarAmbientePendente('cliente autenticado como admin'); return null; }
  const client = createClient(E2E_ENV.url, E2E_ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: ADMIN_FIXTURE.email, password: ADMIN_FIXTURE.senha });
  if (error) throw new Error(`[e2e] login do admin fixture (RPC direto) falhou: ${error.message}`);
  return client;
}

/* REF-SAAS-01 · Onda 8 (E2E): id auth do admin fixture — precisa do Admin API (listUsers + achar por
   e-mail, mesmo padrao de scripts/e2e-fixture-accounts.mjs) porque nenhuma tabela publica mapeia
   e-mail -> user_id sem passar por auth.users (trancado, so leitura via service_role/Admin API). Usado
   por specs que precisam promover/revogar super_admins do fixture em setup/teardown. */
export async function idDoAdminFixture() {
  const admin = supabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(`[e2e] listUsers falhou: ${error.message}`);
  const user = data.users.find((u) => u.email === ADMIN_FIXTURE.email);
  if (!user) throw new Error(`[e2e] admin fixture (${ADMIN_FIXTURE.email}) nao encontrado em auth.users`);
  return user.id;
}

/* REF-SAAS-01 · Onda 8 (correcao pos-onda): garante (idempotente, Admin API) que um e-mail/senha
   conhecidos existam como auth.users no projeto de E2E -- mesmo padrao de scripts/e2e-fixture-
   accounts.mjs, generalizado pra qualquer fixture nova (ex.: ADMIN_B_FIXTURE) sem duplicar a logica de
   "cria, e se already-registered, acha o id por e-mail". Devolve o user_id. */
export async function garantirUsuarioAuth({ email, senha }) {
  const admin = supabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (!error) return data.user.id;
  if (!/already.*registered/i.test(error.message || '')) throw new Error(`[e2e] criar ${email} falhou: ${error.message}`);
  const { data: lista, error: e2 } = await admin.auth.admin.listUsers();
  if (e2) throw new Error(`[e2e] listUsers falhou: ${e2.message}`);
  const existente = lista.users.find((u) => u.email === email);
  if (!existente) throw new Error(`[e2e] usuario ${email} deveria existir mas nao foi encontrado`);
  return existente.id;
}
