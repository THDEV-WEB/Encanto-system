/* services/resolveStoreParam.js — REF-SAAS-01 · Onda 6.1: combina os dois singletons de loja ativa
   (adminStore.js — loja ESCOLHIDA no seletor do Admin; storefrontStore.js — loja RESOLVIDA por
   dominio no storefront) numa unica fonte que os services COMPARTILHADOS entre os dois bundles
   (delivery/deliveryEta.js, delivery/deliveryFeeConfig.js, businessHours/cronograma.js,
   businessHours/override.js — cada um tem uma leitura usada pelo CLIENTE e uma escrita usada pelo
   ADMIN) podem chamar sem se importar com qual bundle esta rodando.

   So um dos dois singletons tera valor por vez — cada Provider (AdminStoreProvider/StorefrontProvider)
   so existe no proprio bundle, nunca os dois ao mesmo tempo. Quando nenhum tem valor, cai no objeto
   vazio de sempre (RPC usa o proprio DEFAULT default_store_id()) — exatamente o comportamento anterior
   a esta onda. */
import { buildStoreRpcParam as buildAdminRpcParam, buildStoreColumn as buildAdminColumn } from './adminStore.js';
import { buildStorefrontRpcParam, buildStorefrontColumn } from './storefrontStore.js';

export function buildStoreRpcParam() {
  const admin = buildAdminRpcParam();
  return admin.p_store_id ? admin : buildStorefrontRpcParam();
}
export function buildStoreColumn() {
  const admin = buildAdminColumn();
  return admin.store_id ? admin : buildStorefrontColumn();
}
