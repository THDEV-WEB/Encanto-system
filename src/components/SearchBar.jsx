/* ── SearchBar: campo de busca + sugestoes (REF-UI-SEARCH-01) ───────────────────────────────
   REF-UI-CATEGORY-01 F4 reduziu ao input; REF-UI-SEARCH-01 acopla a busca inteligente: enquanto digita,
   um dropdown de sugestoes agrupadas surge abaixo do input (via useSearchField + SearchSuggestions).
   Presentacional/fino: todo o comportamento vive nos hooks; aqui so o input + o dropdown. Usado na barra
   sticky do desktop/tablet (StickyBar). O input recebe os props prontos de useSearchField. */
import { useSearchField } from '../hooks/useSearchField.js';
import { SearchSuggestions } from './search/SearchSuggestions.jsx';

const VAZIO = { categorias: [], produtos: [], total: 0, tooShort: true };

export function SearchBar({ search, setSearch, placeholder = 'Buscar açaí, marmitas, combos...',
  suggestions = VAZIO, onPickCategory = () => {}, onPickProduct = () => {} }) {
  const { inputProps, boxVisible, suggestProps, wrapRef, limpar } = useSearchField({
    query: search, setQuery: setSearch, suggestions, onPickCategory, onPickProduct,
  });
  return (
    <div className="search-bar">
      <div className="search-wrapper" ref={wrapRef}>
        <div className="search-inner">
          <span className="search-icon" aria-hidden="true">
            {/* icone vetorial (estilo Lucide "search") — sem emoji, sem imagem; stroke = currentColor */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
          </span>
          <input
            placeholder={placeholder}
            aria-label="Buscar na loja"
            {...inputProps}
          />
          {search && (
            <button
              onClick={limpar}
              aria-label="Limpar busca"
              style={{color:'var(--gray-400)',fontSize:18,background:'none',border:'none',cursor:'pointer'}}>
              ✕
            </button>
          )}
        </div>
        {boxVisible && <SearchSuggestions {...suggestProps} />}
      </div>
    </div>
  );
}
