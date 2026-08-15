/* address/services/geocoding/providers/mapboxProvider.js — REF-ADDRESS-02 · Onda 3.
   Adapter do waterfall para o Mapbox Geocoding API v5 — provedor PRINCIPAL escolhido pelo dono (Free
   Tier, sem assumir plano pago). Fica em MODO DEGRADADO (disponivel()=false, waterfall pula direto para
   o próximo) sem VITE_MAPBOX_TOKEN — mesmo princípio de lib/supabase.js (db=null sem env) e
   lib/dbCliente.js: ausência de configuração nunca quebra o app, só desativa esse degrau da cadeia.

   HONESTIDADE (registrar, não esconder): implementado a partir da documentação pública do Geocoding API
   v5 da Mapbox — NÃO foi possível testar contra a API real nesta referência (não há token/conta neste
   ambiente; criar uma é decisão do dono). O try/catch do waterfallGeocoder isola qualquer divergência de
   formato (cai para Nominatim/Photon) sem quebrar a busca. Primeira ativação real acontece sozinha assim
   que VITE_MAPBOX_TOKEN existir — sem precisar mexer em código. */
import { inferirConfidence } from '../../../utils/addressFormat.js';

const TOKEN = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_MAPBOX_TOKEN) || '';
const BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places/';

/* Feature do Mapbox -> shape canônico Nominatim {address:{...}, display_name, lat, lon}. `context[]` traz
   bairro/cidade/estado/CEP como entradas {id:"tipo.hash", text}; `address` (campo top-level, só em
   features de endereço) é o número da casa — separado de `text` (nome da rua), exatamente a separação
   número/rua que este ADR exige em toda a cadeia. */
export function normalizarFeatureMapbox(feature) {
  const ctx = Array.isArray(feature && feature.context) ? feature.context : [];
  const porTipo = (prefixo) => {
    const found = ctx.find((c) => typeof (c && c.id) === 'string' && c.id.startsWith(prefixo));
    return (found && found.text) || '';
  };
  const address = {
    road: (feature && feature.text) || '',
    house_number: (feature && feature.address) || '',
    suburb: porTipo('neighborhood') || porTipo('locality') || '',
    neighbourhood: '',
    city: porTipo('place') || '',
    town: '',
    municipality: '',
    quarter: '',
    state: porTipo('region') || '',
    postcode: porTipo('postcode') || '',
  };
  const coords = (feature && feature.center) || [];
  const item = {
    address,
    display_name: (feature && feature.place_name) || '',
    lat: coords[1] != null ? String(coords[1]) : '',
    lon: coords[0] != null ? String(coords[0]) : '',
  };
  /* REF-DELIVERY-FEE-02 (auditoria forense): place_type (array, ex.: ["address"], ["poi"],
     ["neighborhood"]) é a classificação REAL de feature do Geocoding API v5 — documentação pública, ver
     header do provider. Propagado como campo extra (mesmo princípio de _osmKey/_osmValue do Photon) pra
     enderecoPlausivel.js distinguir endereço de área geográfica pura (bairro/cidade/região sozinhos). */
  return { ...item, _provider: 'mapbox', _confidence: inferirConfidence(item), _placeType: Array.isArray(feature && feature.place_type) ? feature.place_type : [] };
}

export const provider = {
  nome: 'mapbox',
  disponivel: () => !!TOKEN,
  async sugestoes(query) {
    if (!TOKEN) return [];
    const url = BASE + encodeURIComponent(query) + '.json?access_token=' + TOKEN + '&country=BR&language=pt&limit=6';
    const r = await fetch(url);
    const d = await r.json();
    const feats = Array.isArray(d && d.features) ? d.features : [];
    return feats.map(normalizarFeatureMapbox);
  },
  async reverso(lat, lng) {
    if (!TOKEN) return null;
    const url = BASE + lng + ',' + lat + '.json?access_token=' + TOKEN + '&language=pt';
    const r = await fetch(url);
    const d = await r.json();
    const feat = Array.isArray(d && d.features) ? d.features[0] : null;
    return feat ? normalizarFeatureMapbox(feat) : null;
  },
};
