// Suite de verificacao da REF-SAAS-01 · Onda 4.3 (config operacional por loja) — "Testes da fase".
// Mesmo rigor das subfases anteriores. Exigencia especifica do dono: horarios de funcionamento, taxa
// de entrega, ETA, store_mode, compatibilidade com a config ATUAL da Encanto, comportamento padrao
// para lojas novas, e ausencia de regressao no checkout/abertura da loja.
//
// Camada A: estrutural. Camada B: comportamental — SET LOCAL ROLE + request.jwt.claims dentro de
// BEGIN...ROLLBACK. Loja B (com config propria) e loja C (sem config nenhuma -- cenario de loja nova)
// sao ficticias, desfeitas pelo ROLLBACK. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.env';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  let txt; try { txt = readFileSync(ENV_PATH, 'utf8'); } catch { console.error('ERRO: db.env nao encontrado'); process.exit(2); }
  const host = envGet(txt, 'PGHOST'); const user = envGet(txt, 'PGUSER');
  const password = envGet(txt, 'PGPASSWORD'); if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { cfg: { host, port: Number(envGet(txt, 'PGPORT') || 5432), user, password, database: envGet(txt, 'PGDATABASE') || 'postgres' }, secret: password, host, user };
}
function projectRef(host, user) { let m = (user || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1]; m = (host || '').match(/(?:^|\.)([a-z0-9]{16,})\.supabase\./i); return m ? m[1] : '(n/d)'; }
const git = (a) => { try { return execSync('git ' + a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return '(n/d)'; } };
const isoUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const { cfg, secret, host, user } = loadConn();
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

const ADMIN_REAL_USER_ID = 'b9dc7626-af9c-4ab5-95f7-3207e6469129';
const ADMIN_B            = 'ce7ece01-266c-42b1-a9db-8051da24d7f5';
const STRANGER           = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e';

const STORE_B_ID = 'ffffffff-bbbb-4000-8000-000000000001'; // loja com config PROPRIA
const STORE_C_ID = 'ffffffff-cccc-4000-8000-000000000001'; // loja NOVA, sem nenhuma linha em store_settings

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
async function tx(role, sub, setupSql, fn) {
  try {
    await client.query('BEGIN');
    for (const s of (setupSql || [])) await client.query(s);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(sub ? { sub, role } : { role })]);
    await client.query(`SET LOCAL ROLE ${role}`);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
async function callRpc(id, desc, sql, params, checkFn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let result = null, errMsg = null;
  try { const r = await client.query(sql, params); result = r.rows[0]; await client.query(`RELEASE SAVEPOINT ${sp}`); }
  catch (e) { errMsg = redact(e.message).split('\n')[0]; await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
  const { ok, detail } = checkFn(result, errMsg);
  record(id, desc, ok ? 'PASS' : 'FAIL', detail);
  return result;
}

function setupSql() {
  return [
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-teste-onda43', 'Loja B (fake, teste Onda 4.3)', NULL, 'ativo')`,
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_C_ID}', 'loja-c-teste-onda43', 'Loja C nova (fake, sem config)', NULL, 'ativo')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B}', '${STORE_B_ID}')`,
    // loja B ganha config PROPRIA, bem diferente da encanto -- prova de isolamento.
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_B_ID}', 'delivery_eta_min', '77')`,
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_B_ID}', 'store_mode', 'CLOSED')`,
    // loja C fica SEM NENHUMA linha em store_settings de proposito (cenario de loja recem-criada).
  ];
}
const DEFAULT_ETA = '45';
const DEFAULT_MODE = 'AUTO';

