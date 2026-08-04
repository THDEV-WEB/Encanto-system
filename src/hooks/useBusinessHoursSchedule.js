/* hooks/useBusinessHoursSchedule.js — REF-BUSINESS-HOURS-04.
   Estado reativo do CRONOGRAMA semanal OFICIAL (documento completo: version/timezone/schedule/exceptions),
   para quem precisa do documento em si (nao so do status "aberto agora"): a grade de "Informacoes da loja"
   (SobreScreen) e o formulario do Admin (AdminBusinessHours). Pinta pelo cache em memoria na hora e PUXA o
   oficial (sincronizarCronograma) no mount, ao focar a aba e quando SCHEDULE_EVENT dispara (ex.: o admin
   salvou). Fonte de verdade = Supabase; o cache so evita flash. Espelha hooks/useCompanyInfo.js 1:1 (mesma
   estrategia, ja provada em produção). */
import { useState, useEffect } from 'react';
import { lerCronogramaCache, sincronizarCronograma, SCHEDULE_EVENT } from '../services/businessHours/index.js';

export function useBusinessHoursSchedule() {
  const [cronograma, setCronograma] = useState(lerCronogramaCache);
  useEffect(() => {
    let vivo = true;
    const puxar = () => { sincronizarCronograma().then((v) => { if (vivo) setCronograma(v); }); };  // RE-LE do servidor
    puxar();                                              // mount: puxa o oficial
    const onCache = () => setCronograma(lerCronogramaCache());  // SCHEDULE_EVENT: o cache ja foi atualizado localmente
    const onFoco  = () => puxar();                         // focar a aba / voltar visivel: re-sincroniza do banco
    window.addEventListener(SCHEDULE_EVENT, onCache);
    window.addEventListener('focus', onFoco);
    document.addEventListener('visibilitychange', onFoco);
    // aba aberta e parada (nunca perde foco): converge sozinha em ate 60s quando o admin muda o cronograma.
    const timer = setInterval(puxar, 60000);
    return () => {
      vivo = false;
      clearInterval(timer);
      window.removeEventListener(SCHEDULE_EVENT, onCache);
      window.removeEventListener('focus', onFoco);
      document.removeEventListener('visibilitychange', onFoco);
    };
  }, []);
  return cronograma;
}
