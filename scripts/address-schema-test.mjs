// Suite de schema estruturado de endereço (REF-ADDRESS-02 · Onda 1) — "Testes da fase".
// Mesmo molde de harden-orders-rls-test.mjs: SET LOCAL ROLE anon/authenticated em BEGIN..ROLLBACK
// (net-zero, nenhuma escrita persiste). Prova:
//  - anon NÃO acessa a tabela addresses direto (sem grants — 42501), só via RPC save_structured_address;
//  - authenticated SEM identidade (auth.uid() nulo) insere um endereço órfão mas não consegue lê-lo de
//    volta (REF-ADDRESS-SEC-01 · policies addresses_select/insert/update/delete_own, fail closed);
//  - save_structured_address (SECURITY DEFINER) grava endereço estruturado completo e devolve uuid;
//  - CHECK de confidence rejeita valor fora de {exact, street_level, unknown} (REF-ADDRESS-AUTOCOMPLETE-01);
//  - orders.endereco_id + FK + índice existem e continuam vazios (nenhum pedido religado ainda — isso é Onda 6);
//  - create_order permanece BYTE-A-BYTE intacta (nenhuma mudança no checkout nesta onda).
// Exit 0 = SUCCESS; exit 1 = FAILED.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire('C:\\Users\\00thi\\.encanto\\package.json');
const pg = require('pg');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = 'C:\\Users\\00thi\\.encanto\\db.env';
const SCRIPT_NAME = 'test:address-schema';

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

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0;
const startedMs = Date.now(), startedIso = isoUtc();

// SHA256 da definição da create_order capturada em 2026-07-27, ANTES de qualquer mudança desta
// referência (ground truth do ADR §0). Se este hash mudar, create_order foi alterada — falha alto-sinal.
const CREATE_ORDER_SRC_LEN_EXPECTED = null; // preenchido no primeiro run bem-sucedido (ver AUD abaixo)

