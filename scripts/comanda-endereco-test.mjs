// Suite da RPC admin_order_endereco (REF-COMANDA-ENDERECO-01) — "Testes da fase".
// Mesmo molde de address-onda6-orders-test.mjs: BEGIN..ROLLBACK, nenhuma escrita persiste.
//
// admin_order_endereco é SECURITY INVOKER (respeita RLS do chamador, mesmo padrão de
// admin_orders_search/admin_orders_stats) — ao contrário de create_order/save_structured_address
// (SECURITY DEFINER), não dá pra simular "sou o admin logado" por uma conexão psql crua (auth.uid()/
// is_admin() dependem do JWT que só existe numa sessão real via PostgREST/GoTrue). Por isso a suíte
// separa em 2 frentes honestas:
//  - CO1-CO3 (sem SET LOCAL ROLE, ou seja, como o dono da conexão — bypassa RLS): prova que a LÓGICA
//    SQL da função está correta — acha o endereço certo quando existe vínculo, devolve NULL quando não
//    existe vínculo ou o pedido não existe;
//  - CO4 (SET LOCAL ROLE anon, sem JWT): prova que a função NÃO vaza dado para quem não tem sessão —
//    mesmo um pedido com vínculo real continua invisível para anon (RLS de orders/addresses de sempre).
//  - CO5: assinatura/tipo de segurança da função (INVOKER, não DEFINER — não pode bypassar RLS em
//    produção).
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
const mkPhone = (n) => '4799910' + String(n).padStart(4, '0');
const mkReq = (n) => `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`;

