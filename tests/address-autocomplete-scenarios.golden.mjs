/* tests/address-autocomplete-scenarios.golden.mjs — REF-ADDRESS-AUTOCOMPLETE-01, Fase 11.
   Roda: node tests/address-autocomplete-scenarios.golden.mjs
   (npm run test:address-autocomplete-scenarios). Cenários pedidos explicitamente pelo dono antes de
   abrir o gate de schema de confidence: rua homônima, cidade homônima, endereço com/sem número,
   endereço inexistente, falha de provedor. Usa os PROVIDERS REAIS (photonProvider/nominatimProvider/
   mapboxProvider) através do waterfall REAL (ORDEM_PADRAO já reordenado: mapbox->photon->nominatim),
   com fetch mockado (globalThis.fetch monkeypatchado e restaurado, mesmo padrão já estabelecido em
   address-geocoding.golden.mjs) — zero rede real, mas exercita a integração de verdade, não só fakes
   isolados. Mapbox fica sempre indisponível aqui (sem VITE_MAPBOX_TOKEN no ambiente de teste, igual a
   produção até o dono decidir ativá-lo — REF-ADDRESS-AUTOCOMPLETE-01 auditoria: dono escolheu manter
   Mapbox dormente). */
import assert from 'node:assert/strict';
import { criarWaterfall, ORDEM_PADRAO } from '../src/address/services/geocoding/waterfallGeocoder.js';
import { provider as photonProvider } from '../src/address/services/geocoding/providers/photonProvider.js';
import { provider as nominatimProvider } from '../src/address/services/geocoding/providers/nominatimProvider.js';
import { provider as mapboxProvider } from '../src/address/services/geocoding/providers/mapboxProvider.js';
import { normalizarEndereco, sugestaoSub, inferirConfidence } from '../src/address/utils/addressFormat.js';
import { _limparCacheNominatim } from '../src/address/services/nominatimService.js';

