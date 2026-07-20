/* hooks/useSuggestBox.js — REF-UI-SEARCH-01. Estado de INTERACAO do dropdown de sugestoes (aberto/fechado,
   item ativo por teclado, fechar ao clicar fora). Sem UI e sem dados — so o comportamento, reutilizavel
   nas duas superficies de busca (barra do desktop e strip do mobile).
   - visible: aberto E query >= minLen (dropdown so aparece com texto suficiente);
   - teclado: setas navegam o indice ativo (cicla), Enter escolhe, Esc fecha + blur;
   - active reseta quando a query muda; clicar fora (mouse/touch) fecha. */
import { useState, useRef, useEffect, useCallback } from 'react';

export function useSuggestBox({ total, query, onPickAt, minLen = 2 }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);
  const visible = open && (query || '').trim().length >= minLen;

  /* reset do destaque a cada mudanca de texto */
  useEffect(() => { setActive(-1); }, [query]);

  /* fechar ao clicar/tocar fora do wrapper (input + dropdown) */
  useEffect(() => {
    if (!visible) return;
    const fora = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('touchstart', fora, { passive: true });
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('touchstart', fora);
    };
  }, [visible]);

  const openBox = useCallback(() => setOpen(true), []);
  const close = useCallback(() => { setOpen(false); setActive(-1); }, []);

  const onInputKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { setOpen(false); setActive(-1); e.currentTarget.blur?.(); return; }
    if (!total) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => (a + 1) % total); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(a => (a <= 0 ? total - 1 : a - 1)); }
    else if (e.key === 'Enter') { if (active >= 0 || total > 0) { e.preventDefault(); onPickAt(active >= 0 ? active : 0); } }
  }, [total, active, onPickAt]);

  return { visible, openBox, close, active, setActive, onInputKeyDown, wrapRef };
}
