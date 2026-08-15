/* tests/address-geocoding.golden.mjs — REF-ADDRESS-02 · Onda 3 (+ REF-DELIVERY-FEE-02 · auditoria
   forense). Roda: node tests/address-geocoding.golden.mjs (npm run test:address-geocoding). Testa, sem
   rede nenhuma:
     (1) os normalizadores puros de Photon/Mapbox (feature bruta -> shape Nominatim canônico), com
         fixtures representativos dos formatos documentados/observados dos dois provedores;
     (2) a ORQUESTRAÇÃO do waterfall (ordem, pular indisponível, cair em erro, cair em vazio, contrato
         de reverso lançar em falha total) com providers FALSOS injetados via criarWaterfall(providers) —
         mesmo padrão de injeção de dependência já usado em whatsapp-service.golden.mjs (fetch injetado);
     (3) REF-DELIVERY-FEE-02 — o filtro de plausibilidade (enderecoPlausivel.js) e sua integração no
         waterfall: um resultado que não é rua/endereço (rio, POI, obra, área geográfica pura) nunca vira
         coordenada — o waterfall trata como se o provedor tivesse devolvido vazio e cai pro próximo.
         Caso de regressão obrigatório: "Rio Itajaí-Açu" (achado real do pedido deff985b, 2026-08-06) não
         pode ser aceito; a rua real (Rua Itajaí) pode. Genérico — nenhum caso depende de Timbó/Indaial/
         Encanto especificamente (ver também address.guard.mjs invariante (12)). */
import assert from 'node:assert/strict';
import { normalizarFeaturePhoton, provider as photonProvider } from '../src/address/services/geocoding/providers/photonProvider.js';
import { normalizarFeatureMapbox, provider as mapboxProvider } from '../src/address/services/geocoding/providers/mapboxProvider.js';
import { criarWaterfall, ORDEM_PADRAO } from '../src/address/services/geocoding/waterfallGeocoder.js';
import { provider as nominatimProvider } from '../src/address/services/geocoding/providers/nominatimProvider.js';
import { corrigir as corrigirComGazetteer } from '../src/address/services/geocoding/gazetteerCorrector.js';
import { buscarEnderecos, _limparCacheNominatim } from '../src/address/services/nominatimService.js';
import { resultadoEhEnderecoPlausivel } from '../src/address/services/geocoding/enderecoPlausivel.js';

