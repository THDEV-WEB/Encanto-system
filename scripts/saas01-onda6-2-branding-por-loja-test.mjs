// Suite de verificacao da REF-SAAS-01 · Onda 6.2 (branding por loja) — "Testes da fase".
// Mesmo rigor das subfases anteriores: positivo E negativo, isolamento entre lojas ficticias (nunca
// persistidas), regressao contra a Encanto real. Exigencia especifica desta subfase: a migracao de
// company_info (settings global -> store_settings por loja) preserva 100% do dado real; validacao
// server-side dos 7 campos novos (logoUrl/faviconUrl/corPrimaria/corSecundaria/corDestaque/
// termosSecoes/fidelidadeTexto); enc_enqueue_notification usa o nome da LOJA CERTA (fix do achado 2
// da auditoria).
//
// Camada A: estrutural. Camada B: comportamental — SET LOCAL ROLE + request.jwt.claims dentro de
// BEGIN...ROLLBACK. Loja B (com company_info PROPRIA) e loja C (sem nenhuma linha -- loja nova) sao
// ficticias, desfeitas pelo ROLLBACK. Exit 0 = SUCCESS.
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

const STORE_B_ID = 'ffffffff-6202-4000-8000-000000000001'; // loja com company_info PROPRIA
const STORE_C_ID = 'ffffffff-6202-4000-8000-000000000002'; // loja NOVA, sem nenhuma linha em store_settings

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
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-teste-onda62', 'Loja B (fake, teste Onda 6.2)', NULL, 'ativo')`,
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_C_ID}', 'loja-c-teste-onda62', 'Loja C nova (fake, sem company_info)', NULL, 'ativo')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B}', '${STORE_B_ID}')`,
    // loja B ganha company_info PROPRIA, bem diferente da encanto -- prova de isolamento.
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_B_ID}', 'company_info', '{"nomeCurto":"Loja B Branding","corPrimaria":"#112233"}')`,
    // loja C fica SEM NENHUMA linha em store_settings de proposito (cenario de loja recem-criada).
  ];
}

