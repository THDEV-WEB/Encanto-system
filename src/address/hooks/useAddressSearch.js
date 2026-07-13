/* address/hooks/useAddressSearch.js — REF-ADDRESS-01.
   Motor de estado do modal de endereço: aba ativa, pesquisa (texto/CEP/GPS/mapa), loading, "não
   encontrado", pino do mapa e handlers de confirmação. Antes tudo isso era ~10 useState + 7 handlers
   inline no AddressModal. Consolidar no hook: (a) tira TODA a lógica de estado da interface; (b) todo
   I/O passa por services (geocodingService/nominatim/viaCep) — o hook e os componentes não fazem `fetch`;
   (c) toda validação vem de validators/ e toda formatação de utils/. Cada handler reproduz EXATAMENTE o
   comportamento do call-site original (URLs, guardas, strings e payloads do onSelect inalterados). */

import { useState, useEffect, useCallback } from 'react';
import { geocoding } from '../services/geocodingService.js';
import { cepValido, queryValida, numeroPreenchido, respostaCepOk } from '../validators/addressValidators.js';
import {
  normalizarEndereco, curtaSugestao, curtaGps, curtaCep, linhaReversaMapa, linhaConfirmarMapa,
} from '../utils/addressFormat.js';
import { CENTRO_PADRAO, formatarCoord } from '../utils/coordinates.js';

export function useAddressSearch({ onSelect }) {
  const [tab, setTab] = useState('search');          // search | cep | map
  const [query, setQuery] = useState('');
  const [complemento, setComplemento] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [status, setStatus] = useState('idle');      // idle|loading|found|notfound|gps
  const [cepQuery, setCepQuery] = useState('');
  const [cepData, setCepData] = useState(null);
  const [cepNumero, setCepNumero] = useState('');
  const [mapPin, setMapPin] = useState({ lat: CENTRO_PADRAO.lat, lng: CENTRO_PADRAO.lng });
  const [mapAddr, setMapAddr] = useState('');

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

  /* ── Busca por texto (Nominatim, debounce 450ms) ── */
  const searchAddress = useCallback(async (q) => {
    if (!queryValida(q)) { setSuggestions([]); setStatus('idle'); return; }
    setStatus('loading');
    try {
      const res = await geocoding.sugestoes(q);
      if (res.length > 0) { setSuggestions(res); setStatus('found'); }
      else { setSuggestions([]); setStatus('notfound'); }
    } catch { setSuggestions([]); setStatus('notfound'); }
  }, []);
  useEffect(() => { const t = setTimeout(() => searchAddress(query), 450); return () => clearTimeout(t); }, [query, searchAddress]);

  /* ── GPS (geolocalização + reverse-geocode) ── */
  const usarGPS = useCallback(() => {
    if (!navigator.geolocation) { alert('GPS indisponível.'); return; }
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
    }, () => { setStatus('idle'); alert('Não foi possível obter a localização.'); });
  }, [onSelect]);

  /* ── Selecionar uma sugestão da busca ── */
  const pick = useCallback((s) => {
    const a = s.address || {};
    const n = normalizarEndereco(a, { completa: true });   // inclui quarter/municipality
    const short = curtaSugestao(n, s);
    onSelect(short, { lat: parseFloat(s.lat), lng: parseFloat(s.lon), rua: n.rua, numero: n.numero, bairro: n.bairro, cidade: n.cidade, estado: n.estado, cep: n.cep, full: s.display_name });
  }, [onSelect]);

  /* ── Confirmar endereço por CEP ── */
  const confirmCEP = useCallback(() => {
    if (!cepData || !numeroPreenchido(cepNumero)) { alert('Informe o número da residência.'); return; }
    const short = curtaCep(cepData, cepNumero, complemento);
    onSelect(short, { rua: cepData.logradouro, numero: cepNumero.trim(), bairro: cepData.bairro, cidade: cepData.localidade, estado: cepData.uf, cep: cepData.cep, complemento });
  }, [cepData, cepNumero, complemento, onSelect]);

  /* ── Confirmar localização pelo mapa ── */
  const confirmMap = useCallback(async () => {
    if (!mapAddr.trim() && !cepNumero.trim()) {
      const d = await geocoding.reverso(mapPin.lat, mapPin.lng);
      const a = d.address || {};
      const addr = linhaConfirmarMapa(a);
      onSelect(addr || 'Localização no mapa', { lat: mapPin.lat, lng: mapPin.lng });
    } else {
      onSelect(mapAddr || ('Lat ' + formatarCoord(mapPin.lat)), { lat: mapPin.lat, lng: mapPin.lng });
    }
  }, [mapAddr, cepNumero, mapPin, onSelect]);

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
    tab, setTab,
    query, setQuery,
    complemento, setComplemento,
    suggestions, status,
    cepQuery, cepData, cepNumero, setCepNumero,
    mapPin, mapAddr,
    mudarCep, usarGPS, pick, confirmCEP, confirmMap, aoArrastarPino, aoClicarPino,
  };
}
