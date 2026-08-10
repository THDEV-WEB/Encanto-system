// Suite de verificacao da REF-SAAS-01 · Onda 4.2 (fidelidade cliente-facing) — "Testes da fase".
// Mesmo rigor das subfases anteriores. Exigencia especifica do dono pra esta subfase: acumulo de
// pontos por loja, resgate de recompensas por loja, impossibilidade de usar pontos de uma loja em
// outra, isolamento completo do historico de fidelidade, e compatibilidade integral com o Cliente Zero.
//
// Camada A: estrutural. Camada B: comportamental — SET LOCAL ROLE + request.jwt.claims dentro de
// BEGIN...ROLLBACK. Loja B, seus clientes/fidelidade e seu admin sao ficticios, inseridos no inicio de
// cada transacao e desfeitos pelo ROLLBACK — nunca persistem. Exit 0 = SUCCESS.
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

const ADMIN_REAL_USER_ID = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // admin real de producao (loja encanto)
  // -- desde a correcao operacional pos-Onda-8 (2026-08-10), TAMBEM super admin real/permanente. So
  // usado abaixo pra checagens de REGRESSAO real, nunca mais pra isolamento negativo.
const ADMIN_B            = 'ce7ece01-266c-42b1-a9db-8051da24d7f5'; // vira admin da loja B FICTICIA
const SAME_PERSON        = '27bd5049-60e5-4980-abe9-3bd7942a6c31'; // fidelidade em 2 lojas, mesma pessoa
const ADMIN_ENCANTO_REGULAR = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // admin REGULAR de encanto (nunca
  // super admin, nunca customer aqui) -- persona dedicada pras checagens de isolamento negativo que
  // ADMIN_REAL_USER_ID deixou de servir. Ganha o vinculo com Encanto so' DENTRO da transacao de teste.

const STORE_B_ID    = 'eeeeeeee-bbbb-4000-8000-000000000001';
const CUSTOMER_A_ID = 'eeeeeeee-1111-4000-8000-00000000000a'; // SAME_PERSON, encanto, 10 selos
const CUSTOMER_B_ID = 'eeeeeeee-1111-4000-8000-00000000000b'; // SAME_PERSON, loja B, 2 selos (insuficiente)
const CUSTOMER_C_ID = 'eeeeeeee-1111-4000-8000-00000000000c'; // convidado (sem auth), loja B, 6 selos
const REQUIRED = 5; // loyalty_required forcado pra um valor conhecido dentro da transacao de teste

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

