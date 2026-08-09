/* address/services/geocodingService.js — REF-ADDRESS-01 (+ REF-ADDRESS-02 · Onda 3).
   FACADE de geocoding do domínio Address: ponto ÚNICO por onde passam busca de endereço, reverse-geocode
   e consulta de CEP. Desacopla a aplicação do provedor concreto — trocar/acrescentar provedor muda só
   aqui (ou dentro do waterfall), não os componentes/hooks. Camada de I/O pura (sem React). Não formata
   nem normaliza (isso é responsabilidade de utils/) — só coordena.

   Onda 3: sugestoes/reverso passam a delegar para o waterfallGeocoder (cadeia Mapbox -> Nominatim ->
   Photon, ADR §2.1) em vez de chamar o Nominatim direto. CONTRATO EXTERNO preservado — ainda devolve
   array/objeto no shape Nominatim ({address:{...}, display_name, lat, lon}, com _provider/_confidence
   como campos extra que o código existente simplesmente ignora) — useAddressSearch.js e addressFormat.js
   não mudam nenhuma linha. porCep continua exclusivamente ViaCEP (CEP não é um problema de busca fuzzy). */

import { waterfallGeocoder } from './geocoding/waterfallGeocoder.js';
import { consultarCep } from './viaCepService.js';

export const geocoding = {
  /* Busca por texto (geocoding direto) -> array de resultados (shape Nominatim; primeiro provedor da
     cadeia que devolver algo não-vazio). `bias` (REF-SAAS-01 · Onda 6.3, opcional): {cidade, estado} da
     loja resolvida — vies de busca, nunca obrigatorio (sem ele, busca nacional pura). */
  sugestoes: (query, bias) => waterfallGeocoder.sugestoes(query, bias),
  /* Reverse-geocode (coordenada -> endereço) -> resposta no shape Nominatim com .address, ou null. */
  reverso: (lat, lng) => waterfallGeocoder.reverso(lat, lng),
  /* Consulta de CEP -> resposta bruta do ViaCEP ({logradouro,bairro,localidade,uf,cep} | {erro:true} | null). */
  porCep: (cep) => consultarCep(cep),
  /* REF-DELIVERY-FEE-01: coordenadas de um endereço estruturado que já tem label mas NÃO veio com lat/lng
     (ex.: aba CEP — o ViaCEP não devolve coordenada, ver address/utils/addressModel.js). Geocodifica o
     endereço COMPOSTO (rua+número, bairro, cidade-UF) usando a MESMA cadeia de provedores gratuitos
     (Mapbox/Nominatim/Photon) — nenhum serviço novo, nenhum custo novo. Usado SOMENTE para calcular a
     distância da taxa de entrega; nunca sobrescreve o endereço já selecionado pelo cliente (AddressContext
     continua a única fonte do endereço em si). null quando faltar dado suficiente ou nenhum provedor achar
     nada — o chamador (deliveryFeeRules) trata como "sem coordenadas", nunca lança. */
  coordenadasDe: async (endereco) => {
    if (!endereco) return null;
    if (Number.isFinite(endereco.lat) && Number.isFinite(endereco.lng)) return { lat: endereco.lat, lng: endereco.lng };
    const partes = [
      [endereco.rua, endereco.numero].filter(Boolean).join(', '),
      endereco.bairro,
      [endereco.cidade, endereco.estado].filter(Boolean).join(' - '),
    ].filter(Boolean);
    const query = partes.join(', ');
    if (!query) return null;
    let resultados;
    try { resultados = await waterfallGeocoder.sugestoes(query); } catch { return null; }
    const primeiro = Array.isArray(resultados) ? resultados[0] : null;
    if (!primeiro) return null;
    const lat = parseFloat(primeiro.lat), lng = parseFloat(primeiro.lon);
    return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
  },
};
