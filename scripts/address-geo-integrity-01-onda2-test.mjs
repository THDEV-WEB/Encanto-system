// REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2 -- valida bounding box (Parte 1, _resolve_delivery_fee) e
// ownership de endereco_id (Parte 2, create_order) contra o projeto Supabase DEDICADO a E2E (nunca
// producao). Mesmo padrao de scripts/delivery-fee-04-onda1-test.mjs: conexao pg direta (db.e2e.env),
// cada caso em BEGIN...ROLLBACK, SET LOCAL request.jwt.claims/request.headers simula sessao/origin.
// Dados 100% descartaveis, criados dentro da propria transacao. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const password = envGet(txt, 'PGPASSWORD');
  if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: envGet(txt, 'PGHOST'), port: Number(envGet(txt, 'PGPORT') || 5432), user: envGet(txt, 'PGUSER'), password, database: envGet(txt, 'PGDATABASE') || 'postgres' };
}

const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, n = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}

async function withTx(fn) {
  await client.query('BEGIN');
  try { return await fn(); } finally { await client.query('ROLLBACK'); }
}
// tenant_id sempre setado (mesma tecnica de scripts/delivery-fee-04-onda1-test.mjs `comoLoja`) --
// faz v_tenant bater com p_store_id dentro de create_order, sem depender de Origin/dominio
// configurado no fixture. sub ausente -> auth.uid() continua NULL (simula guest normalmente).
async function setJwt(sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
}
const telefone = () => `398${(n++).toString().padStart(8, '0')}`;

function callCreateOrder(customer, order, items, storeId) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), storeId]
  );
}
async function getOrder(orderId) {
  const r = await client.query(`SELECT delivery_fee, maquininha_fee, total, endereco_id FROM public.orders WHERE id = $1`, [orderId]);
  return r.rows[0];
}

// Blumenau/SC (mesmo referencial de scripts/delivery-fee-04-onda1-test.mjs).
const LOJA_LAT = -26.9000, LOJA_LNG = -48.6000;
const PERTO_LAT = -26.9060, PERTO_LNG = -48.6060;     // ~0.9km  -> faixa 1 (dentro das faixas pagas)
const LONGE_LAT = -26.9450, LONGE_LNG = -48.6450;     // ~6.7km  -> faixa 2
const NO_BBOX_MAS_FORA_LAT = -27.0800, NO_BBOX_MAS_FORA_LNG = -48.9200; // ~37.5km (haversine exato) -> fora das faixas curtas, DENTRO do bbox (piso 50km)
const GROSSEIRO_LAT = -27.9500, GROSSEIRO_LNG = -49.8500; // ~130km -> ALEM do bbox -> deve ser rejeitado

const FAIXAS = [{ de: 0, ate: 5, valor: 10.00 }, { de: 5.1, ate: 10, valor: 20.00 }];
// bbox esperado para estas faixas: GREATEST(10*3, 50) = 50km.

