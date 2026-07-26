/* hooks/useCompanyInfo.js — REF-COMPANY-01. Estado reativo dos dados institucionais da empresa (config
   GLOBAL: nome, telefone, whatsapp, e-mail, toggle do botao flutuante). Pinta pelo cache em memoria na
   hora e PUXA o oficial (sincronizarCompanyInfo) no mount, ao focar a aba e quando COMPANY_INFO_EVENT
   dispara (ex.: o admin salvou). Fonte de verdade = Supabase; o cache so evita flash. Espelha
   hooks/useDeliveryEta.js 1:1 (mesma estrategia, ja provada em produção). */
import { useState, useEffect } from 'react';
import { lerCompanyInfoCache, sincronizarCompanyInfo, COMPANY_INFO_EVENT } from '../services/company/companyInfo.js';

export function useCompanyInfo() {
  const [info, setInfo] = useState(lerCompanyInfoCache);
  useEffect(() => {
    let vivo = true;
    const puxar = () => { sincronizarCompanyInfo().then((v) => { if (vivo) setInfo(v); }); };  // RE-LE do servidor
    puxar();                                             // mount: puxa o oficial
    const onCache = () => setInfo(lerCompanyInfoCache());  // COMPANY_INFO_EVENT: o cache ja foi atualizado localmente
    const onFoco  = () => puxar();                        // focar a aba / voltar visivel: re-sincroniza do banco
    window.addEventListener(COMPANY_INFO_EVENT, onCache);
    window.addEventListener('focus', onFoco);
    document.addEventListener('visibilitychange', onFoco);
    // aba aberta e parada (nunca perde foco): converge sozinha em ate 60s quando o admin muda o valor.
    const timer = setInterval(puxar, 60000);
    return () => {
      vivo = false;
      clearInterval(timer);
      window.removeEventListener(COMPANY_INFO_EVENT, onCache);
      window.removeEventListener('focus', onFoco);
      document.removeEventListener('visibilitychange', onFoco);
    };
  }, []);
  return info;
}
