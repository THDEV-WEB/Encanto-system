/* hooks/useBusinessHours.js — REF-BUSINESS-HOURS-01/02/03.
   Camada REATIVA sobre o engine puro e PONTO UNICO de consumo do estado da loja: Home, banner, checkout e
   Admin passam por aqui e recebem EXATAMENTE o mesmo resultado final.

   HB-03: a fonte OFICIAL do modo (AUTO/OPEN/CLOSED) e o Supabase. O hook pinta o estado na hora a partir do
   CACHE local (lerModoCache — sincrono, sem flash) e, em paralelo, PUXA o modo oficial do Supabase
   (sincronizarModo) no mount, a cada tick (30s), ao focar a aba e via eventos. Assim varios navegadores/
   dispositivos convergem para o mesmo estado global. A decisao (OPEN>CLOSED>AUTO) segue em resolverOverride. */
import { useEffect, useState, useCallback } from 'react';
import { getStoreStatus, resolverOverride, lerModoCache, sincronizarModo, MODE_EVENT } from '../services/businessHours/index.js';

function calcular() {
  return resolverOverride(getStoreStatus(), lerModoCache());
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
    const pull = () => { sincronizarModo().finally(() => { if (vivo) recompute(); }); }; // busca o modo oficial no Supabase
    recompute(); // pinta do cache local imediatamente (sem flash)
    pull();      // reconcilia com a fonte oficial (Supabase)
    const id = setInterval(() => { recompute(); pull(); }, 30000); // vira periodo/dia + re-sincroniza o modo
    const onVisivel = () => pull();
    window.addEventListener('focus', onVisivel);
    document.addEventListener('visibilitychange', onVisivel);
    window.addEventListener(MODE_EVENT, recompute); // cache do modo mudou nesta aba (ex.: Admin salvou)
    window.addEventListener('storage', recompute);  // ... ou em outra aba do mesmo navegador
    return () => {
      vivo = false;
      clearInterval(id);
      window.removeEventListener('focus', onVisivel);
      document.removeEventListener('visibilitychange', onVisivel);
      window.removeEventListener(MODE_EVENT, recompute);
      window.removeEventListener('storage', recompute);
    };
  }, [calc]);
  return estado;
}
