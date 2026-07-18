/* components/nav/CategoryNav.jsx — REF-UI-CATEGORY-01 Fase 2 (refatorado na F4).
   Seletor "Categorias v" (desktop/tablet) que substitui a antiga grade. Texto puro, identidade Encanto.
   A F4 moveu o scroll-spy e a rolagem suave para o hook unico useCatalogNav (StoreApp), evitando
   3 instancias de scroll-spy: este componente agora RECEBE `activeId` (categoria ativa) e `onSelect`
   (rola ate a secao) por prop, alem de um `className` opcional (a instancia da PAGINA recebe
   'catnav-docked' para sumir quando a barra sticky assume o topo — evita dois "Categorias" na tela).
   Mantem apenas a UX do dropdown: abrir/fechar, clique-fora, ESC, setas, foco no item ativo. No MOBILE
   fica oculto (CSS) — la a navegacao e o strip (MobileCatStrip). */
import React from 'react';
import { catSection } from '../../utils/catSection.js';

export function CategoryNav({ cats, activeId, onSelect, className = '' }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const menuId = React.useId();   // id unico (ha 2 instancias: topo da pagina + barra sticky)

  /* Fechar ao clicar fora */
  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  /* Fechar com ESC (e devolver o foco ao gatilho) */
  React.useEffect(() => {
    if (!open) return;
    const esc = (e) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  /* Ao abrir, leva o foco ao item ativo (ou ao primeiro) */
  React.useEffect(() => {
    if (!open || !menuRef.current) return;
    const alvo = menuRef.current.querySelector('.catnav-item.active') || menuRef.current.querySelector('.catnav-item');
    alvo?.focus();
  }, [open]);

  const go = (cat) => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    onSelect(cat);
  };

  /* Navegacao por setas entre os itens */
  const onMenuKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const itens = Array.from(menuRef.current?.querySelectorAll('.catnav-item') || []);
    if (!itens.length) return;
    e.preventDefault();
    const atual = itens.indexOf(document.activeElement);
    let prox = atual;
    if (e.key === 'ArrowDown') prox = atual < itens.length - 1 ? atual + 1 : 0;
    else if (e.key === 'ArrowUp') prox = atual > 0 ? atual - 1 : itens.length - 1;
    else if (e.key === 'Home') prox = 0;
    else if (e.key === 'End') prox = itens.length - 1;
    itens[prox]?.focus();
  };

  if (!cats.length) return null;

  return (
    <div className={`catnav ${className}`.trim()} ref={wrapRef}>
      <div className="catnav-anchor">
        <button
          ref={triggerRef}
          type="button"
          className="catnav-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen(o => !o)}>
          <span className="catnav-trigger-label">Categorias</span>
          <span className={`catnav-chevron ${open ? 'open' : ''}`} aria-hidden="true">⌄</span>
        </button>

        {open && (
          <div
            id={menuId}
            ref={menuRef}
            className="catnav-menu"
            role="listbox"
            aria-label="Categorias"
            onKeyDown={onMenuKeyDown}>
            {cats.map(cat => {
              const ativo = catSection(cat) === activeId;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="option"
                  aria-selected={ativo}
                  className={`catnav-item ${ativo ? 'active' : ''}`}
                  onClick={() => go(cat)}>
                  <span className="catnav-item-name">{cat.nome}</span>
                  <span className="catnav-item-arrow" aria-hidden="true">›</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
