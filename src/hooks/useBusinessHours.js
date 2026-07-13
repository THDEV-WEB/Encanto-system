/* hooks/useBusinessHours.js — REF-BUSINESS-HOURS-01/02.
   Camada REATIVA sobre o engine puro (services/businessHours) e PONTO UNICO de consumo do estado da loja:
   Home, banner, checkout e painel Admin passam por aqui e recebem EXATAMENTE o mesmo resultado final.

   A decisao (cronograma + override AUTO/OPEN/CLOSED) e feita em resolverOverride — FONTE UNICA; este hook
   nao repete regra alguma, so orquestra reatividade: reavalia na virada de periodo/dia (tick 30s), ao
   focar a aba, e quando o Admin troca o modo (MODE_EVENT na mesma aba / evento 'storage' entre abas). */
import { useEffect, useState, useCallback } from 'react';
import { getStoreStatus, resolverOverride, lerModo, MODE_EVENT } from '../services/businessHours/index.js';

function calcular() {
  return resolverOverride(getStoreStatus(), lerModo());
}

/* Compara os campos que afetam a UI — se nada mudou, o tick mantem a MESMA referencia p/ o React
   descartar o re-render (inclui modo/forcado p/ reagir a troca de override do Admin na hora). */
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
    const tick = () => setEstado((prev) => { const next = calc(); return mesmoStatus(prev, next) ? prev : next; });
    tick(); // sincroniza no mount (cobre restauracao de sessao / troca de aba)
    const id = setInterval(tick, 30000); // vira periodo/dia sem reload
    const onVisivel = () => tick();
    window.addEventListener('focus', onVisivel);
    document.addEventListener('visibilitychange', onVisivel);
    window.addEventListener(MODE_EVENT, tick);   // Admin trocou o modo na MESMA aba
    window.addEventListener('storage', tick);    // ... ou em outra aba
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onVisivel);
      document.removeEventListener('visibilitychange', onVisivel);
      window.removeEventListener(MODE_EVENT, tick);
      window.removeEventListener('storage', tick);
    };
  }, [calc]);
  return estado;
}
