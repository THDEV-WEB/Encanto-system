-- REF-AUTH-TENANT-01 — Onda 6: link_customer_to_auth passa a validar o claim tenant_id
--
-- *** SÓ APLICAR NO PROJETO E2E POR ENQUANTO. NÃO APLICAR EM PRODUÇÃO. ***
-- Produção ainda tem o Custom Access Token Hook DESLIGADO (Onda 3) — hoje 100% das sessões de
-- produção nunca carregam tenant_id. Aplicar em produção só depois que o Hook estiver ligado lá
-- também (decisão separada, fora desta onda).
--
-- Achado da auditoria: p_store_id sempre foi um SELETOR confiado cegamente (vindo do domínio
-- resolvido no client, via buildStorefrontRpcParam()) — nunca comparado contra nada. Um caller
-- autenticado na sessão da Encanto podia chamar link_customer_to_auth(..., p_store_id=Bar) direto
-- pela API e vincular/criar customer na loja errada, sem nunca ter uma sessão real ali.
--
-- Regra nova (degradação graciosa, MESMO padrão já aprovado na Onda 5/save_structured_address):
--   tenant_id PRESENTE no JWT  -> p_store_id PRECISA ser igual ao tenant_id, senão DENY (mesma
--                                 mensagem genérica de "loja invalida" usada quando p_store_id é
--                                 NULL — não revela se a loja alvo existe ou não).
--   tenant_id AUSENTE no JWT   -> comportamento LEGADO preservado byte a byte (p_store_id como
--                                 seletor, default_store_id() como fallback). Isso é o que mantém
--                                 produção (Hook desligado) e o helper de setup do E2E Playwright
--                                 (e2e/support/fixture-customer.js, que chama a RPC direto por um
--                                 client anon sem nunca passar por activate_tenant) funcionando sem
--                                 nenhuma mudança de comportamento.
-- Nunca cai para "sem tenant = escolhe pelo domínio/primeiro tenant/customer existente" — a única
-- coisa que a ausência de tenant_id preserva é o comportamento QUE JÁ EXISTIA, nada novo é inferido.
--
-- Resto da função (anti-takeover de telefone, guarda REF-LOYALTY-01a de "requer_verificacao", casos
-- a/b/c) permanece IDÊNTICO — nenhuma proteção existente foi tocada.
--
-- admin_link_customer_to_auth / is_admin_of NÃO são tocadas (fora do escopo, já corretas).
-- getMeuCustomer/RLS de leitura de customers NÃO são tocadas nesta onda (achado registrado como
-- follow-up separado, não ampliado aqui).

BEGIN;

CREATE OR REPLACE FUNCTION public.link_customer_to_auth(p_phone text, p_email text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_phone  text := public.normalize_phone(p_phone);
  v_email  text := lower(nullif(btrim(p_email), ''));
  v_name   text := nullif(btrim(p_name), '');
  v_store  uuid := p_store_id;
  v_tenant uuid := nullif(auth.jwt()->>'tenant_id', '')::uuid;
  v_cid    uuid;
  v_owner  uuid;
begin
  if v_uid   is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
  if v_phone is null then return jsonb_build_object('ok', false, 'error', 'telefone invalido'); end if;
  if v_store is null then return jsonb_build_object('ok', false, 'error', 'loja invalida'); end if;

  -- REF-AUTH-TENANT-01 · Onda 6: com tenant_id assinado presente, p_store_id deixa de ser confiavel
  -- sozinho -- precisa bater com o tenant da sessao. Mesma mensagem generica de "loja invalida" do
  -- check acima (nao revela se a loja alvo existe). Sem tenant_id, comportamento legado preservado.
  if v_tenant is not null and v_tenant <> v_store then
    return jsonb_build_object('ok', false, 'error', 'loja invalida');
  end if;

  -- lock por telefone+loja: serializa concorrentes com o mesmo telefone NA MESMA loja (race-safe, sem
  -- duplicar). Duas lojas distintas com o mesmo telefone (cliente comum) nao contendem pelo mesmo lock.
  perform pg_advisory_xact_lock(hashtextextended(v_phone || ':' || v_store::text, 0));

  -- (a) existe customer com este TELEFONE nesta LOJA?
  select id, auth_user_id into v_cid, v_owner from public.customers where phone = v_phone and store_id = v_store limit 1;
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

  -- (b) este usuario ja tem customer NESTA LOJA (com outro telefone)? atualiza telefone/email/nome.
  select id into v_cid from public.customers where auth_user_id = v_uid and store_id = v_store limit 1;
  if v_cid is not null then
    update public.customers set phone = v_phone, email = coalesce(v_email, email), name = coalesce(v_name, name) where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'atualizado');
  end if;

  -- (c) cria novo (telefone identidade + email/nome), nesta loja.
  insert into public.customers(name, phone, email, auth_user_id, store_id)
    values (coalesce(v_name, 'Cliente'), v_phone, v_email, v_uid, v_store)
  returning id into v_cid;
  return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'criado');
end; $function$;

-- Minimo privilegio: link_customer_to_auth exige auth.uid() (nega educadamente sem ele), entao
-- anon/PUBLIC nunca tiravam proveito do EXECUTE -- mas o padrao das Ondas 2/3 (RPCs de tenant
-- restritas a authenticated) fica quebrado por essa concessao historica. Fecha aqui.
REVOKE EXECUTE ON FUNCTION public.link_customer_to_auth(text, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_customer_to_auth(text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_customer_to_auth(text, text, text, uuid) TO authenticated;

COMMIT;