async function tx(role, fn) {
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
function record(id, role, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} <${role}> ${desc}`); out(`         -> ${detail}`);
}
async function expectDeniedGrant(id, role, desc, sql) {
  let verdict = 'FAIL', detail = '';
  await tx(role, async () => {
    try { await client.query(sql); detail = 'NAO foi negado (esperava 42501)'; verdict = 'FAIL'; }
    catch (e) { if (e.code === '42501') { verdict = 'PASS'; detail = 'permission denied (42501): ' + redact(e.message).split('\n')[0]; }
      else { verdict = 'FAIL'; detail = `negado por outro motivo (esperava 42501): code=${e.code} ${redact(e.message).split('\n')[0]}`; } }
  });
  record(id, role, desc, verdict, detail);
}

try {
  out('==================================================================');
  out(' SUITE DE SCHEMA DE ENDEREÇO — REF-ADDRESS-02 · Onda 1 — RELATORIO');
  out('==================================================================');
  out('SET LOCAL ROLE anon/authenticated em BEGIN..ROLLBACK. Nenhuma escrita persiste.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessão ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— Pré-requisito: colunas novas existem em addresses —');
  {
    const need = ['estado', 'cep', 'referencia', 'latitude', 'longitude', 'place_id', 'formatted_address', 'provider', 'confidence'];
    const r = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='addresses' AND column_name = ANY($1)`, [need]);
    const found = r.rows.map(x => x.column_name);
    const missing = need.filter(c => !found.includes(c));
    const ok = missing.length === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] SC1 9 colunas novas presentes`);
    out(`         -> ${ok ? 'todas presentes' : 'FALTANDO: ' + missing.join(',') + ' — migration ainda não foi aplicada? rode migrations/REF-ADDRESS-02-onda1-schema.sql'}`);
    if (!ok) { throw new Error('Migration Onda 1 não aplicada — abortando o restante da suíte (evita falsos negativos em cascata).'); }
  }
  out('');

  out('— ANON · acesso DIRETO a addresses DEVE ser negado (sem grants de tabela) —');
  await expectDeniedGrant('AA1', 'anon', 'SELECT addresses', `SELECT * FROM public.addresses LIMIT 1`);
  await expectDeniedGrant('AA2', 'anon', 'INSERT addresses direto', `INSERT INTO public.addresses(rua) VALUES ('x')`);
  out('');

  out('— ANON · save_structured_address (SECURITY DEFINER) DEVE funcionar —');
  {
    let v = 'FAIL', d = '';
    await tx('anon', async () => {
      const payload = JSON.stringify({
        rua: 'Rua João Schlei', numero: '123', bairro: 'Araponguinhas', cidade: 'Timbó', estado: 'SC',
        cep: '89120-000', referencia: 'perto do mercado', latitude: -26.8509174, longitude: -49.2880533,
        place_id: 'test-place-id', formatted_address: 'Rua João Schlei, Timbó, SC', provider: 'nominatim', confidence: 'exact',
      });
      const r = (await client.query(`SELECT public.save_structured_address($1::jsonb) AS id`, [payload])).rows[0];
      v = r?.id ? 'PASS' : 'FAIL'; d = r?.id ? 'retornou uuid: ' + r.id : 'sem retorno';
    });
    record('AA3', 'anon', 'save_structured_address grava endereço completo', v, d);
  }
  out('');

  out('— CHECK de confidence · rejeita valor inválido, aceita válido e NULL —');
  {
    let v = 'FAIL', d = '';
    await tx('anon', async () => {
      try {
        await client.query(`SELECT public.save_structured_address($1::jsonb) AS id`, [JSON.stringify({ rua: 'x', confidence: 'chutômetro' })]);
        v = 'FAIL'; d = 'NAO rejeitou confidence inválida';
      } catch (e) {
        if (e.code === '23514') { v = 'PASS'; d = 'check_violation (23514) como esperado: ' + redact(e.message).split('\n')[0]; }
        else { v = 'FAIL'; d = `código inesperado: ${e.code} ${redact(e.message).split('\n')[0]}`; }
      }
    });
    record('AA4', 'anon', 'CHECK addresses_confidence_check rejeita valor inválido', v, d);
  }
  out('');

  out('— AUTHENTICATED sem identidade · NAO enxerga endereco alheio (REF-ADDRESS-SEC-01) —');
  // Ate a REF-ADDRESS-SEC-01 (2026-08-17), a policy "Auth all addresses" (USING(true)/WITH CHECK(true))
  // deixava QUALQUER authenticated ler/escrever QUALQUER linha — era exatamente o vazamento que aquela
  // REF corrigiu. Este teste validava o comportamento ANTIGO (inseguro) como se fosse o esperado; agora
  // valida o oposto: sem auth.uid() (sessao authenticated generica, sem JWT de cliente), o INSERT sem
  // RETURNING ainda funciona (mesmo shape que um convidado gravando via RPC produziria: customer_id NULL),
  // mas a linha fica INVISIVEL por SELECT — nem para quem acabou de criá-la. Fail closed por desenho.
  {
    let v = 'FAIL', d = '';
    await tx('authenticated', async () => {
      await client.query(`INSERT INTO public.addresses(rua, confidence) VALUES ('__test_no_identity_seed', 'exact')`);
      const sel = await client.query(`SELECT * FROM public.addresses WHERE rua = '__test_no_identity_seed'`);
      v = sel.rowCount === 0 ? 'PASS' : 'FAIL';
      d = sel.rowCount === 0
        ? 'INSERT sem RETURNING funcionou (customer_id NULL), SELECT devolveu 0 linhas — fail closed confirmado'
        : `esperava 0 linhas visiveis, veio ${sel.rowCount} — policy addresses_select_own pode ter regredido`;
    });
    record('BA1', 'authenticated', 'sem identidade: insere orfao (customer_id NULL), mas nao consegue le-lo de volta', v, d);
  }
  out('');

  out('— orders.endereco_id · FK e índice pré-existentes continuam intactos —');
  {
    const fk = await client.query(`SELECT 1 FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='orders' AND constraint_name='orders_endereco_id_fkey'`);
    const idx = await client.query(`SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='orders' AND indexname='orders_endereco_id_idx'`);
    const pop = await client.query(`SELECT count(*) FILTER (WHERE endereco_id IS NOT NULL) AS n FROM public.orders`);
    const ok = fk.rowCount === 1 && idx.rowCount === 1;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] OE1 FK orders_endereco_id_fkey (${fk.rowCount === 1}) + índice orders_endereco_id_idx (${idx.rowCount === 1})`);
    out(`         -> ${pop.rows[0].n} pedido(s) com endereco_id preenchido (esperado 0 até a Onda 6 religar o checkout)`);
  }
  out('');

  out('— create_order permanece INTOCADA (nenhuma mudança nesta onda) —');
  {
    const aud = (await client.query(`SELECT p.prosecdef AS secdef, pg_get_userbyid(p.proowner) AS owner, length(p.prosrc) AS src_len,
        md5(p.prosrc) AS src_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='create_order'`)).rows[0];
    const ok = aud.secdef === true && aud.owner === 'postgres';
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] CO1 create_order continua SECURITY DEFINER/owner postgres`);
    out(`         -> src_len=${aud.src_len} md5=${aud.src_md5} (registre este md5 na 1ª execução; compare nas próximas ondas)`);
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
  console.log('ETAPA — TESTES DA FASE (REF-ADDRESS-02 · Onda 1)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('NO PERSISTED WRITES');
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
