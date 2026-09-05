// REF-MESA-02 · Onda 5 (QR protegido -- resolve R3, achado mais grave da auditoria) -- E2E dedicado.
// Foco em ATAQUE REAL, nao so revisao de codigo: forjar mesa_identificador com token de outra
// mesa/loja, token inexistente/de outra loja, enumeracao. SAVEPOINT por caso.
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

let pass = 0, fail = 0, spCounter = 0, n = 0;
const telefone = () => `398${(n++).toString().padStart(8, '0')}`;
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { return await fn(); } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
}
async function setRole(role, sub, tenantId, origin) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  if (origin) await client.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify({ origin })]);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function resetRole() { await client.query(`RESET ROLE`); await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`); await client.query(`SELECT set_config('request.headers', '{}', true)`).catch(() => {}); }
async function criarPedido(storeId, prodId, extra) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda5', phone: telefone() }),
     JSON.stringify(extra),
     JSON.stringify([{ product_id: prodId, nome_produto: 'Produto Onda5', quantity: 1 }]), storeId]);
  return r.rows[0].res;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 5 (QR protegido) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID(); const STORE_B = randomUUID(); const PROD = randomUUID();
    const SLUG_A = `mesa02onda5a${STORE_A}`.replace(/-/g, '').slice(0, 30).toLowerCase();
    const SLUG_B = `mesa02onda5b${STORE_B}`.replace(/-/g, '').slice(0, 30).toLowerCase();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda5 A','ativo')`, [STORE_A, SLUG_A]);
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda5 B','ativo')`, [STORE_B, SLUG_B]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda5',20.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_canal_qr','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_canal_admin','true')`, [STORE_A]);

    let mesa05, mesa06;
    await setRole('authenticated', ADMIN_UID, STORE_A);
    mesa05 = (await client.query(`SELECT public.admin_criar_mesa('05', $1) AS r`, [STORE_A])).rows[0].r;
    mesa06 = (await client.query(`SELECT public.admin_criar_mesa('06', $1) AS r`, [STORE_A])).rows[0].r;
    await resetRole();
    const rows = (await client.query(`SELECT identificador, qr_token FROM public.mesas WHERE id IN ($1,$2)`, [mesa05.id, mesa06.id])).rows;
    const TOKEN_05 = rows.find(r => r.identificador === '05').qr_token;
    const TOKEN_06 = rows.find(r => r.identificador === '06').qr_token;

    console.log('── CAMADA A: resolver_mesa_por_token (RPC publica) ──\n');
    await withSavepoint(async () => {
      await setRole('anon');
      const r = await client.query(`SELECT public.resolver_mesa_por_token($1) AS r`, [TOKEN_05]);
      check('A1 token valido resolve store_id+identificador corretos', r.rows[0].r.ok === true && r.rows[0].r.mesa_identificador === '05' && r.rows[0].r.store_id === STORE_A, JSON.stringify(r.rows[0].r));
      await resetRole();
    });
    await withSavepoint(async () => {
      await setRole('anon');
      const r = await client.query(`SELECT public.resolver_mesa_por_token($1) AS r`, [randomUUID()]);
      check('A2 token inexistente -> "mesa nao encontrada" (fail-closed generico)', r.rows[0].r.ok === false && r.rows[0].r.error === 'mesa nao encontrada', JSON.stringify(r.rows[0].r));
      await resetRole();
    });
    await withSavepoint(async () => {
      await setRole('anon');
      const r = await client.query(`SELECT public.resolver_mesa_por_token(NULL) AS r`);
      check('A3 token NULL -> "mesa nao encontrada"', r.rows[0].r.ok === false && r.rows[0].r.error === 'mesa nao encontrada', JSON.stringify(r.rows[0].r));
      await resetRole();
    });

    console.log('\n── CAMADA B: create_order() -- ataque real, nao so revisao de codigo ──\n');

    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE_A);
      const res = await criarPedido(STORE_A, PROD, { payment_method: 'dinheiro', tipo_pedido: 'mesa', origem_pedido: 'qr_mesa', mesa_qr_token: TOKEN_05 });
      check('B1 pedido via QR com token valido -> sucesso', res.ok === true, JSON.stringify(res));
      await resetRole();
      const row = (await client.query(`SELECT mesa_identificador FROM public.orders WHERE id=$1`, [res.order_id])).rows[0];
      check('B1b mesa_identificador gravado = "05" (resolvido do token, nao do payload)', row.mesa_identificador === '05', JSON.stringify(row));
    });

    // ATAQUE 1: client manda mesa_qr_token da mesa 05 mas FORJA mesa_identificador='06' no payload.
    // O servidor deve IGNORAR o payload e usar so o token.
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE_A);
      const res = await criarPedido(STORE_A, PROD, { payment_method: 'dinheiro', tipo_pedido: 'mesa', origem_pedido: 'qr_mesa', mesa_qr_token: TOKEN_05, mesa_identificador: '06' });
      await resetRole();
      const row = (await client.query(`SELECT mesa_identificador FROM public.orders WHERE id=$1`, [res.order_id])).rows[0];
      check('B2 client forja mesa_identificador=06 no payload com token da mesa 05 -> servidor grava "05" (payload ignorado)', res.ok === true && row.mesa_identificador === '05', JSON.stringify({ res, row }));
    });

    // ATAQUE 2: sem token nenhum, so mesa_identificador no payload (o ataque original da auditoria).
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE_A);
      const res = await criarPedido(STORE_A, PROD, { payment_method: 'dinheiro', tipo_pedido: 'mesa', origem_pedido: 'qr_mesa', mesa_identificador: '05' });
      check('B3 pedido via QR SEM token (so mesa_identificador cru, ataque original da auditoria) -> bloqueado', res.ok === false && res.error === 'canal indisponivel para esta loja', JSON.stringify(res));
      await resetRole();
    });

    // ATAQUE 3: token de uma mesa da loja B usado numa chamada resolvida pra loja A.
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true')`, [STORE_B]);
      await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_canal_qr','true')`, [STORE_B]);
      await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_B]);
      await setRole('authenticated', ADMIN_UID, STORE_B);
      const mesaB = (await client.query(`SELECT public.admin_criar_mesa('05', $1) AS r`, [STORE_B])).rows[0].r;
      await resetRole();
      const tokenB = (await client.query(`SELECT qr_token FROM public.mesas WHERE id=$1`, [mesaB.id])).rows[0].qr_token;
      await setRole('authenticated', null, STORE_A);
      const res = await criarPedido(STORE_A, PROD, { payment_method: 'dinheiro', tipo_pedido: 'mesa', origem_pedido: 'qr_mesa', mesa_qr_token: tokenB });
      check('B4 token de mesa da loja B usado numa requisicao resolvida pra loja A -> bloqueado (cross-tenant)', res.ok === false && res.error === 'canal indisponivel para esta loja', JSON.stringify(res));
      await resetRole();
    });

    // ATAQUE 4: token invalido/aleatorio.
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE_A);
      const res = await criarPedido(STORE_A, PROD, { payment_method: 'dinheiro', tipo_pedido: 'mesa', origem_pedido: 'qr_mesa', mesa_qr_token: randomUUID() });
      check('B5 token aleatorio/inexistente -> bloqueado', res.ok === false && res.error === 'canal indisponivel para esta loja', JSON.stringify(res));
      await resetRole();
    });

    // REGRESSAO: admin_garcom continua SEM exigir token (nao e o canal do achado R3).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const res = await criarPedido(STORE_A, PROD, { payment_method: 'dinheiro', tipo_pedido: 'mesa', origem_pedido: 'admin_garcom', mesa_identificador: '07' });
      check('B6 REGRESSAO: admin_garcom continua funcionando sem token (garcom digita a mesa)', res.ok === true, JSON.stringify(res));
      await resetRole();
    });

    // REGRESSAO: entrega/retirada/mesa-sem-onda5 continuam intocados.
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE_A);
      const res = await criarPedido(STORE_A, PROD, { payment_method: 'dinheiro', address: 'Rua Teste, 1' });
      check('B7 REGRESSAO: entrega continua funcionando normalmente', res.ok === true, JSON.stringify(res));
      await resetRole();
    });

    // Rate limit existe (nao valida o numero exato, so que a funcao chama _rate_limit_hit sem erro).
    await withSavepoint(async () => {
      await setRole('anon');
      const r = await client.query(`SELECT public.resolver_mesa_por_token($1) AS r`, [TOKEN_06]);
      check('A4 resolver token da mesa 06 tambem funciona (nao e so a primeira mesa cadastrada)', r.rows[0].r.ok === true && r.rows[0].r.mesa_identificador === '06', JSON.stringify(r.rows[0].r));
      await resetRole();
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
