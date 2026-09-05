// supabase/functions/route-distance/index.ts — REF-DELIVERY-FEE-03.
// EDGE FUNCTION (Deno) = UNICO ponto onde a chave do OpenRouteService/HeiGIT vive (segredo do
// servidor). Recebe {storeId, origin:{lat,lng}, destination:{lat,lng}} do checkout (via
// src/services/delivery/routing/routeDistanceService.js) e devolve a distancia de ROTA VIARIA real
// (Directions V2, perfil driving-car — nao ha perfil de motocicleta na API, driving-car e o correto
// para um veiculo que usa a malha viaria comum).
//
// Por que uma Edge Function e nao chamada direta do navegador (diferente do geocoding, que fala com
// Mapbox/Nominatim/Photon direto do cliente): o ORS/HeiGIT NAO suporta restricao de chave por
// dominio (confirmado na documentacao oficial + suporte do proprio provedor) — expor a chave no
// bundle deixaria qualquer pessoa livre para copia-la e estourar a cota diaria (2.000 req/dia).
//
// PONTO DE CREDENCIAL (unico secret manual):
//   supabase secrets set OPENROUTESERVICE_API_KEY=...
// (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY tambem sao usados a partir da Onda 3.2 abaixo — mas esses
// dois sao injetados automaticamente pela plataforma em toda Edge Function, nunca precisam de
// `supabase secrets set`.)
//
// CACHE: Map em memoria por isolate (mesma logica de src/services/delivery/routing/routeCache.js,
// MIRRORADA aqui de proposito — mesmo precedente de templates.ts espelhando messageTemplates.js,
// REF-ORDER-01 Parte 3. Mudou la, muda aqui). Chave SEMPRE inclui storeId (tenant-safe por
// construcao, nunca depende so das coordenadas nao colidirem entre lojas).
//
// FALLBACK: esta funcao NUNCA calcula Haversine — se o HeiGIT falhar/der timeout/nao achar rota,
// devolve erro (status != 200) e quem decide cair para Haversine e o CLIENTE
// (routeDistanceService.js), que ja tem origem/destino em maos e não precisa de rede para isso.
//
// REF-DELIVERY-FEE-05 · Onda 3.2: alem de responder ao client (como sempre), esta funcao agora TAMBEM
// grava o resultado em public.delivery_route_cache — a fonte que _resolve_delivery_fee (Onda 3.3) vai
// ler para tornar a distancia viaria AUTORITATIVA no servidor, sem nunca precisar de uma chamada HTTP
// sincrona dentro de create_order() (pool de conexoes de producao/E2E e' pequeno — max_connections=60,
// confirmado por introspeccao — bloquear uma conexao esperando o HeiGIT dentro da funcao mais chamada
// do sistema seria um risco desproporcional). Grava via _upsert_delivery_route_cache(), SECURITY
// DEFINER com GRANT EXECUTE restrito a service_role (ver migration da Onda 3.1) — usa a
// SUPABASE_SERVICE_ROLE_KEY, injetada automaticamente pela plataforma em toda Edge Function (mesmo
// precedente de supabase/functions/invite-store-admin, nenhum secret novo a configurar).
// Falha ao gravar (RPC indisponivel, tabela ausente etc.) NUNCA impede a resposta ao client — grava
// "melhor esforco", depois de já ter o resultado em mãos (sucesso do HeiGIT OU cache em memória do
// isolate), sem bloquear nem atrasar o que o client está esperando.

const CASAS_DECIMAIS = 4; // ~11m de precisao — espelha routeCache.js
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const MAX_ENTRADAS = 1000;
const HEIGIT_TIMEOUT_MS = 5000; // menor que o timeout do cliente (6000ms, ver routeDistanceService.js)
const PERFIL = "driving-car";
const HEIGIT_URL = `https://api.heigit.org/openrouteservice/v2/directions/${PERFIL}`;

