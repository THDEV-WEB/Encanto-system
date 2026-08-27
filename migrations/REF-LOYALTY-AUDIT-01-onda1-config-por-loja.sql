-- ============================================================================
-- REF-LOYALTY-AUDIT-01 · Onda 1 — Configuração da fidelidade por loja (tenant)
-- ----------------------------------------------------------------------------
-- Achado da Onda 0 (auditoria): loyalty_enabled/loyalty_required/loyalty_discount
-- continuavam em `settings` (key-value GLOBAL da plataforma inteira), enquanto as
-- outras 4 configurações operacionais equivalentes (business_hours_schedule,
-- delivery_fee_config, delivery_eta_min, store_mode) já haviam migrado para
-- `store_settings` (por loja) na REF-SAAS-01 · Onda 4.3. Esta migration fecha essa
-- lacuna, reusando EXATAMENTE o mesmo padrão já validado 4x nesta plataforma
-- (get_x(p_store_id)/set_x(..., p_store_id), backfill em store_settings, DELETE das
-- chaves antigas de settings) — nenhuma arquitetura nova.
--
-- NÚCLEO INTOCADO: idempotência (índice único parcial), reversão em cancelamento
-- (trigger), identificação de cliente (auth.uid()->customers), histórico
-- (loyalty_events ledger) — nada disso muda aqui. Só a FONTE dos 3 parâmetros de
-- configuração (enabled/required/discount) passa de settings->store_settings.
--
-- DECISÃO DE PRODUTO EXPLÍCITA (dono, 2026-08-27): o bypass do admin no kill switch
-- (redeem_reward ramo administrativo / admin_adjust_loyalty não checam `enabled`)
-- É MANTIDO como está — INATIVO bloqueia só o caminho automático/cliente, não as
-- ações manuais do admin. Por isso NENHUMA dessas 2 funções ganha checagem de
-- `enabled` nesta migration — segue exatamente como já funcionava.
--
-- DEFAULT SEGURO para loja SEM configuração própria (nenhuma linha em store_settings
-- ainda): enabled=false, required=10, discount=50. Documentado aqui, não herdado
-- silenciosamente de nenhuma outra loja — uma loja nova SEMPRE nasce com fidelidade
-- DESLIGADA até um admin ligar explicitamente.
--
-- Idempotente (INSERT ... ON CONFLICT DO NOTHING, CREATE OR REPLACE, DROP FUNCTION
-- IF EXISTS antes de qualquer troca de assinatura). Preserva 100% dos dados
-- existentes. Compat produção (Supabase/Postgres 15).
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) BACKFILL — preserva o estado GLOBAL atual como a configuração da Encanto.
--    Estado real hoje (confirmado por leitura antes desta migration):
--    loyalty_enabled='false' · loyalty_required='10' · loyalty_discount='50'.
--    Não ativa nada: copia exatamente o que já está em vigor.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.store_settings (store_id, chave, valor)
SELECT (SELECT id FROM public.stores WHERE slug = 'encanto'), chave, valor
FROM public.settings
WHERE chave IN ('loyalty_required', 'loyalty_discount', 'loyalty_enabled')
ON CONFLICT (store_id, chave) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) loyalty_grant — resolve a loja do cliente PRIMEIRO, depois lê enabled/required
--    escopados àquela loja. Loja sem configuração própria = DESATIVADO (default
--    seguro, nunca concede selo por engano numa loja nova sem ninguém ter ligado).
--    Assinatura inalterada (2 args) — CREATE OR REPLACE simples, sem DROP.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.loyalty_grant(p_customer_id uuid, p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_store    uuid;
  v_required int;
  v_enabled  boolean;
  v_stamps   int;
begin
  if p_customer_id is null or p_order_id is null then return; end if;
  -- idempotencia macia (o indice unico parcial e o backstop duro)
  if exists (select 1 from public.loyalty_events where order_id = p_order_id and tipo = 'earned') then return; end if;

  select store_id into v_store from public.customers where id = p_customer_id;
  if v_store is null then return; end if;

  v_enabled  := coalesce((select valor from public.store_settings where store_id = v_store and chave = 'loyalty_enabled'), 'false') <> 'false';
  if not v_enabled then return; end if;
  v_required := coalesce((select valor from public.store_settings where store_id = v_store and chave = 'loyalty_required'), '10')::int;

  insert into public.loyalty_accounts (customer_id, store_id) values (p_customer_id, v_store)
    on conflict (customer_id) do nothing;
  select stamps into v_stamps from public.loyalty_accounts where customer_id = p_customer_id for update;

  if coalesce(v_stamps, 0) >= v_required then return; end if;   -- cartela cheia: nao acumula alem

  update public.loyalty_accounts
     set stamps = stamps + 1, earned_total = earned_total + 1, updated_at = now()
   where customer_id = p_customer_id
   returning stamps into v_stamps;

  insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
    values (p_customer_id, p_order_id, 'earned', 1, v_stamps, 'create_order', 'pedido valido', v_store);
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) loyalty_void_on_cancel — só o `required` (usado no teto da reativação) passa a
--    ser lido por loja (NEW.store_id já disponível, é trigger de orders). A reversão
--    em si continua sempre ativa, independente de `enabled` — comportamento
--    inalterado (reverter uma concessão já feita é sempre seguro).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.loyalty_void_on_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_stamps   int;
  v_required int;
  v_contrib  int;
  v_earned   boolean;
