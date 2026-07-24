/* e2e/support/fixture-catalog.js — REF-E2E-01 · Onda 4.
   IDs fixos do catálogo semeado em e2e/support/seed-catalog.sql (projeto Supabase DEDICADO a E2E).
   Fonte única para os specs @read-only (Ondas 2/3, que passaram a rodar contra o backend real assim
   que .env.e2e ganhou credenciais válidas — não existe mais fallback mock nesta Onda em diante) e
   @writes (Onda 4). Os nomes/categorias replicam exatamente src/data/mockCatalog.js (mesma fidelidade
   que os specs já tinham); os ids em si são novos (products.id é uuid — não dá para reusar os
   literais curtos 'p9'/'pac' do mock). */
export const PROD_MARMITA_P        = '10000000-0000-4000-8000-000000000001'; // Cardápio de Marmitas
export const PROD_ACAI_500ML       = '10000000-0000-4000-8000-000000000002'; // Destaques
export const PROD_ENCANTO_MINEIRO  = '10000000-0000-4000-8000-000000000003'; // Copos Prontos
export const PROD_MONTE_FIXTURE    = '10000000-0000-4000-8000-000000000004'; // Monte seu Copo
export const PROD_BATIDINHA_FIXTURE = '10000000-0000-4000-8000-000000000005'; // Batidinhas
export const PROD_COMBO_FIXTURE    = '10000000-0000-4000-8000-000000000006'; // Combos
export const PROD_FITNESS_FIXTURE  = '10000000-0000-4000-8000-000000000007'; // Pedido Fitness
export const PROD_AGUA_DE_COCO     = '10000000-0000-4000-8000-000000000008'; // Bebidas

/* REF-E2E-03 · Onda 4 (Admin/Produtos) — ids das mesmas 8 categorias do seed, usados para selecionar
   "Categoria principal"/"Aparece também em" no formulário de Produtos sem depender de nomes soltos. */
export const CAT_MARMITAS  = 'cat-e2e-marmitas';
export const CAT_DESTAQUES = 'cat-e2e-destaques';
export const CAT_PRONTOS   = 'cat-e2e-prontos';
export const CAT_MONTE     = 'cat-e2e-monte';
export const CAT_BATIDINHA = 'cat-e2e-batidinha';
export const CAT_COMBOS    = 'cat-e2e-combos';
export const CAT_FITNESS   = 'cat-e2e-fitness';
export const CAT_BEBIDAS   = 'cat-e2e-bebidas';
