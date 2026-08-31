// REF-MESA-01 · Onda 7 -- valida que o pipeline de notificacao (trigger -> enc_enqueue_notification ->
// notification_outbox -> enc_render_message) trata Mesa corretamente (tempo neutro, sem hedge de
// retirada/entrega) contra o projeto Supabase DEDICADO a E2E (nunca producao). CUIDADO EXTRA: tudo
// roda dentro de BEGIN...ROLLBACK -- uma linha NUNCA commitada em notification_outbox jamais fica
// visivel para outra sessao (isolamento de transacao padrao), entao o pg_cron real (enc_dispatch_
// notifications, sessao SEPARADA) nunca pode ver/despachar nada criado aqui, em nenhuma janela de
// tempo. Mesmo padrao das ondas anteriores: SAVEPOINT por caso. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';

function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const map = {};
  for (const line of txt.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i === -1) continue;
    map[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  if (!map.PGPASSWORD) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: map.PGHOST, port: Number(map.PGPORT || 5432), user: map.PGUSER, password: map.PGPASSWORD, database: map.PGDATABASE || 'postgres' };
}

const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, spCounter = 0, n = 0;
const telefone = () => `394${(n++).toString().padStart(8, '0')}`;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { return await fn(); } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
}
async function comoLoja(storeId) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ tenant_id: storeId })]);
  await client.query(`SET LOCAL ROLE authenticated`);
}
async function criarPedido(storeId, prodId, extra) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda7', phone: telefone() }),
     JSON.stringify({ payment_method: 'dinheiro', total: 20, ...extra }),
     JSON.stringify([{ product_id: prodId, nome_produto: 'Produto Onda7', quantity: 1 }]), storeId]);
  if (!r.rows[0].res.ok) throw new Error('create_order falhou no setup: ' + JSON.stringify(r.rows[0].res));
  return r.rows[0].res.order_id;
}
async function varsDoStatus(orderId, status) {
  const r = await client.query(`SELECT vars FROM public.notification_outbox WHERE order_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1`, [orderId, status]);
  return r.rows[0]?.vars || null;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-01 · Onda 7 (notificacoes tratam Mesa corretamente) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const STORE = randomUUID(); const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-01 Onda7','ativo')`, [STORE, `mesa01-onda7-${STORE}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda7',20.00,true,$2)`, [PROD, STORE]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true')`, [STORE]);

    // B1 -- pedido de MESA: recebido (INSERT dispara o trigger) + pronto (UPDATE dispara de novo).
    await withSavepoint(async () => {
      await comoLoja(STORE);
      const orderId = await criarPedido(STORE, PROD, { tipo_pedido: 'mesa', mesa_identificador: '14' });
      await client.query('RESET ROLE'); // UPDATE/SELECT abaixo precisam de visibilidade plena (bypass RLS)

      const varsRecebido = await varsDoStatus(orderId, 'recebido');
      check('B1a recebido (mesa): tempo = "preparo em andamento" (nunca "até Nmin")',
        varsRecebido?.tempo === 'preparo em andamento', JSON.stringify(varsRecebido));
      check('B1b recebido (mesa): var mesa = "14"', varsRecebido?.mesa === '14', JSON.stringify(varsRecebido));

      await client.query(`UPDATE public.orders SET status = 'preparo' WHERE id = $1`, [orderId]);
      await client.query(`UPDATE public.orders SET status = 'pronto' WHERE id = $1`, [orderId]);
      const varsPronto = await varsDoStatus(orderId, 'pronto');
      check('B1c pronto (mesa): situacao = "Em breve será servido em sua mesa." (sem hedge)',
        varsPronto?.situacao === 'Em breve será servido em sua mesa.', JSON.stringify(varsPronto));

      const msg = await client.query(`SELECT public.enc_render_message('pronto', $1::jsonb) AS m`, [JSON.stringify(varsPronto)]);
      const texto = msg.rows[0].m;
      check('B1d texto renderizado (mesa) NAO hedgeia "se for retirada"/"se for entrega"',
        !/se for retirada/i.test(texto) && !/se for entrega/i.test(texto), texto);
      check('B1e texto renderizado (mesa) contem a situacao certa', texto.includes('Em breve será servido em sua mesa.'), texto);
    });

    // B2 -- regressao: retirada continua com tempo/situacao de sempre.
    await withSavepoint(async () => {
      await comoLoja(STORE);
      const orderId = await criarPedido(STORE, PROD, { retirada: true, address: 'Retirada na loja - x' });
      await client.query('RESET ROLE');
      const varsRecebido = await varsDoStatus(orderId, 'recebido');
      check('B2a recebido (retirada): tempo = "cerca de 20 min" (regressao)', varsRecebido?.tempo === 'cerca de 20 min', JSON.stringify(varsRecebido));

      await client.query(`UPDATE public.orders SET status = 'preparo' WHERE id = $1`, [orderId]);
      await client.query(`UPDATE public.orders SET status = 'pronto' WHERE id = $1`, [orderId]);
      const varsPronto = await varsDoStatus(orderId, 'pronto');
      check('B2b pronto (retirada): situacao = "Já pode ser buscado." (regressao)', varsPronto?.situacao === 'Já pode ser buscado.', JSON.stringify(varsPronto));
    });

    // B3 -- regressao: entrega continua com tempo/situacao de sempre (via delivery_eta_min configurado).
    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'delivery_eta_min','33')`, [STORE]);
      await comoLoja(STORE);
      const orderId = await criarPedido(STORE, PROD, { address: 'Rua Y, 5' });
      await client.query('RESET ROLE');
      const varsRecebido = await varsDoStatus(orderId, 'recebido');
      check('B3a recebido (entrega): tempo = "até 33 min" (config da loja, regressao)', varsRecebido?.tempo === 'até 33 min', JSON.stringify(varsRecebido));

      await client.query(`UPDATE public.orders SET status = 'preparo' WHERE id = $1`, [orderId]);
      await client.query(`UPDATE public.orders SET status = 'pronto' WHERE id = $1`, [orderId]);
      const varsPronto = await varsDoStatus(orderId, 'pronto');
      check('B3b pronto (entrega): situacao = "Nosso entregador sairá em instantes." (regressao)', varsPronto?.situacao === 'Nosso entregador sairá em instantes.', JSON.stringify(varsPronto));
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
