/* tests/loyalty.guard.mjs — REF-LOYALTY-01. Roda: node tests/loyalty.guard.mjs (npm run test:loyalty-guard)
   GUARDA ESTRUTURAL da "fonte unica = Supabase" da fidelidade. Falha se alguem reintroduzir o contador
   por-navegador (localStorage como verdade) ou remover o acrescimo/reversao no backend. Analise estatica
   pura (sem banco/rede). Invariantes:
     (1) O servico de fidelidade fala com o Supabase (get_my_loyalty/redeem_reward/admin_*).
     (2) O localStorage e SO CACHE: STORAGE_KEYS nao tem chaves de contador (loyalty_count/required/
         discount/enabled/reward_*); so LOYALTY_CACHE. Nenhum componente conta selo no navegador.
     (3) CheckoutPage NAO incrementa fidelidade no localStorage (o selo e concedido no backend).
     (4) AdminFidelidade NAO usa localStorage p/ fidelidade (delega ao servico/RPCs).
     (5) A migracao concede o selo DENTRO de create_order (loyalty_grant) e reverte no cancelamento
         (trigger loyalty_void_on_cancel) — trava o acrescimo/idempotencia/antifraude no backend. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ROOT = fileURLToPath(new URL('../', import.meta.url));
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const files = readdirSync(SRC, { recursive: true }).map((f) => String(f).replace(/\\/g, '/')).filter((f) => /\.(js|jsx)$/.test(f)).sort();
const read = (f) => readFileSync(SRC + f, 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/* (1) o servico e a fonte oficial: fala com os RPCs do Supabase */
check('(1) loyaltyService usa os RPCs do Supabase (get_my_loyalty/redeem_reward/admin_*)', () => {
  const code = strip(read('services/loyalty/loyaltyService.js'));
  for (const rpc of ['get_my_loyalty', 'redeem_reward', 'admin_find_loyalty', 'admin_adjust_loyalty', 'set_loyalty_config']) {
    assert.ok(code.includes(rpc), `loyaltyService deve chamar o RPC ${rpc}`);
  }
});

/* (2) localStorage = so cache: sem chaves de contador */
check('(2) STORAGE_KEYS sem contadores de fidelidade (so LOYALTY_CACHE)', () => {
  const code = strip(read('constants/storage.js'));
  assert.ok(/LOYALTY_CACHE\s*:/.test(code), 'deve existir LOYALTY_CACHE (cache)');
  for (const dead of ['LOYALTY_COUNT', 'LOYALTY_REQUIRED', 'LOYALTY_DISCOUNT', 'LOYALTY_ENABLED', 'LOYALTY_REWARD_AVAILABLE', 'LOYALTY_REWARD_USED']) {
    assert.ok(!new RegExp(dead + '\\s*:').test(code), `chave de contador ${dead} nao deve voltar a STORAGE_KEYS`);
  }
});

check('(2b) nenhum arquivo escreve contador de fidelidade no localStorage (encanto_loyalty_count/etc)', () => {
  const viol = files.filter((f) => /localStorage\.setItem[^\n]*loyalty_(count|required|discount|enabled|reward)/i.test(strip(read(f))));
  assert.deepStrictEqual(viol, [], `arquivos escrevendo contador de fidelidade: ${JSON.stringify(viol)}`);
});

/* (3) CheckoutPage nao conta selo no navegador (LOYALTY_EVENT, o aviso de re-sync, e permitido) */
check('(3) CheckoutPage NAO incrementa fidelidade no localStorage (selo e do backend)', () => {
  const code = strip(read('components/checkout/CheckoutPage.jsx'));
  assert.ok(!/LOYALTY_(COUNT|REQUIRED|DISCOUNT|ENABLED|REWARD)/.test(code), 'CheckoutPage nao deve usar chaves de contador de fidelidade');
  assert.ok(!/localStorage[^\n]*loyalty/i.test(code), 'CheckoutPage nao deve escrever fidelidade no localStorage');
});

/* (4) AdminFidelidade delega ao servico, sem localStorage */
check('(4) AdminFidelidade usa o servico (RPCs) e NAO localStorage de fidelidade', () => {
  const code = strip(read('components/admin/AdminFidelidade.jsx'));
  assert.ok(/services\/loyalty/.test(code), 'AdminFidelidade deve importar o servico de fidelidade');
  assert.ok(!/localStorage/.test(code), 'AdminFidelidade NAO deve tocar localStorage');
});

/* (5) migracao: selo concedido dentro de create_order + revertido no cancelamento */
check('(5) migracao concede no create_order (loyalty_grant) e reverte no cancelamento (trigger)', () => {
  const sql = readFileSync(ROOT + 'migrations/REF-LOYALTY-01-loyalty.sql', 'utf8');
  assert.ok(/create or replace function public\.create_order/i.test(sql), 'migracao deve reabrir create_order');
  assert.ok(/perform public\.loyalty_grant/i.test(sql), 'create_order deve chamar loyalty_grant (selo no backend, mesma tx)');
  assert.ok(/create trigger trg_loyalty_void_on_cancel/i.test(sql), 'deve criar o trigger de reversao no cancelamento');
  assert.ok(/loyalty_events_earned_order_uq/i.test(sql), 'deve existir o indice unico parcial (idempotencia por pedido)');
  assert.ok(/revoke all on function public\.loyalty_grant/i.test(sql), 'loyalty_grant nao pode ser chamavel pelo cliente (revoke)');
});

/* (6) hardening do vinculo (REF-LOYALTY-01a): link_customer_to_auth nao reivindica automaticamente um
   convidado com historico (fecha o roubo de fidelidade/historico) + caminho manual admin_link. */
check('(6) link-hardening: recusa reivindicacao de convidado com historico + admin_link', () => {
  const sql = readFileSync(ROOT + 'migrations/REF-LOYALTY-01a-link-hardening.sql', 'utf8');
  assert.ok(/create or replace function public\.link_customer_to_auth/i.test(sql), 'deve reabrir link_customer_to_auth');
  assert.ok(/requer_verificacao/i.test(sql), 'deve retornar status requer_verificacao p/ convidado com historico');
  assert.ok(/v_owner is null and \(/i.test(sql), 'a guarda deve mirar apenas cadastros-convidado (auth_user_id NULL)');
  assert.ok(/admin_link_customer_to_auth/i.test(sql), 'deve prover o caminho manual do admin');
  const jsx = readFileSync(SRC + 'components/menu/CompletarCadastro.jsx', 'utf8');
  assert.ok(/requer_verificacao/.test(jsx), 'CompletarCadastro deve tratar o status requer_verificacao');
});

console.log(fail === 0
  ? '\nOK loyalty.guard — fonte unica preservada (Supabase; localStorage so cache; selo no backend)'
  : `\nFALHA loyalty.guard — ${fail} invariante(s)`);
process.exit(fail ? 1 : 0);