let fail = 0;
const check = async (m, fn) => { try { await fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

/* ── Normalizador Photon (fixture representativo do shape observado ao vivo na Onda 0/ADR §0.2) ── */
await check('normalizarFeaturePhoton: feature de rua (com número) -> exact', () => {
  const feature = {
    properties: { name: 'Rua João Schlei', housenumber: '123', district: 'Araponguinhas', city: 'Timbó', state: 'Santa Catarina', postcode: '89120-000' },
    geometry: { coordinates: [-49.2880533, -26.8509174] },
  };
  const r = normalizarFeaturePhoton(feature);
  assert.deepEqual(r.address, {
    road: 'Rua João Schlei', house_number: '123', suburb: 'Araponguinhas', neighbourhood: '',
    city: 'Timbó', town: '', municipality: '', quarter: '', state: 'Santa Catarina', postcode: '89120-000',
  });
  assert.equal(r.lat, '-26.8509174');
  assert.equal(r.lon, '-49.2880533');
  assert.equal(r._provider, 'photon');
  assert.equal(r._confidence, 'exact');
  assert.ok(r.display_name.includes('Rua João Schlei'));
});
await check('normalizarFeaturePhoton: feature só de rua (sem número, caso real do achado Amazonas 533) -> street_level', () => {
  const feature = { properties: { name: 'Rua Amazonas', city: 'Timbó', state: 'Santa Catarina', postcode: '89120-000' }, geometry: { coordinates: [-49.2782696, -26.8438248] } };
  const r = normalizarFeaturePhoton(feature);
  assert.equal(r.address.house_number, '');
  assert.equal(r._confidence, 'street_level');
});
await check('normalizarFeaturePhoton: feature vazia/sem coordenadas não quebra -> approximate', () => {
  const r = normalizarFeaturePhoton({});
  assert.equal(r.address.road, '');
  assert.equal(r.lat, '');
  assert.equal(r._confidence, 'approximate');
});

/* ── Normalizador Mapbox (fixture do shape documentado da Geocoding API v5 — NÃO verificado ao vivo, ver header do provider) ── */
await check('normalizarFeatureMapbox: feature de endereço (com address=número) -> exact', () => {
  const feature = {
    text: 'Rua João Schlei', address: '123', place_name: 'Rua João Schlei 123, Timbó, Santa Catarina, Brasil',
    center: [-49.2880533, -26.8509174],
    context: [{ id: 'neighborhood.123', text: 'Araponguinhas' }, { id: 'place.456', text: 'Timbó' }, { id: 'region.789', text: 'Santa Catarina' }, { id: 'postcode.111', text: '89120-000' }],
  };
  const r = normalizarFeatureMapbox(feature);
  assert.deepEqual(r.address, {
    road: 'Rua João Schlei', house_number: '123', suburb: 'Araponguinhas', neighbourhood: '',
    city: 'Timbó', town: '', municipality: '', quarter: '', state: 'Santa Catarina', postcode: '89120-000',
  });
  assert.equal(r.lat, '-26.8509174');
  assert.equal(r.lon, '-49.2880533');
  assert.equal(r._provider, 'mapbox');
  assert.equal(r._confidence, 'exact');
});
await check('normalizarFeatureMapbox: feature só de rua (sem campo address) -> street_level', () => {
  const feature = { text: 'Rua Amazonas', place_name: 'Rua Amazonas, Timbó, Santa Catarina, Brasil', center: [-49.2782696, -26.8438248], context: [{ id: 'place.456', text: 'Timbó' }] };
  const r = normalizarFeatureMapbox(feature);
  assert.equal(r.address.house_number, '');
  assert.equal(r._confidence, 'street_level');
});
await check('normalizarFeatureMapbox: feature vazia não quebra', () => {
  const r = normalizarFeatureMapbox({});
  assert.equal(r.address.road, '');
  assert.equal(r._confidence, 'approximate');
});

/* ── Providers reais: disponibilidade/nome (estrutural, sem rede) ── */
await check('providers reais: nome + disponibilidade correta (nominatim/photon sempre; mapbox só com token)', () => {
  assert.equal(nominatimProvider.nome, 'nominatim');
  assert.equal(nominatimProvider.disponivel(), true);
  assert.equal(photonProvider.nome, 'photon');
  assert.equal(photonProvider.disponivel(), true);
  assert.equal(mapboxProvider.nome, 'mapbox');
  assert.equal(mapboxProvider.disponivel(), false); // sem VITE_MAPBOX_TOKEN neste ambiente de teste
});
await check('ORDEM_PADRAO = [mapbox, nominatim, photon] (decisão do dono: Mapbox principal, fallback gratuito)', () => {
  assert.deepEqual(ORDEM_PADRAO.map((p) => p.nome), ['mapbox', 'nominatim', 'photon']);
});

/* ── Orquestração do waterfall (providers FALSOS injetados — zero rede) ── */
const fakeProvider = (nome, { disponivel = true, sugestoesFn, reversoFn } = {}) => ({
  nome, disponivel: () => disponivel,
  sugestoes: sugestoesFn || (async () => []),
  reverso: reversoFn || (async () => null),
});

await check('waterfall.sugestoes: usa o 1º provedor que devolve algo não-vazio, não chama os seguintes', async () => {
  let chamouB = false;
  const a = fakeProvider('a', { sugestoesFn: async () => [{ address: { road: 'X' } }] });
  const b = fakeProvider('b', { sugestoesFn: async () => { chamouB = true; return [{ address: { road: 'Y' } }]; } });
  const r = await criarWaterfall([a, b]).sugestoes('q');
  assert.equal(r.length, 1);
  assert.equal(r[0].address.road, 'X');
  assert.equal(chamouB, false);
});
await check('waterfall.sugestoes: pula provedor indisponível', async () => {
  const a = fakeProvider('a', { disponivel: false, sugestoesFn: async () => { throw new Error('não deveria ser chamado'); } });
  const b = fakeProvider('b', { sugestoesFn: async () => [{ address: { road: 'Y' } }] });
  const r = await criarWaterfall([a, b]).sugestoes('q');
  assert.equal(r[0].address.road, 'Y');
});
await check('waterfall.sugestoes: provedor que lança erro não quebra a cadeia — tenta o próximo', async () => {
  const a = fakeProvider('a', { sugestoesFn: async () => { throw new Error('falha de rede simulada'); } });
  const b = fakeProvider('b', { sugestoesFn: async () => [{ address: { road: 'Y' } }] });
  const r = await criarWaterfall([a, b]).sugestoes('q');
  assert.equal(r[0].address.road, 'Y');
});
await check('waterfall.sugestoes: provedor que devolve vazio -> tenta o próximo', async () => {
  const a = fakeProvider('a', { sugestoesFn: async () => [] });
  const b = fakeProvider('b', { sugestoesFn: async () => [{ address: { road: 'Y' } }] });
  const r = await criarWaterfall([a, b]).sugestoes('q');
  assert.equal(r[0].address.road, 'Y');
});
await check('waterfall.sugestoes (REF-SAAS-01 Onda 6.3): propaga bias {cidade,estado} pra cada provider chamado', async () => {
  const biasRecebidos = [];
  const a = fakeProvider('a', { sugestoesFn: async (q, bias) => { biasRecebidos.push(bias); return []; } });
  const b = fakeProvider('b', { sugestoesFn: async (q, bias) => { biasRecebidos.push(bias); return [{ address: { road: 'Y' } }]; } });
  await criarWaterfall([a, b]).sugestoes('q', { cidade: 'Blumenau', estado: 'SC' });
  assert.deepEqual(biasRecebidos, [{ cidade: 'Blumenau', estado: 'SC' }, { cidade: 'Blumenau', estado: 'SC' }]);
});
await check('waterfall.sugestoes: todos vazios/indisponíveis -> [] (nunca lança — mesmo contrato de buscarEnderecos)', async () => {
  const a = fakeProvider('a', { sugestoesFn: async () => [] });
  const b = fakeProvider('b', { disponivel: false });
  const r = await criarWaterfall([a, b]).sugestoes('q');
  assert.deepEqual(r, []);
});
await check('waterfall.reverso: usa o 1º provedor com resultado válido (.address presente)', async () => {
  const a = fakeProvider('a', { reversoFn: async () => null });
  const b = fakeProvider('b', { reversoFn: async () => ({ address: { road: 'Y' } }) });
  const r = await criarWaterfall([a, b]).reverso(1, 2);
  assert.equal(r.address.road, 'Y');
});
await check('waterfall.reverso: TODOS falham -> LANÇA (preserva o contrato de nominatimService.reverso; confirmMap depende disso sem try/catch próprio)', async () => {
  const a = fakeProvider('a', { reversoFn: async () => { throw new Error('rede fora'); } });
  const b = fakeProvider('b', { reversoFn: async () => null });
  await assert.rejects(() => criarWaterfall([a, b]).reverso(1, 2));
});

/* ── REF-ADDRESS-02 · Onda 4 — 2ª rodada via gazetteerCorrector (D-GAZETTEER-ORDER), corrigirFn injetado ── */
await check('waterfall.sugestoes: 1ª rodada com resultado -> NUNCA chama o corretor (D-GAZETTEER-ORDER)', async () => {
  let chamouCorretor = false;
  const a = fakeProvider('a', { sugestoesFn: async () => [{ address: { road: 'X' } }] });
  const corrigirFalso = async (q) => { chamouCorretor = true; return q; };
  await criarWaterfall([a], corrigirFalso).sugestoes('rua x');
  assert.equal(chamouCorretor, false);
});
await check('waterfall.sugestoes: 1ª rodada vazia + corretor acha nome diferente -> 2ª rodada com o nome corrigido', async () => {
  const chamadas = [];
  const a = fakeProvider('a', {
    sugestoesFn: async (q) => { chamadas.push(q); return q === 'Rua João Schlei' ? [{ address: { road: 'Rua João Schlei' } }] : []; },
  });
  const corrigirFalso = async (q) => (q === 'Rua Joao Schlay' ? 'Rua João Schlei' : q);
  const r = await criarWaterfall([a], corrigirFalso).sugestoes('Rua Joao Schlay');
  assert.deepEqual(chamadas, ['Rua Joao Schlay', 'Rua João Schlei']);
  assert.equal(r[0].address.road, 'Rua João Schlei');
});
await check('waterfall.sugestoes: corretor não acha nada melhor (devolve a mesma query) -> não repete a chamada, devolve []', async () => {
  let vezes = 0;
  const a = fakeProvider('a', { sugestoesFn: async () => { vezes++; return []; } });
  const corrigirFalso = async (q) => q; // sem correção
  const r = await criarWaterfall([a], corrigirFalso).sugestoes('endereço inexistente');
  assert.deepEqual(r, []);
  assert.equal(vezes, 1); // não tenta de novo com a MESMA query
});
await check('waterfall.sugestoes (REF-SAAS-01 Onda 6.3): propaga bias.cidade pro corretor do gazetteer (parametro que ja existia, nunca antes preenchido)', async () => {
  let cidadeRecebida = 'NAO CHAMADO';
  const a = fakeProvider('a', { sugestoesFn: async () => [] });
  const corrigirFalso = async (q, opts) => { cidadeRecebida = opts?.cidade; return q; };
  await criarWaterfall([a], corrigirFalso).sugestoes('endereço inexistente', { cidade: 'Blumenau', estado: 'SC' });
  assert.equal(cidadeRecebida, 'Blumenau');
});
await check('waterfall.sugestoes (REF-SAAS-01 Onda 6.3): sem bias -> corretor recebe cidade:null (comportamento anterior preservado)', async () => {
  let cidadeRecebida = 'NAO CHAMADO';
  const a = fakeProvider('a', { sugestoesFn: async () => [] });
  const corrigirFalso = async (q, opts) => { cidadeRecebida = opts?.cidade; return q; };
  await criarWaterfall([a], corrigirFalso).sugestoes('endereço inexistente');
  assert.equal(cidadeRecebida, null);
});
await check('waterfall real (instância default) usa gazetteerCorrector real como corrigirFn padrão', async () => {
  const a = fakeProvider('a', { sugestoesFn: async () => [] });
  // sem injetar corrigirFn -> usa o default (gazetteerCorrector real); sem db (env de teste), corrigir()
  // devolve a query intacta por design (graceful degradation) -> resultado permanece []
  const r = await criarWaterfall([a]).sugestoes('qualquer coisa');
  assert.deepEqual(r, []);
});

/* ── nominatimService.buscarEnderecos (REF-SAAS-01 · Onda 6.3) — fetch mockado, zero rede real.
   Prova que o viés de cidade/estado (antes hardcoded "Timbó"/"SC") agora vem do argumento, e que a
   Encanto (cidade='Timbó', estado='SC') continua montando a URL byte-idêntica de antes na estratégia 1. ── */
const fetchOriginal = globalThis.fetch;
function mockFetch(respostas) {
  const urls = []; let i = 0;
  globalThis.fetch = async (url) => { urls.push(url); return { json: async () => (respostas[i++] ?? []) }; };
  return urls;
}

await check('buscarEnderecos: com {cidade,estado} da Encanto -> estratégia 1 byte-idêntica ao sufixo hardcoded anterior', async () => {
  _limparCacheNominatim();
  const urls = mockFetch([[{ address: { road: 'Rua X' } }]]);
  try {
    await buscarEnderecos('Rua X 100', { cidade: 'Timbó', estado: 'SC' });
    assert.ok(urls[0].includes(encodeURIComponent('Rua X 100, Timbó, SC, Brasil')), 'sufixo de cidade/estado/Brasil ausente ou diferente');
    assert.equal(urls.length, 1, 'estratégia 1 já achou algo — não deveria tentar as demais');
  } finally { globalThis.fetch = fetchOriginal; }
});
await check('buscarEnderecos: sem bias (loja nova, sem endereço institucional) -> busca nacional pura, sem sufixo de cidade', async () => {
  _limparCacheNominatim();
  const urls = mockFetch([[]]);
  try {
    await buscarEnderecos('Rua X 100');
    assert.ok(!urls[0].includes('Timb') && !urls[0].includes('%2C+SC') && !urls[0].includes(', SC'), 'não deveria sobrar nenhum resquício de cidade/estado na URL');
    assert.equal(urls.length, 1, 'sem cidade, só a estratégia 1 existe (2 e 3 exigem cidade para fazer sentido)');
  } finally { globalThis.fetch = fetchOriginal; }
});
await check('buscarEnderecos: estratégia 2 (estruturada, precisa de número) usa city=/state= com o valor informado — não mais "Santa+Catarina" fixo', async () => {
  _limparCacheNominatim();
  const urls = mockFetch([[], [{ address: { road: 'Rua X', house_number: '100' } }]]); // estratégia 1 vazia -> tenta a 2
  try {
    await buscarEnderecos('Rua X 100', { cidade: 'Timbó', estado: 'SC' });
    assert.equal(urls.length, 2);
    assert.ok(urls[1].includes('city=' + encodeURIComponent('Timbó')), 'city= deveria usar a cidade informada');
    assert.ok(urls[1].includes('state=SC'), 'state= deveria usar o estado informado (UF, não mais nome completo hardcoded)');
  } finally { globalThis.fetch = fetchOriginal; }
});
await check('buscarEnderecos: cache agora é chaveado por query+cidade+estado (a mesma query com viés diferente não reaproveita o cache da outra loja)', async () => {
  _limparCacheNominatim();
  mockFetch([[{ address: { road: 'A' } }]]);
  const r1 = await buscarEnderecos('Rua X 100', { cidade: 'Timbó', estado: 'SC' });
  const urls2 = mockFetch([[{ address: { road: 'B' } }]]);
  const r2 = await buscarEnderecos('Rua X 100', { cidade: 'Blumenau', estado: 'SC' });
  try {
    assert.equal(r1[0].address.road, 'A');
    assert.equal(r2[0].address.road, 'B');   // não veio do cache da 1ª loja
    assert.equal(urls2.length, 1, 'a 2ª chamada (viés diferente) precisou buscar de novo, não usou o cache');
  } finally { globalThis.fetch = fetchOriginal; }
});

/* ── gazetteerCorrector: degradação graciosa sem banco (ambiente de teste = db null) ── */
await check('gazetteerCorrector.corrigir: sem banco (env de teste) devolve a query intacta, nunca lança', async () => {
  assert.equal(await corrigirComGazetteer('Rua Joao Schlay'), 'Rua Joao Schlay');
  assert.equal(await corrigirComGazetteer(''), '');
  assert.equal(await corrigirComGazetteer('ab'), 'ab'); // curta demais, nem tentaria a RPC
});

/* ── REF-DELIVERY-FEE-02 (auditoria forense) — normalizadores propagam a classificação REAL da feature,
   necessária pro filtro de plausibilidade. Campos extra (código existente já ignora extra). ── */
await check('normalizarFeaturePhoton: propaga _osmKey/_osmValue reais da feature (osm_key/osm_value)', () => {
  const rio = { properties: { name: 'Rio Itajaí-Açu', osm_key: 'waterway', osm_value: 'river', district: 'Rio Morto', city: 'Indaial', state: 'Santa Catarina' }, geometry: { coordinates: [-49.2513215, -26.9008877] } };
  const r = normalizarFeaturePhoton(rio);
  assert.equal(r._osmKey, 'waterway');
  assert.equal(r._osmValue, 'river');
});
await check('normalizarFeaturePhoton: feature sem osm_key/osm_value -> campos extra ficam vazios (nunca undefined)', () => {
  const r = normalizarFeaturePhoton({ properties: { name: 'Rua X' }, geometry: { coordinates: [0, 0] } });
  assert.equal(r._osmKey, '');
  assert.equal(r._osmValue, '');
});
await check('normalizarFeatureMapbox: propaga _placeType real (feature.place_type)', () => {
  const feature = { place_type: ['address'], text: 'Rua X', center: [0, 0] };
  const r = normalizarFeatureMapbox(feature);
  assert.deepEqual(r._placeType, ['address']);
});
await check('normalizarFeatureMapbox: sem place_type -> _placeType = [] (nunca undefined)', () => {
  const r = normalizarFeatureMapbox({ text: 'Rua X', center: [0, 0] });
  assert.deepEqual(r._placeType, []);
});

/* ── REF-DELIVERY-FEE-02 — resultadoEhEnderecoPlausivel: unidade, provider-agnóstico, sem depender de
   nenhuma cidade/loja específica (fixtures usam nomes fictícios de propósito). ── */
await check('(A) rua plausível (Nominatim: class=highway/type=residential/addresstype=road) -> aceita', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'Rua das Acácias' }, class: 'highway', type: 'residential', addresstype: 'road' }), true);
});
await check('(B) endereço com casa plausível (class=building) -> aceita', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'Rua das Acácias', house_number: '42' }, class: 'building', type: 'house' }), true);
});
await check('(C) rio (Nominatim class=waterway OU Photon _osmKey=waterway) -> rejeita', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'Rio Fictício' }, class: 'waterway', type: 'river' }), false);
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'Rio Fictício' }, _provider: 'photon', _osmKey: 'waterway', _osmValue: 'river' }), false);
});
await check('(D) ponto turístico (class=tourism) -> rejeita', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'Mirante Fictício' }, class: 'tourism', type: 'viewpoint' }), false);
});
await check('(E) POI sem contexto de rua (class=amenity, address.road vazio) -> rejeita', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: '' }, class: 'amenity', type: 'restaurant' }), false);
});
await check('(E2) estabelecimento COM endereço apropriado (class=shop + address.road preenchido) -> aceita', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'Rua Comercial Fictícia' }, class: 'shop', type: 'supermarket' }), true);
});
await check('(F) resultado sem tipo útil (sem class/type nenhum) -> decide só pelo contexto de rua', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'Rua Sem Classificação' } }), true);
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: '' } }), false);
  assert.equal(resultadoEhEnderecoPlausivel({ address: {} }), false);
});
await check('(G) entradas degeneradas (null/undefined/objeto vazio) nunca lançam -> rejeita', () => {
  assert.equal(resultadoEhEnderecoPlausivel(null), false);
  assert.equal(resultadoEhEnderecoPlausivel(undefined), false);
  assert.equal(resultadoEhEnderecoPlausivel({}), false);
});
await check('lago/montanha/obra/lazer/fronteira administrativa (classes OSM adicionais da auditoria) -> rejeita', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'X' }, class: 'natural', type: 'water' }), false);       // lago
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'X' }, class: 'natural', type: 'peak' }), false);        // montanha
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'X' }, class: 'man_made', type: 'works' }), false);      // obra
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'X' }, class: 'leisure', type: 'park' }), false);        // lazer
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'X' }, class: 'boundary', type: 'administrative' }), false); // fronteira
});
await check('área geográfica pura (class=place, type=city/suburb) -> rejeita; class=place/type=house -> aceita', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: '' }, class: 'place', type: 'city' }), false);
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: '' }, class: 'place', type: 'suburb' }), false);
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'Rua X' }, class: 'place', type: 'house' }), true);
});
await check('Mapbox: place_type=["address"] sempre aceita; ["neighborhood"]/["place"]/["region"] sozinhos rejeitam', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ _provider: 'mapbox', address: { road: '' }, _placeType: ['address'] }), true);
  assert.equal(resultadoEhEnderecoPlausivel({ _provider: 'mapbox', address: { road: 'Bairro Fictício' }, _placeType: ['neighborhood'] }), false);
  assert.equal(resultadoEhEnderecoPlausivel({ _provider: 'mapbox', address: { road: '' }, _placeType: ['place'] }), false);
});
await check('Mapbox: place_type=["poi"] só aceita com contexto de rua', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ _provider: 'mapbox', address: { road: '' }, _placeType: ['poi'] }), false);
  assert.equal(resultadoEhEnderecoPlausivel({ _provider: 'mapbox', address: { road: 'Rua Comercial Fictícia' }, _placeType: ['poi'] }), true);
});

