-- REF-BILLING-01 · Onda 2 — Cron diario de carencia/bloqueio automatico. Doc de referencia:
-- docs/ref/REF-BILLING-01-descoberta.md secao D ("Cron") e secao I (Onda 2). Depende da Onda 1
-- (store_subscriptions/store_billing_events/gate aditivo em is_admin_of), ja ao vivo em producao.
--
-- Escopo: SOMENTE transicao de ESTADO (em_dia -> carencia -> bloqueada). O RECEBIMENTO do dinheiro
-- continua 100% manual/confirmado pelo Platform Admin via platform_marcar_mensalidade_paga (Onda 1)
-- -- esta migration nao gera cobranca nem mexe em valor_devido/proximo_vencimento, so LE essas
-- colunas pra decidir se a loja avancou de estado.
--
-- Decisoes de implementacao (o doc so fecha "5 dias de carencia, contados a partir do vencimento" --
-- a fronteira exata de qual dia conta como o 1o de carencia/o 1o bloqueado fica pra implementacao,
-- secao H confirma que so restam detalhes tecnicos):
--
--   1. Janela de carencia = os 5 dias CORRIDOS logo apos o vencimento (vencimento+1 ate vencimento+5,
--      ambos inclusive) -- no proprio dia do vencimento a loja ainda esta "em_dia" (nao falhou em
--      pagar antes do prazo acabar). Bloqueio comeca em vencimento+6 (primeiro dia em que os 5 dias
--      de carencia ja se esgotaram por completo). Formula: carencia quando
--      `proximo_vencimento < CURRENT_DATE`; bloqueio quando
--      `CURRENT_DATE > proximo_vencimento + dias_carencia dias`.
--
--   2. So mexe em linhas com status IN ('em_dia','carencia') -- nunca toca 'isenta' (Encanto/
--      Aquarios Bar, decisao B.4, nunca deveriam ser afetadas por nenhum cron desta REF) nem
--      'bloqueada' (ja bloqueada nao gera evento novo TODO santo dia -- so na transicao em si).
--
--   3. Eventos gravados no ledger reaproveitam EXATAMENTE os tipos ja definidos na Onda 1 (nenhum
--      tipo novo inventado): 'vencimento' + 'entrada_carencia' juntos na transicao em_dia->carencia
--      (o vencimento foi atingido E a carencia comecou no mesmo tick), 'bloqueio' na transicao
--      carencia->bloqueada.
--
--   4. platform_billing_cron_tick() nunca e exposta via PostgREST -- GRANT EXECUTE so pra postgres/
--      service_role (mesmo padrao exato de purge_old_logs/reconcile_and_alert, os crons diarios ja
--      existentes). Sem is_super_admin() dentro da funcao: cron nao passa por auth.uid(), a propria
--      ausencia de GRANT pra authenticated/anon ja impede qualquer chamada via API publica.
--
--   5. Agendamento: cron.unschedule + cron.schedule por jobname (mesmo padrao idempotente de
--      REF-LGPD-01-onda1-r05-agenda-purge-old-logs.sql) -- reaplicar esta migration nunca duplica
--      nem move o job. Horario 05:00 UTC (02:00 Brasilia), fora do cluster de crons de manutencao
--      ja existente (03:00-03:30 UTC).
--
-- Companion: REF-BILLING-01-onda2-cron-carencia-bloqueio-rollback.sql

BEGIN;

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
  -- ===== em_dia -> carencia: vencimento ja passou (a partir do dia seguinte) =====
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

  -- ===== carencia -> bloqueada: os dias_carencia contados do vencimento ja se esgotaram =====
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

REVOKE ALL ON FUNCTION public.platform_billing_cron_tick() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_billing_cron_tick() TO postgres, service_role;

SELECT cron.unschedule('encanto-billing-cron-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encanto-billing-cron-tick');
SELECT cron.schedule('encanto-billing-cron-tick', '0 5 * * *',
  $$select public.platform_billing_cron_tick();$$);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificacao pos-aplicacao:
-- SELECT jobname, schedule, command, active FROM cron.job WHERE jobname = 'encanto-billing-cron-tick';
