/* components/nav/MobileCatStrip.jsx — REF-UI-CATEGORY-01 Fase 4 (+ REF-UI-SEARCH-01).
   Navegacao DEFINITIVA do MOBILE (<768px): abas horizontais + lupa que surgem abaixo do topo ao rolar.
   - abas de categoria (texto puro, scroll horizontal fluido, aba ativa auto-centralizada pelo scroll-spy);
   - lupa abre o modo BUSCA no proprio strip: input + dropdown de SUGESTOES inteligentes (REF-UI-SEARCH-01,
     mesmo motor da barra do desktop via useSearchField/SearchSuggestions). Escolher uma sugestao rola ate
     o produto/secao no catalogo e VOLTA para as abas (encerra a busca). Oculto no desktop (CSS). */
import React from 'react';
import { catSection } from '../../utils/catSection.js';
import { useSearchField } from '../../hooks/useSearchField.js';
import { SearchSuggestions } from '../search/SearchSuggestions.jsx';

const VAZIO = { categorias: [], produtos: [], total: 0, tooShort: true };

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

export function MobileCatStrip({ cats, activeId, onSelect, search, setSearch, visible,
  suggestions = VAZIO, onPickCategory = () => {}, onPickProduct = () => {} }) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const stripRef = React.useRef(null);
  const showSearch = searchOpen || !!search;

  const fecharBusca = () => { setSearch(''); setSearchOpen(false); };
  const field = useSearchField({
    query: search, setQuery: setSearch, suggestions,
    onPickCategory, onPickProduct,
    onClosed: () => setSearchOpen(false),   // ao escolher: volta para as abas (o texto ja foi limpo)
  });

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

  return (
    <div className={`enc-mobile-strip ${visible ? 'visible' : ''}`} aria-hidden={!visible}>
      {showSearch ? (
        <div className="mcs-search" ref={field.wrapRef}>
          <span className="mcs-search-icon" aria-hidden="true"><IconeBusca /></span>
          <input
            {...field.inputProps}
            autoFocus
            className="mcs-search-input"
            type="text"
            placeholder="Busque um item na loja"
            aria-label="Buscar na loja"
          />
          <button type="button" className="mcs-search-close" aria-label="Fechar busca" onClick={fecharBusca}>
            <IconeFechar />
          </button>
          {field.boxVisible && <SearchSuggestions {...field.suggestProps} />}
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
