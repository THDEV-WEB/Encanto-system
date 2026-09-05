// REF-MESA-02 · Onda 11 (fechamento da conta) -- E2E dedicado.
// admin_fechar_conta_mesa(): encerra uma sessao aberta, grava payment_method/valor_cobrado_snapshot
// (auditoria, nunca 2a fonte de receita -- SUM(orders.total) continua sendo a fonte real), e libera
// TODAS as mesas fisicas associadas via a trigger de sincronizacao ja existente desde a Onda 2 (nao
// precisa tocar mesa_session_mesas/public.mesas diretamente). Confirma: caso feliz com 1 mesa; caso
// feliz com mesas juntadas (Onda 10) -- todas liberam juntas; forma de pagamento obrigatoria quando
// total>0; sessao SEM pedidos (total=0) fecha sem forma de pagamento; sessao ja fechada -> rejeitada
// (idempotencia de erro, nao duplica fechamento); sessao imutavel apos fechar (trigger da Onda 2
// bloqueia); cross-tenant; outsider sem permissao; valor_cobrado_snapshot bate com o total real.
// SAVEPOINT por caso.
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
const telefone = () => `374${(n++).toString().padStart(8, '0')}`;
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

async function abrirSessao(storeId, identificador, produto, qty = 1) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda11', phone: telefone() }),
     JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: identificador, origem_pedido: 'admin_garcom' }),
     JSON.stringify([{ product_id: produto, nome_produto: 'Produto Onda11', quantity: qty }]),
     storeId]);
  return r.rows[0].res;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 11 (fechamento da conta) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID, OUTRO_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID(); const STORE_B = randomUUID();
    const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda11 A','ativo'),($3,$4,'Loja Teste MESA-02 Onda11 B','ativo')`,
      [STORE_A, `mesa02-onda11-a-${STORE_A}`, STORE_B, `mesa02-onda11-b-${STORE_B}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda11',10.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'50'),($1,'51')`, [STORE_A]);

    // B1: caso feliz -- fecha com pagamento, mesa libera, sessao vira fechada com snapshot correto.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '50', PROD, 2); // total = 20
      const res = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'pix', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B1 fechar com pagamento -> sucesso, total correto', r.ok === true && Number(r.total) === 20 && r.payment_method === 'pix', JSON.stringify(r));

      const conta = (await client.query(`SELECT public.admin_consultar_conta_mesa('50', $1::uuid) AS res`, [STORE_A])).rows[0].res;
      check('B2 mesa libera apos fechamento (sem sessao aberta)', conta.ok === true && conta.aberta === false, JSON.stringify(conta));
      await resetRole();

      const sessao = await client.query(`SELECT status, payment_method, valor_cobrado_snapshot, closed_by_admin_user_id FROM public.mesa_sessions WHERE id=$1`, [aberto.mesa_session_id]);
      check('B3 sessao persistida como fechada com snapshot/forma/quem fechou corretos', sessao.rows[0].status === 'fechada' && sessao.rows[0].payment_method === 'pix' && Number(sessao.rows[0].valor_cobrado_snapshot) === 20 && sessao.rows[0].closed_by_admin_user_id === ADMIN_UID, JSON.stringify(sessao.rows));
    });

    // B4: mesas JUNTADAS (Onda 10) -- fechar libera as 2 ao mesmo tempo via a trigger de sync.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '50', PROD, 1);
      await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '51', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const res = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'dinheiro', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      check('B4 fecha sessao com 2 mesas juntadas -> sucesso', res.rows[0].res.ok === true, JSON.stringify(res.rows[0].res));

      const c50 = (await client.query(`SELECT public.admin_consultar_conta_mesa('50', $1::uuid) AS res`, [STORE_A])).rows[0].res;
      const c51 = (await client.query(`SELECT public.admin_consultar_conta_mesa('51', $1::uuid) AS res`, [STORE_A])).rows[0].res;
      check('B5 AMBAS as mesas juntadas liberam ao fechar (trigger de sync automatica)', c50.aberta === false && c51.aberta === false, JSON.stringify([c50, c51]));
      await resetRole();
    });

    // B6: total > 0 SEM forma de pagamento -> rejeitado.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '50', PROD, 1);
      const res = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, NULL, $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B6 total>0 sem forma de pagamento -> forma de pagamento obrigatoria', r.ok === false && r.error === 'forma de pagamento obrigatoria', JSON.stringify(r));
      await resetRole();
      // confirma que NADA mudou -- sessao continua aberta apos rejeicao.
      const sessao = await client.query(`SELECT status FROM public.mesa_sessions WHERE id=$1`, [aberto.mesa_session_id]);
      check('B7 sessao continua aberta apos rejeicao (nada foi alterado)', sessao.rows[0].status === 'aberta', JSON.stringify(sessao.rows));
    });

    // B8: sessao SEM pedidos (total=0) -- via abertura implicita manual (sem create_order), fecha
    // sem forma de pagamento.
    await withSavepoint(async () => {
      const sessaoVazia = await client.query(
        `INSERT INTO public.mesa_sessions (store_id, origem_abertura, opened_by_admin_user_id) VALUES ($1,'admin_garcom',$2) RETURNING id`,
        [STORE_A, ADMIN_UID]);
      await client.query(`INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'50')`, [sessaoVazia.rows[0].id, STORE_A]);
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const res = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, NULL, $2::uuid) AS res`, [sessaoVazia.rows[0].id, STORE_A]);
      const r = res.rows[0].res;
      check('B8 sessao sem pedidos (total=0) fecha sem forma de pagamento', r.ok === true && Number(r.total) === 0 && r.payment_method === null, JSON.stringify(r));
      await resetRole();
    });

    // B9: sessao ja fechada -> rejeitada (nao fecha 2x, nao duplica efeito).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '50', PROD, 1);
      await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'dinheiro', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const res = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'pix', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B9 fechar 2a vez -> sessao ja fechada', r.ok === false && r.error === 'sessao ja fechada', JSON.stringify(r));
      await resetRole();
      const sessao = await client.query(`SELECT payment_method FROM public.mesa_sessions WHERE id=$1`, [aberto.mesa_session_id]);
      check('B10 2a tentativa nao sobrescreveu a forma de pagamento original', sessao.rows[0].payment_method === 'dinheiro', JSON.stringify(sessao.rows));
    });

    // B11: sessao fechada e' IMUTAVEL -- trigger da Onda 2 bloqueia qualquer UPDATE direto.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '50', PROD, 1);
      await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'dinheiro', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      await resetRole();
      await client.query(`SAVEPOINT sp_imutavel`);
      let bloqueado = false;
      try {
        await client.query(`UPDATE public.mesa_sessions SET payment_method='pix' WHERE id=$1`, [aberto.mesa_session_id]);
      } catch (e) {
        bloqueado = /imutavel|reaberta/i.test(e.message);
      }
      await client.query(`ROLLBACK TO SAVEPOINT sp_imutavel`);
      check('B11 sessao fechada e imutavel (trigger _mesa_sessions_no_reopen bloqueia UPDATE direto)', bloqueado, 'trigger nao bloqueou');
    });

    // B12: cross-tenant -- sessao de A nao e encontrada por B.
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [OUTRO_UID, STORE_B]);
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '50', PROD, 1);
      await resetRole();
      await setRole('authenticated', OUTRO_UID, STORE_B);
      const res = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'dinheiro', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_B]);
      const r = res.rows[0].res;
      check('B12 cross-tenant: sessao de A nao e encontrada por B -> sessao nao encontrada', r.ok === false && r.error === 'sessao nao encontrada', JSON.stringify(r));
      await resetRole();
    });

    // B13: outsider sem is_admin_of -> sem permissao.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '50', PROD, 1);
      await resetRole();
      const OUTSIDER = randomUUID();
      await setRole('authenticated', OUTSIDER, STORE_A);
      const res = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'dinheiro', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
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
