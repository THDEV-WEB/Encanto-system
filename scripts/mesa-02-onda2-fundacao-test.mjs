// REF-MESA-02 · Onda 2 (fundacao de schema: mesa_sessions + mesa_session_mesas) -- valida
// estrutura, constraints, estados, isolamento entre tenants, acesso cruzado, imutabilidade e
// grants/RLS contra o projeto Supabase DEDICADO a E2E (nunca producao). Mesmo padrao das ondas
// anteriores: SAVEPOINT por caso dentro de BEGIN...ROLLBACK externo, zero residuo. Exit 0 = SUCCESS.
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

let pass = 0, fail = 0, spCounter = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { return await fn(); } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
}
async function setRole(role) {
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function resetRole() {
  await client.query(`RESET ROLE`);
}
// Roda `fn` dentro do proprio SAVEPOINT aninhado. Se `fn` lancar, a transacao Postgres fica
// "aborted" ate um ROLLBACK TO SAVEPOINT -- sem isso, QUALQUER comando seguinte no MESMO bloco
// falharia com "current transaction is aborted". So faz ROLLBACK TO SAVEPOINT quando HOUVE erro
// (limpa o estado); quando `fn` teve sucesso, mantem o efeito (varios casos aqui usam expectError
// tambem pra confirmar SUCESSO, ex. B9/B11/B17, e checks posteriores no mesmo bloco dependem da
// linha ter sido de fato inserida).
async function expectError(fn) {
  const sp = `sp_err_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    await fn();
    return { threw: false };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
    return { threw: true, message: e.message };
  }
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 2 (fundacao mesa_sessions + mesa_session_mesas) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID();
    const STORE_B = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda2 A','ativo')`, [STORE_A, `mesa02-onda2-a-${STORE_A}`]);
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda2 B','ativo')`, [STORE_B, `mesa02-onda2-b-${STORE_B}`]);

    console.log('── CAMADA A: estrutural ──\n');

    await withSavepoint(async () => {
      const cols = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mesa_sessions' ORDER BY ordinal_position`)).rows.map(r => r.column_name);
      const esperado = ['id','store_id','status','origem_abertura','opened_at','opened_by_admin_user_id','closed_at','closed_by_admin_user_id','payment_method','valor_cobrado_snapshot','request_id','created_at'];
      check('A1 mesa_sessions tem exatamente as colunas esperadas', esperado.every(c => cols.includes(c)) && cols.length === esperado.length, JSON.stringify(cols));
    });
    await withSavepoint(async () => {
      const cols = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mesa_session_mesas' ORDER BY ordinal_position`)).rows.map(r => r.column_name);
      const esperado = ['id','mesa_session_id','store_id','mesa_identificador','status_sessao','attached_at'];
      check('A2 mesa_session_mesas tem exatamente as colunas esperadas (sem coluna escalar de mesa na sessao-pai)', esperado.every(c => cols.includes(c)) && cols.length === esperado.length, JSON.stringify(cols));
    });
    await withSavepoint(async () => {
      const idx = (await client.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('mesa_sessions','mesa_session_mesas')`)).rows;
      const temUniqueParcialMesa = idx.some(i => i.indexname === 'mesa_session_mesas_uma_aberta_por_mesa_uniq' && /WHERE \(status_sessao = 'aberta'/.test(i.indexdef));
      const temUniqueRequestId = idx.some(i => i.indexname === 'mesa_sessions_request_id_uniq');
      check('A3 indices unicos parciais existem (1 sessao aberta por mesa; idempotencia por request_id)', temUniqueParcialMesa && temUniqueRequestId, JSON.stringify(idx.map(i => i.indexname)));
    });
    await withSavepoint(async () => {
      const rls = (await client.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('mesa_sessions','mesa_session_mesas')`)).rows;
      const pol = (await client.query(`SELECT tablename FROM pg_policies WHERE tablename IN ('mesa_sessions','mesa_session_mesas')`)).rows;
      check('A4 RLS habilitada nas 2 tabelas, ZERO policies (deny-all estrutural)', rls.every(r => r.relrowsecurity === true) && rls.length === 2 && pol.length === 0, JSON.stringify({ rls, pol }));
    });
    await withSavepoint(async () => {
      const grants = (await client.query(`SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name IN ('mesa_sessions','mesa_session_mesas') AND grantee IN ('anon','authenticated')`)).rows;
      check('A5 anon/authenticated sem NENHUM grant nas 2 tabelas', grants.length === 0, JSON.stringify(grants));
    });
    await withSavepoint(async () => {
      const fnGrants = (await client.query(`SELECT routine_name, grantee FROM information_schema.role_routine_grants WHERE routine_name LIKE '_mesa_session%' AND grantee IN ('anon','authenticated','PUBLIC')`)).rows;
      check('A6 funcoes de trigger internas sem GRANT a anon/authenticated/PUBLIC', fnGrants.length === 0, JSON.stringify(fnGrants));
    });

    console.log('\n── CAMADA B: comportamental (cada caso em SAVEPOINT, zero residuo) ──\n');

    // sessaoQr precisa sobreviver a VARIOS casos B8+ que a reusam -- criada FORA de qualquer
    // savepoint proprio (licao ja registrada na REF-MESA-01 Onda 1: dado criado dentro de um
    // savepoint eh desfeito no ROLLBACK TO SAVEPOINT daquele mesmo bloco, antes de casos
    // posteriores poderem depender dele).
    const sessaoQr = (await client.query(
      `INSERT INTO public.mesa_sessions (store_id, origem_abertura) VALUES ($1,'qr_mesa') RETURNING id`, [STORE_A])).rows[0].id;
    check('B1 sessao aberta via qr_mesa (sem opened_by) -> sucesso', !!sessaoQr);

    await withSavepoint(async () => {
      const r = await expectError(() => client.query(
        `INSERT INTO public.mesa_sessions (store_id, origem_abertura) VALUES ($1,'admin_garcom')`, [STORE_A]));
      check('B2 admin_garcom SEM opened_by_admin_user_id -> falha (CHECK origem/opened_by)', r.threw, r.message);
    });

    await withSavepoint(async () => {
      const r = await client.query(
        `INSERT INTO public.mesa_sessions (store_id, origem_abertura, opened_by_admin_user_id) VALUES ($1,'admin_garcom',$2) RETURNING id`, [STORE_A, ADMIN_UID]);
      check('B3 admin_garcom COM opened_by_admin_user_id -> sucesso', !!r.rows[0].id);
    });

    await withSavepoint(async () => {
      const r = await expectError(() => client.query(
        `INSERT INTO public.mesa_sessions (store_id, origem_abertura, status) VALUES ($1,'qr_mesa','fechada')`, [STORE_A]));
      check('B4 status=fechada sem nenhum campo de fechamento -> falha (CHECK coerencia_estado)', r.threw, r.message);
    });

    await withSavepoint(async () => {
      const r = await client.query(
        `INSERT INTO public.mesa_sessions (store_id, origem_abertura, status, closed_at, closed_by_admin_user_id, valor_cobrado_snapshot)
         VALUES ($1,'qr_mesa','fechada',now(),$2,0) RETURNING id`, [STORE_A, ADMIN_UID]);
      check('B5 fechada com valor=0 e payment_method NULL -> sucesso (sessao aberta por engano, sem pedidos)', !!r.rows[0].id);
    });

    await withSavepoint(async () => {
      const r = await client.query(
        `INSERT INTO public.mesa_sessions (store_id, origem_abertura, status, closed_at, closed_by_admin_user_id, valor_cobrado_snapshot, payment_method)
         VALUES ($1,'qr_mesa','fechada',now(),$2,45.50,'pix') RETURNING id`, [STORE_A, ADMIN_UID]);
      check('B6 fechada com valor>0 e payment_method -> sucesso', !!r.rows[0].id);
    });

    await withSavepoint(async () => {
      const r = await expectError(() => client.query(
        `INSERT INTO public.mesa_sessions (store_id, origem_abertura, status, closed_at, closed_by_admin_user_id, valor_cobrado_snapshot)
         VALUES ($1,'qr_mesa','fechada',now(),$2,45.50)`, [STORE_A, ADMIN_UID]));
      check('B7 fechada com valor>0 SEM payment_method -> falha (CHECK coerencia_estado)', r.threw, r.message);
    });

    // B8-B9: juncao de mesas -- 2 identificadores diferentes na MESMA sessao.
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'05')`, [sessaoQr, STORE_A]);
      const r2 = await expectError(() => client.query(
        `INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'06')`, [sessaoQr, STORE_A]));
      check('B8/B9 2 identificadores de mesa DIFERENTES anexados a UMA MESMA sessao -> ambos sucesso (suporte a JUNCAO DE MESAS desde a fundacao)', !r2.threw, r2.message);
      const rows = (await client.query(`SELECT mesa_identificador FROM public.mesa_session_mesas WHERE mesa_session_id=$1 ORDER BY mesa_identificador`, [sessaoQr])).rows;
      check('B9b as 2 mesas aparecem associadas a mesma sessao', rows.length === 2 && rows[0].mesa_identificador === '05' && rows[1].mesa_identificador === '06', JSON.stringify(rows));
    });

    // B10: 2a sessao ABERTA para a MESMA loja+identificador -> bloqueada pelo indice unico parcial.
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'07')`, [sessaoQr, STORE_A]);
      const r2 = await client.query(`INSERT INTO public.mesa_sessions (store_id, origem_abertura) VALUES ($1,'qr_mesa') RETURNING id`, [STORE_A]);
      const outraSessao = r2.rows[0].id;
      const r3 = await expectError(() => client.query(
        `INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'07')`, [outraSessao, STORE_A]));
      check('B10 2a sessao ABERTA para o MESMO identificador (mesma loja) -> bloqueada (unique parcial)', r3.threw, r3.message);
    });

    // B11: isolamento entre tenants -- MESMO identificador em loja DIFERENTE nao conflita.
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'08')`, [sessaoQr, STORE_A]);
      const rB = await client.query(`INSERT INTO public.mesa_sessions (store_id, origem_abertura) VALUES ($1,'qr_mesa') RETURNING id`, [STORE_B]);
      const r2 = await expectError(() => client.query(
        `INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'08')`, [rB.rows[0].id, STORE_B]));
      check('B11 MESMO identificador "08" em OUTRA loja -> sucesso (isolamento por store_id, nao ha conflito cross-tenant)', !r2.threw, r2.message);
    });

    // B12: acesso cruzado -- store_id da associacao != store_id da sessao pai.
    await withSavepoint(async () => {
      const r = await expectError(() => client.query(
        `INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'99')`, [sessaoQr, STORE_B]));
      check('B12 store_id da associacao != store_id da sessao pai -> bloqueado (trigger cross-tenant)', r.threw, r.message);
    });

    // B13/B14: imutabilidade -- so status_sessao pode mudar.
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'10')`, [sessaoQr, STORE_A]);
      const r1 = await expectError(() => client.query(`UPDATE public.mesa_session_mesas SET mesa_identificador='11' WHERE mesa_session_id=$1 AND mesa_identificador='10'`, [sessaoQr]));
      check('B13 UPDATE mesa_identificador de linha existente -> bloqueado (imutabilidade)', r1.threw, r1.message);
      const r2 = await expectError(() => client.query(`UPDATE public.mesa_session_mesas SET mesa_session_id=$1 WHERE mesa_session_id=$2 AND mesa_identificador='10'`, [randomUUID(), sessaoQr]));
      check('B14 UPDATE mesa_session_id de linha existente -> bloqueado (imutabilidade)', r2.threw, r2.message);
    });

    // B15: fechar a sessao-pai sincroniza status_sessao em TODAS as linhas-filhas.
    await withSavepoint(async () => {
      const s = (await client.query(`INSERT INTO public.mesa_sessions (store_id, origem_abertura) VALUES ($1,'qr_mesa') RETURNING id`, [STORE_A])).rows[0].id;
      await client.query(`INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'20'),($1,$2,'21')`, [s, STORE_A]);
      await client.query(
        `UPDATE public.mesa_sessions SET status='fechada', closed_at=now(), closed_by_admin_user_id=$2, valor_cobrado_snapshot=30, payment_method='dinheiro' WHERE id=$1`, [s, ADMIN_UID]);
      const filhas = (await client.query(`SELECT mesa_identificador, status_sessao FROM public.mesa_session_mesas WHERE mesa_session_id=$1 ORDER BY mesa_identificador`, [s])).rows;
      check('B15 fechar a sessao sincroniza status_sessao=fechada em TODAS as mesas associadas',
        filhas.length === 2 && filhas.every(f => f.status_sessao === 'fechada'), JSON.stringify(filhas));

      // B16: sessao fechada e imutavel -- nem "reabrir" e permitido.
      const r = await expectError(() => client.query(`UPDATE public.mesa_sessions SET status='aberta' WHERE id=$1`, [s]));
      check('B16 tentar reabrir sessao fechada -> bloqueado (trigger no-reopen, decisao definitiva)', r.threw, r.message);

      // B17: identificador liberado apos fechamento -- nova sessao pode reusar "20".
      const s2 = (await client.query(`INSERT INTO public.mesa_sessions (store_id, origem_abertura) VALUES ($1,'qr_mesa') RETURNING id`, [STORE_A])).rows[0].id;
      const r2 = await expectError(() => client.query(`INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'20')`, [s2, STORE_A]));
      check('B17 apos fechar, identificador fica livre -> nova sessao pode reusar "20"', !r2.threw, r2.message);
    });

    // B18-B21: acesso direto via anon/authenticated deve ser negado (RLS + REVOKE).
    await withSavepoint(async () => {
      await setRole('anon');
      const r1 = await expectError(() => client.query(`SELECT * FROM public.mesa_sessions LIMIT 1`));
      check('B18 SELECT em mesa_sessions como anon -> permission denied', r1.threw && /permission denied/i.test(r1.message), r1.message);
      await resetRole();
    });
    await withSavepoint(async () => {
      await setRole('authenticated');
      const r1 = await expectError(() => client.query(`INSERT INTO public.mesa_sessions (store_id, origem_abertura) VALUES ($1,'qr_mesa')`, [STORE_A]));
      check('B19 INSERT em mesa_sessions como authenticated -> permission denied', r1.threw && /permission denied/i.test(r1.message), r1.message);
      await resetRole();
    });
    await withSavepoint(async () => {
      await setRole('anon');
      const r1 = await expectError(() => client.query(`INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador) VALUES ($1,$2,'30')`, [sessaoQr, STORE_A]));
      check('B20 INSERT em mesa_session_mesas como anon -> permission denied', r1.threw && /permission denied/i.test(r1.message), r1.message);
      await resetRole();
    });
    await withSavepoint(async () => {
      await setRole('authenticated');
      const r1 = await expectError(() => client.query(`SELECT public._mesa_sessions_no_reopen()`));
      check('B21 chamar funcao de trigger interna diretamente como authenticated -> permission denied (sem EXECUTE)', r1.threw && /permission denied/i.test(r1.message), r1.message);
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
