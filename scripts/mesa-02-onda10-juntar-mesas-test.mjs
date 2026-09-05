// REF-MESA-02 · Onda 10 (juncao de mesas) -- E2E dedicado.
// admin_juntar_mesa_sessao(): adiciona uma mesa fisica LIVRE a uma sessao ja aberta -- ambas as
// mesas ficam "ocupadas" pela MESMA sessao/conta simultaneamente (diferente da Onda 9, que fecha a
// mesa antiga). Confirma: caso feliz (as 2 mesas apontam pra mesma sessao/total, nenhuma linha
// fechada); no-op ao juntar mesa que ja esta juntada; mesa a juntar ja ocupada por OUTRA sessao ->
// "mesa ja ocupada"; mesa indisponivel; mesa inexistente; sessao ja fechada; cross-tenant; outsider
// sem permissao; juntar 3a mesa continua funcionando (nao e' limitado a 2). SAVEPOINT por caso.
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

let pass = 0, fail = 0, spCounter = 0, n = 0;
const telefone = () => `373${(n++).toString().padStart(8, '0')}`;
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

async function abrirSessao(storeId, identificador, produto) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda10', phone: telefone() }),
     JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: identificador, origem_pedido: 'admin_garcom' }),
     JSON.stringify([{ product_id: produto, nome_produto: 'Produto Onda10', quantity: 1 }]),
     storeId]);
  return r.rows[0].res;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 10 (juncao de mesas) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID, OUTRO_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID(); const STORE_B = randomUUID();
    const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda10 A','ativo'),($3,$4,'Loja Teste MESA-02 Onda10 B','ativo')`,
      [STORE_A, `mesa02-onda10-a-${STORE_A}`, STORE_B, `mesa02-onda10-b-${STORE_B}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda10',10.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'40'),($1,'41'),($1,'42'),($1,'43')`, [STORE_A]);
    await client.query(`UPDATE public.mesas SET status='indisponivel' WHERE store_id=$1 AND identificador='43'`, [STORE_A]);

    // B1: caso feliz -- abre sessao na mesa 40, junta a mesa 41 (livre).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '40', PROD);
      const res = await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '41', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B1 juntar mesa 41 (livre) -> sucesso, mesas inclui 40 e 41', r.ok === true && r.mesas.includes('40') && r.mesas.includes('41') && r.mesas.length === 2, JSON.stringify(r));

      const c40 = (await client.query(`SELECT public.admin_consultar_conta_mesa('40', $1::uuid) AS res`, [STORE_A])).rows[0].res;
      const c41 = (await client.query(`SELECT public.admin_consultar_conta_mesa('41', $1::uuid) AS res`, [STORE_A])).rows[0].res;
      check('B2 AMBAS as mesas ficam ocupadas pela MESMA sessao (nao substitui, diferente da Onda 9)', c40.ok && c41.ok && c40.aberta && c41.aberta && c40.sessao_id === aberto.mesa_session_id && c41.sessao_id === aberto.mesa_session_id, JSON.stringify([c40, c41]));
      check('B3 total identico nas 2 (mesma conta)', Number(c40.total) === Number(c41.total) && Number(c40.total) === 10, JSON.stringify([c40, c41]));
      await resetRole();

      // nenhuma linha foi FECHADA (diferente da Onda 9) -- as duas continuam 'aberta'.
      const linhas = await client.query(`SELECT mesa_identificador, status_sessao FROM public.mesa_session_mesas WHERE mesa_session_id=$1`, [aberto.mesa_session_id]);
      check('B4 nenhuma linha fechada -- as 2 continuam status_sessao=aberta', linhas.rows.length === 2 && linhas.rows.every(r2 => r2.status_sessao === 'aberta'), JSON.stringify(linhas.rows));
    });

    // B5: juntar uma 3a mesa continua funcionando (nao e' limitado a 2).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '40', PROD);
      await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '41', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const res = await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '42', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B5 juntar 3a mesa (42) -> sucesso, mesas inclui as 3', r.ok === true && ['40', '41', '42'].every(id => r.mesas.includes(id)) && r.mesas.length === 3, JSON.stringify(r));
      await resetRole();
    });

    // B6: juntar mesa que JA esta juntada a esta mesma sessao -> no-op amigavel.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '40', PROD);
      await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '41', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const res = await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '41', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B6 juntar mesa ja juntada -> ok, no-op', r.ok === true && r.mesas.length === 2, JSON.stringify(r));
      await resetRole();
      const linhas = await client.query(`SELECT count(*)::int AS c FROM public.mesa_session_mesas WHERE mesa_session_id=$1 AND mesa_identificador='41'`, [aberto.mesa_session_id]);
      check('B7 no-op nao duplica a linha da mesa 41', linhas.rows[0].c === 1, JSON.stringify(linhas.rows));
    });

    // B8: mesa a juntar ja ocupada por OUTRA sessao -> "mesa ja ocupada".
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const s1 = await abrirSessao(STORE_A, '40', PROD);
      const s2 = await abrirSessao(STORE_A, '41', PROD);
      const res = await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '41', $2::uuid) AS res`, [s1.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B8 mesa ja ocupada por outra sessao -> mesa ja ocupada', r.ok === false && r.error === 'mesa ja ocupada', JSON.stringify([r, s2]));
      await resetRole();
    });

    // B9: mesa indisponivel -> rejeitado.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '40', PROD);
      const res = await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '43', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B9 mesa indisponivel -> mesa indisponivel', r.ok === false && r.error === 'mesa indisponivel', JSON.stringify(r));
      await resetRole();
    });

    // B10: mesa inexistente no catalogo -> "mesa nao encontrada".
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '40', PROD);
      const res = await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, 'mesa-inexistente', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B10 mesa inexistente -> mesa nao encontrada', r.ok === false && r.error === 'mesa nao encontrada', JSON.stringify(r));
      await resetRole();
    });

    // B11: sessao ja fechada -> rejeitada.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '40', PROD);
      await resetRole();
      await client.query(`UPDATE public.mesa_sessions SET status='fechada', closed_at=now(), closed_by_admin_user_id=$2, payment_method='dinheiro', valor_cobrado_snapshot=10 WHERE id=$1`, [aberto.mesa_session_id, ADMIN_UID]);
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const res = await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '41', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B11 sessao ja fechada -> sessao ja fechada', r.ok === false && r.error === 'sessao ja fechada', JSON.stringify(r));
      await resetRole();
    });

    // B12: cross-tenant -- sessao pertence a STORE_A, tentativa via STORE_B -> "sessao nao encontrada".
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [OUTRO_UID, STORE_B]);
      await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'41')`, [STORE_B]);
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '40', PROD);
      await resetRole();
      await setRole('authenticated', OUTRO_UID, STORE_B);
      const res = await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '41', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_B]);
      const r = res.rows[0].res;
      check('B12 cross-tenant: sessao de A nao e encontrada por B -> sessao nao encontrada', r.ok === false && r.error === 'sessao nao encontrada', JSON.stringify(r));
      await resetRole();
    });

    // B13: outsider sem is_admin_of -> sem permissao.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '40', PROD);
      await resetRole();
      const OUTSIDER = randomUUID();
      await setRole('authenticated', OUTSIDER, STORE_A);
      const res = await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '41', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B13 outsider sem is_admin_of -> sem permissao', r.ok === false && r.error === 'sem permissao', JSON.stringify(r));
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
