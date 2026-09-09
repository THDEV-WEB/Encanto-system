// scripts/loadtest-e2e.mjs — TESTE DE CARGA do fluxo de pedido (VALION/Encanto).
// =============================================================================
// Simula N "clientes" fazendo o fluxo real: (opcional) navega o catalogo -> cria
// pedido via a MESMA RPC create_order que o checkout usa. Mede vazao e latencia.
//
//  ⚠️  RODA SO CONTRA O PROJETO SUPABASE DEDICADO A E2E — NUNCA PRODUCAO.
//      Trava fisica: recusa rodar se a URL for o projeto de producao (ver PROD_REF).
//      Requer --yes pra realmente disparar (sem --yes = so mostra o plano).
//
// Uso (Windows/PowerShell ou bash):
//   node --env-file=.env.e2e scripts/loadtest-e2e.mjs                      # plano (dry-run)
//   node --env-file=.env.e2e scripts/loadtest-e2e.mjs --orders=100 --concurrency=20 --browse --yes
//
// Flags:
//   --orders=N        total de pedidos a criar            (default 10)
//   --concurrency=N   quantos disparam ao mesmo tempo      (default 10)
//   --items=N         itens por pedido (1..N aleatorio)    (default 3)
//   --browse          simula leitura do catalogo antes de cada pedido (carga de navegacao)
//   --yes             confirma o disparo (sem isso, so imprime o plano)
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// ── ref do projeto de PRODUCAO (trava de seguranca — NUNCA rodar carga aqui) ──
const PROD_REF = 'hvbcdxsagkjtfjwvnslo';

