/* constants/catalogConfig.js — flags de paginação/cache do catálogo (REF-APP-01 · Onda 1, move puro do App.jsx).
   Camada de constantes: sem imports (regra D2 trivialmente satisfeita). */

/* ── FIX truncamento PostgREST (teto ~1000 linhas) ───────────────────────────
   products.select(...) direto retorna no máximo ~1000 linhas (limite padrão do
   PostgREST) e trunca o catálogo em silêncio acima disso. fetchAllProductsSafe
   pagina com .range() até a página vir incompleta, montando a lista COMPLETA.
   Rollback em 1 linha: trocar PRODUCTS_PAGINATE para false → volta ao select direto. */
export const PRODUCTS_PAGE_SIZE = 1000;   /* tamanho de página do .range() (≤ teto do PostgREST) */
export const PRODUCTS_PAGINATE  = true;   /* ⇐ ROLLBACK: false restaura o select direto (1 página) */
export const PRODUCTS_CACHE_TTL = 5 * 60 * 1000;  /* 5 min — cache global da lista COMPLETA (sem busca) */
