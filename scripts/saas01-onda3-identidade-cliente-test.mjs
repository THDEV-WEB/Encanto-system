// Suite de verificacao da REF-SAAS-01 · Onda 3 (identidade do cliente por loja) — "Testes da fase".
// Mesmo rigor exigido pelo dono na Onda 2, mantido explicitamente para esta onda: teste positivo E
// negativo para cada regra de unicidade nova, isolamento entre lojas provado por comportamento (nunca
// por inspecao), e regressao real contra o fluxo de checkout de producao (create_order).
//
// A prova central desta onda: a MESMA pessoa (mesmo auth.uid()) precisa conseguir ter um `customers`
// na loja encanto E outro na loja B simultaneamente — cenario que a unique global antiga
// (`customers_auth_user_id_key`) tornava fisicamente impossivel. Isso e testado de verdade, inserindo
// as duas linhas e provando que RLS/RPC as tratam como entidades distintas.
//
// Camada A: estrutural. Camada B: comportamental — SET LOCAL ROLE + request.jwt.claims dentro de
// BEGIN...ROLLBACK (mesmo padrao das Ondas 0/1/2). Loja B, seus clientes e seu admin sao ficticios,
// inseridos no inicio da transacao e desfeitos pelo ROLLBACK — nunca persistem. Exit 0 = SUCCESS.
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

// Personas reais (auth.users existentes — satisfazem FKs sem inventar id).
const ADMIN_REAL_USER_ID = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // admin real de producao (loja encanto)
const ADMIN_B            = 'ce7ece01-266c-42b1-a9db-8051da24d7f5'; // vira admin da loja B FICTICIA (so dentro da tx)
const SAME_PERSON        = '27bd5049-60e5-4980-abe9-3bd7942a6c31'; // "a mesma pessoa" -- cliente em encanto E em loja B
const STRANGER           = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // autenticado, ZERO customer em qualquer loja

