/* constants/storage.js — chaves canônicas de localStorage do Encanto (REF-APP-01 · Onda 1).
   Centralização de literais idênticos (§8.1 da REF-APP-01): cada valor é BYTE-IGUAL ao literal
   antigo inline; quem lê/escreve e quando NÃO muda (zero mudança funcional). Camada de
   constantes sem imports (regra D2 trivialmente satisfeita). */
export const STORAGE_KEYS = {
  CART:                     'encanto_cart',
  REQ_ID:                   'encanto_req_id',
  /* REF-LOYALTY-01: a fidelidade agora PERTENCE AO CUSTOMER e vive no Supabase (fonte unica).
     O localStorage guarda APENAS um cache do ultimo estado conhecido do proprio cliente (pintura
     sem flash) — NUNCA e contador/verdade. As chaves legadas encanto_loyalty_* (count/required/
     discount/enabled/reward_*) foram removidas: eram um contador por-navegador, forjavel. */
  LOYALTY_CACHE:            'encanto_loyalty_cache',
  STORE_STATUS:             'encanto_store_status',   // legado (pre HB-02): 'open'/'closed' — lido so p/ compat
  STORE_MODE:               'encanto_store_mode',      // HB-02: override 3-estados 'AUTO'|'OPEN'|'CLOSED'
  /* REF-CHECKOUT-ADDRESS-01: FONTE UNICA do endereco de entrega — objeto canonico (JSON) numa unica
     chave, dono = AddressProvider. As chaves legadas DELIVERY_ADDRESS/_META (REF-ADDRESS-01, label+meta
     separados) sao MIGRADAS para DELIVERY no 1o mount e depois removidas; ficam aqui so p/ a migracao. */
  DELIVERY:                 'encanto_delivery',
  DELIVERY_ADDRESS:         'encanto_delivery_address', // legado (migrado -> DELIVERY)
  DELIVERY_META:            'encanto_delivery_meta',     // legado (migrado -> DELIVERY)
  LOGO_CLICKS:              'encanto_logo_clicks',
};
