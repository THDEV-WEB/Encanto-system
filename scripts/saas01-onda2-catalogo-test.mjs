// Suite de verificacao da REF-SAAS-01 · Onda 2 (RLS + policies do catalogo) — "Testes da fase".
// Exigencia elevada pelo dono para esta onda: toda policy nova precisa de teste POSITIVO e NEGATIVO,
// prova de isolamento entre lojas, tentativa explicita de acessar catalogo de outra loja, comportamento
// sem autenticacao, comportamento do Admin (inclusive de uma 2a loja) e regressao completa do Cliente
// Zero. Nenhuma policy e aceita so por inspecao visual/compilacao — so por comportamento provado.
//
// Camada A: estrutural (schema/constraints/policies via introspeccao, somente leitura).
// Camada B: comportamental — simulacao de sessao real via SET LOCAL ROLE + request.jwt.claims dentro
// de BEGIN...ROLLBACK (mesmo padrao de scripts/auth-rls-test.mjs e das Ondas 0/1). Uma loja B ficticia,
// seu catalogo e um admin ficticio sao inseridos DENTRO de cada transacao e desfeitos pelo ROLLBACK —
// nunca persistem em producao. Exit 0 = SUCCESS; 1 = FAILED.
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

// Personas reais (auth.users existentes — satisfazem as FKs de admins/super_admins sem inventar id).
const ADMIN_REAL_USER_ID = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // admin real de producao (loja encanto)
  // -- desde a correcao operacional pos-Onda-8 (2026-08-10), TAMBEM super admin real/permanente
  // (pedido explicito do dono). So usado abaixo pra checagens de REGRESSAO (o que ele ve/faz de
  // verdade), nunca mais pra isolamento negativo (ele agora passa em qualquer loja, por design).
const ADMIN_B = 'ce7ece01-266c-42b1-a9db-8051da24d7f5';            // vira admin da loja B FICTICIA (so dentro da tx)
const STRANGER = '27bd5049-60e5-4980-abe9-3bd7942a6c31';           // cliente autenticado real, zero vinculo de admin
const ADMIN_ENCANTO_REGULAR = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // admin REGULAR de encanto (nunca
  // super admin) -- persona dedicada pras checagens de isolamento que precisam de alguem escopado a
  // 1 loja so; ganha o vinculo com Encanto so' DENTRO da transacao de teste (nunca persiste).

