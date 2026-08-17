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
   próximo provedor) sem quebrar a busca.

   REF-ADDRESS-AUTOCOMPLETE-01 (2026-08-17): `sugestoes(query, bias)` passa a usar `bias.lat`/`bias.lng`
   (posição da loja, quando configurada) como viés de proximidade (`&lat=&lon=` — parâmetros nativos do
   Photon). Testado AO VIVO contra a API pública: "Rua Itajaí" sem viés espalha por várias cidades do
   Brasil; com o viés apontando pra Timbó, Timbó sobe pro topo sozinho; e quando o usuário digita outra
   cidade no texto ("Rua Itajaí, Indaial"), a correspondência textual domina o viés geográfico — o
   próprio Photon já resolve os 2 critérios de aceite (prioriza a loja por padrão, cede ao texto
   explícito), sem precisar de nenhuma camada de re-ranking própria. Sem `bias.lat`/`bias.lng` (loja sem
   posição configurada, ex.: tenant novo) a URL fica idêntica à de antes — degradação graciosa, mesmo
   princípio do resto do domínio. */
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
  /* REF-DELIVERY-FEE-02 (auditoria forense): osm_key/osm_value são a classificação REAL da feature no
     OSM (ex.: "waterway"/"river", "highway"/"residential") — mesmo vocabulário do class/type que o
     Nominatim já expõe nativamente. Propagados como campos extra (o código existente já ignora extra —
     ver geocodingService.js) para que enderecoPlausivel.js consiga rejeitar rio/lago/POI/obra sem
     precisar adivinhar a partir do texto do endereço. */
  return { ...item, _provider: 'photon', _confidence: inferirConfidence(item), _osmKey: p.osm_key || '', _osmValue: p.osm_value || '' };
}
function ruaComNumero(a) { return [a.road, a.house_number].filter(Boolean).join(', '); }

export const provider = {
  nome: 'photon',
  /* Sem chave, endpoint público — sempre "disponível" no sentido de configuração (rate-limit/uso
     razoável é tratado pelo try/catch do waterfall, não aqui). */
  disponivel: () => true,
  async sugestoes(query, bias) {
    let url = SEARCH_URL + '?q=' + encodeURIComponent(query) + '&limit=6';
    if (Number.isFinite(bias?.lat) && Number.isFinite(bias?.lng)) {
      url += '&lat=' + bias.lat + '&lon=' + bias.lng;
    }
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
