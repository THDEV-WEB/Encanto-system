// Suite de verificacao da REF-LOYALTY-AUDIT-01 · Onda 1 (config de fidelidade por loja) —
// "Testes da fase". Mesmo rigor/estilo das subfases da REF-SAAS-01 (ver
// scripts/saas01-onda4-2-fidelidade-test.mjs, mesmo padrao reaproveitado aqui).
//
// Camada A: estrutural (schema/assinatura/grants). Camada B: comportamental — SET LOCAL ROLE +
// request.jwt.claims dentro de BEGIN...ROLLBACK. Lojas B/C, seus clientes/admins e pedidos sao
// ficticios, inseridos no inicio de cada transacao e desfeitos pelo ROLLBACK — nunca persistem.
// Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';

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

// Lojas: 100% ficticias, prefixo dedicado desta REF (stores nao tem FK p/ auth.users, seguro inventar).
const STORE_B_ID    = '10ada001-bbbb-4000-8000-000000000001'; // ativa, config propria
const STORE_C_ID    = '10ada001-cccc-4000-8000-000000000001'; // SEM nenhuma config -- prova o default seguro
// Personas de admin/cliente: `public.admins.user_id` tem FK p/ auth.users -- REUTILIZA as personas
// ficticias JA existentes em auth.users (mesmo padrao/IDs de scripts/saas01-onda4-2-fidelidade-test.mjs),
// nunca inventa UUID novo pra essas 2 (senao o INSERT em admins falha por violacao de FK).
const ADMIN_B       = 'ce7ece01-266c-42b1-a9db-8051da24d7f5'; // admin da loja B (mesma persona da Onda 4.2)
const ADMIN_ENCANTO_REGULAR = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // admin regular de encanto (idem)
const OUTSIDER_AUTH  = '27bd5049-60e5-4980-abe9-3bd7942a6c31'; // autenticado sem nenhum vinculo de admin (SAME_PERSON da Onda 4.2 -- so usado como JWT sub, nunca inserido em tabela com FK aqui)

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
// Sem troca de role -- usada pros cenarios de loyalty_grant puro (chamado DENTRO de create_order na
// vida real, como SECURITY DEFINER; aqui chamado direto, mesmo efeito de privilegio, sem depender da
// resolucao de loja por Origin HTTP que create_order faz para o caller anon -- fora do escopo desta
// Onda, ja coberta por REF-PROD-GOLIVE-01/REF-ORDER-TENANT-01).
async function txPlain(setupSql, fn) {
  try {
    await client.query('BEGIN');
    for (const s of (setupSql || [])) await client.query(s);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
async function inserirPedido(storeId, phone, nome) {
  const cust = await client.query(`INSERT INTO public.customers (name, phone, store_id) VALUES ($1,$2,$3) RETURNING id`, [nome, phone, storeId]);
  const ord = await client.query(`INSERT INTO public.orders (customer_id, total, status, payment_method, address, store_id) VALUES ($1,25,'recebido','dinheiro','Retirada na loja - teste',$2) RETURNING id`, [cust.rows[0].id, storeId]);
  return { customerId: cust.rows[0].id, orderId: ord.rows[0].id };
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
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-loyalty-audit-01', 'Loja B (fake, REF-LOYALTY-AUDIT-01)', NULL, 'ativo')`,
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_C_ID}', 'loja-c-loyalty-audit-01', 'Loja C sem config (fake, REF-LOYALTY-AUDIT-01)', NULL, 'ativo')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B}', '${STORE_B_ID}')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_ENCANTO_REGULAR}', '${encantoId}')`,
    // Loja B nasce ATIVA com config propria (5/30) -- diferente da Encanto (real, desativada).
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_B_ID}', 'loyalty_enabled', 'true')`,
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_B_ID}', 'loyalty_required', '5')`,
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_B_ID}', 'loyalty_discount', '30')`,
    // Loja C: propositalmente SEM nenhuma linha em store_settings -- prova o default seguro.
  ];
}

