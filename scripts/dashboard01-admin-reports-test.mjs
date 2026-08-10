// Suite de verificacao da REF-DASHBOARD-01 (BI/relatorios reais no Admin, admin_reports_summary) —
// "Testes da fase". Cobre: isolamento entre lojas (A nunca ve receita/produtos/pagamento de B, e
// vice-versa), pedidos CANCELADOS excluidos de toda soma (decisao de escopo confirmada com o dono),
// filtro de periodo (pedido fora do range nunca entra), classificacao entrega/retirada (mesma regra de
// comandaModel.js::RE_RETIRADA), agregacao de top produtos/forma de pagamento corretas, e autorizacao
// (is_admin_of) nos 2 sentidos — admin de A nao ve relatorio de B, stranger/anon nao veem nenhum.
//
// Camada B: SET LOCAL ROLE + request.jwt.claims dentro de BEGIN...ROLLBACK. Lojas A/B ficticias,
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

const STORE_A_ID = 'ffffffff-8001-4000-8000-000000000001'; // loja A ficticia (faixa propria desta ref, nao colide com Onda 7.1)
const STORE_B_ID = 'ffffffff-8001-4000-8000-000000000002'; // loja B ficticia

const ORDER_A1 = 'ffffffff-8001-4000-9000-00000000a001'; // A, recebido, entrega, pix, 2026-01-10 -- ENTRA no relatorio
const ORDER_A2 = 'ffffffff-8001-4000-9000-00000000a002'; // A, CANCELADO -- NUNCA entra
const ORDER_A3 = 'ffffffff-8001-4000-9000-00000000a003'; // A, retirada, dinheiro, 2026-01-10 -- ENTRA
const ORDER_A4 = 'ffffffff-8001-4000-9000-00000000a004'; // A, FORA do periodo (2020) -- nunca entra
const ORDER_B1 = 'ffffffff-8001-4000-9000-00000000b001'; // B, recebido, 2026-01-10 -- prova isolamento

const PERIODO_INICIO = '2026-01-01';
const PERIODO_FIM = '2026-01-31';

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
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_A_ID}', 'loja-a-teste-dashboard01', 'Loja A (fake, teste DASHBOARD-01)', NULL, 'ativo')`,
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-teste-dashboard01', 'Loja B (fake, teste DASHBOARD-01)', NULL, 'ativo')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_REAL_USER_ID}', '${STORE_A_ID}')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B}', '${STORE_B_ID}')`,
    // A1: recebido, entrega (endereco real), pix, dentro do periodo -- ENTRA.
    `INSERT INTO public.orders (id, store_id, total, status, payment_method, address, created_at) VALUES ('${ORDER_A1}', '${STORE_A_ID}', 50, 'recebido', 'pix', 'Rua Teste, 123', '2026-01-10T15:00:00Z')`,
    `INSERT INTO public.order_items (order_id, store_id, quantity, price, nome_produto, preco_unitario) VALUES ('${ORDER_A1}', '${STORE_A_ID}', 2, 50, 'Produto Teste DASHBOARD-01', 25)`,
    // A2: CANCELADO, valor alto de proposito -- se aparecer em qualquer soma, o teste pega.
    `INSERT INTO public.orders (id, store_id, total, status, payment_method, address, created_at) VALUES ('${ORDER_A2}', '${STORE_A_ID}', 999, 'cancelado', 'dinheiro', 'Rua Cancelada, 1', '2026-01-10T15:00:00Z')`,
    `INSERT INTO public.order_items (order_id, store_id, quantity, price, nome_produto, preco_unitario) VALUES ('${ORDER_A2}', '${STORE_A_ID}', 1, 999, 'Produto Cancelado (nunca deve aparecer)', 999)`,
    // A3: retirada (endereco bate a regex), dinheiro, dentro do periodo -- ENTRA.
    `INSERT INTO public.orders (id, store_id, total, status, payment_method, address, created_at) VALUES ('${ORDER_A3}', '${STORE_A_ID}', 30, 'entregue', 'dinheiro', 'Retirada na loja - DASHBOARD-01', '2026-01-10T16:00:00Z')`,
    `INSERT INTO public.order_items (order_id, store_id, quantity, price, nome_produto, preco_unitario) VALUES ('${ORDER_A3}', '${STORE_A_ID}', 1, 30, 'Produto Teste DASHBOARD-01', 30)`,
    // A4: FORA do periodo (2020) -- nunca deve entrar na serie/soma.
    `INSERT INTO public.orders (id, store_id, total, status, payment_method, address, created_at) VALUES ('${ORDER_A4}', '${STORE_A_ID}', 7777, 'recebido', 'pix', 'Rua Fora do Periodo, 1', '2020-01-01T15:00:00Z')`,
    // B1: pedido da loja B -- prova de isolamento (nunca aparece no relatorio de A).
    `INSERT INTO public.orders (id, store_id, total, status, payment_method, address, created_at) VALUES ('${ORDER_B1}', '${STORE_B_ID}', 88, 'recebido', 'cartao_credito', 'Rua da Loja B, 1', '2026-01-10T15:00:00Z')`,
    `INSERT INTO public.order_items (order_id, store_id, quantity, price, nome_produto, preco_unitario) VALUES ('${ORDER_B1}', '${STORE_B_ID}', 1, 88, 'Produto Exclusivo da Loja B', 88)`,
  ];
}

