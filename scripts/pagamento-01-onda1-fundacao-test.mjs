// REF-PAGAMENTO-01 · Onda 1 (fundacao de schema) -- E2E dedicado.
// payment_intents/mesa_session_payment_allocations: RLS deny-all estrutural (anon/authenticated
// nunca leem/escrevem direto), CHECK de origem unica (order_id XOR mesa_session_id). Divisao de
// conta de mesa: admin_dividir_conta_mesa (soma == total autoritativo, nao duplica divisao),
// admin_registrar_pagamento_alocacao (confirma 1 fatia), admin_fechar_conta_mesa ganha guarda
// aditiva (bloqueia com fatia pendente) MAS o caminho sem divisao (regressao da MESA-02 Onda 11)
// continua 100% identico. orders.payment_status nasce NULL sempre (create_order intocado).
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

async function abrirSessao(storeId, identificador, produto, qty = 1) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Pagamento01', phone: telefone() }),
     JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: identificador, origem_pedido: 'admin_garcom' }),
     JSON.stringify([{ product_id: produto, nome_produto: 'Produto Pagamento01', quantity: qty }]),
     storeId]);
  return r.rows[0].res;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-PAGAMENTO-01 · Onda 1 (fundacao de schema) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID, OUTRO_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID(); const STORE_B = randomUUID();
    const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste PAGAMENTO-01 A','ativo'),($3,$4,'Loja Teste PAGAMENTO-01 B','ativo')`,
      [STORE_A, `pagamento01-a-${STORE_A}`, STORE_B, `pagamento01-b-${STORE_B}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Pagamento01',10.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'60'),($1,'61')`, [STORE_A]);

    // C1: RLS deny-all -- anon/authenticated nunca leem/escrevem as tabelas novas diretamente.
    // Cada query que espera erro roda no seu PROPRIO savepoint aninhado -- a 1a deixaria a
    // transacao "abortada" pro resto do bloco se compartilhassem o mesmo savepoint (licao ja
    // documentada desde a Onda 16 da REF-MESA-02).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      let bloqueadoSelect = false, bloqueadoInsert = false;
      await client.query(`SAVEPOINT sp_c1`);
      try { await client.query(`SELECT * FROM public.payment_intents`); } catch (e) { bloqueadoSelect = /permission denied/i.test(e.message); }
      await client.query(`ROLLBACK TO SAVEPOINT sp_c1`);
      await client.query(`SAVEPOINT sp_c2`);
      try { await client.query(`INSERT INTO public.payment_intents (store_id, order_id, amount) VALUES ($1, gen_random_uuid(), 10)`, [STORE_A]); } catch (e) { bloqueadoInsert = /permission denied/i.test(e.message); }
      await client.query(`ROLLBACK TO SAVEPOINT sp_c2`);
      check('C1 authenticated nao pode SELECT payment_intents direto', bloqueadoSelect);
      check('C2 authenticated nao pode INSERT payment_intents direto', bloqueadoInsert);
      await resetRole();
    });
    await withSavepoint(async () => {
      await setRole('anon');
      let bloqueadoSelect = false;
      await client.query(`SAVEPOINT sp_c3`);
      try { await client.query(`SELECT * FROM public.mesa_session_payment_allocations`); } catch (e) { bloqueadoSelect = /permission denied/i.test(e.message); }
      await client.query(`ROLLBACK TO SAVEPOINT sp_c3`);
      check('C3 anon nao pode SELECT mesa_session_payment_allocations direto', bloqueadoSelect);
      await resetRole();
    });

    // C4: CHECK de origem unica em payment_intents (order_id XOR mesa_session_id, nunca os 2 nem nenhum).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      let bloqueadoAmbos = false, bloqueadoNenhum = false;
      const aberto = await abrirSessao(STORE_A, '60', PROD, 1);
      const pedido = (await client.query(`SELECT id FROM public.orders WHERE mesa_session_id = $1 LIMIT 1`, [aberto.mesa_session_id])).rows[0].id;
      await resetRole();
      await client.query(`SAVEPOINT sp_c4`);
      try {
        await client.query(`INSERT INTO public.payment_intents (store_id, order_id, mesa_session_id, amount) VALUES ($1,$2,$3,10)`, [STORE_A, pedido, aberto.mesa_session_id]);
      } catch (e) { bloqueadoAmbos = /payment_intents_origem_unica/.test(e.message); }
      await client.query(`ROLLBACK TO SAVEPOINT sp_c4`);
      await client.query(`SAVEPOINT sp_c5`);
      try {
        await client.query(`INSERT INTO public.payment_intents (store_id, amount) VALUES ($1,10)`, [STORE_A]);
      } catch (e) { bloqueadoNenhum = /payment_intents_origem_unica/.test(e.message); }
      await client.query(`ROLLBACK TO SAVEPOINT sp_c5`);
      check('C4 payment_intents rejeita order_id + mesa_session_id juntos', bloqueadoAmbos);
      check('C5 payment_intents rejeita nenhum dos dois', bloqueadoNenhum);
    });

    // C6: orders.payment_status nasce NULL sempre -- create_order() intocado (regressao).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '60', PROD, 1);
      const pedido = (await client.query(`SELECT payment_status FROM public.orders WHERE mesa_session_id = $1 LIMIT 1`, [aberto.mesa_session_id])).rows[0];
      check('C6 payment_status nasce NULL em pedido novo (COD, comportamento preservado)', pedido.payment_status === null, JSON.stringify(pedido));
      await resetRole();
    });

    // D1: admin_dividir_conta_mesa -- caso feliz, soma bate com o total.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '60', PROD, 10); // total = 100
      const res = await client.query(
        `SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid) AS res`,
        [aberto.mesa_session_id, JSON.stringify([{ valor: 40, metodo: 'pix' }, { valor: 30, metodo: 'cartao_debito' }, { valor: 30, metodo: 'dinheiro' }]), STORE_A]);
      const r = res.rows[0].res;
      check('D1 dividir conta com soma exata -> sucesso, 3 fatias', r.ok === true && Array.isArray(r.alocacao_ids) && r.alocacao_ids.length === 3, JSON.stringify(r));
      await resetRole();   // verificacao direta na tabela precisa de role sem RLS (deny-all confirmado em C1-C3)
      const fatias = await client.query(`SELECT status, valor, metodo FROM public.mesa_session_payment_allocations WHERE mesa_session_id=$1 ORDER BY valor DESC`, [aberto.mesa_session_id]);
      check('D2 todas as fatias nascem pendente com valor/metodo corretos', fatias.rows.every(f => f.status === 'pendente') && Number(fatias.rows[0].valor) === 40, JSON.stringify(fatias.rows));
    });

    // D3: soma NAO bate com o total -> rejeitado, nenhuma fatia criada.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '60', PROD, 10); // total = 100
      const res = await client.query(
        `SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid) AS res`,
        [aberto.mesa_session_id, JSON.stringify([{ valor: 40 }, { valor: 30 }]), STORE_A]); // soma=70 != 100
      const r = res.rows[0].res;
      check('D3 soma divergente do total -> rejeitado', r.ok === false && r.error === 'soma das fatias nao bate com o total da conta', JSON.stringify(r));
      await resetRole();   // verificacao direta na tabela precisa de role sem RLS (deny-all confirmado em C1-C3)
      const fatias = await client.query(`SELECT count(*)::int AS n FROM public.mesa_session_payment_allocations WHERE mesa_session_id=$1`, [aberto.mesa_session_id]);
      check('D4 nenhuma fatia criada apos rejeicao', fatias.rows[0].n === 0);
    });

    // D5: sessao que JA tem divisao -> nao duplica (rejeita 2a chamada).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '60', PROD, 10);
      await client.query(`SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid) AS res`, [aberto.mesa_session_id, JSON.stringify([{ valor: 50 }, { valor: 50 }]), STORE_A]);
      const res2 = await client.query(`SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid) AS res`, [aberto.mesa_session_id, JSON.stringify([{ valor: 50 }, { valor: 50 }]), STORE_A]);
      check('D5 2a divisao na mesma sessao -> rejeitada (nao duplica)', res2.rows[0].res.ok === false && res2.rows[0].res.error === 'sessao ja tem divisao de conta criada', JSON.stringify(res2.rows[0].res));
      await resetRole();
    });

    // D6: cross-tenant -- sessao de A nao e encontrada por B; D7: outsider sem permissao.
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [OUTRO_UID, STORE_B]);
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '60', PROD, 10);
      await resetRole();
      await setRole('authenticated', OUTRO_UID, STORE_B);
      const res = await client.query(`SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid) AS res`, [aberto.mesa_session_id, JSON.stringify([{ valor: 50 }, { valor: 50 }]), STORE_B]);
      check('D6 cross-tenant: sessao de A nao encontrada por B', res.rows[0].res.ok === false && res.rows[0].res.error === 'sessao nao encontrada', JSON.stringify(res.rows[0].res));
      await resetRole();
      const OUTSIDER = randomUUID();
      await setRole('authenticated', OUTSIDER, STORE_A);
      const res2 = await client.query(`SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid) AS res`, [aberto.mesa_session_id, JSON.stringify([{ valor: 50 }, { valor: 50 }]), STORE_A]);
      check('D7 outsider sem is_admin_of -> sem permissao', res2.rows[0].res.ok === false && res2.rows[0].res.error === 'sem permissao', JSON.stringify(res2.rows[0].res));
      await resetRole();
    });

    // E1: admin_registrar_pagamento_alocacao -- confirma 1 fatia, as outras continuam pendentes.
    // IDs das fatias vem do RETORNO da propria RPC (alocacao_ids) -- evita SELECT direto na tabela
    // sob role 'authenticated' (RLS deny-all bloquearia, confirmado em C1-C3).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '60', PROD, 10);
      const divisao = await client.query(`SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid) AS res`, [aberto.mesa_session_id, JSON.stringify([{ valor: 50 }, { valor: 50 }]), STORE_A]);
      const [fatia1Id, fatia2Id] = divisao.rows[0].res.alocacao_ids;
      const res = await client.query(`SELECT public.admin_registrar_pagamento_alocacao($1::uuid, 'pix', $2::uuid) AS res`, [fatia1Id, STORE_A]);
      check('E1 confirma 1 fatia -> sucesso', res.rows[0].res.ok === true, JSON.stringify(res.rows[0].res));
      const res2 = await client.query(`SELECT public.admin_registrar_pagamento_alocacao($1::uuid, 'dinheiro', $2::uuid) AS res`, [fatia1Id, STORE_A]);
      check('E3 confirmar fatia ja paga -> rejeitado', res2.rows[0].res.ok === false && res2.rows[0].res.error === 'alocacao ja paga', JSON.stringify(res2.rows[0].res));
      await resetRole();   // verificacao direta na tabela precisa de role sem RLS (deny-all confirmado em C1-C3)
      // FIX (achado ao rodar, nao relacionado a nenhuma onda especifica): ambas as fatias nascem na
      // MESMA transacao de admin_dividir_conta_mesa, entao criada_em (now(), constante durante toda
      // a transacao) EMPATA entre as duas -- ORDER BY criada_em sozinho nao e' deterministico nesse
      // empate. Busca cada fatia pelo proprio id (ja conhecido, fatia1Id/fatia2Id) em vez de
      // depender de ordem fisica de retorno.
      const status = await client.query(`SELECT id, status, metodo FROM public.mesa_session_payment_allocations WHERE mesa_session_id=$1`, [aberto.mesa_session_id]);
      const statusFatia1 = status.rows.find(r => r.id === fatia1Id);
      const statusFatia2 = status.rows.find(r => r.id === fatia2Id);
      check('E2 1a fatia paga, 2a continua pendente', statusFatia1?.status === 'pago' && statusFatia1?.metodo === 'pix' && statusFatia2?.status === 'pendente', JSON.stringify(status.rows));
    });

    // F1: admin_fechar_conta_mesa -- com fatia pendente, BLOQUEADO (guarda nova).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '60', PROD, 10);
      const divisao = await client.query(`SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid) AS res`, [aberto.mesa_session_id, JSON.stringify([{ valor: 50 }, { valor: 50 }]), STORE_A]);
      const [fatia1Id, fatia2Id] = divisao.rows[0].res.alocacao_ids;
      await client.query(`SELECT public.admin_registrar_pagamento_alocacao($1::uuid, 'pix', $2::uuid) AS res`, [fatia1Id, STORE_A]);
      const res = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, NULL, $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      check('F1 fechar com 1 fatia ainda pendente -> bloqueado', res.rows[0].res.ok === false && res.rows[0].res.error === 'existem fatias da divisao de conta ainda nao pagas' && res.rows[0].res.fatias_pendentes === 1, JSON.stringify(res.rows[0].res));
      // F2: paga a 2a fatia -> agora fecha normalmente.
      await client.query(`SELECT public.admin_registrar_pagamento_alocacao($1::uuid, 'cartao_credito', $2::uuid) AS res`, [fatia2Id, STORE_A]);
      const res2 = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, NULL, $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      check('F2 todas as fatias pagas -> fecha com sucesso', res2.rows[0].res.ok === true && Number(res2.rows[0].res.total) === 100, JSON.stringify(res2.rows[0].res));
      await resetRole();
    });

    // F3: REGRESSAO -- sessao SEM nenhuma divisao continua EXATAMENTE como a MESA-02 Onda 11
    // (exige p_payment_method quando total>0, fecha normalmente com ele).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '60', PROD, 2); // total=20
      const semPagamento = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, NULL, $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      check('F3 sem divisao, sem forma de pagamento -> forma de pagamento obrigatoria (regressao Onda 11 intacta)', semPagamento.rows[0].res.ok === false && semPagamento.rows[0].res.error === 'forma de pagamento obrigatoria', JSON.stringify(semPagamento.rows[0].res));
      const res = await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'pix', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      check('F4 sem divisao, com forma de pagamento -> fecha normal (regressao Onda 11 intacta)', res.rows[0].res.ok === true && res.rows[0].res.payment_method === 'pix', JSON.stringify(res.rows[0].res));
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
