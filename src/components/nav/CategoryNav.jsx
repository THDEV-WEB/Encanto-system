/* components/nav/CategoryNav.jsx — REF-UI-CATEGORY-01 Fase 2.
   Seletor "Categorias v" do DESKTOP/TABLET que SUBSTITUI a antiga grade de chips. Navegacao por
   SCROLL (nao filtra): clicar rola suavemente ate a secao da categoria; o scroll-spy (useScrollSpy)
   destaca automaticamente a categoria ativa conforme o usuario rola. Texto puro (sem emoji/icone),
   identidade Encanto. No MOBILE fica oculto (CSS) — o strip horizontal chega na Fase 4.

   O componente recebe SO as categorias VISIVEIS (que tem secao renderizada) — o pai filtra por
   disponibilidade, entao a lista nunca oferece um destino inexistente (sem clique morto).

   Fonte unica do alvo: catSection(cat) (o MESMO helper que o catalogo usa p/ gerar os ids sec-*),
   garantindo que o alvo do scroll == o id efetivamente renderizado.

   Rolagem premium: animacao propria (easeInOutCubic) que RECALCULA o destino a cada quadro. Isso
   corrige o "undershoot" das secoes lazy (LazySection troca um placeholder de 240px pelo conteudo
   real durante a rolagem, empurrando o alvo) e evita qualquer salto. Respeita prefers-reduced-motion. */
import React from 'react';
import { catSection } from '../../utils/catSection.js';
import { useScrollSpy, navTopOffset } from '../../hooks/useScrollSpy.js';

const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

export function CategoryNav({ cats }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const stopRef = React.useRef(null);   // funcao que encerra a animacao de scroll em curso (se houver)
  const menuId = React.useId();         // id unico (ha 2 instancias: topo da pagina + barra sticky)

  const ids = React.useMemo(() => cats.map(catSection), [cats]);
  const activeId = useScrollSpy(ids);

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

  /* Ao abrir, leva o foco ao item ativo (ou ao primeiro) — teclado/leitor de tela */
  React.useEffect(() => {
    if (!open || !menuRef.current) return;
    const alvo = menuRef.current.querySelector('.catnav-item.active') || menuRef.current.querySelector('.catnav-item');
    alvo?.focus();
  }, [open]);

  /* Encerra a animacao pendente ao desmontar (restaura o scroll-behavior baseline dentro do stop) */
  React.useEffect(() => () => { stopRef.current?.(); }, []);

  /* Rolagem suave (com re-alvo por quadro) ate a secao, descontando a altura do header sticky.
     - RE-alvo por quadro: corrige o crescimento das secoes lazy durante a rolagem (sem undershoot).
     - CEDE a qualquer input do usuario (wheel/touch/tecla): como o smooth nativo, nao "briga" com
       quem rola manualmente durante a animacao.
     - Restaura sempre o scroll-behavior para '' (baseline do CSS) em qualquer saida. */
  const irPara = (cat) => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });   // nao mexe no scroll antes de capturar startY
    const el = document.getElementById(catSection(cat));
    if (!el) return;

    stopRef.current?.();   // encerra (e restaura) qualquer animacao anterior antes de comecar outra

    const offset = navTopOffset() + 12;   // header sticky + barra sticky (Fase 3): fonte unica
    const destino = () => Math.max(0, window.scrollY + el.getBoundingClientRect().top - offset);

    const reduz = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduz) {
      document.documentElement.style.scrollBehavior = '';   // baseline; media query reduced-motion garante salto
      window.scrollTo(0, destino());
      return;
    }

    /* Sobrepoe o scroll-behavior:smooth global para controlarmos o easing quadro a quadro. */
    const html = document.documentElement;
    html.style.scrollBehavior = 'auto';
    const startY = window.scrollY;
    const DURACAO = 520;
    let raf = 0, t0 = null;

    const parar = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      html.style.scrollBehavior = '';   // devolve o baseline SEMPRE (conclusao, novo clique, input, desmontagem)
      window.removeEventListener('wheel', parar);
      window.removeEventListener('touchstart', parar);
      window.removeEventListener('keydown', parar);
      stopRef.current = null;
    };
    stopRef.current = parar;
    /* input do usuario durante a animacao -> cede o controle imediatamente */
    window.addEventListener('wheel', parar, { passive: true });
    window.addEventListener('touchstart', parar, { passive: true });
    window.addEventListener('keydown', parar);

    const passo = (ts) => {
      if (t0 === null) t0 = ts;
      const p = Math.min(1, (ts - t0) / DURACAO);
      window.scrollTo(0, startY + (destino() - startY) * easeInOutCubic(p));
      if (p < 1) {
        raf = requestAnimationFrame(passo);
      } else {
        window.scrollTo(0, destino());   // snap final exato (apos as secoes lazy expandirem)
        parar();
      }
    };
    raf = requestAnimationFrame(passo);
  };

  /* Navegacao por setas entre os itens do menu */
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
    <div className="catnav" ref={wrapRef}>
      {/* anchor: mantem o menu alinhado ao gatilho em qualquer breakpoint (independe do padding do .catnav) */}
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
                  onClick={() => irPara(cat)}>
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