begin
  v_required := coalesce((select valor from public.store_settings where store_id = new.store_id and chave = 'loyalty_required'), '10')::int;

  if new.status = 'cancelado' and coalesce(old.status,'') <> 'cancelado' then
    begin
      select coalesce(sum(delta),0) into v_contrib from public.loyalty_events
        where order_id = new.id and origem in ('create_order','cancel_trigger');
      if v_contrib > 0 then
        update public.loyalty_accounts
           set stamps = greatest(0, stamps - v_contrib), earned_total = greatest(0, earned_total - v_contrib), updated_at = now()
         where customer_id = new.customer_id
         returning stamps into v_stamps;
        insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
          values (new.customer_id, new.id, 'revoked', -v_contrib, v_stamps, 'cancel_trigger', 'pedido cancelado', new.store_id);
      end if;
    exception when others then
      null;
    end;
  elsif coalesce(old.status,'') = 'cancelado' and new.status <> 'cancelado' then
    begin
      select exists (select 1 from public.loyalty_events where order_id = new.id and tipo = 'earned') into v_earned;
      select coalesce(sum(delta),0) into v_contrib from public.loyalty_events
        where order_id = new.id and origem in ('create_order','cancel_trigger');
      if v_earned and v_contrib <= 0 then
        select stamps into v_stamps from public.loyalty_accounts where customer_id = new.customer_id for update;
        if coalesce(v_stamps,0) < v_required then
          update public.loyalty_accounts
             set stamps = stamps + 1, earned_total = earned_total + 1, updated_at = now()
           where customer_id = new.customer_id
           returning stamps into v_stamps;
          insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
            values (new.customer_id, new.id, 'adjustment', 1, v_stamps, 'cancel_trigger', 'pedido reativado', new.store_id);
        end if;
      end if;
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) get_my_loyalty — mesma assinatura desde a Onda 4.2 (p_store_id já existe).
--    Só troca a FONTE de enabled/required/discount para store_settings.
-- ─────────────────────────────────────────────────────────────────────────
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
  v_required int;
  v_discount int;
  v_enabled  boolean;
