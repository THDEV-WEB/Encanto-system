// Suite do fluxo de pedidos com endereço estruturado (REF-ADDRESS-02 · Onda 6) — "Testes da fase".
// Mesmo molde de address-schema-test.mjs/harden-orders-rls-test.mjs: SET LOCAL ROLE anon em
// BEGIN..ROLLBACK (net-zero, nenhuma escrita persiste — inclusive os pedidos/endereços criados aqui
// são desfeitos no ROLLBACK final). Esta é a onda mais sensível da referência (único caminho de escrita
// de 100% dos pedidos), por isso a bateria cobre explicitamente:
//  - CO1: create_order SEM endereco_id (formato legado, pedidos antigos/chamadas antigas) continua
//    criando pedido normalmente, endereco_id fica NULL — compatibilidade preservada;
//  - CO2: create_order COM endereco_id válido (de um address real criado via save_structured_address
//    nesta mesma transação) grava o vínculo corretamente — orders.endereco_id = addresses.id;
//  - CO3: endereco_id malformado (não é uuid) NUNCA derruba o pedido com erro cru — create_order
//    devolve {ok:false,...} graciosamente, igual a qualquer outra validação da função;
//  - CO4: endereco_id de um uuid válido mas inexistente (viola a FK) também devolve {ok:false,...}
//    graciosamente, nunca propaga exceção crua ao chamador;
//  - CO5: idempotência (mesmo request_id) continua intacta e não duplica pedido nem endereço;
//  - CO6: assinatura da função (4 parâmetros) não mudou — CREATE OR REPLACE só alterou o corpo.
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
const SCRIPT_NAME = 'test:address-onda6-orders';

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

