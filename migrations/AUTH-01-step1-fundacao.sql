-- AUTH-01 · Onda 0 · Etapa 1 — FUNDACAO ADITIVA da autenticacao de cliente (hibrida, guest-first).
-- ATOMICO. Idempotente. NAO-BREAKING: nao altera policies de escrita existentes, nao toca o checkout
-- guest (create_order SECURITY DEFINER) nem o Admin. Aplicacao MANUAL (Supabase SQL editor), como as
-- demais migrations do projeto. Rollback: AUTH-01-step1-fundacao-rollback.sql
--
-- Entrega: (1) customers.auth_user_id (vinculo nullable) · (2) tabela admins (fonte da verdade) ·
--          (3) is_admin() · (4) policies de LEITURA PROPRIA (cliente ve so o proprio) ·
--          (5) RPC link_customer_to_auth (vinculo idempotente por telefone).
-- A Etapa 2 (endurecimento das policies de ESCRITA para is_admin()) e um arquivo SEPARADO e so
-- deve ser aplicada APOS registrar o admin em public.admins (senao o Admin perde escrita).
BEGIN;

-- (1) Vinculo cliente<->customer. Nullable: pedidos de visitante seguem com auth_user_id = NULL.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
-- 1 usuario auth -> no maximo 1 customer (parcial: ignora os NULL dos visitantes).
CREATE UNIQUE INDEX IF NOT EXISTS customers_auth_user_id_key ON public.customers(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- (2) admins = FONTE DA VERDADE administrativa (aprovado: tabela, NAO app_metadata).
CREATE TABLE IF NOT EXISTS public.admins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
-- Sem leitura publica: cada admin le apenas a propria linha; is_admin() (SECURITY DEFINER) le todas.
DROP POLICY IF EXISTS "admins self read" ON public.admins;
CREATE POLICY "admins self read" ON public.admins FOR SELECT TO authenticated USING (user_id = auth.uid());

-- (3) is_admin(): banco decide. SECURITY DEFINER p/ ler admins sob RLS. STABLE p/ uso em policies.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- (4) LEITURA PROPRIA (aditivo; nao afeta guest/admin). Cliente autenticado ve SO os proprios dados.
DROP POLICY IF EXISTS "Cliente le proprio customer" ON public.customers;
CREATE POLICY "Cliente le proprio customer" ON public.customers FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());
DROP POLICY IF EXISTS "Cliente le proprios orders" ON public.orders;
CREATE POLICY "Cliente le proprios orders" ON public.orders FOR SELECT TO authenticated
  USING (customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid()));
DROP POLICY IF EXISTS "Cliente le proprios order_items" ON public.order_items;
CREATE POLICY "Cliente le proprios order_items" ON public.order_items FOR SELECT TO authenticated
  USING (order_id IN (
    SELECT o.id FROM public.orders o JOIN public.customers c ON c.id = o.customer_id
    WHERE c.auth_user_id = auth.uid()));

-- (5) Vinculo por TELEFONE, idempotente, SECURITY DEFINER. Reusa normalize_phone. Nunca duplica.
CREATE OR REPLACE FUNCTION public.link_customer_to_auth(p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
declare
  v_uid   uuid := auth.uid();
  v_phone text := public.normalize_phone(p_phone);
  v_cid   uuid;
begin
  if v_uid   is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
  if v_phone is null then return jsonb_build_object('ok', false, 'error', 'telefone invalido'); end if;

  -- (a) ja vinculado a ESTE usuario? idempotente.
  select id into v_cid from public.customers where auth_user_id = v_uid limit 1;
  if v_cid is not null then return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'ja_vinculado'); end if;

  -- (b) customer existente por telefone (historico de visitante) ainda sem dono -> VINCULA (nao duplica).
  select id into v_cid from public.customers where phone = v_phone and auth_user_id is null limit 1;
  if v_cid is not null then
    update public.customers set auth_user_id = v_uid where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'vinculado');
  end if;

  -- (c) nao existe -> cria vinculado (nome placeholder; o proximo checkout via create_order o atualiza).
  insert into public.customers(name, phone, auth_user_id) values ('Cliente', v_phone, v_uid)
    on conflict (phone) do update set auth_user_id = v_uid
      where public.customers.auth_user_id is null or public.customers.auth_user_id = v_uid
    returning id into v_cid;
  return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'criado');
end; $$;
REVOKE ALL ON FUNCTION public.link_customer_to_auth(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_customer_to_auth(text) TO authenticated;

COMMIT;
