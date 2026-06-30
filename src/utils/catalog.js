/* utils/catalog.js — helpers puros de catálogo (REF-APP-01 · Onda 1, move puro do App.jsx).
   Folha de domínio compartilhada: emoji por categoria, validação de URL http(s), filtro de
   categorias descontinuadas e pertencimento produto↔categoria. Única dependência: `norm`
   (utils/format.js). utils/ não é camada não-UI → compor format é permitido (regra D2). */
import { norm } from './format.js';

const CAT_EMOJI = {
  'combo marmitex + açaí':'🎁','combos':'🎁',
  'cardápio de marmitas':'🍱','marmitas':'🍱',
  'açaí':'🍧','copos prontos':'🍧',
  'monte seu copo':'🍧','batidinhas':'🥤',
  'pedido fitness':'💪','bebidas':'🧃',
};
export const catEmoji = (nome='') => CAT_EMOJI[(nome||'').toLowerCase()] || '🍽️';

/* URL http(s) válida — string começando com http:// ou https://. */
export const isHttpUrl = (url) => typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));

/* ── Categorias descontinuadas ──────────────────────────────────
   "Promoção do Dia" e "Cardápio Açaí" foram removidas permanentemente
   da loja. Este filtro garante que elas nunca apareçam para o cliente
   mesmo que a linha ainda exista no Supabase (ex.: admin ainda não
   excluiu manualmente) — comparação por nome normalizado, já que os
   IDs reais do banco não são os mesmos dos mocks ('c2'/'c6').
   Não afeta o Admin Panel: lá o restaurante continua vendo e podendo
   excluir essas categorias normalmente via DS.getAllCats(). ────────── */
const CATEGORIAS_DESCONTINUADAS = [
  'promocao do dia','promocoes do dia',
  'cardapio de acai','cardapio acai',
];
export const isCategoriaDescontinuada = cat => CATEGORIAS_DESCONTINUADAS.includes(norm(cat?.nome));

/* ── prodInCat ────────────────────────────────────────────────────────────────
   Verifica se um produto pertence a uma categoria.
   Suporta dois formatos (retrocompatível):
     - LEGADO:   { categoria_id: 'c1' }
     - NOVO:     { categoria_id: 'c1', categoria_ids: ['c1','c8'] }
   Um produto com categoria_ids pertence a TODAS as categorias listadas.
   Um produto sem categoria_ids é tratado como { categoria_ids: [categoria_id] }.
──────────────────────────────────────────────────────────────────────────── */
export function prodInCat(prod, catId) {
  if (!catId) return true;
  if (Array.isArray(prod.categoria_ids) && prod.categoria_ids.length>0) {
    return prod.categoria_ids.includes(catId);
  }
  return prod.categoria_id === catId;
}

/* ── getProdCatIds ─────────────────────────────────────────────────────────
   Retorna o array de todas as categorias de um produto.
──────────────────────────────────────────────────────────────────────────── */
export function getProdCatIds(prod) {
  if (Array.isArray(prod.categoria_ids) && prod.categoria_ids.length>0) {
    return prod.categoria_ids;
  }
  return [prod.categoria_id].filter(Boolean);
}
