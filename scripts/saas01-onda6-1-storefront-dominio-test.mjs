// Suite de verificacao da REF-SAAS-01 · Onda 6.1 (resolucao de loja no storefront por dominio).
// Mesmo rigor das ondas anteriores: teste positivo E negativo, prova de isolamento entre lojas
// fictícias (nunca persistidas — BEGIN...ROLLBACK), regressao contra o Cliente Zero real.
//
// Exigencia central desta subfase: get_store_by_domain() SEMPRE devolve exatamente 1 linha (nunca
// "nao encontrado") — hostname desconhecido cai no default_store_id() (mesmo comportamento de hoje,
// zero regressao); loja fictícia com status != 'ativo' NUNCA cai no fallback (mostra ela mesma, pra
// o frontend decidir "loja indisponivel", nunca o catalogo errado sob o dominio errado).
//
// Achado documentado no ledger que este script prova por comportamento (nao so por inspecao): com a
// RLS de catalogo agora permitindo QUALQUER loja ativa (nao so a padrao), o filtro .eq('store_id',...)
// no FRONTEND passa a ser load-bearing — sem ele, uma consulta sem filtro devolveria a UNIAO de todas
// as lojas ativas. Testado explicitamente (C-MIX) para confirmar que e exatamente isso que aconteceria.
//
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

const ADMIN_REAL_USER_ID = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // admin real de producao (encanto)
const ENCANTO_DOMINIO = 'encanto.valionsistemas.com.br';
const STORE_B_ID = '22222222-5555-4000-8000-000000000001'; // fictícia, ATIVA
const STORE_C_ID = '22222222-5555-4000-8000-000000000002'; // fictícia, SUSPENSA
const STORE_B_DOMINIO = 'loja-b-onda6-teste.example.com';
const STORE_C_DOMINIO = 'loja-c-onda6-teste.example.com';
const PROD_B_ID = '22222222-7777-4000-8000-000000000001';
const PROD_C_ID = '22222222-7777-4000-8000-000000000002';
const CUSTOMER_SHARED_AUTH = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // pessoa real (auth.users), sem vínculo admin — reaproveitada da Onda 5 (customers.auth_user_id tem FK -> auth.users)
const CUSTOMER_B_ID = '22222222-9999-4000-8000-000000000001';
const CUSTOMER_C_ID = '22222222-9999-4000-8000-000000000002';

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
async function sp(fn) {
  const s = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${s}`);
  try { const r = await fn(); await client.query(`RELEASE SAVEPOINT ${s}`); return { result: r, errMsg: null }; }
  catch (e) { await client.query(`ROLLBACK TO SAVEPOINT ${s}`); return { result: null, errMsg: redact(e.message).split('\n')[0] }; }
}
async function asRole(role, sub) {
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(sub ? { sub, role } : { role })]);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function asOwner() { await client.query('RESET ROLE'); }

function setupSql() {
  return [
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-onda6-teste', 'Loja B (fake, Onda 6.1)', '${STORE_B_DOMINIO}', 'ativo')`,
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_C_ID}', 'loja-c-onda6-teste', 'Loja C (fake, Onda 6.1)', '${STORE_C_DOMINIO}', 'suspenso')`,
    `INSERT INTO public.categories (store_id, nome, ordem, ativo, slug) VALUES ('${STORE_B_ID}', 'Cat B', 1, true, 'cat-b-onda6')`,
    `INSERT INTO public.products (id, store_id, nome, preco, disponivel) VALUES ('${PROD_B_ID}', '${STORE_B_ID}', 'Produto Loja B', 10.00, true)`,
    `INSERT INTO public.products (id, store_id, nome, preco, disponivel) VALUES ('${PROD_C_ID}', '${STORE_C_ID}', 'Produto Loja C (suspensa)', 10.00, true)`,
    `INSERT INTO public.customers (id, name, phone, store_id, auth_user_id) VALUES ('${CUSTOMER_B_ID}', 'Cliente B (fake onda6)', '47955550001', '${STORE_B_ID}', '${CUSTOMER_SHARED_AUTH}')`,
    `INSERT INTO public.customers (id, name, phone, store_id, auth_user_id) VALUES ('${CUSTOMER_C_ID}', 'Cliente C (fake onda6)', '47955550002', '${STORE_C_ID}', '${CUSTOMER_SHARED_AUTH}')`,
  ];
}