begin
  v_required := coalesce((select valor from public.store_settings where store_id = p_store_id and chave = 'loyalty_required'), '10')::int;
  v_discount := coalesce((select valor from public.store_settings where store_id = p_store_id and chave = 'loyalty_discount'), '50')::int;
  v_enabled  := coalesce((select valor from public.store_settings where store_id = p_store_id and chave = 'loyalty_enabled'), 'false') <> 'false';

  if v_uid is not null then
    select id into v_cid from public.customers where auth_user_id = v_uid and store_id = p_store_id limit 1;
    if v_cid is not null then
      select stamps, rewards_redeemed into v_stamps, v_rr from public.loyalty_accounts where customer_id = v_cid;
      v_stamps := coalesce(v_stamps, 0); v_rr := coalesce(v_rr, 0);
    end if;
  end if;
  -- programa desativado NUNCA oferece recompensa (nem no cliente, nem na API)
  return jsonb_build_object('enabled', v_enabled, 'stamps', v_stamps, 'required', v_required,
                            'discount', v_discount, 'reward_available', (v_enabled and v_stamps >= v_required),
                            'rewards_redeemed', v_rr, 'has_account', (v_cid is not null));
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) redeem_reward — mesma assinatura desde a Onda 4.2. `enabled` só é checado no
--    ramo do CLIENTE final (mesmo comportamento de sempre); o ramo ADMINISTRATIVO
--    continua sem checar `enabled` (decisão explícita do dono, ver cabeçalho).
--    required/discount passam a ser lidos da loja resolvida (v_store), depois de
--    determinada — nunca mais de um valor global fixo em tempo de declaração.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redeem_reward(p_customer_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT public.default_store_id())
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
  -- Caminho ADMIN: entra aqui so' se p_customer_id foi informado E o chamador
  -- administra A LOJA DAQUELE cliente especificamente.
  if v_cid is not null then
    select store_id into v_store from public.customers where id = v_cid;
    if v_store is not null then v_admin := public.is_admin_of(v_store); end if;
  end if;

  if v_admin then
    null; -- ja validado acima; v_store = loja do cliente-alvo. Admin NAO checa `enabled` (by design).
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