try {
  out('====================================================================');
  out(' SUITE — REF-LOYALTY-AUDIT-01 · Onda 1 (config de fidelidade por loja) — RELATORIO');
  out('====================================================================');
  out('Camada A: somente leitura. Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  const encantoId = (await client.query(`SELECT id FROM public.stores WHERE slug = 'encanto'`)).rows[0].id;
  out('— Loja encanto resolvida (fora de qualquer sessao simulada, como superuser): ' + encantoId + ' —');

  // Estado REAL da Encanto, capturado ANTES de qualquer transacao de teste — usado tanto pra provar
  // que a migration preservou o valor, quanto pra confirmar zero drift no final.
  const encantoConfigAntes = (await client.query(`SELECT chave, valor FROM public.store_settings WHERE store_id = $1 AND chave LIKE 'loyalty_%' ORDER BY chave`, [encantoId])).rows;
  const loyaltyAccountsCountAntes = (await client.query(`SELECT count(*)::int AS n FROM public.loyalty_accounts`)).rows[0].n;
  const loyaltyEventsCountAntes = (await client.query(`SELECT count(*)::int AS n FROM public.loyalty_events`)).rows[0].n;
  out('— Config real da Encanto (capturada agora): ' + JSON.stringify(encantoConfigAntes) + ' —');
  out('— loyalty_accounts real: ' + loyaltyAccountsCountAntes + ' contas · loyalty_events real: ' + loyaltyEventsCountAntes + ' eventos —');
  out('');

  // ---------------- Camada A: estrutural ----------------
  out('— A1: store_settings da Encanto tem exatamente as 3 chaves de fidelidade, migradas de settings —');
  {
    const chaves = encantoConfigAntes.map(r => r.chave).sort();
    const ok = JSON.stringify(chaves) === JSON.stringify(['loyalty_discount', 'loyalty_enabled', 'loyalty_required']);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A1 3 chaves presentes em store_settings`); out(`         -> ${JSON.stringify(encantoConfigAntes)}`);
  }
  out('');

  out('— A2: settings GLOBAL nao tem mais nenhuma das 3 chaves de fidelidade —');
  {
    const r = await client.query(`SELECT chave FROM public.settings WHERE chave IN ('loyalty_required','loyalty_discount','loyalty_enabled')`);
    const ok = r.rowCount === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A2 zero chaves de fidelidade em settings global`); out(`         -> rows=${r.rowCount}`);
  }
  out('');

  out('— A3: set_loyalty_config tem exatamente 1 overload, com p_store_id; get_loyalty_config existe, com p_store_id —');
  {
    const r = await client.query(`
      SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
      WHERE proname IN ('set_loyalty_config','get_loyalty_config') AND pronamespace='public'::regnamespace
      ORDER BY proname`);
    const byName = {};
    const counts = {};
    for (const row of r.rows) { counts[row.proname] = (counts[row.proname] || 0) + 1; byName[row.proname] = row.args; }
    const ok = counts.set_loyalty_config === 1 && counts.get_loyalty_config === 1
      && byName.set_loyalty_config.includes('p_store_id') && byName.get_loyalty_config.includes('p_store_id');
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A3 assinaturas corretas`); out(`         -> ${JSON.stringify(byName)}`);
  }
  out('');

  out('— A4: grants -- set_loyalty_config nega anon (licao da Onda 4.1: DROP+CREATE nao pode resetar ACL sem eu perceber); get_loyalty_config e publica —');
  {
    const r = await client.query(`
      SELECT p.proname,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_pode
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('set_loyalty_config','get_loyalty_config','loyalty_grant')
      ORDER BY p.proname`);
    const byName = Object.fromEntries(r.rows.map(x => [x.proname, x]));
    const ok = byName.set_loyalty_config.anon_pode === false && byName.set_loyalty_config.authenticated_pode === true
      && byName.get_loyalty_config.anon_pode === true && byName.get_loyalty_config.authenticated_pode === true
      && byName.loyalty_grant.anon_pode === false && byName.loyalty_grant.authenticated_pode === false;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A4 grants corretos`); out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  // ---------------- Camada B: comportamental ----------------

  out('— DEFAULT SEGURO: loja SEM nenhuma config propria (loja C) nasce DESATIVADA, nunca herda de outra loja —');
  await txPlain(setupSql(encantoId), async () => {
    await callRpc('DEFAULT-P1', 'get_loyalty_config(lojaC) retorna enabled=false, required=10, discount=50 (default seguro documentado)',
      `SELECT public.get_loyalty_config($1) AS r`, [STORE_C_ID],
      (row) => ({ ok: row?.r?.enabled === false && row?.r?.required === 10 && row?.r?.discount === 50, detail: JSON.stringify(row?.r) }));
    const { customerId, orderId } = await inserirPedido(STORE_C_ID, '47966670001', 'Cliente Loja C (fake onda1)');
    await callRpc('DEFAULT-P2', 'loyalty_grant() na loja C (nunca configurada) NAO concede selo -- default seguro, nunca herda de outra loja',
      `SELECT public.loyalty_grant($1,$2)`, [customerId, orderId],
      (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    await callRpc('DEFAULT-P3', 'zero evento earned para a loja C',
      `SELECT count(*)::int AS n FROM public.loyalty_events WHERE store_id = $1 AND tipo='earned'`, [STORE_C_ID],
      (row) => ({ ok: row?.n === 0, detail: 'earned count=' + row?.n }));
  });
  out('');

  out('— A) ENCANTO INATIVA: pedido elegivel na Encanto NAO gera contabilizacao quando enabled=false —');
  // loyalty_enabled da Encanto MUDA no mundo real (o dono opera o toggle em producao -- achado da
  // Onda 3, ver relatorio: nao era mais 'false' quando este teste rodou de novo). Forca 'false' SO
  // dentro desta transacao (ROLLBACK desfaz) pra este teste ser deterministico e nao quebrar toda vez
  // que o dono liga/desliga o programa de verdade -- mesmo padrao ja usado em
  // scripts/saas01-onda4-1-pedidos-test.mjs/saas01-onda4-2-fidelidade-test.mjs.
  await txPlain([`UPDATE public.store_settings SET valor='false' WHERE store_id='${encantoId}' AND chave='loyalty_enabled'`], async () => {
    const { customerId, orderId } = await inserirPedido(encantoId, '47966670002', 'Cliente Encanto Teste (fake onda1)');
    await callRpc('ENCANTO-INATIVA-P1', 'loyalty_grant() na Encanto (forcada enabled=false nesta tx) roda sem erro mas nao concede',
      `SELECT public.loyalty_grant($1,$2)`, [customerId, orderId],
      (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    await callRpc('ENCANTO-INATIVA-P2', 'zero evento earned para este pedido (programa desativado bloqueou a concessao automatica)',
      `SELECT count(*)::int AS n FROM public.loyalty_events WHERE order_id = $1 AND tipo='earned'`, [orderId],
      (row) => ({ ok: row?.n === 0, detail: 'earned count=' + row?.n }));
  });
  out('');

  out('— B) LOJA B ATIVA: pedido elegivel contabiliza normalmente com a config PROPRIA da loja (required=5) —');
  await txPlain(setupSql(encantoId), async () => {
    const { customerId, orderId } = await inserirPedido(STORE_B_ID, '47966670003', 'Cliente Loja B Teste (fake onda1)');
    await callRpc('LOJAB-ATIVA-P1', 'loyalty_grant() na loja B (enabled=true, config propria) concede 1 selo',
      `SELECT public.loyalty_grant($1,$2)`, [customerId, orderId],
      (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    await callRpc('LOJAB-ATIVA-P2', '1 evento earned criado, store_id=lojaB, stamps_after=1',
      `SELECT tipo, store_id, stamps_after FROM public.loyalty_events WHERE order_id = $1`, [orderId],
      (row) => ({ ok: row?.tipo === 'earned' && row?.store_id === STORE_B_ID && row?.stamps_after === 1, detail: JSON.stringify(row) }));
  });
  out('');

  out('— C/D) Alterar a config da loja B nao muda a Encanto (leitura real, fora de qualquer simulacao) —');
  {
    const antes = (await client.query(`SELECT valor FROM public.store_settings WHERE store_id = $1 AND chave = 'loyalty_enabled'`, [encantoId])).rows[0]?.valor;
    // ISOLADO em BEGIN...ROLLBACK: altera a config da loja B como ADMIN_B, desfaz ao final.
    await tx('authenticated', ADMIN_B, setupSql(encantoId), async () => {
      await callRpc('CONFIGB-P1', 'ADMIN_B altera a config da loja B (required=7,discount=99,enabled=false)',
        `SELECT public.set_loyalty_config($1,$2,$3,$4) AS r`, [7, 99, false, STORE_B_ID],
        (row) => ({ ok: row?.r?.ok === true, detail: JSON.stringify(row?.r) }));
    });
    // Confirma FORA da transacao/role simulada (store_settings tem RLS trancada sem policy -- so o
    // superuser/conexao base ou uma RPC SECURITY DEFINER enxergam a linha).
    const depois = (await client.query(`SELECT valor FROM public.store_settings WHERE store_id = $1 AND chave = 'loyalty_enabled'`, [encantoId])).rows[0]?.valor;
    const ok = antes === depois;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] D Encanto real inalterada apos ADMIN_B configurar a loja B e a transacao ser desfeita (antes=${antes}, depois=${depois})`);
  }
  out('');

  out('— E) Tentativa DIRETA de loyalty_grant pelo backend publico (anon) -- bloqueada por grant, nao so por regra de negocio —');
  await tx('anon', null, setupSql(encantoId), async () => {
    await callRpc('DIRETO-N1', 'anon NAO consegue chamar loyalty_grant() diretamente (EXECUTE revogado)',
      `SELECT public.loyalty_grant($1, $2)`, [null, null],
      (row, err) => ({ ok: err !== null && /permission denied/i.test(err || ''), detail: err || 'nao foi negado' }));
  });
  out('');

  out('— F/G) Isolamento cross-tenant na ESCRITA da config -- nenhum admin configura loja alheia, nos 2 sentidos —');
  await tx('authenticated', ADMIN_B, setupSql(encantoId), async () => {
    await callRpc('CROSS-N1', 'ADMIN_B (loja B) NAO consegue configurar a Encanto',
      `SELECT public.set_loyalty_config($1,$2,$3,$4) AS r`, [1, 1, true, encantoId],
      (row) => ({ ok: row?.r?.ok === false && row?.r?.error === 'sem permissao', detail: JSON.stringify(row?.r) }));
  });
  await tx('authenticated', ADMIN_ENCANTO_REGULAR, setupSql(encantoId), async () => {
    await callRpc('CROSS-N2', 'admin regular de Encanto NAO consegue configurar a loja B',
      `SELECT public.set_loyalty_config($1,$2,$3,$4) AS r`, [1, 1, true, STORE_B_ID],
      (row) => ({ ok: row?.r?.ok === false && row?.r?.error === 'sem permissao', detail: JSON.stringify(row?.r) }));
  });
  await tx('authenticated', OUTSIDER_AUTH, setupSql(encantoId), async () => {
    await callRpc('CROSS-N3', 'usuario autenticado sem NENHUM vinculo de admin nao configura loja nenhuma (encanto)',
      `SELECT public.set_loyalty_config($1,$2,$3,$4) AS r`, [1, 1, true, encantoId],
      (row) => ({ ok: row?.r?.ok === false && row?.r?.error === 'sem permissao', detail: JSON.stringify(row?.r) }));
  });
  out('');

  out('— H) REATIVACAO na loja B: desativa -> pedido nao conta; reativa -> novo pedido volta a contar —');
  await txPlain(setupSql(encantoId), async () => {
    await client.query(`UPDATE public.store_settings SET valor='false' WHERE store_id=$1 AND chave='loyalty_enabled'`, [STORE_B_ID]);
    const p1 = await inserirPedido(STORE_B_ID, '47966670004', 'Cliente Reativa 1 (fake onda1)');
    await callRpc('REATIVA-P1', 'loyalty_grant() na loja B DESATIVADA roda sem erro',
      `SELECT public.loyalty_grant($1,$2)`, [p1.customerId, p1.orderId],
      (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    await callRpc('REATIVA-P2', 'zero earned para este pedido (desativado)',
      `SELECT count(*)::int AS n FROM public.loyalty_events WHERE order_id = $1 AND tipo='earned'`, [p1.orderId],
      (row) => ({ ok: row?.n === 0, detail: 'earned count=' + row?.n }));

    await client.query(`UPDATE public.store_settings SET valor='true' WHERE store_id=$1 AND chave='loyalty_enabled'`, [STORE_B_ID]);
    const p2 = await inserirPedido(STORE_B_ID, '47966670005', 'Cliente Reativa 2 (fake onda1)');
    await callRpc('REATIVA-P3', 'apos reativar, loyalty_grant() num NOVO pedido volta a conceder',
      `SELECT public.loyalty_grant($1,$2)`, [p2.customerId, p2.orderId],
      (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    await callRpc('REATIVA-P4', '1 evento earned para este novo pedido',
      `SELECT count(*)::int AS n FROM public.loyalty_events WHERE order_id = $1 AND tipo='earned'`, [p2.orderId],
      (row) => ({ ok: row?.n === 1, detail: 'earned count=' + row?.n }));
  });
  out('');

  out('— J) IDEMPOTENCIA preservada: loyalty_grant() chamado 2x pro MESMO pedido -> so 1 selo —');
  await txPlain(setupSql(encantoId), async () => {
    const { customerId, orderId } = await inserirPedido(STORE_B_ID, '47966670006', 'Cliente Idemp (fake onda1)');
    await callRpc('IDEMP-P1', '1a chamada concede o selo',
      `SELECT public.loyalty_grant($1,$2)`, [customerId, orderId],
      (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    await callRpc('IDEMP-P2', '2a chamada, MESMO order_id -- backstop de idempotencia (soft-check + indice unico) impede duplicar',
      `SELECT public.loyalty_grant($1,$2)`, [customerId, orderId],
      (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    await callRpc('IDEMP-P3', 'apenas 1 evento earned existe para este pedido (sem duplicidade)',
      `SELECT count(*)::int AS n FROM public.loyalty_events WHERE order_id = $1 AND tipo='earned'`, [orderId],
      (row) => ({ ok: row?.n === 1, detail: 'earned count=' + row?.n }));
  });
  out('');

  out('— K) CANCELAMENTO/REVERSAO preservada na loja B (trigger usa o `required` por-loja no teto da reativacao) —');
  await txPlain(setupSql(encantoId), async () => {
    const { customerId, orderId } = await inserirPedido(STORE_B_ID, '47966670007', 'Cliente Cancela (fake onda1)');
    await callRpc('CANCEL-P1', 'concede o selo elegivel na loja B',
      `SELECT public.loyalty_grant($1,$2)`, [customerId, orderId],
      (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    await client.query(`UPDATE public.orders SET status='cancelado' WHERE id = $1`, [orderId]);
    await callRpc('CANCEL-P2', 'trigger reverte a contribuicao (evento revoked criado, stamps liquidos = 0)',
      `SELECT coalesce(sum(delta),0)::int AS liquido FROM public.loyalty_events WHERE order_id = $1 AND origem IN ('create_order','cancel_trigger')`, [orderId],
      (row) => ({ ok: row?.liquido === 0, detail: 'liquido=' + row?.liquido }));
    await client.query(`UPDATE public.orders SET status='recebido' WHERE id = $1`, [orderId]);
    await callRpc('CANCEL-P3', 'reabrir restaura 1 selo (adjustment), respeitando o teto por-loja (required=5)',
      `SELECT coalesce(sum(delta),0)::int AS liquido FROM public.loyalty_events WHERE order_id = $1 AND origem IN ('create_order','cancel_trigger')`, [orderId],
      (row) => ({ ok: row?.liquido === 1, detail: 'liquido=' + row?.liquido }));
  });
  out('');

  out('— I) HISTORICO/REGRESSAO: zero mutacao liquida em producao apos toda a suite (fora de qualquer transacao de teste) —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE id IN ('${STORE_B_ID}','${STORE_C_ID}')) AS lojas_fake,
        (SELECT count(*)::int FROM public.admins WHERE store_id IN ('${STORE_B_ID}','${STORE_C_ID}')) AS admins_fake,
        (SELECT count(*)::int FROM public.store_settings WHERE store_id IN ('${STORE_B_ID}','${STORE_C_ID}')) AS settings_fake,
        (SELECT count(*)::int FROM public.loyalty_accounts) AS loyalty_accounts_agora,
        (SELECT count(*)::int FROM public.loyalty_events) AS loyalty_events_agora`);
    const row = r.rows[0];
    const configDepois = (await client.query(`SELECT chave, valor FROM public.store_settings WHERE store_id = $1 AND chave LIKE 'loyalty_%' ORDER BY chave`, [encantoId])).rows;
    const configIgual = JSON.stringify(configDepois) === JSON.stringify(encantoConfigAntes);
    const ok = row.lojas_fake === 0 && row.admins_fake === 0 && row.settings_fake === 0
      && row.loyalty_accounts_agora === loyaltyAccountsCountAntes && row.loyalty_events_agora === loyaltyEventsCountAntes
      && configIgual;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] I zero mutacao liquida + historico real intacto`);
    out(`         -> ${JSON.stringify(row)} · config_encanto_igual=${configIgual}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-LOYALTY-AUDIT-01 · Onda 1)');
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
