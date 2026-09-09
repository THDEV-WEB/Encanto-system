/* hooks/usePagamentoConfig.js — REF-PAGAMENTO-01 · Onda 5.
   Estado reativo da capacidade de pagamento online da loja (habilitada + public_key). Pinta pelo
   cache em memoria na hora e PUXA o oficial (sincronizarPagamentoConfig) no mount, ao focar a aba e
   quando PAGAMENTO_CONFIG_EVENT dispara. Espelha hooks/useMesaConfig.js 1:1 (mesma estrategia, ja
   provada em producao). */
import { useState, useEffect } from 'react';
import { lerPagamentoConfigCache, sincronizarPagamentoConfig, PAGAMENTO_CONFIG_EVENT } from '../pagamento/services/pagamentoConfig.js';

export function usePagamentoConfig() {
  const [config, setConfig] = useState(lerPagamentoConfigCache);
  useEffect(() => {
    let vivo = true;
    const puxar = () => { sincronizarPagamentoConfig().then((v) => { if (vivo) setConfig(v); }); };
    puxar();
    const onCache = () => setConfig(lerPagamentoConfigCache());
    const onFoco  = () => puxar();
    window.addEventListener(PAGAMENTO_CONFIG_EVENT, onCache);
    window.addEventListener('focus', onFoco);
    document.addEventListener('visibilitychange', onFoco);
    const timer = setInterval(puxar, 60000);
    return () => {
      vivo = false;
      clearInterval(timer);
      window.removeEventListener(PAGAMENTO_CONFIG_EVENT, onCache);
      window.removeEventListener('focus', onFoco);
      document.removeEventListener('visibilitychange', onFoco);
    };
  }, []);
  return config;
}
