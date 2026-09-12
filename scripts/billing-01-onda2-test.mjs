// REF-BILLING-01 · Onda 2 (cron de carencia/bloqueio) -- E2E dedicado.
// platform_billing_cron_tick() nunca e chamada via PostgREST (GRANT so pra postgres/service_role) --
// aqui e chamada direto pela conexao raw de teste (mesmo papel que o pg_cron usa em producao), sem
// setRole nenhum. Cobre a janela exata de carencia (B.8: 5 dias sempre contados do vencimento de
// CADA loja), a fronteira onde o bloqueio comeca, isenta/bloqueada nunca sendo re-processadas, loja
// sem vencimento configurado (proximo_vencimento NULL) nunca quebrando o tick, e a integracao real
// com o gate da Onda 1 (is_admin_of cai pra false so depois que o cron de fato bloqueia). SAVEPOINT
// por caso, tudo dentro de 1 transacao que da ROLLBACK no final (nao suja o E2E).
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

async function novaLoja(nome) {
  const id = randomUUID();
  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,$3,'ativo')`, [id, `billing01-onda2-${id}`, nome]);
  return id;
}
async function novaAssinatura(storeId, { status, dias_atras_vencimento, dias_carencia = 5 }) {
  const venc = dias_atras_vencimento === null ? null : `CURRENT_DATE - ${dias_atras_vencimento}`;
  await client.query(
    `INSERT INTO public.store_subscriptions (store_id, status, proximo_vencimento, dias_carencia)
     VALUES ($1, $2, ${venc}, $3)`,
    [storeId, status, dias_carencia]
  );
}
async function statusAtual(storeId) {
  return (await client.query(`SELECT status FROM public.store_subscriptions WHERE store_id=$1`, [storeId])).rows[0].status;
}
async function eventos(storeId) {
  return (await client.query(`SELECT tipo FROM public.store_billing_events WHERE store_id=$1 ORDER BY created_at`, [storeId])).rows.map(r => r.tipo);
}
async function tick() {
  return (await client.query(`SELECT public.platform_billing_cron_tick() AS res`)).rows[0].res;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-BILLING-01 · Onda 2 (cron carencia/bloqueio) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    // ── 1: vencimento e HOJE (ainda nao passou) -> continua em_dia ────────────────────────────
    await withSavepoint(async () => {
      const store = await novaLoja('Onda2 caso1');
      await novaAssinatura(store, { status: 'em_dia', dias_atras_vencimento: 0 });
      await tick();
      check('1 vencimento hoje -> continua em_dia (ainda nao venceu)', await statusAtual(store) === 'em_dia');
    });

    // ── 2: vencimento foi ONTEM -> vira carencia + eventos vencimento/entrada_carencia ────────
    await withSavepoint(async () => {
      const store = await novaLoja('Onda2 caso2');
      await novaAssinatura(store, { status: 'em_dia', dias_atras_vencimento: 1 });
      await tick();
      check('2a vencimento ontem -> vira carencia', await statusAtual(store) === 'carencia');
      const ev = await eventos(store);
      check('2b eventos vencimento + entrada_carencia gravados', ev.includes('vencimento') && ev.includes('entrada_carencia'), JSON.stringify(ev));
    });

    // ── 3: em carencia ha EXATAMENTE dias_carencia dias -> ainda NAO bloqueia (borda) ─────────
    await withSavepoint(async () => {
      const store = await novaLoja('Onda2 caso3');
      await novaAssinatura(store, { status: 'carencia', dias_atras_vencimento: 5, dias_carencia: 5 });
      await tick();
      check('3 carencia no limite exato (venc+5) -> ainda NAO bloqueia', await statusAtual(store) === 'carencia');
    });

    // ── 4: carencia esgotada (venc + dias_carencia + 1) -> bloqueia + evento bloqueio ─────────
    await withSavepoint(async () => {
      const store = await novaLoja('Onda2 caso4');
      await novaAssinatura(store, { status: 'carencia', dias_atras_vencimento: 6, dias_carencia: 5 });
      await tick();
      check('4a carencia esgotada (venc+6) -> vira bloqueada', await statusAtual(store) === 'bloqueada');
      const ev = await eventos(store);
      check('4b evento bloqueio gravado', ev.includes('bloqueio'), JSON.stringify(ev));
    });

    // ── 5: loja isenta com vencimento vencido ha muito tempo -> NUNCA e tocada ────────────────
    await withSavepoint(async () => {
      const store = await novaLoja('Onda2 caso5');
      await novaAssinatura(store, { status: 'isenta', dias_atras_vencimento: 100 });
      await tick();
      check('5 isenta nunca e tocada pelo cron mesmo com vencimento antigo', await statusAtual(store) === 'isenta');
      check('5b isenta nao gera evento nenhum', (await eventos(store)).length === 0);
    });

    // ── 6: loja ja bloqueada -> tick de novo NAO duplica evento de bloqueio ────────────────────
    await withSavepoint(async () => {
      const store = await novaLoja('Onda2 caso6');
      await novaAssinatura(store, { status: 'bloqueada', dias_atras_vencimento: 30 });
      await tick();
      await tick(); // roda 2x de proposito
      check('6 bloqueada continua bloqueada, sem reprocessar', await statusAtual(store) === 'bloqueada');
      check('6b nenhum evento novo (bloqueio so na TRANSICAO, nao a cada tick)', (await eventos(store)).length === 0);
    });

    // ── 7: loja em_dia SEM proximo_vencimento configurado (NULL) -> tick nao quebra, nao muda ──
    await withSavepoint(async () => {
      const store = await novaLoja('Onda2 caso7');
      await novaAssinatura(store, { status: 'em_dia', dias_atras_vencimento: null });
      const r = await tick();
      check('7a tick nao lanca erro com proximo_vencimento NULL', r.ok === true, JSON.stringify(r));
      check('7b status continua em_dia (nunca vencido, nada a fazer)', await statusAtual(store) === 'em_dia');
    });

    // ── 8: integracao real com o gate da Onda 1 -- so bloqueia is_admin_of DEPOIS do cron agir ──
    await withSavepoint(async () => {
      const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
      const ADMIN_UID = authUsers[0].id;
      const store = await novaLoja('Onda2 caso8');
      await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, store]);
      await novaAssinatura(store, { status: 'carencia', dias_atras_vencimento: 6, dias_carencia: 5 }); // ja no ponto de bloquear

      await setRole('authenticated', ADMIN_UID, store);
      const antesDoTick = (await client.query(`SELECT public.is_admin_of($1) AS ok`, [store])).rows[0].ok;
      await resetRole();
      check('8a antes do tick (ainda so carencia) -> is_admin_of continua true', antesDoTick === true, String(antesDoTick));

      await tick();

      await setRole('authenticated', ADMIN_UID, store);
      const depoisDoTick = (await client.query(`SELECT public.is_admin_of($1) AS ok`, [store])).rows[0].ok;
      await resetRole();
      check('8b depois do tick (cron bloqueou) -> is_admin_of vira false', depoisDoTick === false, String(depoisDoTick));
    });

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