// Loja B e catalogo ficticios — inseridos no inicio de cada transacao, desfeitos pelo ROLLBACK.
const STORE_B_ID     = 'aaaaaaaa-bbbb-4000-8000-000000000001';
const CATEGORY_A_ID  = 'aaaaaaaa-cccc-4000-8000-00000000000a';
const CATEGORY_A2_ID = 'aaaaaaaa-cccc-4000-8000-00000000000c';
const CATEGORY_B_ID  = 'bbbbbbbb-cccc-4000-8000-00000000000b';
const CATEGORY_B2_ID = 'bbbbbbbb-cccc-4000-8000-00000000000d';
const PRODUCT_A_ID   = 'aaaaaaaa-dddd-4000-8000-00000000000a';
const PRODUCT_B_ID   = 'bbbbbbbb-dddd-4000-8000-00000000000b';
const ADICIONAL_A_ID = 'aaaaaaaa-eeee-4000-8000-00000000000a';
const ADICIONAL_B_ID = 'bbbbbbbb-eeee-4000-8000-00000000000b';
const PCOLL_A_ID     = 'aaaaaaaa-ffff-4000-8000-00000000000a';
const PCOLL_B_ID     = 'bbbbbbbb-ffff-4000-8000-00000000000b';

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0;
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
async function expectRows(id, desc, sql, params, expected) {
  const r = await client.query(sql, params);
  const ok = r.rowCount === expected;
  record(id, desc, ok ? 'PASS' : 'FAIL', `rows=${r.rowCount} (esperado ${expected})`);
}
let spCounter = 0;
async function expectWrite(id, desc, sql, params, allow) {
  // Uma escrita negada pelo WITH CHECK do RLS lanca um erro real do Postgres, que envenena a
  // transacao inteira (todo comando seguinte falharia com "current transaction is aborted") ate um
  // ROLLBACK. Por isso cada tentativa roda dentro do proprio SAVEPOINT — RLS negar e um resultado
  // ESPERADO neste script, nao uma falha de infraestrutura que deva descartar o resto dos testes.
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let rowCount = null, errMsg = null;
  try {
    const r = await client.query(sql, params);
    rowCount = r.rowCount;
    await client.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (e) {
    errMsg = redact(e.message).split('\n')[0];
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
  }
  const ok = allow ? (errMsg === null && rowCount >= 1) : (errMsg !== null || rowCount === 0);
  record(id, desc, ok ? 'PASS' : 'FAIL', errMsg ? `negado por erro: ${errMsg}` : `linhas afetadas=${rowCount}`);
}

function setupSql(encantoId) {
  return [
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-teste-onda2', 'Loja B (fake, teste Onda 2)', NULL, 'ativo')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B}', '${STORE_B_ID}')`,
    // tipo='collection' + estrategia preenchida: trigger trg_sti_pc_collection (STI I1) só aceita
    // como collection_id de product_collections uma categoria tipo='collection'; e o CHECK
    // categories_sti_biz_chk exige estrategia NOT NULL sempre que tipo <> 'business'.
    `INSERT INTO public.categories (id, nome, slug, store_id, tipo, estrategia) VALUES ('${CATEGORY_A_ID}', 'Categoria A (fake onda2)', 'categoria-a-onda2', '${encantoId}', 'collection', 'manual')`,
    `INSERT INTO public.categories (id, nome, slug, store_id, tipo, estrategia) VALUES ('${CATEGORY_A2_ID}', 'Categoria A2 (fake onda2)', 'categoria-a2-onda2', '${encantoId}', 'collection', 'manual')`,
    `INSERT INTO public.categories (id, nome, slug, store_id, tipo, estrategia) VALUES ('${CATEGORY_B_ID}', 'Categoria B (fake onda2)', 'categoria-b-onda2', '${STORE_B_ID}', 'collection', 'manual')`,
    `INSERT INTO public.categories (id, nome, slug, store_id, tipo, estrategia) VALUES ('${CATEGORY_B2_ID}', 'Categoria B2 (fake onda2)', 'categoria-b2-onda2', '${STORE_B_ID}', 'collection', 'manual')`,
    `INSERT INTO public.products (id, nome, store_id) VALUES ('${PRODUCT_A_ID}', 'Produto A (fake onda2)', '${encantoId}')`,
    `INSERT INTO public.products (id, nome, store_id) VALUES ('${PRODUCT_B_ID}', 'Produto B (fake onda2)', '${STORE_B_ID}')`,
    `INSERT INTO public.adicionais (id, nome, grupo, store_id) VALUES ('${ADICIONAL_A_ID}', 'Adicional A (fake onda2)', 'simples', '${encantoId}')`,
    `INSERT INTO public.adicionais (id, nome, grupo, store_id) VALUES ('${ADICIONAL_B_ID}', 'Adicional B (fake onda2)', 'simples', '${STORE_B_ID}')`,
    `INSERT INTO public.product_collections (id, product_id, collection_id, store_id) VALUES ('${PCOLL_A_ID}', '${PRODUCT_A_ID}', '${CATEGORY_A_ID}', '${encantoId}')`,
    `INSERT INTO public.product_collections (id, product_id, collection_id, store_id) VALUES ('${PCOLL_B_ID}', '${PRODUCT_B_ID}', '${CATEGORY_B_ID}', '${STORE_B_ID}')`,
  ];
}
const SUPER_ADMIN_SETUP = `INSERT INTO public.super_admins (user_id) VALUES ('${ADMIN_REAL_USER_ID}') ON CONFLICT DO NOTHING`; // pos-Onda-8: ele ja e' super admin real/permanente

function tablesConfig(encantoId) {
  return [
    {
      name: 'products', rowA: PRODUCT_A_ID, rowB: PRODUCT_B_ID,
      updCol: 'nome', updCast: 'text', updVal: 'Produto Editado (teste onda2)',
      insertNoStore: `INSERT INTO public.products (nome) VALUES ('Produto Sem Store (fake onda2)')`,
      insertExplicit: (storeId, label) => `INSERT INTO public.products (nome, store_id) VALUES ('Produto ${label} (fake onda2)', '${storeId}')`,
      lojaBAtivaEhPublicaDesdeOnda6: true, // REF-SAAS-01 · Onda 6.1: leitura publica passou a permitir QUALQUER loja ATIVA, nao so a padrao
    },
    {
      name: 'categories', rowA: CATEGORY_A_ID, rowB: CATEGORY_B_ID,
      updCol: 'nome', updCast: 'text', updVal: 'Categoria Editada (teste onda2)',
      insertNoStore: `INSERT INTO public.categories (nome, slug) VALUES ('Categoria Sem Store (fake onda2)', 'cat-sem-store-onda2')`,
      insertExplicit: (storeId, label) => `INSERT INTO public.categories (nome, slug, store_id) VALUES ('Categoria ${label} (fake onda2)', 'cat-${label.toLowerCase()}-onda2', '${storeId}')`,
      lojaBAtivaEhPublicaDesdeOnda6: true,
    },
    {
      name: 'adicionais', rowA: ADICIONAL_A_ID, rowB: ADICIONAL_B_ID,
      updCol: 'nome', updCast: 'text', updVal: 'Adicional Editado (teste onda2)',
      insertNoStore: `INSERT INTO public.adicionais (nome, grupo) VALUES ('Adicional Sem Store (fake onda2)', 'simples')`,
      insertExplicit: (storeId, label) => `INSERT INTO public.adicionais (nome, grupo, store_id) VALUES ('Adicional ${label} (fake onda2)', 'simples', '${storeId}')`,
      lojaBAtivaEhPublicaDesdeOnda6: true,
    },
    {
      name: 'product_collections', rowA: PCOLL_A_ID, rowB: PCOLL_B_ID,
      updCol: 'fixado', updCast: 'boolean', updVal: true,
      insertNoStore: `INSERT INTO public.product_collections (product_id, collection_id) VALUES ('${PRODUCT_A_ID}', '${CATEGORY_A2_ID}')`,
      insertExplicit: (storeId, label) => {
        const [pid, cid] = storeId === encantoId ? [PRODUCT_A_ID, CATEGORY_A2_ID] : [PRODUCT_B_ID, CATEGORY_B2_ID];
        return `INSERT INTO public.product_collections (product_id, collection_id, store_id) VALUES ('${pid}', '${cid}', '${storeId}')`;
      },
    },
  ];
}

async function testTable(t, encantoId) {
  const setup = setupSql(encantoId);
  const P = t.name;

  // REF-SAAS-01 · Onda 6.1: products/categories/adicionais passaram a permitir leitura publica de
  // QUALQUER loja ATIVA (nao so a padrao) -- loja B (ficticia, status='ativo' por DEFAULT) agora e
  // visivel de proposito. Isolamento de leitura publica deixou de ser "por loja" e passou a ser "por
  // status" (so lojas suspensas/canceladas continuam invisiveis) -- ver saas01-onda6-1 pra esse teste.
  const rowBAgoraVisivel = !!t.lojaBAtivaEhPublicaDesdeOnda6;
  const descIsolamento = rowBAgoraVisivel
    ? 've a linha da loja B tambem -- intencional desde a Onda 6.1, loja B esta ATIVA (isolamento agora e por status, nao por loja)'
    : 'NAO ve linha da loja B (isolamento)';

  // 1) anon — sem autenticacao nenhuma.
  await tx('anon', null, setup, async () => {
    await expectRows(`${P}-SEL-P1`, `${P}: anon ve linha da loja padrao/encanto (leitura publica)`, `SELECT 1 FROM public.${P} WHERE id = $1`, [t.rowA], 1);
    await expectRows(`${P}-SEL-N1`, `${P}: anon ${descIsolamento}`, `SELECT 1 FROM public.${P} WHERE id = $1`, [t.rowB], rowBAgoraVisivel ? 1 : 0);
    await expectWrite(`${P}-INS-N3`, `${P}: anon nao consegue inserir (sem autenticacao)`, t.insertNoStore, [], false);
    await expectWrite(`${P}-UPD-N3`, `${P}: anon nao consegue atualizar linha A (sem autenticacao)`, `UPDATE public.${P} SET ${t.updCol} = $2::${t.updCast} WHERE id = $1`, [t.rowA, t.updVal], false);
    await expectWrite(`${P}-DEL-N-anon`, `${P}: anon nao consegue excluir linha A (sem autenticacao)`, `DELETE FROM public.${P} WHERE id = $1`, [t.rowA], false);
  });

  // 2) cliente autenticado real, sem nenhum vinculo de admin.
  await tx('authenticated', STRANGER, setup, async () => {
    await expectRows(`${P}-SEL-P2`, `${P}: cliente logado sem vinculo ve linha A (loja padrao e publica pra qualquer role)`, `SELECT 1 FROM public.${P} WHERE id = $1`, [t.rowA], 1);
    await expectRows(`${P}-SEL-N2`, `${P}: cliente logado sem vinculo ${descIsolamento}`, `SELECT 1 FROM public.${P} WHERE id = $1`, [t.rowB], rowBAgoraVisivel ? 1 : 0);
    await expectWrite(`${P}-UPD-N-stranger`, `${P}: cliente logado sem vinculo nao consegue atualizar linha A`, `UPDATE public.${P} SET ${t.updCol} = $2::${t.updCast} WHERE id = $1`, [t.rowA, t.updVal], false);
  });

  // 3) admin REGULAR de encanto (nunca super admin -- ver ADMIN_ENCANTO_REGULAR acima). Prova
  // isolamento de escrita/leitura escopado a 1 loja. Nenhuma linha aqui e' dado real: t.rowA/rowB sao
  // FICTICIOS desta transacao, mesmo rowA usando store_id=encantoId (simula "a propria loja").
  await tx('authenticated', ADMIN_ENCANTO_REGULAR, [...setup, `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_ENCANTO_REGULAR}', '${encantoId}') ON CONFLICT DO NOTHING`], async () => {
    await expectRows(`${P}-SEL-P3`, `${P}: admin regular (encanto) ve linha A (regressao)`, `SELECT 1 FROM public.${P} WHERE id = $1`, [t.rowA], 1);
    await expectRows(`${P}-SEL-N3`, `${P}: admin regular (encanto) ${descIsolamento}`, `SELECT 1 FROM public.${P} WHERE id = $1`, [t.rowB], rowBAgoraVisivel ? 1 : 0);
    await expectWrite(`${P}-INS-P1`, `${P}: admin regular insere SEM informar store_id -> DEFAULT cobre (regressao do upsert atual)`, t.insertNoStore, [], true);
    await expectWrite(`${P}-INS-N2`, `${P}: admin regular tenta inserir explicitamente na loja B -> negado (isolamento)`, t.insertExplicit(STORE_B_ID, 'InvasaoAB'), [], false);
    await expectWrite(`${P}-UPD-P1`, `${P}: admin regular atualiza linha A (propria loja, regressao)`, `UPDATE public.${P} SET ${t.updCol} = $2::${t.updCast} WHERE id = $1`, [t.rowA, t.updVal], true);
    await expectWrite(`${P}-UPD-N1`, `${P}: admin regular tenta atualizar linha B -> negado (isolamento)`, `UPDATE public.${P} SET ${t.updCol} = $2::${t.updCast} WHERE id = $1`, [t.rowB, t.updVal], false);
    await expectWrite(`${P}-UPD-N-move`, `${P}: admin regular tenta MOVER linha A pra loja B (mudar store_id) -> negado pelo WITH CHECK`, `UPDATE public.${P} SET store_id = '${STORE_B_ID}' WHERE id = $1`, [t.rowA], false);
    await expectWrite(`${P}-DEL-N1`, `${P}: admin regular tenta excluir linha B -> negado (isolamento)`, `DELETE FROM public.${P} WHERE id = $1`, [t.rowB], false);
    await expectWrite(`${P}-DEL-P1`, `${P}: admin regular exclui linha A (propria loja, regressao)`, `DELETE FROM public.${P} WHERE id = $1`, [t.rowA], true);
  });

  // 4) admin ficticio da loja B (prova que is_admin_of funciona p/ uma 2a loja, nao so a legada).
  await tx('authenticated', ADMIN_B, setup, async () => {
    await expectRows(`${P}-SEL-P4`, `${P}: admin B ve linha B (propria loja)`, `SELECT 1 FROM public.${P} WHERE id = $1`, [t.rowB], 1);
    await expectRows(`${P}-SEL-P5`, `${P}: admin B TAMBEM ve linha A -- intencional, loja padrao e publica pra qualquer um (nao e vazamento)`, `SELECT 1 FROM public.${P} WHERE id = $1`, [t.rowA], 1);
    await expectWrite(`${P}-INS-N-default`, `${P}: admin B insere SEM store_id -> DEFAULT aponta pra encanto (nao pra B) -> negado (limite conhecido da ponte Onda2-6)`, t.insertNoStore, [], false);
    await expectWrite(`${P}-INS-P2`, `${P}: admin B insere explicitamente na PROPRIA loja B -> permitido`, t.insertExplicit(STORE_B_ID, 'LegitimoB'), [], true);
    await expectWrite(`${P}-INS-N1`, `${P}: admin B tenta inserir explicitamente na loja encanto -> negado (isolamento)`, t.insertExplicit(encantoId, 'InvasaoBA'), [], false);
    await expectWrite(`${P}-UPD-P2`, `${P}: admin B atualiza linha B (propria loja)`, `UPDATE public.${P} SET ${t.updCol} = $2::${t.updCast} WHERE id = $1`, [t.rowB, t.updVal], true);
    await expectWrite(`${P}-UPD-N2`, `${P}: admin B tenta atualizar linha A (encanto) -> negado (isolamento)`, `UPDATE public.${P} SET ${t.updCol} = $2::${t.updCast} WHERE id = $1`, [t.rowA, t.updVal], false);
    await expectWrite(`${P}-DEL-P2`, `${P}: admin B exclui linha B (propria loja)`, `DELETE FROM public.${P} WHERE id = $1`, [t.rowB], true);
  });

  // 5) super admin ficticio (composicao is_super_admin() OR ... atraves das policies de catalogo).
  await tx('authenticated', ADMIN_REAL_USER_ID, [...setup, SUPER_ADMIN_SETUP], async () => {
    await expectRows(`${P}-SEL-P6`, `${P}: super admin ve linha B mesmo SEM linha em admins para a loja B`, `SELECT 1 FROM public.${P} WHERE id = $1`, [t.rowB], 1);
    await expectWrite(`${P}-INS-P3`, `${P}: super admin insere na loja B mesmo sem linha em admins`, t.insertExplicit(STORE_B_ID, 'SuperAdminB'), [], true);
    await expectWrite(`${P}-UPD-P3`, `${P}: super admin atualiza linha B mesmo sem linha em admins`, `UPDATE public.${P} SET ${t.updCol} = $2::${t.updCast} WHERE id = $1`, [t.rowB, t.updVal], true);
    await expectWrite(`${P}-DEL-P3`, `${P}: super admin exclui linha B mesmo sem linha em admins`, `DELETE FROM public.${P} WHERE id = $1`, [t.rowB], true);
  });
}

