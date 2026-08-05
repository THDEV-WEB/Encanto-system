/* hooks/useDeliveryFeeConfig.js — REF-DELIVERY-FEE-01.
   Estado reativo da configuracao OFICIAL da taxa de entrega automatica por distancia (config GLOBAL:
   ativo, maquininha, faixas). Pinta pelo cache em memoria na hora e PUXA o oficial
   (sincronizarDeliveryFeeConfig) no mount, ao focar a aba e quando DELIVERY_FEE_EVENT dispara (ex.: o admin
   salvou). Fonte de verdade = Supabase; o cache so evita flash. Espelha hooks/useBusinessHoursSchedule.js
   1:1 (mesma estrategia, ja provada em produção). */
import { useState, useEffect } from 'react';
import { lerDeliveryFeeConfigCache, sincronizarDeliveryFeeConfig, DELIVERY_FEE_EVENT } from '../services/delivery/deliveryFeeConfig.js';

export function useDeliveryFeeConfig() {
  const [config, setConfig] = useState(lerDeliveryFeeConfigCache);
  useEffect(() => {
    let vivo = true;
    const puxar = () => { sincronizarDeliveryFeeConfig().then((v) => { if (vivo) setConfig(v); }); };  // RE-LE do servidor
    puxar();                                              // mount: puxa o oficial
    const onCache = () => setConfig(lerDeliveryFeeConfigCache());  // DELIVERY_FEE_EVENT: o cache ja foi atualizado localmente
    const onFoco  = () => puxar();                        // focar a aba / voltar visivel: re-sincroniza do banco
    window.addEventListener(DELIVERY_FEE_EVENT, onCache);
    window.addEventListener('focus', onFoco);
    document.addEventListener('visibilitychange', onFoco);
    // aba aberta e parada (nunca perde foco): converge sozinha em ate 60s quando o admin muda a config.
    const timer = setInterval(puxar, 60000);
    return () => {
      vivo = false;
      clearInterval(timer);
      window.removeEventListener(DELIVERY_FEE_EVENT, onCache);
      window.removeEventListener('focus', onFoco);
      document.removeEventListener('visibilitychange', onFoco);
    };
  }, []);
  return config;
}
