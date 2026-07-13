-- ============================================================================
-- REF-LOYALTY-01a — Hardening do vinculo de identidade (fecha o roubo de fidelidade/historico)
-- ----------------------------------------------------------------------------
-- Auditoria adversarial (REF-LOYALTY-01) confirmou um risco PRE-EXISTENTE em link_customer_to_auth:
-- um usuario autenticado podia REIVINDICAR o cadastro de um cliente-CONVIDADO (auth_user_id NULL)
-- apenas informando o telefone dele, SEM prova de posse (o app so tem OTP de e-mail/Google, nao SMS).
-- Isso ja expunha o historico de pedidos do convidado e, com REF-LOYALTY-01, tambem os selos.
--
-- MITIGACAO (decisao do produto: "mitigar ja"): branch (a) NAO reivindica mais automaticamente um
-- cadastro-convidado que ja possui HISTORICO (pedidos OU selos). Contas novas (telefone sem historico)
-- continuam 100% normais. O vinculo de um convidado com historico passa a exigir verificacao MANUAL do
-- admin (admin_link_customer_to_auth). A tela "Complete seu cadastro" e dispensavel -> nao bloqueia a compra.
--
-- Preserva a identidade da fidelidade: os selos permanecem no customer_id do convidado (nunca some);
-- so a reivindicacao AUTOMATICA nao-verificada e barrada. Idempotente (CREATE OR REPLACE). Preserva dados.
-- Aplicar APOS REF-LOYALTY-01-loyalty.sql (usa a tabela loyalty_events).
-- ============================================================================

-- 1) link_customer_to_auth: identico ao original + guarda anti-reivindicacao de convidado com historico.
create or replace function public.link_customer_to_auth(p_phone text, p_email text DEFAULT NULL::text, p_name text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_phone text := public.normalize_phone(p_phone);
  v_email text := lower(nullif(btrim(p_email), ''));
  v_name  text := nullif(btrim(p_name), '');
  v_cid   uuid;
  v_owner uuid;
begin
  if v_uid   is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
  if v_phone is null then return jsonb_build_object('ok', false, 'error', 'telefone invalido'); end if;

  -- lock por telefone: serializa concorrentes com o mesmo telefone (race-safe, sem duplicar).
  perform pg_advisory_xact_lock(hashtextextended(v_phone, 0));

  -- (a) existe customer com este TELEFONE?
  select id, auth_user_id into v_cid, v_owner from public.customers where phone = v_phone limit 1;
  if v_cid is not null then
    if v_owner is not null and v_owner <> v_uid then
      return jsonb_build_object('ok', false, 'error', 'telefone ja vinculado a outra conta');
    end if;
    -- REF-LOYALTY-01a: NAO reivindicar automaticamente um cadastro-convidado (auth_user_id NULL) que ja
    -- possui HISTORICO (pedidos ou selos) sem prova de posse do telefone. Fecha o roubo; exige verificacao
    -- manual do admin. So afeta telefones COM historico; contas novas seguem normais. Re-link do proprio
    -- dono (v_owner = v_uid) NAO cai aqui (guarda so quando v_owner IS NULL).
    if v_owner is null and (
         exists (select 1 from public.orders where customer_id = v_cid)
      or exists (select 1 from public.loyalty_events where customer_id = v_cid)
    ) then
      return jsonb_build_object('ok', false, 'status', 'requer_verificacao',
        'error', 'Este telefone ja possui historico de pedidos. Para vincula-lo a sua conta, fale com a loja.');
    end if;
    update public.customers
       set auth_user_id = v_uid,
           email = coalesce(v_email, email),
           name  = coalesce(v_name, name)
     where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid,
                              'status', case when v_owner = v_uid then 'ja_vinculado' else 'vinculado' end);
  end if;

  -- (b) este usuario ja tem customer (com outro telefone)? atualiza telefone/email/nome.
  select id into v_cid from public.customers where auth_user_id = v_uid limit 1;
  if v_cid is not null then
    update public.customers set phone = v_phone, email = coalesce(v_email, email), name = coalesce(v_name, name) where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'atualizado');
  end if;

  -- (c) cria novo (telefone identidade + email/nome).
  insert into public.customers(name, phone, email, auth_user_id)
    values (coalesce(v_name, 'Cliente'), v_phone, v_email, v_uid)
  returning id into v_cid;
  return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'criado');
end; $function$;

-- 2) Caminho MANUAL do admin: vincular um cadastro (com historico) a uma conta apos verificar a identidade
--    fora de banda. Admin-only (is_admin()); nunca rouba um cadastro ja vinculado a outra conta.
create or replace function public.admin_link_customer_to_auth(p_customer_id uuid, p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare v_owner uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;
  if p_customer_id is null or p_auth_user_id is null then return jsonb_build_object('ok', false, 'error', 'parametros invalidos'); end if;
  select auth_user_id into v_owner from public.customers where id = p_customer_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'cliente nao encontrado'); end if;
  if v_owner is not null and v_owner <> p_auth_user_id then
    return jsonb_build_object('ok', false, 'error', 'cliente ja vinculado a outra conta');
  end if;
  update public.customers set auth_user_id = p_auth_user_id where id = p_customer_id;
  return jsonb_build_object('ok', true, 'customer_id', p_customer_id);
end; $$;

-- 3) Grants: link permanece como estava (authenticated); admin_link apenas authenticated (is_admin por dentro), anon revogado.
grant execute on function public.link_customer_to_auth(text, text, text) to authenticated;
revoke all on function public.admin_link_customer_to_auth(uuid, uuid) from public, anon;
grant execute on function public.admin_link_customer_to_auth(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
