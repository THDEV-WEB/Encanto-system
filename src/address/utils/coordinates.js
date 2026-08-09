/* address/utils/coordinates.js — REF-ADDRESS-01 (+ REF-SAAS-01 · Onda 6.3).
   Lógica pura de coordenadas (lat/lng). Sem React/IO. Centraliza o centro padrão do mapa e a
   formatação de coordenada. */

/* Centro padrão do mapa — ÚLTIMO fallback, só usado quando a loja ainda não tem `company_info.lojaLat/
   lojaLng` configurado nem (no cliente) foi possível resolver uma posição melhor. Antes da Onda 6.3 era
   fixo no centro de Timbó/SC (byte-igual ao mapPin inicial do AddressModal original); agora é o centro
   geográfico do Brasil (referência neutra, não amarrada a nenhuma loja) — uma loja nova em qualquer
   cidade nunca mais abre o mapa "chutando" Timbó. Nunca sobrescreve uma coordenada real já salva. */
export const CENTRO_PADRAO = { lat: -14.235, lng: -51.925 };

/* Formata coordenada para exibição (5 casas) — mesma saída de `n.toFixed(5)` usada no rodapé do mapa. */
export const formatarCoord = (n) => Number(n).toFixed(5);

/* REF-DELIVERY-FEE-01 — distância em linha reta (haversine) entre 2 pontos {lat,lng}, em km. Pura, sem
   arredondamento (mesma disciplina de pricing.js: quem exibe/arredonda é a camada de apresentação, nunca o
   cálculo). null quando faltar alguma coordenada — o chamador decide o fallback (nunca lança). Raio médio
   da Terra em km (6371) é a mesma constante usada por qualquer implementação de referência do haversine. */
const RAIO_TERRA_KM = 6371;
const paraRad = (graus) => (graus * Math.PI) / 180;

export function distanciaKm(origem, destino) {
  const lat1 = origem?.lat, lng1 = origem?.lng, lat2 = destino?.lat, lng2 = destino?.lng;
  if (![lat1, lng1, lat2, lng2].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const dLat = paraRad(lat2 - lat1);
  const dLng = paraRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(paraRad(lat1)) * Math.cos(paraRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return RAIO_TERRA_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
