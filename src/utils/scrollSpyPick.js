/* utils/scrollSpyPick.js — REF-UI-CATEGORY-01 (correcao do marcador ativo). Logica PURA do scroll-spy,
   isolada para ser testavel sem DOM/React. Dado os `entries` (secoes em ordem de DOM, cada uma com seu
   getBoundingClientRect().top) e a `line` (linha de deteccao), retorna o id da ULTIMA secao cujo topo ja
   cruzou a linha.

   IMPORTANTE (causa raiz do bug "Monte seu Copo"): a `line` DEVE ficar ABAIXO do ponto de pouso do
   scroll (ver useScrollSpy: navTopOffset+40 vs alvo do scroll navTopOffset+12). Se a linha coincidir com
   o pouso, a secao recem-navegada cai na fronteira `top-line<=0` e um `top` fracionario a empurra um
   sub-pixel acima -> nao e contada -> marcador trava na secao anterior. FOLHA pura (zero imports). */
export function pickActiveSection(entries, line) {
  let current = entries.length ? entries[0].id : null;
  for (const e of entries) if (e.top - line <= 0) current = e.id;
  return current;
}
