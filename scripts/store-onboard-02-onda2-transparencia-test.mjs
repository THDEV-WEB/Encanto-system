// scripts/store-onboard-02-onda2-transparencia-test.mjs — REF-STORE-ONBOARD-02 · Onda 2.
// Prova, via chamada de rede real (chave anon -- exatamente o que o navegador de um cliente usa) contra
// get_business_hours_schedule/get_delivery_fee_config, que o campo novo `configuracao_propria` reflete
// corretamente o estado real da loja em todos os cenarios A-F pedidos, mais isolamento entre 2 lojas.
// 100% dados descartaveis, 100% projeto E2E (.env.e2e). NAO usa nenhuma loja real.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { montarResumoFinanceiro } from '../src/services/delivery/deliveryFeeRules.js';

function lerEnvE2e() {
  const txt = readFileSync('.env.e2e', 'utf8');
  const out = {};
  for (const linha of txt.split(/\r?\n/)) { const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i); if (m) out[m[1]] = m[2]; }
  return out;
}
const env = lerEnvE2e();
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(env.VITE_SUPABASE_URL, env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let passes = 0, failures = 0;
function check(desc, ok, detail) {
  if (ok) { passes++; console.log(`  [PASS] ${desc}`); }
  else { failures++; console.log(`  [FAIL] ${desc} -> ${detail ?? ''}`); }
}

console.log('==========================================================================');
console.log(' REF-STORE-ONBOARD-02 (Onda 2) · transparencia de configuracao padrao -- RPCs publicas (E2E)');
console.log('==========================================================================\n');

const TS = Date.now();
const SLUG_A = `onda2-transp-a-${TS}`;
const SLUG_B = `onda2-transp-b-${TS}`;
let storeA = null, storeB = null;

async function lerViaAnon(storeId) {
  const [h, d] = await Promise.all([
    anon.rpc('get_business_hours_schedule', { p_store_id: storeId }),
    anon.rpc('get_delivery_fee_config', { p_store_id: storeId }),
  ]);
  if (h.error) throw new Error(`get_business_hours_schedule: ${h.error.message}`);
  if (d.error) throw new Error(`get_delivery_fee_config: ${d.error.message}`);
  return { horario: h.data, entrega: d.data };
}

try {
  const { data: a, error: errA } = await admin.from('stores').insert({ slug: SLUG_A, nome: 'Onda2 Transparencia A', status: 'ativo' }).select('id').single();
  if (errA) throw new Error(`setup loja A: ${errA.message}`);
  storeA = a.id;
  const { data: b, error: errB } = await admin.from('stores').insert({ slug: SLUG_B, nome: 'Onda2 Transparencia B', status: 'ativo' }).select('id').single();
  if (errB) throw new Error(`setup loja B: ${errB.message}`);
  storeB = b.id;

  console.log('--- Cenário D: loja A recém-criada, sem horário nem entrega próprios ---');
  let r = await lerViaAnon(storeA);
  check('D: horário configuracao_propria = false', r.horario.configuracao_propria === false, JSON.stringify(r.horario.configuracao_propria));
  check('D: entrega configuracao_propria = false', r.entrega.configuracao_propria === false, JSON.stringify(r.entrega.configuracao_propria));

  console.log('\n--- Configura horário E entrega próprios (cenário A: tudo configurado) ---');
  await admin.from('store_settings').upsert([
    { store_id: storeA, chave: 'business_hours_schedule', valor: JSON.stringify({ version: 1, timezone: 'America/Sao_Paulo', schedule: {}, exceptions: {} }) },
    { store_id: storeA, chave: 'delivery_fee_config', valor: JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: true, valor: 3 }, faixas: [{ de: 0, ate: 10, valor: 7 }] }) },
    { store_id: storeA, chave: 'company_info', valor: JSON.stringify({ lojaLat: -26.9, lojaLng: -48.6 }) },
  ], { onConflict: 'store_id,chave' });
  r = await lerViaAnon(storeA);
  check('A: horário configuracao_propria = true', r.horario.configuracao_propria === true);
  check('A: entrega configuracao_propria = true', r.entrega.configuracao_propria === true);
  check('A: tabela própria da loja A tem faixa de R$7 (não a padrão R$10)', r.entrega.faixas?.[0]?.valor === 7, JSON.stringify(r.entrega.faixas));

  console.log('\n--- Cenário B: remove só o horário próprio ---');
  await admin.from('store_settings').delete().eq('store_id', storeA).eq('chave', 'business_hours_schedule');
  r = await lerViaAnon(storeA);
  check('B: horário configuracao_propria = false', r.horario.configuracao_propria === false);
  check('B: entrega continua configuracao_propria = true (independentes)', r.entrega.configuracao_propria === true);

  console.log('\n--- Cenário C: restaura horário, remove só a entrega própria ---');
  await admin.from('store_settings').upsert(
    { store_id: storeA, chave: 'business_hours_schedule', valor: JSON.stringify({ version: 1, timezone: 'America/Sao_Paulo', schedule: {}, exceptions: {} }) },
    { onConflict: 'store_id,chave' },
  );
  await admin.from('store_settings').delete().eq('store_id', storeA).eq('chave', 'delivery_fee_config');
  r = await lerViaAnon(storeA);
  check('C: horário voltou a configuracao_propria = true', r.horario.configuracao_propria === true);
  check('C: entrega configuracao_propria = false', r.entrega.configuracao_propria === false);

  console.log('\n--- Cenário E: coordenadas presentes + tabela própria ausente -> montarResumoFinanceiro real ---');
  // company_info.lojaLat/lojaLng já setados acima e nunca removidos -- coordLoja resolve, então o
  // checkout NÃO cai em 'sem_coordenadas' (distância calculável); ele CALCULA e cobra usando a tabela
  // FALLBACK (r.entrega, já confirmado configuracao_propria=false acima). Prova ponta a ponta com a
  // MESMA função pura que o Checkout real usa (deliveryFeeRules.js), nada reimplementado aqui.
  const resumoE = montarResumoFinanceiro({ subtotal: 50, retirada: false, distanciaKm: 3, config: r.entrega, paymentMethod: 'pix' });
  check('E: status = "ok" (nunca confundido com sem_coordenadas/fora_de_alcance)', resumoE.status === 'ok', resumoE.status);
  check('E: configuracaoPropria = false (tabela é a padrão, não a da loja)', resumoE.configuracaoPropria === false);
  check('E: deliveryFee > 0 (cobrança real acontece, silenciosa sem o aviso da UI)', resumoE.deliveryFee > 0, resumoE.deliveryFee);

  console.log('\n--- Cenário F: restaura configuração completa ---');
  await admin.from('store_settings').upsert(
    { store_id: storeA, chave: 'delivery_fee_config', valor: JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: true, valor: 3 }, faixas: [{ de: 0, ate: 10, valor: 7 }] }) },
    { onConflict: 'store_id,chave' },
  );
  r = await lerViaAnon(storeA);
  check('F: horário configuracao_propria = true', r.horario.configuracao_propria === true);
  check('F: entrega configuracao_propria = true', r.entrega.configuracao_propria === true);

  console.log('\n--- Isolamento: loja B (sempre sem config) nunca recebeu nada da loja A ---');
  const rB = await lerViaAnon(storeB);
  check('Loja B: horário configuracao_propria = false (independente de tudo que fizemos na loja A)', rB.horario.configuracao_propria === false);
  check('Loja B: entrega configuracao_propria = false', rB.entrega.configuracao_propria === false);
  check('Loja B: tabela é a padrão da plataforma (R$10), não a customizada da loja A (R$7)', rB.entrega.faixas?.[0]?.valor === 10, JSON.stringify(rB.entrega.faixas));

  console.log('\n===== CONCLUSAO =====');
  console.log(failures === 0
    ? 'TRANSPARENCIA VALIDADA: configuracao_propria reflete corretamente cada cenario (A-F), isolado por loja, sem alterar o valor calculado.'
    : 'ATENCAO: ver [FAIL] acima.');
} finally {
  console.log('\n--- Limpeza ---');
  for (const storeId of [storeA, storeB]) {
    if (!storeId) continue;
    await admin.from('store_settings').delete().eq('store_id', storeId);
    await admin.from('stores').delete().eq('id', storeId);
  }
  console.log('Lojas descartáveis A e B removidas.');
}

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
if (failures) process.exitCode = 1;
