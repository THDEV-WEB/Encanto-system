-- Rollback de REF-STORE-ONBOARD-01-onda3.sql -- as 2 funcoes desta migration sao 100% aditivas (nenhuma
-- funcao existente foi recriada/alterada), entao o rollback e' so DROP das 2 novas. Nenhum dado e'
-- perdido: DROP FUNCTION nao apaga nenhuma linha ja gravada em stores/categories/products/adicionais/
-- product_collections por chamadas anteriores dessas RPCs (se houver) -- so remove a capacidade de
-- chamar de novo. Se precisar desfazer o EFEITO de uma clonagem ja feita, isso e' uma operacao de dados
-- separada (DELETE manual por store_id), fora do escopo deste rollback de schema.

BEGIN;

DROP FUNCTION IF EXISTS public.platform_clone_catalog(uuid, uuid);
DROP FUNCTION IF EXISTS public.platform_set_store_dominio(uuid, text);

COMMIT;

NOTIFY pgrst, 'reload schema';
