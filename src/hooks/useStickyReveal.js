/* hooks/useStickyReveal.js — REF-UI-CATEGORY-01 Fase 3 (revisado no refino UX: header nao-sticky).
   Devolve `revealed` = true quando o `anchorRef` (sentinela no topo do catalogo, logo apos o
   "Categorias v" da pagina) chega ao topo da viewport — gatilho de "a barra de categorias assume o
   topo". Como o header agora ROLA JUNTO (nao e mais sticky, nem publica altura), o limiar e medido
   contra a altura da PROPRIA barra que vai surgir (navTopOffset), nao mais contra o header — assim o
   surgimento coincide com o momento em que o "Categorias v" da pagina cruza o topo, sem salto.
   Histerese (~48px) evita piscar no limiar. `trigger` (ex.: estado de busca) re-sincroniza quando a
   sentinela monta/desmonta entre catalogo<->resultados. rAF-throttled. Puro browser. */
import { useState, useEffect } from 'react';
import { navTopOffset } from './useScrollSpy.js';

export function useStickyReveal(anchorRef, trigger) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      const el = anchorRef.current;
      setRevealed(prev => {
        if (!el) return false;                          // sentinela ausente (visao de resultados)
        const top = el.getBoundingClientRect().top;
        const base = navTopOffset();                    // altura da barra que assume o topo (~57/48)
        const next = prev ? (top <= base + 56) : (top <= base + 8);   // histerese ~48px
        return prev === next ? prev : next;
      });
    };
    const onScrollResize = () => { if (!raf) raf = requestAnimationFrame(compute); };
    compute();
    window.addEventListener('scroll', onScrollResize, { passive: true });
    window.addEventListener('resize', onScrollResize, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScrollResize);
      window.removeEventListener('resize', onScrollResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [anchorRef, trigger]);
  return revealed;
}
