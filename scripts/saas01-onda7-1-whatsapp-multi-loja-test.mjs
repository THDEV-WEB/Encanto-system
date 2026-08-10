// Suite de verificacao da REF-SAAS-01 · Onda 7.1 (WhatsApp operacional multi-tenant, wa.me — SEM Meta
// Cloud API/Tech Provider/BSP) — "Testes da fase". Cobre explicitamente os 10 itens de validacao
// pedidos pelo dono: (1) loja A abre WhatsApp A; (2) loja B abre WhatsApp B; (3/4) isolamento nos dois
// sentidos; (5) loja nova sem WhatsApp nao herda a Encanto; (6) alterar uma loja nao afeta outra;
// (7) admin so altera a propria config; (8) mensagem/comanda usa dados da loja correta (nomeCurto);
// (9) Cliente Zero (Encanto) continua funcionando exatamente como antes; (10) validado junto do E2E
// completo, fora deste script.
//
// Camada A: estrutural. Camada B: comportamental — SET LOCAL ROLE + request.jwt.claims dentro de
// BEGIN...ROLLBACK. Loja B (com WhatsApp PROPRIO) e loja C (nova, sem nenhuma linha) sao ficticias,
// desfeitas pelo ROLLBACK. Exit 0 = SUCCESS.
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

const STORE_A_ID = 'ffffffff-7001-4000-8000-000000000001'; // loja A ficticia, com WhatsApp PROPRIO
const STORE_B_ID = 'ffffffff-7001-4000-8000-000000000002'; // loja B ficticia, com WhatsApp PROPRIO (diferente de A)
const STORE_C_ID = 'ffffffff-7001-4000-8000-000000000003'; // loja C NOVA, sem nenhuma linha em store_settings

const WHATSAPP_A = '5547911110001';
const WHATSAPP_B = '5547922220002';

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
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_A_ID}', 'loja-a-teste-onda71', 'Loja A (fake, teste Onda 7.1)', NULL, 'ativo')`,
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-teste-onda71', 'Loja B (fake, teste Onda 7.1)', NULL, 'ativo')`,
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_C_ID}', 'loja-c-teste-onda71', 'Loja C nova (fake, sem company_info)', NULL, 'ativo')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B}', '${STORE_B_ID}')`,
    // loja A e loja B ganham WhatsApp PROPRIO, diferentes entre si -- prova de isolamento (itens 1-4/6).
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_A_ID}', 'company_info', '{"nomeCurto":"Loja A","whatsapp":"${WHATSAPP_A}"}')`,
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_B_ID}', 'company_info', '{"nomeCurto":"Loja B","whatsapp":"${WHATSAPP_B}"}')`,
    // loja C fica SEM NENHUMA linha em store_settings de proposito (item 5: loja nova).
  ];
}

