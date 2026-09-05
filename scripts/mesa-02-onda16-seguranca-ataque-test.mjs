// REF-MESA-02 · Onda 16 (seguranca/ataque) -- auditoria adversarial DEDICADA. Cada onda (2-15) ja
// embutiu testes adversariais na propria suite (cross-tenant, outsider, sem permissao) -- esta e'
// uma varredura especifica pra achar o que ficou de fora, espelhando o rigor ja usado pra achar R3
// na Onda 5. Achado real corrigido ANTES deste teste (ver migration onda16): admin_reports_summary
// tinha EXECUTE pra PUBLIC/anon desde a criacao original (REF-DASHBOARD-01), nunca corrigido por
// nenhum CREATE OR REPLACE seguinte -- is_admin_of ja bloqueava de fato (sem vazamento real), mas
// violava o padrao de defesa-em-profundidade do dominio (REF-SEC-02).
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
const telefone = () => `378${(n++).toString().padStart(8, '0')}`;
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

// ── Mapa de grants ESPERADOS pra TODA funcao tocada por esta REF (2-15). Internas (_*) -> zero
// grant pra ninguem (so trigger/owner). admin_* + set_mesa_config -> so authenticated (nunca
// anon/PUBLIC -- superficie de admin). create_order/get_mesa_config/resolver_mesa_por_token ->
// anon+authenticated (guest checkout real, por design). ──
const FUNCOES_INTERNAS = [
  '_calcular_total_sessao_mesa', '_get_or_open_mesa_session', '_mesa_session_mesas_check_store',
  '_mesa_session_mesas_immutable', '_mesa_session_mesas_sync_status', '_mesa_sessions_no_reopen',
  '_orders_mesa_session_check_store', '_orders_mesa_session_immutable',
];
const FUNCOES_ADMIN = [
  'admin_consultar_conta_mesa', 'admin_criar_mesa', 'admin_fechar_conta_mesa',
  'admin_juntar_mesa_sessao', 'admin_listar_mesas', 'admin_obter_url_storefront',
  'admin_reports_summary', 'admin_set_mesa_status', 'admin_trocar_mesa_sessao', 'set_mesa_config',
];
const FUNCOES_GUEST = ['create_order', 'get_mesa_config', 'resolver_mesa_por_token'];

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 16 (seguranca/ataque) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID, _OUTRO_UID] = authUsers.map(x => x.id);

    // ── 1) VARREDURA DE GRANTS -- todas as 21 funcoes desta REF, ao vivo (has_function_privilege,
    // nao releitura de texto de migration). ──
    const todasFuncoes = [...FUNCOES_INTERNAS, ...FUNCOES_ADMIN, ...FUNCOES_GUEST];
    const grants = await client.query(`
      SELECT p.proname,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
        has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])
    `, [todasFuncoes]);
    const porNome = Object.fromEntries(grants.rows.map(r => [r.proname, r]));

    check(`G1 todas as ${todasFuncoes.length} funcoes desta REF foram encontradas no catalogo (nenhuma renomeada/faltando)`, grants.rows.length === todasFuncoes.length, `encontradas: ${grants.rows.length}, esperado: ${todasFuncoes.length}. Faltando: ${todasFuncoes.filter(f => !porNome[f]).join(', ')}`);

    for (const f of FUNCOES_INTERNAS) {
      const g = porNome[f];
      check(`G-interna ${f}: ZERO grant (nem anon, nem authenticated, nem PUBLIC)`, g && !g.anon_exec && !g.auth_exec && !g.public_exec, JSON.stringify(g));
    }
    for (const f of FUNCOES_ADMIN) {
      const g = porNome[f];
      check(`G-admin ${f}: authenticated=true, anon=false, PUBLIC=false`, g && g.auth_exec === true && g.anon_exec === false && g.public_exec === false, JSON.stringify(g));
    }
    for (const f of FUNCOES_GUEST) {
      const g = porNome[f];
      check(`G-guest ${f}: anon=true E authenticated=true (checkout sem login), PUBLIC=false`, g && g.anon_exec === true && g.auth_exec === true && g.public_exec === false, JSON.stringify(g));
    }

    // ── 2) resolver_mesa_por_token fail-closed contra token forjado/aleatorio ──
    await withSavepoint(async () => {
      await setRole('anon', null, null);
      const tokenAleatorio = randomUUID();
      const r1 = await client.query(`SELECT public.resolver_mesa_por_token($1::uuid) AS res`, [tokenAleatorio]);
      check('A1 token UUID aleatorio (bem formado, nunca existiu) -> falha generica, nao 500/crash', r1.rows[0].res.ok === false, JSON.stringify(r1.rows[0].res));
      await resetRole();
    });

    // ── 3) Ataque combinado: outsider tenta admin_trocar/juntar/fechar usando p_store_id de uma
    // loja onde REALMENTE existe uma sessao (nao uma loja vazia/inexistente) -- confirma que
    // is_admin_of sozinho bloqueia, mesmo quando o session_id "existe de verdade" no alvo. ──
    await withSavepoint(async () => {
      const STORE_ALVO = randomUUID(); const PROD = randomUUID();
      await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Alvo Onda16','ativo')`, [STORE_ALVO, `mesa02-onda16-alvo-${STORE_ALVO}`]);
      await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda16',10.00,true,$2)`, [PROD, STORE_ALVO]);
      await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_ALVO]);
      await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true')`, [STORE_ALVO]);
      await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'99')`, [STORE_ALVO]);

      await setRole('authenticated', ADMIN_UID, STORE_ALVO);
      const pedido = await client.query(
        `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
        [JSON.stringify({ name: 'Cliente Alvo', phone: telefone() }),
         JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '99', origem_pedido: 'admin_garcom' }),
         JSON.stringify([{ product_id: PROD, nome_produto: 'Produto Onda16', quantity: 1 }]), STORE_ALVO]);
      const sessaoReal = pedido.rows[0].res.mesa_session_id;
      await resetRole();

      const ATACANTE = randomUUID(); // sem NENHUM vinculo admin em lugar nenhum
      await setRole('authenticated', ATACANTE, STORE_ALVO);
      const rTroca = await client.query(`SELECT public.admin_trocar_mesa_sessao($1::uuid, '99', $2::uuid) AS res`, [sessaoReal, STORE_ALVO]);
      const rJuntar = await client.query(`SELECT public.admin_juntar_mesa_sessao($1::uuid, '99', $2::uuid) AS res`, [sessaoReal, STORE_ALVO]);
      const rFechar = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'dinheiro', $2::uuid) AS res`, [sessaoReal, STORE_ALVO]);
      const rUrl = await client.query(`SELECT public.admin_obter_url_storefront($1::uuid) AS res`, [STORE_ALVO]);
      check('A2 outsider com session_id REAL de uma loja alheia -> trocar bloqueado (sem permissao)', rTroca.rows[0].res.ok === false && rTroca.rows[0].res.error === 'sem permissao', JSON.stringify(rTroca.rows[0].res));
      check('A3 outsider com session_id REAL de uma loja alheia -> juntar bloqueado (sem permissao)', rJuntar.rows[0].res.ok === false && rJuntar.rows[0].res.error === 'sem permissao', JSON.stringify(rJuntar.rows[0].res));
      check('A4 outsider com session_id REAL de uma loja alheia -> fechar bloqueado (sem permissao)', rFechar.rows[0].res.ok === false && rFechar.rows[0].res.error === 'sem permissao', JSON.stringify(rFechar.rows[0].res));
      check('A5 outsider nao ve a URL da loja alheia (sem permissao)', rUrl.rows[0].res.ok === false && rUrl.rows[0].res.error === 'sem permissao', JSON.stringify(rUrl.rows[0].res));
      await resetRole();

      // confirma que NADA mudou de verdade apos os 4 ataques rejeitados.
      const statusFinal = await client.query(`SELECT status FROM public.mesa_sessions WHERE id=$1`, [sessaoReal]);
      check('A6 sessao alvo continua intacta (aberta) apos os 4 ataques rejeitados', statusFinal.rows[0].status === 'aberta', JSON.stringify(statusFinal.rows));
    });

    // ── 4) RLS/REVOKE direto nas tabelas -- authenticated tentando bypassar toda RPC e' bloqueado
    // por "permission denied" (REVOKE ALL da Onda 2), nao um SELECT silenciosamente vazio. Cada
    // tentativa (erro ESPERADO) roda no SEU PROPRIO savepoint aninhado -- um try/catch em JS nao
    // limpa o estado abortado da transacao no lado do Postgres (licao ja documentada no
    // checkpoint: sem ROLLBACK TO SAVEPOINT, o comando seguinte falha com "current transaction is
    // aborted", nao com o erro que estamos de fato testando). ──
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, null);

      let bloqueadoSelect = false;
      await client.query(`SAVEPOINT sp_a7`);
      try { await client.query(`SELECT * FROM public.mesa_sessions LIMIT 1`); }
      catch (e) { bloqueadoSelect = /permission denied/i.test(e.message); }
      finally { await client.query(`ROLLBACK TO SAVEPOINT sp_a7`); }
      check('A7 authenticated SELECT direto em mesa_sessions (bypass de RPC) -> permission denied, nao 0 linhas silencioso', bloqueadoSelect, 'nao recebeu permission denied');

      let bloqueadoInsert = false;
      await client.query(`SAVEPOINT sp_a8`);
      try { await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'hack')`, [randomUUID()]); }
      catch (e) { bloqueadoInsert = /permission denied/i.test(e.message); }
      finally { await client.query(`ROLLBACK TO SAVEPOINT sp_a8`); }
      check('A8 authenticated INSERT direto em mesas (bypass de RPC) -> permission denied', bloqueadoInsert, 'nao recebeu permission denied');

      await resetRole();
    });

  } finally {
    await client.query('ROLLBACK');
  }

  // ── 5) CONCORRENCIA MALICIOSA: 2 conexoes tentando fechar a MESMA sessao ao mesmo tempo --
  // so' uma pode vencer, prova via pg_locks (mesma tecnica robusta da Onda 6), fora do
  // BEGIN/ROLLBACK principal (precisa de dados persistidos de verdade entre as 2 conexoes). ──
  console.log('\n── Concorrencia real: 2 conexoes fechando a mesma conta ──\n');
  const connA = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false } });
  const connB = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false } });
  await connA.connect(); await connB.connect();
  const STORE_C = randomUUID(); const PROD_C = randomUUID();
  const authUsers2 = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
  const ADMIN_UID2 = authUsers2[0].id;
  try {
    await connA.query('BEGIN');
    await connA.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda16 Concorrencia','ativo')`, [STORE_C, `mesa02-onda16-c-${STORE_C}`]);
    await connA.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda16C',10.00,true,$2)`, [PROD_C, STORE_C]);
    await connA.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_sessao_habilitada','true'),($1,'mesa_canal_admin','true')`, [STORE_C]);
    await connA.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID2, STORE_C]);
    await connA.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'70')`, [STORE_C]);
    await connA.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_UID2, tenant_id: STORE_C })]);
    await connA.query(`SET LOCAL ROLE authenticated`);
    const aberto = await connA.query(
      `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
      [JSON.stringify({ name: 'Cliente Onda16C', phone: '37800000001' }),
       JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '70', origem_pedido: 'admin_garcom' }),
       JSON.stringify([{ product_id: PROD_C, nome_produto: 'Produto Onda16C', quantity: 1 }]), STORE_C]);
    const sessaoId = aberto.rows[0].res.mesa_session_id;
    await connA.query('COMMIT');

    await connA.query('BEGIN');
    await connB.query('BEGIN');
    await connA.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_UID2, tenant_id: STORE_C })]);
    await connA.query(`SET LOCAL ROLE authenticated`);
    await connB.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_UID2, tenant_id: STORE_C })]);
    await connB.query(`SET LOCAL ROLE authenticated`);

    const pidA = (await connA.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pidB = (await connB.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    const pA = connA.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'dinheiro', $2::uuid) AS res`, [sessaoId, STORE_C]);
    await new Promise((r) => setTimeout(r, 300));
    const pB = connB.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'pix', $2::uuid) AS res`, [sessaoId, STORE_C]);

    let waitingPid = null, tentativas = 0;
    while (tentativas < 20) {
      const locks = await client.query(`SELECT pid FROM pg_locks WHERE pid IN ($1,$2) AND NOT granted`, [pidA, pidB]);
      if (locks.rows.length > 0) { waitingPid = locks.rows[0].pid; break; }
      await new Promise((r) => setTimeout(r, 50));
      tentativas++;
    }
    check('C1 uma das 2 conexoes esta REALMENTE bloqueada em pg_locks tentando fechar a mesma conta (prova de lock real)', waitingPid !== null, `apos ${tentativas} tentativas, nenhum lock pendente (pidA=${pidA} pidB=${pidB})`);

    await connA.query('COMMIT');
    const resB = await pB;
    await connB.query('COMMIT');
    const resA = await pA;

    const okCount = [resA.rows[0].res.ok, resB.rows[0].res.ok].filter(Boolean).length;
    check('C2 EXATAMENTE 1 das 2 tentativas concorrentes de fechar vence (nunca as 2 nem 0)', okCount === 1, JSON.stringify({ a: resA.rows[0].res, b: resB.rows[0].res }));
    const perdedor = resA.rows[0].res.ok ? resB.rows[0].res : resA.rows[0].res;
    check('C3 a tentativa perdedora recebe "sessao ja fechada" (nunca sobrescreve o fechamento real)', perdedor.ok === false && perdedor.error === 'sessao ja fechada', JSON.stringify(perdedor));

    const sessaoFinal = await client.query(`SELECT payment_method FROM public.mesa_sessions WHERE id=$1`, [sessaoId]);
    check('C4 forma de pagamento gravada e' + "'" + ' a da tentativa que REALMENTE venceu (nunca a da perdedora)', sessaoFinal.rows[0].payment_method === (resA.rows[0].res.ok ? 'dinheiro' : 'pix'), JSON.stringify(sessaoFinal.rows));

    await client.query('BEGIN');
    await client.query(`DELETE FROM public.order_items WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.orders WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.mesa_session_mesas WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.mesa_sessions WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.customers WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.mesas WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.admins WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.store_settings WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.products WHERE store_id=$1`, [STORE_C]);
    await client.query(`DELETE FROM public.stores WHERE id=$1`, [STORE_C]);
    await client.query('COMMIT');
    console.log('Limpeza manual da concorrencia confirmada (liquido zero no E2E).');
  } catch (e) {
    console.error('ERRO NA CONCORRENCIA', e);
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
      await client.query(`DELETE FROM public.mesas WHERE store_id=$1`, [STORE_C]);
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