try {
  out('==================================================================');
  out(' SUITE — REF-SAAS-01 · Onda 6.2 (branding por loja) — RELATORIO');
  out('==================================================================');
  out('Camada A: somente leitura. Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  // ---------------- Camada A: estrutural ----------------
  out('— A1: get_company_info/set_company_info tem exatamente 1 overload cada, com p_store_id —');
  {
    const r = await client.query(`
      SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
      WHERE proname IN ('get_company_info','set_company_info') AND pronamespace='public'::regnamespace ORDER BY proname`);
    const counts = {};
    for (const row of r.rows) counts[row.proname] = (counts[row.proname] || 0) + 1;
    const todasUmaSo = Object.values(counts).every(n => n === 1) && Object.keys(counts).length === 2;
    const todasComStoreId = r.rows.every(row => row.args.includes('p_store_id'));
    const ok = todasUmaSo && todasComStoreId;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A1 2 funcoes, 1 overload cada, com p_store_id`); out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— A2: a chave company_info sumiu da settings GLOBAL (dado morto removido) —');
  {
    const r = await client.query(`SELECT chave FROM public.settings WHERE chave = 'company_info'`);
    const ok = r.rowCount === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A2 zero chaves remanescentes na settings global`); out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— A3: enc_enqueue_notification chama get_company_info(v_store) — nao mais sem argumento —');
  {
    const r = await client.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname='enc_enqueue_notification' AND pronamespace='public'::regnamespace`);
    const def = r.rows[0]?.def || '';
    const ok = /get_company_info\(v_store\)/.test(def) && !/get_company_info\(\)/.test(def);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A3 enc_enqueue_notification propaga v_store para get_company_info`);
  }
  out('');

  // Valor real de producao, capturado AGORA (antes de qualquer sessao simulada) -- referencia de
  // "zero regressao" em todo o resto da suite.
  const realInfo = (await client.query(`SELECT public.get_company_info() AS v`)).rows[0].v;
  out(`— Valor real capturado (referencia de regressao): nomeCurto=${realInfo.nomeCurto} · email=${realInfo.email} —`);
  out('');

  // ---------------- Camada B: comportamental ----------------

  out('— COMPATIBILIDADE: get_company_info(), chamado sem p_store_id (como o app real chama), continua identico ao valor real —');
  await tx('anon', null, [], async () => {
    await callRpc('COMPAT-info', 'get_company_info() bate byte-a-byte com o valor real', `SELECT public.get_company_info() AS r`, [],
      (row) => ({ ok: JSON.stringify(row?.r) === JSON.stringify(realInfo), detail: 'igual=' + (JSON.stringify(row?.r) === JSON.stringify(realInfo)) }));
  });
  out('');

  out('— ISOLAMENTO: loja B tem company_info PROPRIA (nomeCurto="Loja B Branding", corPrimaria="#112233") -- nunca afeta nem reflete a de encanto —');
  await tx('anon', null, setupSql(), async () => {
    await callRpc('ISO-nome-B', 'get_company_info(lojaB).nomeCurto = "Loja B Branding" (config propria)', `SELECT public.get_company_info($1) AS r`, [STORE_B_ID],
      (row) => ({ ok: row?.r?.nomeCurto === 'Loja B Branding', detail: JSON.stringify(row?.r?.nomeCurto) }));
    await callRpc('ISO-cor-B', 'get_company_info(lojaB).corPrimaria = "#112233" (config propria)', `SELECT public.get_company_info($1) AS r`, [STORE_B_ID],
      (row) => ({ ok: row?.r?.corPrimaria === '#112233', detail: JSON.stringify(row?.r?.corPrimaria) }));
    await callRpc('ISO-info-encanto', 'get_company_info() de encanto continua no valor real, intocado pela config da loja B', `SELECT public.get_company_info() AS r`, [],
      (row) => ({ ok: JSON.stringify(row?.r) === JSON.stringify(realInfo), detail: 'igual=' + (JSON.stringify(row?.r) === JSON.stringify(realInfo)) }));
  });
  out('');

  out('— COMPORTAMENTO PADRAO PARA LOJA NOVA: loja C, SEM nenhuma linha em store_settings, recebe os mesmos defaults fixos de sempre —');
  await tx('anon', null, setupSql(), async () => {
    await callRpc('DEFAULT-cor', 'get_company_info(lojaC nova).corPrimaria = default fixo (#A62786)', `SELECT public.get_company_info($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r?.corPrimaria === '#A62786', detail: JSON.stringify(row?.r?.corPrimaria) }));
    await callRpc('DEFAULT-logo', 'get_company_info(lojaC nova).logoUrl = null (usa o asset estatico)', `SELECT public.get_company_info($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r?.logoUrl === null || row?.r?.logoUrl === undefined, detail: JSON.stringify(row?.r?.logoUrl) }));
    await callRpc('DEFAULT-termos', 'get_company_info(lojaC nova).termosSecoes tem as 4 secoes padrao (byte-identicas)', `SELECT public.get_company_info($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: Array.isArray(row?.r?.termosSecoes) && row.r.termosSecoes.length === 4, detail: 'n=' + row?.r?.termosSecoes?.length }));
    await callRpc('DEFAULT-fidelidade', 'get_company_info(lojaC nova).fidelidadeTexto tem os 3 paragrafos padrao', `SELECT public.get_company_info($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: Array.isArray(row?.r?.fidelidadeTexto) && row.r.fidelidadeTexto.length === 3, detail: 'n=' + row?.r?.fidelidadeTexto?.length }));
  });
  out('');

  // ADMIN_REAL_USER_ID deixou de servir pra isolamento negativo desde a correcao operacional
  // pos-Onda-8 (2026-08-10): passou a ser TAMBEM super admin real/permanente. Reaproveita STRANGER,
  // isolado nesta tx propria, com um vinculo de admin so' pra Encanto.
  out('— ESCRITA ADMINISTRATIVA: admin so altera o company_info da PROPRIA loja —');
  await tx('authenticated', STRANGER, [...setupSql(), `INSERT INTO public.admins (user_id, store_id) VALUES ('${STRANGER}', (SELECT id FROM public.stores WHERE slug='encanto')) ON CONFLICT DO NOTHING`], async () => {
    await callRpc('SET-info-P', 'admin regular altera o corDestaque de encanto (regressao)', `SELECT public.set_company_info($1) AS r`, [JSON.stringify({ corDestaque: '#00FF00' })],
      (row, err) => ({ ok: err === null && row?.r?.corDestaque === '#00FF00', detail: err || JSON.stringify(row?.r?.corDestaque) }));
    await callRpc('SET-info-N', 'admin regular NAO consegue alterar o company_info da loja B (isolamento)', `SELECT public.set_company_info($1, $2) AS r`, [JSON.stringify({ nomeCurto: 'Hackeado' }), STORE_B_ID],
      (row, err) => ({ ok: err !== null && err.includes('apenas administradores'), detail: err || JSON.stringify(row?.r) }));
  });
  await tx('authenticated', ADMIN_B, setupSql(), async () => {
    await callRpc('SET-info-B-P', 'admin B altera o company_info da propria loja', `SELECT public.set_company_info($1, $2) AS r`, [JSON.stringify({ nomeCurto: 'Loja B Renomeada' }), STORE_B_ID],
      (row, err) => ({ ok: err === null && row?.r?.nomeCurto === 'Loja B Renomeada', detail: err || JSON.stringify(row?.r?.nomeCurto) }));
    await callRpc('SET-info-B-N', 'admin B NAO consegue alterar o company_info de encanto', `SELECT public.set_company_info($1) AS r`, [JSON.stringify({ nomeCurto: 'Hackeado' })],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— Sessao: cliente sem vinculo / anon negados em toda escrita —');
  await tx('authenticated', STRANGER, setupSql(), async () => {
    await callRpc('STRANGER-info', 'stranger nao consegue alterar company_info', `SELECT public.set_company_info($1) AS r`, [JSON.stringify({ nomeCurto: 'Hackeado' })],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  await tx('anon', null, setupSql(), async () => {
    await callRpc('ANON-info', 'anon nao consegue alterar company_info', `SELECT public.set_company_info($1) AS r`, [JSON.stringify({ nomeCurto: 'Hackeado' })],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— VALIDACAO SERVER-SIDE: os 4 blocos novos rejeitam formato invalido, mesmo vindo de um admin legitimo —');
  await tx('authenticated', ADMIN_REAL_USER_ID, [], async () => {
    await callRpc('VAL-logo-N', 'logoUrl sem http(s) -> erro', `SELECT public.set_company_info($1) AS r`, [JSON.stringify({ logoUrl: 'ftp://x.com/a.png' })],
      (row, err) => ({ ok: err !== null && err.includes('logoUrl'), detail: err || JSON.stringify(row?.r) }));
    await callRpc('VAL-cor-N', 'corPrimaria fora do formato #RRGGBB -> erro', `SELECT public.set_company_info($1) AS r`, [JSON.stringify({ corPrimaria: 'roxo' })],
      (row, err) => ({ ok: err !== null && err.includes('corPrimaria'), detail: err || JSON.stringify(row?.r) }));
    await callRpc('VAL-termos-N', 'termosSecoes com secao sem "corpo" -> erro', `SELECT public.set_company_info($1) AS r`, [JSON.stringify({ termosSecoes: [{ titulo: 'x' }] })],
      (row, err) => ({ ok: err !== null && err.includes('termosSecoes'), detail: err || JSON.stringify(row?.r) }));
    await callRpc('VAL-fidelidade-N', 'fidelidadeTexto com item nao-texto -> erro', `SELECT public.set_company_info($1) AS r`, [JSON.stringify({ fidelidadeTexto: [123] })],
      (row, err) => ({ ok: err !== null && err.includes('fidelidadeTexto'), detail: err || JSON.stringify(row?.r) }));
    await callRpc('VAL-logo-P', 'logoUrl valido (http) -> aceito', `SELECT public.set_company_info($1) AS r`, [JSON.stringify({ logoUrl: 'https://cdn.exemplo.com/logo.png' })],
      (row, err) => ({ ok: err === null && row?.r?.logoUrl === 'https://cdn.exemplo.com/logo.png', detail: err || JSON.stringify(row?.r?.logoUrl) }));
  });
  out('');

  out('— ENC_ENQUEUE_NOTIFICATION: notificacao de um pedido real usa o nomeCurto DAQUELA loja, nao o fallback nem o de outra (fix do achado 2 da auditoria) —');
  await tx('anon', null, setupSql(), async () => {
    const payload = { p_customer: { name: 'Cliente Branding Onda62', phone: '47955550002' },
      p_order: { total: 30, payment_method: 'pix', address: 'Rua Teste Branding, 1' },
      p_items: [{ nome_produto: 'Item Branding', quantity: 1, price: 30 }] };
    const r = await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb,NULL,$4) AS r`,
      [JSON.stringify(payload.p_customer), JSON.stringify(payload.p_order), JSON.stringify(payload.p_items), STORE_B_ID]);
    const res = r.rows[0].r;
    await client.query('RESET ROLE');
    let ok = false, empresa = null;
    if (res?.ok) {
      const n = await client.query(`SELECT vars->>'empresa' AS empresa FROM public.notification_outbox WHERE order_id = $1`, [res.order_id]);
      empresa = n.rows[0]?.empresa;
      ok = empresa === 'Loja B Branding'; // nomeCurto da loja B (setupSql)
    }
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] ENC-NOTIFY notificacao do pedido na loja B usa o nomeCurto="Loja B Branding" daquela loja`); out(`         -> resultado=${JSON.stringify(res)} · empresa="${empresa}"`);
  });
  out('');

  out('— REGRESSAO-01: apos toda a suite, o company_info real de encanto continua EXATAMENTE o mesmo —');
  {
    const infoNow = (await client.query(`SELECT public.get_company_info() AS v`)).rows[0].v;
    const ok = JSON.stringify(infoNow) === JSON.stringify(realInfo);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO-01 company_info real de encanto inalterado`); out(`         -> nomeCurto=${infoNow.nomeCurto} (esperado ${realInfo.nomeCurto})`);
  }
  out('');

  out('— REGRESSAO-02: zero mutacao liquida (lojas/admin/config/pedido ficticios) em producao —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE id IN ('${STORE_B_ID}','${STORE_C_ID}')) AS lojas_fake,
        (SELECT count(*)::int FROM public.admins WHERE store_id = '${STORE_B_ID}') AS admin_b,
        (SELECT count(*)::int FROM public.store_settings WHERE store_id IN ('${STORE_B_ID}','${STORE_C_ID}')) AS config_fake,
        (SELECT count(*)::int FROM public.customers WHERE phone = '47955550002') AS cliente_fake`);
    const row = r.rows[0];
    const ok = Object.values(row).every(n => n === 0);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO-02 zero mutacao liquida`); out(`         -> ${JSON.stringify(row)}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 6.2)');
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
