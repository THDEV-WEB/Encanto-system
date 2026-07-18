/* hooks/useScrollSpy.js — REF-UI-CATEGORY-01 Fase 2 (+ F3/F4). Hook NOVO de navegacao (nao altera
   hooks existentes de produto/categoria). Observa as secoes sec-* e devolve o id da secao "ativa" —
   a que esta logo abaixo da chrome fixa do topo — para o scroll-spy destacar a categoria atual.
   rAF-throttled; funciona com secoes lazy (LazySection sempre renderiza o div externo). Puro browser.

   navTopOffset(): FONTE UNICA da altura ocupada pela chrome fixa do topo = header sticky + a chrome de
   navegacao VISIVEL do breakpoint (barra sticky do desktop OU strip do mobile; so uma existe por vez).
   Usada aqui (linha do spy) e na rolagem suave (useSmoothScrollToSection), para o titulo pousar logo
   abaixo da chrome.

   CORRECAO DO MARCADOR (bug "Monte seu Copo"): a linha do spy = navTopOffset + 40, propositalmente
   ABAIXO do alvo do scroll (navTopOffset + 12). Assim a secao recem-navegada fica DENTRO da banda de
   deteccao e nunca na fronteira `top-line<=0` (onde um top fracionario a excluia). Escolha pura e
   testada em utils/scrollSpyPick.js (test:spy). */
import { useState, useEffect } from 'react';
import { pickActiveSection } from '../utils/scrollSpyPick.js';

export function navTopOffset() {
  const header = document.querySelector('.header');
  let h = header?.offsetHeight || 0;
  for (const sel of ['.enc-stickybar', '.enc-mobile-strip']) {
    const bar = document.querySelector(sel);
    if (bar && getComputedStyle(bar).display !== 'none') h += bar.offsetHeight;
  }
  return h;
}

export function useScrollSpy(ids) {
  const [active, setActive] = useState(null);
  const key = ids.join('|');
  useEffect(() => {
    if (!ids.length) { setActive(null); return; }
    let raf = 0;
    const compute = () => {
      raf = 0;
      const line = navTopOffset() + 40;   // 40 > alvo do scroll (+12): secao recem-navegada fica na banda, nao na fronteira
      const entries = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) entries.push({ id, top: el.getBoundingClientRect().top });
      }
      let current = pickActiveSection(entries, line) ?? ids[0];
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
