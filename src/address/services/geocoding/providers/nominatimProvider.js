/* address/services/geocoding/providers/nominatimProvider.js — REF-ADDRESS-02 · Onda 3.
   Adapter do waterfall para o Nominatim: envolve nominatimService.js (INTOCADO — URLs/headers/estratégias
   preservados byte-a-byte, guardado por address.guard.mjs (2)) e só ACRESCENTA a tag _provider/_confidence
   a cada item, no mesmo shape que os outros adapters produzem. Não reimplementa a chamada HTTP. */
import { buscarEnderecos, reverso as reversoNominatim } from '../../nominatimService.js';
import { inferirConfidence } from '../../../utils/addressFormat.js';

function tag(item) {
  return { ...item, _provider: 'nominatim', _confidence: inferirConfidence(item) };
}

export const provider = {
  nome: 'nominatim',
  /* Sem chave, endpoint público — sempre disponível (mesma premissa de hoje). */
  disponivel: () => true,
  async sugestoes(query) {
    const resultados = await buscarEnderecos(query);
    return resultados.map(tag);
  },
  async reverso(lat, lng) {
    const r = await reversoNominatim(lat, lng);
    return r && r.address ? tag(r) : null;
  },
};
