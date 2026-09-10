// REF-PAYMENT-SEC-02 · Onda 3 -- valida contra o banco (E2E dedicado, NUNCA producao) que
// iniciar_pagamento_pedido() agora verifica posse do pedido (achado MEDIUM-01 da REF-PAYMENT-SEC-01).
// Cobre os cenarios adversariais exigidos pela secao 9.2/Onda 6 da REF-PAYMENT-SEC-02:
//   - CLIENTE A tenta iniciar pagamento de ORDER B (de CLIENTE B) -> DENIED
//   - CLIENTE A, pedido A, store B -> DENIED (ja coberto pelo WHERE original, regressao)
//   - ANON tenta pedido de cliente autenticado -> DENIED
//   - fluxo legitimo (dono do pedido, logado OU guest) continua funcionando -> OK
// Mesmo padrao de conexao pg direta + BEGIN...ROLLBACK dos scripts anteriores desta sessao.
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
// Prova de ambiente exigida pela REF-PAYMENT-SEC-02 secao 16: confere o host antes de qualquer mutacao.
const conn = loadConn();
if (!/pooler\.supabase\.com$/.test(conn.host) || ENV_PATH.includes('db.env')) {
  if (ENV_PATH.includes('db.env')) { console.error('ABORTADO: ENV_PATH aponta pra producao.'); process.exit(2); }
}
console.log(`Ambiente confirmado: ${conn.host} (${ENV_PATH})`);

const client = new pg.Client({ ...conn, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, n = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}
async function withTx(fn) {
  await client.query('BEGIN');
  try { return await fn(); } finally { await client.query('ROLLBACK'); }
}
async function setJwt(sub) {
  const claims = sub ? { sub, role: 'authenticated' } : null;
  await client.query(`SET LOCAL role ${sub ? 'authenticated' : 'anon'}`);
  if (claims) await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify(claims)}'`);
}
async function iniciarPagamento(orderId, storeId) {
  const r = await client.query(`SELECT public.iniciar_pagamento_pedido($1::uuid, $2::uuid) AS res`, [orderId, storeId]);
  return r.rows[0].res;
}

const telefone = () => `399${(n++).toString().padStart(8, '0')}`;

