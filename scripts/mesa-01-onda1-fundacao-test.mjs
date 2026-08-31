// REF-MESA-01 · Onda 1 -- valida a fundacao do dominio multicanal de atendimento (tipo_pedido/
// origem_pedido/mesa_identificador em orders, get_mesa_config/set_mesa_config, validacao
// server-side de capacidade dentro de create_order) contra o projeto Supabase DEDICADO a E2E
// (nunca producao). Mesmo padrao de scripts/address-geo-integrity-01-onda2-test.mjs: conexao pg
// direta (db.e2e.env), cada caso em SAVEPOINT dentro de uma unica transacao externa, ROLLBACK no
// final -- mutacao liquida = 0. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';

function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const map = {};
  for (const line of txt.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i === -1) continue;
    map[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  if (!map.PGPASSWORD) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: map.PGHOST, port: Number(map.PGPORT || 5432), user: map.PGUSER, password: map.PGPASSWORD, database: map.PGDATABASE || 'postgres' };
}

const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, spCounter = 0, n = 0;
const telefone = () => `399${(n++).toString().padStart(8, '0')}`;

function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}

// Cada caso roda dentro de um SAVEPOINT proprio (mesmo padrao de scripts/loyalty-audit-01-onda1-test.mjs
// callRpc) -- uma falha inesperada de SQL num caso nao derruba os casos seguintes.
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    return await fn();
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
  }
}