try {
  out('==================================================================');
  out(' SUITE DE ISOLAMENTO — REF-SAAS-01 · Onda 2 (catalogo) — RELATORIO');
  out('==================================================================');
  out('Camada A: somente leitura. Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('Exigencia do dono: toda policy nova tem teste positivo E negativo; isolamento entre lojas provado por comportamento, nao por inspecao.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');
  // Baseline: desde a correcao operacional pos-Onda-8 (2026-08-10), ADMIN_REAL_USER_ID e' super admin
  // real/permanente (pedido explicito do dono) -- REGRESSAO-03 abaixo compara CONTAGEM, nao mais 0.
  const baselineSuperAdmin = (await client.query(`SELECT count(*)::int AS n FROM public.super_admins WHERE user_id = '${ADMIN_REAL_USER_ID}'`)).rows[0].n;

  const encantoId = (await client.query(`SELECT id FROM public.stores WHERE slug = 'encanto'`)).rows[0].id;
  out('— Loja encanto resolvida (fora de qualquer sessao simulada, como superuser): ' + encantoId + ' —');
  out('');

  // ---------------- Camada A: estrutural ----------------
  out('— A1: store_id agora NOT NULL nas 4 tabelas de catalogo —');
  {
    const r = await client.query(`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('products','categories','adicionais','product_collections') AND column_name='store_id'
      ORDER BY table_name`);
    const ok = r.rows.length === 4 && r.rows.every(x => x.is_nullable === 'NO');
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A1 store_id NOT NULL nas 4 tabelas`);
    out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— A2: uniques compostas com store_id como coluna lider substituiram as globais —');
  {
    const r = await client.query(`
      SELECT conrelid::regclass::text AS tabela, conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid IN ('public.products'::regclass,'public.categories'::regclass,'public.adicionais'::regclass,'public.product_collections'::regclass)
        AND contype='u'
      ORDER BY tabela`);
    const esperado = {
      'products': 'products_store_nome_categoria_uniq',
      'categories': 'categories_store_slug_uk',
      'adicionais': 'adicionais_store_nome_grupo_cat_uniq',
      'product_collections': 'product_collections_store_product_collection_uk',
    };
    const nomesAntigos = ['unique_nome_categoria', 'categories_slug_uk', 'adicionais_nome_grupo_cat_uniq', 'product_collections_uk'];
    const novasPresentes = Object.values(esperado).every(n => r.rows.some(x => x.conname === n && x.def.includes('store_id')));
    const antigasSumiram = !r.rows.some(x => nomesAntigos.includes(x.conname));
    const ok = novasPresentes && antigasSumiram;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A2 constraints UNIQUE migradas corretamente`);
    out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— A3: default_store_id() existe, STABLE SECURITY DEFINER, resolve pra loja encanto —');
  {
    const meta2 = await client.query(`SELECT provolatile, prosecdef FROM pg_proc WHERE proname='default_store_id' AND pronamespace='public'::regnamespace`);
    const r = await client.query('SELECT public.default_store_id() AS id');
    const ok = meta2.rowCount === 1 && meta2.rows[0].provolatile === 's' && meta2.rows[0].prosecdef === true && r.rows[0].id === encantoId;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A3 default_store_id() correta e resolve pra encanto`);
    out(`         -> meta=${JSON.stringify(meta2.rows)} · resolvido=${r.rows[0].id}`);
  }
  out('');

  out('— A4: as 4 policies de leitura publica citam is_admin_of() no texto real da policy — products/categories/adicionais via store_ativo() (Onda 6.1, QUALQUER loja ativa), product_collections ainda via default_store_id() (intocada nesta REF) —');
  {
    const r = await client.query(`
      SELECT polrelid::regclass::text AS tabela, polname, pg_get_expr(polqual, polrelid) AS using_expr
      FROM pg_policy WHERE polrelid IN ('public.products'::regclass,'public.categories'::regclass,'public.adicionais'::regclass,'public.product_collections'::regclass)
        AND polname LIKE 'Leitura pública%'`);
    const storeAtivoTabelas = new Set(['products', 'categories', 'adicionais']);
    const ok = r.rows.length === 4 && r.rows.every(x => {
      if (!x.using_expr.includes('is_admin_of')) return false;
      return storeAtivoTabelas.has(x.tabela) ? x.using_expr.includes('store_ativo') : x.using_expr.includes('default_store_id');
    });
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A4 policies de leitura publica com o predicado certo por tabela`);
    out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— A5: as 12 policies de escrita (insert/update/delete x 4 tabelas) citam is_admin_of(store_id), nao mais is_admin() cego —');
  {
    const r = await client.query(`
      SELECT polrelid::regclass::text AS tabela, polname, polcmd,
             pg_get_expr(polqual, polrelid) AS using_expr, pg_get_expr(polwithcheck, polrelid) AS check_expr
      FROM pg_policy WHERE polrelid IN ('public.products'::regclass,'public.categories'::regclass,'public.adicionais'::regclass,'public.product_collections'::regclass)
        AND polname LIKE 'Auth %'`);
    const todasComIsAdminOf = r.rows.every(x => (x.using_expr || '').includes('is_admin_of') || (x.check_expr || '').includes('is_admin_of'));
    const nenhumaComIsAdminSozinho = r.rows.every(x => !((x.using_expr === 'is_admin()') || (x.check_expr === 'is_admin()')));
    const ok = r.rows.length === 12 && todasComIsAdminOf && nenhumaComIsAdminSozinho;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A5 policies de escrita usam is_admin_of(store_id)`);
    out(`         -> total=${r.rows.length} · todasComIsAdminOf=${todasComIsAdminOf} · nenhumaComIsAdminSozinho=${nenhumaComIsAdminSozinho}`);
  }
  out('');

  // ---------------- Camada B: comportamental, por tabela ----------------
  const TABLES = tablesConfig(encantoId);
  for (const t of TABLES) {
    out(`— Bateria comportamental completa: ${t.name} —`);
    await testTable(t, encantoId);
    out('');
  }

  // ---------------- Regressao final com dados REAIS de producao ----------------
  out('— REGRESSAO-01: contagens de leitura publica (anon) batem com a contagem real (superuser) — nada sumiu do catalogo real —');
  {
    const real = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.categories) AS categorias,
        (SELECT count(*)::int FROM public.products) AS produtos,
        (SELECT count(*)::int FROM public.adicionais) AS adicionais`);
    let anonCounts = null;
    await tx('anon', null, [], async () => {
      const r = await client.query(`
        SELECT
          (SELECT count(*)::int FROM public.categories) AS categorias,
          (SELECT count(*)::int FROM public.products) AS produtos,
          (SELECT count(*)::int FROM public.adicionais) AS adicionais`);
      anonCounts = r.rows[0];
    });
    const ok = JSON.stringify(real.rows[0]) === JSON.stringify(anonCounts);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO-01 contagem real == contagem vista por anon`);
    out(`         -> real=${JSON.stringify(real.rows[0])} · anon=${JSON.stringify(anonCounts)}`);
  }
  out('');

  out('— REGRESSAO-02: admin real consegue alternar "disponivel" de um produto REAL (mesmo fluxo do toggleProd) — ROLLBACK, zero mutacao persistida —');
  {
    let v = 'FAIL', d = '';
    await tx('authenticated', ADMIN_REAL_USER_ID, [], async () => {
      const real = await client.query('SELECT id, disponivel FROM public.products ORDER BY created_at LIMIT 1');
      if (real.rowCount !== 1) { d = 'nenhum produto real encontrado'; return; }
      const { id, disponivel } = real.rows[0];
      const upd = await client.query('UPDATE public.products SET disponivel = $2 WHERE id = $1', [id, !disponivel]);
      v = upd.rowCount === 1 ? 'PASS' : 'FAIL';
      d = `produto=${id} · disponivel ${disponivel} -> ${!disponivel} · linhas=${upd.rowCount}`;
    });
    record('REGRESSAO-02', 'toggle real de disponivel funciona identico a antes da Onda 2', v, d);
  }
  out('');

  out('— REGRESSAO-03: apos toda a suite, nenhuma linha ficticia (loja B, admin B, super admin) ficou persistida em producao —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE id = '${STORE_B_ID}') AS loja_b,
        (SELECT count(*)::int FROM public.admins WHERE store_id = '${STORE_B_ID}') AS admin_b,
        (SELECT count(*)::int FROM public.super_admins WHERE user_id = '${ADMIN_REAL_USER_ID}') AS super_admin,
        (SELECT count(*)::int FROM public.products WHERE store_id = '${STORE_B_ID}') AS produtos_b,
        (SELECT count(*)::int FROM public.categories WHERE store_id = '${STORE_B_ID}') AS categorias_b,
        (SELECT count(*)::int FROM public.adicionais WHERE store_id = '${STORE_B_ID}') AS adicionais_b,
        (SELECT count(*)::int FROM public.product_collections WHERE store_id = '${STORE_B_ID}') AS pcoll_b`);
    const row = r.rows[0];
    const ok = Object.entries(row).every(([k, n]) => (k === 'super_admin' ? n === baselineSuperAdmin : n === 0));
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO-03 zero mutacao liquida em producao`);
    out(`         -> ${JSON.stringify({ ...row, super_admin_baseline: baselineSuperAdmin })}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 2)');
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
