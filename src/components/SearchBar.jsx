/* ── SearchBar: campo de busca (somente-busca) ──────────────────────────────
   REF-UI-CATEGORY-01 Fase 4: o dropdown de categorias que existia aqui foi APOSENTADO junto com o
   modelo de filtro por selCat — a navegacao de categorias agora e 100% por scroll (CategoryNav /
   MobileCatStrip). Este componente ficou reduzido ao essencial: input nativo + limpar + icone SVG.
   Usado na barra sticky do desktop (StickyBar). Placeholder configuravel por prop. */
export function SearchBar({ search, setSearch, placeholder = 'Buscar açaí, marmitas, combos...' }) {
  return (
    <div className="search-bar">
      <div className="search-wrapper">
        <div className="search-inner">
          <span className="search-icon" aria-hidden="true">
            {/* icone vetorial (estilo Lucide "search") — sem emoji, sem imagem; stroke = currentColor */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
          </span>
          <input
            placeholder={placeholder}
            value={search}
            onChange={e=>setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={()=>setSearch('')}
              aria-label="Limpar busca"
              style={{color:'var(--gray-400)',fontSize:18,background:'none',border:'none',cursor:'pointer'}}>
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
