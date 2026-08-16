/* services/delivery/routing/routeDistanceService.js — REF-DELIVERY-FEE-03.
   Abstracao UNICA que o checkout consome para a distancia de entrega: calcularDistanciaEntrega(origem,
   destino). O checkout NUNCA fala com HeiGIT/OpenRouteService diretamente — so esta funcao sabe que o
   provider hoje e uma Edge Function (route-distance) que fala com o HeiGIT por baixo. Trocar de
   provider no futuro (outro servico de rota) muda so aqui dentro; checkout/deliveryFeeRules intocados.

   POR QUE UMA EDGE FUNCTION (e nao chamada direta, como o geocoding faz com Mapbox/Nominatim/Photon):
   ao contrario do Mapbox (token publico com restricao por dominio), a chave do OpenRouteService NAO
   suporta restricao por dominio — confirmado na documentacao oficial e no proprio suporte do ORS
   ("if you don't want to expose it to the user, [mantenha no servidor]"). Expor a chave no bundle
   client-side deixaria qualquer pessoa livre para copia-la do DevTools e estourar a cota diaria da
   conta (2.000 req/dia). A Edge Function guarda o segredo como Supabase secret (nunca no bundle) e e
   o UNICO lugar que fala com o HeiGIT — mesmo principio ja usado em whatsapp-notify (REF-ORDER-01)
   para as credenciais da Meta.

   FALLBACK (mesmo principio de deliveryFeeRules.montarResumoFinanceiro: nunca bloqueia o checkout):
   qualquer falha da Edge Function (indisponivel, timeout, erro HTTP, rate limit, sem rota encontrada)
   cai no Haversine local (address/utils/coordinates.js) — method:'haversine_fallback', nunca finge
   que foi rota viaria. O chamador (CheckoutPage) decide o que fazer com method/provider
   (observabilidade — breadcrumb do Sentry), sem que deliveryFeeRules precise saber disso: a faixa/
   tarifa continuam calculadas so a partir do numero de km, exatamente como hoje.

   `criarCalculadoraDistancia({invocar})` aceita a chamada de rede INJETADA — mesmo precedente de
   `criarWaterfall(providers, corrigirFn)` em address/geocoding/waterfallGeocoder.js: e o que permite
   testar TODOS os ramos (sucesso/timeout/erro HTTP/rate limit/resposta malformada -> fallback) com
   fakes deterministicos, sem rede/Supabase real (ver tests/routeDistance.golden.mjs). */
import { db } from '../../../lib/supabase.js';
import { distanciaKm } from '../../../address/utils/coordinates.js';
import { buildStoreRpcParam } from '../../resolveStoreParam.js';

/* Checkout e tempo real — nunca pode travar esperando rede externa. A Edge Function tem seu proprio
   timeout interno (5000ms, ver supabase/functions/route-distance/index.ts) menor que este: no caso
   normal ela responde (sucesso OU erro) antes do cliente desistir, evitando abortar sem necessidade
   enquanto ela ainda estava prestes a devolver um fallback informativo. */
export const TIMEOUT_MS = 6000;

/* Chamada real (producao): db.functions.invoke, checado NA HORA (nao capturado no import) — db e um
   binding vivo (export let db) que lib/supabase.js reatribui apos createClient, mesmo padrao ja usado
   em CheckoutPage (if (!db) ...). */
async function invocarPadrao(body, timeoutMs) {
  if (!db) return { data: null, error: new Error('supabase_indisponivel') };
  return db.functions.invoke('route-distance', { body, timeout: timeoutMs });
}

/* Resultado sempre preenchido, nunca undefined (mesmo contrato de montarResumoFinanceiro):
     { distanceKm, durationMin, method, provider, status }
     status  : 'ok' | 'sem_coordenadas'
     method  : 'rota' | 'haversine_fallback' | null (null só quando status='sem_coordenadas')
     provider: 'heigit' | null */
export function criarCalculadoraDistancia({ invocar = invocarPadrao, timeoutMs = TIMEOUT_MS } = {}) {
  return async function calcularDistanciaEntrega(origem, destino) {
    const haversineKm = distanciaKm(origem, destino);
    if (haversineKm === null) {
      return { distanceKm: null, durationMin: null, method: null, provider: null, status: 'sem_coordenadas' };
    }
    try {
      const { p_store_id: storeId } = buildStoreRpcParam();
      const { data, error } = await invocar({ storeId: storeId || null, origin: origem, destination: destino }, timeoutMs);
      if (error || !data || typeof data.distanceKm !== 'number' || !Number.isFinite(data.distanceKm)) {
        throw new Error('routing indisponivel');
      }
      return {
        distanceKm: data.distanceKm,
        durationMin: typeof data.durationMin === 'number' ? data.durationMin : null,
        method: 'rota',
        provider: 'heigit',
        status: 'ok',
      };
    } catch {
      return { distanceKm: haversineKm, durationMin: null, method: 'haversine_fallback', provider: null, status: 'ok' };
    }
  };
}

/* Instancia real (producao) — e a que CheckoutPage.jsx consome. */
export const calcularDistanciaEntrega = criarCalculadoraDistancia();
