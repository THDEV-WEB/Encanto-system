-- ============================================================================
-- REF-LOYALTY-02 · Onda 1 — ROLLBACK
-- ----------------------------------------------------------------------------
-- Reverte migrations/REF-LOYALTY-02-onda1-fundacao.sql: remove as 2 colunas novas de
-- loyalty_events, a coluna nova de orders, e restaura redeem_reward(uuid, uuid) exatamente como
-- definida em REF-LOYALTY-AUDIT-01-onda1-config-por-loja.sql (byte-a-byte, mesma lógica).
--
-- DROP FUNCTION é necessário (estamos REMOVENDO parâmetros -- muda a assinatura). Lição permanente
-- da Onda 4.1 desta plataforma, reconfirmada pelo próprio achado da migration direta desta onda:
-- DROP+CREATE reseta o ACL pros defaults do schema (inclusive EXECUTE de PUBLIC/anon) --
-- REVOKE/GRANT reaplicados explicitamente abaixo.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.redeem_reward(uuid, uuid, uuid, numeric);

CREATE FUNCTION public.redeem_reward(p_customer_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_cid      uuid := p_customer_id;
  v_required int;
  v_discount int;
  v_enabled  boolean;
  v_store    uuid;
  v_admin    boolean := false;
  v_stamps   int;
begin
  if v_cid is not null then
    select store_id into v_store from public.customers where id = v_cid;
    if v_store is not null then v_admin := public.is_admin_of(v_store); end if;
  end if;

  if v_admin then
    null;
  else
    v_store := p_store_id;
    v_enabled := coalesce((select valor from public.store_settings where store_id = v_store and chave = 'loyalty_enabled'), 'false') <> 'false';
    if not v_enabled then return jsonb_build_object('ok', false, 'error', 'programa desativado'); end if;
    if v_uid is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
    select id, store_id into v_cid, v_store from public.customers where auth_user_id = v_uid and store_id = p_store_id limit 1;
    if v_cid is null then return jsonb_build_object('ok', false, 'error', 'cliente sem cadastro'); end if;
    if p_customer_id is not null and p_customer_id <> v_cid then
      return jsonb_build_object('ok', false, 'error', 'sem permissao');
    end if;
  end if;

  v_required := coalesce((select valor from public.store_settings where store_id = v_store and chave = 'loyalty_required'), '10')::int;
  v_discount := coalesce((select valor from public.store_settings where store_id = v_store and chave = 'loyalty_discount'), '50')::int;

  select stamps into v_stamps from public.loyalty_accounts where customer_id = v_cid for update;
  if v_stamps is null or v_stamps < v_required then
    return jsonb_build_object('ok', false, 'error', 'recompensa indisponivel',
                              'stamps', coalesce(v_stamps,0), 'required', v_required);
  end if;

  update public.loyalty_accounts
     set stamps = stamps - v_required, rewards_redeemed = rewards_redeemed + 1, updated_at = now()
   where customer_id = v_cid returning stamps into v_stamps;
  insert into public.loyalty_events (customer_id, tipo, delta, stamps_after, origem, note, store_id)
    values (v_cid, 'redeemed', -v_required, v_stamps, case when v_admin then 'admin' else 'redeem' end,
            'recompensa ' || v_discount || '%', v_store);

  return jsonb_build_object('ok', true, 'stamps', v_stamps, 'required', v_required, 'discount', v_discount,
                            'rewards_redeemed', (select rewards_redeemed from public.loyalty_accounts where customer_id = v_cid));
end;
$function$;

REVOKE ALL ON FUNCTION public.redeem_reward(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_reward(uuid, uuid) TO authenticated;

ALTER TABLE public.loyalty_events
  DROP COLUMN IF EXISTS discount_pct,
  DROP COLUMN IF EXISTS discount_amount;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS desconto_fidelidade;

NOTIFY pgrst, 'reload schema';

COMMIT;
