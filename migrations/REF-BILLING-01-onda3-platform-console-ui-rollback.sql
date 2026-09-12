-- REF-BILLING-01 · Onda 3 — Rollback: remove platform_list_billing() e restaura get_billing_status()
-- ao estado exato da Onda 1 (sem o campo 'historico').

BEGIN;

DROP FUNCTION IF EXISTS public.platform_list_billing();

CREATE OR REPLACE FUNCTION public.get_billing_status(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row public.store_subscriptions%ROWTYPE;
BEGIN
  IF NOT (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = p_store_id AND a.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'sem permissao para consultar o billing desta loja' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.store_subscriptions WHERE store_id = p_store_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('store_id', p_store_id, 'status', 'sem_assinatura');
  END IF;

  RETURN jsonb_build_object(
    'store_id', v_row.store_id,
    'status', v_row.status,
    'dia_vencimento', v_row.dia_vencimento,
    'proximo_vencimento', v_row.proximo_vencimento,
    'dias_carencia', v_row.dias_carencia,
    'valor_devido', v_row.valor_devido,
    'trial_ate', v_row.trial_ate,
    'contato_financeiro_nome', v_row.contato_financeiro_nome,
    'contato_financeiro_email', v_row.contato_financeiro_email,
    'contato_financeiro_whatsapp', v_row.contato_financeiro_whatsapp
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
