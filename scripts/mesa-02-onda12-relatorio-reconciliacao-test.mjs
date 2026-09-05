// REF-MESA-02 · Onda 12 (relatorio/reconciliacao) -- E2E dedicado.
// Resolve R7 da auditoria (docs/ref/REF-MESA-02-auditoria.md secao 3): admin_reports_summary
// atribuia receita de pedido de mesa a forma de pagamento do PEDIDO individual, mas o pagamento
// real de uma conta com sessao so' acontece no fechamento (mesa_sessions.payment_method). Prova
// formal de nao-duplicacao pedida pela auditoria: abre sessao, cria pedidos com payment_method
// DIFERENTES entre si, fecha com uma forma especifica, confere que total_receita bate exatamente
// com SUM(orders.total) (nunca soma valor_cobrado_snapshot por cima), e que por_pagamento atribui
// TUDO a forma do fechamento -- nao as formas individuais dos pedidos. Tambem confirma o bucket
// "(conta em aberto)" pra sessao ainda nao fechada, e que entrega/retirada continuam 100%
// inalterados (regressao). SAVEPOINT por caso.
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
const telefone = () => `375${(n++).toString().padStart(8, '0')}`;
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

async function criarPedido(storeId, tipoPedido, origemPedido, mesaId, produto, qty, payMethod) {
  const order = { payment_method: payMethod, tipo_pedido: tipoPedido, origem_pedido: origemPedido };
  if (tipoPedido === 'mesa') order.mesa_identificador = mesaId; else order.address = 'Rua Teste, 123';
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda12', phone: telefone() }), JSON.stringify(order),
     JSON.stringify([{ product_id: produto, nome_produto: 'Produto Onda12', quantity: qty }]),
     storeId]);
  return r.rows[0].res;
}

function porForma(dados, forma) { return dados.por_pagamento.find(p => p.forma === forma); }

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 12 (relatorio/reconciliacao) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID();
    const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda12','ativo')`, [STORE_A, `mesa02-onda12-${STORE_A}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda12',10.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'60'),($1,'61')`, [STORE_A]);
    const hoje = new Date().toISOString().slice(0, 10);

    // B1: prova formal de nao-duplicacao -- 3 pedidos de mesa com payment_method DIFERENTES no
    // lancamento (dinheiro/pix/cartao_credito), fecha a conta com 'cartao_debito' -- TUDO deve
    // aparecer sob 'cartao_debito' no relatorio, nunca espalhado pelas 3 formas originais, e
    // total_receita nunca conta o valor 2x (nao soma valor_cobrado_snapshot por cima de orders.total).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const p1 = await criarPedido(STORE_A, 'mesa', 'admin_garcom', '60', PROD, 1, 'dinheiro'); // 10
      const p2 = await criarPedido(STORE_A, 'mesa', 'admin_garcom', '60', PROD, 1, 'pix'); // 10
      const p3 = await criarPedido(STORE_A, 'mesa', 'admin_garcom', '60', PROD, 1, 'cartao_credito'); // 10
      check('B1 setup: 3 pedidos na mesma sessao, payment_method diferentes entre si', p1.mesa_session_id === p2.mesa_session_id && p2.mesa_session_id === p3.mesa_session_id, JSON.stringify([p1, p2, p3]));

      const fechar = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'cartao_debito', $2::uuid) AS res`, [p1.mesa_session_id, STORE_A]);
      check('B2 fecha a conta com cartao_debito (forma REAL, diferente das 3 do lancamento)', fechar.rows[0].res.ok === true && Number(fechar.rows[0].res.total) === 30, JSON.stringify(fechar.rows[0].res));

      const rel = await client.query(`SELECT public.admin_reports_summary($1::date, $1::date, $2::uuid) AS res`, [hoje, STORE_A]);
      const dados = rel.rows[0].res;

      check('B3 total_receita = 30 exato (SUM(orders.total), NUNCA soma valor_cobrado_snapshot por cima)', Number(dados.total_receita) === 30, JSON.stringify(dados.total_receita));
      const bucketDebito = porForma(dados, 'cartao_debito');
      check('B4 TODOS os 3 pedidos atribuidos a cartao_debito (forma real do fechamento), nao as 3 formas do lancamento', bucketDebito && bucketDebito.pedidos === 3 && Number(bucketDebito.receita) === 30, JSON.stringify(dados.por_pagamento));
      check('B5 NENHUM valor vazou pras formas originais do lancamento (dinheiro/pix/cartao_credito)', !porForma(dados, 'dinheiro') && !porForma(dados, 'pix') && !porForma(dados, 'cartao_credito'), JSON.stringify(dados.por_pagamento));
      await resetRole();
    });

    // B6: sessao AINDA ABERTA -> bucket dedicado '(conta em aberto)', nao adivinha a forma.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const p1 = await criarPedido(STORE_A, 'mesa', 'admin_garcom', '61', PROD, 1, 'dinheiro');
      const rel = await client.query(`SELECT public.admin_reports_summary($1::date, $1::date, $2::uuid) AS res`, [hoje, STORE_A]);
      const dados = rel.rows[0].res;
      const bucketAberto = porForma(dados, '(conta em aberto)');
      check('B6 sessao aberta -> bucket "(conta em aberto)", nao aparece sob "dinheiro"', bucketAberto && Number(bucketAberto.receita) === 10, JSON.stringify(dados.por_pagamento));
      check('B7 nao aparece sob a forma escolhida no lancamento (dinheiro) enquanto aberta', !porForma(dados, 'dinheiro'), JSON.stringify(dados.por_pagamento));
      check('B8 total_receita inclui o pedido da conta aberta normalmente (10)', Number(dados.total_receita) === 10, JSON.stringify(dados.total_receita));
      await resetRole();
      check('B9 setup usou origem admin_garcom corretamente (sanity)', p1.ok === true, JSON.stringify(p1));
    });

    // B10: regressao -- entrega/retirada (sem mesa_session_id) continuam usando orders.payment_method
    // exatamente como antes (comportamento identico ao pre-Onda-12).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      await criarPedido(STORE_A, 'entrega', 'storefront', null, PROD, 1, 'pix');
      await criarPedido(STORE_A, 'retirada', 'storefront', null, PROD, 1, 'pix');
      const rel = await client.query(`SELECT public.admin_reports_summary($1::date, $1::date, $2::uuid) AS res`, [hoje, STORE_A]);
      const dados = rel.rows[0].res;
      const bucketPix = porForma(dados, 'pix');
      check('B10 entrega/retirada continuam agrupadas por orders.payment_method (regressao)', bucketPix && bucketPix.pedidos === 2 && Number(bucketPix.receita) === 20, JSON.stringify(dados.por_pagamento));
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
