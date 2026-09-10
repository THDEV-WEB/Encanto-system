// REF-MESA-02 · Onda 17 (divisao de conta, consumo pela UI) -- E2E dedicado.
// admin_consultar_conta_mesa() ganha o campo 'alocacoes' -- prova o fluxo completo real:
// abre sessao -> divide em N fatias -> consultar_conta reflete as fatias pendentes -> paga uma fatia
// -> consultar_conta reflete o status atualizado -> fechar_conta bloqueia enquanto sobrar pendente ->
// paga a ultima -> fechar_conta aceita e grava payment_method='dividido'. Regressao: sessao sem
// divisao continua devolvendo alocacoes:[] (nunca quebra o consumidor existente de AdminMesas.jsx).
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

async function abrirSessao(storeId, identificador, produto, qty) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda17', phone: telefone() }),
     JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: identificador, origem_pedido: 'admin_garcom' }),
     JSON.stringify([{ product_id: produto, nome_produto: 'Produto Onda17', quantity: qty }]),
     storeId]);
  return r.rows[0].res;
}
async function consultarConta(identificador, storeId) {
  return (await client.query(`SELECT public.admin_consultar_conta_mesa($1, $2::uuid) AS res`, [identificador, storeId])).rows[0].res;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 17 (divisao de conta, consumo pela UI) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    const ADMIN_UID = authUsers[0].id;

    const STORE_A = randomUUID();
    const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda17','ativo')`, [STORE_A, `mesa02-onda17-${STORE_A}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda17',30.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'60')`, [STORE_A]);

    // ── 1: sessao SEM divisao -- alocacoes sempre [] (regressao do consumidor existente) ────────
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      await abrirSessao(STORE_A, '60', PROD, 1); // total = 30
      const conta = await consultarConta('60', STORE_A);
      check('1 sem divisao -- alocacoes = [] (nunca null, nunca quebra AdminMesas.jsx)', conta.ok && Array.isArray(conta.alocacoes) && conta.alocacoes.length === 0, JSON.stringify(conta.alocacoes));
      await resetRole();
    });

    // ── 2: divide em 2 fatias, consultar_conta reflete as 2 pendentes ────────────────────────
    let sessaoId, conta1, conta2;
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '60', PROD, 1); // total = 30
      sessaoId = aberto.mesa_session_id;
      const div = await client.query(`SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid) AS res`,
        [sessaoId, JSON.stringify([{ valor: 15, metodo: 'pix' }, { valor: 15, metodo: 'dinheiro' }]), STORE_A]);
      check('2a dividir_conta_mesa aceita 2 fatias somando o total', div.rows[0].res.ok === true, JSON.stringify(div.rows[0].res));

      const conta = await consultarConta('60', STORE_A);
      check('2b consultar_conta reflete as 2 fatias', conta.alocacoes.length === 2, JSON.stringify(conta.alocacoes));
      check('2c ambas pendentes inicialmente', conta.alocacoes.every(a => a.status === 'pendente'), JSON.stringify(conta.alocacoes));
      check('2d valores/metodos batem com o que foi dividido', conta.alocacoes.some(a => Number(a.valor) === 15 && a.metodo === 'pix') && conta.alocacoes.some(a => Number(a.valor) === 15 && a.metodo === 'dinheiro'), JSON.stringify(conta.alocacoes));
      [conta1, conta2] = conta.alocacoes;
      await resetRole();
    });

    // ── 3: fechar_conta bloqueia enquanto sobrar fatia pendente; paga a 1a, ainda bloqueia ────
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '60', PROD, 1);
      const div = (await client.query(`SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid) AS res`,
        [aberto.mesa_session_id, JSON.stringify([{ valor: 15, metodo: 'pix' }, { valor: 15, metodo: 'dinheiro' }]), STORE_A])).rows[0].res;

      const fechar1 = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'pix', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      check('3a fechar bloqueado com 2 fatias pendentes', fechar1.rows[0].res.ok === false && /fatias.*nao pagas/i.test(fechar1.rows[0].res.error), JSON.stringify(fechar1.rows[0].res));

      const alocacaoId1 = div.alocacao_ids[0];
      const pag1 = await client.query(`SELECT public.admin_registrar_pagamento_alocacao($1::uuid, 'pix', $2::uuid) AS res`, [alocacaoId1, STORE_A]);
      check('3b registra pagamento da 1a fatia', pag1.rows[0].res.ok === true, JSON.stringify(pag1.rows[0].res));

      const conta = await consultarConta('60', STORE_A);
      check('3c consultar_conta reflete 1 paga + 1 pendente', conta.alocacoes.filter(a => a.status === 'pago').length === 1 && conta.alocacoes.filter(a => a.status === 'pendente').length === 1, JSON.stringify(conta.alocacoes));

      const fechar2 = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'pix', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      check('3d ainda bloqueado com 1 fatia pendente restante', fechar2.rows[0].res.ok === false, JSON.stringify(fechar2.rows[0].res));

      const alocacaoId2 = div.alocacao_ids[1];
      await client.query(`SELECT public.admin_registrar_pagamento_alocacao($1::uuid, 'dinheiro', $2::uuid) AS res`, [alocacaoId2, STORE_A]);
      const fechar3 = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'pix', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      check('3e fecha com sucesso quando todas pagas -- payment_method vira "dividido"', fechar3.rows[0].res.ok === true && fechar3.rows[0].res.payment_method === 'dividido', JSON.stringify(fechar3.rows[0].res));
      await resetRole();
    });

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
