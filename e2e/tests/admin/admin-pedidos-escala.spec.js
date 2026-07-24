/* e2e/tests/admin/admin-pedidos-escala.spec.js — REF-ADMIN-03 · Onda 3 (@writes).
   Prova DIRETO contra o backend (RPC admin_orders_search/admin_orders_stats via supabaseAdmin(),
   mesmo padrão de admin-categorias.spec.js para o trigger da Onda 1) as 2 garantias centrais desta
   onda — mais baratas e determinísticas de provar aqui do que criando dezenas de pedidos só para
   forçar "Carregar mais" pela UI:
     1) busca encontra um pedido AINDA QUE ele esteja fora da janela de uma página pequena — a causa
        raiz que isto substitui (DS.getPedidos antigo, limit(100) fixo, filtro client-side) só
        enxergava o que já tinha sido buscado; aqui o WHERE roda ANTES do LIMIT, sempre na tabela
        inteira.
     2) paginação por cursor não pula nem repete linhas entre páginas (keyset, não OFFSET). */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../fixtures/index.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('escalabilidade de Pedidos (fix REF-ADMIN-03 · Onda 3)', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparDadosDeTeste(); });

  test('busca encontra um pedido mesmo com p_limit menor que a posição dele (não é limitado pela página)', async () => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    const antigo = await criarPedidoAvulso();
    test.skip(antigo.skipped, 'ambiente de E2E não configurado (.env.e2e)');
    await new Promise((r) => setTimeout(r, 1100)); // garante created_at distinto (coluna sem sub-segundo em alguns coletores)
    await criarPedidoAvulso(); // um pedido MAIS NOVO — se a busca só olhasse a página, o antigo ficaria de fora com p_limit=1

    const { data, error } = await admin.rpc('admin_orders_search', {
      p_search: antigo.telefone, p_status: null, p_limit: 1, p_cursor_created_at: null, p_cursor_id: null,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(antigo.orderId); // achou o ANTIGO por telefone, mesmo com limit=1 e um pedido mais novo existindo
  });

  test('paginação por cursor não pula nem repete pedidos entre páginas', async () => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    const p1 = await criarPedidoAvulso();
    test.skip(p1.skipped, 'ambiente de E2E não configurado (.env.e2e)');
    await new Promise((r) => setTimeout(r, 1100));
    const p2 = await criarPedidoAvulso();
    await new Promise((r) => setTimeout(r, 1100));
    const p3 = await criarPedidoAvulso();

    const { data: pagina1, error: e1 } = await admin.rpc('admin_orders_search', {
      p_search: null, p_status: null, p_limit: 2, p_cursor_created_at: null, p_cursor_id: null,
    });
    expect(e1).toBeNull();
    expect(pagina1.map((o) => o.id)).toEqual([p3.orderId, p2.orderId]); // 2 mais recentes, desc

    const ultimo = pagina1[pagina1.length - 1];
    const { data: pagina2, error: e2 } = await admin.rpc('admin_orders_search', {
      p_search: null, p_status: null, p_limit: 2, p_cursor_created_at: ultimo.created_at, p_cursor_id: ultimo.id,
    });
    expect(e2).toBeNull();
    expect(pagina2.some((o) => o.id === p1.orderId)).toBe(true); // achou o mais antigo na 2ª página
    const idsPagina1 = new Set(pagina1.map((o) => o.id));
    expect(pagina2.some((o) => idsPagina1.has(o.id))).toBe(false); // sem repetição entre páginas
  });

  test('admin_orders_stats reflete o total geral sem depender de nenhum limit() do app', async () => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    await criarPedidoAvulso();
    const p2 = await criarPedidoAvulso();
    test.skip(p2.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    const { data: antes } = await admin.rpc('admin_orders_stats');
    const extraId = randomUUID();
    await admin.from('orders').insert({ id: extraId, total: 1, status: 'recebido', payment_method: 'dinheiro', address: 'Retirada na loja — E2E' });

    const { data: depois } = await admin.rpc('admin_orders_stats');
    expect(depois.total_geral).toBe(antes.total_geral + 1); // contagem real, nunca capada
    expect(depois.breakdown.recebido).toBeGreaterThanOrEqual(1);

    await admin.from('orders').delete().eq('id', extraId); // pedido sem customer_id — fora do alcance de limparDadosDeTeste
  });
});
