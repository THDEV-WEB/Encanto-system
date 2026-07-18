/* components/nav/MobileCatStrip.jsx — REF-UI-CATEGORY-01 Fase 4.
   Navegacao DEFINITIVA do MOBILE (<768px): substitui completamente a busca+dropdown antigos do topo.
   Barra horizontal, leve, que surge abaixo do header ao rolar (mesmo gatilho da barra do desktop):
   - abas de categoria em texto puro, com scroll horizontal fluido ao toque (aparencia nativa);
   - categoria ativa destacada (sublinhado + acento Encanto), sincronizada com o scroll-spy;
   - a aba ativa se auto-centraliza no strip conforme o usuario rola a pagina;
   - lupa a direita: abre a busca (input nativo) no proprio strip; fechar volta as abas.
   Reaproveita activeId/onSelect do hook unico useCatalogNav (via StoreApp). Oculto no desktop (CSS). */
import React from 'react';
import { catSection } from '../../utils/catSection.js';

const IconeBusca = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
);
const IconeFechar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export function MobileCatStrip({ cats, activeId, onSelect, search, setSearch, visible }) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const stripRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const showSearch = searchOpen || !!search;

  /* Centraliza a aba ativa no strip conforme o scroll-spy muda (sem mexer no scroll da pagina). */
  React.useEffect(() => {
    if (showSearch) return;
    const strip = stripRef.current;
    if (!strip) return;
    const el = strip.querySelector('.mcs-tab.active');
    if (!el) return;
    const left = Math.max(0, el.offsetLeft - (strip.clientWidth - el.clientWidth) / 2);
    if (typeof strip.scrollTo === 'function') strip.scrollTo({ left, behavior: 'smooth' });
    else strip.scrollLeft = left;   // fallback p/ WebViews antigos (scrollTo objeto indisponivel)
  }, [activeId, showSearch]);

  /* Foca o input ao abrir a busca. */
  React.useEffect(() => { if (showSearch) inputRef.current?.focus(); }, [showSearch]);

  const fecharBusca = () => { setSearch(''); setSearchOpen(false); };

  return (
    <div className={`enc-mobile-strip ${visible ? 'visible' : ''}`} aria-hidden={!visible}>
      {showSearch ? (
        <div className="mcs-search">
          <span className="mcs-search-icon"><IconeBusca /></span>
          <input
            ref={inputRef}
            className="mcs-search-input"
            type="text"
            placeholder="Busque um item na loja"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className="mcs-search-close" aria-label="Fechar busca" onClick={fecharBusca}>
            <IconeFechar />
          </button>
        </div>
      ) : (
        <>
          <div className="mcs-tabs" ref={stripRef}>
            {cats.map(cat => {
              const ativo = catSection(cat) === activeId;
              return (
                <button
                  key={cat.id}
                  type="button"
                  aria-current={ativo ? 'true' : undefined}
                  className={`mcs-tab ${ativo ? 'active' : ''}`}
                  onClick={() => onSelect(cat)}>
                  {cat.nome}
                </button>
              );
            })}
          </div>
          <button type="button" className="mcs-lupa" aria-label="Buscar" onClick={() => setSearchOpen(true)}>
            <IconeBusca />
          </button>
        </>
      )}
    </div>
  );
}
