/* services/adminStore.js — REF-SAAS-01 · Onda 5: loja ativa da sessao do Admin, como singleton de
   modulo (mesmo papel que db/dbCliente ja cumprem em lib/supabase.js/lib/dbCliente.js). Existe porque
   varios services administrativos (deliveryEta.js, deliveryFeeConfig.js, cronograma.js, override.js,
   loyaltyService.js, DataService.js) sao funcoes simples FORA da arvore React — nao podem chamar
   useContext(AdminStoreContext) diretamente. O AdminStoreProvider e a UNICA fonte que ESCREVE aqui
   (via setActiveStoreId, ao resolver a loja inicial ou ao trocar); os services so LEEM.

   IMPORTANTE (principio central da Onda 5): isto e so CONTEXTO OPERACIONAL — qual loja o client vai
   PEDIR em cada chamada. NÃO É AUTORIZAÇÃO. Cada RPC recebida aqui ainda revalida is_admin_of(store_id)
   no servidor; se o valor aqui estiver "errado" ou for adulterado, o banco nega — nunca a UI. */
import { STORAGE_KEYS } from '../constants/storage.js';

let activeStoreId = null;

export function getActiveStoreId() {
  return activeStoreId;
}

export function setActiveStoreId(id) {
  activeStoreId = id || null;
  try {
    if (activeStoreId) localStorage.setItem(STORAGE_KEYS.ADMIN_ACTIVE_STORE, activeStoreId);
    else localStorage.removeItem(STORAGE_KEYS.ADMIN_ACTIVE_STORE);
  } catch { /* localStorage indisponivel (modo privado/quota) -- nao trava o app */ }
}

/* Leitura tolerante do valor persistido — usada SO pelo AdminStoreProvider no boot, para saber qual
   loja tentar reativar antes de confirmar que ela ainda esta na lista devolvida por list_my_stores(). */
export function lerActiveStoreIdPersistido() {
  try { return localStorage.getItem(STORAGE_KEYS.ADMIN_ACTIVE_STORE) || null; } catch { return null; }
}

/* Helpers pros services (deliveryEta.js, cronograma.js, override.js, deliveryFeeConfig.js,
   loyaltyService.js, DataService.js) — varios sao COMPARTILHADOS com o bundle da loja (leitura
   publica do storefront), onde getActiveStoreId() e sempre null (o AdminStoreProvider so existe no
   bundle do Admin). Por isso os dois retornam objeto VAZIO quando nao ha loja ativa -- o spread
   {...buildStoreRpcParam()} nao adiciona nenhum parametro, e a RPC cai no proprio
   DEFAULT default_store_id() de sempre, sem nenhuma mudanca de comportamento pro storefront. */
export function buildStoreRpcParam() {
  const id = getActiveStoreId();
  return id ? { p_store_id: id } : {};
}
export function buildStoreColumn() {
  const id = getActiveStoreId();
  return id ? { store_id: id } : {};
}
