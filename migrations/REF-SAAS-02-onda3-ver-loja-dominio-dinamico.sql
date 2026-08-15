-- REF-SAAS-02 · Onda 3 (parte 2) — "Ver loja" deixa de ser hardcoded pro dominio da Encanto.
--
-- Gap ja documentado desde a REF-SAAS-01 (docs/ref/REF-SAAS-01-plano-ondas.md, item 5 da lista de gaps
-- conhecidos): o botao "<- Ver loja" do Admin (AdminApp.jsx/STORE_URL) sempre navegava pro dominio fixo
-- da Encanto, independente de qual loja estava ativa no seletor multi-loja (Onda 5). Invisivel enquanto
-- so existia 1 tenant real; virou um bug de verdade com a Bar da Sogra: o operador clica "Ver loja"
-- pensando estar vendo a propria loja e cai no site de PRODUCAO REAL de outro tenant (Encanto).
--
-- Fix: list_my_stores() passa a devolver tambem `dominio`, pra o frontend montar o link certo por loja
-- ativa (server-truth, nao um valor hardcoded) e saber quando NAO ha link nenhum pra oferecer (loja sem
-- dominio ainda). Aditivo -- so acrescenta 1 coluna, mesma logica de autorizacao/filtro de sempre.

BEGIN;

DROP FUNCTION public.list_my_stores();

CREATE FUNCTION public.list_my_stores()
 RETURNS TABLE(store_id uuid, slug text, nome text, status text, dominio text, is_super_admin boolean, admin_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT s.id, s.slug, s.nome, s.status, s.dominio, public.is_super_admin(),
         (SELECT count(*)::int FROM public.admins a2 WHERE a2.store_id = s.id)
  FROM public.stores s
  WHERE public.is_super_admin()
     OR EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = s.id AND a.user_id = auth.uid())
  ORDER BY s.nome;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