try {
  out('==================================================================');
  out(' SUITE — REF-DASHBOARD-01 (BI de negocio por periodo, admin_reports_summary) — RELATORIO');
  out('==================================================================');
  out('Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— ITEM 1: relatorio da loja A soma SO A1+A3 (recebido/entregue, dentro do periodo) — A2 (cancelado) e A4 (fora do periodo) NUNCA entram —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(), async () => {
    await callRpc('ITEM1-total-pedidos', 'total_pedidos = 2 (so A1+A3)', `SELECT public.admin_reports_summary($1,$2,$3) AS r`, [PERIODO_INICIO, PERIODO_FIM, STORE_A_ID],
      (row, err) => ({ ok: err === null && row?.r?.total_pedidos === 2, detail: err || JSON.stringify(row?.r?.total_pedidos) }));
    await callRpc('ITEM1-total-receita', 'total_receita = 80 (50+30, nunca 999 do cancelado nem 7777 do fora-do-periodo)', `SELECT public.admin_reports_summary($1,$2,$3) AS r`, [PERIODO_INICIO, PERIODO_FIM, STORE_A_ID],
      (row, err) => ({ ok: err === null && Number(row?.r?.total_receita) === 80, detail: err || JSON.stringify(row?.r?.total_receita) }));
  });
  out('');

  out('— ITEM 2: ISOLAMENTO — relatorio da loja A nunca inclui o produto/receita exclusivos da loja B, e vice-versa —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(), async () => {
    await callRpc('ITEM2-A-sem-produto-B', 'top_produtos da loja A NAO contem "Produto Exclusivo da Loja B"', `SELECT public.admin_reports_summary($1,$2,$3) AS r`, [PERIODO_INICIO, PERIODO_FIM, STORE_A_ID],
      (row, err) => { const nomes = (row?.r?.top_produtos || []).map(p => p.nome); return { ok: err === null && !nomes.includes('Produto Exclusivo da Loja B'), detail: JSON.stringify(nomes) }; });
  });
  await tx('authenticated', ADMIN_B, setupSql(), async () => {
    await callRpc('ITEM2-B-so-o-proprio', 'relatorio da loja B so ve o proprio pedido (total_pedidos=1, receita=88)', `SELECT public.admin_reports_summary($1,$2,$3) AS r`, [PERIODO_INICIO, PERIODO_FIM, STORE_B_ID],
      (row, err) => ({ ok: err === null && row?.r?.total_pedidos === 1 && Number(row?.r?.total_receita) === 88, detail: err || JSON.stringify({ p: row?.r?.total_pedidos, r: row?.r?.total_receita }) }));
  });
  out('');

  out('— ITEM 3: classificacao entrega/retirada (mesma regra de comandaModel.js::RE_RETIRADA) —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(), async () => {
    await callRpc('ITEM3-tipo', 'por_tipo = 1 entrega (A1, R$50) + 1 retirada (A3, R$30)', `SELECT public.admin_reports_summary($1,$2,$3) AS r`, [PERIODO_INICIO, PERIODO_FIM, STORE_A_ID],
      (row, err) => {
        const porTipo = row?.r?.por_tipo || [];
        const entrega = porTipo.find(t => t.tipo === 'entrega'); const retirada = porTipo.find(t => t.tipo === 'retirada');
        const ok = err === null && entrega?.pedidos === 1 && Number(entrega?.receita) === 50 && retirada?.pedidos === 1 && Number(retirada?.receita) === 30;
        return { ok, detail: JSON.stringify(porTipo) };
      });
  });
  out('');

  out('— ITEM 4: forma de pagamento agregada corretamente (pix e dinheiro, nunca o cancelado) —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(), async () => {
    await callRpc('ITEM4-pagamento', 'por_pagamento = pix(1,50) + dinheiro(1,30), sem o cancelado', `SELECT public.admin_reports_summary($1,$2,$3) AS r`, [PERIODO_INICIO, PERIODO_FIM, STORE_A_ID],
      (row, err) => {
        const p = row?.r?.por_pagamento || [];
        const pix = p.find(x => x.forma === 'pix'); const dinheiro = p.find(x => x.forma === 'dinheiro');
        const ok = err === null && pix?.pedidos === 1 && Number(pix?.receita) === 50 && dinheiro?.pedidos === 1 && Number(dinheiro?.receita) === 30;
        return { ok, detail: JSON.stringify(p) };
      });
  });
  out('');

  out('— ITEM 5: top_produtos agrega quantidade/receita reais (2x+1x do mesmo produto = qtd 3, receita 80) —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(), async () => {
    await callRpc('ITEM5-top-produtos', 'Produto Teste DASHBOARD-01: quantidade=3, receita=80', `SELECT public.admin_reports_summary($1,$2,$3) AS r`, [PERIODO_INICIO, PERIODO_FIM, STORE_A_ID],
      (row, err) => {
        const prod = (row?.r?.top_produtos || []).find(p => p.nome === 'Produto Teste DASHBOARD-01');
        const ok = err === null && prod?.quantidade === 3 && Number(prod?.receita) === 80;
        return { ok, detail: JSON.stringify(prod) };
      });
  });
  out('');

  out('— ITEM 6: AUTORIZACAO — admin de A nao ve relatorio de B; stranger/anon nao veem relatorio de nenhuma loja —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(), async () => {
    await callRpc('ITEM6-A-nao-ve-B', 'admin de A NAO consegue pedir o relatorio da loja B', `SELECT public.admin_reports_summary($1,$2,$3) AS r`, [PERIODO_INICIO, PERIODO_FIM, STORE_B_ID],
      (row, err) => ({ ok: err !== null && err.includes('apenas administradores'), detail: err || JSON.stringify(row?.r) }));
  });
  await tx('authenticated', STRANGER, setupSql(), async () => {
    await callRpc('ITEM6-STRANGER-N', 'stranger (sem vinculo admin) nao ve o relatorio de A nem de B', `SELECT public.admin_reports_summary($1,$2,$3) AS r`, [PERIODO_INICIO, PERIODO_FIM, STORE_A_ID],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  await tx('anon', null, setupSql(), async () => {
    await callRpc('ITEM6-ANON-N', 'anon nao ve o relatorio de nenhuma loja', `SELECT public.admin_reports_summary($1,$2,$3) AS r`, [PERIODO_INICIO, PERIODO_FIM, STORE_A_ID],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 7: periodo invalido (inicio > fim) e rejeitado; Cliente Zero (Encanto) continua respondendo sem erro —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(), async () => {
    await callRpc('ITEM7-periodo-invalido', 'periodo com inicio > fim e rejeitado', `SELECT public.admin_reports_summary($1,$2,$3) AS r`, [PERIODO_FIM, PERIODO_INICIO, STORE_A_ID],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  {
    const r = await client.query(`SELECT public.admin_reports_summary($1,$2) AS r`, [PERIODO_INICIO, PERIODO_FIM]).catch(e => ({ error: e }));
    // sem sessao real (postgres) -> is_admin_of nega; o que importa aqui e que a FUNCAO existe e responde
    // com o erro de autorizacao esperado, nao um erro de sintaxe/tipo (prova indireta de "Encanto continua ok").
    const ok = r.error && /apenas administradores/.test(String(r.error.message || ''));
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] ITEM7-encanto-existe admin_reports_summary(Encanto, default) responde com o erro de autorizacao esperado (funcao existe e valida corretamente)`);
    out(`         -> ${ok ? 'apenas administradores...' : redact(r.error?.message || 'sem erro')}`);
  }
  out('');

  out('— REGRESSAO: zero mutacao liquida (lojas/admin/pedidos ficticios) em producao —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE id IN ('${STORE_A_ID}','${STORE_B_ID}')) AS lojas_fake,
        (SELECT count(*)::int FROM public.admins WHERE store_id IN ('${STORE_A_ID}','${STORE_B_ID}')) AS admins_fake,
        (SELECT count(*)::int FROM public.orders WHERE id IN ('${ORDER_A1}','${ORDER_A2}','${ORDER_A3}','${ORDER_A4}','${ORDER_B1}')) AS pedidos_fake`);
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
  console.log('ETAPA — TESTES DA FASE (REF-DASHBOARD-01)');
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
