/* constants/authStorage.js — REF-ADMIN-03 · Onda 2.
   FOLHA pura (zero imports, zero import.meta.env) — importável tanto pelo bundle Vite (browser)
   quanto por scripts Node puros (ex.: specs Playwright), exatamente como utils/searchText.js.
   Fonte ÚNICA das 2 chaves de localStorage usadas pelas 2 sessões Supabase deste app (ADMIN via
   `db`, CLIENTE via `dbCliente`) — nenhuma delas deve depender da chave DEFAULT que o supabase-js
   deriva da URL do projeto (`sb-<ref>-auth-token`), um formato interno/não documentado da lib. */
export const ADMIN_AUTH_STORAGE_KEY = 'encanto-admin-auth';
export const CLIENTE_AUTH_STORAGE_KEY = 'encanto-cliente-auth';
