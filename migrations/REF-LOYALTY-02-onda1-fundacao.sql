-- ============================================================================
-- REF-LOYALTY-02 · Onda 1 — Fundação: rastreabilidade do resgate (percentual/valor/pedido)
-- ----------------------------------------------------------------------------
-- Achado da auditoria (docs/ref/REF-LOYALTY-02-auditoria.md): redeem_reward() debita o ledger
-- mas nunca grava order_id/percentual/valor do desconto -- impossível responder "qual recompensa
-- foi usada em qual pedido, com que percentual, com que valor" (decisão de negócio #4, aprovada
-- pelo dono).
--
-- ESCOPO DESTA ONDA: só o MODELO DE DADOS. NÃO integra ao create_order ainda (isso é a Onda 2,
-- aprovada separadamente) e NÃO altera nenhuma tela. redeem_reward() ganha 2 parâmetros NOVOS,
-- OPCIONAIS, com DEFAULT NULL no final da assinatura — toda chamada existente hoje
-- (StoreApp.jsx "Usar desconto agora", AdminFidelidade.jsx "Resgatar recompensa", ambas via
-- loyaltyService.js) continua funcionando IDÊNTICO a antes, sem passar os novos parâmetros.
--
-- CORREÇÃO (achada pelo próprio teste desta onda, scripts/loyalty-02-onda1-test.mjs, ANTES de
-- qualquer cogitação de produção): ao contrário do que o comentário original desta migration
-- assumia, CREATE OR REPLACE com um parâmetro NOVO no final NÃO substitui a função existente —
-- cria um 2º overload (Postgres identifica a função pela lista de tipos dos parâmetros; uma lista
-- mais longa é uma assinatura diferente, mesmo com DEFAULT). Isso foi confirmado ao vivo no E2E:
-- ficaram 2 versões de redeem_reward (2 args e 4 args) e a chamada de 2 args passou a ser
-- AMBÍGUA. Pior: a versão nova, por ser tecnicamente uma função nova, NASCE com o EXECUTE default
-- do schema (`anon` conseguia chamá-la) — os grants do REF-LOYALTY-01 (REVOKE de anon/PUBLIC) NÃO
-- são herdados por um overload novo. Por isso, igual à lição já documentada nesta plataforma para
-- set_loyalty_config (REF-LOYALTY-AUDIT-01 · Onda 1), é preciso DROP FUNCTION explícito da
-- assinatura antiga ANTES do CREATE, e reaplicar REVOKE/GRANT explicitamente depois.
--
-- NÚCLEO INTOCADO: elegibilidade, cap, idempotência, reversão em cancelamento, isolamento por
-- loja/cliente, create_order — nada disso muda aqui.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE). Testado no projeto E2E
-- (bgzcrovskjbktdxkhemd) antes de qualquer cogitação de produção — ver
-- scripts/loyalty-02-onda1-test.mjs. Compat produção (Supabase/Postgres 15).
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) orders.desconto_fidelidade — valor (R$) efetivamente descontado por fidelidade neste
--    pedido. Default 0 preserva 100% dos pedidos existentes e futuros que não usarem a
--    recompensa (nenhum código escreve este campo ainda — só passa a existir para a Onda 2 poder
--    gravar nele dentro da mesma transação de create_order).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS desconto_fidelidade numeric NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) loyalty_events.discount_pct / discount_amount — auditoria do resgate: qual percentual
--    estava configurado no momento do resgate, e qual valor em R$ foi de fato descontado
--    (quando há um pedido/subtotal para calcular sobre — ver função abaixo). Nullable: eventos
--    antigos e tipos que não são 'redeemed' continuam NULL, sem retroatividade forçada.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.loyalty_events
  ADD COLUMN IF NOT EXISTS discount_pct integer,
  ADD COLUMN IF NOT EXISTS discount_amount numeric;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) redeem_reward — ganha 2 parâmetros opcionais no FINAL (default NULL): p_order_id (para a
--    Onda 2 vincular o resgate ao pedido que o consumiu) e p_subtotal_itens (para calcular o
--    valor em R$ do desconto sobre o SUBTOTAL DE PRODUTOS — decisão de negócio #2 aprovada:
--    NUNCA sobre delivery_fee/maquininha_fee/adicional_pagamento_fee, que não entram neste
--    parâmetro). Sem esses 2 parâmetros (todas as chamadas de hoje) o comportamento observável é
--    IDÊNTICO ao anterior, exceto que discount_pct passa a ser sempre gravado (melhoria de
--    auditoria sem efeito colateral — já era um valor que a função calculava internamente, só
--    não persistia).
-- ─────────────────────────────────────────────────────────────────────────
-- Remove SO' a assinatura ANTIGA (2 args) -- idempotente: em reexecucoes ela ja nao existe mais
-- (virou a de 4 args abaixo), entao vira no-op. O CREATE OR REPLACE seguinte, na assinatura NOVA,
-- e' quem garante idempotencia de fato em reexecucoes (substitui-a-si-mesma sem criar overload).
DROP FUNCTION IF EXISTS public.redeem_reward(uuid, uuid);

CREATE OR REPLACE FUNCTION public.redeem_reward(
  p_customer_id uuid DEFAULT NULL::uuid,
  p_store_id uuid DEFAULT public.default_store_id(),
  p_order_id uuid DEFAULT NULL::uuid,
  p_subtotal_itens numeric DEFAULT NULL::numeric
)
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
  v_discount_amount numeric;
begin
  -- Caminho ADMIN: entra aqui so' se p_customer_id foi informado E o chamador
  -- administra A LOJA DAQUELE cliente especificamente. (inalterado)
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

  -- NOVO: valor em R$ do desconto, só calculável quando quem chamou informa o subtotal (Onda 2).
  -- Chamadas de hoje (StoreApp/AdminFidelidade) não passam p_subtotal_itens -> fica NULL, como
  -- sempre foi (a função nunca soube converter percentual em R$ sem um subtotal de referência).
  v_discount_amount := case when p_subtotal_itens is not null
                             then round(p_subtotal_itens * v_discount / 100.0, 2)
                             else null end;

  update public.loyalty_accounts
     set stamps = stamps - v_required, rewards_redeemed = rewards_redeemed + 1, updated_at = now()
   where customer_id = v_cid returning stamps into v_stamps;
  insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id, discount_pct, discount_amount)
    values (v_cid, p_order_id, 'redeemed', -v_required, v_stamps, case when v_admin then 'admin' else 'redeem' end,
            'recompensa ' || v_discount || '%', v_store, v_discount, v_discount_amount);

  return jsonb_build_object('ok', true, 'stamps', v_stamps, 'required', v_required, 'discount', v_discount,
                            'discount_amount', v_discount_amount,
                            'rewards_redeemed', (select rewards_redeemed from public.loyalty_accounts where customer_id = v_cid));
end;
$function$;

-- Lição permanente da Onda 4.1 (REF-LOYALTY-AUDIT-01), reconfirmada aqui pelo achado do teste
-- desta onda: DROP FUNCTION + CREATE reseta o ACL pros defaults do schema (inclusive EXECUTE de
-- PUBLIC/anon). redeem_reward tinha REVOKE customizado desde a origem (REF-LOYALTY-01) --
-- reaplicado explicitamente abaixo.
REVOKE ALL ON FUNCTION public.redeem_reward(uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_reward(uuid, uuid, uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
