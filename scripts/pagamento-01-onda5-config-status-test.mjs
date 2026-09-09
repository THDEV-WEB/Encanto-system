// REF-PAGAMENTO-01 · Onda 5 (config + consulta de status client-facing) -- E2E dedicado.
// get_pagamento_config: espelha get_mesa_config. consultar_status_pagamento: unica forma do
// CLIENTE saber se o Pix foi pago (tela de espera faz polling nela).
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
async function setRole(role) { await client.query(`SET LOCAL ROLE ${role}`); }
async function resetRole() { await client.query(`RESET ROLE`); }

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-PAGAMENTO-01 · Onda 5 (config + status) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const STORE_A = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste PAGAMENTO-01 Onda5','ativo')`, [STORE_A, `pagamento01-onda5-${STORE_A}`]);

    // ── G: get_pagamento_config ──────────────────────────────────────────────────────────────
    await withSavepoint(async () => {
      const r1 = await client.query(`SELECT public.get_pagamento_config($1) AS r`, [STORE_A]);
      check('G1 sem nenhuma config -> habilitada=false, public_key=null', r1.rows[0].r.habilitada === false && r1.rows[0].r.public_key === null, JSON.stringify(r1.rows[0].r));
    });

    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'pagamento_online_habilitada','true'),($1,'mp_public_key','TEST-fake-public-key-so-teste')`, [STORE_A]);
      const r2 = await client.query(`SELECT public.get_pagamento_config($1) AS r`, [STORE_A]);
      check('G2 capability ligada + public_key setada -> devolve os dois', r2.rows[0].r.habilitada === true && r2.rows[0].r.public_key === 'TEST-fake-public-key-so-teste', JSON.stringify(r2.rows[0].r));
    });

    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'pagamento_online_habilitada','false')`, [STORE_A]);
      const r3 = await client.query(`SELECT public.get_pagamento_config($1) AS r`, [STORE_A]);
      check('G3 capability explicitamente false -> habilitada=false', r3.rows[0].r.habilitada === false, JSON.stringify(r3.rows[0].r));
    });

    await withSavepoint(async () => {
      await setRole('anon');
      const r4 = await client.query(`SELECT public.get_pagamento_config($1) AS r`, [STORE_A]);
      await resetRole();
      check('G4 chamavel como anon (checkout de convidado)', r4.rows[0].r !== null, JSON.stringify(r4.rows[0].r));
    });

    // ── H: consultar_status_pagamento ────────────────────────────────────────────────────────
    await withSavepoint(async () => {
      const r1 = await client.query(`SELECT public.consultar_status_pagamento($1) AS r`, [randomUUID()]);
      check('H1 payment_intent inexistente -> ok:false', r1.rows[0].r.ok === false && r1.rows[0].r.error.includes('nao encontrado'), JSON.stringify(r1.rows[0].r));
    });

    await withSavepoint(async () => {
      await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'pagamento_online_habilitada','true')`, [STORE_A]);
      const custId = randomUUID(); const orderId = randomUUID();
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES ($1,'Cliente Onda5','37600000000',$2)`, [custId, STORE_A]);
      await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido) VALUES ($1,$2,22.00,'aguardando_pagamento','pix_online','Rua Onda5',$3,'entrega','storefront')`, [orderId, custId, STORE_A]);
      const rpc = (await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_A])).rows[0].r;
      const piId = rpc.payment_intent_id;

      await setRole('anon');
      const r2 = await client.query(`SELECT public.consultar_status_pagamento($1) AS r`, [piId]);
      await resetRole();
      check('H2 payment_intent recem-criado (pendente) -> ok:true, status/order_id corretos, chamavel como anon', r2.rows[0].r.ok === true && r2.rows[0].r.status === 'pendente' && r2.rows[0].r.order_id === orderId, JSON.stringify(r2.rows[0].r));

      // Aprova via a mesma funcao interna da Onda 2/3 -- confirma que o polling reflete a mudanca real.
      await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`, [piId, STORE_A, 'mp-onda5-teste', 'aprovado', 'accredited', null]);
      const r3 = await client.query(`SELECT public.consultar_status_pagamento($1) AS r`, [piId]);
      check('H3 apos aprovacao -> polling reflete status=aprovado', r3.rows[0].r.status === 'aprovado', JSON.stringify(r3.rows[0].r));
    });

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
