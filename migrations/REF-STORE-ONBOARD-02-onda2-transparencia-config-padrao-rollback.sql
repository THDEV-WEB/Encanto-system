-- Rollback de REF-STORE-ONBOARD-02-onda2-transparencia-config-padrao.sql
-- Restaura get_business_hours_schedule/get_delivery_fee_config ao estado anterior, sem o campo
-- configuracao_propria.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_business_hours_schedule(p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    (SELECT valor::jsonb FROM public.store_settings WHERE store_id = p_store_id AND chave = 'business_hours_schedule' LIMIT 1),
    '{"version":1,"timezone":"America/Sao_Paulo","schedule":{"domingo":{"fechado":true,"periodos":[]},"segunda":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"}]},"terca":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"quarta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"quinta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"sexta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"sabado":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]}},"exceptions":{}}'::jsonb
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_delivery_fee_config(p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    (SELECT valor::jsonb FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_fee_config' LIMIT 1),
    '{"version":1,"ativo":true,"maquininha":{"ativo":true,"valor":2.00},"faixas":[{"de":0.0,"ate":5.0,"valor":10.00},{"de":5.1,"ate":6.0,"valor":12.00},{"de":6.1,"ate":7.0,"valor":14.00},{"de":7.1,"ate":8.0,"valor":16.00},{"de":8.1,"ate":9.0,"valor":18.00},{"de":9.1,"ate":10.0,"valor":20.00},{"de":10.1,"ate":11.0,"valor":22.00},{"de":11.1,"ate":12.0,"valor":24.00},{"de":12.1,"ate":13.0,"valor":26.00},{"de":13.1,"ate":14.0,"valor":28.00},{"de":14.1,"ate":15.0,"valor":30.00},{"de":15.1,"ate":16.0,"valor":32.00},{"de":16.1,"ate":17.0,"valor":34.00},{"de":17.1,"ate":18.0,"valor":36.00},{"de":18.1,"ate":19.0,"valor":38.00},{"de":19.1,"ate":20.0,"valor":40.00},{"de":20.1,"ate":21.0,"valor":42.00}]}'::jsonb
  );
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