/* ── REF-DELIVERY-FEE-02 — CASO DE REGRESSÃO OBRIGATÓRIO: fixture real do pedido deff985b (2026-08-06).
   "Rio Itajaí-Açu" (1º resultado real do Photon pra "Rua Itajaí, 157, Rio Morto, Indaial - SC" no
   cenário histórico) NUNCA pode ser aceito; a Rua Itajaí real (2º resultado real do Photon, mesma
   query) pode. Fixtures = payload REAL capturado no replay ao vivo da auditoria, não inventado. ── */
await check('REGRESSÃO deff985b: "Rio Itajaí-Açu" (Photon) é rejeitado', () => {
  const rio = normalizarFeaturePhoton({
    properties: { name: 'Rio Itajaí-Açu', osm_key: 'waterway', osm_value: 'river', district: 'Rio Morto', city: 'Indaial', state: 'Santa Catarina' },
    geometry: { coordinates: [-49.2513215, -26.9008877] },
  });
  assert.equal(resultadoEhEnderecoPlausivel(rio), false, 'o rio homônimo NUNCA pode virar coordenada de entrega');
});
await check('REGRESSÃO deff985b: "Rua Itajaí" real (Photon, mesma query) é aceita', () => {
  const rua = normalizarFeaturePhoton({
    properties: { name: 'Rua Itajaí', street: 'Rua Itajaí', osm_key: 'highway', osm_value: 'residential', district: 'Rio Morto', city: 'Indaial', state: 'Santa Catarina', postcode: '89082-415' },
    geometry: { coordinates: [-49.2570131, -26.8959635] },
  });
  assert.equal(resultadoEhEnderecoPlausivel(rua), true, 'a rua real deve continuar aceitável mesmo sem o número 157');
});
await check('REGRESSÃO deff985b (integração no waterfall): Photon devolve [rio, rua] -> waterfall filtra o rio, sobra só a rua real', async () => {
  const rio = normalizarFeaturePhoton({
    properties: { name: 'Rio Itajaí-Açu', osm_key: 'waterway', osm_value: 'river', city: 'Indaial', state: 'Santa Catarina' },
    geometry: { coordinates: [-49.2513215, -26.9008877] },
  });
  const rua = normalizarFeaturePhoton({
    properties: { name: 'Rua Itajaí', street: 'Rua Itajaí', osm_key: 'highway', osm_value: 'residential', city: 'Indaial', state: 'Santa Catarina' },
    geometry: { coordinates: [-49.2570131, -26.8959635] },
  });
  const fotonFalso = { nome: 'photon', disponivel: () => true, sugestoes: async () => [rio, rua], reverso: async () => null };
  const r = await criarWaterfall([fotonFalso]).sugestoes('Rua Itajaí, 157, Rio Morto, Indaial - SC');
  assert.equal(r.length, 1, 'o rio deve ser filtrado, só a rua real sobra');
  assert.equal(r[0].address.road, 'Rua Itajaí');
  assert.equal(r[0].lat, '-26.8959635');
});

