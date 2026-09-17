-- REF-PROMO-01 · Onda 2 -- cria a categoria "Promoções" (vitrine dedicada do catalogo do cliente) para
-- a loja Encanto, reaproveitando EXATAMENTE o mesmo padrao ja usado em producao para "Destaques" hoje
-- (categoria real, ativo=true, tipo='business' -- NAO 'collection': o Collection Engine do NORM-06 esta
-- com o F2/backfill travado desde 2026-06-27 por uma colisao de dados nunca resolvida, zero linhas com
-- tipo='collection' em producao, zero consumo no frontend -- usa-lo aqui seria implementar do zero o
-- ramo `rule` reservado para NORM-10, fora do escopo desta REF). Pertenca de produto = categoria_ids
-- (multi-categoria, ja usado por "Destaques" via o toggle Admin) -- nao duplica linha de produto.
--
-- Nome deliberadamente DIFERENTE de "Promoção do Dia"/"Promoções do Dia" -- essas 2 strings estao no
-- deny-list src/utils/catalog.js:CATEGORIAS_DESCONTINUADAS (categoria legada, ja ativo=false e orfa,
-- ver auditoria) e qualquer categoria com esse nome exato desapareceria da navegacao do cliente mesmo
-- com ativo=true. "Promoções" (plural, sem "do Dia") nao colide com esse filtro.
--
-- icone/cor reaproveitam o MESMO par visual que a categoria legada "Promoção do Dia" ja usava (🔥 /
-- #EA580C) -- decisao de design ja existente no produto, nao inventada agora.
--
-- ordem=0: posiciona a vitrine PRIMEIRO na navegacao (a` frente de "Cardapio de Marmitas", ordem=1) --
-- pratica comercial padrao (promocoes em destaque no topo). Nao exige nenhuma mudanca de codigo: toda a
-- navegacao (CategoryNav/StickyBar/MobileCatStrip/secoes do catalogo) ja itera `cats`/`catsVisiveis`
-- ordenados por `ordem` (ver src/hooks/useCategories.js, src/pages/StoreApp.jsx).
--
-- store_id fixo (Encanto) -- esta REF e' especifica da loja Encanto (caso real "Encanto Casadinho");
-- outras lojas do SaaS nao ganham a categoria automaticamente (cada tenant configura a propria vitrine
-- via Admin, mesmo caminho que qualquer categoria nova hoje).
--
-- Reversivel: a categoria nasce SEM nenhum produto (INSERT dedicado, onda 3, cuida do Casadinho) --
-- rollback e' um DELETE simples, sem side-effect em products.categoria_ids de nenhum produto.

BEGIN;

INSERT INTO public.categories (id, nome, ordem, ativo, icone, cor, slug, tipo, store_id)
VALUES ('promocoes', 'Promoções', 0, true, '🔥', '#EA580C', 'promocoes', 'business',
        '8604324d-0529-443d-aa79-4337057bfa01');

COMMIT;
