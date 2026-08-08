-- REF-SAAS-01 · Onda 4.2 — Fidelidade cliente-facing (subfase 2 de 3 da Onda 4).
-- Escopo: get_my_loyalty/redeem_reward/admin_find_loyalty ganham p_store_id explicito e passam a
-- resolver/buscar o customer SEMPRE dentro da loja correta -- fecha os 3 achados documentados desde o
-- fechamento da Onda 3 (leitura/resgate de fidelidade sem filtro de loja). Nenhuma mudanca de schema ou
-- RLS nesta subfase: loyalty_accounts/loyalty_events ja foram corrigidas na Onda 4.1 (escrita
-- automatica); aqui e so o caminho de LEITURA/RESGATE explicito do cliente e do admin.
-- Ver docs/adr/REF-SAAS-01-fundacao-multitenant.md §5/§10 e docs/ref/REF-SAAS-01-plano-ondas.md
-- (secao "Onda 4.2") para a auditoria e o racional completos.

BEGIN;

-- ===== get_my_loyalty: ganha p_store_id, resolve o customer so dentro daquela loja =====
-- LICAO DA ONDA 3, aplicada de novo: DROP explicito antes do CREATE OR REPLACE que adiciona parametro,
-- pra nao criar overload ambiguo com a assinatura de 0 argumentos que o AuthService/loyaltyService real
-- ainda chama.
DROP FUNCTION IF EXISTS public.get_my_loyalty();

CREATE OR REPLACE FUNCTION public.get_my_loyalty(p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_cid      uuid;
  v_stamps   int := 0;
  v_rr       int := 0;
  v_required int     := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_discount int     := coalesce(nullif(public.get_setting('loyalty_discount','50'),'')::int, 50);
  v_enabled  boolean := lower(coalesce(public.get_setting('loyalty_enabled','true'),'true')) <> 'false';
begin
  if v_uid is not null then
    select id into v_cid from public.customers where auth_user_id = v_uid and store_id = p_store_id limit 1;
    if v_cid is not null then
      select stamps, rewards_redeemed into v_stamps, v_rr from public.loyalty_accounts where customer_id = v_cid;
      v_stamps := coalesce(v_stamps, 0); v_rr := coalesce(v_rr, 0);
    end if;
  end if;
  -- REF-LOYALTY-01 fix (#5): programa desativado NUNCA oferece recompensa (nem no cliente, nem na API)
  return jsonb_build_object('enabled', v_enabled, 'stamps', v_stamps, 'required', v_required,
                            'discount', v_discount, 'reward_available', (v_enabled and v_stamps >= v_required),
                            'rewards_redeemed', v_rr, 'has_account', (v_cid is not null));
end;
$function$;

-- ===== redeem_reward: ganha p_store_id; o caminho self-service resolve o customer so dentro daquela
-- loja; o caminho admin passa a checar is_admin_of(loja do cliente-alvo) em vez de is_admin() cego =====
DROP FUNCTION IF EXISTS public.redeem_reward(uuid);

CREATE OR REPLACE FUNCTION public.redeem_reward(p_customer_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_cid      uuid := p_customer_id;
  v_required int  := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_discount int  := coalesce(nullif(public.get_setting('loyalty_discount','50'),'')::int, 50);
  v_enabled  boolean := lower(coalesce(public.get_setting('loyalty_enabled','true'),'true')) <> 'false';
  v_store    uuid;
  v_admin    boolean := false;
  v_stamps   int;
begin
  -- Caminho ADMIN: so entra aqui se p_customer_id foi informado E o chamador administra A LOJA DAQUELE
  -- cliente especificamente (nao mais is_admin() cego). Preserva o comportamento real de hoje --
  -- confirmado por grep, p_customer_id so e passado pelo client `db` (admin), nunca pelo `dbCliente`.
  if v_cid is not null then
    select store_id into v_store from public.customers where id = v_cid;
    if v_store is not null then v_admin := public.is_admin_of(v_store); end if;
  end if;

  if v_admin then
    null; -- ja validado acima
  else
    -- REF-LOYALTY-01 fix (#5): programa desativado nao e resgatavel pelo cliente (admin pode operar).
    if not v_enabled then return jsonb_build_object('ok', false, 'error', 'programa desativado'); end if;
    if v_uid is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
    select id, store_id into v_cid, v_store from public.customers where auth_user_id = v_uid and store_id = p_store_id limit 1;
    if v_cid is null then return jsonb_build_object('ok', false, 'error', 'cliente sem cadastro'); end if;
    -- guarda de impersonacao preexistente: se um p_customer_id TAMBEM foi passado (caso defensivo, nao
    -- usado hoje pelo dbCliente) e nao bate com o customer resolvido pela propria sessao, nega.
    if p_customer_id is not null and p_customer_id <> v_cid then
      return jsonb_build_object('ok', false, 'error', 'sem permissao');
    end if;
  end if;

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

-- ===== admin_find_loyalty: ganha p_store_id (admin-fornecido, DEFAULT de compatibilidade), busca so
-- dentro daquela loja, is_admin() cego -> is_admin_of(p_store_id) =====
DROP FUNCTION IF EXISTS public.admin_find_loyalty(text);

CREATE OR REPLACE FUNCTION public.admin_find_loyalty(p_query text, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_phone text := public.normalize_phone(p_query);
  v_q     text := btrim(coalesce(p_query, ''));
  v_required int := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_rec   record;
begin
  if not public.is_admin_of(p_store_id) then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;
  if v_q = '' then return jsonb_build_object('ok', false, 'error', 'busca vazia'); end if;

  select c.id, c.name, c.phone, coalesce(a.stamps,0) as stamps, coalesce(a.rewards_redeemed,0) as rewards_redeemed
    into v_rec
    from public.customers c
    left join public.loyalty_accounts a on a.customer_id = c.id
   where c.store_id = p_store_id
     and ((v_phone is not null and c.phone = v_phone) or c.name ilike '%'||v_q||'%')
   order by (v_phone is not null and c.phone = v_phone) desc, c.created_at desc
   limit 1;

  if v_rec.id is null then return jsonb_build_object('ok', false, 'error', 'cliente nao encontrado'); end if;
  return jsonb_build_object('ok', true, 'customer_id', v_rec.id, 'name', v_rec.name, 'phone', v_rec.phone,
                            'stamps', v_rec.stamps, 'required', v_required,
                            'reward_available', (v_rec.stamps >= v_required), 'rewards_redeemed', v_rec.rewards_redeemed);
end;
$function$;

COMMIT;
