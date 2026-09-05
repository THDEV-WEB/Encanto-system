// REF-MESA-02 · Onda 6 (abertura implicita da sessao) -- E2E dedicado. Camada A/B na conexao
// principal (SAVEPOINT por caso, como sempre). Camada C usa 2 CONEXOES POSTGRES REAIS e SEPARADAS
// (nao savepoints -- FOR UPDATE so bloqueia entre transacoes DIFERENTES) para provar a concorrencia
// de verdade: 2 "primeiros pedidos" simultaneos pra mesma mesa devem resultar em EXATAMENTE 1 sessao.
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
const telefone = () => `399${(n++).toString().padStart(8, '0')}`;
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
async function criarPedido(storeId, prodId, extra) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda6', phone: telefone() }),
     JSON.stringify(extra),
     JSON.stringify([{ product_id: prodId, nome_produto: 'Produto Onda6', quantity: 1 }]), storeId]);
  return r.rows[0].res;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 6 (abertura implicita da sessao) · E2E');
  console.log('==========================================================================\n');

  let STORE_A, PROD, ADMIN_UID;

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    [ADMIN_UID] = authUsers.map(x => x.id);

    STORE_A = randomUUID(); PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda6','ativo')`, [STORE_A, `mesa02-onda6-${STORE_A}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda6',20.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_canal_admin','true')`, [STORE_A]);

    console.log('── CAMADA A: get/set_mesa_config com a 4a chave ──\n');
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const cfg = await client.query(`SELECT public.get_mesa_config($1) AS c`, [STORE_A]);
      check('A1 sessao_habilitada default = false', cfg.rows[0].c.sessao_habilitada === false, JSON.stringify(cfg.rows[0].c));
      const r = await client.query(`SELECT public.set_mesa_config(true, false, true, true, $1) AS r`, [STORE_A]);
      check('A2 set_mesa_config com 4 booleanos -> sucesso, sessao_habilitada=true', r.rows[0].r.ok === true && r.rows[0].r.sessao_habilitada === true, JSON.stringify(r.rows[0].r));
      const cfg2 = await client.query(`SELECT public.get_mesa_config($1) AS c`, [STORE_A]);
      check('A3 get_mesa_config reflete sessao_habilitada=true imediatamente', cfg2.rows[0].c.sessao_habilitada === true, JSON.stringify(cfg2.rows[0].c));
      await resetRole();
    });

    console.log('\n── CAMADA B: create_order() abre/reaproveita sessao (sequencial) ──\n');
    // set_mesa_config (A2) rodou DENTRO de um savepoint ja revertido -- a linha nunca foi persistida.
    // INSERT direto aqui, FORA de qualquer savepoint, pra sobreviver aos B* seguintes.
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_sessao_habilitada','true')`, [STORE_A]);

    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const res1 = await criarPedido(STORE_A, PROD, { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '10', origem_pedido: 'admin_garcom' });
      check('B1 1o pedido da mesa 10 -> sucesso, abre sessao', res1.ok === true && !!res1.mesa_session_id, JSON.stringify(res1));

      const res2 = await criarPedido(STORE_A, PROD, { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '10', origem_pedido: 'admin_garcom' });
      check('B2 2o pedido da MESMA mesa 10 -> reaproveita a MESMA sessao (nao cria outra)', res2.ok === true && res2.mesa_session_id === res1.mesa_session_id, JSON.stringify({ res1, res2 }));

      await resetRole();
      const rows = (await client.query(`SELECT mesa_session_id FROM public.orders WHERE tipo_pedido='mesa' AND mesa_identificador='10' AND store_id=$1`, [STORE_A])).rows;
      check('B3 ambos os pedidos gravados com o MESMO mesa_session_id', rows.length === 2 && rows[0].mesa_session_id === rows[1].mesa_session_id, JSON.stringify(rows));

      const sess = (await client.query(`SELECT origem_abertura, opened_by_admin_user_id FROM public.mesa_sessions WHERE id=$1`, [res1.mesa_session_id])).rows[0];
      check('B4 sessao registrada com origem_abertura=admin_garcom e opened_by_admin_user_id preenchido', sess.origem_abertura === 'admin_garcom' && sess.opened_by_admin_user_id === ADMIN_UID, JSON.stringify(sess));
    });

    // REGRESSAO: loja SEM mesa_sessao_habilitada continua sem gravar mesa_session_id (comportamento identico a antes desta onda).
    await withSavepoint(async () => {
      await client.query(`UPDATE public.store_settings SET valor='false' WHERE store_id=$1 AND chave='mesa_sessao_habilitada'`, [STORE_A]);
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const res = await criarPedido(STORE_A, PROD, { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '11', origem_pedido: 'admin_garcom' });
      check('B5 REGRESSAO: mesa_sessao_habilitada=false -> mesa_session_id continua NULL (comportamento identico a antes)', res.ok === true && res.mesa_session_id === null, JSON.stringify(res));
      await resetRole();
    });
    await client.query(`UPDATE public.store_settings SET valor='true' WHERE store_id=$1 AND chave='mesa_sessao_habilitada'`, [STORE_A]);

    // REGRESSAO: entrega/retirada continuam sem qualquer nocao de sessao.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const res = await criarPedido(STORE_A, PROD, { payment_method: 'dinheiro', address: 'Rua Teste, 1' });
      check('B6 REGRESSAO: entrega continua funcionando, mesa_session_id NULL', res.ok === true && res.mesa_session_id === null, JSON.stringify(res));
      await resetRole();
    });

  } finally {
    await client.query('ROLLBACK');
  }

  // ── CAMADA C: concorrencia REAL, 2 conexoes Postgres SEPARADAS (fora do BEGIN/ROLLBACK acima --
  // precisa que STORE_A/PROD tenham sido persistidos de fato, entao usa dados novos e proprios,
  // limpos ao final por este bloco). ──
  console.log('\n── CAMADA C: concorrencia real (2 conexoes Postgres, nao savepoints) ──\n');
  const connA = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false } });
  const connB = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false } });
  await connA.connect(); await connB.connect();
  const STORE_C = randomUUID(); const PROD_C = randomUUID();
  try {
    await connA.query('BEGIN');
    await connA.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda6 Concorrencia','ativo')`, [STORE_C, `mesa02-onda6-c-${STORE_C}`]);
    await connA.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda6C',20.00,true,$2)`, [PROD_C, STORE_C]);
    await connA.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_sessao_habilitada','true'),($1,'mesa_canal_admin','true')`, [STORE_C]);
    await connA.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_C]);
    await connA.query('COMMIT');

    // Ambas as conexoes vao competir por _get_or_open_mesa_session na MESMA mesa '20', na MESMA loja.
    await connA.query('BEGIN');
    await connB.query('BEGIN');
    await connA.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_UID, tenant_id: STORE_C })]);
    await connA.query(`SET LOCAL ROLE authenticated`);
    await connB.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_UID, tenant_id: STORE_C })]);
    await connB.query(`SET LOCAL ROLE authenticated`);

    const pidA = (await connA.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pidB = (await connB.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    // connA entra primeiro e NAO comita ainda -- segura a linha (INSERT em mesa_session_mesas ja
    // grava a chave do indice unico parcial, visivel/bloqueante pra outras transacoes mesmo antes do
    // commit).
    const pA = connA.query(
      `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
      [JSON.stringify({ name: 'Cliente A', phone: '39900000001' }),
       JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '20', origem_pedido: 'admin_garcom' }),
       JSON.stringify([{ product_id: PROD_C, nome_produto: 'Produto Onda6C', quantity: 1 }]), STORE_C]);

    // pequena espera pra dar tempo de connA chegar no INSERT de mesa_session_mesas antes de connB tentar.
    await new Promise((r) => setTimeout(r, 300));

    const pB = connB.query(
      `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
      [JSON.stringify({ name: 'Cliente B', phone: '39900000002' }),
       JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '20', origem_pedido: 'admin_garcom' }),
       JSON.stringify([{ product_id: PROD_C, nome_produto: 'Produto Onda6C', quantity: 1 }]), STORE_C]);

    // PROVA ROBUSTA de bloqueio real: consulta pg_locks (via a conexao PRINCIPAL, livre, fora das
    // 2 transacoes em disputa) verificando se o backend de alguma das duas conexoes esta REALMENTE
    // esperando um lock (granted=false) -- mais confiavel que inferir por timing de promise (que e'
    // sensivel a latencia de rede real, ja observado como flaky numa 1a tentativa desta mesma onda).
    let waitingPid = null, tentativas = 0;
    while (tentativas < 20) {
      const locks = await client.query(
        `SELECT pid, granted, mode FROM pg_locks WHERE pid IN ($1,$2) AND NOT granted`, [pidA, pidB]);
      if (locks.rows.length > 0) { waitingPid = locks.rows[0].pid; break; }
      await new Promise((r) => setTimeout(r, 50));
      tentativas++;
    }
    check('C1 uma das 2 conexoes esta REALMENTE bloqueada em pg_locks esperando a outra (prova de lock real via catalogo, nao inferencia por timing)',
      waitingPid !== null, `apos ${tentativas} tentativas, nenhum lock pendente encontrado (pidA=${pidA} pidB=${pidB})`);

    await connA.query('COMMIT');
    const resB = await pB; // agora sim desbloqueia (se estava esperando) e resolve
    await connB.query('COMMIT');
    const resA = await pA;
    check('C2 ambos os pedidos concorrentes retornam ok:true', resA.rows[0].res.ok === true && resB.rows[0].res.ok === true, JSON.stringify({ a: resA.rows[0].res, b: resB.rows[0].res }));
    check('C3 AMBOS resolvem para a MESMA sessao (nao criaram 2 sessoes pra mesma mesa)', resA.rows[0].res.mesa_session_id === resB.rows[0].res.mesa_session_id, JSON.stringify({ a: resA.rows[0].res.mesa_session_id, b: resB.rows[0].res.mesa_session_id }));

    // Limpeza real (fora de transacao de teste) -- este bloco NAO estava dentro do BEGIN...ROLLBACK
    // principal, entao precisa limpar manualmente pra manter liquido zero no E2E.
    await client.query('BEGIN');
    await client.query(`DELETE FROM public.order_items WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.orders WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.mesa_session_mesas WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.mesa_sessions WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.customers WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.admins WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.store_settings WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.products WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.stores WHERE id=$1`, [STORE_C]);
    await client.query('COMMIT');
    console.log('Limpeza manual da CAMADA C confirmada (liquido zero no E2E).');
  } catch (e) {
    console.error('ERRO NA CAMADA C', e);
    fail++;
    try { await connA.query('ROLLBACK'); } catch { /* ignore */ }
    try { await connB.query('ROLLBACK'); } catch { /* ignore */ }
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM public.order_items WHERE store_id=$1`, [STORE_C]);
      await client.query(`DELETE FROM public.orders WHERE store_id=$1`, [STORE_C]);
      await client.query(`DELETE FROM public.mesa_session_mesas WHERE store_id=$1`, [STORE_C]);
      await client.query(`DELETE FROM public.mesa_sessions WHERE store_id=$1`, [STORE_C]);
      await client.query(`DELETE FROM public.customers WHERE store_id=$1`, [STORE_C]);
      await client.query(`DELETE FROM public.admins WHERE store_id=$1`, [STORE_C]);
      await client.query(`DELETE FROM public.store_settings WHERE store_id=$1`, [STORE_C]);
      await client.query(`DELETE FROM public.products WHERE store_id=$1`, [STORE_C]);
      await client.query(`DELETE FROM public.stores WHERE id=$1`, [STORE_C]);
      await client.query('COMMIT');
    } catch { /* melhor esforco de limpeza em caso de erro */ }
  } finally {
    await connA.end(); await connB.end();
  }

  console.log('\n==========================================================================');
  console.log(` RESULTADO: ${pass} PASS / ${fail} FAIL`);
  console.log('==========================================================================');
  await client.end();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(e => { console.error('ERRO FATAL', e); process.exit(2); });
