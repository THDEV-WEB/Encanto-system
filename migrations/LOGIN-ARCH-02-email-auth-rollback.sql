-- Rollback do LOGIN-ARCH-02 (vinculo por email). ATOMICO.
-- Remove a RPC e o indice de email. A coluna email e o NOT NULL de phone sao preservados por padrao
-- (evita perda de dados / falha se ja houver customer por email com phone NULL). Descomente com cuidado.
BEGIN;

DROP FUNCTION IF EXISTS public.link_customer_to_auth_email(text);
DROP INDEX IF EXISTS public.customers_email_key;

-- Reverter schema (SO se nao houver dados dependentes):
-- UPDATE public.customers SET phone = '' WHERE phone IS NULL;   -- ou tratar antes
-- ALTER TABLE public.customers ALTER COLUMN phone SET NOT NULL;
-- ALTER TABLE public.customers DROP COLUMN IF EXISTS email;

COMMIT;