try {
  out('==================================================================');
  out(' SUITE — REF-SAAS-01 · Onda 4.3 (config operacional por loja) — RELATORIO');
  out('==================================================================');
  out('Camada A: somente leitura. Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');
  // Baseline: desde a correcao operacional pos-Onda-8 (2026-08-10), ADMIN_REAL_USER_ID e' super admin
  // real/permanente (pedido explicito do dono) -- REGRESSAO-02 abaixo compara CONTAGEM, nao mais 0.
  const baselineSuperAdmin = (await client.query(`SELECT count(*)::int AS n FROM public.super_admins WHERE user_id = '${ADMIN_REAL_USER_ID}'`)).rows[0].n;

  const encantoId = (await client.query(`SELECT id FROM public.stores WHERE slug = 'encanto'`)).rows[0].id;
  out('— Loja encanto resolvida (fora de qualquer sessao simulada, como superuser): ' + encantoId + ' —');
  out('');

  // ---------------- Camada A: estrutural ----------------
  out('— A1: store_settings existe, RLS habilitada, ZERO policies (trancada, mesmo padrao de settings/stores) —');
  {
    const rls = await client.query(`SELECT relrowsecurity FROM pg_class WHERE relname='store_settings' AND relnamespace='public'::regnamespace`);
    const pol = await client.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='store_settings'`);
    const ok = rls.rows[0]?.relrowsecurity === true && pol.rows[0].n === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A1 store_settings trancada`); out(`         -> RLS=${rls.rows[0]?.relrowsecurity} · policies=${pol.rows[0].n}`);
  }
  out('');

  out('— A2: as 8 RPCs + enc_tempo_estimado tem exatamente 1 overload cada, com p_store_id —');
  {
    const r = await client.query(`
      SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
      WHERE proname IN ('get_business_hours_schedule','set_business_hours_schedule','get_delivery_fee_config',
                         'set_delivery_fee_config','get_delivery_eta','set_delivery_eta','get_store_mode',
                         'set_store_mode','enc_tempo_estimado')
        AND pronamespace='public'::regnamespace ORDER BY proname`);
    const counts = {};
    for (const row of r.rows) counts[row.proname] = (counts[row.proname] || 0) + 1;
    const todasUmaSo = Object.values(counts).every(n => n === 1) && Object.keys(counts).length === 9;
    const todasComStoreId = r.rows.every(row => row.args.includes('p_store_id'));
    const ok = todasUmaSo && todasComStoreId;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A2 9 funcoes, 1 overload cada, com p_store_id`); out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— A3: as 4 chaves sumiram da settings GLOBAL (dado morto removido) —');
  {
    const r = await client.query(`SELECT chave FROM public.settings WHERE chave IN ('business_hours_schedule','delivery_fee_config','delivery_eta_min','store_mode')`);
    const ok = r.rowCount === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A3 zero chaves remanescentes na settings global`); out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  // Valores reais de producao, capturados AGORA (antes de qualquer sessao simulada) -- usados como
  // referencia de "zero regressao" em todo o resto da suite.
  const realHours = (await client.query(`SELECT public.get_business_hours_schedule() AS v`)).rows[0].v;
  const realFee = (await client.query(`SELECT public.get_delivery_fee_config() AS v`)).rows[0].v;
  const realEta = (await client.query(`SELECT public.get_delivery_eta() AS v`)).rows[0].v;
  const realMode = (await client.query(`SELECT public.get_store_mode() AS v`)).rows[0].v;
  out(`— Valores reais capturados (referencia de regressao): eta=${realEta} · mode=${realMode} —`);
  out('');

  // ---------------- Camada B: comportamental ----------------

  out('— COMPATIBILIDADE: as 4 leituras, chamadas sem p_store_id (como o app real chama), continuam identicas aos valores reais —');
  await tx('anon', null, [], async () => {
    await callRpc('COMPAT-hours', 'get_business_hours_schedule() bate byte-a-byte com o valor real', `SELECT public.get_business_hours_schedule() AS r`, [],
      (row) => ({ ok: JSON.stringify(row?.r) === JSON.stringify(realHours), detail: 'igual=' + (JSON.stringify(row?.r) === JSON.stringify(realHours)) }));
    await callRpc('COMPAT-fee', 'get_delivery_fee_config() bate byte-a-byte com o valor real', `SELECT public.get_delivery_fee_config() AS r`, [],
      (row) => ({ ok: JSON.stringify(row?.r) === JSON.stringify(realFee), detail: 'igual=' + (JSON.stringify(row?.r) === JSON.stringify(realFee)) }));
    await callRpc('COMPAT-eta', 'get_delivery_eta() bate com o valor real', `SELECT public.get_delivery_eta() AS r`, [],
      (row) => ({ ok: row?.r === realEta, detail: `${row?.r} === ${realEta}` }));
    await callRpc('COMPAT-mode', 'get_store_mode() bate com o valor real', `SELECT public.get_store_mode() AS r`, [],
      (row) => ({ ok: row?.r === realMode, detail: `${row?.r} === ${realMode}` }));
  });
  out('');

  out('— ISOLAMENTO: loja B tem config PROPRIA (eta=77, mode=CLOSED) -- nunca afeta nem reflete a de encanto —');
  await tx('anon', null, setupSql(), async () => {
    await callRpc('ISO-eta-B', 'get_delivery_eta(lojaB) retorna 77 (config propria)', `SELECT public.get_delivery_eta($1) AS r`, [STORE_B_ID],
      (row) => ({ ok: row?.r === '77', detail: JSON.stringify(row?.r) }));
    await callRpc('ISO-mode-B', 'get_store_mode(lojaB) retorna CLOSED (config propria)', `SELECT public.get_store_mode($1) AS r`, [STORE_B_ID],
      (row) => ({ ok: row?.r === 'CLOSED', detail: JSON.stringify(row?.r) }));
    await callRpc('ISO-eta-encanto', 'get_delivery_eta() de encanto continua no valor real, intocado pela config da loja B', `SELECT public.get_delivery_eta() AS r`, [],
      (row) => ({ ok: row?.r === realEta, detail: `${row?.r} === ${realEta}` }));
    await callRpc('ISO-mode-encanto', 'get_store_mode() de encanto continua no valor real, intocado pela config da loja B', `SELECT public.get_store_mode() AS r`, [],
      (row) => ({ ok: row?.r === realMode, detail: `${row?.r} === ${realMode}` }));
  });
  out('');

  out('— COMPORTAMENTO PADRAO PARA LOJA NOVA: loja C, SEM nenhuma linha em store_settings, recebe os mesmos defaults fixos de sempre —');
  await tx('anon', null, setupSql(), async () => {
    await callRpc('DEFAULT-eta', 'get_delivery_eta(lojaC nova) = 45 (default fixo, igual a hoje)', `SELECT public.get_delivery_eta($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r === DEFAULT_ETA, detail: JSON.stringify(row?.r) }));
    await callRpc('DEFAULT-mode', 'get_store_mode(lojaC nova) = AUTO (default fixo, igual a hoje)', `SELECT public.get_store_mode($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r === DEFAULT_MODE, detail: JSON.stringify(row?.r) }));
    await callRpc('DEFAULT-hours', 'get_business_hours_schedule(lojaC nova) devolve o cronograma padrao (seg-sab, domingo fechado)', `SELECT public.get_business_hours_schedule($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r?.schedule?.domingo?.fechado === true && row?.r?.schedule?.segunda?.fechado === false, detail: JSON.stringify(row?.r?.schedule?.domingo) }));
    await callRpc('DEFAULT-fee', 'get_delivery_fee_config(lojaC nova) devolve as faixas padrao (ativo=true, 17 faixas)', `SELECT public.get_delivery_fee_config($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r?.ativo === true && Array.isArray(row?.r?.faixas) && row.r.faixas.length === 17, detail: `ativo=${row?.r?.ativo} · faixas=${row?.r?.faixas?.length}` }));
  });
  out('');

  // Admin REGULAR de encanto (nunca super admin). Desde a correcao operacional pos-Onda-8
  // (2026-08-10), ADMIN_REAL_USER_ID passou a ser TAMBEM super admin real/permanente -- deixaria de
  // provar isolamento. Reaproveita STRANGER aqui (isolado nesta transacao propria, rolled-back --
  // nao interfere no seu papel de "sem vinculo" na tx separada mais abaixo).
  out('— ESCRITA ADMINISTRATIVA: admin so altera a config da PROPRIA loja —');
  await tx('authenticated', STRANGER, [...setupSql(), `INSERT INTO public.admins (user_id, store_id) VALUES ('${STRANGER}', '${encantoId}') ON CONFLICT DO NOTHING`], async () => {
    await callRpc('SET-eta-P', 'admin regular altera o ETA de encanto (regressao)', `SELECT public.set_delivery_eta($1) AS r`, [99],
      (row, err) => ({ ok: err === null && row?.r === 99, detail: err || JSON.stringify(row?.r) }));
    await callRpc('SET-eta-N', 'admin regular NAO consegue alterar o ETA da loja B (isolamento)', `SELECT public.set_delivery_eta($1, $2) AS r`, [88, STORE_B_ID],
      (row, err) => ({ ok: err !== null && err.includes('apenas administradores'), detail: err || JSON.stringify(row?.r) }));
    await callRpc('SET-mode-P', 'admin regular altera o store_mode de encanto (regressao)', `SELECT public.set_store_mode($1) AS r`, ['CLOSED'],
      (row, err) => ({ ok: err === null && row?.r === 'CLOSED', detail: err || JSON.stringify(row?.r) }));
    await callRpc('SET-mode-N', 'admin regular NAO consegue alterar o store_mode da loja B', `SELECT public.set_store_mode($1, $2) AS r`, ['OPEN', STORE_B_ID],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  await tx('authenticated', ADMIN_B, setupSql(), async () => {
    await callRpc('SET-eta-B-P', 'admin B altera o ETA da propria loja', `SELECT public.set_delivery_eta($1, $2) AS r`, [33, STORE_B_ID],
      (row, err) => ({ ok: err === null && row?.r === 33, detail: err || JSON.stringify(row?.r) }));
    await callRpc('SET-eta-B-N', 'admin B NAO consegue alterar o ETA de encanto', `SELECT public.set_delivery_eta($1) AS r`, [11],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— Sessao: cliente sem vinculo / anon negados em toda escrita —');
  await tx('authenticated', STRANGER, setupSql(), async () => {
    await callRpc('STRANGER-eta', 'stranger nao consegue alterar ETA', `SELECT public.set_delivery_eta($1) AS r`, [50],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
    await callRpc('STRANGER-hours', 'stranger nao consegue alterar horario', `SELECT public.set_business_hours_schedule($1) AS r`, [JSON.stringify({ schedule: {} })],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  await tx('anon', null, setupSql(), async () => {
    await callRpc('ANON-eta', 'anon nao consegue alterar ETA', `SELECT public.set_delivery_eta($1) AS r`, [50],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
    await callRpc('ANON-mode', 'anon nao consegue alterar store_mode', `SELECT public.set_store_mode($1) AS r`, ['CLOSED'],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— Sessao: super admin ficticio acessa/altera a config de qualquer loja —');
  await tx('authenticated', ADMIN_REAL_USER_ID, [...setupSql(), `INSERT INTO public.super_admins (user_id) VALUES ('${ADMIN_REAL_USER_ID}') ON CONFLICT DO NOTHING`], async () => {
    await callRpc('SUPER-eta', 'super admin altera o ETA da loja B mesmo sem linha em admins', `SELECT public.set_delivery_eta($1, $2) AS r`, [66, STORE_B_ID],
      (row, err) => ({ ok: err === null && row?.r === 66, detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ENC_TEMPO_ESTIMADO / WHATSAPP: notificacao de um pedido real usa o ETA DAQUELA loja, nao o fallback nem o de outra —');
  await tx('anon', null, setupSql(), async () => {
    const payload = { p_customer: { name: 'Cliente ETA Onda43', phone: '47955550001' },
      p_order: { total: 25, payment_method: 'pix', address: 'Rua Teste ETA, 1' },
      p_items: [{ nome_produto: 'Item ETA', quantity: 1, price: 25 }] };
    const r = await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb,NULL,$4) AS r`,
      [JSON.stringify(payload.p_customer), JSON.stringify(payload.p_order), JSON.stringify(payload.p_items), STORE_B_ID]);
    const res = r.rows[0].r;
    await client.query('RESET ROLE');
    let ok = false, tempo = null;
    if (res?.ok) {
      const n = await client.query(`SELECT vars->>'tempo' AS tempo FROM public.notification_outbox WHERE order_id = $1`, [res.order_id]);
      tempo = n.rows[0]?.tempo;
      ok = tempo === 'até 77 min'; // eta da loja B = 77 (setupSql)
    }
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] ENC-TEMPO notificacao do pedido na loja B usa o ETA=77 daquela loja`); out(`         -> resultado=${JSON.stringify(res)} · tempo="${tempo}"`);
  });
  out('');

  out('— REGRESSAO-01: apos toda a suite, os 4 valores reais de encanto continuam EXATAMENTE os mesmos —');
  {
    const hoursNow = (await client.query(`SELECT public.get_business_hours_schedule() AS v`)).rows[0].v;
    const feeNow = (await client.query(`SELECT public.get_delivery_fee_config() AS v`)).rows[0].v;
    const etaNow = (await client.query(`SELECT public.get_delivery_eta() AS v`)).rows[0].v;
    const modeNow = (await client.query(`SELECT public.get_store_mode() AS v`)).rows[0].v;
    const ok = JSON.stringify(hoursNow) === JSON.stringify(realHours) && JSON.stringify(feeNow) === JSON.stringify(realFee)
      && etaNow === realEta && modeNow === realMode;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO-01 config real de encanto inalterada`); out(`         -> eta=${etaNow} mode=${modeNow} (esperado eta=${realEta} mode=${realMode})`);
  }
  out('');

  out('— REGRESSAO-02: zero mutacao liquida (lojas/admin/config ficticios) em producao —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE id IN ('${STORE_B_ID}','${STORE_C_ID}')) AS lojas_fake,
        (SELECT count(*)::int FROM public.admins WHERE store_id = '${STORE_B_ID}') AS admin_b,
        (SELECT count(*)::int FROM public.super_admins WHERE user_id = '${ADMIN_REAL_USER_ID}') AS super_admin,
        (SELECT count(*)::int FROM public.store_settings WHERE store_id IN ('${STORE_B_ID}','${STORE_C_ID}')) AS config_fake,
        (SELECT count(*)::int FROM public.customers WHERE phone = '47955550001') AS cliente_fake`);
    const row = r.rows[0];
    const ok = Object.entries(row).every(([k, n]) => (k === 'super_admin' ? n === baselineSuperAdmin : n === 0));
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO-02 zero mutacao liquida`); out(`         -> ${JSON.stringify({ ...row, super_admin_baseline: baselineSuperAdmin })}`);
  }
  out('');

  out('— Resumo —  PASS: ' + passes + '  ·  FAIL: ' + failures);
  out('— Fingerprint — commit ' + git('rev-parse HEAD') + ' · branch ' + git('rev-parse --abbrev-ref HEAD') + ' · Node ' + process.version + ' · ' + (Date.now() - startedMs) + ' ms · started ' + startedIso);
  out('');

  const body = R.join('\n');
  const sha = createHash('sha256').update(body, 'utf8').digest('hex');
  console.log(body);
  console.log('— Execution Report SHA256 —\n  ' + sha + '\n');
  const state = failures ? 'FAILED' : 'SUCCESS';
  console.log('====================================');
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 4.3)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('Camada B roda em BEGIN...ROLLBACK — mutacao liquida ZERO');
  console.log('====================================');
  if (failures) process.exitCode = 1;
} catch (e) {
  console.log(R.join('\n'));
  console.error('SUITE ERROR: ' + redact(e && e.message ? e.message : e));
  console.log('STATE:\nFAILED');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
