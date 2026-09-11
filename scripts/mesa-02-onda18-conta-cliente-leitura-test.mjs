// REF-MESA-02 · Onda 18 (conta do cliente, so leitura) -- E2E dedicado.
// consultar_minha_conta_mesa(p_qr_token): cliente ve pedidos+total da PROPRIA mesa (sessao aberta),
// resolvido SOMENTE pelo qr_token opaco (mesmo padrao de seguranca de resolver_mesa_por_token, Onda 5
// -- nunca por mesa_identificador digitado, que e enumeravel). Publica (anon/authenticated), nunca
// devolve 'alocacoes' (divisao de conta fora de escopo desta onda, decisao explicita do dono).
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

let pass = 0, fail = 0, spCounter = 0, n = 0;
const telefone = () => `376${(n++).toString().padStart(8, '0')}`;
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { return await fn(); } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
}
async function setRole(role, sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function resetRole() { await client.query(`RESET ROLE`); await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`); }

async function abrirSessao(storeId, identificador, produto, qty) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda18', phone: telefone() }),
     JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: identificador, origem_pedido: 'admin_garcom' }),
     JSON.stringify([{ product_id: produto, nome_produto: 'Produto Onda18', quantity: qty }]),
     storeId]);
  return r.rows[0].res;
}
async function consultarMinhaConta(qrToken) {
  return (await client.query(`SELECT public.consultar_minha_conta_mesa($1::uuid) AS res`, [qrToken])).rows[0].res;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 18 (conta do cliente, so leitura) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    const ADMIN_UID = authUsers[0].id;

    const STORE_A = randomUUID(); const STORE_B = randomUUID();
    const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda18 A','ativo'),($3,$4,'Loja Teste MESA-02 Onda18 B','ativo')`,
      [STORE_A, `mesa02-onda18-a-${STORE_A}`, STORE_B, `mesa02-onda18-b-${STORE_B}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda18',12.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true')`, [STORE_A]);
    const mesaRow = (await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'70') RETURNING id, qr_token`, [STORE_A])).rows[0];

    // ── 1: sem token -> nao encontrada ───────────────────────────────────────────────────────
    await withSavepoint(async () => {
      const r = await consultarMinhaConta(null);
      check('1 sem token -> mesa nao encontrada', r.ok === false && r.error === 'mesa nao encontrada', JSON.stringify(r));
    });

    // ── 2: token aleatorio/inexistente -> nao encontrada (nunca revela detalhe) ──────────────
    await withSavepoint(async () => {
      const r = await consultarMinhaConta(randomUUID());
      check('2 token aleatorio -> mesa nao encontrada', r.ok === false && r.error === 'mesa nao encontrada', JSON.stringify(r));
    });

    // ── 3: token valido, mesa sem sessao aberta ──────────────────────────────────────────────
    await withSavepoint(async () => {
      const r = await consultarMinhaConta(mesaRow.qr_token);
      check('3 mesa sem sessao -> aberta:false, pedidos:[], total:0', r.ok === true && r.aberta === false && Array.isArray(r.pedidos) && r.pedidos.length === 0 && Number(r.total) === 0, JSON.stringify(r));
    });

    // ── 4: token valido, sessao aberta com 2 pedidos -- reflete pedidos+total corretos ───────
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      await abrirSessao(STORE_A, '70', PROD, 2); // 24
      await abrirSessao(STORE_A, '70', PROD, 1); // 12 -- mesma sessao (ja aberta)
      await resetRole();

      const r = await consultarMinhaConta(mesaRow.qr_token);
      check('4a aberta:true, 2 pedidos', r.ok === true && r.aberta === true && r.pedidos.length === 2, JSON.stringify(r));
      check('4b total correto (24+12=36)', Number(r.total) === 36, JSON.stringify(r));
      check('4c itens do pedido presentes (nome/qty/preco)', r.pedidos[0].itens[0].nome_produto === 'Produto Onda18' && Number(r.pedidos[0].itens[0].preco_unitario) === 12, JSON.stringify(r.pedidos[0]));
    });

    // ── 5: NUNCA devolve alocacoes (fora de escopo desta onda) mesmo com divisao criada ──────
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '70', PROD, 1); // 12
      await client.query(`SELECT public.admin_dividir_conta_mesa($1::uuid, $2::jsonb, $3::uuid)`,
        [aberto.mesa_session_id, JSON.stringify([{ valor: 6, metodo: 'pix' }, { valor: 6, metodo: 'dinheiro' }]), STORE_A]);
      await resetRole();

      const r = await consultarMinhaConta(mesaRow.qr_token);
      check('5 resposta nunca inclui alocacoes (fora de escopo, so leitura de pedidos)', r.alocacoes === undefined, JSON.stringify(r));
    });

    // ── 6: cross-tenant -- token de A nunca vaza dado de B (join implicito por store_id) ─────
    await withSavepoint(async () => {
      const mesaB = (await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'70') RETURNING qr_token`, [STORE_B])).rows[0];
      const r = await consultarMinhaConta(mesaB.qr_token);
      check('6 mesa "70" da loja B (mesmo identificador, token diferente) nao ve nada de A', r.ok === true && r.aberta === false, JSON.stringify(r));
    });

    // ── 7: chamada como anon puro (sem NENHUM auth.uid(), simula cliente que nem logou) ──────
    await withSavepoint(async () => {
      await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`);
      await client.query(`SET LOCAL ROLE anon`);
      const r = await consultarMinhaConta(mesaRow.qr_token);
      check('7 anon (sem login nenhum) consegue consultar -- publica por design', r.ok === true, JSON.stringify(r));
      await resetRole();
    });

    // ── 8: regressao -- admin_consultar_conta_mesa (do garcom) continua intacta/inalterada ───
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      await abrirSessao(STORE_A, '70', PROD, 1);
      const conta = (await client.query(`SELECT public.admin_consultar_conta_mesa('70', $1::uuid) AS res`, [STORE_A])).rows[0].res;
      check('8 admin_consultar_conta_mesa continua funcionando (com alocacoes:[])', conta.ok === true && Array.isArray(conta.alocacoes), JSON.stringify(conta));
      await resetRole();
    });

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
