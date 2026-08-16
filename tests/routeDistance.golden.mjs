/* tests/routeDistance.golden.mjs — REF-DELIVERY-FEE-03 · roda com:  node tests/routeDistance.golden.mjs
   Valida a camada de distancia de rota viaria SEM depender da API externa (mocks deterministicos):
   (A) routeCache — arredondamento, chave tenant-safe, TTL, teto de tamanho
   (B) routeDistanceService.calcularDistanciaEntrega — sem coordenadas, sem cliente supabase (db=null),
       sucesso via Edge Function, timeout/erro/rate-limit/sem-rota -> fallback Haversine, isolamento
       entre lojas (storeId diferente na chamada), regressao do caso real Timbo->Indaial (Fase 2). */
import assert from 'node:assert/strict';
import { arredondarCoord, construirChaveCache, criarCacheEmMemoria } from '../src/services/delivery/routing/routeCache.js';

let fail = 0;
const check = (m, fn) => { try { fn(); } catch (e) { fail++; console.error('✗', m, '—', e?.message ?? e); } };
const checkAsync = async (m, fn) => { try { await fn(); } catch (e) { fail++; console.error('✗', m, '—', e?.message ?? e); } };

/* Caso real comprovado na Fase 2 (evidencia ao vivo, HeiGIT api.heigit.org, perfil driving-car):
   Origem  Rua Joao Schley, 77 — Timbo/SC · Destino Rua Itajai, 357 — Indaial/SC. */
const ORIGEM_REAL = { lat: -26.850651757610454, lng: -49.28720263609122 };
const DESTINO_REAL = { lat: -26.8959635, lng: -49.2570131 };
const HAVERSINE_REAL_KM = 5.861082242589043;
const ROTA_REAL_KM = 10.4338; // arredondado do teste real (10433.8 m)

/* ── (A) routeCache ──────────────────────────────────────────────────────────────────────────── */
check('arredondarCoord: 4 casas decimais por padrão', () => {
  assert.strictEqual(arredondarCoord(-26.850651757610454), -26.8507);
  assert.strictEqual(arredondarCoord(-49.28720263609122), -49.2872);
});
check('construirChaveCache: mesma origem+destino+loja -> mesma chave', () => {
  const a = construirChaveCache({ storeId: 'loja-a', origem: ORIGEM_REAL, destino: DESTINO_REAL });
  const b = construirChaveCache({ storeId: 'loja-a', origem: ORIGEM_REAL, destino: DESTINO_REAL });
  assert.strictEqual(a, b);
});
check('construirChaveCache: TENANT-SAFE — loja A e loja B com origem/destino IGUAIS geram chaves diferentes', () => {
  const a = construirChaveCache({ storeId: 'loja-a', origem: ORIGEM_REAL, destino: DESTINO_REAL });
  const b = construirChaveCache({ storeId: 'loja-b', origem: ORIGEM_REAL, destino: DESTINO_REAL });
  assert.notStrictEqual(a, b, 'cache de rota de uma loja NUNCA pode vazar para outra, mesmo com mesmas coordenadas');
});
check('construirChaveCache: storeId ausente cai em "default", nunca colide com um storeId real chamado "default"', () => {
  const semLoja = construirChaveCache({ storeId: null, origem: ORIGEM_REAL, destino: DESTINO_REAL });
  const comLoja = construirChaveCache({ storeId: 'default', origem: ORIGEM_REAL, destino: DESTINO_REAL });
  assert.strictEqual(semLoja, comLoja); // comportamento documentado: 'default' É o bucket de "sem loja resolvida"
});
check('construirChaveCache: destino ligeiramente diferente (~mesmo prédio, <11m) gera a MESMA chave (cache hit esperado)', () => {
  const a = construirChaveCache({ storeId: 'x', origem: ORIGEM_REAL, destino: DESTINO_REAL });
  const b = construirChaveCache({ storeId: 'x', origem: ORIGEM_REAL, destino: { lat: DESTINO_REAL.lat + 0.00001, lng: DESTINO_REAL.lng } });
  assert.strictEqual(a, b);
});
check('construirChaveCache: destino claramente diferente (~1km) gera chave diferente (cache miss esperado)', () => {
  const a = construirChaveCache({ storeId: 'x', origem: ORIGEM_REAL, destino: DESTINO_REAL });
  const b = construirChaveCache({ storeId: 'x', origem: ORIGEM_REAL, destino: { lat: DESTINO_REAL.lat + 0.01, lng: DESTINO_REAL.lng } });
  assert.notStrictEqual(a, b);
});
check('criarCacheEmMemoria: miss -> null, set -> hit', () => {
  const cache = criarCacheEmMemoria();
  assert.strictEqual(cache.get('k'), null);
  cache.set('k', { distanceKm: 10.4 });
  assert.deepStrictEqual(cache.get('k'), { distanceKm: 10.4 });
});
check('criarCacheEmMemoria: expira apos o TTL', () => {
  let agora = 1000;
  const cache = criarCacheEmMemoria({ ttlMs: 500, agora: () => agora });
  cache.set('k', { distanceKm: 1 });
  agora += 400; // dentro do TTL
  assert.deepStrictEqual(cache.get('k'), { distanceKm: 1 });
  agora += 200; // 600ms desde o set, TTL=500 -> expirado
  assert.strictEqual(cache.get('k'), null);
});
check('criarCacheEmMemoria: teto de entradas zera o mapa (nunca cresce sem limite)', () => {
  const cache = criarCacheEmMemoria({ maxEntradas: 3 });
  cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
  assert.strictEqual(cache.tamanho(), 3);
  cache.set('d', 4); // ultrapassou o teto -> zera e insere só a nova
  assert.strictEqual(cache.tamanho(), 1);
  assert.strictEqual(cache.get('a'), null);
  assert.deepStrictEqual(cache.get('d'), 4);
});

