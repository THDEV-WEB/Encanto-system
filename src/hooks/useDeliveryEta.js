/* hooks/useDeliveryEta.js — REF-DELIVERY-01. Estado reativo do tempo estimado de entrega (config GLOBAL).
   Pinta pelo cache em memoria na hora e PUXA o oficial (sincronizarEta) no mount, ao focar a aba e quando
   ETA_EVENT dispara (ex.: o admin salvou). Fonte de verdade = Supabase; o cache so evita flash. Um unico
   ponto de consumo (StoreApp) distribui o valor por props -> sem duplicacao (Single Source of Truth). */
import { useState, useEffect } from 'react';
import { lerEtaCache, sincronizarEta, ETA_EVENT } from '../services/delivery/deliveryEta.js';

export function useDeliveryEta() {
  const [eta, setEta] = useState(lerEtaCache);
  useEffect(() => {
    let vivo = true;
    const puxar = () => { sincronizarEta().then((v) => { if (vivo) setEta(v); }); };  // RE-LE do servidor
    puxar();                                             // mount: puxa o oficial
    const onCache = () => setEta(lerEtaCache());          // ETA_EVENT: o cache ja foi atualizado localmente
    const onFoco  = () => puxar();                        // focar a aba / voltar visivel: re-sincroniza do banco
    window.addEventListener(ETA_EVENT, onCache);
    window.addEventListener('focus', onFoco);
    document.addEventListener('visibilitychange', onFoco);
    return () => {
      vivo = false;
      window.removeEventListener(ETA_EVENT, onCache);
      window.removeEventListener('focus', onFoco);
      document.removeEventListener('visibilitychange', onFoco);
    };
  }, []);
  return eta;
}
