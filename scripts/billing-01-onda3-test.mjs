// REF-BILLING-01 · Onda 3 (platform_list_billing + historico em get_billing_status) -- E2E dedicado.
// Cobre so o que a Onda 3 realmente ADICIONOU no backend (a UI em si -- Playwright -- prova a
// integracao real): platform_list_billing() lista TODAS as lojas via LEFT JOIN (loja sem assinatura
// nunca some, aparece como 'sem_assinatura'), so Platform Admin pode chama-la, e get_billing_status
// agora devolve 'historico' com os ultimos eventos em ordem DESC sem quebrar o resto do shape ja
// provado na Onda 1. SAVEPOINT por caso, ROLLBACK no final.
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
  const sp = `sp_err_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { await queryFn(); await client.query(`RELEASE SAVEPOINT ${sp}`); return { erro: false }; }
  catch (e) { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); return { erro: true, msg: e.message, bate: regex.test(e.message) }; }
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-BILLING-01 · Onda 3 (platform_list_billing + historico) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    const [SUPER, OUTRO] = authUsers;

    const storeComAssinatura = randomUUID();
    const storeSemAssinatura = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Onda3 com assinatura','ativo')`, [storeComAssinatura, `billing01-onda3-com-${storeComAssinatura}`]);
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Onda3 sem assinatura','ativo')`, [storeSemAssinatura, `billing01-onda3-sem-${storeSemAssinatura}`]);
    await client.query(`INSERT INTO public.store_subscriptions (store_id, status, dia_vencimento, proximo_vencimento) VALUES ($1,'em_dia',15,CURRENT_DATE+30)`, [storeComAssinatura]);
    // created_at explicito e espacado -- now() fica CONGELADO por toda a transacao no Postgres, entao
    // 2 INSERTs seguidos (default now()) nascem com o MESMO timestamp (achado real ao rodar este
    // teste) -- isso e so um artefato do setup em transacao unica, nao um bug do ORDER BY em si,
    // mas sem timestamps distintos o caso 3b nao prova nada.
    await client.query(`INSERT INTO public.store_billing_events (store_id, tipo, payload, created_at) VALUES ($1,'pagamento_confirmado','{}'::jsonb, now() - interval '1 minute')`, [storeComAssinatura]);
    await client.query(`INSERT INTO public.store_billing_events (store_id, tipo, payload, created_at) VALUES ($1,'alteracao_vencimento','{}'::jsonb, now())`, [storeComAssinatura]);
    await client.query(`INSERT INTO public.super_admins (user_id) VALUES ($1)`, [SUPER.id]);

    // ── 1: platform_list_billing por usuario comum -> recusado ────────────────────────────────
    await withSavepoint(async () => {
      await setRole('authenticated', OUTRO.id, null);
      const { erro, bate, msg } = await esperaErro(() => client.query(`SELECT public.platform_list_billing() AS res`), /apenas o super admin/);
      check('1 platform_list_billing usuario comum -> recusado', erro && bate, msg || 'nao lancou erro');
      await resetRole();
    });

    // ── 2: platform_list_billing por super admin -> lista as 2 lojas, LEFT JOIN correto ───────
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER.id, null);
      const rows = (await client.query(`SELECT * FROM public.platform_list_billing() WHERE store_id IN ($1,$2)`, [storeComAssinatura, storeSemAssinatura])).rows;
      const com = rows.find(r => r.store_id === storeComAssinatura);
      const sem = rows.find(r => r.store_id === storeSemAssinatura);
      check('2a lista inclui a loja COM assinatura, status em_dia', com?.status === 'em_dia', JSON.stringify(com));
      check('2b lista inclui a loja SEM assinatura, status sem_assinatura (LEFT JOIN, nunca some)', sem?.status === 'sem_assinatura', JSON.stringify(sem));
      await resetRole();
    });

    // ── 3: get_billing_status agora devolve historico, mais recente primeiro ──────────────────
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER.id, null);
      const r = (await client.query(`SELECT public.get_billing_status($1) AS res`, [storeComAssinatura])).rows[0].res;
      check('3a historico presente com 2 eventos', Array.isArray(r.historico) && r.historico.length === 2, JSON.stringify(r.historico));
      check('3b mais recente primeiro (alteracao_vencimento foi inserido por ultimo)', r.historico[0].tipo === 'alteracao_vencimento', JSON.stringify(r.historico));
      check('3c shape antigo (Onda 1) continua intacto', r.status === 'em_dia' && r.dia_vencimento === 15, JSON.stringify(r));
      await resetRole();
    });

    // ── 4: get_billing_status pra loja sem assinatura -> historico vazio, nao quebra ──────────
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER.id, null);
      const r = (await client.query(`SELECT public.get_billing_status($1) AS res`, [storeSemAssinatura])).rows[0].res;
      check('4 sem assinatura -> historico = [] (nunca null/erro)', Array.isArray(r.historico) && r.historico.length === 0, JSON.stringify(r));
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
