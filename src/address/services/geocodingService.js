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
     cadeia que devolver algo não-vazio). */
  sugestoes: (query) => waterfallGeocoder.sugestoes(query),
  /* Reverse-geocode (coordenada -> endereço) -> resposta no shape Nominatim com .address, ou null. */
  reverso: (lat, lng) => waterfallGeocoder.reverso(lat, lng),
  /* Consulta de CEP -> resposta bruta do ViaCEP ({logradouro,bairro,localidade,uf,cep} | {erro:true} | null). */
  porCep: (cep) => consultarCep(cep),
};