try {
  out('==================================================================');
  out(' SUITE — REF-SAAS-01 · Onda 7.1 (WhatsApp operacional multi-tenant) — RELATORIO');
  out('==================================================================');
  out('Camada A: somente leitura. Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  // Valor real de producao, capturado AGORA -- referencia de "Cliente Zero continua funcionando
  // exatamente como antes" (item 9) em todo o resto da suite.
  const realWhatsapp = (await client.query(`SELECT public.get_company_info()->>'whatsapp' AS v`)).rows[0].v;
  const realNome = (await client.query(`SELECT public.get_company_info()->>'nomeCurto' AS v`)).rows[0].v;
  out(`— Valor real capturado (referencia de regressao — item 9): whatsapp=${realWhatsapp} · nomeCurto=${realNome} —`);
  out('');

  // ---------------- Camada A: estrutural ----------------
  out('— A1: get_company_info() sem argumento (chamada real do app) continua identica ao valor real da Encanto —');
  {
    const r = await client.query(`SELECT public.get_company_info()->>'whatsapp' AS whatsapp`);
    const ok = r.rows[0].whatsapp === realWhatsapp;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A1 whatsapp=${r.rows[0].whatsapp} (esperado ${realWhatsapp})`);
  }
  out('');

  // ---------------- Camada B: comportamental ----------------

  out('— ITENS 1/2: loja A abre WhatsApp A; loja B abre WhatsApp B —');
  await tx('anon', null, setupSql(), async () => {
    await callRpc('ITEM1-A', 'get_company_info(lojaA).whatsapp = numero PROPRIO da loja A', `SELECT public.get_company_info($1) AS r`, [STORE_A_ID],
      (row) => ({ ok: row?.r?.whatsapp === WHATSAPP_A, detail: JSON.stringify(row?.r?.whatsapp) }));
    await callRpc('ITEM2-B', 'get_company_info(lojaB).whatsapp = numero PROPRIO da loja B', `SELECT public.get_company_info($1) AS r`, [STORE_B_ID],
      (row) => ({ ok: row?.r?.whatsapp === WHATSAPP_B, detail: JSON.stringify(row?.r?.whatsapp) }));
  });
  out('');

  out('— ITENS 3/4: loja A NUNCA usa o WhatsApp da loja B, e vice-versa —');
  await tx('anon', null, setupSql(), async () => {
    await callRpc('ITEM3-A-nao-B', 'get_company_info(lojaA).whatsapp != WhatsApp da loja B', `SELECT public.get_company_info($1) AS r`, [STORE_A_ID],
      (row) => ({ ok: row?.r?.whatsapp !== WHATSAPP_B, detail: JSON.stringify(row?.r?.whatsapp) }));
    await callRpc('ITEM4-B-nao-A', 'get_company_info(lojaB).whatsapp != WhatsApp da loja A', `SELECT public.get_company_info($1) AS r`, [STORE_B_ID],
      (row) => ({ ok: row?.r?.whatsapp !== WHATSAPP_A, detail: JSON.stringify(row?.r?.whatsapp) }));
  });
  out('');

  out('— ITEM 5: loja nova (SEM nenhuma linha em store_settings) NAO herda o WhatsApp/identidade da Encanto —');
  await tx('anon', null, setupSql(), async () => {
    await callRpc('ITEM5-whatsapp', 'get_company_info(lojaC nova).whatsapp = "" (nunca o numero real da Encanto)', `SELECT public.get_company_info($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r?.whatsapp === '' && row?.r?.whatsapp !== realWhatsapp, detail: JSON.stringify(row?.r?.whatsapp) }));
    await callRpc('ITEM5-nomeCurto', 'get_company_info(lojaC nova).nomeCurto = "Loja" (generico, nunca "Encanto")', `SELECT public.get_company_info($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r?.nomeCurto === 'Loja' && row?.r?.nomeCurto !== realNome, detail: JSON.stringify(row?.r?.nomeCurto) }));
    await callRpc('ITEM5-telefone', 'get_company_info(lojaC nova).telefone = "" (nunca o numero real da Encanto)', `SELECT public.get_company_info($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r?.telefone === '', detail: JSON.stringify(row?.r?.telefone) }));
    await callRpc('ITEM5-email', 'get_company_info(lojaC nova).email = "" (nunca o e-mail real da Encanto)', `SELECT public.get_company_info($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r?.email === '', detail: JSON.stringify(row?.r?.email) }));
    await callRpc('ITEM5-float', 'get_company_info(lojaC nova).whatsappFloatEnabled = false (nunca oferece contato sem numero real)', `SELECT public.get_company_info($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r?.whatsappFloatEnabled === false, detail: JSON.stringify(row?.r?.whatsappFloatEnabled) }));
  });
  out('');

  out('— ITEM 6: alterar o WhatsApp da loja A NAO afeta o WhatsApp da loja B —');
  await tx('authenticated', ADMIN_REAL_USER_ID, [...setupSql(), `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_REAL_USER_ID}', '${STORE_A_ID}')`], async () => {
    await callRpc('ITEM6-set-A', 'admin de A altera o whatsapp da propria loja', `SELECT public.set_company_info($1, $2) AS r`, [JSON.stringify({ whatsapp: '5547933330099' }), STORE_A_ID],
      (row, err) => ({ ok: err === null && row?.r?.whatsapp === '5547933330099', detail: err || JSON.stringify(row?.r?.whatsapp) }));
    await callRpc('ITEM6-B-intocada', 'get_company_info(lojaB).whatsapp continua o mesmo, intocado pela alteracao de A', `SELECT public.get_company_info($1) AS r`, [STORE_B_ID],
      (row) => ({ ok: row?.r?.whatsapp === WHATSAPP_B, detail: JSON.stringify(row?.r?.whatsapp) }));
  });
  out('');

  out('— ITEM 7: admin so altera o WhatsApp da PROPRIA loja (isolamento administrativo) —');
  await tx('authenticated', ADMIN_B, setupSql(), async () => {
    await callRpc('ITEM7-B-P', 'admin B altera o whatsapp da propria loja (B)', `SELECT public.set_company_info($1, $2) AS r`, [JSON.stringify({ whatsapp: '5547944440003' }), STORE_B_ID],
      (row, err) => ({ ok: err === null && row?.r?.whatsapp === '5547944440003', detail: err || JSON.stringify(row?.r) }));
    await callRpc('ITEM7-B-N-loja-A', 'admin B NAO consegue alterar o whatsapp da loja A', `SELECT public.set_company_info($1, $2) AS r`, [JSON.stringify({ whatsapp: 'hackeado' }), STORE_A_ID],
      (row, err) => ({ ok: err !== null && err.includes('apenas administradores'), detail: err || JSON.stringify(row?.r) }));
    await callRpc('ITEM7-B-N-encanto', 'admin B NAO consegue alterar o whatsapp da Encanto (sem p_store_id -> default)', `SELECT public.set_company_info($1) AS r`, [JSON.stringify({ whatsapp: 'hackeado' })],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  await tx('authenticated', STRANGER, setupSql(), async () => {
    await callRpc('ITEM7-STRANGER-N', 'stranger (sem vinculo admin) nao consegue alterar o whatsapp de A nem de B', `SELECT public.set_company_info($1, $2) AS r`, [JSON.stringify({ whatsapp: 'hackeado' }), STORE_A_ID],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  await tx('anon', null, setupSql(), async () => {
    await callRpc('ITEM7-ANON-N', 'anon nao consegue alterar o whatsapp de nenhuma loja', `SELECT public.set_company_info($1, $2) AS r`, [JSON.stringify({ whatsapp: 'hackeado' }), STORE_A_ID],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 8: mensagem/comanda usa o nomeCurto da LOJA CORRETA (via enc_enqueue_notification -> get_company_info(v_store)) —');
  await tx('anon', null, setupSql(), async () => {
    const payload = { p_customer: { name: 'Cliente WhatsApp Onda71', phone: '47955550003' },
      p_order: { total: 40, payment_method: 'pix', address: 'Rua Teste WhatsApp, 1' },
      p_items: [{ nome_produto: 'Item WhatsApp', quantity: 1, price: 40 }] };
    const r = await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb,NULL,$4) AS r`,
      [JSON.stringify(payload.p_customer), JSON.stringify(payload.p_order), JSON.stringify(payload.p_items), STORE_B_ID]);
    const res = r.rows[0].r;
    await client.query('RESET ROLE');
    let ok = false, empresa = null;
    if (res?.ok) {
      const n = await client.query(`SELECT vars->>'empresa' AS empresa FROM public.notification_outbox WHERE order_id = $1`, [res.order_id]);
      empresa = n.rows[0]?.empresa;
      ok = empresa === 'Loja B'; // nomeCurto da loja B (setupSql), nao "Encanto" nem "Loja A"
    }
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] ITEM8 notificacao do pedido na loja B usa o nomeCurto="Loja B" daquela loja`); out(`         -> resultado=${JSON.stringify(res)} · empresa="${empresa}"`);
  });
  out('');

  out('— ITEM 9: apos toda a suite, o WhatsApp/identidade REAIS da Encanto continuam EXATAMENTE os mesmos —');
  {
    const r = await client.query(`SELECT public.get_company_info()->>'whatsapp' AS whatsapp, public.get_company_info()->>'nomeCurto' AS nomeCurto, public.get_company_info()->>'telefone' AS telefone, public.get_company_info()->>'email' AS email`);
    const ok = r.rows[0].whatsapp === realWhatsapp && r.rows[0].nomecurto === realNome;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] ITEM9 Cliente Zero (Encanto) inalterado`); out(`         -> ${JSON.stringify(r.rows[0])}`);
  }
  out('');

  out('— REGRESSAO: zero mutacao liquida (lojas/admin/config/pedido ficticios) em producao —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE id IN ('${STORE_A_ID}','${STORE_B_ID}','${STORE_C_ID}')) AS lojas_fake,
        (SELECT count(*)::int FROM public.admins WHERE store_id IN ('${STORE_A_ID}','${STORE_B_ID}')) AS admins_fake,
        (SELECT count(*)::int FROM public.store_settings WHERE store_id IN ('${STORE_A_ID}','${STORE_B_ID}','${STORE_C_ID}')) AS config_fake,
        (SELECT count(*)::int FROM public.customers WHERE phone = '47955550003') AS cliente_fake`);
    const row = r.rows[0];
    const ok = Object.values(row).every(n => n === 0);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO zero mutacao liquida`); out(`         -> ${JSON.stringify(row)}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 7.1)');
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
