/* services/delivery/deliveryEtaFormat.js — REF-GOLIVE-01 (bloqueador 2).
   Camada de TEXTO, pura e SEM NENHUM import, sobre o tempo estimado por tipo de pedido. A auditoria
   pre-Go-Live encontrou tres copias hardcoded do mesmo valor de entrega ("35 a 45 min"): messageTemplates.js
   (TEMPO_ESTIMADO), comandaModel.js (PREVISAO) e a funcao SQL enc_tempo_estimado() (a mais critica das tres —
   e a que alimenta a notificacao automatica REALMENTE enviada em producao via pg_cron). As tres foram
   corrigidas para consumir o MESMO numero configurado pelo Admin (settings.delivery_eta_min, REF-DELIVERY-01);
   este modulo e a fonte UNICA da FRASE (nao do numero) usada pelos dois lados JS.

   Por que NAO importar services/delivery/deliveryEta.js (o modulo que de fato le/escreve o valor no
   Supabase): ele importa lib/supabase.js (IO), e messageTemplates.js/comandaModel.js precisam continuar
   100% Node-puro (rodam em golden test sem Vite/browser — import.meta.env nao existe nesse runtime).
   Importar qualquer export de deliveryEta.js arrastaria essa cadeia e quebraria os testes. Por isso este
   arquivo fica deliberadamente sem imports, e quem chama (StoreApp/CheckoutPage/ComandaModal/
   PedidoNotificacoes — todos componentes React, todos já usando useDeliveryEta) e responsavel por
   RESOLVER o numero (useDeliveryEta) e so passar o valor ja pronto.

   Retirada NAO e administravel pelo Admin (e uma constante de negocio, fora do escopo do REF-DELIVERY-01
   e desta correcao) — permanece exatamente "cerca de 20 min" nas tres copias, como sempre foi. */

export const RETIRADA_TEMPO_TEXTO = 'cerca de 20 min';

/* Espelha ETA_DEFAULT de deliveryEta.js — usado só quando o chamador ainda não tem o valor sincronizado
   (mesmo papel que os fallbacks locais de schedule.js/cronograma.js para business hours). */
export const ENTREGA_ETA_FALLBACK = 45;

export function textoTempoEntrega(tipo, etaMin = ENTREGA_ETA_FALLBACK) {
  return tipo === 'retirada' ? RETIRADA_TEMPO_TEXTO : `até ${etaMin} min`;
}
