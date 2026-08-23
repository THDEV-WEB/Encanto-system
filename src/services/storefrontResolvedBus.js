/* services/storefrontResolvedBus.js — REF-PROD-GOLIVE-01 (fecha CHECKOUT-TENANT-02 da auditoria
   pre-go-live). Barramento minimo (mesmo padrao de productCacheBus.js — pub/sub sem estado, folha
   pura) que avisa quando o StorefrontProvider RESOLVE a loja por dominio (get_store_by_domain).

   Por que precisa existir: getCats/getProds/getAds so filtram por store_id quando a resolucao ja
   terminou (services/storefrontStore.js) -- antes disso, a RLS publica devolve o catalogo de TODAS
   as lojas ativas da plataforma (migration REF-SAAS-01-onda6-1). Com 2+ lojas ativas ao mesmo
   tempo, se algum hook buscar o catalogo ANTES da resolucao terminar, o resultado misturado fica
   preso em cache pelo resto da sessao (nada reagia a resolucao chegar depois). Os hooks do
   catalogo assinam este evento pra refazer o fetch assim que a loja resolver.

   Deliberadamente um evento PROPRIO (nao reaproveita productCacheBus/emitProductsChanged direto):
   aquele evento dispara em toda escrita do Admin (upsert/toggle/delete produto) e hoje so limpa
   cache de sessao pra PROXIMA montagem, de proposito, pra nao forcar refetch em tempo real em
   clientes com o storefront aberto a cada edicao do dono. Este evento dispara no MAXIMO 1 vez por
   sessao (quando a resolucao assincrona termina), efeito colateral bem mais restrito. */
const listeners = new Set();

export const onStorefrontResolved = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const emitStorefrontResolved = () => {
  listeners.forEach(fn => { try { fn(); } catch (e) { /* nao quebrar a resolucao por causa de um assinante */ } });
};
