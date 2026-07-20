/* hooks/useScrollToProduct.js — REF-UI-SEARCH-01. Navegacao DIRETA a um produto do catalogo a partir
   de uma sugestao (req 5). REAPROVEITA a rolagem premium (useSmoothScrollToSection) — nada de duplicar
   a animacao — e integra com o Scroll Spy automaticamente (a propria rolagem atualiza a categoria ativa).

   LAZY: cada secao (LazySection) so monta os cards quando esta perto do viewport; um produto de secao
   distante ainda NAO tem card no DOM. Estrategia: (1) se o card ja existe, rola ate ele + realce;
   (2) senao, rola ate a SECAO (ancora sempre presente) para forcar a montagem e, num rAF-poll limitado,
   assim que o card aparece, refaz a rolagem exata + realce. O poll CEDE a input do usuario (wheel/touch/
   tecla) — igual a animacao: se o usuario assume a rolagem, o poll para e NAO puxa a pagina de volta.
   O realce e uma classe temporaria (.enc-flash) aplicada via DOM — NAO re-renderiza a lista (ProductCard
   e memoizado); o timer de remocao e guardado no proprio elemento e reiniciado em cliques repetidos. */
import { useCallback } from 'react';
import { useSmoothScrollToSection } from './useSmoothScrollToSection.js';

const FLASH_MS = 1500;
const POLL_MAX = 90;   // ~1.5s de margem a 60fps para a secao lazy montar o card

export function useScrollToProduct() {
  const scrollToEl = useSmoothScrollToSection();

  return useCallback((prodId, secId) => {
    const alvo = String(prodId);
    const acharCard = () => {
      const nodes = document.querySelectorAll('[data-prod]');
      for (const n of nodes) if (n.getAttribute('data-prod') === alvo) return n;
      return null;
    };
    const realcar = (el) => {
      clearTimeout(el._encFlashT);            // cancela um timer pendente do mesmo card (re-selecao rapida)
      el.classList.remove('enc-flash');
      void el.offsetWidth;                    // reflow: reinicia a animacao mesmo em cliques repetidos
      el.classList.add('enc-flash');
      el._encFlashT = setTimeout(() => el.classList.remove('enc-flash'), FLASH_MS);
    };

    const card = acharCard();
    if (card) { scrollToEl(card); realcar(card); return; }

    /* Card ainda nao montado: rola ate a secao (forca a montagem ao aproximar) e espera o card,
       cedendo a input do usuario (nao briga com quem rolou manualmente). */
    const sec = secId && document.getElementById(secId);
    if (sec) scrollToEl(sec);

    let cancelado = false;
    const cancelar = () => { cancelado = true; limpar(); };
    const limpar = () => {
      window.removeEventListener('wheel', cancelar);
      window.removeEventListener('touchstart', cancelar);
      window.removeEventListener('keydown', cancelar);
    };
    window.addEventListener('wheel', cancelar, { passive: true });
    window.addEventListener('touchstart', cancelar, { passive: true });
    window.addEventListener('keydown', cancelar);

    let tries = 0;
    const tick = () => {
      if (cancelado) return;                  // usuario assumiu a rolagem -> nao puxar a pagina
      const c = acharCard();
      if (c) { limpar(); scrollToEl(c); realcar(c); return; }
      if (++tries < POLL_MAX) requestAnimationFrame(tick);
      else limpar();
    };
    requestAnimationFrame(tick);
  }, [scrollToEl]);
}
