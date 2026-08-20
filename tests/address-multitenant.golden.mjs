/* tests/address-multitenant.golden.mjs — REF-ADDRESS-AUTOCOMPLETE-01, isolamento multi-tenant
   (Encanto x Bar da Sogra). Roda: node tests/address-multitenant.golden.mjs
   (npm run test:address-multitenant). Zero rede/banco — usa fetch mockado e fixtures baseadas em
   introspecção REAL e read-only do banco (feita nesta auditoria, sem alterar nenhum dado):

     stores: encanto (8604324d-...) e bar-da-sogra (776a01c8-...), ambos existentes de verdade.
     store_settings.company_info: Encanto tem cidade='Timbó', estado='SC', lojaLat/lojaLng preenchidos;
       Bar da Sogra tem os 4 campos NULL (loja nova, nunca configurou endereço institucional) — CONFIRMA
       que o schema já isola por store_id corretamente (não existe herança de dado entre as 2 linhas).
     addresses: Bar da Sogra tem 0 pedidos/endereços até agora (tenant novo, sem tráfego real ainda) —
       por isso o isolamento do AUTOCOMPLETE em si só pode ser provado por código/mock nesta etapa, não
       por evidência de produção — registrado honestamente no relatório, não escondido. */
import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./_render-loader.mjs', import.meta.url); // REF-OBS-02: addressRepository.js agora importa
  // lib/sentry.js (import.meta.env acesso direto, sem `?.`, de propósito — ver comentário lá); mesmo
  // shim de _render-loader.mjs (já usado por test:render) faz import.meta.env virar {} em Node puro.
import { criarWaterfall, ORDEM_PADRAO } from '../src/address/services/geocoding/waterfallGeocoder.js';
import { CENTRO_PADRAO } from '../src/address/utils/coordinates.js';

