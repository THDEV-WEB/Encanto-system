// Suite de verificacao da REF-LOYALTY-02 · Onda 2 (integracao do resgate ao create_order) —
// "Testes da fase". Mesmo estilo das suites desta plataforma (loyalty-02-onda1-test.mjs,
// mesa-01-onda1-fundacao-test.mjs). Camadas A/B: conexao pg direta ao E2E, SAVEPOINT por caso
// dentro de 1 transacao externa, sem commitar. Camada C (concorrencia real, 2 conexoes): exige
// que os fixtures estejam COMMITADOS (senao a 2a conexao nao os enxerga via MVCC e trava por um
// motivo errado, nao pelo lock de fidelidade que o teste quer provar -- achado do proprio teste,
// ver comentario antes da Camada C) -- por isso a suite COMMITA a partir dali e faz LIMPEZA
// EXPLICITA (DELETE por store_id) no final, em vez de depender de ROLLBACK. Mutacao liquida = 0
// de qualquer forma, so' o MECANISMO que garante isso muda na 2a metade. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const host = envGet(txt, 'PGHOST'); const user = envGet(txt, 'PGUSER');
  const password = envGet(txt, 'PGPASSWORD'); if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { cfg: { host, port: Number(envGet(txt, 'PGPORT') || 5432), user, password, database: envGet(txt, 'PGDATABASE') || 'postgres' }, secret: password, host, user };
}
function projectRef(host, user) { let m = (user || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1]; m = (host || '').match(/(?:^|\.)([a-z0-9]{16,})\.supabase\./i); return m ? m[1] : '(n/d)'; }
const git = (a) => { try { return execSync('git ' + a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return '(n/d)'; } };
const isoUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const { cfg, secret, host, user } = loadConn();
const EXPECTED_REF = 'bgzcrovskjbktdxkhemd'; // projeto E2E (encanto-e2e) -- NUNCA producao
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

const STORE_ID = '10ada003-aaaa-4000-8000-000000000001'; // 100% ficticia, prefixo desta REF
const PRODUCT_ID = '10ada003-bbbb-4000-8000-000000000001';
const CUSTOMER_AUTH_UID = '5662cd2f-725d-429c-9701-960553ebbcbd'; // e2e-cliente@teste.encanto.local (real, existe hoje no E2E)

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
// RELEASE (mantem a mutacao) quando fn() roda sem excecao -- os casos desta suite sao
// CUMULATIVOS de proposito (B2 depende do estado que B1 deixou, etc.), diferente de
// loyalty-02-onda1-test.mjs (casos independentes). So' ROLLBACK TO em excecao inesperada, pra
// nao poluir os casos seguintes com um erro de SQL isolado.
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const r = await fn();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return r;
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
    throw e;
  }
}
async function check(id, desc, fn) {
  try { const { ok, detail } = await withSavepoint(fn); record(id, desc, ok ? 'PASS' : 'FAIL', detail); }
  catch (e) { record(id, desc, 'FAIL', 'EXCECAO: ' + redact(e.message).split('\n')[0]); }
}
async function setRole(role, sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}), role };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function resetRole() { await client.query(`RESET ROLE`); await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`); }
// Achado do proprio teste: apos setRole('authenticated',...), esse papel vale para TODO comando
// seguinte na mesma transacao (SET LOCAL nao se desfaz so' por sair de um SAVEPOINT) -- inclusive
// um UPDATE direto em loyalty_accounts, que a RLS bloqueia SILENCIOSAMENTE (0 linhas, sem erro)
// pra um cliente comum (so' RPC SECURITY DEFINER escreve la). Reseta pro papel de conexao (bypassa
// RLS) so' pra este UPDATE de fixture, e volta pro papel autenticado logo em seguida.
async function resetStamps(customerId, stamps, rewardsRedeemed = 0) {
  await resetRole();
  await client.query(`UPDATE public.loyalty_accounts SET stamps=$1, rewards_redeemed=$2 WHERE customer_id=$3`, [stamps, rewardsRedeemed, customerId]);
  await setRole('authenticated', CUSTOMER_AUTH_UID, STORE_ID);
}
// Idempotente (seguro chamar 2x): usado tanto no fluxo normal quanto no catch de erro, pra
// garantir que a loja/cliente/pedidos ficticios NUNCA sobrevivem no E2E mesmo se a Camada C
// lancar uma excecao inesperada no meio.
async function limparFixtures() {
  await client.query('ROLLBACK').catch(() => {}); // fecha qualquer transacao aberta antes de limpar
  await client.query('BEGIN');
  await resetRole();
  const del = async (sql) => (await client.query(sql)).rowCount;
  const contagem = {
    loyalty_events: await del(`DELETE FROM public.loyalty_events WHERE store_id = '${STORE_ID}'`),
    loyalty_accounts: await del(`DELETE FROM public.loyalty_accounts WHERE store_id = '${STORE_ID}'`),
    order_items: await del(`DELETE FROM public.order_items WHERE store_id = '${STORE_ID}'`),
    orders: await del(`DELETE FROM public.orders WHERE store_id = '${STORE_ID}'`),
    customers: await del(`DELETE FROM public.customers WHERE store_id = '${STORE_ID}'`),
    products: await del(`DELETE FROM public.products WHERE store_id = '${STORE_ID}'`),
    store_settings: await del(`DELETE FROM public.store_settings WHERE store_id = '${STORE_ID}'`),
    stores: await del(`DELETE FROM public.stores WHERE id = '${STORE_ID}'`),
  };
  await client.query('COMMIT');
  return contagem;
}
function callCreateOrder(order, items) {
  const customer = { name: 'Cliente Onda2 (fake)', phone: '47966670088' };
  return client.query(`SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS r`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), STORE_ID]);
}
const baseOrder = (extra = {}) => ({ payment_method: 'dinheiro', address: 'Retirada na loja - teste', retirada: true, tipo_pedido: 'retirada', ...extra });
const baseItems = () => ([{ product_id: PRODUCT_ID, nome_produto: 'Produto Onda2 (fake)', quantity: 1 }]);

try {
  await client.connect();
  const refReal = projectRef(host, user);
  out('— ALVO CONFIRMADO — host=' + host + ' user=' + user + ' project_ref=' + refReal + ' —');
  if (refReal !== EXPECTED_REF) throw new Error(`ABORTADO: project_ref real (${refReal}) difere do E2E esperado (${EXPECTED_REF})`);
  out('');

  await client.query('BEGIN');

  out('=== CAMADA A — ESTRUTURAL ===');
  await check('A1', '_redeem_loyalty_for_order existe, EXECUTE negado p/ PUBLIC/anon/authenticated', async () => {
    const r = await client.query(`SELECT
      has_function_privilege('anon', 'public._redeem_loyalty_for_order(uuid,uuid,uuid,numeric,text)', 'EXECUTE') AS anon_pode,
      has_function_privilege('authenticated', 'public._redeem_loyalty_for_order(uuid,uuid,uuid,numeric,text)', 'EXECUTE') AS auth_pode`);
    const row = r.rows[0];
    return { ok: row.anon_pode === false && row.auth_pode === false, detail: JSON.stringify(row) };
  });
  await check('A2', 'create_order continua com exatamente 1 overload, 5 args (nao criou overload novo)', async () => {
    const r = await client.query(`SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='create_order' AND pronamespace='public'::regnamespace`);
    const ok = r.rows.length === 1 && r.rows[0].args === 'p_customer jsonb, p_order jsonb, p_items jsonb, p_request_id uuid, p_store_id uuid';
    return { ok, detail: JSON.stringify(r.rows) };
  });
  await check('A3', 'redeem_reward continua com exatamente 1 overload, 4 args (Onda 1 preservada)', async () => {
    const r = await client.query(`SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='redeem_reward' AND pronamespace='public'::regnamespace`);
    const ok = r.rows.length === 1 && r.rows[0].args === 'p_customer_id uuid, p_store_id uuid, p_order_id uuid, p_subtotal_itens numeric';
    return { ok, detail: JSON.stringify(r.rows) };
  });
  out('');

  out('=== CAMADA B — COMPORTAMENTAL (create_order real, dados 100% ficticios) ===');
  await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_ID}', 'loja-loyalty02-onda2', 'Loja Onda2 (fake, REF-LOYALTY-02)', NULL, 'ativo')`);
  await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_enabled', 'true')`);
  await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_required', '5')`);
  await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_discount', '30')`);
  await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ('${PRODUCT_ID}', 'Produto Onda2 (fake)', 20.00, NULL, true, '${STORE_ID}')`);
  const custRow = await client.query(`INSERT INTO public.customers (name, phone, store_id, auth_user_id) VALUES ('Cliente Onda2 (fake)', '47966670088', '${STORE_ID}', '${CUSTOMER_AUTH_UID}') RETURNING id`);
  const customerId = custRow.rows[0].id;
  await client.query(`INSERT INTO public.loyalty_accounts (customer_id, store_id, stamps) VALUES ($1, '${STORE_ID}', 0)`, [customerId]);

  await setRole('authenticated', CUSTOMER_AUTH_UID, STORE_ID);

  await check('B1', 'pedido normal (sem pedir recompensa): loyalty_grant concede 1 selo, desconto_fidelidade=0, sem evento redeemed', async () => {
    const r = await callCreateOrder(baseOrder(), baseItems());
    const res = r.rows[0].r;
    if (!res.ok) return { ok: false, detail: 'create_order falhou: ' + JSON.stringify(res) };
    const ord = await client.query(`SELECT total, desconto_fidelidade FROM public.orders WHERE id=$1`, [res.order_id]);
    const acc = await client.query(`SELECT stamps FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    const ev = await client.query(`SELECT tipo FROM public.loyalty_events WHERE order_id=$1`, [res.order_id]);
    const ok = Number(ord.rows[0].desconto_fidelidade) === 0 && Number(ord.rows[0].total) === 20
      && acc.rows[0].stamps === 1 && ev.rows.length === 1 && ev.rows[0].tipo === 'earned';
    return { ok, detail: JSON.stringify({ res, ord: ord.rows[0], stamps: acc.rows[0].stamps, eventos: ev.rows }) };
  });

  await resetStamps(customerId, 5, 0);
  await check('B2', 'META ATINGIDA (stamps=5=required) mas NAO pede recompensa: NAO reseta, NAO resgata (decisao de negocio #1)', async () => {
    const r = await callCreateOrder(baseOrder(), baseItems());
    const res = r.rows[0].r;
    const acc = await client.query(`SELECT stamps, rewards_redeemed FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    const ev = await client.query(`SELECT tipo FROM public.loyalty_events WHERE order_id=$1`, [res.order_id]);
    // cartela ja cheia: loyalty_grant nao acumula alem (comportamento pre-existente, intocado) -- fica em 5, sem evento novo
    const ok = res.ok === true && acc.rows[0].stamps === 5 && acc.rows[0].rewards_redeemed === 0 && ev.rows.length === 0
      && Number((await client.query(`SELECT desconto_fidelidade FROM public.orders WHERE id=$1`, [res.order_id])).rows[0].desconto_fidelidade) === 0;
    return { ok, detail: JSON.stringify({ res, acc: acc.rows[0], eventos: ev.rows }) };
  });

  await check('B3', '11a COMPRA pede a recompensa: desconto = round(20*30/100,2) = 6.00, vinculado ao pedido, stamps reseta p/ 0', async () => {
    const r = await callCreateOrder(baseOrder({ usar_recompensa_fidelidade: true }), baseItems());
    const res = r.rows[0].r;
    if (!res.ok) return { ok: false, detail: 'create_order falhou: ' + JSON.stringify(res) };
    const ord = await client.query(`SELECT total, desconto_fidelidade FROM public.orders WHERE id=$1`, [res.order_id]);
    const acc = await client.query(`SELECT stamps, rewards_redeemed FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    const ev = await client.query(`SELECT tipo, order_id, discount_pct, discount_amount FROM public.loyalty_events WHERE order_id=$1`, [res.order_id]);
    const ok = Number(ord.rows[0].desconto_fidelidade) === 6 && Number(ord.rows[0].total) === 14 // (20-6)+0 taxas
      && acc.rows[0].stamps === 0 && acc.rows[0].rewards_redeemed === 1
      && ev.rows.length === 1 && ev.rows[0].tipo === 'redeemed' && ev.rows[0].order_id === res.order_id
      && ev.rows[0].discount_pct === 30 && Number(ev.rows[0].discount_amount) === 6
      && Number(res.desconto_fidelidade) === 6;
    return { ok, detail: JSON.stringify({ res, ord: ord.rows[0], acc: acc.rows[0], eventos: ev.rows }) };
  });

  await check('B4', 'NOVO CICLO (12a compra, logo apos o resgate): loyalty_grant volta a conceder normalmente, stamps=1', async () => {
    const r = await callCreateOrder(baseOrder(), baseItems());
    const res = r.rows[0].r;
    const acc = await client.query(`SELECT stamps FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    const ok = res.ok === true && acc.rows[0].stamps === 1;
    return { ok, detail: JSON.stringify({ res, stamps: acc.rows[0].stamps }) };
  });

  await resetStamps(customerId, 2, 0);
  await check('B5', 'FAIL-CLOSED: pede recompensa com stamps=2<required=5 -> pedido inteiro recusado, nada persiste', async () => {
    const antesOrders = (await client.query(`SELECT count(*)::int AS n FROM public.orders WHERE customer_id=$1`, [customerId])).rows[0].n;
    const r = await callCreateOrder(baseOrder({ usar_recompensa_fidelidade: true }), baseItems());
    const res = r.rows[0].r;
    const depoisOrders = (await client.query(`SELECT count(*)::int AS n FROM public.orders WHERE customer_id=$1`, [customerId])).rows[0].n;
    const acc = await client.query(`SELECT stamps FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    const ok = res.ok === false && res.error === 'recompensa indisponivel' && res.recompensa_indisponivel === true
      && depoisOrders === antesOrders && acc.rows[0].stamps === 2;
    return { ok, detail: JSON.stringify({ res, antesOrders, depoisOrders, stamps: acc.rows[0].stamps }) };
  });

  await resetStamps(customerId, 5, 0);
  // mesmo achado: UPDATE em products tambem cai sob RLS do papel 'authenticated' -- reseta em volta.
  await resetRole();
  await client.query(`UPDATE public.products SET preco=11.11 WHERE id='${PRODUCT_ID}'`);
  await setRole('authenticated', CUSTOMER_AUTH_UID, STORE_ID);
  await check('B6', 'arredondamento preservado apos delegar para _redeem_loyalty_for_order: 11.11*30%=3.333 -> 3.33', async () => {
    const r = await callCreateOrder(baseOrder({ usar_recompensa_fidelidade: true }), baseItems());
    const res = r.rows[0].r;
    const ok = res.ok === true && Number(res.desconto_fidelidade) === 3.33;
    return { ok, detail: JSON.stringify(res) };
  });
  await resetRole();
  await client.query(`UPDATE public.products SET preco=20.00 WHERE id='${PRODUCT_ID}'`);
  out('');

  // REF-LOYALTY-02 · Onda 2 (achado do PROPRIO teste, nao de producao): a Camada C precisa de 2
  // CONEXOES pg distintas contendendo pela MESMA linha real -- enquanto os fixtures (loja/produto/
  // cliente) ficarem so' numa transacao aberta e nunca commitada, uma 2a conexao NAO os enxerga
  // (MVCC) e o INSERT...ON CONFLICT de create_order pra esse MESMO customers.phone tenta inserir
  // uma linha "nova" que colide com a linha (invisivel, nao commitada) da 1a conexao -- trava
  // esperando o DESTINO da transacao alheia (wait_event=transactionid), nao o lock de fidelidade
  // que este teste queria observar. Corrigido: COMMITA os fixtures + Camada B agora (visiveis pras
  // 2 conexoes da Camada C) e faz limpeza EXPLICITA no final (DELETE por store_id), em vez de
  // depender de ROLLBACK pra devolver o banco ao estado original.
  await client.query('COMMIT');
  out('— Fixtures + Camada B COMMITADOS (necessario p/ Camada C ver o mesmo estado de 2 conexoes) —');
  out('— Limpeza no final sera EXPLICITA (DELETE por store_id), nao ROLLBACK —');
  out('');

out('=== CAMADA C — CONCORRENCIA (2 conexoes reais via create_order, o caminho publico de verdade) ===');
  // Tudo a partir daqui (Camada C + limpeza) roda dentro de 1 try/finally proprio: qualquer
  // excecao inesperada NUNCA deixa a loja/cliente/pedidos ficticios orfaos no E2E (a partir do
  // COMMIT acima, ROLLBACK sozinho nao bastaria mais).
  try {
  await client.query('BEGIN');
  await client.query(`UPDATE public.loyalty_accounts SET stamps=5, rewards_redeemed=0 WHERE customer_id=$1`, [customerId]);
  await client.query('COMMIT');
  {
    const clientB = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 10000, connectionTimeoutMillis: 15000 });
    await clientB.connect();
    try {
      // Conexao A: transacao PROPRIA (nao mais a transacao ambiente do resto da suite) -- chamar
      // create_order aqui SEGURA o lock (FOR UPDATE, dentro de _redeem_loyalty_for_order) ate esta
      // transacao terminar (nao ate a funcao "retornar").
      await client.query('BEGIN');
      await setRole('authenticated', CUSTOMER_AUTH_UID, STORE_ID);
      const resA = await callCreateOrder(baseOrder({ usar_recompensa_fidelidade: true }), baseItems());
      const okA = resA.rows[0].r.ok === true;

      // Conexao B = conexao pg SEPARADA, transacao propria, mesmo papel/claims de cliente.
      await clientB.query('BEGIN');
      await clientB.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: CUSTOMER_AUTH_UID, tenant_id: STORE_ID, role: 'authenticated' })]);
      await clientB.query('SET LOCAL ROLE authenticated');
      const customerArg = JSON.stringify({ name: 'Cliente Onda2 (fake)', phone: '47966670088' });
      const orderArg = JSON.stringify(baseOrder({ usar_recompensa_fidelidade: true }));
      const itemsArg = JSON.stringify(baseItems());
      const racePromise = clientB.query(`SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS r`, [customerArg, orderArg, itemsArg, STORE_ID]);
      const timeoutPromise = new Promise((res) => setTimeout(() => res('TIMEOUT'), 1500));
      const corrida = await Promise.race([racePromise.then(() => 'RESOLVEU'), timeoutPromise]);
      const bloqueouCorretamente = corrida === 'TIMEOUT';
      record('C1', 'conexao B (create_order, mesma recompensa) fica BLOQUEADA enquanto A segura o lock sem commitar', (okA && bloqueouCorretamente) ? 'PASS' : 'FAIL', 'okA=' + okA + ' corrida=' + corrida);

      // Desfaz o resgate de A (libera o lock) SEM commitar -- prova que B usa o estado real, nao
      // um valor que A "prometeu" e nunca efetivou.
      await client.query('ROLLBACK');
      const resB = await racePromise; // agora B destrava e conclui
      const okB = resB.rows[0].r.ok === true;
      await clientB.query('COMMIT');
      const accDepois = await client.query(`SELECT stamps, rewards_redeemed FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
      const ok = okB && accDepois.rows[0].stamps === 0 && accDepois.rows[0].rewards_redeemed === 1; // so' B efetivou, uma unica vez
      record('C2', 'apos A ser desfeito (rollback), B destrava e resgata EXATAMENTE 1 vez -- nenhum double-redeem', ok ? 'PASS' : 'FAIL', JSON.stringify({ resB: resB.rows[0].r, acc: accDepois.rows[0] }));
    } finally {
      await client.query('ROLLBACK').catch(() => {}); // no-op se ja rolou acima; garante que nao sobra transacao aberta
      await clientB.query('ROLLBACK').catch(() => {}); // no-op se ja commitou; idem
      await clientB.end().catch(() => {});
    }
  }
  out('');
  } finally {
    const contagem = await limparFixtures();
    out(`=== LIMPEZA EXPLICITA (a suite commitou a partir da Camada C -- ROLLBACK sozinho nao bastava) ===`);
    out(`— Limpeza: ${JSON.stringify(contagem)} —`);
  }

  // Fora de qualquer transacao/savepoint de proposito (limparFixtures ja fez seu proprio
  // BEGIN/COMMIT) -- so' uma leitura direta de verificacao.
  {
    const r = await client.query(`SELECT
      (SELECT count(*)::int FROM public.stores WHERE id='${STORE_ID}') AS stores,
      (SELECT count(*)::int FROM public.customers WHERE store_id='${STORE_ID}') AS customers,
      (SELECT count(*)::int FROM public.orders WHERE store_id='${STORE_ID}') AS orders,
      (SELECT count(*)::int FROM public.loyalty_accounts WHERE store_id='${STORE_ID}') AS loyalty_accounts,
      (SELECT count(*)::int FROM public.loyalty_events WHERE store_id='${STORE_ID}') AS loyalty_events`);
    const row = r.rows[0];
    const ok = Object.values(row).every((n) => n === 0);
    record('LIMPEZA', 'zero rastro da loja/cliente/pedidos ficticios apos a limpeza explicita', ok ? 'PASS' : 'FAIL', JSON.stringify(row));
  }
  out('');

  out('— Resumo —  PASS: ' + passes + '  ·  FAIL: ' + failures);
  out('— Fingerprint — commit ' + git('rev-parse HEAD') + ' · branch ' + git('rev-parse --abbrev-ref HEAD') + ' · Node ' + process.version + ' · ' + (Date.now() - startedMs) + ' ms · started ' + startedIso);
  out('');

  const body = R.join('\n');
  const sha = createHash('sha256').update(body, 'utf8').digest('hex');
  console.log(body);
  console.log('— Execution Report SHA256 —\n  ' + sha + '\n');
  const state = failures ? 'FAILED' : 'SUCCESS';
  console.log('====================================');
  console.log('ETAPA — TESTES DA FASE (REF-LOYALTY-02 · Onda 2)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('Camada A/B: SAVEPOINT/sem commit. Camada C: commit + limpeza EXPLICITA (DELETE por store_id) -- mutacao liquida ZERO nos dois casos');
  console.log('====================================');
  if (failures) process.exitCode = 1;
} catch (e) {
  console.log(R.join('\n'));
  console.error('SUITE ERROR: ' + redact(e && e.message ? e.message : e));
  console.log('STATE:\nFAILED');
  process.exitCode = 1;
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
}
