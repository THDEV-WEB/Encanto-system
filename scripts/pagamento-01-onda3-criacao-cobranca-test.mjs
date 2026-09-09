// REF-PAGAMENTO-01 · Onda 3 (criacao de cobranca real) -- E2E dedicado.
// Secao A: iniciar_pagamento_pedido -- so' logica local, sem chamada externa.
// Secao B: _registrar_criacao_pagamento -- so' logica local, sem chamada externa.
// Secao C (script separado, pagamento-01-onda3-edge-function-real-test.mjs): chamada REAL a Edge
// Function que fala com o sandbox do Mercado Pago -- esta aqui NAO cobre isso, ver aquele script pra
// transparencia sobre o que e' simulado vs real.
// SAVEPOINT por caso.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const map = {};
  for (const line of txt.split(/\r?\n/)) { const i = line.indexOf('='); if (i === -1) continue; map[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
  if (!map.PGPASSWORD) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: map.PGHOST, port: Number(map.PGPORT || 5432), user: map.PGUSER, password: map.PGPASSWORD, database: map.PGDATABASE || 'postgres' };
}
const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, spCounter = 0;
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { return await fn(); } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-PAGAMENTO-01 · Onda 3 (criacao de cobranca) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const STORE_A = randomUUID(); const STORE_B = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste PAGAMENTO-01 Onda3 A','ativo'),($3,$4,'Loja Teste PAGAMENTO-01 Onda3 B','ativo')`,
      [STORE_A, `pagamento01-onda3-a-${STORE_A}`, STORE_B, `pagamento01-onda3-b-${STORE_B}`]);

    async function novoPedido(status, storeId = STORE_A, total = 50.00) {
      const orderId = randomUUID(); const custId = randomUUID();
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES ($1,'Cliente Onda3','37699999999',$2)`, [custId, storeId]);
      await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido) VALUES ($1,$2,$3,$4,'pix_online','Rua Teste Onda3',$5,'entrega','storefront')`,
        [orderId, custId, total, status, storeId]);
      return orderId;
    }
    async function habilitarCapability(storeId, ligado = true) {
      await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'pagamento_online_habilitada',$2)`, [storeId, ligado ? 'true' : 'false']);
    }

    // ── A1..A2: sem a capability ligada -> RPC recusa, mesmo com pedido valido ────────────────
    await withSavepoint(async () => {
      const orderId = await novoPedido('aguardando_pagamento');
      const r = await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_A]);
      check('A1 capability desligada (ausente) -> recusa', r.rows[0].r.ok === false && r.rows[0].r.error.includes('nao habilitado'), JSON.stringify(r.rows[0].r));
    });
    await withSavepoint(async () => {
      await habilitarCapability(STORE_A, false);
      const orderId = await novoPedido('aguardando_pagamento');
      const r = await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_A]);
      check('A2 capability explicitamente false -> recusa', r.rows[0].r.ok === false, JSON.stringify(r.rows[0].r));
    });

    // ── A3..A8: capability ligada -- caminho feliz + validacoes ────────────────────────────────
    await withSavepoint(async () => {
      await habilitarCapability(STORE_A, true);
      const orderId = await novoPedido('aguardando_pagamento', STORE_A, 73.40);
      const r1 = await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_A]);
      check('A3 caminho feliz -> ok, amount bate com orders.total', r1.rows[0].r.ok === true && Number(r1.rows[0].r.amount) === 73.40, JSON.stringify(r1.rows[0].r));
      const piId = r1.rows[0].r.payment_intent_id;

      const row = (await client.query(`SELECT status, order_id, store_id, amount FROM public.payment_intents WHERE id = $1`, [piId])).rows[0];
      check('A4 payment_intent criado com status pendente/order_id/store_id corretos', row.status === 'pendente' && row.order_id === orderId && row.store_id === STORE_A);

      // Chamar de novo pro MESMO pedido -- reaproveita a MESMA tentativa pendente, nao cria 2a linha.
      const r2 = await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_A]);
      check('A5 2a chamada pro mesmo pedido -> reaproveita o MESMO payment_intent_id (nao duplica)', r2.rows[0].r.payment_intent_id === piId, JSON.stringify(r2.rows[0].r));
      const cnt = (await client.query(`SELECT count(*)::int AS c FROM public.payment_intents WHERE order_id = $1`, [orderId])).rows[0].c;
      check('A6 continua existindo so 1 payment_intent pro pedido', cnt === 1, `count=${cnt}`);
    });

    await withSavepoint(async () => {
      await habilitarCapability(STORE_A, true);
      const r = await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [randomUUID(), STORE_A]);
      check('A7 pedido inexistente -> recusa', r.rows[0].r.ok === false && r.rows[0].r.error.includes('nao encontrado'), JSON.stringify(r.rows[0].r));
    });

    await withSavepoint(async () => {
      await habilitarCapability(STORE_A, true);
      const orderId = await novoPedido('recebido'); // ja pago/COD, nao esta aguardando pagamento
      const r = await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_A]);
      check('A8 pedido que NAO esta aguardando_pagamento -> recusa', r.rows[0].r.ok === false && r.rows[0].r.error.includes('aguardando pagamento'), JSON.stringify(r.rows[0].r));
    });

    await withSavepoint(async () => {
      await habilitarCapability(STORE_A, true);
      await habilitarCapability(STORE_B, true);
      const orderId = await novoPedido('aguardando_pagamento', STORE_A);
      const r = await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_B]);
      check('A9 pedido de outra loja (cross-tenant) -> recusa (nao encontrado, nunca vaza existencia)', r.rows[0].r.ok === false && r.rows[0].r.error.includes('nao encontrado'), JSON.stringify(r.rows[0].r));
    });

    // ── B: _registrar_criacao_pagamento ──────────────────────────────────────────────────────
    await withSavepoint(async () => {
      const r = await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`, [randomUUID(), STORE_A, 'mp-123', 'pendente', null, null]);
      check('B1 payment_intent inexistente -> recusa', r.rows[0].r.ok === false && r.rows[0].r.error.includes('nao encontrado'), JSON.stringify(r.rows[0].r));
    });

    await withSavepoint(async () => {
      await habilitarCapability(STORE_A, true);
      const orderId = await novoPedido('aguardando_pagamento', STORE_A, 20.00);
      const piId = (await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_A])).rows[0].r.payment_intent_id;

      const r1 = await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`,
        [piId, STORE_B, 'mp-999', 'pendente', null, null]);
      check('B2 store_id_esperado errado (tenant nao corresponde) -> recusa, NAO grava mp_payment_id', r1.rows[0].r.ok === false && r1.rows[0].r.error.includes('tenant'), JSON.stringify(r1.rows[0].r));
      const row0 = (await client.query(`SELECT mp_payment_id FROM public.payment_intents WHERE id = $1`, [piId])).rows[0];
      check('B2b confirma que nao gravou nada', row0.mp_payment_id === null);

      // 1a associacao: status 'pendente' (IGUAL ao default inicial) -- NAO e' idempotencia de
      // replay, precisa gravar mp_payment_id/status_detail/raw_payload mesmo assim.
      const payload1 = { id: 'mp-777', status: 'pending', status_detail: 'pending_waiting_payment' };
      const r2 = await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`,
        [piId, STORE_A, 'mp-777', 'pendente', 'pending_waiting_payment', JSON.stringify(payload1)]);
      check('B3 1a associacao com status pendente (igual ao default) -> AINDA ASSIM grava (nao e replay)', r2.rows[0].r.ok === true, JSON.stringify(r2.rows[0].r));
      const row1 = (await client.query(`SELECT mp_payment_id, status, status_detail, raw_payload FROM public.payment_intents WHERE id = $1`, [piId])).rows[0];
      check('B4 mp_payment_id/status_detail/raw_payload gravados de verdade na 1a associacao',
        row1.mp_payment_id === 'mp-777' && row1.status === 'pendente' && row1.status_detail === 'pending_waiting_payment' && row1.raw_payload.status === 'pending',
        JSON.stringify(row1));

      // Tentar associar a UM OUTRO mp_payment_id depois de ja associado -> recusa.
      const r3 = await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`,
        [piId, STORE_A, 'mp-OUTRO', 'aprovado', null, null]);
      check('B5 tentativa de reassociar a mp_payment_id DIFERENTE -> recusa', r3.rows[0].r.ok === false && r3.rows[0].r.error.includes('ja associado'), JSON.stringify(r3.rows[0].r));

      // Mesmo mp_payment_id de novo, status mudando pra aprovado -> delega pra maquina de estados
      // da Onda 2 (_processar_webhook_payment_intent), efeito em orders.status/payment_status.
      const r4 = await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`,
        [piId, STORE_A, 'mp-777', 'aprovado', 'accredited', null]);
      check('B6 mesmo mp_payment_id, status pendente->aprovado -> ok (via maquina de estados da Onda 2)', r4.rows[0].r.ok === true, JSON.stringify(r4.rows[0].r));
      const ordRow = (await client.query(`SELECT status, payment_status FROM public.orders WHERE id = $1`, [orderId])).rows[0];
      check('B7 orders.status/payment_status atualizados por aprovacao', ordRow.status === 'recebido' && ordRow.payment_status === 'aprovado', JSON.stringify(ordRow));
    });

    // ── B8: status 'recusado' na criacao -> orders.payment_status='recusado', pedido continua aguardando (permite nova tentativa) ──
    await withSavepoint(async () => {
      await habilitarCapability(STORE_A, true);
      const orderId = await novoPedido('aguardando_pagamento', STORE_A, 15.00);
      const piId = (await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_A])).rows[0].r.payment_intent_id;
      const r = await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`,
        [piId, STORE_A, 'mp-recusado-1', 'recusado', 'cc_rejected_insufficient_amount', null]);
      check('B8 status recusado na criacao -> ok', r.rows[0].r.ok === true, JSON.stringify(r.rows[0].r));
      const ordRow = (await client.query(`SELECT status, payment_status FROM public.orders WHERE id = $1`, [orderId])).rows[0];
      check('B9 pedido continua aguardando_pagamento (permite nova tentativa), payment_status=recusado', ordRow.status === 'aguardando_pagamento' && ordRow.payment_status === 'recusado', JSON.stringify(ordRow));
    });

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
