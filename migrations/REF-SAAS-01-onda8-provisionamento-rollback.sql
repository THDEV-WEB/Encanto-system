-- REF-SAAS-01 · Onda 8 — Rollback: remove provision_store/link_store_admin.
-- Nao apaga nenhuma loja/admin/store_settings ja criados por elas -- isso e dado de negocio real,
-- rollback de migration so desfaz a DEFINICAO das funcoes (mesmo padrao de toda rollback desta REF).

BEGIN;

DROP FUNCTION IF EXISTS public.provision_store(text, text, text);
DROP FUNCTION IF EXISTS public.link_store_admin(uuid, text);

COMMIT;

NOTIFY pgrst, 'reload schema';
