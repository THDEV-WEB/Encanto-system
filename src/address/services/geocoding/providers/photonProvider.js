/* address/services/geocoding/providers/photonProvider.js — REF-ADDRESS-02 · Onda 3.
   Adapter do waterfall para o Photon (Komoot) — mesmo dado do OpenStreetMap que o Nominatim, mas com
   busca tolerante a erro por cima. Foi exatamente este provedor que, na Onda 0 (diagnóstico ao vivo,
   ADR §0.2), achou "Rua João Schlei" a partir de "Rua João Schlay" — o Nominatim cru devolvia 0
   resultados nas mesmas queries. Instância pública demo (sem chave), "uso razoável" — por isso entra
   DEPOIS do Nominatim no waterfall padrão: só é chamado quando o Nominatim não encontra nada.

   IMPORTANTE (honestidade): o endpoint de busca (`/api/`) foi testado AO VIVO nesta referência (ADR §0.2)
   e o parâmetro `lang=pt` retornou HTTP 400 nesse teste — por isso NÃO é enviado aqui. O endpoint de
   reverse-geocode (`/reverse`) segue a documentação pública do Photon mas NÃO foi exercitado ao vivo
   nesta referência; se o formato divergir, o try/catch do waterfallGeocoder isola a falha (cai para o
   próximo provedor) sem quebrar a busca. */
import { inferirConfidence } from '../../../utils/addressFormat.js';

const SEARCH_URL = 'https://photon.komoot.io/api/';
const REVERSE_URL = 'https://photon.komoot.io/reverse';

/* GeoJSON feature (Photon) -> shape canônico Nominatim {address:{...}, display_name, lat, lon}, para que
   normalizarEndereco/sugestaoMain/etc. (addressFormat.js) processem qualquer provedor sem mudar nada. */
export function normalizarFeaturePhoton(feature) {
  const p = (feature && feature.properties) || {};
  const coords = (feature && feature.geometry && feature.geometry.coordinates) || [];
  const address = {
    road: p.street || p.name || '',
    house_number: p.housenumber || '',
    suburb: p.district || '',
    neighbourhood: '',
    city: p.city || '',
    town: '',
    municipality: '',
    quarter: '',
    state: p.state || '',
    postcode: p.postcode || '',
  };
  const partes = [ruaComNumero(address), address.suburb, address.city, address.state].filter(Boolean);
  const item = {
    address,
    display_name: partes.join(', ') || p.name || '',
    lat: coords[1] != null ? String(coords[1]) : '',
    lon: coords[0] != null ? String(coords[0]) : '',
  };
  return { ...item, _provider: 'photon', _confidence: inferirConfidence(item) };
}
function ruaComNumero(a) { return [a.road, a.house_number].filter(Boolean).join(', '); }

export const provider = {
  nome: 'photon',
  /* Sem chave, endpoint público — sempre "disponível" no sentido de configuração (rate-limit/uso
     razoável é tratado pelo try/catch do waterfall, não aqui). */
  disponivel: () => true,
  async sugestoes(query) {
    const url = SEARCH_URL + '?q=' + encodeURIComponent(query) + '&limit=6';
    const r = await fetch(url);
    const d = await r.json();
    const feats = Array.isArray(d && d.features) ? d.features : [];
    return feats.map(normalizarFeaturePhoton);
  },
  async reverso(lat, lng) {
    const url = REVERSE_URL + '?lat=' + lat + '&lon=' + lng;
    const r = await fetch(url);
    const d = await r.json();
    const feat = Array.isArray(d && d.features) ? d.features[0] : null;
    return feat ? normalizarFeaturePhoton(feat) : null;
  },
};
