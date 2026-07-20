-- REF-DELIVERY-01a — CORRECAO do LEITOR do tempo de entrega.
-- BUG: o cliente lia via get_setting('delivery_eta_min',...), mas public.settings tem RLS TRANCADA
-- (ver REF-BUSINESS-HOURS-03: "ninguem le/escreve settings direto; so pelas funcoes"). get_setting NAO e
-- um leitor SECURITY DEFINER seguro para o cliente -> chamado do browser ele NAO enxerga a linha e sempre
-- devolve o FALLBACK. Resultado: a escrita (set_delivery_eta, DEFINER) PERSISTE, mas a leitura sempre
-- retornava 45. Comprovado: get_store_mode() (DEFINER) devolve o valor real, get_setting('store_mode')
-- devolve o fallback para a MESMA chave.
--
-- FIX: leitor DEDICADO get_delivery_eta() SECURITY DEFINER (espelha get_store_mode) — le settings direto,
-- ignora a RLS, leitura PUBLICA (a loja anon precisa exibir a ETA). Sem tabela nova, mesma chave da escrita
-- ('delivery_eta_min'). IDEMPOTENTE. Rollback em arquivo separado.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_delivery_eta()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE((SELECT valor FROM public.settings WHERE chave = 'delivery_eta_min' LIMIT 1), '45');
$function$;

-- Leitura publica (loja anon + admin). Espelha os grants de get_store_mode.
REVOKE ALL ON FUNCTION public.get_delivery_eta() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_delivery_eta() TO anon, authenticated;

COMMIT;

-- Expoe a nova funcao na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';