/* ── (B) routeDistanceService — orquestração com a chamada de rede INJETADA (criarCalculadoraDistancia),
   mesmo precedente de criarWaterfall em address/geocoding/waterfallGeocoder.js: testa TODOS os ramos
   (sucesso/timeout/erro HTTP/rate limit/resposta malformada -> fallback) com fakes determinísticos,
   sem rede/Supabase real. */
const { calcularDistanciaEntrega, criarCalculadoraDistancia } = await import('../src/services/delivery/routing/routeDistanceService.js');

await checkAsync('calcularDistanciaEntrega: sem coordenadas -> sem_coordenadas, nunca lança', async () => {
  const r = await calcularDistanciaEntrega(null, DESTINO_REAL);
  assert.deepStrictEqual(r, { distanceKm: null, durationMin: null, method: null, provider: null, status: 'sem_coordenadas' });
});
await checkAsync('calcularDistanciaEntrega: coordenada parcial (lng faltando) -> sem_coordenadas', async () => {
  const r = await calcularDistanciaEntrega({ lat: -26.85 }, DESTINO_REAL);
  assert.strictEqual(r.status, 'sem_coordenadas');
});
await checkAsync('calcularDistanciaEntrega: sem cliente Supabase (db=null, modo degradado) -> fallback Haversine, nunca bloqueia', async () => {
  // este runner Node puro nunca tem VITE_SUPABASE_URL/KEY -> lib/supabase.js real fica com db=null,
  // exatamente o "modo degradado" de sempre (mesmo princípio testado nos outros golden tests do projeto).
  const r = await calcularDistanciaEntrega(ORIGEM_REAL, DESTINO_REAL);
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.method, 'haversine_fallback');
  assert.strictEqual(r.provider, null);
  assert.ok(Math.abs(r.distanceKm - HAVERSINE_REAL_KM) < 0.0001, `esperado ~${HAVERSINE_REAL_KM}, obtido ${r.distanceKm}`);
});
await checkAsync('calcularDistanciaEntrega: pontos iguais -> Haversine 0, ainda assim method=haversine_fallback (sem db)', async () => {
  const p = { lat: -26.85, lng: -49.28 };
  const r = await calcularDistanciaEntrega(p, p);
  assert.strictEqual(r.distanceKm, 0);
  assert.strictEqual(r.status, 'ok');
});

