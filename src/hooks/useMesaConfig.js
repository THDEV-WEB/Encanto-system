/* hooks/useMesaConfig.js — REF-MESA-01 · Onda 2.
   Estado reativo da capacidade de Mesa da loja (habilitada/canal_qr/canal_admin). Pinta pelo cache em
   memoria na hora e PUXA o oficial (sincronizarMesaConfig) no mount, ao focar a aba e quando
   MESA_CONFIG_EVENT dispara. Espelha hooks/useDeliveryFeeConfig.js 1:1 (mesma estrategia, ja provada
   em producao). */
import { useState, useEffect } from 'react';
import { lerMesaConfigCache, sincronizarMesaConfig, MESA_CONFIG_EVENT } from '../services/mesa/mesaConfig.js';

export function useMesaConfig() {
  const [config, setConfig] = useState(lerMesaConfigCache);
  useEffect(() => {
    let vivo = true;
    const puxar = () => { sincronizarMesaConfig().then((v) => { if (vivo) setConfig(v); }); };
    puxar();
    const onCache = () => setConfig(lerMesaConfigCache());
    const onFoco  = () => puxar();
    window.addEventListener(MESA_CONFIG_EVENT, onCache);
    window.addEventListener('focus', onFoco);
    document.addEventListener('visibilitychange', onFoco);
    const timer = setInterval(puxar, 60000);
    return () => {
      vivo = false;
      clearInterval(timer);
      window.removeEventListener(MESA_CONFIG_EVENT, onCache);
      window.removeEventListener('focus', onFoco);
      document.removeEventListener('visibilitychange', onFoco);
    };
  }, []);
  return config;
}
