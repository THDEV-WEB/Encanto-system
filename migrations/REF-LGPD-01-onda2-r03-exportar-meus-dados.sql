-- REF-LGPD-01 · Onda 2 · LGPD-R03 (parte tecnica: PORTABILIDADE) — exportacao self-service dos proprios
-- dados. Acesso/correcao ja existiam (tela "Minha Conta", REF-CLIENTE-03); exclusao ja foi resolvida na
-- Onda 1 (LGPD-R01). O que faltava tecnicamente pra R03 era portabilidade -- um jeito do proprio titular
-- levar os dados embora, sem depender do admin.
--
-- Oposicao/revogacao: NAO tratada aqui como funcao nova -- ja existe um canal real (tela "Contato",
-- ContatoScreen.jsx, WhatsApp/telefone/e-mail vindos de company_info) e a Politica de Privacidade
-- (LGPD-R02, Onda 1) ja aponta pra ele. Continua sendo um canal MANUAL (nao self-service), registrado
-- como MITIGADO, nao CORRIGIDO -- formalizar um fluxo self-service de oposicao dependeria de definir
-- juridicamente quais tratamentos tem base legal opoivel, o que esta REF nao pode inventar.
--
-- Escopo do export: dados que o proprio titular digitou ou que decorrem diretamente do uso do servico
-- (perfil, enderecos, pedidos+itens, fidelidade) -- nao inclui metadados internos (ids de outras
-- pessoas, logs de auditoria, dados de terceiros). SECURITY DEFINER ancorado em auth.uid(); somatorio de
-- TODOS os customers vinculados aquele auth_user_id (mesma pessoa pode ter conta em mais de uma loja).
-- Read-only (nenhuma escrita, risco minimo).
--
-- Companion: REF-LGPD-01-onda2-r03-exportar-meus-dados-rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.lgpd_export_my_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sessao invalida' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'gerado_em', now(),
    'clientes', coalesce(jsonb_agg(
      jsonb_build_object(
        'loja_id', c.store_id,
        'id', c.id,
        'nome', c.name,
        'telefone', c.phone,
        'email', c.email,
        'cliente_desde', c.created_at,
        'enderecos', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'rua', a.rua, 'numero', a.numero, 'bairro', a.bairro, 'cidade', a.cidade,
            'complemento', a.complemento, 'estado', a.estado, 'cep', a.cep,
            'referencia', a.referencia, 'latitude', a.latitude, 'longitude', a.longitude,
            'criado_em', a.created_at
          )), '[]'::jsonb)
          FROM public.addresses a WHERE a.customer_id = c.id
        ),
        'pedidos', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', o.id, 'criado_em', o.created_at, 'status', o.status, 'total', o.total,
            'forma_pagamento', o.payment_method, 'endereco', o.address, 'observacoes', o.observacoes,
            'itens', (
              SELECT coalesce(jsonb_agg(jsonb_build_object(
                'produto', oi.nome_produto, 'quantidade', oi.quantity, 'preco_unitario', oi.preco_unitario,
                'adicionais', oi.adicionais, 'observacoes', oi.observacoes
              )), '[]'::jsonb)
              FROM public.order_items oi WHERE oi.order_id = o.id
            )
          ) ORDER BY o.created_at DESC), '[]'::jsonb)
          FROM public.orders o WHERE o.customer_id = c.id
        ),
        'fidelidade', (
          SELECT jsonb_build_object('selos', la.stamps, 'total_ganho', la.earned_total, 'resgates', la.rewards_redeemed)
          FROM public.loyalty_accounts la WHERE la.customer_id = c.id
        )
      )
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.customers c
  WHERE c.auth_user_id = v_uid;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.lgpd_export_my_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lgpd_export_my_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.lgpd_export_my_data() TO authenticated;

COMMENT ON FUNCTION public.lgpd_export_my_data() IS
  'REF-LGPD-01 LGPD-R03 (portabilidade): export read-only dos proprios dados (auth.uid()). '
  'Sem parametros -- nunca aceita id de outro cliente.';

COMMIT;

-- Verificacao pos-aplicacao:
-- SELECT prosecdef FROM pg_proc WHERE proname = 'lgpd_export_my_data'; -- deve ser true (SECURITY DEFINER)
-- SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_schema='public' AND routine_name='lgpd_export_my_data'; -- anon NAO deve aparecer
