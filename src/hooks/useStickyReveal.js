/* hooks/useStickyReveal.js — REF-UI-CATEGORY-01 Fase 3. Hook de navegacao NOVO.
   (1) Mede a altura do header sticky e publica em --header-h (so quando muda): a barra sticky se
       posiciona logo ABAIXO do header via top:var(--header-h). Cobre mudanca por conteudo (pill de
       status) via ResizeObserver E por resize/orientacao via o proprio compute (para WebViews antigos
       sem ResizeObserver — alvo do projeto).
   (2) Devolve `revealed` = true quando o `anchorRef` (sentinela no topo do catalogo, logo apos o
       "Categorias v" da pagina) rolou para debaixo do header — gatilho de "surgir apos a rolagem".
       Histerese de 48px evita piscar no limiar. `trigger` (ex.: o estado de busca) re-sincroniza o
       calculo quando a sentinela monta/desmonta entre as visoes catalogo<->resultados.
   rAF-throttled. Puro browser (fora do render.smoke, como LazySection/scroll-spy). */
import { useState, useEffect } from 'react';

export function useStickyReveal(anchorRef, trigger) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const header = document.querySelector('.header');
    let lastH = -1;
    const setHeaderVar = () => {
      const h = header?.offsetHeight || 0;
      if (h !== lastH) { lastH = h; document.documentElement.style.setProperty('--header-h', h + 'px'); }
    };
    const ro = (header && typeof ResizeObserver === 'function') ? new ResizeObserver(setHeaderVar) : null;
    if (ro) ro.observe(header);

    let raf = 0;
    const compute = () => {
      raf = 0;
      setHeaderVar();                                   // cobre resize/orientacao (sem ResizeObserver)
      const el = anchorRef.current;
      const headerH = header?.offsetHeight || 0;
      setRevealed(prev => {
        if (!el) return false;                          // sentinela ausente (visao de resultados)
        const top = el.getBoundingClientRect().top;
        const next = prev ? (top <= headerH + 48) : (top <= headerH);   // histerese
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
      ro?.disconnect();
    };
  }, [anchorRef, trigger]);
  return revealed;
}
