-- REF-SAAS-01 · Onda 8.3 — Corrige o gate de LOGIN do Admin para multi-loja.
-- Achado real (nao hipotetico): AdminLogin.jsx usa a RPC `is_admin()` como gate ("essa pessoa pode
-- entrar no painel?"). Mas `is_admin()` e' um WRAPPER de compatibilidade da Onda 1, com semantica
-- ESPECIFICA: "e' admin da Encanto" (`is_admin_of(default_store_id())`) -- mantido assim de proposito
-- para as ~30 RPCs legadas que chamam `is_admin()` sem `p_store_id` (elas sempre presumiram Encanto,
-- correto pra elas). O LOGIN, porem, precisa de uma pergunta DIFERENTE: "essa pessoa e admin de
-- QUALQUER loja (ou super admin)?" -- sem isso, um admin vinculado SO a uma loja nova (nunca a Encanto)
-- e rejeitado no login com "Acesso restrito ao administrador", mesmo sendo um admin legitimo da propria
-- loja. Descoberto ao testar pela 1a vez um admin REAL, DISTINTO, vinculado a uma loja que nao e a
-- Encanto (Onda 8, correcao pos-onda).
--
-- Fix: nova funcao `is_admin_anywhere()`, NUNCA reescreve `is_admin()` (zero risco pras ~30 RPCs
-- legadas). Unico consumidor pretendido: AdminLogin.jsx (2 chamadas, troca `is_admin` por
-- `is_admin_anywhere`).

BEGIN;

CREATE FUNCTION public.is_admin_anywhere()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT public.is_super_admin() OR EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid());
$$;

-- Mesmo padrao de grant de is_admin() (Onda 1/AUTH-01): anon incluido por seguranca defensiva (mesmo
-- raciocinio de sempre, RPC STABLE de leitura pura, sem custo/risco em expor a checagem em si).
REVOKE ALL ON FUNCTION public.is_admin_anywhere() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_anywhere() TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