async function main() {
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, current_database() AS db")).rows[0];
  console.log(`Conectado como ${meta.who} em ${meta.db} (projeto E2E dedicado, nunca producao)\n`);

  console.log('==========================================================================');
  console.log(' REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2 (bbox + ownership) · E2E');
  console.log('==========================================================================\n');

  const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
  if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E (fixtures).'); process.exit(2); }
  const [AUTH_C, AUTH_D] = authUsers.map(r => r.id);

  try {
    // ═══════════════════════════════ GEOGRAFIA (G1-G7) ═══════════════════════════════════════════
    console.log('── GEOGRAFIA ──\n');

    let STORE, PROD, END;
    async function setupLoja(faixas = FAIXAS, ativo = true) {
      STORE = randomUUID(); PROD = randomUUID();
      await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste GEO2','ativo')`, [STORE, `geo2-${randomUUID()}`]);
      await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto GEO2',15.00,true,$2)`, [PROD, STORE]);
      await client.query(
        `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'company_info',$2::text), ($1,'delivery_fee_config',$3::text)`,
        [STORE, JSON.stringify({ lojaLat: LOJA_LAT, lojaLng: LOJA_LNG }),
         JSON.stringify({ version: 1, ativo, maquininha: { ativo: false, valor: 0 }, faixas })]
      );
    }
    async function addr(lat, lng, customerId = null) {
      const id = randomUUID();
      await client.query(`INSERT INTO public.addresses (id, store_id, customer_id, rua, numero, latitude, longitude) VALUES ($1,$2,$3,'Rua Teste','1',$4,$5)`,
        [id, STORE, customerId, lat, lng]);
      return id;
    }
    const item = () => [{ product_id: PROD, nome_produto: 'Produto GEO2', quantity: 1 }];

    // G1 — coordenada legitima dentro do limite (faixa 1, PERTO) -> calcula normalmente.
    await withTx(async () => {
      await setupLoja();
      await setJwt(null, STORE);
      END = await addr(PERTO_LAT, PERTO_LNG);
      const r = await callCreateOrder({ name: 'G1', phone: telefone() }, { payment_method: 'dinheiro', address: 'Rua Teste, 1', endereco_id: END }, item(), STORE);
      const res = r.rows[0].res;
      const o = res.ok ? await getOrder(res.order_id) : null;
      check('G1 — coordenada legitima dentro do limite -> delivery_fee=10.00 (faixa 1), pedido OK', res.ok && Number(o?.delivery_fee) === 10.00, JSON.stringify(res));
    });

    // G2 — coordenada grosseiramente distante -> rejeitada (ok:false, erro de implausibilidade).
    await withTx(async () => {
      await setupLoja();
      await setJwt(null, STORE);
      END = await addr(GROSSEIRO_LAT, GROSSEIRO_LNG);
      const r = await callCreateOrder({ name: 'G2', phone: telefone() }, { payment_method: 'dinheiro', address: 'Rua Muito Longe, 999', endereco_id: END }, item(), STORE);
      const res = r.rows[0].res;
      check('G2 — coordenada grosseiramente distante (~130km, bbox=50km) -> ok:false, erro de implausibilidade',
        res.ok === false && /implausiv/i.test(res.error || ''), JSON.stringify(res));
    });

    // G3 — coordenada fake PROXIMA da loja quando o endereco textual e' distante -> mitigacao NAO
    // fecha o ataque fino (documentado): cobra a faixa da coordenada fake mesmo assim.
    await withTx(async () => {
      await setupLoja();
      await setJwt(null, STORE);
      END = await addr(PERTO_LAT, PERTO_LNG); // coordenada fake perto, endereco textual "declarado" como distante
      const r = await callCreateOrder({ name: 'G3', phone: telefone() }, { payment_method: 'dinheiro', address: 'Rua Alegadamente Muito Distante, 500', endereco_id: END }, item(), STORE);
      const res = r.rows[0].res;
      const o = res.ok ? await getOrder(res.order_id) : null;
      check('G3 — ataque fino (coordenada fake dentro do bbox) NAO e bloqueado -> cobra faixa 1 (comportamento documentado, nao um bug)',
        res.ok && Number(o?.delivery_fee) === 10.00, JSON.stringify(res));
    });

    // G4 — isolamento entre lojas: bbox e' calculado a partir das PROPRIAS faixas de cada loja.
    await withTx(async () => {
      // Loja A: faixas curtas (ate 10km) -> bbox = GREATEST(10*3,50) = 50km -> ~37.5km passa no bbox.
      await setupLoja(FAIXAS);
      await setJwt(null, STORE);
      const ENDA = await addr(NO_BBOX_MAS_FORA_LAT, NO_BBOX_MAS_FORA_LNG);
      const rA = await callCreateOrder({ name: 'G4a', phone: telefone() }, { payment_method: 'dinheiro', address: 'Rua A, 1', endereco_id: ENDA }, item(), STORE);
      check('G4a — loja com faixas curtas: ~37.5km fica DENTRO do bbox (50km) -> pedido OK, fee=0 (fora das faixas pagas)', rA.rows[0].res.ok && Number((await getOrder(rA.rows[0].res.order_id)).delivery_fee) === 0, JSON.stringify(rA.rows[0].res));

      // Loja B: faixas longas (ate 40km) -> bbox = GREATEST(40*3,50) = 120km -> mesma distancia
      // (~37.5km, haversine exato) cai DENTRO de faixa paga.
      const FAIXAS_B = [{ de: 0, ate: 40, valor: 25.00 }];
      await setupLoja(FAIXAS_B);
      await setJwt(null, STORE);
      const ENDB = await addr(NO_BBOX_MAS_FORA_LAT, NO_BBOX_MAS_FORA_LNG);
      const rB = await callCreateOrder({ name: 'G4b', phone: telefone() }, { payment_method: 'dinheiro', address: 'Rua B, 1', endereco_id: ENDB }, item(), STORE);
      check('G4b — loja com faixas longas: MESMA distancia (~37.5km) cai na faixa paga da loja B (bbox isolado por tenant)', rB.rows[0].res.ok && Number((await getOrder(rB.rows[0].res.order_id)).delivery_fee) === 25.00, JSON.stringify(rB.rows[0].res));
    });

    // G5 — coordenadas ausentes/nulas -> fallback preservado (R$0), bbox nunca entra em jogo.
    await withTx(async () => {
      await setupLoja();
      await setJwt(null, STORE);
      const r = await callCreateOrder({ name: 'G5', phone: telefone() }, { payment_method: 'dinheiro', address: 'Sem endereco_id, so texto' }, item(), STORE);
      const res = r.rows[0].res;
      const o = res.ok ? await getOrder(res.order_id) : null;
      check('G5 — sem endereco_id (null) -> delivery_fee=0, pedido OK (preservado)', res.ok && Number(o?.delivery_fee) === 0, JSON.stringify(res));
    });

    // G6 — retirada: bbox nao entra em jogo (retorna 0/0 antes de qualquer calculo de distancia).
    await withTx(async () => {
      await setupLoja();
      await setJwt(null, STORE);
      END = await addr(GROSSEIRO_LAT, GROSSEIRO_LNG); // coordenada implausivel, mas retirada ignora
      const r = await callCreateOrder({ name: 'G6', phone: telefone() }, { payment_method: 'dinheiro', address: 'Retirada na loja', retirada: true, endereco_id: END }, item(), STORE);
      const res = r.rows[0].res;
      const o = res.ok ? await getOrder(res.order_id) : null;
      check('G6 — retirada com endereco de coordenada implausivel -> NAO rejeita (retirada ignora distancia), fee=0', res.ok && Number(o?.delivery_fee) === 0, JSON.stringify(res));
    });

    // G7 — endereco existe mas SEM coordenadas gravadas -> fallback preservado (R$0), bbox nao entra.
    await withTx(async () => {
      await setupLoja();
      await setJwt(null, STORE);
      const idSemCoord = randomUUID();
      await client.query(`INSERT INTO public.addresses (id, store_id, rua, numero, latitude, longitude) VALUES ($1,$2,'Rua Sem Coord','1',NULL,NULL)`, [idSemCoord, STORE]);
      const r = await callCreateOrder({ name: 'G7', phone: telefone() }, { payment_method: 'dinheiro', address: 'Rua Sem Coord, 1', endereco_id: idSemCoord }, item(), STORE);
      const res = r.rows[0].res;
      const o = res.ok ? await getOrder(res.order_id) : null;
      check('G7 — endereco sem lat/lng gravado -> delivery_fee=0, pedido OK (preservado)', res.ok && Number(o?.delivery_fee) === 0, JSON.stringify(res));
    });

    // ═══════════════════════════════ OWNERSHIP (O8-O12) ═══════════════════════════════════════════
    console.log('\n── OWNERSHIP ──\n');

    let STORE2, PROD2, OUTRA_LOJA, CUSTOMER_C, CUSTOMER_D;
    await withTx(async () => {
      STORE2 = randomUUID(); PROD2 = randomUUID(); OUTRA_LOJA = randomUUID();
      await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste OWNERSHIP','ativo')`, [STORE2, `own2-${randomUUID()}`]);
      await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Outra Loja OWNERSHIP','ativo')`, [OUTRA_LOJA, `own2-outra-${randomUUID()}`]);
      await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto OWN2',15.00,true,$2)`, [PROD2, STORE2]);
      await client.query(
        `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'company_info',$2::text), ($1,'delivery_fee_config',$3::text)`,
        [STORE2, JSON.stringify({ lojaLat: LOJA_LAT, lojaLng: LOJA_LNG }), JSON.stringify({ version: 1, ativo: false, maquininha: { ativo: false, valor: 0 }, faixas: [] })]
      );
      const rC = await client.query(`INSERT INTO public.customers (name, phone, store_id, auth_user_id) VALUES ($1,$2,$3,$4) RETURNING id`, ['Customer C', telefone(), STORE2, AUTH_C]);
      CUSTOMER_C = rC.rows[0].id;
      const rD = await client.query(`INSERT INTO public.customers (name, phone, store_id, auth_user_id) VALUES ($1,$2,$3,$4) RETURNING id`, ['Customer D', telefone(), STORE2, AUTH_D]);
      CUSTOMER_D = rD.rows[0].id;
      const itemOwn = () => [{ product_id: PROD2, nome_produto: 'Produto OWN2', quantity: 1 }];

      const endC = randomUUID();
      await client.query(`INSERT INTO public.addresses (id, store_id, customer_id, rua, numero) VALUES ($1,$2,$3,'Rua de C','1')`, [endC, STORE2, CUSTOMER_C]);
      const endOrfao = randomUUID();
      await client.query(`INSERT INTO public.addresses (id, store_id, customer_id, rua, numero) VALUES ($1,$2,NULL,'Rua Orfa','2')`, [endOrfao, STORE2]);
      const endOutraLoja = randomUUID();
      await client.query(`INSERT INTO public.addresses (id, store_id, customer_id, rua, numero) VALUES ($1,$2,NULL,'Rua Outra Loja','3')`, [endOutraLoja, OUTRA_LOJA]);

      // O8 — customer C usando o PROPRIO endereco -> permitido, endereco_id preenchido.
      await setJwt(AUTH_C, STORE2);
      const r8 = await callCreateOrder({ name: 'Customer C', phone: telefone() }, { payment_method: 'dinheiro', address: 'Rua de C, 1', endereco_id: endC }, itemOwn(), STORE2);
      const o8 = r8.rows[0].res.ok ? await getOrder(r8.rows[0].res.order_id) : null;
      check('O8 — customer usando o PROPRIO endereco -> permitido, endereco_id vinculado', r8.rows[0].res.ok && o8?.endereco_id === endC, JSON.stringify(r8.rows[0].res));

      // O9 — customer D usando endereco de C (mesma loja) -> rejeitado (endereco_id fica NULL, pedido OK).
      await setJwt(AUTH_D, STORE2);
      const r9 = await callCreateOrder({ name: 'Customer D', phone: telefone() }, { payment_method: 'dinheiro', address: 'Tentando usar endereco de outra pessoa', endereco_id: endC }, itemOwn(), STORE2);
      const o9 = r9.rows[0].res.ok ? await getOrder(r9.rows[0].res.order_id) : null;
      check('O9 — customer usando endereco de OUTRO customer da mesma loja -> rejeitado (endereco_id=NULL), pedido ainda criado', r9.rows[0].res.ok && o9?.endereco_id === null, JSON.stringify(r9.rows[0].res));

      // O10 — customer D usando endereco de OUTRA loja -> rejeitado.
      const r10 = await callCreateOrder({ name: 'Customer D', phone: telefone() }, { payment_method: 'dinheiro', address: 'Tentando usar endereco de outra loja', endereco_id: endOutraLoja }, itemOwn(), STORE2);
      const o10 = r10.rows[0].res.ok ? await getOrder(r10.rows[0].res.order_id) : null;
      check('O10 — customer usando endereco de OUTRA loja -> rejeitado (endereco_id=NULL)', r10.rows[0].res.ok && o10?.endereco_id === null, JSON.stringify(r10.rows[0].res));

      // O11 — guest usando endereco orfao da MESMA loja -> comportamento legitimo preservado.
      await setJwt(null, STORE2);
      const r11 = await callCreateOrder({ name: 'Guest', phone: telefone() }, { payment_method: 'dinheiro', address: 'Rua Orfa, 2', endereco_id: endOrfao }, itemOwn(), STORE2);
      const o11 = r11.rows[0].res.ok ? await getOrder(r11.rows[0].res.order_id) : null;
      check('O11 — guest usando endereco ORFAO da mesma loja -> permitido (modelo atual preservado)', r11.rows[0].res.ok && o11?.endereco_id === endOrfao, JSON.stringify(r11.rows[0].res));

      // O11b — guest tentando usar endereco de um customer IDENTIFICADO (variante mais severa, mesma
      // linha de codigo) -> rejeitado.
      const r11b = await callCreateOrder({ name: 'Guest2', phone: telefone() }, { payment_method: 'dinheiro', address: 'Guest tentando endereco de C', endereco_id: endC }, itemOwn(), STORE2);
      const o11b = r11b.rows[0].res.ok ? await getOrder(r11b.rows[0].res.order_id) : null;
      check('O11b — guest tentando usar endereco de customer IDENTIFICADO -> rejeitado (endereco_id=NULL)', r11b.rows[0].res.ok && o11b?.endereco_id === null, JSON.stringify(r11b.rows[0].res));

      // O12 — pedido sem endereco_id (retirada ou so texto) continua permitido, sem quebra.
      const r12 = await callCreateOrder({ name: 'Guest3', phone: telefone() }, { payment_method: 'dinheiro', address: 'Retirada na loja', retirada: true }, itemOwn(), STORE2);
      check('O12 — pedido sem endereco_id (retirada) -> preservado, cria normalmente', r12.rows[0].res.ok === true, JSON.stringify(r12.rows[0].res));
    });

    console.log(`\n${pass} passaram, ${fail} falharam.`);
  } finally {
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
