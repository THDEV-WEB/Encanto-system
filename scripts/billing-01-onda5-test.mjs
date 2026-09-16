// REF-BILLING-01 · Onda 5 (Pix da VALION + aviso por e-mail) -- E2E dedicado.
// Cobre: platform_billing_config (RPCs de leitura/config, so Platform Admin escreve, qualquer admin
// le), e os 2 pontos novos de geracao de aviso dentro de platform_billing_cron_tick() (vencimento
// proximo em EXATAMENTE T-3, entrada de carencia na transicao) -- ambos so geram linha na fila quando
// ha contato_financeiro_email configurado, nunca senao. platform_billing_reminder_dispatch() sem
// segredo no Vault (estado real ate o dono configurar em producao) precisa ser NO-OP, nunca erro --
// mesmo padrao ja provado pelo WhatsApp (REF-ORDER-01b). SAVEPOINT por caso, ROLLBACK no final.
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
async function novaLoja(nome) {
  const id = randomUUID();
  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,$3,'ativo')`, [id, `billing01-onda5-${id}`, nome]);
  return id;
}
async function outboxDaLoja(storeId) {
  return (await client.query(`SELECT tipo, to_email, state FROM public.platform_billing_reminder_outbox WHERE store_id=$1`, [storeId])).rows;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-BILLING-01 · Onda 5 (Pix da VALION + aviso por e-mail) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    const [SUPER, ADMIN_COMUM] = authUsers;
    const storeQualquer = await novaLoja('Onda5 loja qualquer');
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_COMUM.id, storeQualquer]);
    await client.query(`INSERT INTO public.super_admins (user_id) VALUES ($1)`, [SUPER.id]);

    // ── 1: get_platform_billing_config sem nada configurado -> configurado:false, nao erro ──────
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_COMUM.id, storeQualquer);
      const r = (await client.query(`SELECT public.get_platform_billing_config() AS res`)).rows[0].res;
      check('1 sem config -> configurado:false', r.configurado === false, JSON.stringify(r));
      await resetRole();
    });

    // ── 2: platform_configurar_dados_pagamento por admin comum -> recusado ────────────────────
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_COMUM.id, storeQualquer);
      const { erro, bate, msg } = await esperaErro(
        () => client.query(`SELECT public.platform_configurar_dados_pagamento('joao@x.com','email','Joao') AS res`),
        /apenas o super admin/);
      check('2 configurar_dados_pagamento admin comum -> recusado', erro && bate, msg || 'nao lancou erro');
      await resetRole();
    });

    // ── 3: platform_configurar_dados_pagamento por super admin -> ok; QUALQUER admin ve depois ──
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER.id, null);
      const r = (await client.query(`SELECT public.platform_configurar_dados_pagamento('financeiro@valion.com.br','email','VALION Sistemas Ltda') AS res`)).rows[0].res;
      check('3a configurar_dados_pagamento super admin -> ok', r.ok === true && r.chave_pix === 'financeiro@valion.com.br', JSON.stringify(r));
      await resetRole();

      await setRole('authenticated', ADMIN_COMUM.id, storeQualquer);
      const lido = (await client.query(`SELECT public.get_platform_billing_config() AS res`)).rows[0].res;
      check('3b admin comum (nao super) consegue LER os dados ja configurados', lido.configurado === true && lido.chave_pix === 'financeiro@valion.com.br', JSON.stringify(lido));
      await resetRole();
    });

    // ── 4: tipo de chave invalido -> recusado ──────────────────────────────────────────────────
    await withSavepoint(async () => {
      await setRole('authenticated', SUPER.id, null);
      const { erro, bate, msg } = await esperaErro(
        () => client.query(`SELECT public.platform_configurar_dados_pagamento('x','tipo-invalido','Y') AS res`),
        /tipo de chave pix invalido/);
      check('4 tipo de chave invalido -> recusado', erro && bate, msg || 'nao lancou erro');
      await resetRole();
    });

    // ── 5: vencimento em EXATAMENTE 3 dias + contato configurado -> gera aviso vencimento_proximo ──
    await withSavepoint(async () => {
      const store = await novaLoja('Onda5 caso5');
      await client.query(`INSERT INTO public.store_subscriptions (store_id, status, proximo_vencimento, contato_financeiro_email) VALUES ($1,'em_dia',CURRENT_DATE+3,'dono5@teste.com')`, [store]);
      await client.query(`SELECT public.platform_billing_cron_tick()`);
      const ob = await outboxDaLoja(store);
      check('5 vencimento em T-3 -> gera aviso vencimento_proximo', ob.length === 1 && ob[0].tipo === 'vencimento_proximo' && ob[0].to_email === 'dono5@teste.com', JSON.stringify(ob));
    });

    // ── 6: vencimento em T-2 ou T-4 (nao exatamente 3) -> NAO gera aviso ───────────────────────
    await withSavepoint(async () => {
      const store = await novaLoja('Onda5 caso6');
      await client.query(`INSERT INTO public.store_subscriptions (store_id, status, proximo_vencimento, contato_financeiro_email) VALUES ($1,'em_dia',CURRENT_DATE+2,'dono6@teste.com')`, [store]);
      await client.query(`SELECT public.platform_billing_cron_tick()`);
      const ob = await outboxDaLoja(store);
      check('6 vencimento em T-2 (nao T-3) -> nenhum aviso', ob.length === 0, JSON.stringify(ob));
    });

    // ── 7: vencimento em T-3 mas SEM contato_financeiro_email -> NAO gera aviso (nada pra mandar) ──
    await withSavepoint(async () => {
      const store = await novaLoja('Onda5 caso7');
      await client.query(`INSERT INTO public.store_subscriptions (store_id, status, proximo_vencimento) VALUES ($1,'em_dia',CURRENT_DATE+3)`, [store]);
      await client.query(`SELECT public.platform_billing_cron_tick()`);
      const ob = await outboxDaLoja(store);
      check('7 T-3 sem contato financeiro -> nenhum aviso (nunca erro)', ob.length === 0, JSON.stringify(ob));
    });

    // ── 8: transicao em_dia->carencia + contato configurado -> gera aviso entrada_carencia ────
    await withSavepoint(async () => {
      const store = await novaLoja('Onda5 caso8');
      await client.query(`INSERT INTO public.store_subscriptions (store_id, status, proximo_vencimento, contato_financeiro_email) VALUES ($1,'em_dia',CURRENT_DATE-1,'dono8@teste.com')`, [store]);
      await client.query(`SELECT public.platform_billing_cron_tick()`);
      const ob = await outboxDaLoja(store);
      check('8 entra em carencia + contato -> gera aviso entrada_carencia', ob.length === 1 && ob[0].tipo === 'entrada_carencia' && ob[0].to_email === 'dono8@teste.com', JSON.stringify(ob));
    });

    // ── 9: transicao em_dia->carencia SEM contato -> NAO gera aviso ───────────────────────────
    await withSavepoint(async () => {
      const store = await novaLoja('Onda5 caso9');
      await client.query(`INSERT INTO public.store_subscriptions (store_id, status, proximo_vencimento) VALUES ($1,'em_dia',CURRENT_DATE-1)`, [store]);
      await client.query(`SELECT public.platform_billing_cron_tick()`);
      const ob = await outboxDaLoja(store);
      check('9 entra em carencia sem contato -> nenhum aviso', ob.length === 0, JSON.stringify(ob));
    });

    // ── 10: segunda chamada do tick no MESMO dia -> nao duplica aviso (loja ja esta em carencia) ──
    await withSavepoint(async () => {
      const store = await novaLoja('Onda5 caso10');
      await client.query(`INSERT INTO public.store_subscriptions (store_id, status, proximo_vencimento, contato_financeiro_email) VALUES ($1,'em_dia',CURRENT_DATE-1,'dono10@teste.com')`, [store]);
      await client.query(`SELECT public.platform_billing_cron_tick()`);
      await client.query(`SELECT public.platform_billing_cron_tick()`); // roda 2x de proposito
      const ob = await outboxDaLoja(store);
      check('10 tick 2x no mesmo dia -> so 1 aviso (transicao ja aconteceu)', ob.length === 1, JSON.stringify(ob));
    });

    // ── 11: platform_billing_reminder_dispatch sem segredo no Vault -> NO-OP, nunca erro ───────
    await withSavepoint(async () => {
      const r = (await client.query(`SELECT public.platform_billing_reminder_dispatch() AS res`)).rows[0].res;
      check('11 dispatch sem resend_api_key -> skipped, sem crash', r.ok === true && r.skipped === 'resend_not_configured', JSON.stringify(r));
    });

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