function record(id, role, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} <${role}> ${desc}`); out(`         -> ${detail}`);
}

const mkPhone = (n) => '4799900' + String(n).padStart(4, '0');
const mkReq = (n) => `00000000-0000-4000-8000-0000000006${String(n).padStart(2, '0')}`;

try {
  out('==================================================================');
  out(' SUITE DE PEDIDOS COM ENDEREÇO ESTRUTURADO — REF-ADDRESS-02 · Onda 6 — RELATORIO');
  out('==================================================================');
  out('BEGIN..ROLLBACK (role anon). Nenhuma escrita persiste — pedidos/enderecos criados aqui somem no ROLLBACK.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessão ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— Pré-requisito: create_order já lê endereco_id de dentro de p_order (migration aplicada) —');
  {
    const src = (await client.query(`SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='create_order'`)).rows[0];
    const ok = !!src && /p_order->>'endereco_id'/.test(src.prosrc);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] PRE1 corpo de create_order referencia p_order->>'endereco_id'`);
    out(`         -> ${ok ? 'presente' : 'AUSENTE — migration REF-ADDRESS-02-onda6-create-order.sql ainda não foi aplicada'}`);
    if (!ok) { throw new Error('Migration Onda 6 não aplicada — abortando o restante da suíte (evita falsos negativos em cascata).'); }
  }
  out('');

  // Leituras de verificação (orders/addresses) rodam com o papel de dono da conexão — igual
  // save_structured_address/create_order (SECURITY DEFINER) já fazem por dentro. anon nunca teve
  // (e não deve ter) SELECT direto em orders (HARDEN-ORDERS-RLS) — só via RPC. Alternar o papel só
  // em torno da leitura evita um falso "permission denied" que não é da migration, é do próprio teste.
  async function comoDonoDaConexao(fn) {
    await client.query('RESET ROLE');
    try { return await fn(); } finally { await client.query('SET LOCAL ROLE anon'); }
  }

  await client.query('BEGIN');
  await client.query('SET LOCAL ROLE anon');
  try {
    out('— CO1 · create_order SEM endereco_id (formato legado) continua funcionando —');
    {
      const r = (await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid) AS res`, [
        JSON.stringify({ name: 'Teste Onda6 Legado', phone: mkPhone(1) }),
        JSON.stringify({ total: 30, payment_method: 'pix', address: 'Rua Teste, 1' }),
        JSON.stringify([{ nome_produto: 'Item Teste', quantity: 1, price: 30 }]),
        mkReq(1),
      ])).rows[0].res;
      const ok = r?.ok === true && !!r.order_id;
      let enderecoOk = false, enderecoVal = null;
      if (ok) {
        const chk = await comoDonoDaConexao(() => client.query(`SELECT endereco_id FROM public.orders WHERE id = $1`, [r.order_id]));
        enderecoVal = chk.rows[0]?.endereco_id ?? '(sem linha)';
        enderecoOk = chk.rows[0]?.endereco_id === null;
      }
      const verdict = (ok && enderecoOk) ? 'PASS' : 'FAIL';
      record('CO1', 'anon', 'pedido sem endereco_id -> criado, orders.endereco_id fica NULL (compat. legado)', verdict,
        `create_order: ${JSON.stringify(r)} · orders.endereco_id lido = ${enderecoVal}`);
    }
    out('');

    out('— CO2 · create_order COM endereco_id válido vincula corretamente —');
    {
      const addrPayload = JSON.stringify({
        rua: 'Rua Onda6 Teste', numero: '42', bairro: 'Centro', cidade: 'Timbó', estado: 'SC',
        cep: '89120-000', provider: 'nominatim', confidence: 'exact',
      });
      const addrId = (await client.query(`SELECT public.save_structured_address($1::jsonb) AS id`, [addrPayload])).rows[0]?.id;
      const r = (await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid) AS res`, [
        JSON.stringify({ name: 'Teste Onda6 Vinculado', phone: mkPhone(2) }),
        JSON.stringify({ total: 45, payment_method: 'dinheiro', address: 'Rua Onda6 Teste, 42', endereco_id: addrId }),
        JSON.stringify([{ nome_produto: 'Item Teste 2', quantity: 1, price: 45 }]),
        mkReq(2),
      ])).rows[0].res;
      const ok = r?.ok === true && !!r.order_id;
      let vinculoOk = false, lido = null;
      if (ok) {
        const chk = await comoDonoDaConexao(() => client.query(`SELECT o.endereco_id, a.rua FROM public.orders o JOIN public.addresses a ON a.id = o.endereco_id WHERE o.id = $1`, [r.order_id]));
        lido = chk.rows[0];
        vinculoOk = chk.rowCount === 1 && lido.endereco_id === addrId && lido.rua === 'Rua Onda6 Teste';
      }
      const verdict = (ok && vinculoOk) ? 'PASS' : 'FAIL';
      record('CO2', 'anon', 'orders.endereco_id = addresses.id (join real confirma rua gravada)', verdict,
        `addrId=${addrId} · create_order: ${JSON.stringify(r)} · join=${JSON.stringify(lido)}`);
    }
    out('');

    out('— CO3 · endereco_id malformado (não-uuid) NUNCA derruba o pedido com erro cru —');
    {
      let verdict = 'FAIL', detail = '';
      try {
        const r = (await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid) AS res`, [
          JSON.stringify({ name: 'Teste Onda6 Malformado', phone: mkPhone(3) }),
          JSON.stringify({ total: 10, payment_method: 'pix', address: 'Rua X', endereco_id: 'nao-e-um-uuid' }),
          JSON.stringify([{ nome_produto: 'Item Teste 3', quantity: 1, price: 10 }]),
          mkReq(3),
        ])).rows[0].res;
        verdict = (r?.ok === false && !!r.error) ? 'PASS' : 'FAIL';
        detail = 'resposta graciosa (sem exceção crua): ' + JSON.stringify(r);
      } catch (e) {
        verdict = 'FAIL'; detail = `EXCEÇÃO CRUA propagada ao chamador (não deveria): ${e.code} ${redact(e.message)}`;
      }
      record('CO3', 'anon', 'endereco_id invalido -> {ok:false,...} gracioso, nunca exceção crua', verdict, detail);
    }
    out('');

    out('— CO4 · endereco_id válido porém inexistente (viola FK) também é gracioso —');
    {
      let verdict = 'FAIL', detail = '';
      try {
        const r = (await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid) AS res`, [
          JSON.stringify({ name: 'Teste Onda6 FK', phone: mkPhone(4) }),
          JSON.stringify({ total: 10, payment_method: 'pix', address: 'Rua Y', endereco_id: '00000000-0000-4000-8000-000000000000' }),
          JSON.stringify([{ nome_produto: 'Item Teste 4', quantity: 1, price: 10 }]),
          mkReq(4),
        ])).rows[0].res;
        verdict = (r?.ok === false && !!r.error) ? 'PASS' : 'FAIL';
        detail = 'resposta graciosa (sem exceção crua): ' + JSON.stringify(r);
      } catch (e) {
        verdict = 'FAIL'; detail = `EXCEÇÃO CRUA propagada ao chamador (não deveria): ${e.code} ${redact(e.message)}`;
      }
      record('CO4', 'anon', 'endereco_id inexistente (FK) -> {ok:false,...} gracioso, nunca exceção crua', verdict, detail);
    }
    out('');

    out('— CO5 · idempotência (mesmo request_id) continua intacta com endereco_id no payload —');
    {
      const addrPayload = JSON.stringify({ rua: 'Rua Onda6 Idempotencia', numero: '7', confidence: 'street_level' });
      const addrId = (await client.query(`SELECT public.save_structured_address($1::jsonb) AS id`, [addrPayload])).rows[0]?.id;
      const args = [
        JSON.stringify({ name: 'Teste Onda6 Idempotente', phone: mkPhone(5) }),
        JSON.stringify({ total: 20, payment_method: 'pix', address: 'Rua Onda6 Idempotencia, 7', endereco_id: addrId }),
        JSON.stringify([{ nome_produto: 'Item Teste 5', quantity: 1, price: 20 }]),
        mkReq(5),
      ];
      const r1 = (await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid) AS res`, args)).rows[0].res;
      const r2 = (await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid) AS res`, args)).rows[0].res;
      const cnt = await comoDonoDaConexao(() => client.query(`SELECT count(*) AS n FROM public.orders WHERE request_id = $1`, [mkReq(5)]));
      const ok = r1?.ok === true && r2?.ok === true && r2.idempotent === true && r1.order_id === r2.order_id && cnt.rows[0].n === '1';
      record('CO5', 'anon', 'reenvio mesmo request_id -> mesmo order_id, idempotent:true, 1 única linha', ok ? 'PASS' : 'FAIL',
        `r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)} count=${cnt.rows[0].n}`);
    }
    out('');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }

  // REF-SAAS-01 · Onda 4.1 (2026-08-08): create_order ganhou um 5º parâmetro (p_store_id uuid, com
  // DEFAULT) para suportar multi-loja — mudança arquitetural deliberada, documentada em
  // docs/ref/REF-SAAS-01-plano-ondas.md. O invariante que importa deixou de ser "a assinatura nunca
  // muda" e passou a ser "os 4 parâmetros originais mantêm nome/tipo/ordem, e anon/authenticated
  // continuam com EXECUTE" — checado explicitamente abaixo (o DROP FUNCTION + CREATE OR REPLACE
  // daquela migration recria o objeto no catálogo, o que já resetou o ACL de create_order uma vez
  // nesta mesma REF; corrigido, mas este teste passa a vigiar isso também).
  out('— CO6 · assinatura de create_order evoluiu (REF-SAAS-01 Onda 4.1 — ganhou p_store_id); 4 parâmetros originais + grants anon/authenticated preservados —');
  {
    const sig = (await client.query(`SELECT pronargs, proargtypes::regtype[]::text[] AS tipos FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='create_order'`)).rows[0];
    const acl = (await client.query(`SELECT proacl::text AS acl FROM pg_proc WHERE proname='create_order' AND pronamespace='public'::regnamespace`)).rows[0].acl;
    const assinaturaOk = sig.pronargs === 5 && JSON.stringify(sig.tipos) === JSON.stringify(['jsonb', 'jsonb', 'jsonb', 'uuid', 'uuid']);
    const grantsOk = /anon=X/.test(acl) && /authenticated=X/.test(acl);
    const ok = assinaturaOk && grantsOk;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] CO6 5 parâmetros (jsonb,jsonb,jsonb,uuid,uuid — o 5º é p_store_id) e grants anon/authenticated intactos`);
    out(`         -> pronargs=${sig.pronargs} tipos=${JSON.stringify(sig.tipos)} · acl=${acl}`);
  }
  out('');

  out('— Confirmação pós-ROLLBACK: nada persistiu (contagem de pedidos de teste = 0) —');
  {
    const c = await client.query(`SELECT count(*) AS n FROM public.orders WHERE request_id = ANY($1)`, [[mkReq(1), mkReq(2), mkReq(3), mkReq(4), mkReq(5)]]);
    const ok = c.rows[0].n === '0';
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] RB1 nenhum dos 5 pedidos de teste sobrou após o ROLLBACK`);
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
  console.log('ETAPA — TESTES DA FASE (REF-ADDRESS-02 · Onda 6)');
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
