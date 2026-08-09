/* address/services/nominatimService.js — REF-ADDRESS-01 (+ REF-SAAS-01 · Onda 6.3).
   Cliente HTTP do Nominatim (OpenStreetMap): geocoding DIRETO (busca por texto, multi-estratégia) e
   REVERSO (coordenada -> endereço). FONTE ÚNICA dessas chamadas: o reverse-geocode estava DUPLICADO em
   4 pontos do AddressModal (dragend, click do mapa, GPS, confirmar-no-mapa) com a MESMA URL; a busca
   direta vivia inline em searchAddress. Camada de I/O pura, sem React. Host/endpoints BYTE-IGUAIS ao
   original (guardados por address.guard.mjs (2)) — comportamento inalterado nesse ponto.

   REF-SAAS-01 · Onda 6.3: o viés de cidade/UF (antes hardcoded "Timbó"/"SC") passa a vir do CHAMADOR
   (company_info.cidade/estado, já por loja) — ver useAddressSearch.js. Sem bias (loja sem endereço
   institucional configurado ainda), a busca degrada para nacional pura (countrycodes=br já escopa o
   país) e a estratégia 2 (busca estruturada por rua) é pulada por completo — precisa de `city=` pra
   fazer sentido. Para a Encanto (cidade/estado semeados na migration desta subfase), o resultado é
   byte-idêntico ao hardcoded anterior nas estratégias 1/3.

   Cache: memo em memória (por sessão), agora chaveado por query+cidade+estado (o mesmo texto de busca
   pode legitimamente devolver resultados diferentes dependendo do viés de cidade). Reverse memoiza por
   'lat,lng'; busca memoiza só quando há resultado (consulta vazia continua re-tentável). NUNCA é fonte
   de verdade (só espelha a resposta externa; re-derivável). */

import { chaveDedupe } from '../utils/addressFormat.js';   // regra única de dedupe (road+house_number)

const BASE = 'https://nominatim.openstreetmap.org';
const HEADERS = { 'Accept-Language': 'pt-BR' };   // BYTE-IGUAL ao original
const CACHE_MAX = 80;
const cacheBusca = new Map();     // 'query|cidade|estado' -> resultados (só quando não-vazio)
const cacheReverso = new Map();   // 'lat,lng' -> resposta bruta

function memoizar(mapa, chave, valor) {
  if (mapa.size >= CACHE_MAX) mapa.delete(mapa.keys().next().value);
  mapa.set(chave, valor);
}

/* GEOCODING DIRETO (busca por texto) — multi-estratégia idêntica ao AddressModal.searchAddress:
   (1) query completa + ", <cidade>, <estado>, Brasil" (quando há cidade); (2) por rua estruturada
   (street/city/state) quando há número + termo + cidade; (3) só o termo sem número + cidade/estado.
   Usa a PRIMEIRA estratégia que retornar algo (para no primeiro não-vazio) e deduplica por rua+número.
   Devolve o array bruto do Nominatim (já deduplicado). */
export async function buscarEnderecos(query, { cidade = '', estado = '' } = {}) {
  const q = query;
  const chaveCache = q + '|' + cidade + '|' + estado;
  const cacheado = cacheBusca.get(chaveCache);
  if (cacheado) return cacheado;
  const NOM = BASE + '/search';
  const numM = q.match(/(\d+)/);
  const num = numM ? numM[1] : '';
  const semN = q.replace(/\d+/g, '').replace(/[-,]/g, ' ').trim();
  const sufixoCidade = cidade ? ', ' + cidade + (estado ? ', ' + estado : '') + ', Brasil' : '';
  const urls = [
    NOM + '?format=json&q=' + encodeURIComponent(q + sufixoCidade) + '&limit=6&addressdetails=1&countrycodes=br',
    cidade && num && semN.length > 2
      ? NOM + '?format=json&street=' + encodeURIComponent(num + ' ' + semN) + '&city=' + encodeURIComponent(cidade) + (estado ? '&state=' + encodeURIComponent(estado) : '') + '&country=Brasil&format=json&addressdetails=1&limit=5'
      : null,
    cidade && semN.length > 3
      ? NOM + '?format=json&q=' + encodeURIComponent(semN + ', ' + cidade + (estado ? ', ' + estado : '')) + '&limit=5&addressdetails=1&countrycodes=br'
      : null,
  ].filter(Boolean);
  let res = [];
  for (const u of urls) { if (res.length > 0) break; const r = await fetch(u, { headers: HEADERS }); const d = await r.json(); res = Array.isArray(d) ? d : []; }
  const seen = new Set();
  res = res.filter((s) => { const k = chaveDedupe(s); if (seen.has(k)) return false; seen.add(k); return true; });
  if (res.length > 0) memoizar(cacheBusca, chaveCache, res);   // vazio não é memoizado (re-tentável)
  return res;
}

/* GEOCODING REVERSO (coordenada -> endereço). Devolve a resposta bruta do Nominatim (com .address).
   Lança em falha de rede — o chamador trata (os call-sites originais tinham try/catch próprio, exceto
   o confirmMap, que propagava; preservamos isso mantendo o try/catch no chamador). */
export async function reverso(lat, lng) {
  const chave = lat + ',' + lng;
  if (cacheReverso.has(chave)) return cacheReverso.get(chave);
  const r = await fetch(BASE + '/reverse?format=json&lat=' + lat + '&lon=' + lng + '&addressdetails=1', { headers: HEADERS });
  const d = await r.json();
  memoizar(cacheReverso, chave, d);
  return d;
}

export function _limparCacheNominatim() { cacheBusca.clear(); cacheReverso.clear(); }