-- ─────────────────────────────────────────────────────────────────────────
-- 6) admin_find_loyalty — mesma assinatura desde a Onda 4.2. Só o `required`
--    (usado no retorno) passa a ser lido da loja pesquisada (p_store_id).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_find_loyalty(p_query text, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_phone text := public.normalize_phone(p_query);
  v_q     text := btrim(coalesce(p_query, ''));
  v_required int;
  v_rec   record;
begin
  if not public.is_admin_of(p_store_id) then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;
  if v_q = '' then return jsonb_build_object('ok', false, 'error', 'busca vazia'); end if;

  v_required := coalesce((select valor from public.store_settings where store_id = p_store_id and chave = 'loyalty_required'), '10')::int;

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

-- ─────────────────────────────────────────────────────────────────────────
-- 7) admin_adjust_loyalty — mesma assinatura. Só o `required` (usado no retorno)
--    passa a ser lido da loja do cliente (v_store, já resolvida). Continua SEM
--    checar `enabled` — decisão explícita do dono (bypass do admin mantido).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_adjust_loyalty(p_customer_id uuid, p_delta integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_required int;
  v_stamps int;
  v_store uuid;
begin
  if p_customer_id is null or coalesce(p_delta,0) = 0 then return jsonb_build_object('ok', false, 'error', 'parametros invalidos'); end if;
  select store_id into v_store from public.customers where id = p_customer_id;
  if v_store is null then return jsonb_build_object('ok', false, 'error', 'cliente nao encontrado'); end if;
  if not public.is_admin_of(v_store) then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;

  v_required := coalesce((select valor from public.store_settings where store_id = v_store and chave = 'loyalty_required'), '10')::int;

  insert into public.loyalty_accounts (customer_id, store_id) values (p_customer_id, v_store) on conflict (customer_id) do nothing;
  select stamps into v_stamps from public.loyalty_accounts where customer_id = p_customer_id for update;

  v_stamps := greatest(0, coalesce(v_stamps,0) + p_delta);
  update public.loyalty_accounts
     set stamps = v_stamps,
         earned_total = greatest(0, earned_total + greatest(p_delta, 0)),
         updated_at = now()
   where customer_id = p_customer_id;
  insert into public.loyalty_events (customer_id, tipo, delta, stamps_after, origem, note, store_id)
    values (p_customer_id, 'adjustment', p_delta, v_stamps, 'admin', coalesce(nullif(btrim(p_note),''), 'ajuste manual'), v_store);

  return jsonb_build_object('ok', true, 'stamps', v_stamps, 'required', v_required, 'reward_available', (v_stamps >= v_required));
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) get_loyalty_config — NOVA RPC de leitura, mesmo papel de get_delivery_fee_config/
--    get_business_hours_schedule/get_delivery_eta/get_store_mode (pública, sem
--    is_admin() — o valor já é exposto pelo get_my_loyalty a qualquer chamador).
--    Substitui as 3 chamadas a get_setting() que o Admin fazia direto do frontend.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_loyalty_config(p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'required', COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'loyalty_required'), '10')::int,
    'discount', COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'loyalty_discount'), '50')::int,
    'enabled',  COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'loyalty_enabled'), 'false') <> 'false'
  );
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) set_loyalty_config — GANHA p_store_id (troca de assinatura -> DROP explícito,
--    lição da Onda 3/4.x). is_admin() cego -> is_admin_of(p_store_id) (mesmo padrão
--    de set_delivery_fee_config/set_store_mode/set_business_hours_schedule/
--    set_delivery_eta). Grava em store_settings, não mais em settings.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.set_loyalty_config(integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.set_loyalty_config(p_required integer, p_discount integer, p_enabled boolean, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if not public.is_admin_of(p_store_id) then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;
  if p_required is null or p_required < 1 or p_required > 100 then return jsonb_build_object('ok', false, 'error', 'required invalido'); end if;
  if p_discount is null or p_discount < 1 or p_discount > 100 then return jsonb_build_object('ok', false, 'error', 'discount invalido'); end if;

  insert into public.store_settings (store_id, chave, valor) values (p_store_id, 'loyalty_required', p_required::text)
    on conflict (store_id, chave) do update set valor = excluded.valor;
  insert into public.store_settings (store_id, chave, valor) values (p_store_id, 'loyalty_discount', p_discount::text)
    on conflict (store_id, chave) do update set valor = excluded.valor;
  insert into public.store_settings (store_id, chave, valor) values (p_store_id, 'loyalty_enabled', case when p_enabled then 'true' else 'false' end)
    on conflict (store_id, chave) do update set valor = excluded.valor;

  return jsonb_build_object('ok', true, 'required', p_required, 'discount', p_discount, 'enabled', p_enabled);
end;
$function$;

-- Lição permanente da Onda 4.1 (achado do addendum): DROP FUNCTION + CREATE reseta o
-- ACL pros defaults do schema (inclusive EXECUTE de PUBLIC). set_loyalty_config tinha
-- REVOKE customizado desde a origem (REF-LOYALTY-01) -- reaplicado explicitamente aqui.
REVOKE EXECUTE ON FUNCTION public.set_loyalty_config(integer, integer, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_loyalty_config(integer, integer, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_loyalty_config(integer, integer, boolean, uuid) TO authenticated;

-- get_loyalty_config é NOVA -- grants explícitos (mesmo padrão de get_delivery_fee_config/
-- get_business_hours_schedule/get_delivery_eta/get_store_mode: público, sem is_admin()).
GRANT EXECUTE ON FUNCTION public.get_loyalty_config(uuid) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) Remove as 3 chaves da settings GLOBAL — nada mais as lê a partir daqui
--     (confirmado por auditoria: só as 7 funções acima liam essas 3 chaves).
--     Mesma decisão já tomada para as outras 4 chaves na Onda 4.3 (ADR §12.1).
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM public.settings WHERE chave IN ('loyalty_required', 'loyalty_discount', 'loyalty_enabled');

-- recarrega o schema no PostgREST (assinatura nova de set_loyalty_config + get_loyalty_config
-- ficam visiveis na API imediatamente)
NOTIFY pgrst, 'reload schema';

COMMIT;
