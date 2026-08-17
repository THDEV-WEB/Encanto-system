// scripts/e2e-tenant-fixture-stores.mjs — REF-AUTH-TENANT-01 · Onda 4.
// Garante (idempotente) as 2 lojas fixture ADICIONAIS do projeto Supabase DEDICADO a E2E, usadas pelos
// testes de tenant (activate_tenant/Custom Access Token Hook/tenantSync.js): "Bar da Sogra (fixture
// E2E)" (ativa, com customer vinculado ao MESMO auth_user_id do cliente fixture — prova o cenario
// "1 pessoa, 2 lojas legitimas") e "Loja Inativa (fixture E2E)" (suspensa, tambem com customer
// vinculado — isola "loja inativa" como unico motivo de negacao nos testes). Encanto (loja original do
// projeto E2E) nao e tocada aqui. Nunca aponta pra producao (usa db.e2e.env). Idempotente — pode
// rodar quantas vezes for preciso, so cria se nao existir. Uso: node scripts/e2e-tenant-fixture-stores.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CLIENTE_FIXTURE } from '../e2e/support/fixture-accounts.js';
import { createClient } from '@supabase/supabase-js';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');

const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';
const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const password = envGet(txt, 'PGPASSWORD');
  if (!password) { console.error('ERRO: PGPASSWORD vazio em db.e2e.env'); process.exit(2); }
  return { host: envGet(txt, 'PGHOST'), port: Number(envGet(txt, 'PGPORT') || 5432), user: envGet(txt, 'PGUSER'), password, database: envGet(txt, 'PGDATABASE') || 'postgres' };
}

export const BAR_E2E_ID = '99999999-9999-4999-8999-999999999998';
export const LOJA_INATIVA_E2E_ID = '99999999-9999-4999-8999-999999999996';
const CUSTOMER_BAR_ID = '99999999-9999-4999-8999-999999999997';
const CUSTOMER_INATIVA_ID = '99999999-9999-4999-8999-999999999995';

async function descobrirAuthUserId() {
  const txt = readFileSync(new URL('../.env.e2e', import.meta.url), 'utf8');
  const url = txt.match(/VITE_SUPABASE_URL=(.*)/)?.[1]?.trim();
  const key = txt.match(/E2E_SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1]?.trim();
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(`listUsers falhou: ${error.message}`);
  const u = data.users.find((x) => x.email === CLIENTE_FIXTURE.email);
  if (!u) throw new Error(`cliente fixture ${CLIENTE_FIXTURE.email} nao encontrado — rode scripts/e2e-fixture-accounts.mjs primeiro`);
  return u.id;
}

const authUserId = await descobrirAuthUserId();
const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await client.connect();

await client.query(
  `INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,'bar-da-sogra-e2e','Bar da Sogra (fixture E2E)','ativo') ON CONFLICT (id) DO NOTHING`,
  [BAR_E2E_ID]
);
await client.query(
  `INSERT INTO public.customers (id, name, phone, auth_user_id, store_id) VALUES ($1,'Cliente E2E (Bar)','+5599999999997',$2,$3) ON CONFLICT (id) DO NOTHING`,
  [CUSTOMER_BAR_ID, authUserId, BAR_E2E_ID]
);
await client.query(
  `INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,'loja-inativa-e2e','Loja Inativa (fixture E2E)','suspenso') ON CONFLICT (id) DO NOTHING`,
  [LOJA_INATIVA_E2E_ID]
);
await client.query(
  `INSERT INTO public.customers (id, name, phone, auth_user_id, store_id) VALUES ($1,'Cliente E2E (Inativa)','+5599999999995',$2,$3) ON CONFLICT (id) DO NOTHING`,
  [CUSTOMER_INATIVA_ID, authUserId, LOJA_INATIVA_E2E_ID]
);

console.log('OK: fixtures de loja do E2E garantidas (Bar da Sogra ativa + Loja Inativa suspensa, ambas com customer do cliente fixture).');
await client.end();
