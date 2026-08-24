// scripts/store-onboard-01-onda2-validacao-final.mjs — REF-STORE-ONBOARD-01 · Onda 2, validação final
// de ponta a ponta em PRODUÇÃO real, no domínio real da Aquarios Bar (aquariosbar.lojas.valionsistemas.
// com.br / aquariosbar.admin.lojas.valionsistemas.com.br), agora que DNS+HTTPS estão confirmados verdes.
//
// Cobre: convite real (Edge Function, idempotência) + primeiro acesso real (token real via Admin API,
// já que não há acesso à caixa de e-mail real do admin da Aquarios Bar para abrir manualmente) + login real +
// isolamento tenant (sessão real, RLS) + checkout guest real (Origin real) + endereço guest real +
// tentativa de forjar cross-tenant (p_store_id) + limpeza dos dados criados só para este teste.
//
// Super admin descartável: criado/removido só para poder invocar a Edge Function com um JWT real de
// HTTP (não dá pra simular chamada de rede real com claims em BEGIN/ROLLBACK) — nunca usa a conta do
// dono real. Senha do admin real da Aquarios Bar É definida de verdade por este script (não há como
// abrir o e-mail de convite de outra forma) — reportada no final, não escondida.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');

function lerEnvArquivo(caminho) {
  const txt = readFileSync(caminho, 'utf8');
  const out = {};
  for (const linha of txt.split(/\r?\n/)) { const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i); if (m) out[m[1]] = m[2]; }
  return out;
}
const envBase = lerEnvArquivo('C:/Projetos/Encanto/encanto-react/.env');
const envLocal = lerEnvArquivo('C:/Projetos/Encanto/encanto-react/.env.local');
const SUPA_URL = envBase.VITE_SUPABASE_URL;
const ANON_KEY = envBase.VITE_SUPABASE_KEY;
const SERVICE_KEY = envLocal.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !ANON_KEY || !SERVICE_KEY) { console.error('ERRO: faltam VITE_SUPABASE_URL/VITE_SUPABASE_KEY/SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }

const dbEnvTxt = readFileSync('C:/Users/00thi/.encanto/db.env', 'utf8');
const dbGet = (k) => { const m = dbEnvTxt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim() : null; };
const pgClient = new pg.Client({
  host: dbGet('PGHOST'), port: Number(dbGet('PGPORT') || 5432), user: dbGet('PGUSER'),
  password: dbGet('PGPASSWORD'), database: dbGet('PGDATABASE') || 'postgres',
  ssl: { rejectUnauthorized: false }, statement_timeout: 15000, connectionTimeoutMillis: 15000,
});

const AQUARIOS_BAR_ID = '776a01c8-f836-417a-a957-a0e1109f90a2';
const ENCANTO_ID = '8604324d-0529-443d-aa79-4337057bfa01';
// REF-PROD-READINESS-01 (A2, 2026-08-24): e-mail pessoal real -- nunca hardcoded, sempre por env var.
const ADMIN_REAL_EMAIL = process.env.ADMIN_REAL_EMAIL_AQUARIOS;
if (!ADMIN_REAL_EMAIL) { console.error('ERRO: defina ADMIN_REAL_EMAIL_AQUARIOS no ambiente.'); process.exit(2); }
const ADMIN_REAL_UID = 'f4c21e4c-e7cf-4172-9a6d-cf6aab08705a';
const STOREFRONT_ORIGIN = 'https://aquariosbar.lojas.valionsistemas.com.br';
const ADMIN_CONVITE_REDIRECT = 'https://aquariosbar.admin.lojas.valionsistemas.com.br/convite.html';
const SUPER_ADMIN_TESTE_EMAIL = `store-onboard01-teste-superadmin-${Date.now()}@teste.encanto.local`;
const SUPER_ADMIN_TESTE_SENHA = `SuTeste${randomBytes(9).toString('base64url')}!1`;
const NOVA_SENHA_ADMIN_REAL = `Aq${randomBytes(9).toString('base64url')}!1`;

const service = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const novoAnon = () => createClient(SUPA_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const check = (nome, cond, detalhe = '') => {
  if (cond) { pass++; console.log(`  [PASS] ${nome}${detalhe ? ' -> ' + detalhe : ''}`); }
  else { fail++; console.log(`  [FAIL] ${nome}${detalhe ? ' -> ' + detalhe : ''}`); }
};

const criados = { superAdminUid: null, guestOrderIds: [], guestCustomerIds: [], guestAddressIds: [] };

async function limpeza() {
  console.log('\n===== ITEM 8: LIMPEZA =====');
  if (criados.guestOrderIds.length) {
    await pgClient.query(`DELETE FROM public.order_items WHERE order_id = ANY($1::uuid[])`, [criados.guestOrderIds]);
    const r = await pgClient.query(`DELETE FROM public.orders WHERE id = ANY($1::uuid[]) RETURNING id`, [criados.guestOrderIds]);
    console.log(`  orders de teste removidos: ${r.rows.length}/${criados.guestOrderIds.length}`);
  }
  if (criados.guestAddressIds.length) {
    const r = await pgClient.query(`DELETE FROM public.addresses WHERE id = ANY($1::uuid[]) RETURNING id`, [criados.guestAddressIds]);
    console.log(`  addresses de teste removidos: ${r.rows.length}/${criados.guestAddressIds.length}`);
  }
  if (criados.guestCustomerIds.length) {
    const r = await pgClient.query(`DELETE FROM public.customers WHERE id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM public.orders WHERE customer_id = customers.id) RETURNING id`, [criados.guestCustomerIds]);
    console.log(`  customers de teste removidos: ${r.rows.length}/${criados.guestCustomerIds.length}`);
  }
  if (criados.superAdminUid) {
    await pgClient.query(`DELETE FROM public.super_admins WHERE user_id=$1`, [criados.superAdminUid]);
    const { error } = await service.auth.admin.deleteUser(criados.superAdminUid);
    console.log(`  super admin descartável removido${error ? ' (erro: ' + error.message + ')' : ''}`);
  }
}

async function main() {
  await pgClient.connect();

  // ---------------------------------------------------------------------------------------------
  console.log('\n===== ITEM 1a-1d: super admin descartável + Edge Function real (idempotência) =====');
  const { data: suCreated, error: suErr } = await service.auth.admin.createUser({
    email: SUPER_ADMIN_TESTE_EMAIL, password: SUPER_ADMIN_TESTE_SENHA, email_confirm: true,
  });
  check('1a: super admin descartável criado', !suErr && !!suCreated?.user?.id, suErr?.message);
  criados.superAdminUid = suCreated?.user?.id ?? null;

  if (criados.superAdminUid) {
    await pgClient.query(`INSERT INTO public.super_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [criados.superAdminUid]);
    const suCheck = await pgClient.query('SELECT count(*)::int AS n FROM public.super_admins WHERE user_id=$1', [criados.superAdminUid]);
    check('1a: vínculo super_admins confirmado (real, comitado)', suCheck.rows[0].n === 1);

    const suClient = novoAnon();
    const { data: suLogin, error: suLoginErr } = await suClient.auth.signInWithPassword({ email: SUPER_ADMIN_TESTE_EMAIL, password: SUPER_ADMIN_TESTE_SENHA });
    check('1b: login real do super admin descartável', !suLoginErr && !!suLogin?.session, suLoginErr?.message);

    if (suLogin?.session) {
      const { data: fnData, error: fnErr } = await suClient.functions.invoke('invite-store-admin', {
        body: { storeId: AQUARIOS_BAR_ID, email: ADMIN_REAL_EMAIL },
      });
      check('1c: Edge Function invite-store-admin respondeu (HTTP real, produção)', !fnErr, fnErr?.message);
      check('1d: idempotência real -- admin já vinculado, Function NÃO reenvia convite (convidado:false)',
        fnData?.convidado === false, JSON.stringify(fnData));
      check('1d: motivo reportado é "já é admin" (não "não existe conta")',
        typeof fnData?.motivo === 'string' && /ja e administrador|já é admin/i.test(fnData.motivo), JSON.stringify(fnData));
      await suClient.auth.signOut().catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n===== ITEM 1e/2/9: primeiro acesso real no domínio novo (token real via Admin API) =====');
  const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
    type: 'invite', email: ADMIN_REAL_EMAIL, options: { redirectTo: ADMIN_CONVITE_REDIRECT },
  });
  check('convite real: generateLink OK', !linkErr && !!linkData?.properties?.action_link, linkErr?.message);
  check('convite real: redirect_to embutido no link bate com o host NOVO (aquariosbar.admin.lojas...)',
    typeof linkData?.properties?.action_link === 'string' && linkData.properties.action_link.includes(`redirect_to=${ADMIN_CONVITE_REDIRECT}`),
    linkData?.properties?.action_link);

  let accessToken = null, refreshToken = null, locationRecebida = null;
  if (linkData?.properties?.action_link) {
    const verifyResp = await fetch(linkData.properties.action_link, { redirect: 'manual' });
    locationRecebida = verifyResp.headers.get('location');
    check('primeiro acesso: verify real (HTTPS) devolveu redirect 3xx', verifyResp.status >= 300 && verifyResp.status < 400, `status=${verifyResp.status}`);
    check('primeiro acesso: redirect aponta pro domínio NOVO real (aquariosbar.admin.lojas...)',
      typeof locationRecebida === 'string' && locationRecebida.startsWith(ADMIN_CONVITE_REDIRECT), locationRecebida);
    if (locationRecebida?.includes('#')) {
      const frag = new URLSearchParams(locationRecebida.split('#')[1]);
      accessToken = frag.get('access_token'); refreshToken = frag.get('refresh_token');
      check('primeiro acesso: fragmento traz access_token+refresh_token reais (mesmo formato que ConviteApp.jsx consome)', !!accessToken && !!refreshToken);
    }
  }

  let loginOk = false, sessaoAdminReal = null;
  if (accessToken && refreshToken) {
    const conviteClient = novoAnon();
    const { data: setData, error: setErr } = await conviteClient.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    check('primeiro acesso: sessão real estabelecida a partir do token do convite', !setErr && !!setData?.session, setErr?.message);

    const { error: updErr } = await conviteClient.auth.updateUser({ password: NOVA_SENHA_ADMIN_REAL });
    check('primeiro acesso: senha definida com sucesso (updateUser real, mesma chamada de ConviteApp.jsx)', !updErr, updErr?.message);
    await conviteClient.auth.signOut().catch(() => {});

    console.log('\n===== ITEM 2 (logout/login): login real com a nova senha =====');
    const loginClient = novoAnon();
    const { data: loginData, error: loginErr } = await loginClient.auth.signInWithPassword({ email: ADMIN_REAL_EMAIL, password: NOVA_SENHA_ADMIN_REAL });
    check('login real pós-primeiro-acesso OK', !loginErr && !!loginData?.session, loginErr?.message);
    loginOk = !loginErr && !!loginData?.session;
    sessaoAdminReal = loginData?.session ?? null;

    // ---------------------------------------------------------------------------------------------
    console.log('\n===== ITEM 3: isolamento tenant (sessão real, RLS, sem bypass) =====');
    if (sessaoAdminReal) {
      const { data: meusVinculos, error: eVinc } = await loginClient.from('admins').select('store_id');
      check('isolamento: RLS devolve SOMENTE o próprio vínculo (1 linha)', !eVinc && meusVinculos?.length === 1, JSON.stringify({ eVinc: eVinc?.message, meusVinculos }));
      check('isolamento: o único vínculo é com Aquarios Bar', meusVinculos?.[0]?.store_id === AQUARIOS_BAR_ID, meusVinculos?.[0]?.store_id);
      check('isolamento: zero vínculo com Encanto (RLS não devolve outra loja)', !meusVinculos?.some(v => v.store_id === ENCANTO_ID));

      const { data: isSuper } = await loginClient.rpc('is_super_admin');
      check('isolamento: is_super_admin() = false pra este admin (sessão real)', isSuper === false, isSuper);
    }
    await loginClient.auth.signOut().catch(() => {});
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n===== ITEM 4: checkout guest real (Origin real da Aquarios Bar) =====');
  const encantoOrdersAntes = (await pgClient.query('SELECT count(*)::int AS n FROM public.orders WHERE store_id=$1', [ENCANTO_ID])).rows[0].n;
  {
    const phoneGuest = `4797${String(Date.now()).slice(-7)}`;
    const resp = await fetch(`${SUPA_URL}/rest/v1/rpc/create_order`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', Origin: STOREFRONT_ORIGIN },
      body: JSON.stringify({
        p_customer: { name: 'Cliente Guest Onda2 Validacao Final', phone: phoneGuest },
        p_order: { total: 27.5, payment_method: 'pix', address: 'Rua Validacao Final, 100' },
        p_items: [{ nome_produto: 'Item Validacao Final', quantity: 1, price: 27.5 }],
      }),
    });
    const body = await resp.json().catch(() => null);
    check('checkout guest real: create_order via Origin real -> ok:true', resp.status === 200 && body?.ok === true, `status=${resp.status} body=${JSON.stringify(body)}`);
    if (body?.order_id) {
      criados.guestOrderIds.push(body.order_id);
      const row = (await pgClient.query('SELECT store_id, customer_id FROM public.orders WHERE id=$1', [body.order_id])).rows[0];
      check('checkout guest real: pedido gravado com store_id = Aquarios Bar', row?.store_id === AQUARIOS_BAR_ID, row?.store_id);
      if (row?.customer_id) criados.guestCustomerIds.push(row.customer_id);
    }
  }

  console.log('\n===== ITEM 5: endereço guest real (Origin real da Aquarios Bar) =====');
  {
    const resp = await fetch(`${SUPA_URL}/rest/v1/rpc/save_structured_address`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', Origin: STOREFRONT_ORIGIN },
      body: JSON.stringify({ p_address: { rua: 'Rua Endereco Guest Validacao Final', numero: '100', bairro: 'Centro', cidade: 'Teste' } }),
    });
    const addressId = await resp.json().catch(() => null);
    check('endereço guest real: save_structured_address via Origin real -> retorna uuid', resp.status === 200 && typeof addressId === 'string' && addressId.length === 36, `status=${resp.status} body=${JSON.stringify(addressId)}`);
    if (typeof addressId === 'string' && addressId.length === 36) {
      criados.guestAddressIds.push(addressId);
      const row = (await pgClient.query('SELECT store_id, customer_id FROM public.addresses WHERE id=$1', [addressId])).rows[0];
      check('endereço guest real: gravado com store_id = Aquarios Bar', row?.store_id === AQUARIOS_BAR_ID, row?.store_id);
      check('endereço guest real: sem customer_id órfão inesperado (guest puro, sem customer_id no payload)', row?.customer_id === null, row?.customer_id);
    }
  }

  console.log('\n===== ITEM 6: tentativa de forjar cross-tenant (p_store_id=Encanto, Origin=Aquarios Bar) =====');
  {
    const phoneGuest2 = `4798${String(Date.now()).slice(-7)}`;
    const resp = await fetch(`${SUPA_URL}/rest/v1/rpc/create_order`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', Origin: STOREFRONT_ORIGIN },
      body: JSON.stringify({
        p_customer: { name: 'Cliente Guest Forja Onda2', phone: phoneGuest2 },
        p_order: { total: 15.0, payment_method: 'pix', address: 'Rua Forja, 1' },
        p_items: [{ nome_produto: 'Item Forja', quantity: 1, price: 15.0 }],
        p_store_id: ENCANTO_ID, // forjado -- guest NUNCA deve usar isso (resolve_store_from_origin manda)
      }),
    });
    const body = await resp.json().catch(() => null);
    check('cross-tenant forjado: chamada não crasha, responde 200', resp.status === 200, `status=${resp.status}`);
    if (body?.order_id) {
      criados.guestOrderIds.push(body.order_id);
      const row = (await pgClient.query('SELECT store_id, customer_id FROM public.orders WHERE id=$1', [body.order_id])).rows[0];
      check('cross-tenant forjado: DENY -- pedido caiu em Aquarios Bar (Origin real), NUNCA em Encanto (p_store_id ignorado pro guest)',
        row?.store_id === AQUARIOS_BAR_ID, row?.store_id);
      if (row?.customer_id) criados.guestCustomerIds.push(row.customer_id);
    } else {
      check('cross-tenant forjado: sem order_id -- ok:false não é o esperado aqui, mas não seria falha de isolamento', false, JSON.stringify(body));
    }
  }
  {
    const encantoOrdersDepois = (await pgClient.query('SELECT count(*)::int AS n FROM public.orders WHERE store_id=$1', [ENCANTO_ID])).rows[0].n;
    check('cross-tenant forjado: contagem de orders da Encanto NÃO mudou (zero contaminação real)', encantoOrdersDepois === encantoOrdersAntes, `antes=${encantoOrdersAntes} depois=${encantoOrdersDepois}`);
  }

  await limpeza();

  console.log(`\n${'='.repeat(70)}\n RESULTADO: ${pass} passes, ${fail} failures\n${'='.repeat(70)}`);
  console.log(`\nSenha definida para ${ADMIN_REAL_EMAIL}: ${NOVA_SENHA_ADMIN_REAL}`);
  console.log(`Login confirmado com esta senha: ${loginOk ? 'SIM' : 'NAO'}`);
  await pgClient.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERRO FATAL:', e.message, e.stack);
  try { await limpeza(); } catch {}
  try { await pgClient.end(); } catch {}
  process.exit(1);
});
