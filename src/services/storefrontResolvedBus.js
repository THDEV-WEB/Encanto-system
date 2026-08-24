/* services/storefrontResolvedBus.js — REF-PROD-GOLIVE-01 (fecha CHECKOUT-TENANT-02 da auditoria
   pre-go-live). Barramento minimo (mesmo padrao de productCacheBus.js — pub/sub sem estado, folha
   pura) que avisa quando a resolucao de loja por dominio (get_store_by_domain, StorefrontProvider)
   SE ENCERRA -- com sucesso OU com falha (REF-PERF-03).

   Por que precisa existir: getCats/getProds/getAds so filtram por store_id quando a resolucao ja
   terminou (services/storefrontStore.js) -- antes disso, a RLS publica devolve o catalogo de TODAS
   as lojas ativas da plataforma (migration REF-SAAS-01-onda6-1). Com 2+ lojas ativas ao mesmo
   tempo, se algum hook buscar o catalogo ANTES da resolucao terminar, o resultado misturado fica
   preso em cache pelo resto da sessao (nada reagia a resolucao chegar depois).

   REF-PERF-03 (bootstrap multi-tenant): os hooks do catalogo pararam de buscar no mount e passaram a
   ESPERAR este sinal antes do 1o fetch (elimina o wave sem store_id inteiro, nao so' o refetch depois
   dele -- ver StorefrontProvider.jsx e useCategories/useProducts/useAdicionais). Por isso o sinal
   agora carrega um booleano: `true` = loja resolvida (getResolvedStoreId() tem um id valido, hooks
   buscam filtrado), `false` = resolucao falhou/expirou (offline, erro, timeout de RPC_TIMEOUT, ou a
   RPC devolveu uma linha vazia/inesperada) -- hooks caem direto no MOCK local, NUNCA fazem fetch ao
   vivo sem filtro (isso seria expor catalogo de outras lojas ativas; ver achado da auditoria REF-
   PERF-03: o comportamento antigo, "sem filtro = RLS decide", ficou inseguro desde que a RLS publica
   passou a permitir qualquer loja ativa, nao so' a padrao).

   `hasStorefrontSettled()` cobre o caso de um hook montar DEPOIS do sinal ja ter disparado (o evento
   so' dispara 1x por sessao, nunca de novo) -- consulta o ultimo resultado sem precisar assinar. */
const listeners = new Set();
let settled = false;
let succeeded = false;

export const onStorefrontResolved = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const hasStorefrontSettled = () => settled;
export const storefrontResolutionSucceeded = () => succeeded;

export const emitStorefrontResolved = (ok = true) => {
  settled = true;
  succeeded = !!ok;
  listeners.forEach(fn => { try { fn(succeeded); } catch (e) { /* nao quebrar a resolucao por causa de um assinante */ } });
};
