/* tests/address-geocoding.golden.mjs — REF-ADDRESS-02 · Onda 3. Roda: node tests/address-geocoding.golden.mjs
   (npm run test:address-geocoding). Testa, sem rede nenhuma:
     (1) os normalizadores puros de Photon/Mapbox (feature bruta -> shape Nominatim canônico), com
         fixtures representativos dos formatos documentados/observados dos dois provedores;
     (2) a ORQUESTRAÇÃO do waterfall (ordem, pular indisponível, cair em erro, cair em vazio, contrato
         de reverso lançar em falha total) com providers FALSOS injetados via criarWaterfall(providers) —
         mesmo padrão de injeção de dependência já usado em whatsapp-service.golden.mjs (fetch injetado). */
import assert from 'node:assert/strict';
import { normalizarFeaturePhoton } from '../src/address/services/geocoding/providers/photonProvider.js';
import { normalizarFeatureMapbox } from '../src/address/services/geocoding/providers/mapboxProvider.js';
import { criarWaterfall, ORDEM_PADRAO } from '../src/address/services/geocoding/waterfallGeocoder.js';
import { provider as nominatimProvider } from '../src/address/services/geocoding/providers/nominatimProvider.js';
import { provider as photonProvider } from '../src/address/services/geocoding/providers/photonProvider.js';
import { provider as mapboxProvider } from '../src/address/services/geocoding/providers/mapboxProvider.js';

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

console.log(fail === 0
  ? '\nOK address-geocoding.golden — normalizadores Photon/Mapbox + orquestração do waterfall (sem rede)'
  : `\nFALHA address-geocoding.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