async function setRole(role, sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`SELECT set_config('request.headers', '{}', true)`);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function setGuestOrigin(slug) {
  await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`);
  await client.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify({ origin: `http://${slug}.localhost:5183` })]);
  await client.query(`SET LOCAL ROLE anon`);
}
async function resetRole() {
  await client.query(`RESET ROLE`);
  await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`);
  await client.query(`SELECT set_config('request.headers', '{}', true)`);
}

function callCreateOrder(customer, order, items, storeId, requestId = null) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, $4::uuid, $5::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), requestId, storeId]
  );
}
async function getOrder(orderId) {
  const r = await client.query(
    `SELECT tipo_pedido, origem_pedido, mesa_identificador, address, delivery_fee, maquininha_fee, total, store_id
       FROM public.orders WHERE id = $1`, [orderId]);
  return r.rows[0];
}

async function main() {
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, current_database() AS db")).rows[0];
  console.log(`Conectado como ${meta.who} em ${meta.db} (projeto E2E dedicado, nunca producao)\n`);
  console.log('==========================================================================');
  console.log(' REF-MESA-01 · Onda 1 (fundacao do dominio multicanal) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    // ═══════════════════════════════ CAMADA A -- estrutural ═══════════════════════════════════
    console.log('── CAMADA A: estrutural ──\n');

    {
      const r = await client.query(`select column_name, data_type, is_nullable, column_default
        from information_schema.columns where table_schema='public' and table_name='orders'
          and column_name in ('tipo_pedido','origem_pedido','mesa_identificador')
        order by column_name`);
      const byName = Object.fromEntries(r.rows.map(x => [x.column_name, x]));
      check('A1 orders.tipo_pedido: text NOT NULL DEFAULT entrega',
        byName.tipo_pedido?.is_nullable === 'NO' && byName.tipo_pedido?.column_default === "'entrega'::text",
        JSON.stringify(byName.tipo_pedido));
      check('A2 orders.origem_pedido: text NOT NULL DEFAULT storefront',
        byName.origem_pedido?.is_nullable === 'NO' && byName.origem_pedido?.column_default === "'storefront'::text",
        JSON.stringify(byName.origem_pedido));
      check('A3 orders.mesa_identificador: text NULLABLE, sem default',
        byName.mesa_identificador?.is_nullable === 'YES' && byName.mesa_identificador?.column_default === null,
        JSON.stringify(byName.mesa_identificador));
    }

    {
      const r = await client.query(`select conname, pg_get_constraintdef(oid) as def
        from pg_constraint where conrelid = 'public.orders'::regclass
          and conname in ('orders_tipo_pedido_valid','orders_origem_pedido_valid','orders_mesa_identificador_coerente')`);
      check('A4 3 constraints novas presentes em orders', r.rowCount === 3, JSON.stringify(r.rows));
    }

    {
      const r = await client.query(`select proname, pg_get_function_identity_arguments(oid) as args
        from pg_proc where proname in ('get_mesa_config','set_mesa_config') and pronamespace='public'::regnamespace
        order by proname`);
      const byName = Object.fromEntries(r.rows.map(x => [x.proname, x.args]));
      check('A5 get_mesa_config(uuid DEFAULT) / set_mesa_config(bool,bool,bool,uuid DEFAULT) existem',
        r.rowCount === 2 && byName.get_mesa_config?.includes('p_store_id') && byName.set_mesa_config?.includes('p_habilitada'),
        JSON.stringify(byName));
    }

    {
      const r = await client.query(`
        select p.proname,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_pode,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_pode
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname in ('get_mesa_config','set_mesa_config')
        order by p.proname`);
      const byName = Object.fromEntries(r.rows.map(x => [x.proname, x]));
      check('A6 grants: get_mesa_config publica (anon+authenticated), set_mesa_config so authenticated',
        byName.get_mesa_config?.anon_pode === true && byName.get_mesa_config?.auth_pode === true
          && byName.set_mesa_config?.anon_pode === false && byName.set_mesa_config?.auth_pode === true,
        JSON.stringify(r.rows));
    }

    {
      const r = await client.query(`select pg_get_function_identity_arguments(oid) as args
        from pg_proc where proname='create_order' and pronamespace='public'::regnamespace`);
      check('A7 create_order continua com a MESMA assinatura (5 params) -- zero breaking change',
        r.rowCount === 1 && r.rows[0].args === 'p_customer jsonb, p_order jsonb, p_items jsonb, p_request_id uuid, p_store_id uuid',
        JSON.stringify(r.rows));
    }
    console.log('');

    // ═══════════════════════════════ Fixtures (descartaveis, dentro da transacao) ══════════════
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E (fixtures).'); process.exit(2); }
    const [ADMIN_UID, OUTSIDER_UID] = authUsers.map(r => r.id);

    const STORE_A = randomUUID();       // mesa habilitada (via set_mesa_config nesta suite)
    const STORE_B = randomUUID();       // mesa NUNCA habilitada -- prova o default seguro
    const STORE_CROSS = randomUUID();   // so' para o teste de cross-tenant
    const PROD_A = randomUUID();
    const PROD_B = randomUUID();
    const slugA = `mesa01-a-${STORE_A}`;

    async function setupLoja(storeId, slug, prodId) {
      await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-01','ativo')`, [storeId, slug]);
      await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto MESA-01',20.00,true,$2)`, [prodId, storeId]);
      await client.query(
        `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'delivery_fee_config',$2::text)`,
        [storeId, JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: false, valor: 0 }, faixas: [{ de: 0, ate: 10, valor: 8.00 }] })]
      );
    }
    await setupLoja(STORE_A, slugA, PROD_A);
    await setupLoja(STORE_B, `mesa01-b-${STORE_B}`, PROD_B);
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Cross MESA-01','ativo')`, [STORE_CROSS, `mesa01-cross-${STORE_CROSS}`]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    // Habilitado FORA de qualquer savepoint de teste -- precisa sobreviver aos ROLLBACK TO SAVEPOINT
    // individuais de B9-B14 (que dependem de mesa ja habilitada). B4 valida a RPC set_mesa_config em
    // si (dentro do proprio savepoint, sem depender desta linha nem afetar os testes seguintes).
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true')`, [STORE_A]);
    const item = (prodId) => [{ product_id: prodId, nome_produto: 'Produto MESA-01', quantity: 1 }];

    // ═══════════════════════════════ CAMADA B -- comportamental ════════════════════════════════
    console.log('── CAMADA B: comportamental (cada caso em SAVEPOINT, zero residuo) ──\n');

    // B1 -- pedido "historico": simula uma linha que existia ANTES desta migration (INSERT direto,
    // sem os 3 campos novos) -- prova que o DEFAULT documentado se aplica exatamente como esperado,
    // sem exigir reinterpretacao/backfill heuristico de dado nenhum.
    await withSavepoint(async () => {
      const custId = randomUUID();
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES ($1,'Cliente historico',$2,$3)`, [custId, telefone(), STORE_A]);
      const ord = await client.query(
        `INSERT INTO public.orders (customer_id, total, status, payment_method, address, store_id) VALUES ($1,20,'entregue','dinheiro','Rua Antiga, 123',$2) RETURNING id`,
        [custId, STORE_A]);
      const row = await getOrder(ord.rows[0].id);
      check('B1 pedido historico (sem os 3 campos novos) recebe defaults seguros: entrega/storefront/NULL',
        row.tipo_pedido === 'entrega' && row.origem_pedido === 'storefront' && row.mesa_identificador === null,
        JSON.stringify(row));
    });

    // B2 -- Delivery (entrega): payload IDENTICO ao que o frontend atual manda hoje (sem tipo_pedido,
    // sem origem_pedido, sem mesa_identificador). Deve continuar funcionando 100% como antes.
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE_A);
      const r = await callCreateOrder(
        { name: 'Cliente Entrega', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Nova, 456', total: 20 },
        item(PROD_A), STORE_A);
      const res = r.rows[0].res;
      check('B2a create_order (payload legado, sem tipo_pedido) retorna ok', res.ok === true, JSON.stringify(res));
      if (res.ok) {
        await resetRole();
        const row = await getOrder(res.order_id);
        check('B2b tipo_pedido derivado = entrega, origem_pedido = storefront (defaults corretos p/ client legado)',
          row.tipo_pedido === 'entrega' && row.origem_pedido === 'storefront' && row.mesa_identificador === null,
          JSON.stringify(row));
      }
    });

    // B3 -- Retirada: payload legado com retirada:true (sem tipo_pedido). Deve continuar sem taxa.
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE_A);
      const r = await callCreateOrder(
        { name: 'Cliente Retirada', phone: telefone() },
        { payment_method: 'dinheiro', retirada: true, address: 'Retirada na loja - Loja Teste MESA-01', total: 20 },
        item(PROD_A), STORE_A);
      const res = r.rows[0].res;
      check('B3a create_order (retirada:true, payload legado) retorna ok', res.ok === true, JSON.stringify(res));
      if (res.ok) {
        await resetRole();
        const row = await getOrder(res.order_id);
        check('B3b tipo_pedido derivado = retirada, delivery_fee = 0 (comportamento identico ao anterior)',
          row.tipo_pedido === 'retirada' && Number(row.delivery_fee) === 0 && Number(row.maquininha_fee) === 0,
          JSON.stringify(row));
      }
    });

    // B4 -- Mesa habilitada: set_mesa_config(true,...) pelo admin da loja, depois create_order
    // tipo_pedido='mesa' (guest, via Origin real -- caminho fail-closed de producao, nao atalho).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, null);
      const rc = await client.query(`SELECT public.set_mesa_config($1,$2,$3,$4) AS res`, [true, false, false, STORE_A]);
      check('B4a set_mesa_config(true) pelo admin da loja retorna ok', rc.rows[0].res.ok === true, JSON.stringify(rc.rows[0].res));

      const rg = await client.query(`SELECT public.get_mesa_config($1) AS res`, [STORE_A]);
      check('B4b get_mesa_config reflete habilitada=true imediatamente', rg.rows[0].res.habilitada === true, JSON.stringify(rg.rows[0].res));

      await setGuestOrigin(slugA);
      const r = await callCreateOrder(
        { name: 'Cliente Mesa', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '07', total: 20 },
        item(PROD_A), STORE_A);
      const res = r.rows[0].res;
      check('B4c create_order tipo_pedido=mesa (guest via Origin, loja COM capacidade) retorna ok', res.ok === true, JSON.stringify(res));
      if (res.ok) {
        await resetRole();
        const row = await getOrder(res.order_id);
        check('B4d order gravado com tipo_pedido=mesa, mesa_identificador=07, address derivado, sem taxa',
          row.tipo_pedido === 'mesa' && row.mesa_identificador === '07' && row.address === 'Mesa 07'
            && Number(row.delivery_fee) === 0 && Number(row.maquininha_fee) === 0,
          JSON.stringify(row));
      }
    });

    // B5 -- Mesa desabilitada (default seguro): loja B NUNCA chamou set_mesa_config.
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE_B);
      const r = await callCreateOrder(
        { name: 'Cliente Mesa Bloqueado', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '03', total: 20 },
        item(PROD_B), STORE_B);
      const res = r.rows[0].res;
      check('B5 create_order tipo_pedido=mesa numa loja SEM capacidade -> ok:false, mensagem generica',
        res.ok === false && res.error === 'modalidade indisponivel para esta loja', JSON.stringify(res));
    });

    // B6 -- tentativa de bypass, cliente ANONIMO/guest (via Origin real da loja B, sem capacidade).
    await withSavepoint(async () => {
      await setGuestOrigin(`mesa01-b-${STORE_B}`);
      const r = await callCreateOrder(
        { name: 'Bypass Anon', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '01', total: 20 },
        item(PROD_B), STORE_B);
      const res = r.rows[0].res;
      check('B6 bypass anon (guest, Origin real, loja SEM capacidade) -> bloqueado no servidor',
        res.ok === false && res.error === 'modalidade indisponivel para esta loja', JSON.stringify(res));
    });

    // B7 -- tentativa de bypass, cliente AUTENTICADO (sem vinculo de admin, tentando a mesma loja B).
    await withSavepoint(async () => {
      await setRole('authenticated', OUTSIDER_UID, STORE_B);
      const r = await callCreateOrder(
        { name: 'Bypass Auth', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '02', total: 20 },
        item(PROD_B), STORE_B);
      const res = r.rows[0].res;
      check('B7 bypass authenticated (sem vinculo de admin, loja SEM capacidade) -> bloqueado no servidor',
        res.ok === false && res.error === 'modalidade indisponivel para esta loja', JSON.stringify(res));
    });

    // B8 -- cross-tenant: tenant_id (JWT) da loja A, mas tenta criar pedido na loja CROSS. Confirma
    // que REF-ORDER-TENANT-01 continua intocada por esta REF (regressao critica de seguranca).
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE_A);
      const r = await callCreateOrder(
        { name: 'Cross Tenant', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '09', address: 'x', total: 20 },
        item(PROD_A), STORE_CROSS);
      const res = r.rows[0].res;
      check('B8 cross-tenant (tenant_id != p_store_id) continua bloqueado com "loja invalida" (REF-ORDER-TENANT-01 intocada)',
        res.ok === false && res.error === 'loja invalida', JSON.stringify(res));
    });

    // B9 -- idempotencia: mesmo request_id chamado 2x para um pedido de mesa nao duplica.
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE_A);
      const reqId = randomUUID();
      const payload = [
        { name: 'Idempotencia Mesa', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '11', total: 20 },
        item(PROD_A)
      ];
      const r1 = await callCreateOrder(...payload, STORE_A, reqId);
      const r2 = await callCreateOrder(...payload, STORE_A, reqId);
      const res1 = r1.rows[0].res, res2 = r2.rows[0].res;
      check('B9 idempotencia: 2a chamada com mesmo request_id retorna idempotent:true, mesmo order_id',
        res1.ok === true && res2.ok === true && res2.idempotent === true && res1.order_id === res2.order_id,
        JSON.stringify({ res1, res2 }));
    });

    // B10 -- fidelidade: pedido de mesa concede selo igual a qualquer outro tipo (loyalty_grant
    // e' agnostico a tipo_pedido, confirmado pela auditoria -- este teste prova em runtime).
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'loyalty_enabled','true'),($1,'loyalty_required','5'),($1,'loyalty_discount','30')`, [STORE_A]);
      await setGuestOrigin(slugA);
      const custPhone = telefone();
      const r = await callCreateOrder(
        { name: 'Cliente Fidelidade Mesa', phone: custPhone },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '05', total: 20 },
        item(PROD_A), STORE_A);
      const res = r.rows[0].res;
      if (res.ok) await resetRole();
      const stamps = res.ok ? (await client.query(
        `select la.stamps from public.loyalty_accounts la join public.customers c on c.id = la.customer_id where c.phone = $1`,
        [custPhone])).rows[0]?.stamps : null;
      check('B10 pedido de mesa concede selo de fidelidade normalmente (loyalty_grant agnostico a tipo)',
        res.ok === true && stamps === 1, JSON.stringify({ res, stamps }));
    });

    // B11 -- notificacoes: o trigger de notificacao (trg_enc_order_notify -> notification_outbox)
    // nao pode falhar/derrubar o pedido so' porque o tipo e' mesa (o CONTEUDO da mensagem so sera'
    // corrigido na Onda 7 -- aqui so' confirmamos que nada quebra).
    await withSavepoint(async () => {
      await setGuestOrigin(slugA);
      const r = await callCreateOrder(
        { name: 'Cliente Notificacao Mesa', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '13', total: 20 },
        item(PROD_A), STORE_A);
      const res = r.rows[0].res;
      if (res.ok) await resetRole();
      const outbox = res.ok ? await client.query(`select count(*)::int as n from public.notification_outbox where order_id = $1`, [res.order_id]) : null;
      check('B11 pedido de mesa nao quebra o pipeline de notificacao (linha inserida em notification_outbox)',
        res.ok === true && outbox.rows[0].n >= 1, JSON.stringify({ res, n: outbox?.rows[0]?.n }));
    });

    // B12 -- views: v_order_reconciliation nao quebra para um pedido de mesa (gap pre-existente de
    // nao descontar taxa e' agnostico a tipo -- so' confirmamos ausencia de erro/crash aqui).
    await withSavepoint(async () => {
      await setGuestOrigin(slugA);
      const r = await callCreateOrder(
        { name: 'Cliente View Mesa', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '15', total: 20 },
        item(PROD_A), STORE_A);
      const res = r.rows[0].res;
      if (res.ok) await resetRole();
      const rec = res.ok ? await client.query(`select order_id from public.v_order_reconciliation where order_id = $1`, [res.order_id]) : null;
      check('B12 v_order_reconciliation le pedido de mesa sem erro', res.ok === true && rec.rowCount === 1, JSON.stringify(res));
    });

    // B13 -- triggers: UPDATE de status num pedido de mesa dispara os triggers existentes
    // (trg_order_audit/trg_enc_order_notify) sem erro -- colunas novas nao fazem parte da lista
    // explicita de trg_orders_audit_edit, entao nao deveriam interferir.
    await withSavepoint(async () => {
      await setGuestOrigin(slugA);
      const r = await callCreateOrder(
        { name: 'Cliente Trigger Mesa', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '17', total: 20 },
        item(PROD_A), STORE_A);
      const res = r.rows[0].res;
      let updOk = false, err = null;
      if (res.ok) {
        await resetRole();
        try { await client.query(`UPDATE public.orders SET status = 'preparo' WHERE id = $1`, [res.order_id]); updOk = true; }
        catch (e) { err = e.message; }
      }
      check('B13 UPDATE de status num pedido de mesa nao dispara erro nos triggers existentes',
        res.ok === true && updOk === true, err || JSON.stringify(res));
    });

    // B14 -- RLS: a policy existente de orders (is_admin_of(store_id)) continua funcionando igual
    // para um pedido de mesa -- admin da loja enxerga, autenticado sem vinculo nenhum NAO enxerga.
    // Nao depende de tipo_pedido em lugar nenhum da policy, entao nada deveria mudar aqui; este
    // teste so' confirma que as 3 colunas novas nao quebraram/abriram brecha na RLS existente.
    await withSavepoint(async () => {
      await setGuestOrigin(slugA);
      const r = await callCreateOrder({ name: 'Cliente RLS Mesa', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '19', total: 20 },
        item(PROD_A), STORE_A);
      const res = r.rows[0].res;

      let admVisivel = false, outsiderInvisivel = false;
      if (res.ok) {
        await setRole('authenticated', ADMIN_UID, null);
        const selAdmin = await client.query(`select tipo_pedido from public.orders where id = $1`, [res.order_id]);
        admVisivel = selAdmin.rowCount === 1 && selAdmin.rows[0].tipo_pedido === 'mesa';

        await setRole('authenticated', OUTSIDER_UID, null);
        const selOutsider = await client.query(`select tipo_pedido from public.orders where id = $1`, [res.order_id]);
        outsiderInvisivel = selOutsider.rowCount === 0;
      }
      check('B14 RLS existente (is_admin_of, sem depender de tipo_pedido): admin da loja ve o pedido de mesa, outsider nao',
        res.ok === true && admVisivel === true && outsiderInvisivel === true, JSON.stringify(res));
    });

    await resetRole();
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