function setupSql(encantoId) {
  return [
    // valores forcados SO dentro desta transacao (ROLLBACK desfaz) pra tornar os testes deterministicos,
    // independente do toggle real (loyalty_enabled esta 'false' em producao agora, achado da Onda 4.1).
    `INSERT INTO public.settings (chave, valor) VALUES ('loyalty_enabled','true') ON CONFLICT (chave) DO UPDATE SET valor='true'`,
    `INSERT INTO public.settings (chave, valor) VALUES ('loyalty_required','${REQUIRED}') ON CONFLICT (chave) DO UPDATE SET valor='${REQUIRED}'`,
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-teste-onda42', 'Loja B (fake, teste Onda 4.2)', NULL, 'ativo')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B}', '${STORE_B_ID}')`,
    `INSERT INTO public.customers (id, name, phone, auth_user_id, store_id) VALUES ('${CUSTOMER_A_ID}', 'Pessoa X (fake onda42)', '47966660001', '${SAME_PERSON}', '${encantoId}')`,
    `INSERT INTO public.customers (id, name, phone, auth_user_id, store_id) VALUES ('${CUSTOMER_B_ID}', 'Pessoa X (fake onda42, loja B)', '47966660002', '${SAME_PERSON}', '${STORE_B_ID}')`,
    `INSERT INTO public.customers (id, name, phone, store_id) VALUES ('${CUSTOMER_C_ID}', 'Convidado Loja B (fake onda42)', '47966660003', '${STORE_B_ID}')`,
    `INSERT INTO public.loyalty_accounts (customer_id, stamps, store_id) VALUES ('${CUSTOMER_A_ID}', 10, '${encantoId}')`,
    `INSERT INTO public.loyalty_accounts (customer_id, stamps, store_id) VALUES ('${CUSTOMER_B_ID}', 2, '${STORE_B_ID}')`,
    `INSERT INTO public.loyalty_accounts (customer_id, stamps, store_id) VALUES ('${CUSTOMER_C_ID}', 6, '${STORE_B_ID}')`,
  ];
}

try {
  out('====================================================================');
  out(' SUITE — REF-SAAS-01 · Onda 4.2 (fidelidade cliente-facing) — RELATORIO');
  out('====================================================================');
  out('Camada A: somente leitura. Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  const encantoId = (await client.query(`SELECT id FROM public.stores WHERE slug = 'encanto'`)).rows[0].id;
  out('— Loja encanto resolvida (fora de qualquer sessao simulada, como superuser): ' + encantoId + ' —');
  out('');

  // ---------------- Camada A: estrutural ----------------
  out('— A1: as 3 RPCs tem exatamente 1 overload cada, incluindo p_store_id —');
  {
    const r = await client.query(`
      SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
      WHERE proname IN ('get_my_loyalty','redeem_reward','admin_find_loyalty') AND pronamespace='public'::regnamespace
      ORDER BY proname`);
    const byName = Object.fromEntries(r.rows.map(x => [x.proname, x.args]));
    const counts = r.rows.reduce((acc, x) => { acc[x.proname] = (acc[x.proname] || 0) + 1; return acc; }, {});
    const ok = counts.get_my_loyalty === 1 && counts.redeem_reward === 1 && counts.admin_find_loyalty === 1
      && byName.get_my_loyalty.includes('p_store_id') && byName.redeem_reward.includes('p_store_id') && byName.admin_find_loyalty.includes('p_store_id');
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A1 1 overload cada, com p_store_id`); out(`         -> ${JSON.stringify(byName)}`);
  }
  out('');

  // ---------------- Camada B: comportamental ----------------

  out('— ACUMULO POR LOJA: get_my_loyalty da mesma pessoa retorna saldo DIFERENTE por loja, nunca misturado —');
  await tx('authenticated', SAME_PERSON, setupSql(encantoId), async () => {
    await callRpc('ACUMULO-P1', 'get_my_loyalty() SEM p_store_id (como o app real chama) retorna o saldo de ENCANTO (10 selos, regressao)',
      `SELECT public.get_my_loyalty() AS r`, [],
      (row) => ({ ok: row?.r?.stamps === 10 && row?.r?.has_account === true, detail: JSON.stringify(row?.r) }));
    await callRpc('ACUMULO-P2', 'get_my_loyalty(p_store_id=lojaB) retorna o saldo da LOJA B (2 selos) -- nunca o de encanto',
      `SELECT public.get_my_loyalty($1) AS r`, [STORE_B_ID],
      (row) => ({ ok: row?.r?.stamps === 2 && row?.r?.has_account === true, detail: JSON.stringify(row?.r) }));
  });
  out('');

  out('— RESGATE POR LOJA (positivo, self-service): redeem_reward() SEM p_store_id resgata em ENCANTO (regressao) —');
  await tx('authenticated', SAME_PERSON, setupSql(encantoId), async () => {
    await callRpc('RESGATE-P1', 'redeem_reward() consome os 10 selos de encanto (>= 5 exigidos), vira 5',
      `SELECT public.redeem_reward() AS r`, [],
      (row) => ({ ok: row?.r?.ok === true && row?.r?.stamps === 5, detail: JSON.stringify(row?.r) }));
    const ev = await client.query(`SELECT store_id, tipo FROM public.loyalty_events WHERE customer_id = $1 AND tipo = 'redeemed'`, [CUSTOMER_A_ID]);
    const ok = ev.rowCount === 1 && ev.rows[0].store_id === encantoId;
    record('RESGATE-P1-evento', 'loyalty_events do resgate tem store_id=encanto', ok ? 'PASS' : 'FAIL', JSON.stringify(ev.rows));
  });
  out('');

  out('— IMPOSSIBILIDADE DE USAR PONTOS DE OUTRA LOJA: mesma pessoa, resgate no contexto da loja B usa SO o saldo da loja B (2, insuficiente) — nunca pega emprestado o saldo de encanto (10) —');
  await tx('authenticated', SAME_PERSON, setupSql(encantoId), async () => {
    await callRpc('IMPOSSIVEL-P1', 'redeem_reward(p_store_id=lojaB) falha por saldo insuficiente NAQUELA loja, mesmo com 10 selos disponiveis em encanto',
      `SELECT public.redeem_reward(NULL, $1) AS r`, [STORE_B_ID],
      (row) => ({ ok: row?.r?.ok === false && row?.r?.error === 'recompensa indisponivel' && row?.r?.stamps === 2, detail: JSON.stringify(row?.r) }));
    // confirma que o saldo de encanto continua intocado (nao foi "emprestado")
    const la = await client.query(`SELECT stamps FROM public.loyalty_accounts WHERE customer_id = $1`, [CUSTOMER_A_ID]);
    const ok = la.rows[0]?.stamps === 10;
    record('IMPOSSIVEL-P2', 'saldo de encanto permanece intocado (10) apos a tentativa negada na loja B', ok ? 'PASS' : 'FAIL', JSON.stringify(la.rows));
  });
  out('');

  out('— ISOLAMENTO COMPLETO DO HISTORICO: admin_find_loyalty so encontra cliente da PROPRIA loja, mesmo com telefone exato —');
  await tx('authenticated', ADMIN_ENCANTO_REGULAR, [...setupSql(encantoId), `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_ENCANTO_REGULAR}', '${encantoId}') ON CONFLICT DO NOTHING`], async () => {
    await callRpc('ISOLAMENTO-P1', 'admin regular (encanto) ENCONTRA cliente de encanto (regressao)',
      `SELECT public.admin_find_loyalty($1) AS r`, ['47966660001'],
      (row) => ({ ok: row?.r?.ok === true && row?.r?.customer_id === CUSTOMER_A_ID && row?.r?.stamps === 10, detail: JSON.stringify(row?.r) }));
    await callRpc('ISOLAMENTO-N1', 'admin regular (encanto) NAO encontra cliente da loja B, mesmo com telefone EXATO',
      `SELECT public.admin_find_loyalty($1) AS r`, ['47966660002'],
      (row) => ({ ok: row?.r?.ok === false && row?.r?.error === 'cliente nao encontrado', detail: JSON.stringify(row?.r) }));
  });
  await tx('authenticated', ADMIN_B, setupSql(encantoId), async () => {
    await callRpc('ISOLAMENTO-P2', 'admin B ENCONTRA cliente da propria loja com o saldo correto (2 selos)',
      `SELECT public.admin_find_loyalty($1, $2) AS r`, ['47966660002', STORE_B_ID],
      (row) => ({ ok: row?.r?.ok === true && row?.r?.customer_id === CUSTOMER_B_ID && row?.r?.stamps === 2, detail: JSON.stringify(row?.r) }));
    await callRpc('ISOLAMENTO-N2', 'admin B NAO encontra cliente de encanto, mesmo com telefone EXATO',
      `SELECT public.admin_find_loyalty($1, $2) AS r`, ['47966660001', STORE_B_ID],
      (row) => ({ ok: row?.r?.ok === false && row?.r?.error === 'cliente nao encontrado', detail: JSON.stringify(row?.r) }));
  });
  out('');

  out('— redeem_reward administrativo: admin so resgata para cliente DA PROPRIA loja —');
  await tx('authenticated', ADMIN_B, setupSql(encantoId), async () => {
    await callRpc('ADMRESGATE-P', 'admin B resgata pro convidado da propria loja (6 >= 5 exigidos)',
      `SELECT public.redeem_reward($1) AS r`, [CUSTOMER_C_ID],
      (row) => ({ ok: row?.r?.ok === true && row?.r?.stamps === 1, detail: JSON.stringify(row?.r) }));
    await callRpc('ADMRESGATE-N', 'admin B NAO consegue resgatar pro cliente de encanto (isolamento -- admin B nao administra a loja daquele cliente)',
      `SELECT public.redeem_reward($1) AS r`, [CUSTOMER_A_ID],
      (row) => ({ ok: row?.r?.ok === false, detail: JSON.stringify(row?.r) }));
  });
  await tx('authenticated', ADMIN_ENCANTO_REGULAR, [...setupSql(encantoId), `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_ENCANTO_REGULAR}', '${encantoId}') ON CONFLICT DO NOTHING`], async () => {
    await callRpc('ADMRESGATE-N2', 'admin regular NAO consegue resgatar pro convidado da loja B (isolamento, nao e "sem permissao" por acaso -- checa store do alvo)',
      `SELECT public.redeem_reward($1) AS r`, [CUSTOMER_C_ID],
      (row) => ({ ok: row?.r?.ok === false, detail: JSON.stringify(row?.r) }));
  });
  out('');

  out('— COMPATIBILIDADE COM O CLIENTE ZERO: replay das 4 chamadas reais (exatamente como o frontend chama, sem p_store_id) contra dados de producao —');
  {
    const realCustomer = await client.query(`
      SELECT c.id, c.phone, c.auth_user_id FROM public.customers c
      JOIN public.loyalty_accounts la ON la.customer_id = c.id
      WHERE c.auth_user_id IS NOT NULL LIMIT 1`);
    if (realCustomer.rowCount === 1) {
      const { phone, auth_user_id } = realCustomer.rows[0];
      await tx('authenticated', auth_user_id, [], async () => {
        await callRpc('CLIENTEZERO-P1', 'get_my_loyalty() real, sem args, funciona pro admin/cliente real de producao',
          `SELECT public.get_my_loyalty() AS r`, [],
          (row, err) => ({ ok: err === null && typeof row?.r?.stamps === 'number', detail: err || JSON.stringify(row?.r) }));
      });
      await tx('authenticated', ADMIN_REAL_USER_ID, [], async () => {
        await callRpc('CLIENTEZERO-P2', 'admin_find_loyalty real, sem p_store_id, encontra cliente real de encanto pelo telefone',
          `SELECT public.admin_find_loyalty($1) AS r`, [phone],
          (row) => ({ ok: row?.r?.ok === true, detail: JSON.stringify(row?.r) }));
      });
    } else {
      out('  (nenhum cliente real com auth_user_id + loyalty_account encontrado -- checks CLIENTEZERO pulados)');
    }
  }
  out('');

  out('— REGRESSAO-01: zero mutacao liquida em producao apos toda a suite —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE id = '${STORE_B_ID}') AS loja_b,
        (SELECT count(*)::int FROM public.admins WHERE store_id = '${STORE_B_ID}') AS admin_b,
        (SELECT count(*)::int FROM public.customers WHERE id IN ('${CUSTOMER_A_ID}','${CUSTOMER_B_ID}','${CUSTOMER_C_ID}')) AS clientes_fake,
        (SELECT valor FROM public.settings WHERE chave = 'loyalty_required') AS loyalty_required_real`);
    const row = r.rows[0];
    const ok = row.loja_b === 0 && row.admin_b === 0 && row.clientes_fake === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO-01 zero mutacao liquida (loyalty_required real preservado: ${row.loyalty_required_real})`); out(`         -> ${JSON.stringify(row)}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 4.2)');
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
