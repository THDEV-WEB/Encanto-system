/* utils/catSection.js — REF-UI-CATEGORY-01 · Fase 1 (infra de navegacao).
   FONTE UNICA (a partir daqui) do id de ancora (DOM) de cada secao de categoria da loja.
   O mapeamento nome->sec-id estava TRIPLICADO por substring — o catalogo (StoreApp), a grade
   de chips e o SearchBar (getCatSecId), com risco real de divergencia. Este helper reproduz
   EXATAMENTE a cadeia if/else-if que o CATALOGO ja usava para gerar os ids sec-* (o unico dos
   tres que de fato renderiza os ids no DOM); o catalogo passa a chamar catSection nesta Fase 1.
   As outras duas copias foram REMOVIDAS: a grade de chips na Fase 2 e o getCatSecId do SearchBar
   na Fase 4 (junto com o modelo de filtro por selCat) — triplicacao ENCERRADA, fonte unica de fato.
   A navegacao por scroll usa este MESMO helper para calcular o alvo do scroll,
   garantindo que o alvo seja identico ao id efetivamente renderizado.
   FOLHA pura (zero imports): apenas operacoes de string. */
export function catSection(cat) {
  const nome = (cat?.nome || '').toLowerCase();
  if (nome.includes('destaque'))  return 'sec-destaques';
  if (nome.includes('combo'))     return 'sec-combos';
  if (nome.includes('fitness'))   return 'sec-fitness';
  if (nome.includes('marmita'))   return 'sec-marmitas';
  if (nome.includes('pronto') || (nome.includes('copo') && !nome.includes('monte'))) return 'sec-prontos';
  if (nome.includes('monte'))     return 'sec-monte';
  if (nome.includes('batidinha')) return 'sec-batidinha';
  if (nome.includes('bebida'))    return 'sec-bebidas';
  return `sec-${cat?.id}`;
}