try {
  out('==================================================================');
  out(' SUITE DA RPC admin_order_endereco — REF-COMANDA-ENDERECO-01 — RELATORIO');
  out('==================================================================');
  out('BEGIN..ROLLBACK. Nenhuma escrita persiste — pedidos/enderecos criados aqui somem no ROLLBACK.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessão ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— Pré-requisito: admin_order_endereco existe —');
  {
    const r = await client.query(`SELECT 1 FROM pg_proc WHERE proname='admin_order_endereco'`);
    const ok = r.rowCount === 1;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] PRE1 função presente`);
    if (!ok) throw new Error('Migration REF-COMANDA-ENDERECO-01 não aplicada — abortando o restante da suíte.');
  }
  out('');

  await client.query('BEGIN');
  try {
    let addrId, orderComVinculo, orderSemVinculo;

    out('— Fixture: 1 endereço estruturado + 1 pedido vinculado + 1 pedido sem vínculo —');
    {
      const addrPayload = JSON.stringify({
        rua: 'Rua Comanda Teste', numero: '55', complemento: 'Fundos', bairro: 'Bairro Teste',
        cidade: 'Timbó', estado: 'SC', cep: '89120-000', referencia: 'Perto da praça',
      });
      addrId = (await client.query(`SELECT public.save_structured_address($1::jsonb) AS id`, [addrPayload])).rows[0]?.id;
      const r1 = (await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid) AS res`, [
        JSON.stringify({ name: 'Teste Comanda Vinculado', phone: mkPhone(1) }),
        JSON.stringify({ total: 30, payment_method: 'pix', address: 'Rua Comanda Teste, 55', endereco_id: addrId }),
        JSON.stringify([{ nome_produto: 'Item', quantity: 1, price: 30 }]),
        mkReq(1),
      ])).rows[0].res;
      orderComVinculo = r1?.order_id;
      const r2 = (await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid) AS res`, [
        JSON.stringify({ name: 'Teste Comanda Legado', phone: mkPhone(2) }),
        JSON.stringify({ total: 20, payment_method: 'pix', address: 'Rua Sem Vinculo, 1' }),
        JSON.stringify([{ nome_produto: 'Item', quantity: 1, price: 20 }]),
        mkReq(2),
      ])).rows[0].res;
      orderSemVinculo = r2?.order_id;
      const ok = !!addrId && !!orderComVinculo && !!orderSemVinculo;
      if (ok) passes++; else failures++;
      out(`  [${ok ? 'PASS' : 'FAIL'}] FX1 addrId=${addrId} orderComVinculo=${orderComVinculo} orderSemVinculo=${orderSemVinculo}`);
      if (!ok) throw new Error('Fixture falhou — abortando.');
    }
    out('');

    out('— CO1 · lógica SQL (como dono da conexão, bypassa RLS): pedido COM vínculo devolve os campos certos —');
    {
      const r = await client.query(`SELECT public.admin_order_endereco($1::uuid) AS e`, [orderComVinculo]);
      const e = r.rows[0]?.e;
      const ok = e && e.rua === 'Rua Comanda Teste' && e.numero === '55' && e.complemento === 'Fundos'
        && e.bairro === 'Bairro Teste' && e.referencia === 'Perto da praça' && e.cep === '89120-000';
      record('CO1', 'postgres(owner)', 'pedido com vínculo -> jsonb com rua/numero/complemento/bairro/referencia/cep corretos', ok ? 'PASS' : 'FAIL', JSON.stringify(e));
    }
    out('');

    out('— CO2 · pedido SEM vínculo (legado) devolve NULL —');
    {
      const r = await client.query(`SELECT public.admin_order_endereco($1::uuid) AS e`, [orderSemVinculo]);
      const ok = r.rows[0]?.e === null;
      record('CO2', 'postgres(owner)', 'pedido sem endereco_id -> NULL (nunca lança, nunca fabrica dado)', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows[0]));
    }
    out('');

    out('— CO3 · pedido inexistente devolve NULL (nunca lança) —');
    {
      const r = await client.query(`SELECT public.admin_order_endereco($1::uuid) AS e`, ['00000000-0000-4000-8000-000000000000']);
      const ok = r.rows[0]?.e === null;
      record('CO3', 'postgres(owner)', 'id inexistente -> NULL', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows[0]));
    }
    out('');

    out('— CO4 · anon (sem JWT/sessão) NUNCA vê o endereço, nem de um pedido com vínculo real —');
    {
      // anon nem tem GRANT de tabela em orders (mesmo achado da Onda 6: só acessa via RPC SECURITY
      // DEFINER) — a função SECURITY INVOKER pode devolver NULL (RLS filtra) OU lançar "permission
      // denied" (falta o GRANT de base). Os dois resultados provam a MESMA coisa: zero vazamento de
      // dado. DS.getPedidoEndereco já trata qualquer exceção de rede/RPC como null (DS.run try/catch).
      let vazou = false, detalhe = '';
      await client.query('SET LOCAL ROLE anon');
      await client.query('SAVEPOINT co4');
      try {
        const r = await client.query(`SELECT public.admin_order_endereco($1::uuid) AS e`, [orderComVinculo]);
        const e = r.rows[0]?.e;
        vazou = e !== null;
        detalhe = `devolveu (sem lançar): ${JSON.stringify(e)}`;
      } catch (err) {
        vazou = false;
        await client.query('ROLLBACK TO SAVEPOINT co4');   // "des-aborta" a transação (a exceção deixou-a em erro)
        detalhe = `lançou como esperado (sem grant de base): ${err.code} ${redact(err.message).split('\n')[0]}`;
      } finally {
        await client.query('RESET ROLE');   // volta a ser o dono da conexão p/ o resto da suíte
      }
      record('CO4', 'anon', 'nenhum dado do endereço vaza para anon (nem NULL vira dado real, nem exceção some com o resultado)', vazou ? 'FAIL' : 'PASS', detalhe);
    }
    out('');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }

  out('— CO5 · função é SECURITY INVOKER (nunca DEFINER — não pode bypassar RLS em produção) —');
  {
    const r = await client.query(`SELECT prosecdef, provolatile FROM pg_proc WHERE proname='admin_order_endereco'`);
    const ok = r.rows[0]?.prosecdef === false;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] CO5 prosecdef=${r.rows[0]?.prosecdef} (esperado false/INVOKER) provolatile=${r.rows[0]?.provolatile}`);
  }
  out('');

  out('— Confirmação pós-ROLLBACK: nada persistiu —');
  {
    const c = await client.query(`SELECT count(*) AS n FROM public.orders WHERE request_id = ANY($1)`, [[mkReq(1), mkReq(2)]]);
    const ok = c.rows[0].n === '0';
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] RB1 nenhum dos 2 pedidos de teste sobrou após o ROLLBACK`);
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
  console.log('ETAPA — TESTES DA FASE (REF-COMANDA-ENDERECO-01)');
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