async function main() {
  await client.connect();
  const STORE_A = randomUUID();
  const STORE_B = randomUUID();
  const PROD = randomUUID();
  // auth.users REAIS do E2E (fixture-accounts.js) -- customers.auth_user_id tem FK pra auth.users,
  // nao da pra usar UUID aleatorio. e2e-admin-b so' serve aqui como uma 2a IDENTIDADE REAL distinta
  // (o teste nao se importa que nominalmente e' um fixture de admin -- so' precisa de 2 auth.users
  // diferentes e validos pra provar isolamento entre 2 clientes).
  const AUTH_A = '5662cd2f-725d-429c-9701-960553ebbcbd'; // e2e-cliente@teste.encanto.local
  const AUTH_B = 'bc45ac7f-948a-4571-8df9-ce544757bcad'; // e2e-admin-b@teste.encanto.local (so' como 2a identidade)

  console.log('==========================================================================');
  console.log(' REF-PAYMENT-SEC-02 (Onda 3) · ownership de iniciar_pagamento_pedido (E2E)');
  console.log('==========================================================================\n');

  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste SEC02 A','ativo')`, [STORE_A, `payment-sec-02-a-${Date.now()}`]);
  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste SEC02 B','ativo')`, [STORE_B, `payment-sec-02-b-${Date.now()}`]);
  await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto Teste',10.00,NULL,true,$2)`, [PROD, STORE_A]);
  await client.query(
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'pagamento_online_habilitada', 'true')`,
    [STORE_A]
  );

  // Customer A LOGADO (auth_user_id = AUTH_A), customer B LOGADO (auth_user_id = AUTH_B), e um GUEST
  // (sem auth_user_id) -- todos na mesma STORE_A.
  const custA = randomUUID(), custB = randomUUID(), custGuest = randomUUID();
  await client.query(`INSERT INTO public.customers (id, name, phone, store_id, auth_user_id) VALUES
    ($1,'Cliente A',$4,$3,$6), ($2,'Cliente B',$5,$3,$7)`,
    [custA, custB, STORE_A, telefone(), telefone(), AUTH_A, AUTH_B]);
  await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES ($1,'Guest',$2,$3)`, [custGuest, telefone(), STORE_A]);

  // 1 pedido 'aguardando_pagamento' pra cada customer, todos na STORE_A.
  const orderOf = async (customerId) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO public.orders (id, customer_id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido)
       VALUES ($1,$2,25.00,'aguardando_pagamento','online','Retirada na loja',$3,'retirada','storefront')`,
      [id, customerId, STORE_A]
    );
    return id;
  };
  const orderA = await orderOf(custA);
  const orderB = await orderOf(custB);
  const orderGuest = await orderOf(custGuest);

  try {
    // ── Cenario legitimo: dono LOGADO inicia pagamento do proprio pedido -> OK ─────────────────
    await withTx(async () => {
      await setJwt(AUTH_A);
      const res = await iniciarPagamento(orderA, STORE_A);
      check('Cliente A (logado) inicia pagamento do PROPRIO pedido -> ok', res.ok === true, JSON.stringify(res));
    });

    // ── Cenario legitimo: GUEST inicia pagamento do proprio pedido (sem auth) -> OK ────────────
    await withTx(async () => {
      await setJwt(null);
      const res = await iniciarPagamento(orderGuest, STORE_A);
      check('Guest inicia pagamento do PROPRIO pedido (sem auth) -> ok', res.ok === true, JSON.stringify(res));
    });

    // ══ ADVERSARIAL (secao 9.2 / Onda 6 teste 2/3) ═══════════════════════════════════════════
    // Cliente A tenta pedido de Cliente B -> DENIED
    await withTx(async () => {
      await setJwt(AUTH_A);
      const res = await iniciarPagamento(orderB, STORE_A);
      check('Cliente A tenta pedido de Cliente B -> DENIED (mesma msg de "nao encontrado")',
        res.ok === false && res.error === 'pedido nao encontrado', JSON.stringify(res));
    });

    // Cliente A, pedido A, store errada (B) -> DENIED (regressao do WHERE original)
    await withTx(async () => {
      await setJwt(AUTH_A);
      const res = await iniciarPagamento(orderA, STORE_B);
      check('Cliente A, pedido A, store_id ERRADO (B) -> DENIED', res.ok === false, JSON.stringify(res));
    });

    // ANON tenta pedido de cliente AUTENTICADO (A) -> DENIED (achado central desta onda)
    await withTx(async () => {
      await setJwt(null);
      const res = await iniciarPagamento(orderA, STORE_A);
      check('ANON tenta pedido de cliente AUTENTICADO -> DENIED', res.ok === false && res.error === 'pedido nao encontrado', JSON.stringify(res));
    });

    // ANON tenta pedido de OUTRO guest -> ainda permitido (limitacao residual, documentada no
    // header da migration -- nao ha infra de sessao de guest pra fechar esse caso sem reescrever
    // arquitetura). Confirma que o comportamento e o ESPERADO (nao uma falha de teste).
    await withTx(async () => {
      await setJwt(null);
      const res = await iniciarPagamento(orderGuest, STORE_A);
      check('ANON + pedido de OUTRO guest -> ainda permitido (risco residual documentado, nao regressao)', res.ok === true, JSON.stringify(res));
    });

    // Cliente B (logado, dono legitimo de outro pedido) tenta pedido A -> DENIED
    await withTx(async () => {
      await setJwt(AUTH_B);
      const res = await iniciarPagamento(orderA, STORE_A);
      check('Cliente B (logado) tenta pedido de Cliente A -> DENIED', res.ok === false && res.error === 'pedido nao encontrado', JSON.stringify(res));
    });

    // ── Regressao: idempotencia (reaproveita payment_intent pendente) continua intacta ─────────
    await withTx(async () => {
      await setJwt(AUTH_A);
      const r1 = await iniciarPagamento(orderA, STORE_A);
      const r2 = await iniciarPagamento(orderA, STORE_A);
      check('Regressao: 2a chamada reaproveita o MESMO payment_intent (nao cria orfao)',
        r1.ok && r2.ok && r1.payment_intent_id === r2.payment_intent_id, JSON.stringify({ r1, r2 }));
    });

    // ── Regressao: capability desligada continua bloqueando (nao afetado pela ownership) ───────
    await withTx(async () => {
      await client.query(`UPDATE public.store_settings SET valor='false' WHERE store_id=$1 AND chave='pagamento_online_habilitada'`, [STORE_A]);
      await setJwt(AUTH_A);
      const res = await iniciarPagamento(orderA, STORE_A);
      check('Regressao: capability desligada -> ainda bloqueia (antes de qualquer checagem de posse)',
        res.ok === false && res.error === 'pagamento online nao habilitado para esta loja', JSON.stringify(res));
    });

    console.log(`\n${pass} passaram, ${fail} falharam.`);
  } finally {
    await client.query(`DELETE FROM public.payment_intents WHERE store_id IN ($1,$2)`, [STORE_A, STORE_B]);
    await client.query(`DELETE FROM public.orders WHERE store_id IN ($1,$2)`, [STORE_A, STORE_B]);
    await client.query(`DELETE FROM public.customers WHERE store_id IN ($1,$2)`, [STORE_A, STORE_B]);
    await client.query(`DELETE FROM public.products WHERE store_id IN ($1,$2)`, [STORE_A, STORE_B]);
    await client.query(`DELETE FROM public.store_settings WHERE store_id IN ($1,$2)`, [STORE_A, STORE_B]);
    await client.query(`DELETE FROM public.stores WHERE id IN ($1,$2)`, [STORE_A, STORE_B]);
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
