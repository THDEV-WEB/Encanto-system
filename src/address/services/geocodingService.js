/* address/services/geocodingService.js — REF-ADDRESS-01.
   FACADE de geocoding do domínio Address: ponto ÚNICO por onde passam busca de endereço, reverse-geocode
   e consulta de CEP. Desacopla a aplicação do provedor concreto (hoje Nominatim + ViaCEP) — trocar/
   acrescentar provedor no futuro (rotas, mapas avançados) muda só aqui, não os componentes/hooks.
   Camada de I/O pura (sem React). Não formata nem normaliza (isso é responsabilidade de utils/) — só
   coordena o provedor, preservando exatamente os contratos das chamadas originais. */

import { buscarEnderecos, reverso } from './nominatimService.js';
import { consultarCep } from './viaCepService.js';

export const geocoding = {
  /* Busca por texto (geocoding direto) -> array bruto de resultados (deduplicado pelo provedor). */
  sugestoes: (query) => buscarEnderecos(query),
  /* Reverse-geocode (coordenada -> endereço) -> resposta bruta com .address. */
  reverso: (lat, lng) => reverso(lat, lng),
  /* Consulta de CEP -> resposta bruta do ViaCEP ({logradouro,bairro,localidade,uf,cep} | {erro:true} | null). */
  porCep: (cep) => consultarCep(cep),
};
