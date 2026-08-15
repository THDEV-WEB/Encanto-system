/* address/services/geocoding/enderecoPlausivel.js — REF-DELIVERY-FEE-02 (auditoria forense).
   Filtro de PLAUSIBILIDADE: um resultado de geocoding só pode virar coordenada de entrega se
   representar rua/casa/edifício de verdade — nunca rio, lago, córrego, montanha, ponto turístico, obra,
   área de lazer, fronteira administrativa ou área geográfica pura (cidade/bairro sem rua). Motivou esta
   REF: pedido real (2026-08-06, deff985b) onde o Photon devolveu "Rio Itajaí-Açu" como 1º resultado
   para "Rua Itajaí, 157" e coordenadasDe() aceitou sem checar — Haversine calculou a distância até o
   RIO, não até a rua, gerando R$14 de taxa em vez do valor correto.

   Pura (sem IO/React) — usada pelo waterfall para DESCARTAR um resultado ruim, nunca para "consertar"
   um endereço. Descartar aqui faz o próprio waterfall tratar o provedor como se tivesse devolvido vazio
   e cair pro próximo da cadeia (mesma lógica já usada para provedor indisponível/erro/vazio).

   Nominatim e Photon são os dois baseados em OSM e falam o MESMO vocabulário de classificação
   (class/type no Nominatim; osm_key/osm_value no Photon, propagados por photonProvider.js) — por isso a
   negação abaixo cobre os dois com uma lista só. Mapbox usa outro vocabulário (place_type do Geocoding
   API v5, propagado por mapboxProvider.js) e é tratado à parte. Nenhuma referência a loja/cidade
   específica — a mesma regra vale para qualquer tenant, qualquer endereço. */

/* class (Nominatim) / osm_key (Photon) que NUNCA podem virar coordenada de entrega, mesmo que o
   resultado venha com display_name/road parecendo um endereço. */
const CLASSES_OSM_REJEITADAS = new Set([
  'waterway',  // rio, córrego, canal, riacho
  'natural',   // montanha, lago, mata, praia, cume
  'tourism',   // ponto turístico (mirante, atração, hotel)
  'man_made',  // obra/estrutura (poste, torre, reservatório)
  'leisure',   // parque, clube, estádio, praça de lazer
  'boundary',  // fronteira/limite administrativo
]);

/* class='place' é ambíguo no Nominatim: cobre desde "house" (ponto de endereço válido) até "city"/
   "country" (área geográfica pura demais para localizar uma entrega). Só os tipos amplos abaixo são
   rejeitados; os demais (house, ...) seguem para a checagem de contexto de rua. */
const PLACE_TYPES_AMPLOS_DEMAIS = new Set([
  'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter',
  'county', 'state', 'country', 'region', 'municipality', 'borough', 'island',
]);

function classeOuTipoRejeitados(classe, tipo) {
  if (classe && CLASSES_OSM_REJEITADAS.has(classe)) return true;
  if (classe === 'place' && PLACE_TYPES_AMPLOS_DEMAIS.has(tipo)) return true;
  return false;
}

/* place_type (Mapbox v5, array) — só 'address' é sempre aceito de cara. 'poi' varia MUITO (pode ser uma
   loja endereçável ou um mirante) — só aceito se vier com contexto de rua (address.road), igual à regra
   de "estabelecimento sem endereço apropriado" pedida na auditoria. Os demais (neighborhood/place/
   region/postcode/country) são área geográfica pura — sempre rejeitados aqui. */
function mapboxEhPlausivel(item, temRua) {
  const tipos = Array.isArray(item._placeType) ? item._placeType : [];
  if (tipos.includes('address')) return true;
  if (tipos.includes('poi')) return temRua;
  if (tipos.length > 0) return false; // neighborhood/place/region/postcode/country sozinho = área demais
  return temRua; // sem place_type conhecido (fixture antiga/defensivo): decide só pelo contexto de rua
}

/* Resultado (shape canônico Nominatim: {address:{road,...}, display_name, lat, lon, ...}) é plausível
   como endereço de entrega? Não exige número de casa (nem todo provedor tem esse nível de precisão) —
   só exige NÃO ser uma feature geográfica/natural/turística/administrativa E ter pelo menos contexto de
   rua (address.road). */
export function resultadoEhEnderecoPlausivel(item) {
  if (!item || typeof item !== 'object') return false;
  const endereco = item.address || {};
  const temRua = typeof endereco.road === 'string' && endereco.road.trim().length > 0;

  if (item._provider === 'mapbox') return mapboxEhPlausivel(item, temRua);

  /* Nominatim: class/type nativos. Photon: osm_key/osm_value (mesmo vocabulário OSM), propagados por
     normalizarFeaturePhoton como campos extra — nunca sobrescreve class/type se por acaso existirem. */
  const classe = item.class || item._osmKey || '';
  const tipo = item.type || item._osmValue || '';
  if (classeOuTipoRejeitados(classe, tipo)) return false;

  return temRua;
}
