-- PRICE-DOMAIN-01 - backfill do preco-espelho para produtos COM tamanhos. ATOMICO. Idempotente.
--
-- CONTEXTO (auditoria BUG-INV-01): produtos com tamanhos[] (Monte seu Copo, Batidinhas) tem o
--   preco EFETIVO em tamanhos[].preco; a coluna products.preco desses itens acumulou valores
--   caoticos (0.99, 34.98, ...) de edicoes antigas do Admin que a loja SEMPRE ignorou. A loja
--   nunca usou esse preco para esses itens (usa tamanhos), entao esta migration NAO altera o que
--   o cliente ve/paga -- apenas torna a coluna preco COERENTE (espelho do menor tamanho).
--
-- O QUE FAZ:
--   (0) snapshot reversivel de preco/preco_promo das linhas afetadas em _price_domain_01_backup
--       (regra "nunca perder dados": rollback restaura exatamente os valores anteriores).
--   (1) products.preco = MIN(tamanhos[].preco)  e  products.preco_promo = NULL, apenas para
--       linhas com tamanhos[] nao-vazio. tamanhos (os precos reais) NAO e tocado.
--
-- NAO NECESSARIA PARA O APP FUNCIONAR: o codigo do PRICE-DOMAIN-01 ja mantem esse espelho a cada
--   salvamento no Admin. Esta migration apenas sana em lote as linhas legadas de uma vez.
--
-- APLICACAO: manual (Supabase SQL editor), como as demais migrations do projeto.
-- Rollback: migrations/PRICE-DOMAIN-01-backfill-preco-espelho-rollback.sql
BEGIN;

-- (0) snapshot reversivel (idempotente: nao sobrescreve snapshot ja existente)
CREATE TABLE IF NOT EXISTS public._price_domain_01_backup (
  id              uuid PRIMARY KEY,
  preco_old       numeric,
  preco_promo_old numeric,
  snapped_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public._price_domain_01_backup (id, preco_old, preco_promo_old)
SELECT p.id, p.preco, p.preco_promo
  FROM public.products p
 WHERE p.tamanhos IS NOT NULL
   AND jsonb_typeof(p.tamanhos) = 'array'
   AND jsonb_array_length(p.tamanhos) > 0
ON CONFLICT (id) DO NOTHING;

-- (1) espelha preco = MENOR tamanho e zera promo (loja ja usa tamanhos; preco passa a ser coerente)
UPDATE public.products p
   SET preco = (SELECT MIN((t->>'preco')::numeric) FROM jsonb_array_elements(p.tamanhos) t),
       preco_promo = NULL
 WHERE p.tamanhos IS NOT NULL
   AND jsonb_typeof(p.tamanhos) = 'array'
   AND jsonb_array_length(p.tamanhos) > 0;

COMMIT;
