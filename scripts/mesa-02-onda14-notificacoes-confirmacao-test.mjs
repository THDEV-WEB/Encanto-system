// REF-MESA-02 · Onda 14 (notificacoes -- so' testes de confirmacao, NENHUMA mudanca de logica
// esperada). Confirmado por leitura de codigo antes de escrever este teste:
// enc_enqueue_notification()/trg_enc_order_notify (REF-ORDER-01 + REF-MESA-01 Onda 7) disparam SO
// por INSERT/UPDATE de orders.status -- nao ha nenhum trigger em mesa_sessions, entao abrir/fechar
// sessao (Ondas 6/11) nao enfileira nada por si so. Notificacao continua 100% POR PEDIDO, nunca por
// sessao -- decisao ja registrada como aceita pela propria auditoria (secao 7: "nao resolve nem
// piora", R11 = risco BAIXO ja aceito). Este teste PROVA isso com casos reais de mesa+sessao em vez
// de so' presumir -- inclusive a interacao entre troca de mesa (Onda 9) e o conteudo ja enfileirado
// de pedidos anteriores (imutavel, historico). SAVEPOINT por caso.
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
const telefone = () => `377${(n++).toString().padStart(8, '0')}`;
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

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 14 (notificacoes -- confirmacao) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID();
    const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda14','ativo')`, [STORE_A, `mesa02-onda14-${STORE_A}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda14',10.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_sessao_habilitada','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'80'),($1,'81')`, [STORE_A]);

    async function pedidoMesa(identificador) {
      const r = await client.query(
        `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
        [JSON.stringify({ name: 'Cliente Onda14', phone: telefone() }),
         JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: identificador, origem_pedido: 'admin_garcom' }),
         JSON.stringify([{ product_id: PROD, nome_produto: 'Produto Onda14', quantity: 1 }]),
         STORE_A]);
      return r.rows[0].res;
    }

    // B1: 1 pedido de mesa com sessao enfileira 'recebido' com o mesmo conteudo/vars da MESA-01
    // Onda 7 (situacao/tempo/mesa) -- mesa_session_id nao interfere em nada.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const p1 = await pedidoMesa('80');
      await resetRole();
      const outbox = await client.query(`SELECT status, vars FROM public.notification_outbox WHERE order_id = $1`, [p1.order_id]);
      check('B1 pedido de mesa com sessao enfileira exatamente 1 notificacao (recebido)', outbox.rows.length === 1 && outbox.rows[0].status === 'recebido', JSON.stringify(outbox.rows));
      check('B2 vars.mesa = identificador correto, vars.tempo = "preparo em andamento" (regressao MESA-01 Onda 7)', outbox.rows[0].vars.mesa === '80' && outbox.rows[0].vars.tempo === 'preparo em andamento', JSON.stringify(outbox.rows[0].vars));

      // avanca pra 'pronto' -- confirma o ramo de mesa em situacao.
      await client.query(`UPDATE public.orders SET status = 'pronto' WHERE id = $1`, [p1.order_id]);
      const pronto = await client.query(`SELECT vars FROM public.notification_outbox WHERE order_id = $1 AND status = 'pronto'`, [p1.order_id]);
      check('B3 status pronto enfileira com situacao de mesa correta', pronto.rows.length === 1 && pronto.rows[0].vars.situacao === 'Em breve será servido em sua mesa.', JSON.stringify(pronto.rows));
    });

    // B5: sessao com 3 pedidos -> 3 sequencias de notificacao INDEPENDENTES (comportamento aceito
    // pela auditoria, nao e' bug -- confirma que continua assim, nao regrediu pra menos nem virou
    // consolidado sem decisao explicita).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const p1 = await pedidoMesa('80'); const p2 = await pedidoMesa('80'); const p3 = await pedidoMesa('80');
      check('B4 setup: 3 pedidos na mesma sessao', p1.mesa_session_id === p2.mesa_session_id && p2.mesa_session_id === p3.mesa_session_id, JSON.stringify([p1, p2, p3]));
      await resetRole();
      const outbox = await client.query(`SELECT order_id, status FROM public.notification_outbox WHERE order_id IN ($1,$2,$3)`, [p1.order_id, p2.order_id, p3.order_id]);
      check('B5 3 pedidos na mesma sessao geram 3 notificacoes independentes (1 por pedido, nunca consolidado por sessao)', outbox.rows.length === 3, JSON.stringify(outbox.rows));
    });

    // B7: abrir/fechar sessao NAO enfileira notificacao por si so -- so orders.status dispara o
    // trigger (mesa_sessions nao tem nenhum trigger de notificacao).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const p1 = await pedidoMesa('80');
      const antes = await client.query(`SELECT count(*)::int AS c FROM public.notification_outbox WHERE order_id = $1`, [p1.order_id]);
      await client.query(`SELECT public.admin_fechar_conta_mesa($1::uuid, 'dinheiro', $2::uuid) AS res`, [p1.mesa_session_id, STORE_A]);
      const depois = await client.query(`SELECT count(*)::int AS c FROM public.notification_outbox WHERE order_id = $1`, [p1.order_id]);
      check('B6 fechar a conta NAO enfileira notificacao nenhuma (trigger e so em orders.status)', antes.rows[0].c === depois.rows[0].c, JSON.stringify({ antes: antes.rows[0], depois: depois.rows[0] }));
      await resetRole();
    });

    // B8: troca de mesa (Onda 9) DEPOIS de um pedido ja criado -- a notificacao JA enfileirada
    // continua com o identificador ANTIGO (imutavel, historico), e um pedido NOVO criado apos a
    // troca (mesma sessao, mesa fisica nova) enfileira com o identificador NOVO -- as 2 features
    // compoem sem contaminacao cruzada.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const p1 = await pedidoMesa('80');
      await client.query(`SELECT public.admin_trocar_mesa_sessao($1::uuid, '81', $2::uuid) AS res`, [p1.mesa_session_id, STORE_A]);
      const p2 = await pedidoMesa('81');
      await resetRole();

      const n1 = await client.query(`SELECT vars FROM public.notification_outbox WHERE order_id = $1 AND status='recebido'`, [p1.order_id]);
      const n2 = await client.query(`SELECT vars FROM public.notification_outbox WHERE order_id = $1 AND status='recebido'`, [p2.order_id]);
      check('B7 notificacao do pedido ANTES da troca continua com a mesa ANTIGA (imutavel/historico)', n1.rows[0].vars.mesa === '80', JSON.stringify(n1.rows));
      check('B8 notificacao do pedido DEPOIS da troca usa a mesa NOVA', n2.rows[0].vars.mesa === '81', JSON.stringify(n2.rows));
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
