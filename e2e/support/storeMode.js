/* e2e/support/storeMode.js — REF-E2E-01.
   Forca o status GLOBAL da loja antes de specs de checkout, para nao depender do relogio real
   (Seg 10-15; Ter-Sab 10-15/17-22; Dom fechado) — anti-flaky.

   A RPC oficial (set_store_mode, mesma do override do Admin - HB-03) exige is_admin()=true; um
   client service_role via PostgREST NAO satisfaz isso (auth.uid() fica nulo sem uma sessao real de
   admin autenticado) - ver pg_get_functiondef confirmado na auditoria de implantacao. Para o SETUP
   de teste, em vez de forjar uma sessao de admin so para isto, escreve DIRETO na tabela settings via
   conexao Postgres (mesma convencao/infra de scripts/e2e-seed.mjs) - equivalente ao efeito da RPC,
   sem depender do gate de aplicacao (legitimo: quem escreve aqui e o dono do banco, preparando o
   estado ANTES do teste comecar, nao simulando uma acao de usuario).
   Env-gated: sem db.e2e.env, {skipped:true} — specs @writes nao devem rodar sem o ambiente mesmo. */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const ENV_PATH = 'C:\\Users\\00thi\\.encanto\\db.e2e.env';

function loadConn() {
  if (!existsSync(ENV_PATH)) return null;
  const t = readFileSync(ENV_PATH, 'utf8');
  const get = (k) => { const m = t.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
  const host = get('PGHOST');
  if (!host) return null;
  return { host, port: Number(get('PGPORT') || 5432), user: get('PGUSER'), password: get('PGPASSWORD'), database: get('PGDATABASE') || 'postgres' };
}

/** @param {'AUTO'|'OPEN'|'CLOSED'} modo */
export async function forcarStoreMode(modo = 'OPEN') {
  const conn = loadConn();
  if (!conn) return { ok: false, skipped: true };
  const require = createRequire('C:\\Users\\00thi\\.encanto\\package.json');
  const pg = require('pg');
  const client = new pg.Client({ ...conn, ssl: { rejectUnauthorized: false }, statement_timeout: 15000, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query(
      `INSERT INTO public.settings (chave, valor) VALUES ('store_mode', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [modo]
    );
    return { ok: true, skipped: false };
  } finally {
    await client.end();
  }
}
