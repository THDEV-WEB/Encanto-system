// REF-MESA-02 · Onda 4 (mesas fisicas / catalogo + RPCs de Admin) -- E2E dedicado. SAVEPOINT por caso.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const map = {};
  for (const line of txt.split(/\r?\n/)) { const i = line.indexOf('='); if (i === -1) continue; map[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
  if (!map.PGPASSWORD) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: map.PGHOST, port: Number(map.PGPORT || 5432), user: map.PGUSER, password: map.PGPASSWORD, database: map.PGDATABASE || 'postgres' };
}
const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, spCounter = 0;
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { return await fn(); } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
}
async function setRole(role, sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function resetRole() { await client.query(`RESET ROLE`); await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`); }

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 4 (mesas fisicas) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E (fixtures).'); process.exit(2); }
    const [ADMIN_UID, OUTRO_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID(); const STORE_B = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda4 A','ativo')`, [STORE_A, `mesa02-onda4-a-${STORE_A}`]);
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda4 B','ativo')`, [STORE_B, `mesa02-onda4-b-${STORE_B}`]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [OUTRO_UID, STORE_B]);

    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const r = await client.query(`SELECT public.admin_criar_mesa('05', $1) AS r`, [STORE_A]);
      check('B1 admin cria mesa "05" -> sucesso', r.rows[0].r.ok === true, JSON.stringify(r.rows[0].r));
      const r2 = await client.query(`SELECT public.admin_criar_mesa('05', $1) AS r`, [STORE_A]);
      check('B2 criar mesa "05" duplicada na MESMA loja -> erro amigavel', r2.rows[0].r.ok === false && r2.rows[0].r.error === 'mesa ja cadastrada', JSON.stringify(r2.rows[0].r));
      await resetRole();
    });

    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      await client.query(`SELECT public.admin_criar_mesa('06', $1)`, [STORE_A]);
      await resetRole();
      await setRole('authenticated', OUTRO_UID, STORE_B);
      const r = await client.query(`SELECT public.admin_criar_mesa('06', $1) AS r`, [STORE_B]);
      check('B3 MESMO identificador "06" em OUTRA loja -> sucesso (isolamento por store_id)', r.rows[0].r.ok === true, JSON.stringify(r.rows[0].r));
      await resetRole();
    });

    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const mesa = (await client.query(`SELECT public.admin_criar_mesa('07', $1) AS r`, [STORE_A])).rows[0].r;
      const r = await client.query(`SELECT * FROM public.admin_listar_mesas($1)`, [STORE_A]);
      const linha = r.rows.find(x => x.id === mesa.id);
      check('B4 admin_listar_mesas devolve a mesa recem-criada, status=disponivel, ocupada=false',
        !!linha && linha.status === 'disponivel' && linha.ocupada === false, JSON.stringify(linha));

      const rSet = await client.query(`SELECT public.admin_set_mesa_status($1,'indisponivel',$2) AS r`, [mesa.id, STORE_A]);
      check('B5 marcar mesa como indisponivel -> sucesso', rSet.rows[0].r.ok === true && rSet.rows[0].r.status === 'indisponivel', JSON.stringify(rSet.rows[0].r));

      const r2 = await client.query(`SELECT * FROM public.admin_listar_mesas($1)`, [STORE_A]);
      const linha2 = r2.rows.find(x => x.id === mesa.id);
      check('B6 listagem reflete o novo status imediatamente', linha2.status === 'indisponivel', JSON.stringify(linha2));
      await resetRole();
    });

    // B7: "ocupada" e derivado de mesa_session_mesas, nao de um campo proprio.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const mesa = (await client.query(`SELECT public.admin_criar_mesa('08', $1) AS r`, [STORE_A])).rows[0].r;
      await resetRole();
      const s = (await client.query(`INSERT INTO public.mesa_sessions (store_id, origem_abertura) VALUES ($1,'qr_mesa') RETURNING id`, [STORE_A])).rows[0].id;
      await client.query(`INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'08')`, [s, STORE_A]);
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const r = await client.query(`SELECT * FROM public.admin_listar_mesas($1)`, [STORE_A]);
      const linha = r.rows.find(x => x.id === mesa.id);
      check('B7 mesa com sessao aberta aparece ocupada=true (derivado, sem campo proprio)', linha.ocupada === true, JSON.stringify(linha));
      await resetRole();
    });

    // B8: cross-tenant -- tentar alterar status de mesa de OUTRA loja.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const mesa = (await client.query(`SELECT public.admin_criar_mesa('09', $1) AS r`, [STORE_A])).rows[0].r;
      await resetRole();
      await setRole('authenticated', OUTRO_UID, STORE_B);
      const r = await client.query(`SELECT public.admin_set_mesa_status($1,'indisponivel',$2) AS r`, [mesa.id, STORE_B]);
      check('B8 admin de OUTRA loja tenta alterar mesa que nao e sua -> "mesa nao encontrada" (nao vaza existencia)', r.rows[0].r.ok === false && r.rows[0].r.error === 'mesa nao encontrada', JSON.stringify(r.rows[0].r));
      await resetRole();
    });

    // B9-B11: acesso direto negado (RLS+REVOKE) e RPC sem permissao.
    await withSavepoint(async () => {
      await setRole('anon');
      const r = await client.query(`SELECT * FROM pg_catalog.has_table_privilege('anon', 'public.mesas', 'SELECT') AS ok`);
      check('B9 anon nao tem privilegio SELECT na tabela mesas', r.rows[0].ok === false, JSON.stringify(r.rows[0]));
      await resetRole();
    });
    await withSavepoint(async () => {
      // OUTRO_UID agora e admin de verdade da STORE_B (fixture da B3/B8) -- para "authenticated SEM
      // nenhum vinculo de admin", usa um sub totalmente novo, sem linha em admins em lugar nenhum
      // (is_admin_of so consulta admins/super_admins por auth.uid(), nao exige linha real em
      // auth.users para esta simulacao via claims).
      await setRole('authenticated', randomUUID(), STORE_A);
      const r = await client.query(`SELECT public.admin_criar_mesa('99', $1) AS r`, [STORE_A]);
      check('B10 authenticated sem vinculo de admin na loja A -> "sem permissao"', r.rows[0].r.ok === false && r.rows[0].r.error === 'sem permissao', JSON.stringify(r.rows[0].r));
      await resetRole();
    });
    await withSavepoint(async () => {
      await client.query(`SET LOCAL ROLE anon`);
      const sp = `sp_err_${spCounter++}`;
      await client.query(`SAVEPOINT ${sp}`);
      let threw = false, message = '';
      try { await client.query(`SELECT * FROM public.admin_listar_mesas($1)`, [STORE_A]); }
      catch (e) { threw = true; message = e.message; await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
      check('B11 anon chamando admin_listar_mesas (sem GRANT) -> permission denied', threw && /permission denied/i.test(message), message);
      await resetRole();
    });

  } finally {
    await client.query('ROLLBACK');
  }

  console.log('\n==========================================================================');
  console.log(` RESULTADO: ${pass} PASS / ${fail} FAIL`);
  console.log('==========================================================================');
  await client.end();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(e => { console.error('ERRO FATAL', e); process.exit(2); });
