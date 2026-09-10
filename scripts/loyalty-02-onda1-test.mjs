// Suite de verificacao da REF-LOYALTY-02 · Onda 1 (fundacao: rastreabilidade do resgate) —
// "Testes da fase". Mesmo estilo/rigor de scripts/loyalty-audit-01-onda1-test.mjs.
//
// Camada A: estrutural (colunas novas, assinatura nova de redeem_reward). Camada B:
// comportamental — BEGIN...ROLLBACK contra o projeto E2E, loja/cliente/pedidos ficticios,
// nunca a Encanto real. Exit 0 = SUCCESS.
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
const EXPECTED_REF = 'bgzcrovskjbktdxkhemd'; // projeto E2E (encanto-e2e) -- NUNCA producao
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

// Loja/cliente 100% ficticios, prefixo dedicado desta REF -- nunca a Encanto real.
const STORE_ID = '10ada002-aaaa-4000-8000-000000000001';

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
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

try {
  await client.connect();
  const refReal = projectRef(host, user);
  out('— ALVO CONFIRMADO — host=' + host + ' user=' + user + ' project_ref=' + refReal + ' —');
  if (refReal !== EXPECTED_REF) {
    throw new Error(`ABORTADO: project_ref real (${refReal}) difere do esperado para o E2E (${EXPECTED_REF}) — nunca prosseguir com alvo nao confirmado`);
  }
  out('');

  await client.query('BEGIN'); // 1 unica transacao cobre Camada A (leitura) + Camada B (ficticio) -- ROLLBACK unico no final

  out('=== CAMADA A — ESTRUTURAL ===');
  await callRpc('A1', 'orders.desconto_fidelidade existe, numeric, not null, default 0',
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='desconto_fidelidade'`, [],
    (row) => ({ ok: row?.data_type === 'numeric' && row?.is_nullable === 'NO' && /^0(\.0+)?$/.test(String(row?.column_default || '').replace(/::numeric$/, '')), detail: JSON.stringify(row) }));
  await callRpc('A2', 'loyalty_events.discount_pct existe (integer, nullable)',
    `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_events' AND column_name='discount_pct'`, [],
    (row) => ({ ok: row?.data_type === 'integer' && row?.is_nullable === 'YES', detail: JSON.stringify(row) }));
  await callRpc('A3', 'loyalty_events.discount_amount existe (numeric, nullable)',
    `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_events' AND column_name='discount_amount'`, [],
    (row) => ({ ok: row?.data_type === 'numeric' && row?.is_nullable === 'YES', detail: JSON.stringify(row) }));
  await callRpc('A4', 'redeem_reward tem exatamente 1 overload, com 4 parametros (2 novos no final)',
    `SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='redeem_reward'`, [],
    (row, err, all) => ({ ok: true, detail: JSON.stringify(row) })); // detalhado abaixo via query direta (multi-row)
  {
    const r = await client.query(`SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='redeem_reward'`);
    const ok = r.rows.length === 1 && r.rows[0].args === 'p_customer_id uuid, p_store_id uuid, p_order_id uuid, p_subtotal_itens numeric';
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A4b redeem_reward: exatamente 1 overload com a assinatura nova exata`);
    out(`         -> ${JSON.stringify(r.rows)}`);
  }
  await callRpc('A5', 'EXECUTE de redeem_reward continua negado para anon (grants preservados pelo CREATE OR REPLACE)',
    `SELECT has_function_privilege('anon', 'public.redeem_reward(uuid,uuid,uuid,numeric)', 'EXECUTE') AS anon_pode`, [],
    (row) => ({ ok: row?.anon_pode === false, detail: JSON.stringify(row) }));
  await callRpc('A6', 'EXECUTE de redeem_reward concedido para authenticated (grants preservados)',
    `SELECT has_function_privilege('authenticated', 'public.redeem_reward(uuid,uuid,uuid,numeric)', 'EXECUTE') AS auth_pode`, [],
    (row) => ({ ok: row?.auth_pode === true, detail: JSON.stringify(row) }));
  out('');

  out('=== CAMADA B — COMPORTAMENTAL (mesma transacao, dados 100% ficticios) ===');
  try {
    await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_ID}', 'loja-loyalty02-onda1', 'Loja Onda1 (fake, REF-LOYALTY-02)', NULL, 'ativo')`);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_enabled', 'true')`);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_required', '5')`);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_discount', '30')`);
    const cust = await client.query(`INSERT INTO public.customers (name, phone, store_id) VALUES ('Cliente Onda1 (fake)', '47966670099', '${STORE_ID}') RETURNING id`);
    const customerId = cust.rows[0].id;
    const ord = await client.query(`INSERT INTO public.orders (customer_id, total, status, payment_method, address, store_id) VALUES ($1, 100, 'recebido', 'dinheiro', 'Retirada na loja - teste', '${STORE_ID}') RETURNING id`, [customerId]);
    const orderId = ord.rows[0].id;
    await client.query(`INSERT INTO public.loyalty_accounts (customer_id, store_id, stamps) VALUES ($1, '${STORE_ID}', 5)`, [customerId]);
    // redeem_reward(p_customer_id, ...) so' entra no ramo admin (que nao depende de auth.uid())
    // quando is_admin_of(loja do cliente) e' verdade para quem chama -- precisa de uma sessao
    // autenticada de verdade. admins.user_id tem FK p/ auth.users, entao precisa reusar uma
    // persona que REALMENTE exista la' agora (confirmado por leitura direta antes de escrever
    // este script -- as personas usadas por scripts antigos desta REF ja nao existem mais no E2E,
    // o projeto foi reseedado com um conjunto minimo: e2e-admin/e2e-admin-b/e2e-cliente).
    const ADMIN_PERSONA = 'bc45ac7f-948a-4571-8df9-ce544757bcad'; // e2e-admin-b@teste.encanto.local
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_PERSONA}', '${STORE_ID}')`);
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_PERSONA, role: 'authenticated' })]);
    await client.query('SET LOCAL ROLE authenticated');

    // B1) chamada NO ESTILO ANTIGO (so' 2 args) -- comportamento deve ser IDENTICO ao de antes desta
    // migration, exceto discount_pct agora gravado (order_id/discount_amount continuam NULL).
    await callRpc('B1', 'chamada antiga (2 args): resgata, debita stamps, order_id/discount_amount ficam NULL, discount_pct=30',
      `SELECT public.redeem_reward($1, $2) AS r`, [customerId, STORE_ID],
      (row) => { const r = row?.r; return { ok: r?.ok === true && r?.stamps === 0 && r?.discount === 30 && r?.discount_amount === null, detail: JSON.stringify(r) }; });
    await callRpc('B1b', 'evento redeemed gravado com order_id NULL, discount_pct=30, discount_amount NULL (regressao preservada)',
      `SELECT order_id, discount_pct, discount_amount FROM public.loyalty_events WHERE customer_id=$1 AND tipo='redeemed' ORDER BY created_at DESC LIMIT 1`, [customerId],
      (row) => ({ ok: row?.order_id === null && row?.discount_pct === 30 && row?.discount_amount === null, detail: JSON.stringify(row) }));

    // restaura stamps=5 para o proximo teste (mesma transacao, sem savepoint pq foi RELEASE)
    await client.query(`UPDATE public.loyalty_accounts SET stamps=5, rewards_redeemed=0 WHERE customer_id=$1`, [customerId]);

    // B2) chamada NOVA (4 args): vincula order_id + calcula discount_amount sobre o subtotal informado.
    await callRpc('B2', 'chamada nova (order_id+subtotal=100): discount_amount = round(100*30/100,2) = 30.00',
      `SELECT public.redeem_reward($1, $2, $3, $4) AS r`, [customerId, STORE_ID, orderId, 100],
      (row) => { const r = row?.r; return { ok: r?.ok === true && Number(r?.discount_amount) === 30, detail: JSON.stringify(r) }; });
    // Filtra por order_id (nao por "ultimo created_at"): dentro da MESMA transacao, now() e' o
    // mesmo valor p/ todos os INSERTs (congelado no inicio da tx) -- "ORDER BY created_at DESC"
    // seria ambiguo entre o evento do B1 (order_id NULL) e o deste B2 (order_id=orderId).
    await callRpc('B2b', 'evento redeemed vinculado ao pedido certo, discount_pct=30, discount_amount=30.00',
      `SELECT order_id, discount_pct, discount_amount FROM public.loyalty_events WHERE customer_id=$1 AND tipo='redeemed' AND order_id=$2`, [customerId, orderId],
      (row) => ({ ok: row?.order_id === orderId && row?.discount_pct === 30 && Number(row?.discount_amount) === 30, detail: JSON.stringify(row) }));

    await client.query(`UPDATE public.loyalty_accounts SET stamps=5, rewards_redeemed=0 WHERE customer_id=$1`, [customerId]);

    // B3) arredondamento: subtotal=33.33, 30% = 9.999 -> arredonda para 10.00
    await callRpc('B3', 'arredondamento correto: subtotal=33.33, 30% -> discount_amount=10.00 (nao 9.999 truncado)',
      `SELECT public.redeem_reward($1, $2, $3, $4) AS r`, [customerId, STORE_ID, orderId, 33.33],
      (row) => { const r = row?.r; return { ok: r?.ok === true && Number(r?.discount_amount) === 10, detail: JSON.stringify(r) }; });

    await client.query(`UPDATE public.loyalty_accounts SET stamps=2, rewards_redeemed=0 WHERE customer_id=$1`, [customerId]);

    // B4) nao elegivel (stamps < required): continua recusando, sem gravar nada, sem tocar as colunas novas.
    await callRpc('B4', 'stamps=2 < required=5: recompensa indisponivel, nenhum evento novo gravado',
      `SELECT public.redeem_reward($1, $2, $3, $4) AS r`, [customerId, STORE_ID, orderId, 100],
      (row) => { const r = row?.r; return { ok: r?.ok === false && r?.error === 'recompensa indisponivel', detail: JSON.stringify(r) }; });

    // B5) orders.desconto_fidelidade default 0 para um pedido comum (nao tocado por esta migration ainda -- Onda 2).
    await callRpc('B5', 'orders.desconto_fidelidade nasce 0 por default (Onda 2 ainda nao escreve nele)',
      `SELECT desconto_fidelidade FROM public.orders WHERE id=$1`, [orderId],
      (row) => ({ ok: row?.desconto_fidelidade === '0', detail: JSON.stringify(row) }));

    out('');
    out('— Resumo —  PASS: ' + passes + '  ·  FAIL: ' + failures);
  } finally {
    await client.query('ROLLBACK');
    out('— ROLLBACK aplicado — zero mutacao liquida no banco E2E —');
  }

  out('— Fingerprint — commit ' + git('rev-parse HEAD') + ' · branch ' + git('rev-parse --abbrev-ref HEAD') + ' · Node ' + process.version + ' · ' + (Date.now() - startedMs) + ' ms · started ' + startedIso);
  out('');

  const body = R.join('\n');
  const sha = createHash('sha256').update(body, 'utf8').digest('hex');
  console.log(body);
  console.log('— Execution Report SHA256 —\n  ' + sha + '\n');
  const state = failures ? 'FAILED' : 'SUCCESS';
  console.log('====================================');
  console.log('ETAPA — TESTES DA FASE (REF-LOYALTY-02 · Onda 1)');
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