// REF-SEC-DATA-01 R14: esta funcao nao exige sessao de usuario real (decisao de desenho, ver comentario
// no CORS_HEADERS abaixo — mesmo padrao de RPC publica via anon key). O unico risco pratico e alguem com
// a anon key (publica, vem no bundle) esgotar a cota diaria do HeiGIT (2.000 req/dia) via script. Rate
// limit LEVE por IP, so na chamada real ao HeiGIT (nunca em cache hit — repetir a MESMA rota nao gasta
// cota) — teto bem acima do uso legitimo de checkout, baixo o bastante pra travar um abuso automatizado.
const RATE_LIMIT_JANELA_MS = 60_000;
const RATE_LIMIT_MAX_POR_JANELA = 30;
const rateLimitPorIp = new Map<string, number[]>();

function ipPermitido(ip: string): boolean {
  const agora = Date.now();
  if (rateLimitPorIp.size >= MAX_ENTRADAS) rateLimitPorIp.clear(); // mesmo guard de memoria do cache de rota
  const chamadas = (rateLimitPorIp.get(ip) ?? []).filter((t) => agora - t < RATE_LIMIT_JANELA_MS);
  if (chamadas.length >= RATE_LIMIT_MAX_POR_JANELA) { rateLimitPorIp.set(ip, chamadas); return false; }
  chamadas.push(agora);
  rateLimitPorIp.set(ip, chamadas);
  return true;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*", // rota de leitura, sem credencial de usuario — mesmo padrao de RPCs publicas via anon key
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function arredondarCoord(n: number, casas = CASAS_DECIMAIS): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

interface Coord { lat: number; lng: number; }
function coordValida(c: unknown): c is Coord {
  const o = c as Coord;
  return !!o && Number.isFinite(o.lat) && Number.isFinite(o.lng);
}

/* REF-DELIVERY-FEE-05 · Onda 3.2: cliente service_role, criado uma vez por isolate (mesmo padrao de
   invite-store-admin — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY sao injetados automaticamente, nenhum
   secret novo). null quando as vars nao existem (nunca deveria ocorrer numa Edge Function real, mas
   evita throw no boot do isolate) — gravarNoCache vira no-op nesse caso. */
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const serviceClient = (SUPABASE_URL && SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

/* Grava (melhor esforco, nunca bloqueia nem falha a resposta ao client) a distancia calculada para
   store_id+origem+destino em delivery_route_cache — _resolve_delivery_fee (Onda 3.3) le esta tabela
   para tornar a rota viaria AUTORITATIVA no servidor sem chamada HTTP dentro de create_order(). Chama
   a RPC (nao INSERT/upsert direto na tabela) porque o GRANT EXECUTE dela e' restrito a service_role
   (ver migration da Onda 3.1) — nunca escreve na tabela via `.from(...)` diretamente. */
async function gravarNoCache(storeId: string | null, origem: Coord, destino: Coord, distanceKm: number, durationMin: number): Promise<void> {
  if (!serviceClient || !storeId) return;   // sem storeId nao ha tenant pra isolar a entrada — nao grava
  try {
    await serviceClient.rpc("_upsert_delivery_route_cache", {
      p_store_id: storeId,
      p_origem_lat: origem.lat, p_origem_lng: origem.lng,
      p_destino_lat: destino.lat, p_destino_lng: destino.lng,
      p_distance_km: distanceKm, p_duration_min: durationMin,
      p_provider: "heigit", p_perfil: PERFIL,
    });
  } catch {
    // melhor esforco: falha ao gravar cache nunca derruba a resposta ja calculada ao client.
  }
}

function construirChaveCache(storeId: string | null, origem: Coord, destino: Coord): string {
  const sid = storeId || "default";
  return `${sid}|${arredondarCoord(origem.lat)},${arredondarCoord(origem.lng)}|${arredondarCoord(destino.lat)},${arredondarCoord(destino.lng)}|${PERFIL}`;
}

interface RotaCacheada { distanceKm: number; durationMin: number; }
const cache = new Map<string, { valor: RotaCacheada; criadoEm: number }>();

function cacheGet(chave: string): RotaCacheada | null {
  const item = cache.get(chave);
  if (!item) return null;
  if (Date.now() - item.criadoEm > TTL_MS) { cache.delete(chave); return null; }
  return item.valor;
}
function cacheSet(chave: string, valor: RotaCacheada): void {
  if (cache.size >= MAX_ENTRADAS) cache.clear();
  cache.set(chave, { valor, criadoEm: Date.now() });
}

async function chamarHeigit(apiKey: string, origem: Coord, destino: Coord): Promise<{ ok: true; distM: number; durS: number } | { ok: false; reason: string; status?: number }> {
  try {
    const r = await fetch(HEIGIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json",
        "Authorization": apiKey,
      },
      body: JSON.stringify({ coordinates: [[origem.lng, origem.lat], [destino.lng, destino.lat]] }),
      signal: AbortSignal.timeout(HEIGIT_TIMEOUT_MS),
    });
    if (!r.ok) {
      // 429 (rate limit) / 4xx (coordenada fora de alcance, sem rota) / 5xx (indisponivel) — nunca
      // relancado como excecao nao tratada, sempre um motivo identificavel para quem chama decidir.
      const reason = r.status === 429 ? "rate_limit" : r.status >= 500 ? "heigit_indisponivel" : "heigit_erro_" + r.status;
      return { ok: false, reason, status: r.status };
    }
    const json = await r.json().catch(() => null);
    const rota = json?.routes?.[0] ?? json?.features?.[0]?.properties;
    const distM = rota?.summary?.distance;
    const durS = rota?.summary?.duration;
    if (typeof distM !== "number" || typeof durS !== "number") return { ok: false, reason: "rota_nao_encontrada" };
    return { ok: true, distM, durS };
  } catch (e) {
    const nome = (e as { name?: string })?.name;
    return { ok: false, reason: nome === "TimeoutError" || nome === "AbortError" ? "timeout" : "network_error" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: true, reason: "method_not_allowed" }, 405);

  let body: { storeId?: string | null; origin?: unknown; destination?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: true, reason: "json_invalido" }, 400);
  }

  const origem = body.origin as Coord;
  const destino = body.destination as Coord;
  if (!coordValida(origem) || !coordValida(destino)) {
    return jsonResponse({ error: true, reason: "coordenadas_invalidas" }, 400);
  }

  const storeId = typeof body.storeId === "string" && body.storeId ? body.storeId : null;
  const chave = construirChaveCache(storeId, origem, destino);

  const cacheado = cacheGet(chave);
  if (cacheado) {
    /* Onda 3.2: "toca" delivery_route_cache mesmo em hit de memoria (TTL do isolate e' 30 dias, MAIOR
       que o TTL de 24h do banco — sem este touch, apos 24h o servidor cairia no fallback Haversine
       mesmo com o client ainda mostrando "rota" na tela, uma divergencia silenciosa entre UX e cobranca
       real). Upsert e' barato (indice unico) e nunca bloqueia a resposta por mais que o try/catch interno. */
    await gravarNoCache(storeId, origem, destino, cacheado.distanceKm, cacheado.durationMin);
    return jsonResponse({ distanceKm: cacheado.distanceKm, durationMin: cacheado.durationMin, provider: "heigit", profile: PERFIL, cached: true });
  }

  // R14: so a partir daqui a chamada realmente vai gastar cota do HeiGIT — cache hit acima nunca conta.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "desconhecido";
  if (!ipPermitido(ip)) {
    return jsonResponse({ error: true, reason: "rate_limited" }, 429);
  }

  const apiKey = Deno.env.get("OPENROUTESERVICE_API_KEY");
  if (!apiKey) {
    // Mesmo principio ja usado no projeto pra outros segredos de servidor: sem segredo configurado,
    // devolve erro identificavel (nao 'sem rota') — o cliente cai no fallback Haversine, nada trava.
    return jsonResponse({ error: true, reason: "not_configured" }, 503);
  }

  const resultado = await chamarHeigit(apiKey, origem, destino);
  if (!resultado.ok) {
    // Status sempre 502 (Bad Gateway) independente do motivo — o cliente (routeDistanceService.js)
    // nao inspeciona o codigo, so a presenca de erro, entao um unico status uniforme e suficiente;
    // o motivo legivel vai no corpo (reason).
    return jsonResponse({ error: true, reason: resultado.reason }, 502);
  }

  const distanceKm = resultado.distM / 1000;
  const durationMin = resultado.durS / 60;
  cacheSet(chave, { distanceKm, durationMin });
  await gravarNoCache(storeId, origem, destino, distanceKm, durationMin);   // Onda 3.2

  return jsonResponse({ distanceKm, durationMin, provider: "heigit", profile: PERFIL, cached: false });
});
