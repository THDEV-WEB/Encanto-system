/* hooks/useAdicionais.js — REF-APP-01 · Onda 3 (move puro do App.jsx).
   Hook de adicionais: DS.getAds com fallback MOCK_ADS (domínio addons). Expõe o array `ads`.
   Consumidor de domínio (utils/addons) → listado na allowlist D1 do test:deps. */
import { useState, useEffect, useCallback } from 'react';
import { DS } from '../services/DataService.js';
import { MOCK_ADS } from '../utils/addons.js';
import { onStorefrontResolved } from '../services/storefrontResolvedBus.js';

export function useAdicionais() {
  const [ads, setAds] = useState([]);
  const load = useCallback(() => {
    // online → adicionais reais; null (offline/erro/sem dados) → fallback MOCK_ADS
    DS.getAds().then(d=>{ setAds(d ?? MOCK_ADS); });
  }, []);
  useEffect(()=>{ load(); },[load]);

  /* REF-PROD-GOLIVE-01 (fecha CHECKOUT-TENANT-02): se a 1a carga acima ocorreu ANTES da loja
     resolver por dominio, pode ter vindo sem filtro de store_id. Refaz a busca quando a resolucao
     chegar depois — no maximo 1x extra por sessao. */
  useEffect(() => onStorefrontResolved(() => load()), [load]);

  return ads;
}
