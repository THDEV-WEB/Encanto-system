/* hooks/useBusinessHours.js — REF-BUSINESS-HOURS-01/02/03/04.
   Camada REATIVA sobre o engine puro e PONTO UNICO de consumo do estado da loja: Home, banner, checkout e
   Admin passam por aqui e recebem EXATAMENTE o mesmo resultado final. Interface publica (o objeto
   retornado) preservada integralmente na HB-04 — so a origem do CRONOGRAMA mudou (codigo -> banco);
   nenhum consumidor deste hook precisou ser alterado.

   HB-03: a fonte OFICIAL do modo (AUTO/OPEN/CLOSED) e o Supabase. HB-04: a fonte OFICIAL do CRONOGRAMA
   semanal (quais dias abrem, em quais horarios) tambem passa a ser o Supabase (cronograma.js), no lugar do
   SEMANA fixo em schedule.js. O hook pinta o estado na hora a partir dos CACHES locais (lerModoCache +
   lerCronogramaCache — sincronos, sem flash) e, em paralelo, PUXA os valores oficiais do Supabase
   (sincronizarModo + sincronizarCronograma) no mount, a cada tick (30s), ao focar a aba e via eventos.
   Assim varios navegadores/dispositivos convergem para o mesmo estado global. A decisao (OPEN>CLOSED>AUTO
   sobre o cronograma vigente) segue INTEIRAMENTE em resolverOverride/getStoreStatus (engine puro). */
import { useEffect, useState, useCallback } from 'react';
import {
  getStoreStatus, resolverOverride, semanaFromSchedule,
  lerModoCache, sincronizarModo, MODE_EVENT,
  lerCronogramaCache, sincronizarCronograma, SCHEDULE_EVENT,
} from '../services/businessHours/index.js';

function calcular() {
  const semana = semanaFromSchedule(lerCronogramaCache()); // null só se o cache estiver corrompido; getStoreStatus cai no fallback local
  return resolverOverride(getStoreStatus(new Date(), semana ?? undefined), lerModoCache());
}

/* Compara os campos que afetam a UI — se nada mudou, mantem a MESMA referencia p/ o React descartar o
   re-render (inclui modo/forcado p/ reagir a troca de override). */
function mesmoStatus(a, b) {
  return !!a && !!b
    && a.aberto === b.aberto
    && a.modo === b.modo
    && a.forcado === b.forcado
    && a.rotuloCurto === b.rotuloCurto
    && a.detalhe === b.detalhe
    && a.mensagemFechado === b.mensagemFechado
    && a.fechaAs === b.fechaAs;
}

export function useBusinessHours() {
  const calc = useCallback(calcular, []);
  const [estado, setEstado] = useState(calc);
  useEffect(() => {
    let vivo = true;
    const recompute = () => setEstado((prev) => { const next = calc(); return mesmoStatus(prev, next) ? prev : next; });
    const pull = () => { Promise.all([sincronizarModo(), sincronizarCronograma()]).finally(() => { if (vivo) recompute(); }); }; // busca modo + cronograma oficiais no Supabase
    recompute(); // pinta dos caches locais imediatamente (sem flash)
    pull();      // reconcilia com a fonte oficial (Supabase)
    const id = setInterval(() => { recompute(); pull(); }, 30000); // vira periodo/dia + re-sincroniza modo+cronograma
    const onVisivel = () => pull();
    window.addEventListener('focus', onVisivel);
    document.addEventListener('visibilitychange', onVisivel);
    window.addEventListener(MODE_EVENT, recompute);     // cache do modo mudou nesta aba (ex.: Admin salvou)
    window.addEventListener(SCHEDULE_EVENT, recompute); // cache do cronograma mudou nesta aba (ex.: Admin salvou)
    window.addEventListener('storage', recompute);      // ... ou em outra aba do mesmo navegador
    return () => {
      vivo = false;
      clearInterval(id);
      window.removeEventListener('focus', onVisivel);
      document.removeEventListener('visibilitychange', onVisivel);
      window.removeEventListener(MODE_EVENT, recompute);
      window.removeEventListener(SCHEDULE_EVENT, recompute);
      window.removeEventListener('storage', recompute);
    };
  }, [calc]);
  return estado;
}
