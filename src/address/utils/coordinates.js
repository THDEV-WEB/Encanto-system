/* address/utils/coordinates.js — REF-ADDRESS-01.
   Lógica pura de coordenadas (lat/lng). Sem React/IO. Centraliza o centro padrão do mapa, a formatação
   de coordenada e a checagem de área de entrega. */

/* Centro padrão do mapa (Timbó/SC) — BYTE-IGUAL ao mapPin inicial do AddressModal original. */
export const CENTRO_PADRAO = { lat: -26.795, lng: -49.270 };

/* Formata coordenada para exibição (5 casas) — mesma saída de `n.toFixed(5)` usada no rodapé do mapa. */
export const formatarCoord = (n) => Number(n).toFixed(5);

/* Área de entrega aproximada por bounding-box em torno de Timbó. PRESERVADA VERBATIM do `inRange` original
   (AddressModal) para garantir zero mudança de comportamento. NOTA (dívida técnica herdada, NÃO alterada
   aqui): a expressão original compara `lng` duas vezes com `>=` — provavelmente deveria ser `lng<=-49.0`.
   Além disso está atualmente DESLIGADA (nunca era chamada no fluxo). Fica isolada e pronta para a evolução
   futura de "área de entrega"/geofencing; qualquer correção é um marco próprio (mudaria comportamento). */
export const dentroDaArea = (lat, lng) => lat >= -27.0 && lat <= -26.5 && lng >= -49.5 && lng >= -49.0;
