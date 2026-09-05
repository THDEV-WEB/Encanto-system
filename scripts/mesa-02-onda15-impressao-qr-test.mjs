// REF-MESA-02 · Onda 15 (impressao do QR) -- E2E dedicado.
// admin_obter_url_storefront(): resolve a URL publica da propria loja no servidor (Admin nao tem
// acesso a stores.slug/dominio hoje) -- usa stores.dominio quando setado, senao o padrao novo
// (<slug>.lojas.valionsistemas.com.br), NUNCA o padrao legado. Confirma: loja com dominio
// personalizado usa ele; loja sem dominio usa o padrao novo por slug; outsider sem permissao;
// cross-tenant (p_store_id de outra loja nao vaza a URL dela); loja inexistente. Tambem confirma
// que admin_listar_mesas continua devolvendo qr_token (regressao da Onda 5) -- e' o valor que a UI
// usa junto com essa URL pra montar o link do QR. SAVEPOINT por caso.
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
async function setRole(role, sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function resetRole() { await client.query(`RESET ROLE`); await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`); }

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 15 (impressao do QR) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID, OUTRO_UID] = authUsers.map(x => x.id);

    const STORE_COM_DOMINIO = randomUUID();
    const STORE_SEM_DOMINIO = randomUUID();
    const SLUG_COM = `mesa02-onda15-com-${STORE_COM_DOMINIO}`;
    const SLUG_SEM = `mesa02-onda15-sem-${STORE_SEM_DOMINIO}`;
    await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ($1,$2,'Loja Com Dominio','pedidos.restaurante-x.com.br','ativo')`, [STORE_COM_DOMINIO, SLUG_COM]);
    await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ($1,$2,'Loja Sem Dominio',NULL,'ativo')`, [STORE_SEM_DOMINIO, SLUG_SEM]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2),($1,$3)`, [ADMIN_UID, STORE_COM_DOMINIO, STORE_SEM_DOMINIO]);
    await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'90')`, [STORE_COM_DOMINIO]);

    // B1: loja com dominio personalizado -> usa esse dominio, nunca o padrao por slug.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_COM_DOMINIO);
      const res = await client.query(`SELECT public.admin_obter_url_storefront($1::uuid) AS res`, [STORE_COM_DOMINIO]);
      const r = res.rows[0].res;
      check('B1 loja com dominio personalizado -> URL usa o dominio real', r.ok === true && r.url === 'https://pedidos.restaurante-x.com.br', JSON.stringify(r));
      await resetRole();
    });

    // B2: loja sem dominio -> padrao NOVO por slug (nunca o padrao legado).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_SEM_DOMINIO);
      const res = await client.query(`SELECT public.admin_obter_url_storefront($1::uuid) AS res`, [STORE_SEM_DOMINIO]);
      const r = res.rows[0].res;
      check('B2 loja sem dominio -> padrao novo por slug (nao o legado)', r.ok === true && r.url === `https://${SLUG_SEM}.lojas.valionsistemas.com.br`, JSON.stringify(r));
      await resetRole();
    });

    // B3: outsider sem is_admin_of -> sem permissao.
    await withSavepoint(async () => {
      const OUTSIDER = randomUUID();
      await setRole('authenticated', OUTSIDER, STORE_COM_DOMINIO);
      const res = await client.query(`SELECT public.admin_obter_url_storefront($1::uuid) AS res`, [STORE_COM_DOMINIO]);
      const r = res.rows[0].res;
      check('B3 outsider sem is_admin_of -> sem permissao', r.ok === false && r.error === 'sem permissao', JSON.stringify(r));
      await resetRole();
    });

    // B4: cross-tenant -- admin de uma loja pedindo a URL de OUTRA loja onde nao e admin.
    await withSavepoint(async () => {
      const STORE_C = randomUUID();
      await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ($1,$2,'Loja C',NULL,'ativo')`, [STORE_C, `mesa02-onda15-c-${STORE_C}`]);
      await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [OUTRO_UID, STORE_C]);
      await setRole('authenticated', ADMIN_UID, STORE_COM_DOMINIO);
      const res = await client.query(`SELECT public.admin_obter_url_storefront($1::uuid) AS res`, [STORE_C]);
      const r = res.rows[0].res;
      check('B4 cross-tenant: admin de uma loja nao ve URL de outra onde nao e admin', r.ok === false && r.error === 'sem permissao', JSON.stringify(r));
      await resetRole();
    });

    // B5: regressao -- admin_listar_mesas continua devolvendo qr_token (Onda 5), a UI usa os 2
    // valores (URL da loja + qr_token da mesa) juntos pra montar o link do QR. RETURNS TABLE ->
    // SELECT * (colunas reais), nunca envolver num unico AS res (viraria composite-string).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_COM_DOMINIO);
      const res = await client.query(`SELECT * FROM public.admin_listar_mesas($1::uuid)`, [STORE_COM_DOMINIO]);
      check('B5 admin_listar_mesas continua devolvendo qr_token por mesa (regressao Onda 5)', res.rows.length === 1 && typeof res.rows[0].qr_token === 'string' && res.rows[0].qr_token.length > 0, JSON.stringify(res.rows));
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
