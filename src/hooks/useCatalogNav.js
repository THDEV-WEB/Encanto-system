/* hooks/useCatalogNav.js — REF-UI-CATEGORY-01 Fase 4. FONTE UNICA de estado de navegacao do catalogo,
   para NAO duplicar scroll-spy/rolagem entre as 3 superficies (dropdown do topo, barra sticky do
   desktop, strip do mobile). Chamado UMA vez (no StoreApp) e distribuido por props:
   - activeId: id da secao ativa (scroll-spy unico);
   - irParaCategoria(cat): rolagem suave ate a secao da categoria (mesma animacao para todas).
   Alvo do scroll via catSection (mesmo helper que gera os ids sec-*). Nao altera hooks de produto. */
import { useMemo, useCallback } from 'react';
import { catSection } from '../utils/catSection.js';
import { useScrollSpy } from './useScrollSpy.js';
import { useSmoothScrollToSection } from './useSmoothScrollToSection.js';

export function useCatalogNav(cats) {
  const ids = useMemo(() => cats.map(catSection), [cats]);
  const activeId = useScrollSpy(ids);
  const scrollToSection = useSmoothScrollToSection();
  const irParaCategoria = useCallback(
    (cat) => scrollToSection(document.getElementById(catSection(cat))),
    [scrollToSection]
  );
  return { activeId, irParaCategoria };
}
