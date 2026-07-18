/* hooks/useSmoothScrollToSection.js — REF-UI-CATEGORY-01 Fase 4 (extraido do CategoryNav p/ REUSO).
   Rolagem suave premium ate um elemento de secao, REAPROVEITADA por todas as superficies de navegacao
   (dropdown desktop, barra sticky, strip mobile) — nada de duplicar a animacao:
   - RE-alvo por quadro (corrige o crescimento das secoes lazy durante a rolagem) + snap final exato;
   - CEDE a input do usuario (wheel/touch/tecla) — nao "briga" com quem rola manualmente;
   - respeita prefers-reduced-motion; restaura scroll-behavior '' em QUALQUER saida (conclusao, novo
     alvo, input, desmontagem). Comportamento identico ao que estava no CategoryNav (F2/F3). */
import { useRef, useEffect, useCallback } from 'react';
import { navTopOffset } from './useScrollSpy.js';

const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

export function useSmoothScrollToSection() {
  const stopRef = useRef(null);
  useEffect(() => () => { stopRef.current?.(); }, []);

  return useCallback((el) => {
    if (!el) return;
    stopRef.current?.();   // encerra (e restaura) qualquer animacao anterior

    const offset = navTopOffset() + 12;
    const destino = () => Math.max(0, window.scrollY + el.getBoundingClientRect().top - offset);

    const reduz = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduz) {
      document.documentElement.style.scrollBehavior = '';
      window.scrollTo(0, destino());
      return;
    }

    const html = document.documentElement;
    html.style.scrollBehavior = 'auto';   // controlamos o easing quadro a quadro
    const startY = window.scrollY;
    const DURACAO = 520;
    let raf = 0, t0 = null;

    const parar = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      html.style.scrollBehavior = '';
      window.removeEventListener('wheel', parar);
      window.removeEventListener('touchstart', parar);
      window.removeEventListener('keydown', parar);
      stopRef.current = null;
    };
    stopRef.current = parar;
    window.addEventListener('wheel', parar, { passive: true });
    window.addEventListener('touchstart', parar, { passive: true });
    window.addEventListener('keydown', parar);

    const passo = (ts) => {
      if (t0 === null) t0 = ts;
      const p = Math.min(1, (ts - t0) / DURACAO);
      window.scrollTo(0, startY + (destino() - startY) * easeInOutCubic(p));
      if (p < 1) { raf = requestAnimationFrame(passo); }
      else { window.scrollTo(0, destino()); parar(); }
    };
    raf = requestAnimationFrame(passo);
  }, []);
}
