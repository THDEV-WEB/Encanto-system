-- REF-BILLING-01 · Onda 5 — Rollback: restaura platform_billing_cron_tick() ao estado exato da Onda
-- 2 (sem geracao de aviso), restaura o cron pra so chamar o tick, remove o dispatch de e-mail e as 2
-- tabelas novas (greenfield desta onda).

BEGIN;

SELECT cron.unschedule('encanto-billing-cron-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encanto-billing-cron-tick');
SELECT cron.schedule('encanto-billing-cron-tick', '0 5 * * *',
  $$select public.platform_billing_cron_tick();$$);

DROP FUNCTION IF EXISTS public.platform_billing_reminder_dispatch();

CREATE OR REPLACE FUNCTION public.platform_billing_cron_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_para_carencia  uuid[];
  v_para_bloqueada uuid[];
  v_store_id       uuid;
BEGIN
  SELECT array_agg(store_id) INTO v_para_carencia
  FROM public.store_subscriptions
  WHERE status = 'em_dia'
    AND proximo_vencimento IS NOT NULL
    AND proximo_vencimento < CURRENT_DATE;

  UPDATE public.store_subscriptions
  SET status = 'carencia', updated_at = now()
  WHERE store_id = ANY (COALESCE(v_para_carencia, ARRAY[]::uuid[]));

  IF v_para_carencia IS NOT NULL THEN
    FOREACH v_store_id IN ARRAY v_para_carencia LOOP
      INSERT INTO public.store_billing_events (store_id, tipo, payload)
      VALUES (v_store_id, 'vencimento', jsonb_build_object('motivo', 'vencimento atingido sem pagamento confirmado'));
      INSERT INTO public.store_billing_events (store_id, tipo, payload)
      VALUES (v_store_id, 'entrada_carencia',
              jsonb_build_object('dias_carencia', (SELECT dias_carencia FROM public.store_subscriptions WHERE store_id = v_store_id)));
    END LOOP;
  END IF;

  SELECT array_agg(store_id) INTO v_para_bloqueada
  FROM public.store_subscriptions
  WHERE status = 'carencia'
    AND proximo_vencimento IS NOT NULL
    AND CURRENT_DATE > (proximo_vencimento + make_interval(days => dias_carencia));

  UPDATE public.store_subscriptions
  SET status = 'bloqueada', updated_at = now()
  WHERE store_id = ANY (COALESCE(v_para_bloqueada, ARRAY[]::uuid[]));

  IF v_para_bloqueada IS NOT NULL THEN
    FOREACH v_store_id IN ARRAY v_para_bloqueada LOOP
      INSERT INTO public.store_billing_events (store_id, tipo, payload)
      VALUES (v_store_id, 'bloqueio', jsonb_build_object('motivo', 'carencia esgotada sem pagamento confirmado'));
    END LOOP;
  END IF;

  INSERT INTO public.application_logs (module, operation, level, message, payload, version, origin)
  VALUES ('billing', 'platform_billing_cron_tick', 'info', 'tick de carencia/bloqueio concluido',
          jsonb_build_object(
            'para_carencia', COALESCE(array_length(v_para_carencia, 1), 0),
            'para_bloqueada', COALESCE(array_length(v_para_bloqueada, 1), 0)
          ),
          'billing-01-onda2', 'cron');

  RETURN jsonb_build_object(
    'ok', true,
    'para_carencia', COALESCE(v_para_carencia, ARRAY[]::uuid[]),
    'para_bloqueada', COALESCE(v_para_bloqueada, ARRAY[]::uuid[])
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.platform_configurar_dados_pagamento(text, text, text);
DROP FUNCTION IF EXISTS public.get_platform_billing_config();

DROP TABLE IF EXISTS public.platform_billing_reminder_outbox;
DROP TABLE IF EXISTS public.platform_billing_config;

COMMIT;

NOTIFY pgrst, 'reload schema';
