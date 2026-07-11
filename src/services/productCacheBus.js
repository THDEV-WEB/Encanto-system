/* services/productCacheBus.js — PRICE-DOMAIN-01
   Barramento minimo de invalidacao do cache de produtos. Desacopla a ESCRITA (DataService,
   camada services) da limpeza do cache de SESSAO da loja (_prodCache em hooks/useProducts),
   SEM criar ciclo de import e SEM violar as camadas do test:deps (folha pura: nao importa nada).

   Fluxo: DataService.upsertProd/toggleProd/delProd -> emitProductsChanged() -> assinantes
   limpam seus caches -> a proxima leitura da loja (remount do StoreApp ao sair do Admin)
   busca dados frescos do Supabase, sem depender de F5 nem de nova aba. */
const listeners = new Set();

/* Registra um assinante de invalidacao; devolve funcao para cancelar a inscricao. */
export const onProductsChanged = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/* Notifica todos os assinantes que houve escrita de produto (upsert/toggle/delete).
   Best-effort: um assinante que lance nunca interrompe o fluxo de escrita. */
export const emitProductsChanged = () => {
  listeners.forEach(fn => { try { fn(); } catch (e) { /* nao quebrar a escrita por causa de um assinante */ } });
};