// ── args ──
const arg = (k, d) => { const m = process.argv.find(a => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : d; };
const has = (k) => process.argv.includes(`--${k}`);
const ORDERS      = parseInt(arg('orders', '10'), 10);
const CONCURRENCY = parseInt(arg('concurrency', '10'), 10);
const MAX_ITEMS   = parseInt(arg('items', '3'), 10);
const DURATION    = parseInt(arg('duration', '0'), 10);   // segundos; >0 = carga SUSTENTADA (ignora --orders)
const MODE        = arg('mode', 'order');                 // 'order' (create_order) | 'browse' (leitura de catalogo)
const BROWSE      = has('browse');
const CONFIRM     = has('yes');

const SUPA_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const KEY = process.env.VITE_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';

// ── guardas de seguranca ──
if (!SUPA_URL || !KEY) {
  console.error('ERRO: faltam VITE_SUPABASE_URL / VITE_SUPABASE_KEY. Rode com:  node --env-file=.env.e2e scripts/loadtest-e2e.mjs');
  process.exit(1);
}
if (SUPA_URL.includes(PROD_REF)) {
  console.error(`\n🛑 ABORTADO: a URL aponta para o projeto de PRODUCAO (${PROD_REF}).`);
  console.error('   Teste de carga NUNCA roda em producao. Aponte para o projeto de E2E (.env.e2e).\n');
  process.exit(2);
}
const host = (() => { try { return new URL(SUPA_URL).host; } catch { return SUPA_URL; } })();

const db = createClient(SUPA_URL, KEY, { auth: { persistSession: false } });

// ── percentis ──
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const telefoneFake = () => '47' + String(9 + Math.floor(Math.random() * 1)) + String(Math.floor(10000000 + Math.random() * 89999999));
const precoDe = (p) => Number(p.preco ?? p.price ?? p.valor ?? p.preco_base ?? 10) || 10;

async function main() {
  console.log('\n=== TESTE DE CARGA — fluxo de pedido (create_order) ===');
  console.log(`Alvo Supabase : ${host}   ${SUPA_URL.includes(PROD_REF) ? '(PRODUCAO ❌)' : '(nao-producao ✅)'}`);
  console.log(`Modo          : ${MODE === 'browse' ? 'NAVEGACAO (leitura de catalogo)' : 'PEDIDO (create_order)'}`);
  if (DURATION > 0) console.log(`Duracao       : ${DURATION}s (carga SUSTENTADA, no maximo de vazao)`);
  else              console.log(`Total         : ${ORDERS} ${MODE === 'browse' ? 'leituras' : 'pedidos'}`);
  console.log(`Concorrencia  : ${CONCURRENCY} ao mesmo tempo`);
  if (MODE !== 'browse') console.log(`Itens/pedido  : 1..${MAX_ITEMS} (aleatorio)`);
  if (MODE !== 'browse') console.log(`Navegar antes : ${BROWSE ? 'sim (le catalogo)' : 'nao'}`);

  // descobre produtos reais do catalogo semeado (pra o pedido ser valido)
  const { data: prods, error: perr } = await db.from('products').select('*').eq('disponivel', true).limit(50);
  if (perr) { console.error('ERRO lendo catalogo:', perr.message); process.exit(3); }
  if (!prods?.length) { console.error('ERRO: catalogo vazio no projeto de E2E. Rode antes:  node scripts/e2e-seed.mjs'); process.exit(3); }
  console.log(`Catalogo      : ${prods.length} produtos disponiveis encontrados`);

  if (!CONFIRM) {
    console.log('\n(DRY-RUN) Plano acima. Para DISPARAR de verdade, adicione  --yes\n');
    return;
  }

  // monta um pedido valido a partir de produtos reais
  const montarPedido = () => {
    const n = 1 + Math.floor(Math.random() * MAX_ITEMS);
    const items = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const p = prods[Math.floor(Math.random() * prods.length)];
      const qty = 1 + Math.floor(Math.random() * 3);
      const price = precoDe(p);
      total += price * qty;
      items.push({ product_id: p.id, nome_produto: p.nome ?? p.name ?? 'Produto', quantity: qty, price, preco_unitario: price, adicionais: [], observacoes: null });
    }
    return {
      p_customer: { name: 'Carga Teste', phone: telefoneFake() },
      p_order: { total, status: 'recebido', payment_method: 'dinheiro', address: 'TESTE DE CARGA', observacoes: 'loadtest', endereco_id: null, delivery_fee: 0, maquininha_fee: 0 },
      p_items: items,
      p_request_id: randomUUID(),
    };
  };

  const lat = [];
  let ok = 0, fail = 0;
  const erros = {};
  const janelas = [];                 // vazao por janela de 10s (detecta throttle no tempo)
  const t0 = Date.now();
  const deadline = DURATION > 0 ? t0 + DURATION * 1000 : 0;
  let restantes = ORDERS;             // usado so no modo por-total
  const label = MODE === 'browse' ? 'leituras' : 'pedidos';

  async function tarefa() {
    const s = Date.now();
    if (MODE === 'browse') {
      const { error } = await db.from('products').select('*').eq('disponivel', true).limit(100); // storefront: catalogo cheio
      lat.push(Date.now() - s);
      if (error) { fail++; const k = (error.message || 'erro').slice(0, 80); erros[k] = (erros[k] || 0) + 1; } else ok++;
    } else {
      if (BROWSE) { await db.from('products').select('id,nome').eq('disponivel', true).limit(50); }
      const { data, error } = await db.rpc('create_order', montarPedido());
      lat.push(Date.now() - s);
      const falhou = error || (data && data.ok === false);
      if (falhou) { fail++; const k = (error?.message || data?.error || 'desconhecido').slice(0, 80); erros[k] = (erros[k] || 0) + 1; }
      else ok++;
    }
  }

  async function worker() {
    while (true) {
      if (DURATION > 0) { if (Date.now() >= deadline) break; }
      else { if (restantes <= 0) break; restantes--; }
      await tarefa();
      if ((ok + fail) % 50 === 0) {
        const s = ((Date.now() - t0) / 1000).toFixed(0);
        process.stdout.write(`  ...${ok + fail} ${label} em ${s}s (${((ok + fail) / ((Date.now() - t0) / 1000)).toFixed(0)}/s)      \r`);
      }
    }
  }

  // amostra a vazao a cada 10s (so faz sentido em carga sustentada)
  let ultimo = 0;
  const timer = DURATION > 0 ? setInterval(() => { const total = ok + fail; janelas.push(total - ultimo); ultimo = total; }, 10000) : null;

  console.log('\nDisparando...\n');
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (timer) clearInterval(timer);
  const dur = (Date.now() - t0) / 1000;

  console.log('\n\n=== RESULTADO ===');
  console.log(`Duracao total : ${dur.toFixed(1)}s`);
  console.log(`${label.padEnd(13)} OK : ${ok}`);
  console.log(`Falhas        : ${fail}`);
  console.log(`Vazao media   : ${(ok / dur).toFixed(1)} ${label}/s   (~${Math.round(ok / dur * 60)} ${label}/min)`);
  console.log(`Latencia p50  : ${pct(lat, 50)} ms`);
  console.log(`Latencia p95  : ${pct(lat, 95)} ms`);
  console.log(`Latencia p99  : ${pct(lat, 99)} ms`);
  console.log(`Latencia max  : ${Math.max(...lat)} ms`);
  if (janelas.length > 1) console.log(`Vazao/10s     : [${janelas.join(', ')}]  ${janelas[janelas.length - 1] < janelas[0] * 0.7 ? '⚠️ caiu no tempo (throttle?)' : '✅ estavel no tempo'}`);
  if (fail) { console.log('\nErros:'); for (const [k, v] of Object.entries(erros)) console.log(`  ${v}x  ${k}`); }
  console.log('');
}

main().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
