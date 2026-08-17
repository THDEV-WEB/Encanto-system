-- Rollback da Onda 3 de REF-AUTH-TENANT-01.
-- IMPORTANTE: se o Hook estiver configurado no Auth (Dashboard) apontando pra esta funcao, DESATIVE
-- o Hook no Dashboard ANTES de rodar este DROP - senao o proximo login/refresh de QUALQUER usuario
-- falha (a config do Auth ficaria apontando pra uma funcao inexistente).

BEGIN;

DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb);

COMMIT;
