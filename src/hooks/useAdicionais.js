/* hooks/useAdicionais.js — REF-APP-01 · Onda 3 (move puro do App.jsx).
   Hook de adicionais: DS.getAds com fallback MOCK_ADS (domínio addons). Expõe o array `ads`.
   Consumidor de domínio (utils/addons) → listado na allowlist D1 do test:deps. */
import { useState, useEffect } from 'react';
import { DS } from '../services/DataService.js';
import { MOCK_ADS } from '../utils/addons.js';

export function useAdicionais() {
  const [ads, setAds] = useState([]);
  useEffect(()=>{
    // online → adicionais reais; null (offline/erro/sem dados) → fallback MOCK_ADS
    DS.getAds().then(d=>{ setAds(d ?? MOCK_ADS); });
  },[]);
  return ads;
}
