// REF-MESA-02 · Onda 13 (fidelidade -- so' testes de confirmacao, NENHUMA mudanca de logica
// esperada). Confirmado por leitura de codigo antes de escrever este teste:
// loyalty_grant()/loyalty_void_on_cancel() (migrations/REF-LOYALTY-01-loyalty.sql) sao 100%
// agnosticas a tipo_pedido/origem_pedido/mesa_session_id -- 1 selo por PEDIDO (nunca por sessao),
// idempotente, best-effort. Este teste PROVA isso com casos reais de mesa em vez de so' presumir.
// Se qualquer check aqui falhar, e' um achado real que precisa de correcao -- nao esperado.
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
const telefone = () => `376${(n++).toString().padStart(8, '0')}`;
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
  console.log(' REF-MESA-02 · Onda 13 (fidelidade -- confirmacao) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID();
    const PROD = randomUUID();
    const TELEFONE_FIXO = telefone(); // MESMO cliente em varios pedidos, pra acumular selos de verdade
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda13','ativo')`, [STORE_A, `mesa02-onda13-${STORE_A}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda13',10.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true'),($1,'loyalty_enabled','true'),($1,'loyalty_required','10')`, [STORE_A]);
    await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'70')`, [STORE_A]);

    async function pedidoMesa(qty = 1) {
      const r = await client.query(
        `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
        [JSON.stringify({ name: 'Cliente Onda13', phone: TELEFONE_FIXO }),
         JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '70', origem_pedido: 'admin_garcom' }),
         JSON.stringify([{ product_id: PROD, nome_produto: 'Produto Onda13', quantity: qty }]),
         STORE_A]);
      return r.rows[0].res;
    }
    async function selosDoCliente() {
      const r = await client.query(`SELECT la.stamps, la.earned_total FROM public.loyalty_accounts la JOIN public.customers c ON c.id = la.customer_id WHERE c.phone = $1 AND c.store_id = $2`, [TELEFONE_FIXO, STORE_A]);
      return r.rows[0] || { stamps: 0, earned_total: 0 };
    }

    // B1: 1 pedido de mesa concede 1 selo -- mesmo comportamento de entrega/retirada.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const p1 = await pedidoMesa();
      check('B1 pedido de mesa cria com sucesso', p1.ok === true, JSON.stringify(p1));
      await resetRole();
      const selos = await selosDoCliente();
      check('B2 1 pedido de mesa concede exatamente 1 selo', selos.stamps === 1 && selos.earned_total === 1, JSON.stringify(selos));

      const evento = await client.query(`SELECT tipo, delta, origem FROM public.loyalty_events WHERE order_id = $1`, [p1.order_id]);
      check('B3 evento de fidelidade gravado com origem create_order (agnostico a canal)', evento.rows.length === 1 && evento.rows[0].tipo === 'earned' && evento.rows[0].delta === 1 && evento.rows[0].origem === 'create_order', JSON.stringify(evento.rows));
    });

    // B4: sessao com 3 pedidos concede 3 selos (1 POR PEDIDO, nunca 1 por sessao/conta) -- prova que
    // fidelidade nunca olha pra mesa_session_id.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const p1 = await pedidoMesa(); const p2 = await pedidoMesa(); const p3 = await pedidoMesa();
      check('B4 setup: 3 pedidos na mesma sessao', p1.mesa_session_id === p2.mesa_session_id && p2.mesa_session_id === p3.mesa_session_id, JSON.stringify([p1, p2, p3]));
      await resetRole();
      const selos = await selosDoCliente();
      check('B5 3 pedidos na MESMA sessao concedem 3 selos (1 por pedido, nao 1 por conta)', selos.stamps === 3 && selos.earned_total === 3, JSON.stringify(selos));

      // B6: fechar a conta (Onda 11) NAO concede nem revoga selo nenhum por si so.
      await setRole('authenticated', ADMIN_UID, STORE_A);
      await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'dinheiro', $2::uuid) AS res`, [p1.mesa_session_id, STORE_A]);
      await resetRole();
      const selosPosFechamento = await selosDoCliente();
      check('B6 fechar a conta NAO altera selos (so os pedidos individuais geram evento)', selosPosFechamento.stamps === 3 && selosPosFechamento.earned_total === 3, JSON.stringify(selosPosFechamento));
      const eventosPosFechamento = await client.query(`SELECT count(*)::int AS c FROM public.loyalty_events WHERE order_id IN ($1,$2,$3)`, [p1.order_id, p2.order_id, p3.order_id]);
      check('B7 nenhum evento novo de fidelidade criado pelo fechamento (so os 3 de create_order)', eventosPosFechamento.rows[0].c === 3, JSON.stringify(eventosPosFechamento.rows));
    });

    // B8: cancelar um pedido de mesa reverte exatamente 1 selo -- mesmo trigger de sempre,
    // independente do canal.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const p1 = await pedidoMesa();
      await resetRole();
      const antes = await selosDoCliente();
      await client.query(`UPDATE public.orders SET status = 'cancelado' WHERE id = $1`, [p1.order_id]);
      const depois = await selosDoCliente();
      check('B8 cancelar pedido de mesa reverte exatamente 1 selo', depois.stamps === antes.stamps - 1 && depois.earned_total === antes.earned_total - 1, JSON.stringify({ antes, depois }));
      const revogado = await client.query(`SELECT tipo, delta, origem FROM public.loyalty_events WHERE order_id = $1 AND tipo = 'revoked'`, [p1.order_id]);
      check('B9 evento "revoked" gravado com origem cancel_trigger', revogado.rows.length === 1 && revogado.rows[0].delta === -1 && revogado.rows[0].origem === 'cancel_trigger', JSON.stringify(revogado.rows));
    });

    // B10: cartela cheia (stamps >= loyalty_required) nao acumula alem, mesmo em pedido de mesa.
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.customers (name, phone, store_id) VALUES ('Cliente Cartela Cheia', $1, $2) ON CONFLICT (store_id, phone) DO NOTHING`, [TELEFONE_FIXO, STORE_A]);
      const cust = await client.query(`SELECT id FROM public.customers WHERE phone=$1 AND store_id=$2`, [TELEFONE_FIXO, STORE_A]);
      await client.query(`INSERT INTO public.loyalty_accounts (customer_id, stamps, earned_total) VALUES ($1,10,10) ON CONFLICT (customer_id) DO UPDATE SET stamps=10, earned_total=10`, [cust.rows[0].id]);
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const p1 = await pedidoMesa();
      check('B10 pedido de mesa cria normalmente mesmo com cartela cheia', p1.ok === true, JSON.stringify(p1));
      await resetRole();
      const selos = await selosDoCliente();
      check('B11 cartela cheia (10/10) nao acumula alem mesmo em pedido de mesa', selos.stamps === 10 && selos.earned_total === 10, JSON.stringify(selos));
      const evento = await client.query(`SELECT count(*)::int AS c FROM public.loyalty_events WHERE order_id = $1`, [p1.order_id]);
      check('B12 nenhum evento "earned" gravado pro pedido que excederia a cartela', evento.rows[0].c === 0, JSON.stringify(evento.rows));
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
