/* e2e/support/cleanup.js — REF-E2E-01.
   Remove, via service_role, os dados que os specs @writes criam no projeto Supabase de E2E —
   mantem cada execucao independente (nenhum teste deve herdar pedido/cliente de uma run anterior).
   So apaga o que os PROPRIOS specs criaram: filtra pelo telefone do cliente fixture (authSession.js)
   e por um prefixo reconhecivel (E2E_TEST_) nos registros que os specs de checkout gerarem para
   clientes anonimos/guest. Nunca roda fora do projeto de E2E (supabaseAdmin() ja e o client desse
   projeto; nao existe caminho de codigo aqui que aponte para producao).
   Env-gated: sem o projeto de E2E, {skipped:true} — nada a limpar. */
import { supabaseAdmin } from './supabaseAdmin.js';
import { CLIENTE_FIXTURE } from './fixture-accounts.js';

export const PREFIXO_TESTE = 'E2E_TEST_';

/** Apaga pedidos/itens/fidelidade/clientes gerados pelos specs @writes (fixture + prefixo E2E_TEST_).
    Ordem respeita FKs (filhos antes dos pais); cada passo é tolerante a tabela ausente/0 linhas. */
export async function limparDadosDeTeste() {
  const client = supabaseAdmin();
  if (!client) return { ok: false, skipped: true };

  const telefones = [CLIENTE_FIXTURE.telefone];
  const { data: clientes } = await client
    .from('customers')
    .select('id,phone,name')
    .or(`phone.in.(${telefones.join(',')}),name.ilike.${PREFIXO_TESTE}%`);
  const customerIds = (clientes || []).map((c) => c.id);
  if (customerIds.length === 0) return { ok: true, skipped: false, removidos: 0 };

  const { data: pedidos } = await client.from('orders').select('id').in('customer_id', customerIds);
  const orderIds = (pedidos || []).map((o) => o.id);

  const tentativas = [
    orderIds.length && client.from('order_items').delete().in('order_id', orderIds),
    orderIds.length && client.from('order_events').delete().in('order_id', orderIds),
    customerIds.length && client.from('loyalty_events').delete().in('customer_id', customerIds),
    customerIds.length && client.from('loyalty_accounts').delete().in('customer_id', customerIds),
    orderIds.length && client.from('orders').delete().in('id', orderIds),
    client.from('customers').delete().in('id', customerIds),
  ].filter(Boolean);

  for (const p of tentativas) {
    const { error } = await p;
    if (error) console.warn(`[e2e] limpeza parcial (tabela pode não existir neste schema): ${error.message}`);
  }
  return { ok: true, skipped: false, removidos: customerIds.length };
}
