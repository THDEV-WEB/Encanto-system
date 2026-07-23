/* e2e/support/cleanup.js — REF-E2E-01 (+ REF-E2E-02 Onda 3: split fixture vs. convidado).
   Remove, via service_role, os dados que os specs @writes criam no projeto Supabase de E2E —
   mantem cada execucao independente (nenhum teste deve herdar pedido/cliente de uma run anterior).
   Nunca roda fora do projeto de E2E (supabaseAdmin() ja e o client desse projeto; nao existe caminho
   de codigo aqui que aponte para producao). Env-gated: sem o projeto de E2E, {skipped:true}.

   Dois perfis de cliente, limpos de formas DIFERENTES (achado da Onda 3 da E2E-02, ao logar como o
   cliente fixture pela 1a vez — ver docs/adr/REF-E2E-02-auditoria-cliente-autenticado.md §Riscos):
   - CONVIDADO (nome com prefixo E2E_TEST_, telefone gerado por execucao — checkout guest): EFEMERO,
     TUDO e apagado, inclusive a propria linha `customers` — nunca reaproveitado entre runs.
   - FIXTURE (telefone == CLIENTE_FIXTURE.telefone): PERSISTENTE, como o admin fixture. A linha
     `customers` NUNCA e apagada aqui — apaga-la faria `precisaTelefone` voltar a `true` na proxima
     spec (o modal "Complete seu cadastro" reapareceria por cima de qualquer tela, ver
     support/fixture-customer.js). So os dados TRANSACIONAIS (pedidos/timeline/fidelidade) sao
     limpos, devolvendo o fixture a "0 pedidos/0 selos" a cada execucao. */
import { supabaseAdmin } from './supabaseAdmin.js';
import { CLIENTE_FIXTURE } from './fixture-accounts.js';

export const PREFIXO_TESTE = 'E2E_TEST_';

/** Apaga pedidos/itens/timeline/fidelidade dos customerIds informados. Ordem respeita FKs (filhos
    antes dos pais); cada passo é tolerante a tabela ausente/0 linhas. NUNCA apaga `customers`. */
async function apagarPedidosEFidelidade(client, customerIds) {
  if (customerIds.length === 0) return;
  const { data: pedidos } = await client.from('orders').select('id').in('customer_id', customerIds);
  const orderIds = (pedidos || []).map((o) => o.id);

  const tentativas = [
    orderIds.length && client.from('order_items').delete().in('order_id', orderIds),
    orderIds.length && client.from('order_events').delete().in('order_id', orderIds),
    client.from('loyalty_events').delete().in('customer_id', customerIds),
    client.from('loyalty_accounts').delete().in('customer_id', customerIds),
    orderIds.length && client.from('orders').delete().in('id', orderIds),
  ].filter(Boolean);

  for (const p of tentativas) {
    const { error } = await p;
    if (error) console.warn(`[e2e] limpeza parcial (tabela pode não existir neste schema): ${error.message}`);
  }
}

/** Limpa pedidos/timeline/fidelidade do cliente FIXTURE — nunca apaga a linha `customers` (persistente,
    igual ao admin fixture). Chamar no `afterEach`/`afterAll` de qualquer spec `@writes` que faça
    checkout/fidelidade logado como o fixture, para devolvê-lo a "0 pedidos/0 selos". */
export async function limparPedidosDoFixture() {
  const client = supabaseAdmin();
  if (!client) return { ok: false, skipped: true };
  const { data: clientes } = await client.from('customers').select('id').eq('phone', CLIENTE_FIXTURE.telefone);
  const customerIds = (clientes || []).map((c) => c.id);
  await apagarPedidosEFidelidade(client, customerIds);
  return { ok: true, skipped: false, removidos: customerIds.length };
}

/** Apaga TUDO (inclusive a própria linha `customers`) dos clientes CONVIDADO gerados por specs
    `@writes` (nome com prefixo E2E_TEST_) — efêmeros, nunca reaproveitados entre runs. Usado pelo
    checkout guest (REF-E2E-01 Onda 4). */
export async function limparDadosDeTeste() {
  const client = supabaseAdmin();
  if (!client) return { ok: false, skipped: true };

  const { data: clientes } = await client.from('customers').select('id').ilike('name', `${PREFIXO_TESTE}%`);
  const customerIds = (clientes || []).map((c) => c.id);
  if (customerIds.length === 0) return { ok: true, skipped: false, removidos: 0 };

  await apagarPedidosEFidelidade(client, customerIds);
  const { error } = await client.from('customers').delete().in('id', customerIds);
  if (error) console.warn(`[e2e] limpeza parcial (customers convidado): ${error.message}`);
  return { ok: true, skipped: false, removidos: customerIds.length };
}
