/* hooks/useAdicionais.js — REF-APP-01 · Onda 3 (move puro do App.jsx). Redesenhado na REF-PERF-03.
   Hook de adicionais: DS.getAds com fallback MOCK_ADS (domínio addons). Expõe o array `ads`.
   Consumidor de domínio (utils/addons) → listado na allowlist D1 do test:deps. */
import { useState, useEffect, useCallback } from 'react';
import { DS } from '../services/DataService.js';
import { MOCK_ADS } from '../utils/addons.js';
import { onStorefrontResolved, hasStorefrontSettled, storefrontResolutionSucceeded } from '../services/storefrontResolvedBus.js';

export function useAdicionais() {
  const [ads, setAds] = useState([]);

  const load = useCallback(() => {
    // online → adicionais reais; null (offline/erro/sem dados) → fallback MOCK_ADS
    DS.getAds().then(d=>{ setAds(d ?? MOCK_ADS); });
  }, []);

  /* REF-PERF-03: sem resolução de tenant bem-sucedida, nunca busca ao vivo sem filtro — cai direto
     no MOCK, mesmo princípio de useCategories/useProducts. */
  const usarMock = useCallback(() => { setAds(MOCK_ADS); }, []);

  /* REF-PERF-03: antes buscava no mount sem store_id e refazia quando a loja resolvia (2 fetches
     sempre). Agora espera o tenant resolver (ou falhar/expirar) antes do 1º fetch. */
  useEffect(() => {
    if (hasStorefrontSettled()) {
      if (storefrontResolutionSucceeded()) load(); else usarMock();
      return;
    }
    return onStorefrontResolved((ok) => { if (ok) load(); else usarMock(); });
  }, [load, usarMock]);

  return ads;
}
