/* components/nav/StickyBar.jsx — REF-UI-CATEGORY-01 Fase 3 (refino UX).
   Barra sticky do DESKTOP/TABLET que SURGE no TOPO (top:0) apos a rolagem. Com o header nao-sticky
   (rola junto e sai da viewport), esta barra e o UNICO elemento fixo do topo. Leve, altura minima,
   entrada/saida discreta (classe .visible + transicao no CSS). Oculta em telas <768px (strip mobile, Fase 4).

   Conteudo (D4 + plano): identidade REDUZIDA do Encanto (logo + nome) | "Categorias v" (CategoryNav,
   mesmo componente/scroll da Fase 2) | busca (SearchBar em modo somente-busca — a busca migrou do topo
   para ca). Durante uma busca ativa o "Categorias v" some (nao ha secoes p/ rolar): sobra logo + busca.

   position:fixed -> nao empurra o layout; o desconto dessa altura no scroll-to fica no navTopOffset. */
import React from 'react';
import { LOGO } from '../../lib/supabase.js';
import { CategoryNav } from './CategoryNav.jsx';
import { SearchBar } from '../SearchBar.jsx';

export function StickyBar({ cats, activeId, onSelect, search, setSearch, visible }) {
  return (
    <div className={`enc-stickybar ${visible ? 'visible' : ''}`} aria-hidden={!visible}>
      <div className="enc-stickybar-inner">
        {/* REF-UI-CATEGORY-01 Fase 3.1: identidade reduzida = SO a logo (o nome "Encanto" ja esta no
            header principal; repeti-lo so ocupava espaco). */}
        <div className="enc-stickybar-brand">
          {LOGO && <img src={LOGO} alt="Encanto" className="enc-stickybar-logo" loading="lazy" />}
        </div>

        {!search && <CategoryNav cats={cats} activeId={activeId} onSelect={onSelect} />}

        <div className="enc-stickybar-search">
          <SearchBar
            search={search}
            setSearch={setSearch}
            placeholder="Busque um item na loja"
          />
        </div>
      </div>
    </div>
  );
}
