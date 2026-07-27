/* address/hooks/useAddressSearch.js — REF-ADDRESS-01 (+ REF-ADDRESS-02 · Onda 5).
   Motor de estado do modal de endereço: aba ativa, pesquisa (texto/CEP/GPS/mapa), loading, "não
   encontrado", pino do mapa e handlers de confirmação. Antes tudo isso era ~10 useState + 7 handlers
   inline no AddressModal. Consolidar no hook: (a) tira TODA a lógica de estado da interface; (b) todo
   I/O passa por services (geocodingService/nominatim/viaCep) — o hook e os componentes não fazem `fetch`;
   (c) toda validação vem de validators/ e toda formatação de utils/. Cada handler reproduz EXATAMENTE o
   comportamento do call-site original (URLs, guardas, strings e payloads do onSelect inalterados).

   Onda 5a: `pickedItem` guarda a sugestão escolhida na aba de busca ANTES de confirmar — a aba passa a
   pedir número/complemento/referência como as outras 2, em vez de confirmar direto com o que o provedor
   devolveu (era exatamente a lacuna documentada no ADR §6/§0.2: número nunca devia depender só do que o
   geocoder "adivinhou"). `referencia` é novo e compartilhado pelas 3 abas (mesmo padrão que `cepNumero`/
   `complemento` já eram compartilhados entre CEP e Mapa).

   Onda 5b: `erro` substitui os `alert()` de GPS/localização por estado granular (ADR §7) — cada causa
   (GPS ausente, permissão negada, serviço indisponível, sem internet) tem tipo/mensagem próprios em
   addressErrors.js, prontos pra UI mostrar inline em vez de bloquear com um alert genérico. */

import { useState, useEffect, useCallback } from 'react';
import { geocoding } from '../services/geocodingService.js';
import { cepValido, queryValida, numeroPreenchido, respostaCepOk } from '../validators/addressValidators.js';
import {
  normalizarEndereco, curtaSugestao, curtaGps, curtaCep, linhaReversaMapa, linhaConfirmarMapa,
} from '../utils/addressFormat.js';
import { CENTRO_PADRAO, formatarCoord } from '../utils/coordinates.js';
import { criarErro, tipoErroGeolocalizacao } from '../utils/addressErrors.js';

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false; // SSR-safe: sem navigator = assume online

