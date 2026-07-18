/* hooks/useScrollSpy.js — REF-UI-CATEGORY-01 Fase 2. Hook NOVO de navegacao (nao altera hooks
   existentes de produto/categoria). Observa as secoes sec-* do catalogo e devolve o id da secao
   "ativa" — a que esta logo abaixo do header sticky — para o scroll-spy destacar a categoria atual.

   Abordagem: em vez de IntersectionObserver (rootMargin fragil com header de altura variavel), um
   handler de scroll rAF-throttled calcula, a cada quadro, qual e a ULTIMA secao cujo topo ja passou
   a "linha de deteccao" (logo abaixo do header). E deterministico, barato e suave; funciona com as
   secoes lazy (LazySection sempre renderiza o div externo, entao getElementById as encontra). Puro
   browser — nao entra no render.smoke (mesma politica da LazySection). */
import { useState, useEffect } from 'react';

export function useScrollSpy(ids) {
  const [active, setActive] = useState(null);
  const key = ids.join('|');
  useEffect(() => {
    if (!ids.length) { setActive(null); return; }
    const headerH = () => (document.querySelector('.header')?.offsetHeight || 0);
    let raf = 0;
    const compute = () => {
      raf = 0;
      const line = headerH() + 12;   // linha de deteccao logo abaixo do header sticky
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - line <= 0) current = id;   // secao ja cruzou a linha
      }
      /* perto do fim da pagina: secoes curtas podem nunca cruzar a linha -> forca a ultima. */
      if (window.innerHeight + Math.ceil(window.scrollY) >= document.documentElement.scrollHeight - 2) {
        current = ids[ids.length - 1];
      }
      setActive(prev => (prev === current ? prev : current));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps -- key resume o array de ids
  return active;
}
