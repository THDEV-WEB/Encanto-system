/* components/search/SearchSuggestions.jsx — REF-UI-SEARCH-01. Painel de sugestoes (APRESENTACIONAL, sem
   estado/IO). Leve, nao ocupa a tela inteira (dropdown ancorado ao input). Agrupa em "Categorias" e
   "Produtos" (req 2); realca o trecho casado de forma discreta (req 4); e, quando nada casa, mostra um
   feedback elegante com acao de limpar (req 7). O indice ativo do teclado percorre os itens de forma
   plana (categorias primeiro, depois produtos), casando com useSuggestBox. */
import { catEmoji } from '../../utils/catalog.js';

/* Realca o trecho casado (parts = {before,hit,after}); sem parts, texto puro. */
function Realce({ parts, plain }) {
  if (!parts) return plain;
  return (<>{parts.before}<mark className="enc-suggest-hl">{parts.hit}</mark>{parts.after}</>);
}

export function SearchSuggestions({ categorias, produtos, total, tooShort, active, onHover, onPickCategory, onPickProduct, onLimpar }) {
  if (tooShort) return null;

  if (total === 0) {
    return (
      <div className="enc-suggest" role="listbox" aria-label="Sugestões de busca">
        <div className="enc-suggest-empty">
          <div className="enc-suggest-empty-ico" aria-hidden="true">🔍</div>
          <p className="enc-suggest-empty-msg">Nenhum produto encontrado.</p>
          <button type="button" className="enc-suggest-empty-btn" onClick={onLimpar}>Limpar busca</button>
        </div>
      </div>
    );
  }

  let idx = -1;   // indice plano (categorias, depois produtos) — casa com o teclado
  return (
    <div className="enc-suggest" role="listbox" aria-label="Sugestões de busca">
      {categorias.length > 0 && (
        <div className="enc-suggest-group">
          <div className="enc-suggest-group-title">Categorias</div>
          {categorias.map(c => {
            idx++; const i = idx;
            return (
              <button key={'c' + c.cat.id} type="button" role="option" aria-selected={active === i}
                className={`enc-suggest-item ${active === i ? 'active' : ''}`}
                onMouseEnter={() => onHover(i)} onClick={() => onPickCategory(c)}>
                <span className="enc-suggest-ico" aria-hidden="true">{catEmoji(c.cat.nome)}</span>
                <span className="enc-suggest-txt">
                  <span className="enc-suggest-name"><Realce parts={c.parts} plain={c.cat.nome} /></span>
                </span>
                <span className="enc-suggest-arrow" aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
      )}

      {produtos.length > 0 && (
        <div className="enc-suggest-group">
          <div className="enc-suggest-group-title">Produtos</div>
          {produtos.map(p => {
            idx++; const i = idx;
            return (
              <button key={'p' + p.prod.id} type="button" role="option" aria-selected={active === i}
                className={`enc-suggest-item ${active === i ? 'active' : ''}`}
                onMouseEnter={() => onHover(i)} onClick={() => onPickProduct(p)}>
                <span className="enc-suggest-ico" aria-hidden="true">{catEmoji(p.catNome || p.prod.nome)}</span>
                <span className="enc-suggest-txt">
                  <span className="enc-suggest-name"><Realce parts={p.nomeParts} plain={p.prod.nome} /></span>
                  {p.sub && <span className="enc-suggest-sub"><Realce parts={p.subParts} plain={p.sub} /></span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
