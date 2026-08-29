/* hooks/useCatalogoConfiavel.js — REF-PRICE-SOURCE-01 · Onda 2.
   Expõe se o catálogo atual (produtos/categorias/adicionais) veio do BANCO — confiável para autorizar
   um checkout real — ou caiu no MOCK local (src/data/mockCatalog.js), que NUNCA deve gerar pedido
   financeiro: create_order() já rejeita no servidor qualquer item sem product_id (fail-closed, fonte
   de verdade real), mas deixar o cliente preencher todo o formulário só para ver um erro genérico no
   fim é má UX — este hook é a camada de aviso antecipado, não a proteção em si.
   Mesmo sinal que useProducts/useCategories/useAdicionais já consomem (storefrontResolvedBus) — não
   duplica a lógica de resolução de loja, só expõe o resultado de forma reativa. */
import { useState, useEffect } from 'react';
import { onStorefrontResolved, hasStorefrontSettled, storefrontResolutionSucceeded } from '../services/storefrontResolvedBus.js';

export function useCatalogoConfiavel() {
  /* Otimista (true) enquanto a resolução ainda está pendente — evita piscar um aviso falso antes do
     app terminar de resolver a loja. Na prática o CheckoutPage só é alcançável depois que o cliente já
     navegou/adicionou itens, então a resolução quase sempre já assentou nesse ponto. */
  const [confiavel, setConfiavel] = useState(() => !hasStorefrontSettled() || storefrontResolutionSucceeded());

  useEffect(() => {
    if (hasStorefrontSettled()) { setConfiavel(storefrontResolutionSucceeded()); return; }
    return onStorefrontResolved((ok) => setConfiavel(ok));
  }, []);

  return confiavel;
}
