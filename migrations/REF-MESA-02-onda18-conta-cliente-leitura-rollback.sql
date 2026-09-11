-- Rollback REF-MESA-02 · Onda 18 — remove consultar_minha_conta_mesa (greenfield, nenhum consumidor
-- anterior a esta onda; seguro de derrubar sem migração de dado nenhuma).
BEGIN;

DROP FUNCTION IF EXISTS public.consultar_minha_conta_mesa(uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
