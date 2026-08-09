/* services/storefrontStore.js — REF-SAAS-01 · Onda 6.1: loja RESOLVIDA POR DOMINIO no boot do
   storefront, como singleton de modulo (mesmo papel que adminStore.js cumpre no bundle do Admin —
   nomes DISTINTOS de proposito: sao conceitos DIFERENTES. adminStore.js guarda a loja ESCOLHIDA num
   seletor visivel pelo Admin; este guarda a loja RESOLVIDA automaticamente por
   get_store_by_domain(hostname), sem nenhuma interacao do usuario. DataService.js/AuthService.js
   importam os dois — um pros metodos so-Admin, outro pros metodos so-storefront (getCats/getProds/
   getAds/savePedido/linkCustomer/getMeuCustomer).

   Inicializa NULL (= comportamento de sempre: RPCs caem no proprio DEFAULT default_store_id(), sem
   nenhum p_store_id/store_id explicito) — decisao deliberada pra NAO bloquear o primeiro render
   (REF-PERF-01 investiu tempo real em performance de boot; um round-trip de rede bloqueante aqui
   custaria performance real pra Encanto — unico dominio real hoje). O StorefrontProvider chama
   get_store_by_domain() em paralelo ao resto do boot e so ATUALIZA este singleton quando resolve; pra
   Encanto, a resolucao SEMPRE confirma o mesmo valor que o fallback ja assumia, entao nao ha nenhum
   flash visivel na pratica. O StorefrontProvider e a UNICA fonte que ESCREVE aqui.

   IMPORTANTE (mesmo principio da Onda 5): isto e so CONTEXTO OPERACIONAL — get_store_by_domain() e
   store_ativo() no banco sao quem decidem o que e visivel de verdade, nunca este singleton. */

let resolvedStore = null; // { store_id, slug, nome, status } | null (ainda nao resolvido)

export function getResolvedStore() {
  return resolvedStore;
}

export function setResolvedStore(store) {
  resolvedStore = store || null;
}

export function getResolvedStoreId() {
  return resolvedStore?.store_id ?? null;
}

/* Helpers pros services do storefront — objeto VAZIO enquanto nao resolveu (equivalente a "usa o
   DEFAULT de sempre", zero mudanca de comportamento ate a resolucao assincrona terminar). */
export function buildStorefrontRpcParam() {
  const id = getResolvedStoreId();
  return id ? { p_store_id: id } : {};
}
export function buildStorefrontColumn() {
  const id = getResolvedStoreId();
  return id ? { store_id: id } : {};
}
