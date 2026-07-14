-- ============================================================================
-- REF-ADMIN-CATALOG-01 — Governanca do catalogo administrativo
-- Conclui a arquitetura de MULTIPLAS CATEGORIAS (categoria_ids) que JA existia no
-- codigo de leitura (src/utils/catalog.js: prodInCat/getProdCatIds + exemplo no mock),
-- mas nunca fora persistida (nao havia coluna nem escrita no Admin). Com ela:
--   - a vitrine "Destaques" (categoria c8) passa a receber produtos sem duplicar linhas;
--   - um produto pode aparecer em N categorias tendo UMA unica identidade.
-- Tambem consolida os 2 produtos duplicados historicos numa unica linha cada.
-- Idempotente. Preserva o historico de pedidos (order_items repontados antes do delete).
-- NAO cria arquitetura paralela: nao usa as colunas dormentes categories.tipo/estrategia/
-- definicao/starts_at/ends_at nem a tabela vazia product_collections (ambas sem codigo).
-- ============================================================================

-- 1) Coluna categoria_ids (array de categorias). O select '*' do DataService ja a traz
--    e prodInCat/getProdCatIds ja a consomem — nenhuma mudanca de leitura necessaria.
alter table public.products add column if not exists categoria_ids text[];

-- 2) Backfill: todo produto sem categoria_ids herda [categoria_id] (comportamento IDENTICO
--    ao atual — um produto single-categoria continua exatamente onde estava).
update public.products
   set categoria_ids = array[categoria_id]
 where (categoria_ids is null or cardinality(categoria_ids) = 0)
   and categoria_id is not null;

-- 3) Consolidacao dos duplicados historicos -> uma unica identidade por produto.
--    order_items NAO tem FK para products e guarda snapshot (nome_produto/preco_unitario),
--    entao repontar preserva 100% do historico; product_collections esta vazia.
do $$
declare
  v_keep_em uuid := 'cb7d5883-7b4b-44c0-8da0-d34722c6323b';  -- Encanto Mineiro (c4 Copos Prontos) = MANTIDO
  v_dup_em  uuid := '45e97133-6252-4cec-8b80-073d3a1ac676';  -- Encanto Mineiro (c8 Destaques) = duplicado p/ vitrine
  v_keep_mg uuid := 'bee7e771-f706-4eba-a570-9b4591bcbb72';  -- Marmita G 2 Proteinas (c1 Combos, vivo) = MANTIDO
  v_dup_mg  uuid := '94da9683-9b10-4a8b-a0fa-1d6406b55add';  -- Marmita G (c2 Promocao do Dia, oculto/descontinuado)
begin
  -- Encanto Mineiro: era 2 linhas (Copos Prontos + Destaques). Vira UMA linha multi-categoria
  -- [c4, c8] com destaque=true -> aparece nas duas vitrines sem duplicar.
  if exists (select 1 from public.products where id = v_dup_em)
     and exists (select 1 from public.products where id = v_keep_em) then
    update public.order_items set product_id = v_keep_em where product_id = v_dup_em;
    -- ordem=2 preserva a posicao que a linha c8 (deletada) tinha na vitrine Destaques.
    update public.products set categoria_ids = array['c4','c8'], destaque = true, ordem = 2 where id = v_keep_em;
    delete from public.products where id = v_dup_em;
    raise notice 'Encanto Mineiro consolidado em % -> categoria_ids {c4,c8}, destaque=true, ordem=2', v_keep_em;
  end if;

  -- Marmita G 2 Proteinas: a linha da "Promocao do Dia" (c2, categoria descontinuada/inativa,
  -- disponivel=false) era sobra historica morta. Mantem so a linha viva de Combos (c1).
  if exists (select 1 from public.products where id = v_dup_mg)
     and exists (select 1 from public.products where id = v_keep_mg) then
    update public.order_items set product_id = v_keep_mg where product_id = v_dup_mg;
    update public.products set categoria_ids = array['c1'] where id = v_keep_mg;
    delete from public.products where id = v_dup_mg;
    raise notice 'Marmita G consolidada em % -> categoria_ids {c1}', v_keep_mg;
  end if;
end $$;

-- 4) RECONCILIACAO do flag legado destaque=true com a vitrine (ETAPA 3, causa raiz):
--    a loja mostra a vitrine Destaques por PERTENCER a categoria c8 (prodInCat), nunca pelo boolean.
--    Havia 6 produtos com destaque=true, mas 5 NAO estavam em c8 -> marcados como destaque, mas fora da
--    vitrine (o bug original). Aqui honramos a intencao do lojista: todo destaque=true entra na vitrine
--    (adiciona c8 a categoria_ids). Assim destaque<->pertencer-a-c8 ficam em SINCRONIA (fonte unica:
--    as categorias do produto) e a estrela/toggle do Admin passam a refletir a realidade da loja.
update public.products
   set categoria_ids = (
     select array_agg(distinct e) from unnest(coalesce(categoria_ids, array[categoria_id]) || array['c8']) e
   )
 where destaque is true
   and not ('c8' = any (coalesce(categoria_ids, array[categoria_id])));

notify pgrst, 'reload schema';
