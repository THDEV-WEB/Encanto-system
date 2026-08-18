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
// PONTO DE CREDENCIAL (unico):
//   supabase secrets set OPENROUTESERVICE_API_KEY=...
// (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY nao sao usados aqui — esta funcao nao toca no banco.)
//
// CACHE: Map em memoria por isolate (mesma logica de src/services/delivery/routing/routeCache.js,
// MIRRORADA aqui de proposito — mesmo precedente de templates.ts espelhando messageTemplates.js,
// REF-ORDER-01 Parte 3. Mudou la, muda aqui). Chave SEMPRE inclui storeId (tenant-safe por
// construcao, nunca depende so das coordenadas nao colidirem entre lojas).
//
// FALLBACK: esta funcao NUNCA calcula Haversine — se o HeiGIT falhar/der timeout/nao achar rota,
// devolve erro (status != 200) e quem decide cair para Haversine e o CLIENTE
// (routeDistanceService.js), que ja tem origem/destino em maos e não precisa de rede para isso.

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

  return jsonResponse({ distanceKm, durationMin, provider: "heigit", profile: PERFIL, cached: false });
});
