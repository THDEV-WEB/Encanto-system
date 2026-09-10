// REF-PAGAMENTO-01 · Onda 7 (fix real) -- E2E dedicado.
// BUG REAL: DataService.savePedido chamava create_order via `db` (sessao do ADMIN, nunca a do
// cliente) em vez de `dbCliente` -- qualquer cliente LOGADO que pedisse entrega perdia o
// endereco_id (checagem de posse falhava com auth.uid() sempre nulo) e a taxa de entrega saia R$0.
// Este teste reproduz o fluxo REAL via supabase-js (login de verdade, mesma lib que o app usa) contra
// o projeto E2E: 1) login como CLIENTE_FIXTURE, 2) salva endereco via save_structured_address (mesma
// RPC que addressRepository.salvar chama), 3) cria pedido via create_order -- confirmando que,
// com uma sessao de cliente REAL anexada, endereco_id/delivery_fee saem corretos (prova que o defeito
// era mesmo "sessao nunca anexada", nao um bug de RPC/SQL -- esse lado ja foi validado nas ondas
// anteriores da REF, aqui so' confirma o client-side).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('C:/Projetos/Encanto/encanto-react/package.json');
const { createClient } = require('@supabase/supabase-js');

const ENV_PATH = 'C:/Projetos/Encanto/encanto-react/.env.e2e';
function loadEnv() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const map = {};
  for (const line of txt.split(/\r?\n/)) { const i = line.indexOf('='); if (i === -1) continue; map[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
  return map;
}
const env = loadEnv();
const SUPA_URL = env.VITE_SUPABASE_URL;
const SUPA_KEY = env.VITE_SUPABASE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('ERRO: .env.e2e sem VITE_SUPABASE_URL/VITE_SUPABASE_KEY'); process.exit(2); }

const CLIENTE_FIXTURE = { email: 'e2e-cliente@teste.encanto.local', senha: 'e2e-fixture-nao-usar-em-prod-9f2b' };
const STORE_ORIGIN = 'http://encanto.localhost:5199'; // resolve_store_from_origin() reconhece {slug}.localhost

let pass = 0, fail = 0;
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }

async function main() {
  console.log('==========================================================================');
  console.log(' REF-PAGAMENTO-01 · Onda 7 (fix sessao checkout) · E2E via supabase-js real');
  console.log('==========================================================================\n');

  // Simula EXATAMENTE dbCliente (mesma config de lib/dbCliente.js, storageKey irrelevante em Node).
  const dbCliente = createClient(SUPA_URL, SUPA_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Origin: STORE_ORIGIN } },
  });

  const { data: loginData, error: loginErr } = await dbCliente.auth.signInWithPassword({
    email: CLIENTE_FIXTURE.email, password: CLIENTE_FIXTURE.senha,
  });
  check('login como CLIENTE_FIXTURE via dbCliente real', !loginErr && !!loginData?.session?.access_token, loginErr?.message);
  if (loginErr) { console.log(`\nTOTAL: ${pass} passaram, ${fail} falharam`); process.exit(1); }

  // Endereco de teste com coordenadas plausiveis perto da loja "encanto" (usa lat/lng conhecidas do
  // seed E2E -- se a loja de teste nao tiver lojaLat/lojaLng configurados, delivery_fee sempre sera 0
  // por design (fallback "sem_coordenadas"), o que invalidaria o teste -- checamos isso explicitamente.
  const { data: cfg } = await dbCliente.rpc('get_delivery_fee_config');
  const { data: company } = await dbCliente.rpc('get_company_info');
  const semConfig = !cfg?.ativo || !company?.lojaLat || !company?.lojaLng;
  if (semConfig) {
    console.log('AVISO: loja E2E sem lojaLat/lojaLng ou taxa de entrega desativada -- pulando teste (config ausente, nao e falha do fix).');
    console.log(`\nTOTAL: ${pass} passaram, ${fail} falharam`);
    process.exit(0);
  }

  // CLIENTE_FIXTURE tem 1 linha de customers por loja (fixture multi-tenant) -- a do 'encanto' e' esta
  // (mesmo id documentado no fixture, telefone 47999990000). O CLIENTE (CheckoutPage.jsx) sempre manda
  // o customer_id explicito (useAuth().customer.id) -- save_structured_address so' aceita se bater com
  // auth.uid(), nunca infere sozinho.
  const CUSTOMER_ID_ENCANTO = '969433f9-3bbd-408a-9628-4582c255aa20';
  const enderecoPayload = {
    p_address: {
      customer_id: CUSTOMER_ID_ENCANTO,
      rua: 'Rua Teste Onda7 Fix', numero: '123', bairro: 'Centro', cidade: 'Teste',
      latitude: Number(company.lojaLat) + 0.01, longitude: Number(company.lojaLng) + 0.01,
      formatted_address: 'Rua Teste Onda7 Fix, 123', provider: 'teste', confidence: 'exact',
      client_token: crypto.randomUUID(),
    },
  };
  const { data: enderecoId, error: addrErr } = await dbCliente.rpc('save_structured_address', enderecoPayload);
  check('save_structured_address (via dbCliente, sessao real) devolve id', !addrErr && !!enderecoId, addrErr?.message);

  // (RLS de addresses nao deixa o proprio cliente reler customer_id via SELECT direto -- a prova real
  // de que o vinculo ficou certo vem a seguir, indiretamente: se customer_id tivesse ficado nulo,
  // create_order tambem teria nulado endereco_id, e o proximo check falharia.)

  const { data: orderResult, error: orderErr } = await dbCliente.rpc('create_order', {
    p_customer: { name: 'Cliente E2E', phone: '47999990000' },
    p_order: { total: 25.0, payment_method: 'dinheiro', address: 'Rua Teste Onda7 Fix, 123', endereco_id: enderecoId },
    p_items: [{ nome_produto: 'Marmita P', quantity: 1, price: 15.99, product_id: '10000000-0000-4000-8000-000000000001' }],
  });
  check('create_order (via dbCliente, MESMO client que savePedido usa agora) sem erro de rede', !orderErr, orderErr?.message);
  check('create_order ok:true', !!orderResult?.ok, JSON.stringify(orderResult));

  if (orderResult?.ok) {
    const { data: orderRow } = await dbCliente
      .from('orders').select('endereco_id, delivery_fee').eq('id', orderResult.order_id).maybeSingle();
    check('orders.endereco_id foi preenchido (NAO nulo) -- prova que auth.uid() chegou certo', orderRow?.endereco_id === enderecoId, JSON.stringify(orderRow));
    check('orders.delivery_fee > 0 (taxa calculada, nao zerada por engano)', Number(orderRow?.delivery_fee) > 0, JSON.stringify(orderRow));
    // limpeza -- apaga o pedido/endereco de teste (dados reais do projeto E2E, nao deixa lixo)
    await dbCliente.from('orders').delete().eq('id', orderResult.order_id);
  }
  await dbCliente.from('addresses').delete().eq('id', enderecoId);
  await dbCliente.auth.signOut();

  console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
