// REF-BILLING-01 · Onda 1 (schema + RPCs + gate aditivo) -- E2E dedicado.
// Cobre: get_billing_status (leitura sobrevive ao bloqueio -- nao usa is_admin_of), as 3 RPCs
// exclusivas de Platform Admin (is_super_admin, nao is_admin_anywhere -- ver decisao de
// implementacao #1 no cabecalho da migration), o gate aditivo em is_admin_of (bloqueia SOMENTE o
// admin comum da loja, nunca o super admin -- decisao #2), RLS direto nas 2 tabelas novas, e
// regressao: loja sem nenhuma linha em store_subscriptions continua com is_admin_of intocado
// (fail-open, zero mudanca de comportamento ate alguem realmente configurar billing pra ela).
// SAVEPOINT por caso, tudo dentro de 1 transacao que da ROLLBACK no final (nao suja o E2E).
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

let pass = 0, fail = 0, spCounter = 0;
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
async function esperaErro(queryFn, regex) {
  // Query roda numa savepoint PROPRIA -- um RAISE EXCEPTION aborta a subtransacao inteira no
  // Postgres (todo comando seguinte falha ate um ROLLBACK), entao sem isso o resetRole() logo
  // depois quebraria mesmo com o teste tendo "passado".
  const sp = `sp_err_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    await queryFn();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { erro: false };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return { erro: true, msg: e.message, bate: regex.test(e.message) };
  }
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-BILLING-01 · Onda 1 (schema + RPCs + gate) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id, email FROM auth.users ORDER BY created_at LIMIT 3')).rows;
    if (authUsers.length < 3) { console.error('Precisa de >=3 usuarios em auth.users no E2E.'); process.exit(2); }
    const [CLIENTE, ADMIN, ADMIN_B] = authUsers;
    const ADMIN_UID = ADMIN.id;       // vira admin comum DESTA loja
    const SUPER_UID = ADMIN_B.id;     // vira super admin (platform admin) pra este teste
    const UNRELATED_UID = CLIENTE.id; // nao e admin desta loja nem super admin

    const STORE = randomUUID();
    const STORE_SEM_BILLING = randomUUID(); // regressao: nunca tera linha em store_subscriptions
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste BILLING-01 Onda1','ativo')`, [STORE, `billing01-onda1-${STORE}`]);
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste BILLING-01 sem billing','ativo')`, [STORE_SEM_BILLING, `billing01-onda1-nobill-${STORE_SEM_BILLING}`]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_SEM_BILLING]);
    await client.query(`INSERT INTO public.super_admins (user_id) VALUES ($1)`, [SUPER_UID]);

    // ── 1: get_billing_status sem linha nenhuma ainda -> 'sem_assinatura', nao erro ──────────
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE);
      const r = (await client.query(`SELECT public.get_billing_status($1) AS res`, [STORE])).rows[0].res;
      check('1 get_billing_status sem linha -> sem_assinatura (nao erro)', r.status === 'sem_assinatura', JSON.stringify(r));
      await resetRole();
    });

    // ── 2: get_billing_status por usuario SEM vinculo nenhum -> erro 42501 ────────────────────
    await withSavepoint(async () => {
      await setRole('authenticated', UNRELATED_UID, STORE);
      const { erro, bate, msg } = await esperaErro(
        () => client.query(`SELECT public.get_billing_status($1) AS res`, [STORE]), /sem permissao/);
      check('2 get_billing_status usuario nao-vinculado -> recusado', erro && bate, msg || 'nao lancou erro');
      await resetRole();
    });

    // ── 3: platform_configurar_dia_vencimento por admin COMUM (nao super) -> recusado ─────────
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE);
      const { erro, bate, msg } = await esperaErro(
        () => client.query(`SELECT public.platform_configurar_dia_vencimento($1, 10::smallint) AS res`, [STORE]),
        /apenas o super admin/);
      check('3 configurar_dia_vencimento admin comum -> recusado (so Platform Admin)', erro && bate, msg || 'nao lancou erro');
      await resetRole();
    });

    // ── 4: platform_configurar_dia_vencimento por SUPER admin -> cria linha, seta trial_ate ───
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER_UID, null);
      const r = (await client.query(`SELECT public.platform_configurar_dia_vencimento($1, 10::smallint) AS res`, [STORE])).rows[0].res;
      check('4a configurar_dia_vencimento super admin -> ok', r.ok === true && r.dia_vencimento === 10, JSON.stringify(r));
      const row = (await client.query(`SELECT status, dia_vencimento, proximo_vencimento, trial_ate FROM public.store_subscriptions WHERE store_id=$1`, [STORE])).rows[0];
      check('4b linha criada com status em_dia default', row.status === 'em_dia', JSON.stringify(row));
      check('4c trial_ate = hoje + 15 dias', row.trial_ate !== null, JSON.stringify(row));
      check('4d proximo_vencimento continua NULL (ninguem marcou pago ainda)', row.proximo_vencimento === null, JSON.stringify(row));
      await resetRole();
    });

    // ── 5: platform_marcar_mensalidade_paga com data passada -> recusado ──────────────────────
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER_UID, null);
      await client.query(`SELECT public.platform_configurar_dia_vencimento($1, 10::smallint) AS res`, [STORE]);
      const { erro, bate, msg } = await esperaErro(
        () => client.query(`SELECT public.platform_marcar_mensalidade_paga($1, CURRENT_DATE - 1) AS res`, [STORE]),
        /proximo vencimento invalido/);
      check('5 marcar_mensalidade_paga com data passada -> recusado', erro && bate, msg || 'nao lancou erro');
      await resetRole();
    });

    // ── 6: platform_marcar_mensalidade_paga por admin comum (nao super) -> recusado ───────────
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE);
      const { erro, bate, msg } = await esperaErro(
        () => client.query(`SELECT public.platform_marcar_mensalidade_paga($1, CURRENT_DATE + 30) AS res`, [STORE]),
        /apenas o super admin/);
      check('6 marcar_mensalidade_paga admin comum -> recusado', erro && bate, msg || 'nao lancou erro');
      await resetRole();
    });

    // ── 7: platform_marcar_mensalidade_paga por SUPER admin -> ok + evento no ledger ──────────
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER_UID, null);
      await client.query(`SELECT public.platform_configurar_dia_vencimento($1, 10::smallint) AS res`, [STORE]);
      const r = (await client.query(`SELECT public.platform_marcar_mensalidade_paga($1, CURRENT_DATE + 30) AS res`, [STORE])).rows[0].res;
      check('7a marcar_mensalidade_paga super admin -> ok, status em_dia', r.ok === true && r.status === 'em_dia', JSON.stringify(r));
      const ev = (await client.query(`SELECT tipo, payload FROM public.store_billing_events WHERE store_id=$1 AND tipo='pagamento_confirmado' ORDER BY created_at DESC LIMIT 1`, [STORE])).rows[0];
      check('7b evento pagamento_confirmado gravado no ledger', ev !== undefined, JSON.stringify(ev));
      await resetRole();
    });

    // ── 8: B.16 -- trocar dia_vencimento DEPOIS de ja ter proximo_vencimento agendado NAO mexe nele ──
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER_UID, null);
      await client.query(`SELECT public.platform_configurar_dia_vencimento($1, 10::smallint) AS res`, [STORE]);
      const marcado = (await client.query(`SELECT public.platform_marcar_mensalidade_paga($1, CURRENT_DATE + 30) AS res`, [STORE])).rows[0].res;
      const antes = marcado.proximo_vencimento;
      await client.query(`SELECT public.platform_configurar_dia_vencimento($1, 22::smallint) AS res`, [STORE]); // muda o dia
      const row = (await client.query(`SELECT dia_vencimento, proximo_vencimento::text AS proximo_vencimento FROM public.store_subscriptions WHERE store_id=$1`, [STORE])).rows[0];
      check('8 B.16: proximo_vencimento ja agendado nao muda ao trocar dia', row.proximo_vencimento === antes && row.dia_vencimento === 22,
        JSON.stringify({ antes, depois: row }));
      await resetRole();
    });

    // ── 9: platform_configurar_contato_financeiro -- ok + email invalido recusado ─────────────
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER_UID, null);
      const r = (await client.query(
        `SELECT public.platform_configurar_contato_financeiro($1, 'Joao Dono', 'joao@teste.com', '38999990000') AS res`, [STORE]
      )).rows[0].res;
      check('9a configurar_contato_financeiro super admin -> ok', r.ok === true && r.contato_financeiro_email === 'joao@teste.com', JSON.stringify(r));

      const { erro, bate, msg } = await esperaErro(
        () => client.query(`SELECT public.platform_configurar_contato_financeiro($1, 'Joao Dono', 'email-invalido', '38999990000') AS res`, [STORE]),
        /email invalido/);
      check('9b email invalido -> recusado', erro && bate, msg || 'nao lancou erro');
      await resetRole();
    });

    // ── 10: gate aditivo -- loja 'bloqueada' derruba SOMENTE o admin comum, nunca o super admin ──
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER_UID, null);
      await client.query(`SELECT public.platform_configurar_dia_vencimento($1, 10::smallint) AS res`, [STORE]);
      await resetRole();
      // eleva pra bloqueada fora de RLS (equivalente ao que a Onda 2/cron fara no futuro)
      await client.query(`RESET ROLE`);
      await client.query(`UPDATE public.store_subscriptions SET status='bloqueada' WHERE store_id=$1`, [STORE]);

      await setRole('authenticated', ADMIN_UID, STORE);
      const bloqueado = (await client.query(`SELECT public.is_admin_of($1) AS ok`, [STORE])).rows[0].ok;
      check('10a is_admin_of admin comum, loja bloqueada -> false', bloqueado === false, String(bloqueado));
      const statusVisivel = (await client.query(`SELECT public.get_billing_status($1) AS res`, [STORE])).rows[0].res;
      check('10b get_billing_status continua legivel mesmo bloqueado (mostra o motivo)', statusVisivel.status === 'bloqueada', JSON.stringify(statusVisivel));
      await resetRole();

      await setRole('authenticated', SUPER_UID, null);
      const superAindaEntra = (await client.query(`SELECT public.is_admin_of($1) AS ok`, [STORE])).rows[0].ok;
      check('10c is_admin_of super admin, loja bloqueada -> continua true (senao ninguem desbloqueia)', superAindaEntra === true, String(superAindaEntra));

      // desbloqueio via confirmacao de pagamento -> admin comum volta a entrar
      await client.query(`SELECT public.platform_marcar_mensalidade_paga($1, CURRENT_DATE + 30) AS res`, [STORE]);
      await resetRole();
      await setRole('authenticated', ADMIN_UID, STORE);
      const desbloqueado = (await client.query(`SELECT public.is_admin_of($1) AS ok`, [STORE])).rows[0].ok;
      check('10d marcar pago desbloqueia -> is_admin_of admin comum volta a true', desbloqueado === true, String(desbloqueado));
      await resetRole();
    });

    // ── 11: regressao -- loja SEM nenhuma linha em store_subscriptions, is_admin_of intocado ──
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_SEM_BILLING);
      const ok = (await client.query(`SELECT public.is_admin_of($1) AS ok`, [STORE_SEM_BILLING])).rows[0].ok;
      check('11 regressao: loja sem linha de billing -> is_admin_of continua true (fail-open)', ok === true, String(ok));
      await resetRole();
    });

    // ── 12: RLS direto -- admin da loja ve sua propria linha, usuario nao-vinculado ve 0 linhas ──
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER_UID, null);
      await client.query(`SELECT public.platform_configurar_dia_vencimento($1, 10::smallint) AS res`, [STORE]);
      await resetRole();

      await setRole('authenticated', ADMIN_UID, STORE);
      const proprio = (await client.query(`SELECT store_id FROM public.store_subscriptions WHERE store_id=$1`, [STORE])).rows;
      check('12a RLS: admin da loja ve a propria linha de store_subscriptions', proprio.length === 1, JSON.stringify(proprio));
      await resetRole();

      await setRole('authenticated', UNRELATED_UID, STORE);
      const alheio = (await client.query(`SELECT store_id FROM public.store_subscriptions WHERE store_id=$1`, [STORE])).rows;
      check('12b RLS: usuario nao-vinculado NAO ve a linha (RLS filtra)', alheio.length === 0, JSON.stringify(alheio));
      await resetRole();
    });

    // ── 13: seed -- Encanto/Aquarios (se existirem no E2E) nasceram isentas ────────────────────
    await withSavepoint(async () => {
      await client.query(`RESET ROLE`);
      const seed = (await client.query(
        `SELECT s.slug, sub.status FROM public.stores s JOIN public.store_subscriptions sub ON sub.store_id = s.id WHERE s.slug IN ('encanto','aquariosbar')`
      )).rows;
      check('13 seed: lojas piloto existentes nascem isenta (se existirem no E2E)',
        seed.every(r => r.status === 'isenta'), JSON.stringify(seed));
    });

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
