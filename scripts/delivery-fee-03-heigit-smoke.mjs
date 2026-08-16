// scripts/delivery-fee-03-heigit-smoke.mjs — REF-DELIVERY-FEE-03.
// Teste REAL isolado do OpenRouteService/HeiGIT (chamada DIRETA, sem passar pela Edge Function) —
// usado na Fase 2 da REF para comprovar o caso Timbo->Indaial antes de qualquer implementacao.
// NAO cria pedido, NAO altera banco, NAO altera checkout. So mede a rota real.
// A chave e lida de .env.local (nunca de argumento de linha de comando/versionada) e NUNCA impressa
// (nem em log de erro). Rodar da raiz do projeto: node scripts/delivery-fee-03-heigit-smoke.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const envText = readFileSync(envPath, 'utf8');
const m = envText.match(/^OPENROUTESERVICE_API_KEY=(.+)$/m);
if (!m) { console.error('Chave nao encontrada em .env.local'); process.exit(1); }
const API_KEY = m[1].trim();

const ORIGEM = { lat: -26.850651757610454, lng: -49.28720263609122 };   // Rua Joao Schley, 77 - Timbo/SC
const DESTINO = { lat: -26.8959635, lng: -49.2570131 };                  // Rua Itajai, 357 - Indaial/SC
const HAVERSINE_KM = 5.861082242589043;

const PROFILE = 'driving-car';
const ENDPOINTS = [
  { nome: 'heigit (novo)', url: `https://api.heigit.org/openrouteservice/v2/directions/${PROFILE}` },
  { nome: 'openrouteservice.org (legado)', url: `https://api.openrouteservice.org/v2/directions/${PROFILE}` },
];

async function testarEndpoint(ep) {
  const body = { coordinates: [[ORIGEM.lng, ORIGEM.lat], [DESTINO.lng, DESTINO.lat]] };
  const t0 = Date.now();
  try {
    const r = await fetch(ep.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json, application/geo+json, application/gpx+xml',
        'Authorization': API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const ms = Date.now() - t0;
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    console.log(`\n=== ${ep.nome} ===`);
    console.log('URL:', ep.url);
    console.log('HTTP status:', r.status, r.statusText);
    console.log('Latencia:', ms, 'ms');
    if (!r.ok) {
      console.log('Corpo do erro (sem chave nele):', text.slice(0, 800));
      return null;
    }
    // v2 directions default response shape: { routes: [ { summary: { distance, duration }, ... } ] }
    // ou GeoJSON: { features: [ { properties: { summary: { distance, duration } } } ] }
    const rota = json?.routes?.[0] || json?.features?.[0]?.properties;
    const distM = rota?.summary?.distance;
    const durS = rota?.summary?.duration;
    console.log('Perfil usado:', PROFILE);
    console.log('Distancia (m):', distM);
    console.log('Distancia (km):', distM != null ? (distM / 1000).toFixed(3) : 'N/A');
    console.log('Duracao (s):', durS);
    console.log('Duracao (min):', durS != null ? (durS / 60).toFixed(1) : 'N/A');
    console.log('Numero de rotas/alternativas retornadas:', (json?.routes || json?.features || []).length);
    return { status: r.status, distM, durS, ms };
  } catch (e) {
    console.log(`\n=== ${ep.nome} ===`);
    console.log('URL:', ep.url);
    console.log('ERRO de rede/timeout:', e?.name, e?.message);
    return null;
  }
}

(async () => {
  console.log('Origem:', ORIGEM);
  console.log('Destino:', DESTINO);
  console.log('Haversine ja conhecido (km):', HAVERSINE_KM);
  let resultado = null;
  for (const ep of ENDPOINTS) {
    const r = await testarEndpoint(ep);
    if (r && r.distM != null) { resultado = { ...r, endpoint: ep.nome }; break; }
  }
  if (resultado) {
    const km = resultado.distM / 1000;
    const diffKm = km - HAVERSINE_KM;
    const diffPct = (diffKm / HAVERSINE_KM) * 100;
    console.log('\n=== COMPARACAO ===');
    console.log('Haversine (km):        ', HAVERSINE_KM.toFixed(3));
    console.log('HeiGIT rota real (km): ', km.toFixed(3));
    console.log('Diferenca (km):        ', diffKm.toFixed(3));
    console.log('Diferenca (%):         ', diffPct.toFixed(1) + '%');
    console.log('Endpoint que respondeu:', resultado.endpoint);
  } else {
    console.log('\nNenhum endpoint retornou uma rota valida.');
  }
})();
