// REF-MESA-02 · Onda 8 (consulta da conta) -- E2E dedicado.
// admin_consultar_conta_mesa(): so leitura (STABLE), sem side effect. Confirma: mesa sem sessao
// aberta -> aberta:false/total:0; sessao aberta com 2 pedidos -> total = soma correta; pedido
// cancelado aparece na lista mas NAO entra no total (mesmo criterio do BI, REF-DASHBOARD-01);
// cross-tenant (outra loja nao ve a conta); outsider sem is_admin_of -> sem permissao; mesa
// inexistente -> mesa nao encontrada; RPC nunca muda nada (verificado via contagem de linhas antes/
// depois). SAVEPOINT por caso.
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
const telefone = () => `371${(n++).toString().padStart(8, '0')}`;
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
  console.log(' REF-MESA-02 · Onda 8 (consulta da conta) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID, OUTRO_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID(); const STORE_B = randomUUID();
    const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda8 A','ativo'),($3,$4,'Loja Teste MESA-02 Onda8 B','ativo')`,
      [STORE_A, `mesa02-onda8-a-${STORE_A}`, STORE_B, `mesa02-onda8-b-${STORE_B}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda8',10.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true')`, [STORE_A]);
    // mesa cadastrada no catalogo (sem sessao ainda)
    await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'20'),($1,'21')`, [STORE_A]);

    // B1: mesa cadastrada, sem sessao aberta -> aberta:false, total 0, nao e erro
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const res = await client.query(`SELECT public.admin_consultar_conta_mesa('20', $1::uuid) AS res`, [STORE_A]);
      const r = res.rows[0].res;
      check('B1 mesa sem sessao aberta -> ok:true, aberta:false, total:0', r.ok === true && r.aberta === false && Number(r.total) === 0, JSON.stringify(r));
      await resetRole();
    });

    // B2: mesa que nunca foi cadastrada -> mesa nao encontrada
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const res = await client.query(`SELECT public.admin_consultar_conta_mesa('mesa-que-nao-existe', $1::uuid) AS res`, [STORE_A]);
      const r = res.rows[0].res;
      check('B2 mesa inexistente -> mesa nao encontrada', r.ok === false && r.error === 'mesa nao encontrada', JSON.stringify(r));
      await resetRole();
    });

    // B3: outsider (sem vinculo admin em nenhuma loja) -> sem permissao
    await withSavepoint(async () => {
      const OUTSIDER = randomUUID();
      await setRole('authenticated', OUTSIDER, STORE_A);
      const res = await client.query(`SELECT public.admin_consultar_conta_mesa('20', $1::uuid) AS res`, [STORE_A]);
      const r = res.rows[0].res;
      check('B3 outsider sem is_admin_of -> sem permissao', r.ok === false && r.error === 'sem permissao', JSON.stringify(r));
      await resetRole();
    });

    // B4/B5/B6: abre sessao real (2 pedidos via create_order admin_garcom, 1 deles cancelado depois)
    // e confirma total/lista/mesas da sessao.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const p1 = await client.query(
        `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
        [JSON.stringify({ name: 'Cliente Onda8 A', phone: telefone() }),
         JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '21', origem_pedido: 'admin_garcom' }),
         JSON.stringify([{ product_id: PROD, nome_produto: 'Produto Onda8', quantity: 1 }]),
         STORE_A]);
      const p2 = await client.query(
        `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
        [JSON.stringify({ name: 'Cliente Onda8 A', phone: telefone() }),
         JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '21', origem_pedido: 'admin_garcom' }),
         JSON.stringify([{ product_id: PROD, nome_produto: 'Produto Onda8', quantity: 2 }]),
         STORE_A]);
      check('B4 setup: 2 pedidos criados na mesma sessao (mesa 21)', p1.rows[0].res.ok === true && p2.rows[0].res.ok === true
        && p1.rows[0].res.mesa_session_id === p2.rows[0].res.mesa_session_id, JSON.stringify([p1.rows[0].res, p2.rows[0].res]));

      // cancela o 2o pedido (quantity=2, total=20) -- so deve sumir do TOTAL, nao da lista.
      await client.query(`UPDATE public.orders SET status = 'cancelado' WHERE id = $1`, [p2.rows[0].res.order_id]);

      const res = await client.query(`SELECT public.admin_consultar_conta_mesa('21', $1::uuid) AS res`, [STORE_A]);
      const r = res.rows[0].res;
      check('B5 sessao aberta -> aberta:true + sessao_id bate com create_order', r.ok === true && r.aberta === true && r.sessao_id === p1.rows[0].res.mesa_session_id, JSON.stringify(r));
      check('B6 mesas da sessao inclui identificador 21', Array.isArray(r.mesas) && r.mesas.includes('21'), JSON.stringify(r));
      check('B7 pedidos lista os 2 (cancelado incluso, para transparencia)', Array.isArray(r.pedidos) && r.pedidos.length === 2, JSON.stringify(r));
      check('B8 pedido cancelado aparece com status correto na lista', r.pedidos.some(p => p.status === 'cancelado'), JSON.stringify(r));
      check('B9 total EXCLUI o cancelado -- so soma o pedido 1 (10.00), nao 30.00', Number(r.total) === 10, JSON.stringify(r));
      check('B10 itens do pedido aberto persistidos corretamente (nome/qty/preco)', r.pedidos.some(p => p.status !== 'cancelado' && Array.isArray(p.itens) && p.itens[0]?.nome_produto === 'Produto Onda8' && Number(p.itens[0]?.preco_unitario) === 10), JSON.stringify(r));
      await resetRole();

      // B11: outra loja (STORE_B) nao enxerga a conta de STORE_A -- cross-tenant.
      await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [OUTRO_UID, STORE_B]);
      await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'21')`, [STORE_B]);
      await setRole('authenticated', OUTRO_UID, STORE_B);
      const cross = await client.query(`SELECT public.admin_consultar_conta_mesa('21', $1::uuid) AS res`, [STORE_B]);
      const rc = cross.rows[0].res;
      check('B11 cross-tenant: mesma identificador "21" em loja B nao ve a sessao de A', rc.ok === true && rc.aberta === false, JSON.stringify(rc));
      await resetRole();
    });

    // B12: confirma que a RPC e' STABLE/sem side effect -- nenhuma linha nova em mesa_sessions so'
    // de chamar. Contagem feita como o papel de conexao (postgres/superuser, dono da tabela) --
    // mesa_sessions tem REVOKE ALL de authenticated (Onda 2), so a RPC SECURITY DEFINER enxerga.
    await withSavepoint(async () => {
      const before = await client.query(`SELECT count(*)::int AS c FROM public.mesa_sessions WHERE store_id = $1`, [STORE_A]);
      await setRole('authenticated', ADMIN_UID, STORE_A);
      await client.query(`SELECT public.admin_consultar_conta_mesa('20', $1::uuid) AS res`, [STORE_A]);
      await resetRole();
      const after = await client.query(`SELECT count(*)::int AS c FROM public.mesa_sessions WHERE store_id = $1`, [STORE_A]);
      check('B12 RPC de consulta nao cria nenhuma sessao nova (somente leitura)', before.rows[0].c === after.rows[0].c, `before=${before.rows[0].c} after=${after.rows[0].c}`);
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