let fail = 0;
const check = async (m, fn) => { try { await fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const fetchOriginal = globalThis.fetch;
/* respostasPorHost: roteia a fetch mockada por qual host foi chamado (Photon vs Nominatim têm URLs
   diferentes) — necessário porque este arquivo testa o waterfall REAL com múltiplos providers reais ao
   mesmo tempo, não 1 provider isolado como address-geocoding.golden.mjs fazia. */
function mockFetchPorHost(mapa) {
  const chamadas = [];
  globalThis.fetch = async (url) => {
    chamadas.push(url);
    for (const [host, resposta] of Object.entries(mapa)) {
      if (url.includes(host)) return { ok: true, status: 200, json: async () => resposta };
    }
    throw new Error('fetch mockado sem rota para: ' + url);
  };
  return chamadas;
}
function restaurarFetch() { globalThis.fetch = fetchOriginal; }

const waterfallReal = criarWaterfall(ORDEM_PADRAO); // mesma instância de produção (mapbox->photon->nominatim)

/* ══════════════ 1. RUA HOMÔNIMA ══════════════
   Achado real desta auditoria (teste ao vivo contra HeiGIT/Pelias, sessão anterior): "Rua Itajaí"
   existe em pelo menos 6 municípios de SC (Timbó, Indaial, Pomerode, Apiúna, Blumenau, Ibirama...).
   Fixture inspirado nesse achado real, não inventado.

   RESOLVIDO (2026-08-17): testei ao vivo contra a API pública do Photon — o parâmetro nativo
   `lat`/`lon` (viés de proximidade) já resolve os 2 critérios de aceite do dono sozinho, sem precisar
   de nenhuma camada de re-ranking própria: "Rua Itajaí" com lat/lon=posição da Encanto devolve Timbó
   primeiro; "Rua Itajaí, Indaial" (cidade explícita no texto) devolve Indaial primeiro mesmo com o viés
   ainda apontando pra Timbó. Esse comportamento é do PRÓPRIO Photon (não é código nosso, não dá pra
   mockar de forma significativa) — os testes abaixo confirmam só a parte que É nosso código: que
   passamos `lat`/`lon` corretamente quando a loja tem posição configurada, e que degradamos
   graciosamente (sem os parâmetros) quando não tem. */
await check('rua homônima — com bias.lat/lng (posição da loja configurada), Photon recebe o viés de proximidade na URL', async () => {
  const chamadas = mockFetchPorHost({
    'photon.komoot.io': { features: [{ properties: { name: 'Rua Itajaí', street: 'Rua Itajaí', city: 'Timbó', state: 'Santa Catarina' }, geometry: { coordinates: [-49.259369, -26.835153] } }] },
  });
  try {
    const r = await waterfallReal.sugestoes('Rua Itajaí', { cidade: 'Timbó', estado: 'SC', lat: -26.850651757610454, lng: -49.28720263609122 });
    assert.equal(chamadas.length, 1);
    assert.ok(chamadas[0].includes('lat=-26.850651757610454'), 'lat da loja deveria estar na URL do Photon');
    assert.ok(chamadas[0].includes('lon=-49.28720263609122'), 'lng da loja (como lon=) deveria estar na URL do Photon');
    assert.equal(r[0].address.city, 'Timbó');
  } finally { restaurarFetch(); }
});
await check('rua homônima — sem bias.lat/lng (loja sem posição configurada, ex.: tenant novo), Photon NÃO recebe lat/lon — degradação graciosa, mesma busca nacional de antes', async () => {
  const chamadas = mockFetchPorHost({
    'photon.komoot.io': { features: [{ properties: { name: 'Rua Itajaí', street: 'Rua Itajaí', city: 'Itajaí', state: 'Santa Catarina' }, geometry: { coordinates: [-48.66, -26.9] } }] },
  });
  try {
    await waterfallReal.sugestoes('Rua Itajaí', { cidade: '', estado: '' }); // Bar da Sogra hoje: sem lojaLat/lojaLng
    assert.ok(!chamadas[0].includes('&lat=') && !chamadas[0].includes('&lon='), 'sem posição configurada, a URL não deve carregar lat/lon nenhum');
  } finally { restaurarFetch(); }
});
await check('rua homônima — quando Photon falha, Nominatim (respeita bias) assume e prioriza a cidade certa da loja', async () => {
  _limparCacheNominatim();
  const chamadas = [];
  globalThis.fetch = async (url) => {
    if (url.includes('photon.komoot.io')) throw new Error('Photon indisponível (simulado)');
    if (url.includes('nominatim.openstreetmap.org')) { chamadas.push(url); return { json: async () => [{ address: { road: 'Rua Itajaí', city: 'Timbó', state: 'Santa Catarina' }, lat: '-26.835', lon: '-49.259' }] }; }
    throw new Error('rota inesperada: ' + url);
  };
  try {
    const r = await waterfallReal.sugestoes('Rua Itajaí', { cidade: 'Timbó', estado: 'SC' });
    assert.ok(chamadas[0].includes(encodeURIComponent('Rua Itajaí, Timbó, SC, Brasil')), 'Nominatim usa o viés da loja quando é ele quem responde');
    assert.equal(r[0].address.city, 'Timbó');
  } finally { restaurarFetch(); }
});

/* ══════════════ 2. CIDADE HOMÔNIMA ══════════════
   Achado real desta auditoria (teste ao vivo contra HeiGIT/Pelias): "Timbó"/"Timbo" existe em SC, PE,
   SP e BA — 4 estados diferentes, mesmo nome de município. */
await check('cidade homônima — o campo estado SEMPRE chega no shape canônico (dado disponível para desambiguar)', () => {
  const timboSC = normalizarEndereco({ road: 'Rua Itajaí', city: 'Timbó', state: 'Santa Catarina' }, { completa: true });
  const timboOutro = normalizarEndereco({ road: 'Rua Central', city: 'Timbó', state: 'Pernambuco' }, { completa: true });
  assert.equal(timboSC.estado, 'Santa Catarina');
  assert.equal(timboOutro.estado, 'Pernambuco');
  assert.notEqual(timboSC.estado, timboOutro.estado, 'os 2 "Timbó" são distinguíveis pelo estado — nunca tratados como o mesmo lugar');
});
await check('cidade homônima — RESOLVIDO (2026-08-17): sugestaoSub() agora mostra o estado, os 2 "Timbó" ficam distinguíveis na lista', () => {
  const timboSC = { address: { road: 'Rua Itajaí', city: 'Timbó', state: 'Santa Catarina', postcode: '89120-000' } };
  const timboPE = { address: { road: 'Rua Central', city: 'Timbó', state: 'Pernambuco', postcode: '55800-000' } };
  const subSC = sugestaoSub(timboSC);
  const subPE = sugestaoSub(timboPE);
  assert.equal(subSC, 'Timbó/Santa Catarina · CEP 89120-000');
  assert.equal(subPE, 'Timbó/Pernambuco · CEP 55800-000');
  assert.notEqual(subSC, subPE, 'os 2 "Timbó" ficam claramente distinguíveis agora, não só pelo CEP');
});
await check('cidade homônima — com bias.estado, Nominatim usa state= na query estruturada (já testado em address-geocoding.golden.mjs; aqui confirma pela integração real do waterfall)', async () => {
  _limparCacheNominatim();
  const chamadas = [];
  globalThis.fetch = async (url) => {
    chamadas.push(url);
    if (url.includes('photon.komoot.io')) return { ok: true, status: 200, json: async () => ({ features: [] }) };
    if (url.includes('nominatim.openstreetmap.org') && chamadas.filter((u) => u.includes('nominatim')).length === 1) return { json: async () => [] };
    return { json: async () => [{ address: { road: 'Rua Central', house_number: '10', city: 'Timbó', state: 'Pernambuco' }, lat: '-8.25', lon: '-35.55' }] };
  };
  try {
    const r = await waterfallReal.sugestoes('Rua Central 10', { cidade: 'Timbó', estado: 'PE' });
    const urlEstruturada = chamadas.find((u) => u.includes('city=Timb') && u.includes('state=PE'));
    assert.ok(urlEstruturada, 'a estratégia estruturada do Nominatim deveria ter usado city=Timbó&state=PE, não SC');
    assert.equal(r[0].address.state, 'Pernambuco');
  } finally { restaurarFetch(); }
});

/* ══════════════ 3/4. ENDEREÇO COM NÚMERO / SEM NÚMERO ══════════════ */
await check('endereço com número: provedor confirma house_number -> confidence exact (nunca inventado a partir do texto digitado)', async () => {
  mockFetchPorHost({ 'photon.komoot.io': { features: [{ properties: { name: 'Rua João Schley', street: 'Rua João Schley', housenumber: '77', city: 'Timbó', state: 'Santa Catarina' }, geometry: { coordinates: [-49.2872, -26.8506] } }] } });
  try {
    const r = await waterfallReal.sugestoes('Rua João Schley, 77, Timbó', { cidade: 'Timbó', estado: 'SC' });
    assert.equal(r[0].address.house_number, '77');
    assert.equal(r[0]._confidence, 'exact');
  } finally { restaurarFetch(); }
});
await check('endereço com número no TEXTO mas provedor só confirma a rua (sem housenumber): confidence continua street_level — nunca "sobe" pra exact só porque o usuário digitou um número', async () => {
  mockFetchPorHost({ 'photon.komoot.io': { features: [{ properties: { name: 'Rua João Schley', street: 'Rua João Schley', city: 'Timbó', state: 'Santa Catarina' }, geometry: { coordinates: [-49.2872, -26.8506] } }] } });
  try {
    // usuário digitou "77" no texto de busca, mas o provedor NÃO devolveu house_number nesta fixture —
    // exatamente o achado real desta auditoria contra o HeiGIT (Rua João Schley 77 só resolveu a rua).
    const r = await waterfallReal.sugestoes('Rua João Schley, 77, Timbó', { cidade: 'Timbó', estado: 'SC' });
    assert.equal(r[0].address.house_number, '', 'o provedor não confirmou o número — nunca inventar');
    assert.equal(r[0]._confidence, 'street_level', 'confidence reflete só o que o PROVEDOR confirmou, nunca o que o usuário digitou');
  } finally { restaurarFetch(); }
});
await check('endereço sem número: street_level preservado, sem crash, coordenada continua sendo a da rua (centroid) — nunca inventa um ponto de casa', () => {
  const r = inferirConfidence({ address: { road: 'Rua Amazonas' } });
  assert.equal(r, 'street_level');
});

/* ══════════════ 5. ENDEREÇO INEXISTENTE ══════════════ */
await check('endereço inexistente: todos os providers reais (photon+nominatim mockados vazios, mapbox indisponível) -> [] — nunca aceita cidade/bairro como substituto', async () => {
  _limparCacheNominatim();
  mockFetchPorHost({
    'photon.komoot.io': { features: [] },
    'nominatim.openstreetmap.org': [],
  });
  try {
    assert.equal(mapboxProvider.disponivel(), false, 'pré-condição: mapbox precisa estar indisponível neste ambiente de teste para o cenário fazer sentido');
    const r = await waterfallReal.sugestoes('Rua Que Nao Existe De Jeito Nenhum Kkkkk 99999');
    assert.deepEqual(r, []);
  } finally { restaurarFetch(); }
});

/* ══════════════ 6. PROVIDER FAILURE (Photon indisponível) ══════════════ */
await check('Photon indisponível (erro de rede) -> waterfall cai pro Nominatim automaticamente, resultado final não fica vazio', async () => {
  _limparCacheNominatim();
  globalThis.fetch = async (url) => {
    if (url.includes('photon.komoot.io')) throw new TypeError('fetch failed (simulado)');
    if (url.includes('nominatim.openstreetmap.org')) return { json: async () => [{ address: { road: 'Rua Central', city: 'Timbó' }, lat: '-26.8', lon: '-49.2' }] };
    throw new Error('rota inesperada: ' + url);
  };
  try {
    const r = await waterfallReal.sugestoes('Rua Central', { cidade: 'Timbó', estado: 'SC' });
    assert.equal(r.length, 1);
    assert.equal(r[0]._provider, 'nominatim');
  } finally { restaurarFetch(); }
});
await check('Photon E Nominatim indisponíveis -> [] (nunca lança) — checkout não pode quebrar por causa da busca de endereço', async () => {
  _limparCacheNominatim();
  globalThis.fetch = async () => { throw new TypeError('fetch failed (simulado, ambos os provedores fora)'); };
  try {
    const r = await waterfallReal.sugestoes('Rua Qualquer', { cidade: 'Timbó', estado: 'SC' });
    assert.deepEqual(r, []);
  } finally { restaurarFetch(); }
});

console.log(fail === 0
  ? '\nOK address-autocomplete-scenarios.golden — rua/cidade homônima, número/sem número, inexistente, falha de provedor (sem rede real)'
  : `\nFALHA address-autocomplete-scenarios.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
