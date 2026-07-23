-- e2e/support/seed-catalog.sql — REF-E2E-01 · Onda 4.
-- Catálogo FIXO e determinístico para o projeto Supabase dedicado a E2E (nunca rodar em produção).
-- Replica NOMES/CATEGORIAS/ORDEM de src/data/mockCatalog.js (mesma fidelidade que os specs @read-only
-- das Ondas 2/3 já assumiam contra o fallback mock) — ids novos em e2e/support/fixture-catalog.js
-- (products.id é uuid; não dá para reusar os literais curtos do mock). Idempotente (ON CONFLICT).
-- Produtos SEM tamanhos/variantes obrigatórias (mesmo motivo da Onda 3: "Adicionar" no modal funciona
-- sem seleção prévia).
BEGIN;

INSERT INTO public.categories (id, nome, ordem, ativo, slug, tipo)
VALUES
  ('cat-e2e-marmitas',  'Cardápio de Marmitas', 1, true, 'cardapio-marmitas-e2e', 'business'),
  ('cat-e2e-destaques', 'Destaques',            2, true, 'destaques-e2e',         'business'),
  ('cat-e2e-prontos',   'Copos Prontos',        3, true, 'copos-prontos-e2e',     'business'),
  ('cat-e2e-monte',     'Monte seu Copo',       4, true, 'monte-seu-copo-e2e',    'business'),
  ('cat-e2e-batidinha', 'Batidinhas',           5, true, 'batidinhas-e2e',        'business'),
  ('cat-e2e-combos',    'Combos',               6, true, 'combos-e2e',            'business'),
  ('cat-e2e-fitness',   'Pedido Fitness',       7, true, 'pedido-fitness-e2e',    'business'),
  ('cat-e2e-bebidas',   'Bebidas',              8, true, 'bebidas-e2e',           'business')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.products (id, nome, descricao, preco, categoria_id, disponivel, adicionais_gratis)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Marmita P',              'Fixture E2E — Cardápio de Marmitas', 15.99, 'cat-e2e-marmitas',  true, 0),
  ('10000000-0000-4000-8000-000000000002', 'Açaí 500 ml',            'Fixture E2E — Destaques',            15.99, 'cat-e2e-destaques', true, 0),
  ('10000000-0000-4000-8000-000000000003', 'Encanto Mineiro',        'Fixture E2E — Copos Prontos',        19.90, 'cat-e2e-prontos',   true, 0),
  ('10000000-0000-4000-8000-000000000004', 'Monte Fixture E2E',      'Fixture E2E — Monte seu Copo',        17.99, 'cat-e2e-monte',     true, 0),
  ('10000000-0000-4000-8000-000000000005', 'Batidinha Fixture E2E',  'Fixture E2E — Batidinhas',            18.00, 'cat-e2e-batidinha', true, 0),
  ('10000000-0000-4000-8000-000000000006', 'Combo Fixture E2E',      'Fixture E2E — Combos',                29.90, 'cat-e2e-combos',    true, 0),
  ('10000000-0000-4000-8000-000000000007', 'Fitness Fixture E2E',    'Fixture E2E — Pedido Fitness',        19.90, 'cat-e2e-fitness',   true, 0),
  ('10000000-0000-4000-8000-000000000008', 'Agua de Coco',           'Fixture E2E — Bebidas',               10.00, 'cat-e2e-bebidas',   true, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.settings (chave, valor)
VALUES
  ('delivery_eta_min', '30')
ON CONFLICT (chave) DO NOTHING;

COMMIT;
