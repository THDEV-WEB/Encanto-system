-- REF-BILLING-01 · Onda 2 — Rollback: desagenda o cron e remove platform_billing_cron_tick(). Nao
-- reverte nenhuma transicao de status ja aplicada por execucoes anteriores do job -- isso e estado
-- real de negocio (uma loja que ja entrou em carencia/foi bloqueada continua exatamente assim),
-- mesmo padrao de todo rollback desta REF (so desfaz DEFINICAO, nunca dado ja gravado).

BEGIN;

SELECT cron.unschedule('encanto-billing-cron-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encanto-billing-cron-tick');

DROP FUNCTION IF EXISTS public.platform_billing_cron_tick();

COMMIT;

NOTIFY pgrst, 'reload schema';