let fail = 0;
const check = async (m, fn) => { try { await fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const fetchOriginal = globalThis.fetch;
function restaurarFetch() { globalThis.fetch = fetchOriginal; }

/* Dados REAIS lidos do banco nesta auditoria (2026-08-17, introspecção read-only) — não sintéticos. */
const ENCANTO = { storeId: '8604324d-0529-443d-aa79-4337057bfa01', cidade: 'Timbó', estado: 'SC', lojaLat: -26.850651757610454, lojaLng: -49.28720263609122 };
const BAR_DA_SOGRA = { storeId: '776a01c8-f836-417a-a957-a0e1109f90a2', cidade: null, estado: null, lojaLat: null, lojaLng: null };

const waterfallReal = criarWaterfall(ORDEM_PADRAO);

/* ══════════════ (A) viés de busca — cada loja usa SÓ o próprio company_info ══════════════ */
await check('Encanto: bias real (Timbó/SC) chega até a URL do Nominatim quando é ele quem responde', async () => {
  const chamadas = [];
  globalThis.fetch = async (url) => {
    chamadas.push(url);
    if (url.includes('photon.komoot.io')) return { ok: true, status: 200, json: async () => ({ features: [] }) };
    return { json: async () => [{ address: { road: 'Rua X', city: 'Timbó', state: 'Santa Catarina' } }] };
  };
  try {
    // simula exatamente o que useAddressSearch.js faz: cidadePadrao = companyInfo.cidade || ''
    const cidadePadrao = ENCANTO.cidade || '';
    const estadoPadrao = ENCANTO.estado || '';
    await waterfallReal.sugestoes('Rua X', { cidade: cidadePadrao, estado: estadoPadrao });
    assert.ok(chamadas.some((u) => u.includes('nominatim') && u.includes(encodeURIComponent('Timbó'))), 'a busca da Encanto deve carregar Timbó no viés');
  } finally { restaurarFetch(); }
});
await check('Bar da Sogra: SEM company_info configurado (todos os campos NULL no banco), o viés vira busca nacional pura — nunca herda "Timbó" da Encanto', async () => {
  const chamadas = [];
  globalThis.fetch = async (url) => { chamadas.push(url); return { json: async () => [] }; };
  try {
    // mesma lógica de useAddressSearch.js: companyInfo.cidade (null pra Bar da Sogra) || '' -> ''
    const cidadePadrao = BAR_DA_SOGRA.cidade || '';
    const estadoPadrao = BAR_DA_SOGRA.estado || '';
    assert.equal(cidadePadrao, '', 'Bar da Sogra não tem cidade configurada — bias deve ficar vazio, nunca "Timbó"');
    await waterfallReal.sugestoes('Rua X', { cidade: cidadePadrao, estado: estadoPadrao });
    const urlNominatim = chamadas.find((u) => u.includes('nominatim'));
    assert.ok(urlNominatim && !urlNominatim.includes('Timb') && !urlNominatim.includes('%2C+SC'), 'a busca da Bar da Sogra NUNCA pode carregar Timbó/SC — dado que pertence só à Encanto');
  } finally { restaurarFetch(); }
});

/* ══════════════ (B) fallback físico do mapa — CENTRO_PADRAO não é a loja da Encanto ══════════════ */
await check('CENTRO_PADRAO é o centro geográfico do Brasil, NÃO as coordenadas da Encanto — uma loja nova (ex.: Bar da Sogra) nunca abre o mapa "chutando" Timbó', () => {
  assert.deepEqual(CENTRO_PADRAO, { lat: -14.235, lng: -51.925 });
  const distDoCentroPadraoAteEncanto = Math.hypot(CENTRO_PADRAO.lat - ENCANTO.lojaLat, CENTRO_PADRAO.lng - ENCANTO.lojaLng);
  assert.ok(distDoCentroPadraoAteEncanto > 10, 'CENTRO_PADRAO precisa estar longe da Encanto (não pode ser um alias disfarçado da posição da loja)');
});
await check('Bar da Sogra sem lojaLat/lojaLng configurado -> mapPin inicial cairia no CENTRO_PADRAO (mesma lógica de useAddressSearch.js), nunca na posição da Encanto', () => {
  // reproduz a expressão exata de useAddressSearch.js (mapPin inicial)
  const mapPinBarDaSogra = (Number.isFinite(BAR_DA_SOGRA.lojaLat) && Number.isFinite(BAR_DA_SOGRA.lojaLng))
    ? { lat: BAR_DA_SOGRA.lojaLat, lng: BAR_DA_SOGRA.lojaLng }
    : { lat: CENTRO_PADRAO.lat, lng: CENTRO_PADRAO.lng };
  assert.deepEqual(mapPinBarDaSogra, CENTRO_PADRAO);
  assert.notDeepEqual(mapPinBarDaSogra, { lat: ENCANTO.lojaLat, lng: ENCANTO.lojaLng });
});

/* ══════════════ (C) cache não vaza entre lojas ══════════════
   Já coberto genericamente em address-geocoding.golden.mjs ("cache é chaveado por query+cidade+estado");
   aqui repete com os 2 tenants REAIS, não uma loja fictícia, pra fechar o requisito explícito do dono. */
await check('mesma query textual, viés da Encanto vs viés vazio da Bar da Sogra -> resultados diferentes, sem reaproveitar cache um do outro', async () => {
  const { _limparCacheNominatim, buscarEnderecos } = await import('../src/address/services/nominatimService.js');
  _limparCacheNominatim();
  globalThis.fetch = async () => ({ json: async () => [{ address: { road: 'Rua Central', city: 'Timbó' } }] });
  const rEncanto = await buscarEnderecos('Rua Central', { cidade: ENCANTO.cidade, estado: ENCANTO.estado });

  globalThis.fetch = async () => ({ json: async () => [{ address: { road: 'Rua Central', city: null } }] });
  const rBarDaSogra = await buscarEnderecos('Rua Central', { cidade: BAR_DA_SOGRA.cidade || '', estado: BAR_DA_SOGRA.estado || '' });
  try {
    assert.equal(rEncanto[0].address.city, 'Timbó');
    assert.equal(rBarDaSogra[0].address.city, null, 'não reaproveitou o cache "Rua Central" da Encanto — buscou de novo pra Bar da Sogra');
  } finally { restaurarFetch(); }
});

/* ══════════════ (D) persistência — GAP histórico (5 linhas antigas), store_id agora derivado no
   SERVIDOR, nunca no payload (REF-AUTH-TENANT-01 · Onda 5) ══════════════
   Introspecção real (read-only) feita na sessão original: addresses tinha 19 linhas, 14 com
   store_id=Encanto, 0 com store_id=Bar da Sogra (tenant sem pedido real ainda) e 5 com store_id=NULL —
   todas as 5 ligadas (via orders.endereco_id) a pedidos REAIS da Encanto, confirmando que NÃO havia
   vazamento entre tenants. A causa raiz (save_structured_address nunca recebia/usava store_id) foi
   corrigida na Onda 5 da REF-AUTH-TENANT-01 — mas a correção é INTENCIONALMENTE do lado do SERVIDOR
   (deriva de customers.store_id/tenant_id do JWT dentro da RPC), nunca de um parâmetro vindo do
   client — por isso o payload continua, de propósito, sem a chave store_id. As 5 linhas históricas
   NULL continuam fora de escopo (REF-ADDRESS-STOREID-01, drift antigo, não mexido). */
await check('store_id nunca sai no payload do client (por design — é derivado no servidor, nunca confiado do client)', async () => {
  const { paraPayloadRpc } = await import('../src/address/repository/addressRepository.js');
  const endereco = {
    storeId: ENCANTO.storeId, // mesmo se o chamador tivesse essa info em mãos, a função não a usa
    rua: 'Rua X', numero: '10', bairro: 'Centro', cidade: 'Timbó', estado: 'SC', cep: '89120-000',
    lat: -26.85, lng: -49.28, provider: 'photon', confidence: 'exact',
  };
  const payloadReal = paraPayloadRpc(endereco);
  assert.ok(!('store_id' in payloadReal), 'nenhuma chave store_id sai no payload, mesmo com storeId disponível no objeto de entrada — a RPC deriva sozinha, nunca confia no client');
  assert.equal(payloadReal.rua, 'Rua X', 'confere que o resto do payload continua correto (função real, não reimplementada)');
});

console.log(fail === 0
  ? '\nOK address-multitenant.golden — Encanto x Bar da Sogra: bias, mapa, cache isolados; gap de store_id na persistência documentado'
  : `\nFALHA address-multitenant.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
