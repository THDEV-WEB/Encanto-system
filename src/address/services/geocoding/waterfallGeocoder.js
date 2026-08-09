/* address/services/geocoding/waterfallGeocoder.js — REF-ADDRESS-02 · Onda 3 (+ Onda 4).
   Orquestra a cadeia de fallback de geocoding (ADR §2.1): tenta cada provedor em ordem, pula os
   indisponíveis (ex.: Mapbox sem token), tenta o próximo em erro OU resultado vazio, e para no primeiro
   que devolver algo. Nenhum provedor concreto é importado direto pelos consumidores — só por aqui.

   Ordem padrão: Mapbox (principal, escolhido pelo dono; inerte sem VITE_MAPBOX_TOKEN) -> Nominatim
   (sempre disponível, comportamento de hoje) -> Photon (fallback fuzzy — é quem resolveu "Schlay"->
   "Schlei" no diagnóstico ao vivo da Onda 0). GPS/reverse a partir do pino do mapa continuam sendo o
   último recurso, mas isso é UX (Onda 5), não faz parte desta cadeia.

   Onda 4 — D-GAZETTEER-ORDER: se a query original voltar vazia de TODOS os providers, tenta corrigir via
   gazetteerCorrector (tabela curada local, fuzzy pg_trgm) e roda a cadeia de novo com o nome corrigido.
   Só age em cima de uma busca que JÁ falhou — nunca substitui uma query que já funcionava.

   `criarWaterfall(providers, corrigirFn)` aceita dependências injetadas — é o que permite testar a
   ORQUESTRAÇÃO (ordem/pular indisponível/cair em erro/cair em vazio/correção de 2ª rodada) com fakes,
   sem rede/banco nenhum.

   REF-SAAS-01 · Onda 6.3: `sugestoes(query, bias)` ganha um 2º parâmetro opcional `{cidade, estado}` —
   repassado a cada provider (só o Nominatim usa; Mapbox/Photon já fazem busca nacional, nunca hardcodaram
   cidade) e ao corretor do gazetteer (`bias.cidade`, parâmetro que já existia em gazetteerCorrector.js,
   nunca antes preenchido). */
import { provider as mapboxProvider } from './providers/mapboxProvider.js';
import { provider as nominatimProvider } from './providers/nominatimProvider.js';
import { provider as photonProvider } from './providers/photonProvider.js';
import { corrigir as corrigirComGazetteer } from './gazetteerCorrector.js';

export const ORDEM_PADRAO = [mapboxProvider, nominatimProvider, photonProvider];

export function criarWaterfall(providers = ORDEM_PADRAO, corrigirFn = corrigirComGazetteer) {
  async function tentarProviders(query, bias) {
    for (const p of providers) {
      if (!p.disponivel()) continue;
      try {
        const r = await p.sugestoes(query, bias);
        if (Array.isArray(r) && r.length > 0) return r;
      } catch (e) {
        console.warn(`[Encanto] geocoding provider "${p.nome}" falhou (sugestoes):`, (e && e.message) || e);
      }
    }
    return [];
  }
  async function sugestoes(query, bias) {
    const primeira = await tentarProviders(query, bias);
    if (primeira.length > 0) return primeira;
    const corrigida = await corrigirFn(query, { cidade: bias?.cidade || null });
    if (!corrigida || corrigida === query) return [];
    return tentarProviders(corrigida, bias);
  }
  async function reverso(lat, lng) {
    /* CONTRATO PRESERVADO de nominatimService.reverso: lança em falha total (nunca devolve null) — 4
       call-sites de useAddressSearch.js dependem disso, e 1 deles (confirmMap) propaga de propósito, SEM
       try/catch próprio (nominatimService.js linha 5-6: "preservamos isso mantendo o try/catch no
       chamador"). Devolver null quebraria confirmMap com um TypeError não tratado em `d.address`. */
    let ultimoErro = null;
    for (const p of providers) {
      if (!p.disponivel()) continue;
      try {
        const r = await p.reverso(lat, lng);
        if (r && r.address) return r;
      } catch (e) {
        ultimoErro = e;
        console.warn(`[Encanto] geocoding provider "${p.nome}" falhou (reverso):`, (e && e.message) || e);
      }
    }
    throw ultimoErro || new Error('Nenhum provedor de geocoding reverso disponível/bem-sucedido.');
  }
  return { sugestoes, reverso, providers };
}

/* Instância real (ordem padrão) — é a que geocodingService.js consome. */
export const waterfallGeocoder = criarWaterfall();
