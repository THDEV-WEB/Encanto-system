// scripts/e2e-fixture-accounts.mjs — REF-E2E-01 · Onda 4.
// Garante (idempotente) as 2 contas fixture do projeto Supabase DEDICADO a E2E:
//   - cliente: e-mail/senha conhecidos, usados por e2e/support/authSession.js (sessao real via
//     signInWithPassword, sem passar pela UI de login).
//   - admin: e-mail/senha conhecidos + INSERT em public.admins (mesmo passo manual que o AUTH-01 fez
//     em producao para o admin real - aqui automatizado, contra um projeto que so serve a testes).
// Le .env.e2e (raiz do projeto) - nunca roda sem ele estar preenchido. Uso: node scripts/e2e-fixture-accounts.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { CLIENTE_FIXTURE, ADMIN_FIXTURE } from '../e2e/support/fixture-accounts.js';

function lerEnvE2e() {
  const txt = readFileSync(new URL('../.env.e2e', import.meta.url), 'utf8');
  const out = {};
  for (const linha of txt.split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = lerEnvE2e();
if (!env.VITE_SUPABASE_URL || !env.E2E_SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERRO: .env.e2e sem VITE_SUPABASE_URL/E2E_SUPABASE_SERVICE_ROLE_KEY preenchidos.');
  process.exit(2);
}

const admin = createClient(env.VITE_SUPABASE_URL, env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function garantirUsuario({ email, senha }) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (!error) return data.user;
  if (!/already.*registered/i.test(error.message || '')) throw new Error(`criar ${email} falhou: ${error.message}`);
  // já existe — busca o id (paginação simples, base de teste é pequena)
  const { data: lista, error: e2 } = await admin.auth.admin.listUsers();
  if (e2) throw new Error(`listUsers falhou: ${e2.message}`);
  const existente = lista.users.find((u) => u.email === email);
  if (!existente) throw new Error(`usuario ${email} deveria existir mas nao foi encontrado`);
  return existente;
}

const cliente = await garantirUsuario(CLIENTE_FIXTURE);
console.log(`OK cliente fixture: ${CLIENTE_FIXTURE.email} (${cliente.id})`);

const adminUser = await garantirUsuario(ADMIN_FIXTURE);
const { error: errAdmins } = await admin.from('admins').upsert({ user_id: adminUser.id }, { onConflict: 'user_id' });
if (errAdmins) throw new Error(`INSERT em admins falhou: ${errAdmins.message}`);
console.log(`OK admin fixture: ${ADMIN_FIXTURE.email} (${adminUser.id}) registrado em public.admins`);
