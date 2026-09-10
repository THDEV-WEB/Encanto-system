// REF-PAGAMENTO-01 · Onda 2 (fundacao do webhook) -- E2E dedicado.
// IMPORTANTE (transparencia, pedida explicitamente pelo dono): este teste SIMULA payment_intents
// via INSERT direto (nunca criados pela API real do Mercado Pago, que segue BLOQUEADA por
// credencial) e webhooks ASSINADOS POR NOS MESMOS com um secret de teste gerado localmente neste
// processo Node (crypto.createHmac, nunca uma credencial real do Mercado Pago). Prova que a
// MATEMATICA da validacao (HMAC/manifest/janela de frescor), a maquina de estados, o
// processamento idempotente e o job de expiracao estao corretos -- NAO que a integracao real com o
// Mercado Pago funciona ponta a ponta (isso permanece bloqueado, ver checkpoint).
// SAVEPOINT por caso.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';

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

let pass = 0, fail = 0, spCounter = 0, n = 0;
const telefone = () => `376${(n++).toString().padStart(8, '0')}`;
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { return await fn(); } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
}

// ── SIMULACAO local do webhook do Mercado Pago (secret de TESTE, nunca real) ──────────────────
// FIX Onda 4: "ts" do Mercado Pago vem em SEGUNDOS desde epoch (confirmado empiricamente contra um
// webhook real, ver migration REF-PAGAMENTO-01-onda4-fix-timestamp-assinatura.sql) -- este helper
// recebe SEGUNDOS agora (antes recebia milissegundos, mesma suposicao errada que o codigo tinha).
const SECRET_TESTE = 'segredo-de-teste-nao-e-do-mercadopago-' + randomUUID();
function assinarWebhook(dataId, xRequestId, tsSegundos, secret = SECRET_TESTE) {
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${tsSegundos};`;
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${tsSegundos},v1=${v1}`;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-PAGAMENTO-01 · Onda 2 (fundacao do webhook) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID(); const STORE_B = randomUUID();
    const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste PAGAMENTO-01 Onda2 A','ativo'),($3,$4,'Loja Teste PAGAMENTO-01 Onda2 B','ativo')`,
      [STORE_A, `pagamento01-onda2-a-${STORE_A}`, STORE_B, `pagamento01-onda2-b-${STORE_B}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda2',25.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);

    // ── G: _hmac_sha256_hex -- confere contra o crypto NATIVO do Node (2 implementacoes concordando) ──
    await withSavepoint(async () => {
      const manifest = 'id:123456789;request-id:abc-def;ts:1704908010000;';
      const esperadoNode = createHmac('sha256', SECRET_TESTE).update(manifest).digest('hex');
      const res = await client.query(`SELECT public._hmac_sha256_hex($1, $2) AS h`, [manifest, SECRET_TESTE]);
      check('G1 HMAC SQL bate com HMAC nativo do Node (mesma mensagem/secret)', res.rows[0].h === esperadoNode, `sql=${res.rows[0].h} node=${esperadoNode}`);
    });

    // ── H: _validar_assinatura_webhook_mp -- assinatura valida/invalida/adulterada/janela de frescor ──
    await withSavepoint(async () => {
      const dataId = '987654321';
      const reqId = randomUUID();
      const tsAgora = Math.floor(Date.now() / 1000);
      const sigValida = assinarWebhook(dataId, reqId, tsAgora);

      const r1 = await client.query(`SELECT public._validar_assinatura_webhook_mp($1,$2,$3,$4) AS ok`, [dataId, reqId, sigValida, SECRET_TESTE]);
      check('H1 assinatura valida -> aceita', r1.rows[0].ok === true);

      const r2 = await client.query(`SELECT public._validar_assinatura_webhook_mp($1,$2,$3,$4) AS ok`, [dataId, reqId, sigValida, 'secret-errado']);
      check('H2 secret errado -> rejeitada', r2.rows[0].ok === false);

      const r3 = await client.query(`SELECT public._validar_assinatura_webhook_mp($1,$2,$3,$4) AS ok`, ['999999999', reqId, sigValida, SECRET_TESTE]);
      check('H3 data_id adulterado (assinatura de outro payment_id) -> rejeitada', r3.rows[0].ok === false);

      const r4 = await client.query(`SELECT public._validar_assinatura_webhook_mp($1,$2,$3,$4) AS ok`, [dataId, 'outro-request-id', sigValida, SECRET_TESTE]);
      check('H4 x-request-id adulterado -> rejeitada', r4.rows[0].ok === false);

      const r5 = await client.query(`SELECT public._validar_assinatura_webhook_mp($1,$2,$3,$4) AS ok`, [dataId, reqId, 'formato-invalido-sem-ts-v1', SECRET_TESTE]);
      check('H5 x-signature malformado (sem ts/v1) -> rejeitada, nao lanca erro', r5.rows[0].ok === false);

      const sigMaiuscula = sigValida.replace(/v1=([0-9a-f]+)/, (m, hex) => 'v1=' + hex.toUpperCase());
      const r6 = await client.query(`SELECT public._validar_assinatura_webhook_mp($1,$2,$3,$4) AS ok`, [dataId, reqId, sigMaiuscula, SECRET_TESTE]);
      check('H6 v1 em maiuscula (case-insensitive) -> ainda aceita', r6.rows[0].ok === true);

      const tsVelho = Math.floor((Date.now() - 15 * 60 * 1000) / 1000); // 15min atras -- fora da janela de 10min
      const sigVelha = assinarWebhook(dataId, reqId, tsVelho);
      const r7 = await client.query(`SELECT public._validar_assinatura_webhook_mp($1,$2,$3,$4) AS ok`, [dataId, reqId, sigVelha, SECRET_TESTE]);
      check('H7 timestamp com 15min (fora da janela de frescor de 10min) -> rejeitada mesmo com assinatura matematicamente correta', r7.rows[0].ok === false);

      const tsFuturo = Math.floor((Date.now() + 5 * 60 * 1000) / 1000); // 5min no futuro -- fora da janela de 2min
      const sigFutura = assinarWebhook(dataId, reqId, tsFuturo);
      const r8 = await client.query(`SELECT public._validar_assinatura_webhook_mp($1,$2,$3,$4) AS ok`, [dataId, reqId, sigFutura, SECRET_TESTE]);
      check('H8 timestamp 5min no futuro (fora da janela de 2min) -> rejeitada', r8.rows[0].ok === false);
    });

    // ── I: _transicao_payment_status_valida -- matriz de transicoes ────────────────────────────
    await withSavepoint(async () => {
      // REF-PAYMENT-SEC-02 · Onda 4 (2026-09-10): expirado->aprovado passou a ser uma transicao
      // VALIDA de proposito (achado MEDIUM-02 da REF-PAYMENT-SEC-01 -- webhook de aprovacao pode
      // chegar depois da expiracao interna de 15min; recusar so' escondia o fato, nunca desfazia o
      // pagamento real). Cobertura dedicada da Onda 4: scripts/payment-sec-02-onda4-expirado-
      // aprovado-test.mjs.
      const casosValidos = [['pendente', 'aprovado'], ['pendente', 'recusado'], ['pendente', 'expirado'], ['aprovado', 'em_contestacao'], ['aprovado', 'estornado'], ['em_contestacao', 'estornado'], ['em_contestacao', 'aprovado'], ['expirado', 'aprovado']];
      const casosInvalidos = [['aprovado', 'pendente'], ['recusado', 'aprovado'], ['estornado', 'aprovado'], ['estornado', 'pendente'], ['pendente', 'em_contestacao']];
      let okValidos = true, okInvalidos = true;
      for (const [de, para] of casosValidos) {
        const r = await client.query(`SELECT public._transicao_payment_status_valida($1,$2) AS ok`, [de, para]);
        if (r.rows[0].ok !== true) { okValidos = false; console.log(`   -> esperava valida: ${de}->${para}`); }
      }
      for (const [de, para] of casosInvalidos) {
        const r = await client.query(`SELECT public._transicao_payment_status_valida($1,$2) AS ok`, [de, para]);
        if (r.rows[0].ok !== false) { okInvalidos = false; console.log(`   -> esperava invalida: ${de}->${para}`); }
      }
      check('I1 todas as 8 transicoes validas aceitas', okValidos);
      check('I2 todas as 5 transicoes invalidas/regressivas rejeitadas', okInvalidos);
    });

    // ── J: _processar_webhook_payment_intent -- delivery/retirada, caso feliz + idempotencia ──
    await withSavepoint(async () => {
      const orderId = randomUUID();
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES (gen_random_uuid(), 'Cliente Onda2', $1, $2)`, [telefone(), STORE_A]);
      const custId = (await client.query(`SELECT id FROM public.customers WHERE store_id=$1 ORDER BY created_at DESC LIMIT 1`, [STORE_A])).rows[0].id;
      await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, payment_status, address, store_id, tipo_pedido, origem_pedido) VALUES ($1,$2,50.00,'aguardando_pagamento','pix_online','pendente','Rua Teste, 1',$3,'entrega','storefront')`, [orderId, custId, STORE_A]);
      const mpId = 'mp-' + randomUUID();
      await client.query(`INSERT INTO public.payment_intents (id, store_id, order_id, mp_payment_id, status, amount) VALUES (gen_random_uuid(),$1,$2,$3,'pendente',50.00)`, [STORE_A, orderId, mpId]);

      const res = await client.query(`SELECT public._processar_webhook_payment_intent($1,'aprovado','accredited',$2,$3::jsonb) AS res`, [mpId, STORE_A, JSON.stringify({ simulado: true })]);
      check('J1 aprovar payment_intent de delivery -> sucesso', res.rows[0].res.ok === true, JSON.stringify(res.rows[0].res));

      const pedido = (await client.query(`SELECT status, payment_status FROM public.orders WHERE id=$1`, [orderId])).rows[0];
      check('J2 order.status vira recebido, payment_status vira aprovado', pedido.status === 'recebido' && pedido.payment_status === 'aprovado', JSON.stringify(pedido));

      // J3: reprocessar o MESMO status (webhook duplicado/reentrega) -> idempotente, nao reexecuta.
      const res2 = await client.query(`SELECT public._processar_webhook_payment_intent($1,'aprovado','accredited',$2,$3::jsonb) AS res`, [mpId, STORE_A, JSON.stringify({ simulado: true })]);
      check('J3 reprocessar mesmo status (replay) -> idempotente, no-op', res2.rows[0].res.ok === true && res2.rows[0].res.idempotente === true, JSON.stringify(res2.rows[0].res));

      // J4: tentar REGREDIR (aprovado -> pendente) -> maquina de estados bloqueia, mesmo via replay de webhook antigo.
      const res3 = await client.query(`SELECT public._processar_webhook_payment_intent($1,'pendente',NULL,$2,NULL) AS res`, [mpId, STORE_A]);
      check('J4 tentar regredir aprovado->pendente -> bloqueado pela maquina de estados', res3.rows[0].res.ok === false && res3.rows[0].res.error === 'transicao de status invalida', JSON.stringify(res3.rows[0].res));
      const pedidoDepois = (await client.query(`SELECT status, payment_status FROM public.orders WHERE id=$1`, [orderId])).rows[0];
      check('J5 pedido continua recebido/aprovado apos tentativa de regressao bloqueada', pedidoDepois.status === 'recebido' && pedidoDepois.payment_status === 'aprovado', JSON.stringify(pedidoDepois));
    });

    // ── K: cross-tenant e nao encontrado ────────────────────────────────────────────────────────
    await withSavepoint(async () => {
      const orderId = randomUUID();
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES (gen_random_uuid(), 'Cliente K', $1, $2)`, [telefone(), STORE_A]);
      const custId = (await client.query(`SELECT id FROM public.customers WHERE store_id=$1 ORDER BY created_at DESC LIMIT 1`, [STORE_A])).rows[0].id;
      await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, payment_status, address, store_id, tipo_pedido, origem_pedido) VALUES ($1,$2,30.00,'aguardando_pagamento','pix_online','pendente','Rua Teste K',$3,'entrega','storefront')`, [orderId, custId, STORE_A]);
      const mpId = 'mp-' + randomUUID();
      await client.query(`INSERT INTO public.payment_intents (id, store_id, order_id, mp_payment_id, status, amount) VALUES (gen_random_uuid(),$1,$2,$3,'pendente',30.00)`, [STORE_A, orderId, mpId]);

      const res = await client.query(`SELECT public._processar_webhook_payment_intent($1,'aprovado',NULL,$2,NULL) AS res`, [mpId, STORE_B]);
      check('K1 webhook com store_id de OUTRA loja -> rejeitado, nunca escreve', res.rows[0].res.ok === false && res.rows[0].res.error === 'tenant nao corresponde', JSON.stringify(res.rows[0].res));
      const pedido = (await client.query(`SELECT status FROM public.orders WHERE id=$1`, [orderId])).rows[0];
      check('K2 pedido nao foi alterado apos rejeicao cross-tenant', pedido.status === 'aguardando_pagamento');

      const res2 = await client.query(`SELECT public._processar_webhook_payment_intent($1,'aprovado',NULL,$2,NULL) AS res`, ['mp-inexistente-' + randomUUID(), STORE_A]);
      check('K3 mp_payment_id desconhecido -> payment_intent nao encontrado', res2.rows[0].res.ok === false && res2.rows[0].res.error === 'payment_intent nao encontrado', JSON.stringify(res2.rows[0].res));
    });

    // ── L: _webhook_mercadopago_recebido -- assinatura invalida NUNCA toca o banco ──────────────
    await withSavepoint(async () => {
      const orderId = randomUUID();
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES (gen_random_uuid(), 'Cliente L', $1, $2)`, [telefone(), STORE_A]);
      const custId = (await client.query(`SELECT id FROM public.customers WHERE store_id=$1 ORDER BY created_at DESC LIMIT 1`, [STORE_A])).rows[0].id;
      await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, payment_status, address, store_id, tipo_pedido, origem_pedido) VALUES ($1,$2,40.00,'aguardando_pagamento','cartao_online','pendente','Rua Teste L',$3,'entrega','storefront')`, [orderId, custId, STORE_A]);
      const mpId = 'mp-' + randomUUID();
      await client.query(`INSERT INTO public.payment_intents (id, store_id, order_id, mp_payment_id, status, amount) VALUES (gen_random_uuid(),$1,$2,$3,'pendente',40.00)`, [STORE_A, orderId, mpId]);

      const reqId = randomUUID();
      const res = await client.query(`SELECT public._webhook_mercadopago_recebido($1,$2,'ts=123,v1=00000000000000000000000000000000000000000000000000000000000000','aprovado',NULL,$3,$4,NULL) AS res`, [mpId, reqId, STORE_A, SECRET_TESTE]);
      check('L1 assinatura forjada -> rejeitada pelo entry point', res.rows[0].res.ok === false && res.rows[0].res.error === 'assinatura invalida', JSON.stringify(res.rows[0].res));
      const pedidoIntacto = (await client.query(`SELECT status FROM public.orders WHERE id=$1`, [orderId])).rows[0];
      check('L2 pedido NUNCA foi tocado (assinatura invalida barra ANTES de qualquer leitura/escrita de payment_intent)', pedidoIntacto.status === 'aguardando_pagamento');

      const tsAgora = Math.floor(Date.now() / 1000);
      const sigValida = assinarWebhook(mpId, reqId, tsAgora, SECRET_TESTE);
      const res2 = await client.query(`SELECT public._webhook_mercadopago_recebido($1,$2,$3,'aprovado','accredited',$4,$5,NULL) AS res`, [mpId, reqId, sigValida, STORE_A, SECRET_TESTE]);
      check('L3 assinatura valida -> processa de verdade (entry point completo)', res2.rows[0].res.ok === true, JSON.stringify(res2.rows[0].res));
      const pedidoAprovado = (await client.query(`SELECT status FROM public.orders WHERE id=$1`, [orderId])).rows[0];
      check('L4 pedido aprovado apos webhook assinado corretamente', pedidoAprovado.status === 'recebido');
    });

    // ── M: divisao de conta de Mesa -- pagamento online aprova a fatia correspondente ───────────
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true')`, [STORE_A]);
      await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'70')`, [STORE_A]);
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_UID, tenant_id: STORE_A })]);
      await client.query(`SET LOCAL ROLE authenticated`);
      const aberto = (await client.query(
        `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
        [JSON.stringify({ name: 'Cliente Mesa Onda2', phone: telefone() }),
         JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '70', origem_pedido: 'admin_garcom' }),
         JSON.stringify([{ product_id: PROD, nome_produto: 'Produto Onda2', quantity: 4 }]), // total=100
         STORE_A])).rows[0].res;
      const divisao = (await client.query(`SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid) AS res`, [aberto.mesa_session_id, JSON.stringify([{ valor: 60, metodo: 'pix_online' }, { valor: 40, metodo: 'dinheiro' }]), STORE_A])).rows[0].res;
      await client.query(`RESET ROLE`); await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`);

      const fatiaOnline = divisao.alocacao_ids[0];
      const mpId = 'mp-mesa-' + randomUUID();
      const piId = (await client.query(`INSERT INTO public.payment_intents (id, store_id, mesa_session_id, mp_payment_id, status, amount) VALUES (gen_random_uuid(),$1,$2,$3,'pendente',60.00) RETURNING id`, [STORE_A, aberto.mesa_session_id, mpId])).rows[0].id;
      await client.query(`UPDATE public.mesa_session_payment_allocations SET payment_intent_id=$1 WHERE id=$2`, [piId, fatiaOnline]);

      const res = await client.query(`SELECT public._processar_webhook_payment_intent($1,'aprovado','accredited',$2,NULL) AS res`, [mpId, STORE_A]);
      check('M1 aprovar payment_intent de fatia de mesa -> sucesso', res.rows[0].res.ok === true, JSON.stringify(res.rows[0].res));
      const fatiaStatus = (await client.query(`SELECT status, paga_em FROM public.mesa_session_payment_allocations WHERE id=$1`, [fatiaOnline])).rows[0];
      check('M2 fatia online marcada como paga automaticamente pelo webhook', fatiaStatus.status === 'pago' && fatiaStatus.paga_em !== null, JSON.stringify(fatiaStatus));
    });

    // ── N: _expirar_payment_intents_pendentes -- so expira quem passou de 15min, so cancela o pedido ──
    await withSavepoint(async () => {
      // N1: pendente ha 20min (backdated) -- deve expirar + cancelar o pedido.
      const orderVelho = randomUUID();
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES (gen_random_uuid(), 'Cliente N velho', $1, $2)`, [telefone(), STORE_A]);
      const custVelho = (await client.query(`SELECT id FROM public.customers WHERE store_id=$1 ORDER BY created_at DESC LIMIT 1`, [STORE_A])).rows[0].id;
      await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, payment_status, address, store_id, tipo_pedido, origem_pedido) VALUES ($1,$2,15.00,'aguardando_pagamento','pix_online','pendente','Rua N',$3,'entrega','storefront')`, [orderVelho, custVelho, STORE_A]);
      await client.query(`INSERT INTO public.payment_intents (id, store_id, order_id, mp_payment_id, status, amount, created_at) VALUES (gen_random_uuid(),$1,$2,$3,'pendente',15.00, now() - interval '20 minutes')`, [STORE_A, orderVelho, 'mp-velho-' + randomUUID()]);

      // N2: pendente ha 5min (dentro da janela) -- NAO deve expirar.
      const orderNovo = randomUUID();
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES (gen_random_uuid(), 'Cliente N novo', $1, $2)`, [telefone(), STORE_A]);
      const custNovo = (await client.query(`SELECT id FROM public.customers WHERE store_id=$1 ORDER BY created_at DESC LIMIT 1`, [STORE_A])).rows[0].id;
      await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, payment_status, address, store_id, tipo_pedido, origem_pedido) VALUES ($1,$2,15.00,'aguardando_pagamento','pix_online','pendente','Rua N2',$3,'entrega','storefront')`, [orderNovo, custNovo, STORE_A]);
      await client.query(`INSERT INTO public.payment_intents (id, store_id, order_id, mp_payment_id, status, amount, created_at) VALUES (gen_random_uuid(),$1,$2,$3,'pendente',15.00, now() - interval '5 minutes')`, [STORE_A, orderNovo, 'mp-novo-' + randomUUID()]);

      // N3: JA aprovado ha 20min (nunca deve ser tocado pelo job -- so mexe em 'pendente').
      const orderAprovado = randomUUID();
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES (gen_random_uuid(), 'Cliente N aprovado', $1, $2)`, [telefone(), STORE_A]);
      const custAprovado = (await client.query(`SELECT id FROM public.customers WHERE store_id=$1 ORDER BY created_at DESC LIMIT 1`, [STORE_A])).rows[0].id;
      await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, payment_status, address, store_id, tipo_pedido, origem_pedido) VALUES ($1,$2,15.00,'recebido','pix_online','aprovado','Rua N3',$3,'entrega','storefront')`, [orderAprovado, custAprovado, STORE_A]);
      await client.query(`INSERT INTO public.payment_intents (id, store_id, order_id, mp_payment_id, status, amount, created_at) VALUES (gen_random_uuid(),$1,$2,$3,'aprovado',15.00, now() - interval '20 minutes')`, [STORE_A, orderAprovado, 'mp-aprovado-' + randomUUID()]);

      const n = (await client.query(`SELECT public._expirar_payment_intents_pendentes() AS n`)).rows[0].n;
      check('N1 job expira exatamente 1 (o pendente ha 20min, ignora o resto)', n === 1, `n=${n}`);

      const oVelho = (await client.query(`SELECT status, payment_status FROM public.orders WHERE id=$1`, [orderVelho])).rows[0];
      check('N2 pedido velho (pendente>15min) foi CANCELADO pelo job', oVelho.status === 'cancelado' && oVelho.payment_status === 'expirado', JSON.stringify(oVelho));

      const oNovo = (await client.query(`SELECT status FROM public.orders WHERE id=$1`, [orderNovo])).rows[0];
      check('N3 pedido novo (pendente<15min) NAO foi tocado', oNovo.status === 'aguardando_pagamento', JSON.stringify(oNovo));

      const oAprovado = (await client.query(`SELECT status FROM public.orders WHERE id=$1`, [orderAprovado])).rows[0];
      check('N4 pedido ja aprovado NUNCA e tocado pelo job de expiracao', oAprovado.status === 'recebido', JSON.stringify(oAprovado));
    });

  } finally {
    await client.query('ROLLBACK');
  }

  console.log('\n==========================================================================');
  console.log(` RESULTADO: ${pass} PASS / ${fail} FAIL`);
  console.log('==========================================================================');
  await client.end();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(e => { console.error('ERRO FATAL', e); process.exit(2); });
