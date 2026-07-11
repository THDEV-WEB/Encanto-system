-- Rollback do PRICE-DOMAIN-01-backfill-preco-espelho. ATOMICO.
-- Restaura products.preco / products.preco_promo EXATAMENTE como estavam antes do backfill,
-- a partir do snapshot _price_domain_01_backup, e remove a tabela de snapshot.
-- NAO toca tamanhos (nunca foi alterado pelo backfill).
-- Observacao: os valores restaurados sao os precos legados (nao usados pela loja p/ itens com
--   tamanhos); o rollback existe para reversibilidade total, nao porque tenham utilidade.
BEGIN;

UPDATE public.products p
   SET preco = b.preco_old,
       preco_promo = b.preco_promo_old
  FROM public._price_domain_01_backup b
 WHERE p.id = b.id;

DROP TABLE IF EXISTS public._price_domain_01_backup;

COMMIT;
