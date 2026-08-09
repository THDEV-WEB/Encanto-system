-- REF-SAAS-01 · Onda 6.1 — Resolucao de loja no storefront (cliente final) por DOMINIO, em runtime.
-- Decisao do dono (2026-08-09): manter o caminho original do ADR (docs/adr/REF-SAAS-01-fundacao-
-- multitenant.md §5) — 1 bundle unico do storefront, resolvendo a loja em runtime via hostname —
-- em vez de replicar o padrao do Admin (1 build/deploy por loja, REF-ADMIN-04). Loja nova = so
-- inserir em `stores`, sem novo deploy.
--
-- Auditoria (docs/ref/REF-SAAS-01-plano-ondas.md, secao "Onda 6"): o storefront hoje nunca informa
-- store_id/p_store_id em nenhuma chamada (getCats/getProds/getAds/create_order/link_customer_to_auth/
-- get_my_loyalty/redeem_reward) — todas ja tem `p_store_id DEFAULT default_store_id()` desde a Onda 4,
-- so falta o frontend informar. Faltam 2 pecas de banco pra isso funcionar de verdade com 2+ lojas:

BEGIN;

-- ===== 1. get_store_by_domain(hostname): unica forma do storefront (anon) saber qual loja mostrar.
-- SEMPRE devolve exatamente 1 linha (nunca "nao encontrado"): hostname bate com stores.dominio ->
-- devolve aquela loja (qualquer status); senao, cai no default_store_id() (a mesma loja que o
-- storefront ja mostra hoje). Zero ambiguidade de "null" no frontend — o app sempre sabe uma loja
-- concreta; o unico comportamento novo e a UI checar `status` pra decidir se mostra o catalogo ou uma
-- tela de "loja indisponivel" (loja com status != 'ativo' NUNCA cai no fallback pro default — mostrar
-- o catalogo errado sob o dominio errado seria pior que uma mensagem clara).
CREATE OR REPLACE FUNCTION public.get_store_by_domain(p_hostname text)
 RETURNS TABLE(store_id uuid, slug text, nome text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT s.id, s.slug, s.nome, s.status
  FROM public.stores s
  WHERE s.id = COALESCE(
    (SELECT id FROM public.stores WHERE dominio = p_hostname),
    public.default_store_id()
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_store_by_domain(text) TO anon, authenticated;

-- ===== 1b. store_ativo(store_id): predicado auxiliar SECURITY DEFINER pras policies abaixo. Sem
-- isto, uma policy referenciando `stores` diretamente (`store_id IN (SELECT id FROM stores WHERE
-- status='ativo')`) executaria essa subconsulta com os privilegios do CHAMADOR (anon) — e como
-- `stores` tem RLS habilitado sem nenhuma policy de leitura, a subconsulta sempre devolveria vazio
-- pra anon, quebrando a checagem por completo (achado confirmado por teste comportamental: sem esta
-- funcao, anon nunca via NADA, nem o catalogo real da propria Encanto). Mesmo padrao ja usado por
-- is_admin_of()/is_super_admin()/default_store_id() — todas SECURITY DEFINER, todas contornando a
-- RLS de tabelas que elas mesmas leem por dentro.
CREATE OR REPLACE FUNCTION public.store_ativo(p_store_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id AND status = 'ativo');
$function$;

GRANT EXECUTE ON FUNCTION public.store_ativo(uuid) TO anon, authenticated;

-- ===== 2. Leitura publica do catalogo (products/categories/adicionais): de "so a loja padrao" pra
-- "qualquer loja ATIVA". Load-bearing a partir de agora: como a RLS deixa de restringir a 1 loja so,
-- o filtro .eq('store_id', ...) no FRONTEND passa a ser quem garante que cada visitante ve so a loja
-- certa — sem RLS misturando lojas, mas sem o filtro de query o cliente veria o catalogo de TODAS as
-- lojas ativas ao mesmo tempo. Lojas suspensas/canceladas continuam invisiveis mesmo por URL direta
-- (adivinhando o store_id), porque store_ativo() so retorna true pras ativas.
DROP POLICY "Leitura pública produtos" ON public.products;
CREATE POLICY "Leitura pública produtos" ON public.products
  FOR SELECT
  USING (public.store_ativo(store_id) OR public.is_admin_of(store_id));

DROP POLICY "Leitura pública categorias" ON public.categories;
CREATE POLICY "Leitura pública categorias" ON public.categories
  FOR SELECT
  USING (public.store_ativo(store_id) OR public.is_admin_of(store_id));

DROP POLICY "Leitura pública adicionais" ON public.adicionais;
CREATE POLICY "Leitura pública adicionais" ON public.adicionais
  FOR SELECT
  USING (public.store_ativo(store_id) OR public.is_admin_of(store_id));

-- ===== 3. Remove a ancora de compatibilidade "AND store_id = default_store_id()" da leitura do
-- proprio customer (adicionada na Onda 3) — agora que o frontend vai informar store_id explicito na
-- propria query (AuthService.getMeuCustomer), a RLS nao precisa mais restringir a leitura so a loja
-- padrao (o que tornava o proprio perfil invisivel pra quem so existe numa loja nao-padrao, mesmo
-- navegando na propria loja dele). Modelo do ADR §2: a mesma pessoa pode ter customer em varias
-- lojas, e cada linha e legitimamente "propria" dela — o determinismo passa a vir da QUERY (.eq
-- store_id explicito), nao mais da RLS.
ALTER POLICY "Cliente le proprio customer" ON public.customers
  USING (auth_user_id = auth.uid());

COMMIT;
