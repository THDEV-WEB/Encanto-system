/* hooks/useSearchField.js — REF-UI-SEARCH-01. Cola a busca inteligente a QUALQUER campo de input,
   reaproveitada pela barra do desktop (SearchBar) e pelo strip do mobile (MobileCatStrip) — fonte unica
   do comportamento, sem duplicar. Junta o estado de interacao (useSuggestBox) com as acoes de escolha:
   - inputProps: value/onChange/onFocus/onKeyDown/ref prontos para o <input>;
   - boxVisible + suggestProps: o que o <SearchSuggestions> precisa;
   - wrapRef: envolve input + dropdown (fecha ao clicar fora);
   Ao ESCOLHER (categoria ou produto): dispara o handler (rolagem) e ENCERRA a busca naturalmente (req 6)
   — limpa o texto, fecha o dropdown, tira o foco e chama onClosed (ex.: mobile volta para as abas). */
import { useRef, useCallback } from 'react';
import { useSuggestBox } from './useSuggestBox.js';

export function useSearchField({ query, setQuery, suggestions, onPickCategory, onPickProduct, onClosed }) {
  const inputRef = useRef(null);
  const { categorias, produtos, total, tooShort } = suggestions;

  const encerrar = useCallback(() => {
    setQuery('');
    inputRef.current?.blur();
    onClosed?.();
  }, [setQuery, onClosed]);

  const pickCat = useCallback((c) => { onPickCategory(c); encerrar(); }, [onPickCategory, encerrar]);
  const pickProd = useCallback((p) => { onPickProduct(p); encerrar(); }, [onPickProduct, encerrar]);
  const pickAt = useCallback((i) => {
    /* guarda contra indice fora do intervalo (ex.: active momentaneamente obsoleto logo apos a lista
       encolher, antes do reset por effect) — evita escolher um item inexistente/undefined. */
    if (i < 0 || i >= categorias.length + produtos.length) return;
    if (i < categorias.length) pickCat(categorias[i]);
    else pickProd(produtos[i - categorias.length]);
  }, [categorias, produtos, pickCat, pickProd]);

  const box = useSuggestBox({ total, query, onPickAt: pickAt });

  const limpar = useCallback(() => { setQuery(''); box.close(); inputRef.current?.focus(); }, [setQuery, box]);

  const inputProps = {
    ref: inputRef,
    value: query,
    onChange: (e) => { setQuery(e.target.value); box.openBox(); },
    onFocus: () => box.openBox(),
    onKeyDown: box.onInputKeyDown,
  };
  const suggestProps = {
    categorias, produtos, total, tooShort,
    active: box.active, onHover: box.setActive,
    onPickCategory: pickCat, onPickProduct: pickProd, onLimpar: limpar,
  };

  return { inputProps, boxVisible: box.visible, suggestProps, wrapRef: box.wrapRef, limpar };
}
