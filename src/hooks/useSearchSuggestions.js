/* hooks/useSearchSuggestions.js — REF-UI-SEARCH-01. Motor de sugestoes da busca (dados puros, sem UI).
   Recebe (query, prods, cats) e devolve sugestoes AGRUPADAS: { categorias, produtos, total, tooShort }.
   Criterios TOLERANTES (utils/searchText): nome/descricao/categoria(s), parcial, sem caixa, sem acento.

   PERFORMANCE (req 8): o INDICE deburrado (nome/descricao/nomes das categorias VISIVEIS de cada produto) e
   memoizado em [prods, cats] — recalcula so quando o catalogo muda, NAO a cada tecla. Por tecla apenas
   `includes` no indice + `splitMatch` nos poucos itens exibidos (apos o corte). Sem debounce (client-side).
   dedup por id (produto multi-categoria aparece uma vez). Casa por QUALQUER categoria visivel do produto
   (mostra a que casou no subtitulo). Ranking: nome-prefixo < nome < descricao < categoria. Corte MAX_PROD.
   O realce da DESCRICAO e "janelado" (…tail + hit + head…) para o trecho casado ficar sempre visivel no
   subtitulo de 1 linha (senao a ellipsis o cortaria — req 4). */
import { useMemo } from 'react';
import { deburr, splitMatch } from '../utils/searchText.js';
import { prodInCat } from '../utils/catalog.js';
import { catSection } from '../utils/catSection.js';

const MIN = 2;          // minimo de caracteres p/ sugerir (evita ruido de 1 letra)
const MAX_PROD = 8;     // teto de produtos no painel (leve)
const WIN_BEFORE = 18;  // realce da descricao: contexto antes do hit
const WIN_AFTER = 40;   // realce da descricao: contexto depois do hit

/* Mantem o trecho casado VISIVEL num subtitulo de 1 linha: corta o excesso antes/depois com reticencias. */
function janela(parts) {
  if (!parts) return null;
  let { before, hit, after } = parts;
  if (before.length > WIN_BEFORE) before = '…' + before.slice(before.length - WIN_BEFORE);
  if (after.length > WIN_AFTER) after = after.slice(0, WIN_AFTER) + '…';
  return { before, hit, after };
}

export function useSearchSuggestions(query, prods, cats) {
  /* Indice deburrado — recalcula so quando o catalogo muda. */
  const index = useMemo(() => {
    const catList = cats.map(c => ({ cat: c, nn: deburr(c.nome), secId: catSection(c) }));
    const prodList = [];
    const vistos = new Set();
    for (const p of prods) {
      if (p.disponivel === false || vistos.has(p.id)) continue;
      const doProd = cats.filter(c => prodInCat(p, c.id));   // categorias VISIVEIS do produto (ordem do catalogo)
      if (!doProd.length) continue;                          // sem secao renderizada -> nao ha p/ onde navegar
      vistos.add(p.id);
      const secCat = doProd[0];                              // 1a = secao alvo (mesma que o catalogo desenha primeiro)
      prodList.push({
        prod: p, catNome: secCat.nome, secId: catSection(secCat),
        nn: deburr(p.nome), nd: deburr(p.descricao || ''),
        ncats: doProd.map(c => ({ nome: c.nome, nn: deburr(c.nome) })),
      });
    }
    return { catList, prodList };
  }, [prods, cats]);

  return useMemo(() => {
    const dq = deburr((query || '').trim());
    if (dq.length < MIN) return { categorias: [], produtos: [], total: 0, tooShort: true };

    const categorias = [];
    for (const c of index.catList) {
      if (c.nn.includes(dq)) categorias.push({ cat: c.cat, parts: splitMatch(c.cat.nome, dq), secId: c.secId });
    }

    const hits = [];
    for (const e of index.prodList) {
      const inName = e.nn.includes(dq);
      const inDesc = !inName && e.nd.includes(dq);
      const catHit = (!inName && !inDesc) ? (e.ncats.find(c => c.nn.includes(dq)) || null) : null;
      if (!inName && !inDesc && !catHit) continue;
      /* prefixo do nome pontua melhor (0); depois nome(1), descricao(2), categoria(3) */
      const rank = inName ? (e.nn.indexOf(dq) === 0 ? 0 : 1) : (inDesc ? 2 : 3);
      hits.push({ e, inName, inDesc, catHit, rank });
    }
    hits.sort((a, b) => a.rank - b.rank);

    /* splitMatch (realce) so nos que serao exibidos — evita calcular para itens cortados. */
    const produtos = hits.slice(0, MAX_PROD).map(({ e, inName, inDesc, catHit }) => {
      const nomeParts = inName ? splitMatch(e.prod.nome, dq) : null;
      let sub, subParts;
      if (inName) { sub = e.catNome; subParts = null; }
      else if (inDesc) { sub = e.prod.descricao || ''; subParts = janela(splitMatch(sub, dq)); }
      else { sub = catHit.nome; subParts = splitMatch(catHit.nome, dq); }
      return { prod: e.prod, secId: e.secId, catNome: e.catNome, nomeParts, sub, subParts };
    });

    return { categorias, produtos, total: categorias.length + produtos.length, tooShort: false };
  }, [query, index]);
}
