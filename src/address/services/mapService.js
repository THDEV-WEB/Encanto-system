/* address/services/mapService.js — REF-ADDRESS-01.
   Ciclo de vida do mapa Leaflet (carregado sob demanda do CDN unpkg). FONTE ÚNICA da inicialização do
   mapa: o AddressModal montava/limpava o Leaflet inline no efeito. Aqui isolamos a comunicação externa
   (injeção do CSS/JS) e a criação/destruição do mapa, para garantir os requisitos de MAPA da REF-ADDRESS-01:
   zero inicialização duplicada, zero vazamento de listeners e limpeza correta ao desmontar. URLs e
   parâmetros (tile, zoom, setTimeout de init) BYTE-IGUAIS ao original — aparência/comportamento visual
   inalterados. Sem React (recebe o elemento DOM e callbacks do componente). */

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export function leafletPronto() {
  return typeof window !== 'undefined' && !!window.L;
}

/* Garante o Leaflet disponível e chama `pronto()` quando window.L existir. Idempotente: se já está
   carregado, apenas agenda o callback (mesmo setTimeout(…,50) do original); senão injeta CSS+JS do CDN
   e chama no onload. Preserva EXATAMENTE o carregamento original. */
export function carregarLeaflet(pronto) {
  if (leafletPronto()) { setTimeout(pronto, 50); return; }
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = LEAFLET_CSS;
  document.head.appendChild(css);
  const js = document.createElement('script');
  js.src = LEAFLET_JS;
  js.onload = () => setTimeout(pronto, 50);
  document.head.appendChild(js);
}

/* Cria o mapa + camada de tiles + marcador arrastável e liga os handlers de pino. Devolve a instância
   (ou null se Leaflet/elemento ausentes — mesma guarda do original). Os callbacks reportam o movimento
   do pino ao componente (que faz reverse-geocode + formatação); no click, o marcador acompanha o ponto
   (igual ao original). Separar dragend/click preserva a pequena diferença de fallback de cada um. */
export function criarMapa(el, { lat, lng, zoom = 15, aoArrastar, aoClicar }) {
  if (!window.L || !el) return null;
  const map = window.L.map(el).setView([lat, lng], zoom);
  window.L.tileLayer(TILE_URL, { attribution: '© OpenStreetMap' }).addTo(map);
  const marker = window.L.marker([lat, lng], { draggable: true }).addTo(map);
  marker.on('dragend', (e) => { const p = e.target.getLatLng(); aoArrastar && aoArrastar(p.lat, p.lng); });
  map.on('click', (e) => { const { lat: la, lng: ln } = e.latlng; marker.setLatLng([la, ln]); aoClicar && aoClicar(la, ln); });
  return map;
}

/* Destrói a instância do mapa (remove listeners/DOM do Leaflet). Chamado no unmount do componente do
   mapa — fecha o vazamento que existia quando o Leaflet já estava carregado (o efeito antigo não
   registrava cleanup nesse caminho). */
export function destruirMapa(map) {
  if (map) map.remove();
}
