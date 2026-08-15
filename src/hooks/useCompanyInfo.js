/* hooks/useCompanyInfo.js — REF-COMPANY-01. Estado reativo dos dados institucionais da empresa (config
   GLOBAL: nome, telefone, whatsapp, e-mail, toggle do botao flutuante). Pinta pelo cache em memoria na
   hora e PUXA o oficial (sincronizarCompanyInfo) no mount, ao focar a aba e quando COMPANY_INFO_EVENT
   dispara (ex.: o admin salvou). Fonte de verdade = Supabase; o cache so evita flash. Espelha
   hooks/useDeliveryEta.js 1:1 (mesma estrategia, ja provada em produção). */
import { useState, useEffect } from 'react';
import { lerCompanyInfoCache, sincronizarCompanyInfo, COMPANY_INFO_EVENT } from '../services/company/companyInfo.js';

/* REF-SAAS-02 · Onda 3 (investigacao banner "Sem imagem"): DEFAULT_COMPANY_INFO comeca com
   logoUrl/bannerUrl/faviconUrl = null -- ate a 1a sincronizacao com o servidor assentar (medido: ~700ms
   numa chamada fria), qualquer consumidor que so olhe `info.bannerUrl` nao consegue distinguir "ainda
   nao sei" de "confirmado vazio". Pra a maioria dos consumidores (texto, storefront) essa ambiguidade e'
   inofensiva -- mas o preview de imagem do Admin (ImageUploader) so tem 2 estados visuais (imagem OU
   "Sem imagem"), entao o mesmo gap aparece como um falso "Sem imagem" por uma fracao de segundo (ou mais,
   se a 1a chamada falhar em silencio -- sincronizarCompanyInfo cai pro cache sem re-tentar ate o proximo
   foco/60s). `carregado` deixa quem precisa (AdminEmpresa) esperar a 1a sincronizacao assentar antes de
   confiar no "vazio". useCompanyInfo() continua com o MESMO contrato de sempre (so `info`) -- nenhum dos
   18 chamadores existentes muda de comportamento. */
export function useCompanyInfoComEstado() {
  const [info, setInfo] = useState(lerCompanyInfoCache);
  const [carregado, setCarregado] = useState(false);
  useEffect(() => {
    let vivo = true;
    const puxar = () => { sincronizarCompanyInfo().then((v) => { if (vivo) { setInfo(v); setCarregado(true); } }); };  // RE-LE do servidor
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
  return { info, carregado };
}

export function useCompanyInfo() {
  return useCompanyInfoComEstado().info;
}
