// REF-PAYMENT-SEC-02 · Onda 5 -- valida contra o banco (E2E dedicado, NUNCA producao) que
// orders.payment_status nao pode mais ser alterado fora do fluxo de pagamento (achado MEDIUM-03 da
// REF-PAYMENT-SEC-01). Cobre os testes adversariais 15/16 da secao 12 da REF-PAYMENT-SEC-02:
//   - cliente (authenticated comum) tenta UPDATE orders SET payment_status='aprovado' -> DENIED
//   - admin (authenticated + is_admin_of) tenta o MESMO UPDATE direto -> DENIED (so' RPC autorizado)
//   - fluxo legitimo (RPCs de pagamento, como service_role/postgres) continua funcionando -> OK
//   - outros campos de orders (status operacional, observacoes) continuam editaveis por admin -> OK
// Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = process.argv.includes('--prod')
  ? 'C:/Users/00thi/.encanto/db.env'
  : 'C:/Users/00thi/.encanto/db.e2e.env';
if (process.argv.includes('--prod')) { console.error('ABORTADO: este script nunca roda contra producao.'); process.exit(2); }

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const password = envGet(txt, 'PGPASSWORD');
  if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: envGet(txt, 'PGHOST'), port: Number(envGet(txt, 'PGPORT') || 5432), user: envGet(txt, 'PGUSER'), password, database: envGet(txt, 'PGDATABASE') || 'postgres' };
}
const conn = loadConn();
console.log(`Ambiente confirmado: ${conn.host} (${ENV_PATH})`);
const client = new pg.Client({ ...conn, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}
async function withTx(fn) {
  await client.query('BEGIN');
  try { return await fn(); } finally { await client.query('ROLLBACK'); }
}

// e2e-admin@teste.encanto.local -- fixture real (auth.users), ja vinculado como admin em ondas
// anteriores desta mesma plataforma de testes.
const ADMIN_AUTH_UID = '1265c4c1-32b8-4125-9831-25cf57541dc5';
const CLIENTE_AUTH_UID = '5662cd2f-725d-429c-9701-960553ebbcbd'; // e2e-cliente@teste.encanto.local

async function main() {
  await client.connect();
  const STORE = randomUUID();

  console.log('==========================================================================');
  console.log(' REF-PAYMENT-SEC-02 (Onda 5) · guard de orders.payment_status (E2E)');
  console.log('==========================================================================\n');

  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste SEC02 Onda5','ativo')`, [STORE, `payment-sec-02-onda5-${Date.now()}`]);
  await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ADMIN_AUTH_UID, STORE]);

  const orderId = randomUUID();
  const setupOrder = () => client.query(
    `INSERT INTO public.orders (id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido, payment_status)
     VALUES ($1,25.00,'aguardando_pagamento','online','Retirada na loja',$2,'retirada','storefront',NULL)`,
    [orderId, STORE]
  );

  try {
    // ══ ADVERSARIAL 15: cliente comum (authenticated, nao-admin) tenta forjar aprovacao ═════════
    // Nao-admin nao tem NENHUMA policy de UPDATE em orders -- RLS ja barra silenciosamente (0 linhas
    // afetadas, sem excecao). O teste real e' checar o valor PERSISTIDO (via conexao postgres,
    // depois do rollback nao importa) -- nao basta checar "lancou erro?", porque RLS nao lanca.
    await withTx(async () => {
      await setupOrder();
      await client.query(`SET LOCAL role authenticated`);
      await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: CLIENTE_AUTH_UID, role: 'authenticated' })}'`);
      let excecao = false, msg = '';
      let rowCount = -1;
      try {
        const r = await client.query(`UPDATE public.orders SET payment_status = 'aprovado' WHERE id = $1`, [orderId]);
        rowCount = r.rowCount;
      } catch (e) { excecao = true; msg = e.message; }
      // RESET pra conferir o valor persistido de verdade -- o proprio SELECT como "cliente" tambem
      // seria filtrado por RLS (customer_id nulo neste pedido de teste nao bate com nenhum customer
      // do chamador), entao a verificacao precisa de um role sem essa restricao.
      await client.query(`RESET ROLE`);
      const depois = await client.query(`SELECT payment_status FROM public.orders WHERE id = $1`, [orderId]);
      const naoMudou = depois.rows[0]?.payment_status !== 'aprovado';
      check('Teste 15 · cliente comum tenta UPDATE payment_status=aprovado -> DENIED (RLS: 0 linhas, sem UPDATE policy pra nao-admin)',
        naoMudou, `excecao=${excecao} rowCount=${rowCount} valor_final=${depois.rows[0].payment_status} ${msg}`);
    });

    // ══ ADVERSARIAL 16: ADMIN (autenticado, is_admin_of=true) tenta o MESMO UPDATE direto ═══════
    await withTx(async () => {
      await setupOrder();
      await client.query(`SET LOCAL role authenticated`);
      await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: ADMIN_AUTH_UID, role: 'authenticated' })}'`);
      // confirma que este admin de fato passaria pela RLS (is_admin_of) se nao fosse o guard --
      // prova que quem bloqueia e' O TRIGGER, nao falta de permissao RLS.
      const podeVerRLS = await client.query(`SELECT public.is_admin_of($1::uuid) AS is_admin`, [STORE]);
      let negado = false, msg = '';
      try {
        await client.query(`UPDATE public.orders SET payment_status = 'aprovado', observacoes = 'tentativa admin' WHERE id = $1`, [orderId]);
      } catch (e) { negado = true; msg = e.message; }
      check('Teste 16 · ADMIN (is_admin_of=true, RLS permitiria) tenta UPDATE direto -> DENIED pelo trigger',
        negado && podeVerRLS.rows[0].is_admin === true, `is_admin=${podeVerRLS.rows[0].is_admin} erro=${msg}`);
    });

    // ── Regressao: admin AINDA consegue editar outros campos normalmente (nao e' um "ALL UPDATE" quebrado) ──
    await withTx(async () => {
      await setupOrder();
      await client.query(`SET LOCAL role authenticated`);
      await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: ADMIN_AUTH_UID, role: 'authenticated' })}'`);
      await client.query(`UPDATE public.orders SET status = 'preparo', observacoes = 'operacional normal' WHERE id = $1`, [orderId]);
      const r = await client.query(`SELECT status, observacoes FROM public.orders WHERE id = $1`, [orderId]);
      check('Regressao · admin continua editando status/observacoes normalmente (payment_status intocado)',
        r.rows[0].status === 'preparo' && r.rows[0].observacoes === 'operacional normal', JSON.stringify(r.rows[0]));
    });

    // ── Regressao: UPDATE que NAO muda payment_status (mesmo valor, NULL->NULL) nunca dispara o guard ──
    await withTx(async () => {
      await setupOrder();
      await client.query(`SET LOCAL role authenticated`);
      await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: ADMIN_AUTH_UID, role: 'authenticated' })}'`);
      let ok = true, msg = '';
      try {
        await client.query(`UPDATE public.orders SET payment_status = NULL WHERE id = $1`, [orderId]); // NULL -> NULL, IS DISTINCT FROM = false
      } catch (e) { ok = false; msg = e.message; }
      check('Regressao · UPDATE que nao MUDA payment_status (NULL->NULL) nao dispara o guard', ok, msg);
    });

    // ══ Fluxo legitimo: _processar_webhook_payment_intent (via service_role) continua funcionando ══
    await withTx(async () => {
      await setupOrder();
      const pi = randomUUID();
      await client.query(
        `INSERT INTO public.payment_intents (id, store_id, order_id, amount, status, mp_payment_id) VALUES ($1,$2,$3,25.00,'pendente',$4)`,
        [pi, STORE, orderId, `mp-onda5-${Date.now()}`]
      );
      await client.query(`SET LOCAL role service_role`);
      const mpId = (await client.query(`SELECT mp_payment_id FROM public.payment_intents WHERE id=$1`, [pi])).rows[0].mp_payment_id;
      const r = await client.query(
        `SELECT public._processar_webhook_payment_intent($1::text, 'aprovado', 'accredited', $2::uuid, '{}'::jsonb) AS res`,
        [mpId, STORE]
      );
      const res = r.rows[0].res;
      let ok = res.ok === true;
      if (ok) { const o = await client.query(`SELECT payment_status, status FROM public.orders WHERE id=$1`, [orderId]); ok = o.rows[0].payment_status === 'aprovado' && o.rows[0].status === 'recebido'; }
      check('Fluxo legitimo · _processar_webhook_payment_intent (service_role) ainda aprova pedido normalmente', ok, JSON.stringify(res));
    });

    // ══ Fluxo legitimo: postgres (ex.: _expirar_payment_intents_pendentes via pg_cron) continua funcionando ══
    await withTx(async () => {
      await setupOrder();
      await client.query(`SET LOCAL role postgres`);
      let ok = true, msg = '';
      try {
        await client.query(`UPDATE public.orders SET payment_status = 'expirado' WHERE id = $1`, [orderId]);
      } catch (e) { ok = false; msg = e.message; }
      check('Fluxo legitimo · postgres (cron de expiracao) ainda consegue gravar payment_status', ok, msg);
    });

    console.log(`\n${pass} passaram, ${fail} falharam.`);
  } finally {
    await client.query(`DELETE FROM public.payment_intents WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.orders WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.admins WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.stores WHERE id = $1`, [STORE]);
    await client.end();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO FATAL:', e.message);
  try { await client.query('ROLLBACK'); } catch {}
  await client.end().catch(() => {});
  process.exit(1);
});
