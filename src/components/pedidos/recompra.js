/* components/pedidos/recompra.js — REF-CLIENTE-02 Onda 4 (PURO): decide o que da para recomprar.
   Regras (todas do enunciado):
   - usa o CATALOGO ATUAL para resolver por product_id -> preco/pricing SEMPRE atuais (nunca o antigo);
   - PULA: produto inexistente hoje, indisponivel, custom (sem product_id UUID) ou que exige escolha
     (tamanhos/variantes) — pois o snapshot nao guarda o tamanho escolhido; cliente personaliza na loja.
   Sem imports (folha pura, testavel). Nao adiciona ao carrinho; so classifica. */
export function montarRecompra(itens, catalogo) {
  const mapa = new Map((catalogo || []).map((p) => [p.id, p]));
  const adicionar = [];
  const pulados = [];
  (itens || []).forEach((it) => {
    const prod = it.product_id ? mapa.get(it.product_id) : null;
    const exigeEscolha = !!prod && (
      (Array.isArray(prod.tamanhos) && prod.tamanhos.length > 0) ||
      (Array.isArray(prod.variantes) && prod.variantes.length > 0)
    );
    if (!prod) { pulados.push({ nome: it.nome_produto, motivo: 'indisponivel' }); return; }
    if (prod.disponivel === false) { pulados.push({ nome: it.nome_produto, motivo: 'indisponivel' }); return; }
    if (exigeEscolha) { pulados.push({ nome: it.nome_produto, motivo: 'personalizar' }); return; }
    adicionar.push({ prod, qty: it.quantity || 1, obs: it.observacoes || '' });
  });
  return { adicionar, pulados };
}