/* ── REF-DELIVERY-FEE-02 — (H)/(I)/(J)/(K) integração no waterfall, genérico (sem Timbó/Indaial/Encanto) ── */
await check('(H) provedor A só devolve resultado implausível -> waterfall cai pro provedor B (fallback)', async () => {
  let chamouB = false;
  const a = { nome: 'a', disponivel: () => true, sugestoes: async () => [{ address: { road: 'Rio Genérico' }, class: 'waterway', type: 'river' }], reverso: async () => null };
  const b = { nome: 'b', disponivel: () => true, sugestoes: async () => { chamouB = true; return [{ address: { road: 'Rua Genérica' }, class: 'highway', type: 'residential' }]; }, reverso: async () => null };
  const r = await criarWaterfall([a, b]).sugestoes('q');
  assert.equal(chamouB, true, 'provedor A só com resultado implausível deve contar como vazio e acionar o fallback');
  assert.equal(r[0].address.road, 'Rua Genérica');
});
await check('(I) NENHUM provedor encontra resultado plausível -> [] final (nunca lança, nunca aceita o implausível)', async () => {
  const a = { nome: 'a', disponivel: () => true, sugestoes: async () => [{ address: { road: 'X' }, class: 'tourism', type: 'attraction' }], reverso: async () => null };
  const b = { nome: 'b', disponivel: () => true, sugestoes: async () => [{ address: { road: 'Y' }, class: 'natural', type: 'peak' }], reverso: async () => null };
  const r = await criarWaterfall([a, b]).sugestoes('q');
  assert.deepEqual(r, []);
});
await check('(J) endereço em outra cidade (fixture genérica, cidade fictícia) -> rua plausível é aceita normalmente', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'Rua da Cidade Fictícia', city: 'Cidade Qualquer' }, class: 'highway', type: 'residential' }), true);
});
await check('(K) endereço em outro estado (fixture genérica, UF fictícia) -> rua plausível é aceita normalmente', () => {
  assert.equal(resultadoEhEnderecoPlausivel({ address: { road: 'Rua do Estado Fictício', state: 'Estado Qualquer' }, class: 'highway', type: 'residential' }), true);
});

console.log(fail === 0
  ? '\nOK address-geocoding.golden — normalizadores Photon/Mapbox + orquestração do waterfall + filtro de plausibilidade (sem rede)'
  : `\nFALHA address-geocoding.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