try {
  out('===================================================================');
  out(' SUITE — REF-SAAS-01 · Onda 6.1 (resolucao de loja por dominio) — RELATORIO');
  out('===================================================================');
  out('BEGIN...ROLLBACK. Nenhuma escrita persiste — lojas/produtos/clientes fictícios somem no ROLLBACK.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— Pré-requisito: get_store_by_domain existe, é SECURITY DEFINER —');
  {
    const r = await client.query(`SELECT prosecdef FROM pg_proc WHERE proname = 'get_store_by_domain'`);
    const ok = r.rowCount === 1 && r.rows[0].prosecdef === true;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] PRE1 função presente e SECURITY DEFINER (prosecdef=${r.rows[0]?.prosecdef})`);
    if (!ok) throw new Error('Migration REF-SAAS-01-onda6-1 não aplicada — abortando o restante da suíte.');
  }
  out('');

  const encantoRow = (await client.query(`SELECT id FROM public.stores WHERE slug = 'encanto'`)).rows[0];
  const encantoId = encantoRow.id;

  out('— A1: hostname REAL da Encanto resolve pra encanto —');
  {
    const r = await client.query(`SELECT * FROM public.get_store_by_domain($1)`, [ENCANTO_DOMINIO]);
    const ok = r.rowCount === 1 && r.rows[0].store_id === encantoId && r.rows[0].status === 'ativo';
    record('A1', 'get_store_by_domain(encanto.valionsistemas.com.br) -> encanto/ativo', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows[0]));
  }
  out('');

  out('— A2: hostname DESCONHECIDO (localhost/preview) cai no default_store_id() — SEMPRE 1 linha, nunca "não encontrado" —');
  {
    const r = await client.query(`SELECT * FROM public.get_store_by_domain($1)`, ['localhost']);
    const ok = r.rowCount === 1 && r.rows[0].store_id === encantoId;
    record('A2', 'get_store_by_domain(localhost) -> fallback pro default (encanto), zero regressão', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows[0]));
  }
  out('');

  await client.query('BEGIN');
  try {
    for (const s of setupSql()) await client.query(s);

    out('— A3: hostname de uma loja fictícia ATIVA (B) resolve pra ela mesma —');
    {
      const r = await client.query(`SELECT * FROM public.get_store_by_domain($1)`, [STORE_B_DOMINIO]);
      const ok = r.rowCount === 1 && r.rows[0].store_id === STORE_B_ID && r.rows[0].status === 'ativo';
      record('A3', 'get_store_by_domain(loja B) -> loja B/ativo', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows[0]));
    }
    out('');

    out('— A4: hostname de uma loja fictícia SUSPENSA (C) resolve pra ELA MESMA, com status correto — NUNCA cai no fallback (mostrar o catálogo errado seria pior que "loja indisponível") —');
    {
      const r = await client.query(`SELECT * FROM public.get_store_by_domain($1)`, [STORE_C_DOMINIO]);
      const ok = r.rowCount === 1 && r.rows[0].store_id === STORE_C_ID && r.rows[0].status === 'suspenso';
      record('A4', 'get_store_by_domain(loja C suspensa) -> loja C/suspenso (não fallback)', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows[0]));
    }
    out('');

    out('— B1: anon com filtro explícito por store_id vê o catálogo da loja B (ativa fictícia) —');
    {
      await asRole('anon');
      const r = await client.query(`SELECT id FROM public.products WHERE store_id = $1`, [STORE_B_ID]);
      const ok = r.rows.some(x => x.id === PROD_B_ID);
      record('B1', '<anon> SELECT products WHERE store_id=lojaB -> vê o produto da loja B', ok ? 'PASS' : 'FAIL', `rows=${r.rowCount}`);
      await asOwner();
    }
    out('');

    out('— B2 (NEGATIVO): anon com filtro explícito por store_id da loja C (SUSPENSA) não vê nada —');
    {
      await asRole('anon');
      const r = await client.query(`SELECT id FROM public.products WHERE store_id = $1`, [STORE_C_ID]);
      const ok = r.rowCount === 0;
      record('B2', '<anon> SELECT products WHERE store_id=lojaC (suspensa) -> 0 linhas', ok ? 'PASS' : 'FAIL', `rows=${r.rowCount}`);
      await asOwner();
    }
    out('');

    out('— B3 (achado documentado no ledger, provado aqui): SEM o filtro .eq(store_id,...), a RLS agora devolve a UNIÃO de todas as lojas ATIVAS — prova de que o filtro no frontend é obrigatório, não decorativo —');
    {
      await asRole('anon');
      const r = await client.query(`SELECT id, store_id FROM public.products WHERE id IN ($1, $2)`, [PROD_B_ID, PROD_C_ID]);
      const vePB = r.rows.some(x => x.id === PROD_B_ID);
      const vePC = r.rows.some(x => x.id === PROD_C_ID);
      const ok = vePB && !vePC; // B (ativa) visível, C (suspensa) não — confirma que só o status filtra, não a "loja certa"
      record('B3', 'sem filtro de store_id: vê loja B (ativa) misturada com o resto — só status separa, não a loja', ok ? 'PASS' : 'FAIL', `vê B=${vePB} vê C(suspensa)=${vePC}`);
      await asOwner();
    }
    out('');

    out('— C1: cliente com registro em 2 lojas (mesma pessoa, auth_user_id compartilhado) lê o registro CERTO de cada loja informando store_id explícito —');
    {
      await asRole('authenticated', CUSTOMER_SHARED_AUTH);
      const rB = await client.query(`SELECT id FROM public.customers WHERE auth_user_id = $1 AND store_id = $2`, [CUSTOMER_SHARED_AUTH, STORE_B_ID]);
      const rC = await client.query(`SELECT id FROM public.customers WHERE auth_user_id = $1 AND store_id = $2`, [CUSTOMER_SHARED_AUTH, STORE_C_ID]);
      const ok = rB.rows[0]?.id === CUSTOMER_B_ID && rC.rows[0]?.id === CUSTOMER_C_ID;
      record('C1', 'com store_id explícito -> cada loja lê o próprio registro, sem ambiguidade', ok ? 'PASS' : 'FAIL', `B=${rB.rows[0]?.id} C=${rC.rows[0]?.id}`);
      await asOwner();
    }
    out('');

    out('— C2 (achado documentado no ledger, provado aqui): SEM store_id explícito, a mesma pessoa tem 2 linhas — a ambiguidade que motivou a remoção da âncora é real —');
    {
      await asRole('authenticated', CUSTOMER_SHARED_AUTH);
      const r = await client.query(`SELECT id FROM public.customers WHERE auth_user_id = $1`, [CUSTOMER_SHARED_AUTH]);
      const ok = r.rowCount === 2;
      record('C2', 'sem store_id: 2 linhas visíveis (ambos os customers, sem determinismo) — por isso a query DEVE filtrar', ok ? 'PASS' : 'FAIL', `rows=${r.rowCount}`);
      await asOwner();
    }
    out('');

    out('— C3 (NEGATIVO): estranho sem nenhum vínculo não lê nenhum customer, mesmo informando store_id —');
    {
      await asRole('authenticated', '00000000-0000-4000-8000-000000000000');
      const r = await client.query(`SELECT id FROM public.customers WHERE store_id = $1`, [STORE_B_ID]);
      const ok = r.rowCount === 0;
      record('C3', '<estranho> SELECT customers WHERE store_id=lojaB -> 0 linhas (RLS continua auth_user_id=auth.uid())', ok ? 'PASS' : 'FAIL', `rows=${r.rowCount}`);
      await asOwner();
    }
    out('');

    out('— D1: regressão — admin real da Encanto continua vendo/gerenciando a própria loja normalmente (is_admin_of intocado) —');
    {
      const { errMsg } = await sp(async () => {
        await asRole('authenticated', ADMIN_REAL_USER_ID);
        const r = await client.query(`SELECT count(*)::int AS n FROM public.products WHERE store_id = $1`, [encantoId]);
        await asOwner();
        return r.rows[0].n;
      });
      const ok = errMsg === null;
      record('D1', 'admin real consulta o próprio catálogo sem erro', ok ? 'PASS' : 'FAIL', errMsg ?? 'sem erro');
      await asOwner();
    }
    out('');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }

  out('— D2: regressão real — anon com filtro explícito pela Encanto (store_id real) continua vendo o catálogo real de produção —');
  {
    await client.query('BEGIN');
    await asRole('anon');
    const r = await client.query(`SELECT count(*)::int AS n FROM public.products WHERE store_id = $1`, [encantoId]);
    await asOwner();
    await client.query('ROLLBACK');
    const ok = r.rows[0].n > 0;
    record('D2', 'catálogo real de produção (Encanto) continua visível via filtro explícito de store_id', ok ? 'PASS' : 'FAIL', `n=${r.rows[0].n}`);
  }
  out('');

  out('— Confirmação pós-ROLLBACK: nenhuma loja/produto/cliente fictício sobrou —');
  {
    const c = await client.query(`SELECT count(*)::int AS n FROM public.stores WHERE id IN ($1, $2)`, [STORE_B_ID, STORE_C_ID]);
    const ok = c.rows[0].n === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] RB1 nenhuma das 2 lojas fictícias sobrou após o ROLLBACK`);
    out(`         -> count=${c.rows[0].n}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 6.1)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('Camada B roda em BEGIN...ROLLBACK — mutação líquida ZERO');
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