export function useAddressSearch({ onSelect }) {
  const [tab, setTab] = useState('search');          // search | cep | map
  const [query, setQuery] = useState('');
  const [complemento, setComplemento] = useState('');
  const [referencia, setReferencia] = useState('');
  const [pickedItem, setPickedItem] = useState(null); // sugestão escolhida na aba busca, pendente de número/complemento/referência
  const [suggestions, setSuggestions] = useState([]);
  const [status, setStatus] = useState('idle');      // idle|loading|found|notfound|gps
  const [erro, setErro] = useState(null);            // { tipo, mensagem } | null — ADR §7
  const [cepQuery, setCepQuery] = useState('');
  const [cepData, setCepData] = useState(null);
  const [cepNumero, setCepNumero] = useState('');
  const [mapPin, setMapPin] = useState({ lat: CENTRO_PADRAO.lat, lng: CENTRO_PADRAO.lng });
  const [mapAddr, setMapAddr] = useState('');

  /* Trocar de aba descarta qualquer erro pendente da aba anterior (evita mensagem "fantasma" ao voltar). */
  const mudarTab = useCallback((id) => { setTab(id); setErro(null); }, []);

  /* ── Busca por CEP (ViaCEP, debounce 400ms) ── */
  const buscarCEP = useCallback(async (cep) => {
    if (!cepValido(cep)) return;
    setStatus('loading');
    try {
      const d = await geocoding.porCep(cep);
      if (!respostaCepOk(d)) { setStatus('notfound'); setCepData(null); return; }
      setCepData(d);
      setStatus('found');
      setCepNumero('');
    } catch { setStatus('notfound'); setCepData(null); }
  }, []);
  useEffect(() => { const t = setTimeout(() => buscarCEP(cepQuery), 400); return () => clearTimeout(t); }, [cepQuery, buscarCEP]);

  /* Máscara + reset de estado ao digitar o CEP (idêntico ao onChange original da aba CEP). */
  const mudarCep = useCallback((valor) => {
    let v = valor.replace(/\D/g, '');
    if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5, 8);
    setCepQuery(v); setStatus('idle'); setCepData(null);
  }, []);

  /* ── Busca por texto (waterfall Mapbox->Nominatim->Photon->gazetteer, debounce 450ms) ──
     Onda 5b: checa navigator.onLine ANTES de tentar — sem internet é distinguível de "zero resultados"
     (o waterfall nunca lança, então sem esse check as duas causas ficariam indistinguíveis; ver ADR §7). */
  const searchAddress = useCallback(async (q) => {
    if (!queryValida(q)) { setSuggestions([]); setStatus('idle'); setErro(null); return; }
    if (!online()) { setSuggestions([]); setStatus('idle'); setErro(criarErro('sem_internet')); return; }
    setErro(null);
    setStatus('loading');
    try {
      const res = await geocoding.sugestoes(q);
      if (res.length > 0) { setSuggestions(res); setStatus('found'); }
      else { setSuggestions([]); setStatus('notfound'); }
    } catch { setSuggestions([]); setStatus('notfound'); }
  }, []);
  useEffect(() => { const t = setTimeout(() => searchAddress(query), 450); return () => clearTimeout(t); }, [query, searchAddress]);

  /* Editar o texto de novo depois de ter escolhido uma sugestão descarta a escolha (volta pras sugestões). */
  const mudarQuery = useCallback((v) => { setQuery(v); setPickedItem(null); }, []);

  /* ── GPS (geolocalização + reverse-geocode) — Onda 5b: erro granular (ADR §7) em vez de alert() genérico.
     Ao ACHAR a posição, o reverse-geocode continua tolerante (catch preserva o fallback de coordenadas
     cruas — comportamento intocado); só a falha em OBTER a posição (permissão/GPS/timeout) ganhou causa
     própria. */
  const usarGPS = useCallback(() => {
    setErro(null);
    if (!online()) { setErro(criarErro('sem_internet')); return; }
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setErro(criarErro('gps_desabilitado')); return; }
    setStatus('gps');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      try {
        const d = await geocoding.reverso(lat, lng);
        const a = d.address || {};
        const short = curtaGps(a, d);
        const n = normalizarEndereco(a);   // variante enxuta (GPS)
        onSelect(short + (n.bairro ? ' — ' + n.bairro : ''), { lat, lng, rua: n.rua, numero: n.numero, bairro: n.bairro, cidade: n.cidade, estado: n.estado, cep: n.cep });
      } catch { onSelect(formatarCoord(lat) + ', ' + formatarCoord(lng), { lat, lng }); }
    }, (posErro) => { setStatus('idle'); setErro(criarErro(tipoErroGeolocalizacao(posErro && posErro.code))); });
  }, [onSelect]);

  /* ── Selecionar uma sugestão da busca: guarda e pede número/complemento/referência (Onda 5) — não
     confirma mais direto com o `numero` que o provedor devolveu (era a lacuna do achado §0.2: número
     descartado em silêncio). Reseta os campos compartilhados (mesmo padrão de buscarCEP ao achar CEP). */
  const pick = useCallback((s) => {
    setPickedItem(s);
    setCepNumero('');
    setComplemento('');
    setReferencia('');
    setErro(null);
  }, []);
  const voltarParaSugestoes = useCallback(() => setPickedItem(null), []);

  /* ── Confirmar a sugestão escolhida na busca, com número/complemento/referência do usuário ── */
  const confirmSearch = useCallback(() => {
    if (!pickedItem) return;
    if (!numeroPreenchido(cepNumero)) { alert('Informe o número da residência.'); return; }
    const a = pickedItem.address || {};
    const n = normalizarEndereco(a, { completa: true });   // inclui quarter/municipality
    const numero = cepNumero.trim();
    const short = curtaSugestao({ ...n, numero }, pickedItem);
    onSelect(short, {
      lat: parseFloat(pickedItem.lat), lng: parseFloat(pickedItem.lon),
      rua: n.rua, numero, bairro: n.bairro, cidade: n.cidade, estado: n.estado, cep: n.cep,
      complemento, referencia, full: pickedItem.display_name,
      provider: pickedItem._provider || '', confidence: pickedItem._confidence || null,
    });
  }, [pickedItem, cepNumero, complemento, referencia, onSelect]);

  /* ── Confirmar endereço por CEP ── */
  const confirmCEP = useCallback(() => {
    if (!cepData || !numeroPreenchido(cepNumero)) { alert('Informe o número da residência.'); return; }
    const short = curtaCep(cepData, cepNumero, complemento);
    onSelect(short, {
      rua: cepData.logradouro, numero: cepNumero.trim(), bairro: cepData.bairro, cidade: cepData.localidade,
      estado: cepData.uf, cep: cepData.cep, complemento, referencia, provider: 'viacep', confidence: 'exact',
    });
  }, [cepData, cepNumero, complemento, referencia, onSelect]);

  /* ── Confirmar localização pelo mapa (número/complemento/referência sempre como campos próprios —
     antes só entravam embutidos no texto do label, nunca no meta estruturado) ── */
  const confirmMap = useCallback(async () => {
    const numero = cepNumero.trim();
    if (!mapAddr.trim() && !numero) {
      const d = await geocoding.reverso(mapPin.lat, mapPin.lng);
      const a = d.address || {};
      const n = normalizarEndereco(a);
      const addr = linhaConfirmarMapa(a);
      onSelect(addr || 'Localização no mapa', {
        lat: mapPin.lat, lng: mapPin.lng, rua: n.rua, bairro: n.bairro, cidade: n.cidade, estado: n.estado,
        cep: n.cep, complemento, referencia,
      });
    } else {
      onSelect(mapAddr || ('Lat ' + formatarCoord(mapPin.lat)), { lat: mapPin.lat, lng: mapPin.lng, numero, complemento, referencia });
    }
  }, [mapAddr, cepNumero, complemento, referencia, mapPin, onSelect]);

  /* ── Movimento do pino no mapa (dragend / click) — reverse-geocode + formatação ── */
  const aoArrastarPino = useCallback(async (lat, lng) => {
    setMapPin({ lat, lng });
    try {
      const d = await geocoding.reverso(lat, lng);
      const a = d.address || {};
      setMapAddr(linhaReversaMapa(a) || d.display_name?.split(',').slice(0, 3).join(',') || '');
    } catch { setMapAddr(''); }
  }, []);
  const aoClicarPino = useCallback(async (lat, lng) => {
    setMapPin({ lat, lng });
    try {
      const d = await geocoding.reverso(lat, lng);
      const a = d.address || {};
      setMapAddr(linhaReversaMapa(a) || '');
    } catch { setMapAddr(''); }
  }, []);

  return {
    tab, setTab: mudarTab,
    query, setQuery: mudarQuery,
    complemento, setComplemento,
    referencia, setReferencia,
    pickedItem, voltarParaSugestoes,
    suggestions, status, erro,
    cepQuery, cepData, cepNumero, setCepNumero,
    mapPin, mapAddr,
    mudarCep, usarGPS, pick, confirmSearch, confirmCEP, confirmMap, aoArrastarPino, aoClicarPino,
  };
}