const STORE_B_ID          = 'cccccccc-bbbb-4000-8000-000000000001';
const CUSTOMER_ENCANTO_ID = 'cccccccc-1111-4000-8000-00000000000a';
const CUSTOMER_B_ID       = 'cccccccc-1111-4000-8000-00000000000b';
// Clientes SEM vinculo (auth_user_id NULL) -- dedicados aos testes de admin_link_customer_to_auth, que
// so tem como "vincular com sucesso" um cliente ainda nao vinculado (o mesmo guard que a funcao ja
// aplicava antes desta onda: "cliente ja vinculado a outra conta").
const CUSTOMER_ENCANTO_UNLINKED_ID = 'cccccccc-2222-4000-8000-00000000000a';
const CUSTOMER_B_UNLINKED_ID       = 'cccccccc-2222-4000-8000-00000000000b';
const PHONE_X   = '47999990001'; // mesmo telefone usado nas DUAS lojas (prova central)
const EMAIL_X   = 'pessoa.x.onda3@example.com'; // mesmo e-mail usado nas DUAS lojas
const PHONE_X2  = '47999990002'; // usado no re-link (case "atualizado") da mesma pessoa em encanto
const PHONE_NEW = '47999990003'; // usado pelo STRANGER (case "criado")

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
// Mesmo padrao de tx(), mas SEM trocar de role -- fica como superuser (bypassa RLS de proposito).
// Usado quando o que se quer provar e um FATO cru dos dados (ex.: quantas linhas existem), nao o
// resultado filtrado por policy -- rodar isso dentro de um SET LOCAL ROLE daria um falso-negativo,
// pois a RLS do proprio papel simulado filtraria a resposta antes de eu conseguir inspecionar o fato.
async function txSuper(setupSql, fn) {
  try {
    await client.query('BEGIN');
    for (const s of (setupSql || [])) await client.query(s);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
async function expectRows(id, desc, sql, params, expected) {
  const r = await client.query(sql, params);
  const ok = r.rowCount === expected;
  record(id, desc, ok ? 'PASS' : 'FAIL', `rows=${r.rowCount} (esperado ${expected})`);
}
// Envolve toda tentativa que pode lancar erro real do Postgres (unique_violation, RLS CHECK, FK) em
// SAVEPOINT — sem isso, uma negacao esperada envenenaria o resto da transacao simulada (achado da
// Onda 2, mesmo cuidado replicado aqui).
async function attempt(id, desc, sql, params, allow) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let rowCount = null, errMsg = null, rows = null;
  try {
    const r = await client.query(sql, params);
    rowCount = r.rowCount; rows = r.rows;
    await client.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (e) {
    errMsg = redact(e.message).split('\n')[0];
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
  }
  const ok = allow ? (errMsg === null && rowCount >= 1) : (errMsg !== null || rowCount === 0);
  record(id, desc, ok ? 'PASS' : 'FAIL', errMsg ? `negado por erro: ${errMsg}` : `linhas afetadas=${rowCount}`);
  return { rowCount, errMsg, rows };
}
async function callRpc(id, desc, sql, params, checkFn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let result = null, errMsg = null;
  try {
    const r = await client.query(sql, params);
    result = r.rows[0];
    await client.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (e) {
    errMsg = redact(e.message).split('\n')[0];
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
  }
  const { ok, detail } = checkFn(result, errMsg);
  record(id, desc, ok ? 'PASS' : 'FAIL', detail);
  return result;
}

function setupSql(encantoId) {
  return [
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-teste-onda3', 'Loja B (fake, teste Onda 3)', NULL, 'ativo')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B}', '${STORE_B_ID}')`,
    // PROVA CENTRAL: mesma pessoa (SAME_PERSON), mesmo telefone, mesmo e-mail -- um customer em CADA
    // loja. So e possivel por causa da unique composta (store_id, auth_user_id)/(store_id, phone)/
    // (store_id, lower(email)) desta onda -- antes, a 2a linha nem existiria (unique global).
    `INSERT INTO public.customers (id, name, phone, email, auth_user_id, store_id) VALUES ('${CUSTOMER_ENCANTO_ID}', 'Pessoa X (fake onda3)', '${PHONE_X}', '${EMAIL_X}', '${SAME_PERSON}', '${encantoId}')`,
    `INSERT INTO public.customers (id, name, phone, email, auth_user_id, store_id) VALUES ('${CUSTOMER_B_ID}', 'Pessoa X (fake onda3, loja B)', '${PHONE_X}', '${EMAIL_X}', '${SAME_PERSON}', '${STORE_B_ID}')`,
    `INSERT INTO public.customers (id, name, phone, store_id) VALUES ('${CUSTOMER_ENCANTO_UNLINKED_ID}', 'Convidado Sem Vinculo (encanto)', '47999990004', '${encantoId}')`,
    `INSERT INTO public.customers (id, name, phone, store_id) VALUES ('${CUSTOMER_B_UNLINKED_ID}', 'Convidado Sem Vinculo (loja B)', '47999990005', '${STORE_B_ID}')`,
  ];
}
const SUPER_ADMIN_SETUP = `INSERT INTO public.super_admins (user_id) VALUES ('${ADMIN_REAL_USER_ID}')`;

try {
  out('==================================================================');
  out(' SUITE DE IDENTIDADE — REF-SAAS-01 · Onda 3 (cliente por loja) — RELATORIO');
  out('==================================================================');
  out('Camada A: somente leitura. Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('Prova central: a MESMA pessoa (mesmo auth.uid()) tem um customer em CADA loja, sem colisao.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  const encantoId = (await client.query(`SELECT id FROM public.stores WHERE slug = 'encanto'`)).rows[0].id;
  out('— Loja encanto resolvida (fora de qualquer sessao simulada, como superuser): ' + encantoId + ' —');
  out('');

  // ---------------- Camada A: estrutural ----------------
  out('— A1: customers.store_id agora NOT NULL —');
  {
    const r = await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='store_id'`);
    const ok = r.rowCount === 1 && r.rows[0].is_nullable === 'NO';
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A1 store_id NOT NULL`); out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— A2: os 3 indices unicos viraram compostos com store_id lider; os 3 globais antigos sumiram —');
  {
    const r = await client.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='customers' AND indexname LIKE '%uniq%' OR (schemaname='public' AND tablename='customers' AND indexname LIKE '%_key')`);
    const novos = ['customers_store_phone_uniq', 'customers_store_email_key', 'customers_store_auth_user_id_key'];
    const antigos = ['customers_phone_uniq', 'customers_email_key', 'customers_auth_user_id_key'];
    const novosPresentes = novos.every(n => r.rows.some(x => x.indexname === n && x.indexdef.includes('store_id')));
    const antigosSumiram = !r.rows.some(x => antigos.includes(x.indexname));
    const ok = novosPresentes && antigosSumiram;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A2 indices unicos migrados`); out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— A3: create_order/link_customer_to_auth/admin_link_customer_to_auth citam store_id/is_admin_of no codigo real —');
  {
    const r = await client.query(`SELECT proname, prosrc FROM pg_proc WHERE proname IN ('create_order','link_customer_to_auth','admin_link_customer_to_auth') AND pronamespace='public'::regnamespace`);
    const co = r.rows.find(x => x.proname === 'create_order');
    const lc = r.rows.find(x => x.proname === 'link_customer_to_auth');
    const al = r.rows.find(x => x.proname === 'admin_link_customer_to_auth');
    const okCo = co && co.prosrc.includes('store_id') && co.prosrc.includes('on conflict (store_id, phone)');
    const okLc = lc && lc.prosrc.includes('p_store_id') && lc.prosrc.includes('store_id = v_store');
    const okAl = al && al.prosrc.includes('is_admin_of');
    const ok = Boolean(okCo && okLc && okAl);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A3 as 3 funcoes atualizadas`); out(`         -> create_order=${okCo} · link_customer_to_auth=${okLc} · admin_link_customer_to_auth=${okAl}`);
  }
  out('');

  out('— A4: policies de customers citam o predicado certo (is_admin_of / auth_user_id) —');
  {
    // REF-SAAS-01 · Onda 6.1: a ancora "AND store_id = default_store_id()" da policy "Cliente le
    // proprio customer" (introduzida aqui na Onda 3) foi REMOVIDA de proposito -- agora que o
    // frontend (AuthService.getMeuCustomer) passa store_id explicito na propria query, a RLS nao
    // precisa mais restringir a leitura a loja padrao (o que tornava o proprio perfil invisivel pra
    // quem so existe numa loja nao-padrao). Ver docs/ref/REF-SAAS-01-plano-ondas.md secao "Onda 6".
    const r = await client.query(`SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr FROM pg_policy WHERE polrelid = 'public.customers'::regclass`);
    const adminPol = r.rows.find(x => x.polname === 'Admin all customers');
    const clientePol = r.rows.find(x => x.polname === 'Cliente le proprio customer');
    const okAdmin = adminPol && adminPol.using_expr.includes('is_admin_of');
    const okCliente = clientePol && clientePol.using_expr.includes('auth_user_id') && !clientePol.using_expr.includes('default_store_id');
    const ok = Boolean(okAdmin && okCliente);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A4 policies atualizadas (ancora da Onda 3 removida na Onda 6.1)`); out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  // ---------------- Camada B: comportamental ----------------
  out('— Bateria comportamental —');

  out('— B1: mesma pessoa (mesmo auth_user_id) TEM customer em encanto E em loja B simultaneamente (prova central) —');
  // Roda como SUPERUSER (txSuper, sem SET LOCAL ROLE) de proposito: isto prova um FATO cru dos dados
  // (quantas linhas existem), nao um resultado ja filtrado por RLS -- se rodasse como admin real
  // (is_admin_of(storeB)=false), a policy filtraria a linha da loja B e o teste daria falso-negativo.
  await txSuper(setupSql(encantoId), async () => {
    const r = await client.query(`SELECT store_id FROM public.customers WHERE auth_user_id = $1 ORDER BY store_id`, [SAME_PERSON]);
    const ok = r.rowCount === 2 && r.rows.some(x => x.store_id === encantoId) && r.rows.some(x => x.store_id === STORE_B_ID);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] B1 mesma pessoa tem 2 customers, um por loja`); out(`         -> ${JSON.stringify(r.rows)}`);
  });
  out('');

  out('— N1/N2/N3: dentro da MESMA loja (encanto), telefone/e-mail/auth_user_id duplicados continuam barrados —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(encantoId), async () => {
    await attempt('N1', 'duplicar telefone dentro da mesma loja -> negado (unique store_id+phone)',
      `INSERT INTO public.customers (name, phone, email, store_id) VALUES ('Duplicado Telefone', '${PHONE_X}', 'outro@example.com', '${encantoId}')`, [], false);
    await attempt('N2', 'duplicar e-mail dentro da mesma loja -> negado (unique store_id+lower(email))',
      `INSERT INTO public.customers (name, phone, email, store_id) VALUES ('Duplicado Email', '47900000099', '${EMAIL_X}', '${encantoId}')`, [], false);
    await attempt('N3', 'duplicar auth_user_id dentro da mesma loja -> negado (unique store_id+auth_user_id)',
      `INSERT INTO public.customers (name, phone, auth_user_id, store_id) VALUES ('Duplicado AuthUser', '47900000098', '${SAME_PERSON}', '${encantoId}')`, [], false);
  });
  out('');

  out('— Sessao: a mesma pessoa (SAME_PERSON), fluxo real do AuthService.js (REF-SAAS-01 · Onda 6.1: getMeuCustomer AGORA informa store_id explicito, resolvido por dominio) —');
  await tx('authenticated', SAME_PERSON, setupSql(encantoId), async () => {
    await expectRows('SEL-P1', 'consulta real (.eq(auth_user_id).eq(store_id=encanto).limit(1)) ve o customer de ENCANTO', `SELECT 1 FROM public.customers WHERE auth_user_id = $1 AND store_id = $2 AND id = $3`, [SAME_PERSON, encantoId, CUSTOMER_ENCANTO_ID], 1);
    await expectRows('SEL-N1', 'com store_id=lojaB explicito, a MESMA pessoa ve o customer da loja B (Onda 6.1: ancora removida -- quem escopa agora e a query, nao mais a RLS)', `SELECT 1 FROM public.customers WHERE auth_user_id = $1 AND store_id = $2 AND id = $3`, [SAME_PERSON, STORE_B_ID, CUSTOMER_B_ID], 1);
    await expectRows('SEL-N1b', 'SEM store_id explicito, a mesma pessoa veria os 2 customers (prova de que a query DEVE filtrar -- exatamente o achado que motivou a Onda 6.1)', `SELECT 1 FROM public.customers WHERE auth_user_id = $1 AND id = ANY($2)`, [SAME_PERSON, [CUSTOMER_ENCANTO_ID, CUSTOMER_B_ID]], 2);
    await callRpc('RPC-P1', 'link_customer_to_auth SEM p_store_id (like AuthService.js real) atualiza o customer de ENCANTO (regressao)',
      `SELECT public.link_customer_to_auth($1, NULL, NULL) AS r`, [PHONE_X2],
      (row) => {
        const r = row?.r;
        const ok = r?.ok === true && r?.customer_id === CUSTOMER_ENCANTO_ID && r?.status === 'atualizado';
        return { ok, detail: JSON.stringify(r) };
      });
    await callRpc('RPC-P2', 'link_customer_to_auth COM p_store_id=lojaB atualiza o customer da LOJA B (isolamento, mesma pessoa)',
      `SELECT public.link_customer_to_auth($1, NULL, NULL, $2) AS r`, [PHONE_X2, STORE_B_ID],
      (row) => {
        const r = row?.r;
        const ok = r?.ok === true && r?.customer_id === CUSTOMER_B_ID && r?.status === 'atualizado';
        return { ok, detail: JSON.stringify(r) };
      });
  });
  out('');

  out('— Sessao: cliente autenticado SEM nenhum customer em lugar nenhum (stranger) —');
  await tx('authenticated', STRANGER, setupSql(encantoId), async () => {
    await expectRows('SEL-stranger', 'stranger nao ve customer alheio (encanto)', `SELECT 1 FROM public.customers WHERE id = $1`, [CUSTOMER_ENCANTO_ID], 0);
    await attempt('UPD-N-stranger', 'stranger nao consegue atualizar customer alheio (nao e admin)', `UPDATE public.customers SET name = 'x' WHERE id = $1`, [CUSTOMER_ENCANTO_ID], false);
    await callRpc('RPC-criado', 'link_customer_to_auth cria NOVO customer (case c) para quem nao tinha nenhum, escopado na loja padrao (DEFAULT)',
      `SELECT public.link_customer_to_auth($1, NULL, 'Stranger Onda3') AS r`, [PHONE_NEW],
      (row) => { const r = row?.r; return { ok: r?.ok === true && r?.status === 'criado', detail: JSON.stringify(r) }; });
  });
  out('');

  out('— Sessao: anon (sem autenticacao nenhuma) —');
  await tx('anon', null, setupSql(encantoId), async () => {
    // customers NAO tem grant nenhum pra `anon` (diferente do catalogo, que e publico de proposito) --
    // a negacao aqui acontece na camada de GRANT, antes mesmo da RLS ser avaliada (erro real do
    // Postgres, "permission denied for table"), por isso usa attempt() (com SAVEPOINT) e nao
    // expectRows() (que nao esperava erro nenhum).
    await attempt('SEL-anon', 'anon NAO consegue nem ler customers -- sem leitura publica (diferente do catalogo)', `SELECT 1 FROM public.customers WHERE id = $1`, [CUSTOMER_ENCANTO_ID], false);
    await attempt('UPD-N-anon', 'anon nao consegue atualizar customer', `UPDATE public.customers SET name = 'x' WHERE id = $1`, [CUSTOMER_ENCANTO_ID], false);
    await attempt('DEL-N-anon', 'anon nao consegue excluir customer', `DELETE FROM public.customers WHERE id = $1`, [CUSTOMER_ENCANTO_ID], false);
    await callRpc('RPC-anon-negado', 'link_customer_to_auth chamado por anon retorna nao-autenticado (auth.uid() nulo)',
      `SELECT public.link_customer_to_auth($1, NULL, NULL) AS r`, [PHONE_NEW],
      (row) => { const r = row?.r; return { ok: r?.ok === false && r?.error === 'nao autenticado', detail: JSON.stringify(r) }; });
  });
  out('');

  out('— Sessao: admin real (encanto) —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(encantoId), async () => {
    await expectRows('SEL-adminA-P', 'admin real ve customer de encanto (regressao)', `SELECT 1 FROM public.customers WHERE id = $1`, [CUSTOMER_ENCANTO_ID], 1);
    await expectRows('SEL-adminA-N', 'admin real NAO ve customer da loja B (isolamento)', `SELECT 1 FROM public.customers WHERE id = $1`, [CUSTOMER_B_ID], 0);
    await attempt('UPD-adminA-P', 'admin real atualiza customer de encanto (regressao)', `UPDATE public.customers SET name = 'Pessoa X Editada' WHERE id = $1`, [CUSTOMER_ENCANTO_ID], true);
    await attempt('UPD-adminA-N', 'admin real NAO consegue atualizar customer da loja B (isolamento)', `UPDATE public.customers SET name = 'Invasao' WHERE id = $1`, [CUSTOMER_B_ID], false);
    await callRpc('ADMLINK-P', 'admin_link_customer_to_auth permite vincular customer SEM VINCULO da PROPRIA loja (encanto)',
      `SELECT public.admin_link_customer_to_auth($1, $2) AS r`, [CUSTOMER_ENCANTO_UNLINKED_ID, STRANGER],
      (row) => { const r = row?.r; return { ok: r?.ok === true, detail: JSON.stringify(r) }; });
    await callRpc('ADMLINK-N', 'admin_link_customer_to_auth NEGA vincular customer da loja B (isolamento)',
      `SELECT public.admin_link_customer_to_auth($1, $2) AS r`, [CUSTOMER_B_ID, STRANGER],
      (row) => { const r = row?.r; return { ok: r?.ok === false && r?.error === 'sem permissao', detail: JSON.stringify(r) }; });
  });
  out('');

  out('— Sessao: admin ficticio da loja B —');
  await tx('authenticated', ADMIN_B, setupSql(encantoId), async () => {
    await expectRows('SEL-adminB-P', 'admin B ve customer da propria loja', `SELECT 1 FROM public.customers WHERE id = $1`, [CUSTOMER_B_ID], 1);
    await expectRows('SEL-adminB-N', 'admin B NAO ve customer de encanto -- diferente do catalogo, aqui nao ha leitura publica nenhuma', `SELECT 1 FROM public.customers WHERE id = $1`, [CUSTOMER_ENCANTO_ID], 0);
    await attempt('UPD-adminB-P', 'admin B atualiza customer da propria loja', `UPDATE public.customers SET name = 'Pessoa X (loja B) Editada' WHERE id = $1`, [CUSTOMER_B_ID], true);
    await attempt('UPD-adminB-N', 'admin B NAO consegue atualizar customer de encanto (isolamento)', `UPDATE public.customers SET name = 'Invasao' WHERE id = $1`, [CUSTOMER_ENCANTO_ID], false);
    await callRpc('ADMLINK-B-P', 'admin_link_customer_to_auth permite vincular customer SEM VINCULO da PROPRIA loja (B)',
      `SELECT public.admin_link_customer_to_auth($1, $2) AS r`, [CUSTOMER_B_UNLINKED_ID, STRANGER],
      (row) => { const r = row?.r; return { ok: r?.ok === true, detail: JSON.stringify(r) }; });
  });
  out('');

  out('— Sessao: super admin ficticio (composicao is_super_admin() OR ... atraves das policies de customers) —');
  await tx('authenticated', ADMIN_REAL_USER_ID, [...setupSql(encantoId), SUPER_ADMIN_SETUP], async () => {
    await expectRows('SEL-super', 'super admin ve customer da loja B mesmo SEM linha em admins para aquela loja', `SELECT 1 FROM public.customers WHERE id = $1`, [CUSTOMER_B_ID], 1);
    await attempt('UPD-super', 'super admin atualiza customer da loja B', `UPDATE public.customers SET name = 'Editado pelo SuperAdmin' WHERE id = $1`, [CUSTOMER_B_ID], true);
    await callRpc('ADMLINK-super', 'admin_link_customer_to_auth permite ao super admin vincular customer SEM VINCULO de qualquer loja',
      `SELECT public.admin_link_customer_to_auth($1, $2) AS r`, [CUSTOMER_B_UNLINKED_ID, STRANGER],
      (row) => { const r = row?.r; return { ok: r?.ok === true, detail: JSON.stringify(r) }; });
  });
  out('');

  // ---------------- Regressao real com create_order (fluxo real de checkout) ----------------
  out('— REGRESSAO-01: create_order (anon, como o checkout real) cria cliente novo com store_id=encanto — prova que o fix do ON CONFLICT nao quebrou o checkout —');
  await tx('anon', null, [], async () => {
    const payload = {
      p_customer: { name: 'Cliente Regressao Onda3', phone: '47988887777' },
      p_order: { total: 42.5, payment_method: 'pix', address: 'Rua Teste, 123' },
      p_items: [{ nome_produto: 'Item Teste Onda3', quantity: 1, price: 42.5 }],
    };
    const r = await client.query(`SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb) AS r`, [JSON.stringify(payload.p_customer), JSON.stringify(payload.p_order), JSON.stringify(payload.p_items)]);
    const res = r.rows[0].r;
    // create_order roda SECURITY DEFINER (privilegios do dono da funcao), mas esta query de
    // VERIFICACAO aqui embaixo e nossa, direta -- ainda estamos com SET LOCAL ROLE anon ativo (mesmo
    // papel usado pra chamar a RPC, simulando o checkout real), e anon nao tem grant nenhum em
    // `customers` (mesmo achado da sessao anon acima). RESET ROLE volta a superuser so pra inspecionar
    // o resultado, sem afetar o que ja foi provado (a RPC funcionou como anon de verdade).
    await client.query('RESET ROLE');
    let storeOk = false, cust = null;
    if (res?.ok) {
      const c = await client.query(`SELECT store_id FROM public.customers WHERE phone = '47988887777'`);
      cust = c.rows[0]; storeOk = cust?.store_id === encantoId;
    }
    const ok = res?.ok === true && storeOk;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO-01 create_order cria cliente com store_id correto`); out(`         -> resultado=${JSON.stringify(res)} · customer=${JSON.stringify(cust)}`);
  });
  out('');

  out('— REGRESSAO-02: create_order chamado DE NOVO com o MESMO telefone aciona o ramo ON CONFLICT DO UPDATE (nao so o INSERT) —');
  await tx('anon', null, [], async () => {
    const payload1 = {
      p_customer: { name: 'Cliente Regressao Onda3 v1', phone: '47977776666' },
      p_order: { total: 10, payment_method: 'pix', address: 'Rua Teste, 1' },
      p_items: [{ nome_produto: 'Item A', quantity: 1, price: 10 }],
    };
    await client.query(`SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb) AS r`, [JSON.stringify(payload1.p_customer), JSON.stringify(payload1.p_order), JSON.stringify(payload1.p_items)]);
    const payload2 = {
      p_customer: { name: 'Cliente Regressao Onda3 v2 (nome atualizado)', phone: '47977776666' },
      p_order: { total: 20, payment_method: 'pix', address: 'Rua Teste, 2' },
      p_items: [{ nome_produto: 'Item B', quantity: 1, price: 20 }],
    };
    const r2 = await client.query(`SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb) AS r`, [JSON.stringify(payload2.p_customer), JSON.stringify(payload2.p_order), JSON.stringify(payload2.p_items)]);
    const res2 = r2.rows[0].r;
    await client.query('RESET ROLE'); // mesmo motivo do REGRESSAO-01: verificacao nossa, nao da RPC
    let nomeAtualizado = false, umUnicoCliente = false;
    if (res2?.ok) {
      const c = await client.query(`SELECT count(*)::int AS n, max(name) AS name FROM public.customers WHERE phone = '47977776666'`);
      umUnicoCliente = c.rows[0].n === 1;
      nomeAtualizado = c.rows[0].name === payload2.p_customer.name;
    }
    const ok = res2?.ok === true && umUnicoCliente && nomeAtualizado;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO-02 ON CONFLICT DO UPDATE funciona (1 cliente so, nome atualizado)`); out(`         -> resultado=${JSON.stringify(res2)} · umUnicoCliente=${umUnicoCliente} · nomeAtualizado=${nomeAtualizado}`);
  });
  out('');

  out('— REGRESSAO-03: apos toda a suite, nenhuma linha ficticia (loja B, admin B, customers, super admin, clientes de regressao) ficou persistida em producao —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE id = '${STORE_B_ID}') AS loja_b,
        (SELECT count(*)::int FROM public.admins WHERE store_id = '${STORE_B_ID}') AS admin_b,
        (SELECT count(*)::int FROM public.super_admins WHERE user_id = '${ADMIN_REAL_USER_ID}') AS super_admin,
        (SELECT count(*)::int FROM public.customers WHERE id IN ('${CUSTOMER_ENCANTO_ID}','${CUSTOMER_B_ID}')) AS customers_fake,
        (SELECT count(*)::int FROM public.customers WHERE phone IN ('47988887777','47977776666','${PHONE_NEW}')) AS customers_regressao`);
    const row = r.rows[0];
    const ok = Object.values(row).every(n => n === 0);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO-03 zero mutacao liquida em producao`); out(`         -> ${JSON.stringify(row)}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 3)');
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
