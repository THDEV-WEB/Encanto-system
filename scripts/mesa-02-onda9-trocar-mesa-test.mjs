// REF-MESA-02 · Onda 9 (troca de mesa) -- E2E dedicado.
// admin_trocar_mesa_sessao(): move uma sessao aberta de uma mesa fisica pra outra sem fechar nada.
// Confirma: caso feliz (mesa antiga fica livre, nova fica ocupada, historico preservado --
// mesa_session_mesas ganha linha nova, linha antiga vira 'fechada' mas continua existindo);
// idempotencia amigavel (trocar pra mesma mesa -> ok sem duplicar linha); mesa destino ja ocupada
// por OUTRA sessao -> "mesa ja ocupada" (unique_violation do indice da Onda 2, nao um novo
// mecanismo); mesa destino indisponivel -> rejeitado; mesa destino inexistente -> "mesa nao
// encontrada"; sessao ja fechada -> rejeitada; sessao de outra loja -> "sessao nao encontrada"
// (cross-tenant); outsider sem permissao. SAVEPOINT por caso.
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
const telefone = () => `372${(n++).toString().padStart(8, '0')}`;
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

async function abrirSessao(storeId, identificador, produto) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda9', phone: telefone() }),
     JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: identificador, origem_pedido: 'admin_garcom' }),
     JSON.stringify([{ product_id: produto, nome_produto: 'Produto Onda9', quantity: 1 }]),
     storeId]);
  return r.rows[0].res;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 9 (troca de mesa) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID, OUTRO_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID(); const STORE_B = randomUUID();
    const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda9 A','ativo'),($3,$4,'Loja Teste MESA-02 Onda9 B','ativo')`,
      [STORE_A, `mesa02-onda9-a-${STORE_A}`, STORE_B, `mesa02-onda9-b-${STORE_B}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda9',10.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'30'),($1,'31'),($1,'32')`, [STORE_A]);
    await client.query(`UPDATE public.mesas SET status='indisponivel' WHERE store_id=$1 AND identificador='32'`, [STORE_A]);

    // B1: caso feliz -- abre sessao na mesa 30, troca pra mesa 31.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '30', PROD);
      check('B1 setup: sessao aberta na mesa 30', aberto.ok === true && aberto.mesa_session_id, JSON.stringify(aberto));

      const res = await client.query(`SELECT public.admin_trocar_mesa_sessao($1::uuid, '31', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B2 troca 30 -> 31 -> sucesso, de/para corretos', r.ok === true && r.de === '30' && r.para === '31', JSON.stringify(r));

      const conta30 = (await client.query(`SELECT public.admin_consultar_conta_mesa('30', $1::uuid) AS res`, [STORE_A])).rows[0].res;
      check('B3 mesa 30 fica livre (sem sessao aberta)', conta30.ok === true && conta30.aberta === false, JSON.stringify(conta30));

      const conta31 = (await client.query(`SELECT public.admin_consultar_conta_mesa('31', $1::uuid) AS res`, [STORE_A])).rows[0].res;
      check('B4 mesa 31 assume a MESMA sessao (mesmo sessao_id, mesmo total)', conta31.ok === true && conta31.aberta === true && conta31.sessao_id === aberto.mesa_session_id && Number(conta31.total) === 10, JSON.stringify(conta31));
      await resetRole();

      // mesa_session_mesas tem REVOKE ALL de authenticated (Onda 2) -- consulta direta so' como
      // o papel da conexao (postgres/superuser, dono da tabela), nunca como authenticated.
      // attached_at e' now() no mesmo milissegundo pras 2 linhas deste teste -- nao ordenar por ele,
      // conferir por identificador (nao por posicao) o que realmente importa: mesa 30 fechada,
      // mesa 31 aberta, as DUAS linhas continuam existindo (nada foi apagado).
      const historico = await client.query(`SELECT mesa_identificador, status_sessao FROM public.mesa_session_mesas WHERE mesa_session_id=$1`, [aberto.mesa_session_id]);
      const porIdent = Object.fromEntries(historico.rows.map(r => [r.mesa_identificador, r.status_sessao]));
      check('B5 historico preservado: linha da mesa 30 continua existindo, agora fechada; mesa 31 aberta', historico.rows.length === 2 && porIdent['30'] === 'fechada' && porIdent['31'] === 'aberta', JSON.stringify(historico.rows));
    });

    // B6: trocar pra mesma mesa onde ja esta -> no-op amigavel, sem duplicar linha.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '30', PROD);
      const res = await client.query(`SELECT public.admin_trocar_mesa_sessao($1::uuid, '30', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B6 trocar pra mesma mesa -> ok, no-op', r.ok === true && r.de === '30' && r.para === '30', JSON.stringify(r));
      await resetRole();
      const linhas = await client.query(`SELECT count(*)::int AS c FROM public.mesa_session_mesas WHERE mesa_session_id=$1`, [aberto.mesa_session_id]);
      check('B7 no-op nao duplica linha em mesa_session_mesas', linhas.rows[0].c === 1, JSON.stringify(linhas.rows));
    });

    // B8: mesa destino ja ocupada por OUTRA sessao -> "mesa ja ocupada".
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const s1 = await abrirSessao(STORE_A, '30', PROD);
      const s2 = await abrirSessao(STORE_A, '31', PROD);
      const res = await client.query(`SELECT public.admin_trocar_mesa_sessao($1::uuid, '31', $2::uuid) AS res`, [s1.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B8 mesa destino ja ocupada por outra sessao -> mesa ja ocupada', r.ok === false && r.error === 'mesa ja ocupada', JSON.stringify(r));
      // garante que nada mudou de verdade (sessao 1 continua na 30, sessao 2 continua na 31).
      const c30 = (await client.query(`SELECT public.admin_consultar_conta_mesa('30', $1::uuid) AS res`, [STORE_A])).rows[0].res;
      check('B9 nenhuma alteracao real apos rejeicao (mesa 30 continua com sessao 1)', c30.sessao_id === s1.mesa_session_id, JSON.stringify([c30, s2]));
      await resetRole();
    });

    // B10: mesa destino indisponivel -> rejeitado.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '30', PROD);
      const res = await client.query(`SELECT public.admin_trocar_mesa_sessao($1::uuid, '32', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B10 mesa destino indisponivel -> mesa indisponivel', r.ok === false && r.error === 'mesa indisponivel', JSON.stringify(r));
      await resetRole();
    });

    // B11: mesa destino inexistente no catalogo -> "mesa nao encontrada".
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '30', PROD);
      const res = await client.query(`SELECT public.admin_trocar_mesa_sessao($1::uuid, 'mesa-inexistente', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B11 mesa destino inexistente -> mesa nao encontrada', r.ok === false && r.error === 'mesa nao encontrada', JSON.stringify(r));
      await resetRole();
    });

    // B12: sessao ja fechada -> rejeitada.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '30', PROD);
      await resetRole();
      await client.query(`UPDATE public.mesa_sessions SET status='fechada', closed_at=now(), closed_by_admin_user_id=$2, payment_method='dinheiro', valor_cobrado_snapshot=10 WHERE id=$1`, [aberto.mesa_session_id, ADMIN_UID]);
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const res = await client.query(`SELECT public.admin_trocar_mesa_sessao($1::uuid, '31', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B12 sessao ja fechada -> sessao ja fechada', r.ok === false && r.error === 'sessao ja fechada', JSON.stringify(r));
      await resetRole();
    });

    // B13: cross-tenant -- sessao pertence a STORE_A, tentativa de trocar usando STORE_B (loja
    // errada no parametro) -> "sessao nao encontrada" (nunca vaza que a sessao existe noutra loja).
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [OUTRO_UID, STORE_B]);
      await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'31')`, [STORE_B]);
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '30', PROD);
      await resetRole();
      await setRole('authenticated', OUTRO_UID, STORE_B);
      const res = await client.query(`SELECT public.admin_trocar_mesa_sessao($1::uuid, '31', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_B]);
      const r = res.rows[0].res;
      check('B13 cross-tenant: sessao de A nao e encontrada por B -> sessao nao encontrada', r.ok === false && r.error === 'sessao nao encontrada', JSON.stringify(r));
      await resetRole();
    });

    // B14: outsider sem is_admin_of -> sem permissao.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const aberto = await abrirSessao(STORE_A, '30', PROD);
      await resetRole();
      const OUTSIDER = randomUUID();
      await setRole('authenticated', OUTSIDER, STORE_A);
      const res = await client.query(`SELECT public.admin_trocar_mesa_sessao($1::uuid, '31', $2::uuid) AS res`, [aberto.mesa_session_id, STORE_A]);
      const r = res.rows[0].res;
      check('B14 outsider sem is_admin_of -> sem permissao', r.ok === false && r.error === 'sem permissao', JSON.stringify(r));
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
