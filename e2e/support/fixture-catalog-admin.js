/* e2e/support/fixture-catalog-admin.js — REF-E2E-03 · Onda 3.
   Limpeza de registros de CATÁLOGO (categorias/adicionais — produtos entram na Onda 4) criados por
   specs de Admin, SEMPRE com prefixo E2E_TEST_ no nome — NUNCA toca o catálogo fixture do seed
   (fixture-catalog.js, usado pelos specs de loja/carrinho desde a E2E-01). Simétrico a
   support/cleanup.js (que limpa clientes/pedidos), mas para o domínio de catálogo. Env-gated: sem o
   projeto de E2E, {skipped:true} (mesmo padrão do resto de support/*.js). */
import { supabaseAdmin, E2E_ENV_PRONTO, avisarAmbientePendente } from './supabaseAdmin.js';
import { PREFIXO_TESTE } from './cleanup.js';

export async function limparCatalogoDeTeste() {
  if (!E2E_ENV_PRONTO) { avisarAmbientePendente('limpeza de catálogo de teste (Admin)'); return { ok: false, skipped: true }; }
  const client = supabaseAdmin();

  const { error: errCat } = await client.from('categories').delete().ilike('nome', `${PREFIXO_TESTE}%`);
  if (errCat) console.warn(`[e2e] limpeza de categorias de teste: ${errCat.message}`);

  const { error: errAd } = await client.from('adicionais').delete().ilike('nome', `${PREFIXO_TESTE}%`);
  if (errAd) console.warn(`[e2e] limpeza de adicionais de teste: ${errAd.message}`);

  return { ok: true, skipped: false };
}
