-- REF-SAAS-01 · Onda 8.2 — list_my_stores() ganha admin_count.
-- Correcao operacional pos-Onda-8, pedida explicitamente pelo dono: uma loja provisionada SEM e-mail de
-- admin (ou cujo e-mail nao resolveu ainda) ficava "orfa" de forma INVISIVEL na aba Plataforma -- a lista
-- de lojas nao trazia nenhum sinal de que faltava vincular alguem. admin_count permite a UI mostrar
-- "aguardando administrador" quando = 0, sem precisar de nenhuma RPC nova (so 1 coluna extra no
-- RETURNS TABLE existente).
--
-- DROP FUNCTION antes do CREATE OR REPLACE: mudar o RETURNS TABLE (coluna nova) exige isso -- Postgres
-- nao aceita CREATE OR REPLACE que troque o tipo de retorno de uma funcao existente.

BEGIN;

DROP FUNCTION IF EXISTS public.list_my_stores();

CREATE OR REPLACE FUNCTION public.list_my_stores()
 RETURNS TABLE(store_id uuid, slug text, nome text, status text, is_super_admin boolean, admin_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT s.id, s.slug, s.nome, s.status, public.is_super_admin(),
         (SELECT count(*)::int FROM public.admins a2 WHERE a2.store_id = s.id)
  FROM public.stores s
  WHERE public.is_super_admin()
     OR EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = s.id AND a.user_id = auth.uid())
  ORDER BY s.nome;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
