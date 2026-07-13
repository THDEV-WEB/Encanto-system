/* constants/storage.js — chaves canônicas de localStorage do Encanto (REF-APP-01 · Onda 1).
   Centralização de literais idênticos (§8.1 da REF-APP-01): cada valor é BYTE-IGUAL ao literal
   antigo inline; quem lê/escreve e quando NÃO muda (zero mudança funcional). Camada de
   constantes sem imports (regra D2 trivialmente satisfeita). */
export const STORAGE_KEYS = {
  CART:                     'encanto_cart',
  REQ_ID:                   'encanto_req_id',
  LOYALTY_ENABLED:          'encanto_loyalty_enabled',
  LOYALTY_REQUIRED:         'encanto_loyalty_required',
  LOYALTY_COUNT:            'encanto_loyalty_count',
  LOYALTY_DISCOUNT:         'encanto_loyalty_discount',
  LOYALTY_REWARD_AVAILABLE: 'encanto_loyalty_reward_available',
  LOYALTY_REWARD_USED:      'encanto_loyalty_reward_used',
  STORE_STATUS:             'encanto_store_status',   // legado (pre HB-02): 'open'/'closed' — lido so p/ compat
  STORE_MODE:               'encanto_store_mode',      // HB-02: override 3-estados 'AUTO'|'OPEN'|'CLOSED'
  DELIVERY_ADDRESS:         'encanto_delivery_address',
  DELIVERY_META:            'encanto_delivery_meta',
  LOGO_CLICKS:              'encanto_logo_clicks',
};