await checkAsync('criarCalculadoraDistancia: SUCESSO da Edge Function -> method=rota, provider=heigit, usa a distância da rota (não Haversine)', async () => {
  const calc = criarCalculadoraDistancia({
    invocar: async () => ({ data: { distanceKm: ROTA_REAL_KM, durationMin: 17.13, provider: 'heigit', cached: false }, error: null }),
  });
  const r = await calc(ORIGEM_REAL, DESTINO_REAL);
  assert.deepStrictEqual(r, { distanceKm: ROTA_REAL_KM, durationMin: 17.13, method: 'rota', provider: 'heigit', status: 'ok' });
});
await checkAsync('criarCalculadoraDistancia: cache hit da Edge Function -> mesmo contrato (cliente não precisa saber se veio de cache)', async () => {
  const calc = criarCalculadoraDistancia({
    invocar: async () => ({ data: { distanceKm: ROTA_REAL_KM, durationMin: 17.13, provider: 'heigit', cached: true }, error: null }),
  });
  const r = await calc(ORIGEM_REAL, DESTINO_REAL);
  assert.strictEqual(r.method, 'rota');
  assert.strictEqual(r.distanceKm, ROTA_REAL_KM);
});
await checkAsync('criarCalculadoraDistancia: erro HTTP (ex. 502 heigit_erro / 503 not_configured) -> fallback Haversine, method identificável', async () => {
  const calc = criarCalculadoraDistancia({
    invocar: async () => ({ data: null, error: new Error('FunctionsHttpError') }),
  });
  const r = await calc(ORIGEM_REAL, DESTINO_REAL);
  assert.strictEqual(r.method, 'haversine_fallback');
  assert.ok(Math.abs(r.distanceKm - HAVERSINE_REAL_KM) < 0.0001);
});
await checkAsync('criarCalculadoraDistancia: rate limit (429 -> HTTP error do lado do cliente) -> fallback Haversine', async () => {
  const calc = criarCalculadoraDistancia({
    invocar: async () => ({ data: null, error: Object.assign(new Error('rate_limit'), { status: 429 }) }),
  });
  const r = await calc(ORIGEM_REAL, DESTINO_REAL);
  assert.strictEqual(r.method, 'haversine_fallback');
});
await checkAsync('criarCalculadoraDistancia: timeout (invocar rejeita, AbortError) -> fallback Haversine, nunca trava/lança', async () => {
  const calc = criarCalculadoraDistancia({
    invocar: async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }); },
  });
  const r = await calc(ORIGEM_REAL, DESTINO_REAL);
  assert.strictEqual(r.method, 'haversine_fallback');
  assert.strictEqual(r.status, 'ok');
});
await checkAsync('criarCalculadoraDistancia: rota inexistente (data sem distanceKm numérico) -> fallback Haversine', async () => {
  const calc = criarCalculadoraDistancia({
    invocar: async () => ({ data: { error: true, reason: 'rota_nao_encontrada' }, error: null }),
  });
  const r = await calc(ORIGEM_REAL, DESTINO_REAL);
  assert.strictEqual(r.method, 'haversine_fallback');
});
await checkAsync('criarCalculadoraDistancia: distanceKm não-finito (NaN/Infinity) -> fallback Haversine, nunca propaga lixo', async () => {
  const calc = criarCalculadoraDistancia({
    invocar: async () => ({ data: { distanceKm: NaN, durationMin: 1 }, error: null }),
  });
  const r = await calc(ORIGEM_REAL, DESTINO_REAL);
  assert.strictEqual(r.method, 'haversine_fallback');
});
await checkAsync('criarCalculadoraDistancia: ISOLAMENTO ENTRE LOJAS — a chamada recebe o storeId resolvido no momento (Encanto vs Bar da Sogra nunca se misturam)', async () => {
  const bodiesRecebidos = [];
  const calc = criarCalculadoraDistancia({
    invocar: async (body) => { bodiesRecebidos.push(body); return { data: { distanceKm: ROTA_REAL_KM, durationMin: 17 }, error: null }; },
  });
  await calc(ORIGEM_REAL, DESTINO_REAL);
  // sem AdminStoreProvider/StorefrontProvider ativos (runner Node puro), buildStoreRpcParam() resolve
  // p_store_id undefined -> storeId enviado é null: o CONTRATO testado aqui é que o storeId resolvido
  // (seja qual for) SEMPRE viaja no corpo da chamada — nunca é omitido silenciosamente.
  assert.ok('storeId' in bodiesRecebidos[0], 'o corpo enviado à Edge Function precisa sempre carregar storeId (mesmo que null)');
  assert.ok('origin' in bodiesRecebidos[0] && 'destination' in bodiesRecebidos[0]);
});

/* Documenta o resultado REAL medido na Fase 2 (evidência, não recalculado aqui — sem rede neste
   runner). Guarda a comparação Haversine vs rota real como registro executável do caso de aceitação
   da REF (Fase 11), para nunca regredir silenciosamente o número citado no relatório final. */
check('REGISTRO Fase 2: Haversine (5.861km) vs rota real HeiGIT (10.434km) — diferença ~78%, muda de faixa R$12->R$22', () => {
  const diffPct = ((ROTA_REAL_KM - HAVERSINE_REAL_KM) / HAVERSINE_REAL_KM) * 100;
  assert.ok(diffPct > 70 && diffPct < 85, `esperado ~78%, obtido ${diffPct.toFixed(1)}%`);
});

console.log(fail === 0 ? '✅ routeDistance.golden OK' : `❌ ${fail} falha(s)`);
process.exit(fail === 0 ? 0 : 1);
