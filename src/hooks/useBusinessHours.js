/* hooks/useBusinessHours.js — REF-BUSINESS-HOURS-01.
   Camada REATIVA sobre o engine puro (services/businessHours): re-avalia o status ao virar de periodo/dia
   (tick) e ao voltar o foco a aba, sem exigir reload. Aqui — e SO aqui — mora a combinacao com o override
   manual do Admin (localStorage STORE_STATUS), mantendo o engine 100% puro/testavel.

   Regra do override (o HORARIO e a fonte de verdade sobre quando abre/fecha):
     - 'closed'  -> forca fechado (fechamento emergencial pelo Admin), mesmo dentro do horario.
     - 'open'/ausente -> segue o horario oficial (nao "forca aberto" fora do horario — isso contrariaria
        a fonte de verdade; abrir fora do padrao e papel das EXCECOES, ja estruturadas no schedule). */
import { useEffect, useState, useCallback } from 'react';
import { getStoreStatus } from '../services/businessHours/index.js';
import { STORAGE_KEYS } from '../constants/storage.js';

function overrideManual() {
  try { return localStorage.getItem(STORAGE_KEYS.STORE_STATUS); } catch { return null; }
}

function calcular() {
  const status = getStoreStatus();
  const forcadoFechado = overrideManual() === 'closed';
  if (!forcadoFechado) return { ...status, forcadoFechado: false };
  /* Override 'closed' dentro do horario: apresenta estado fechado coerente (o engine tinha textos de
     "aberto"); fora do horario o status ja vem fechado com o proximo horario correto. */
  if (status.aberto) {
    return {
      ...status, aberto: false, forcadoFechado: true, fechaAs: null, periodoAtual: null,
      rotuloCurto: 'Fechado', detalhe: 'Fechado no momento',
      mensagemFechado: 'Estamos fechados no momento. Tente novamente em instantes.',
    };
  }
  return { ...status, forcadoFechado: true };
}

/* Compara os campos que afetam a UI — se nada mudou, o tick mantem a MESMA referencia p/ o React
   descartar o re-render (senao cada tick/foco recriaria o objeto e re-renderizaria a toa). */
function mesmoStatus(a, b) {
  return !!a && !!b
    && a.aberto === b.aberto
    && a.forcadoFechado === b.forcadoFechado
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
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onVisivel);
      document.removeEventListener('visibilitychange', onVisivel);
    };
  }, [calc]);
  return estado;
}
