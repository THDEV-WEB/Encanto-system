import React from 'react';

/* ── SearchBar: dropdown de categorias robusto ──────────── */
export function SearchBar({ cats, search, setSearch, setSelCat }) {
  const [open, setOpen]     = React.useState(false);
  const wrapRef             = React.useRef(null);

  /* Fechar ao clicar fora do componente inteiro */
  React.useEffect(()=>{
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return ()=>{
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  /* Fechar ao pressionar ESC */
  React.useEffect(()=>{
    const esc = (e) => { if (e.key==='Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return ()=>document.removeEventListener('keydown', esc);
  }, []);

  const getCatSecId = (nome) => {
    const n = (nome||'').toLowerCase();
    if (n.includes('combo'))     return 'sec-combos';
    if (n.includes('batidinha')) return 'sec-batidinha';
    if (n.includes('destaque'))  return 'sec-destaques';
    if (n.includes('monte'))     return 'sec-monte';
    if (n.includes('pronto'))    return 'sec-prontos';
    if (n.includes('marmita'))   return 'sec-marmitas';
    if (n.includes('açaí')||n.includes('acai')) return 'sec-acai';
    if (n.includes('bebida'))    return 'sec-bebidas';
    return null;
  };

  const handleCatClick = (cat) => {
    setOpen(false);
    setSearch('');
    setSelCat(cat.id);
  };

  return (
    <div className="search-bar" ref={wrapRef}>
      <div className="search-wrapper">
        <div className="search-inner" onClick={()=>{ if(!search) setOpen(o=>!o); }}>
          <span className="search-icon">🔍</span>
          <input
            placeholder={open && !search ? 'Escolha uma categoria ou busque...' : 'Buscar açaí, marmitas, combos...'}
            value={search}
            onChange={e=>{
              setSearch(e.target.value);
              setSelCat(null);
              setOpen(false);
            }}
            onFocus={()=>{ if(!search) setOpen(true); }}
          />
          {search && (
            <button
              onClick={e=>{ e.stopPropagation(); setSearch(''); setOpen(false); }}
              style={{color:'var(--gray-400)',fontSize:18,background:'none',border:'none',cursor:'pointer'}}>
              ✕
            </button>
          )}
          {!search && (
            <span style={{
              fontSize:18,color:'var(--gray-400)',transition:'transform .2s',
              transform: open ? 'rotate(180deg)' : 'rotate(0)',
              lineHeight:1, flexShrink:0,
            }}>⌄</span>
          )}
        </div>

        {/* Dropdown — permanece aberto até clicar fora ou pressionar ESC */}
        {open && !search && (
          <div className="cat-dropdown" role="listbox" aria-label="Categorias">
            <div style={{
              padding:'8px 16px 6px',fontSize:11,fontWeight:700,
              color:'var(--gray-400)',letterSpacing:'.6px',textTransform:'uppercase',
              borderBottom:'1px solid var(--gray-100)',
            }}>
              Categorias
            </div>
            {cats.map(cat => (
              <div
                key={cat.id}
                className="cat-drop-item"
                role="option"
                tabIndex={0}
                /* mousedown antes do blur — não perde o foco antes de registrar o clique */
                onMouseDown={e=>e.preventDefault()}
                onClick={()=>handleCatClick(cat)}
                onKeyDown={e=>{ if(e.key==='Enter'||e.key===' ') handleCatClick(cat); }}
              >
                <span className="cat-drop-icon">{cat.icone||'🍽️'}</span>
                <span className="cat-drop-name">{cat.nome}</span>
                <span className="cat-drop-arrow">›</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
