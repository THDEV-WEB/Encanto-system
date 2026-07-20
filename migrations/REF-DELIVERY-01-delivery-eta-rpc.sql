-- REF-DELIVERY-01 — Tempo estimado de ENTREGA como configuracao administrativa (nao mais hardcoded).
-- Reutiliza a tabela public.settings (chave/valor) — chave 'delivery_eta_min' (minutos, guardado como texto,
-- igual aos demais settings). LEITURA publica pelo get_setting() JA EXISTENTE (mesmo usado por loyalty/etc.);
-- ESCRITA via novo RPC set_delivery_eta(int), restrito a ADMIN (is_admin()), com validacao de faixa (10..180).
-- Sem tabela nova, sem localStorage, FONTE UNICA no banco. Espelha exatamente o padrao de REF-BUSINESS-HOURS-03
-- (store_mode). IDEMPOTENTE (INSERT ... ON CONFLICT DO NOTHING / CREATE OR REPLACE / grants repetiveis),
-- VERSIONADA, preserva os dados existentes de settings (so acrescenta a chave). Rollback em arquivo separado.

BEGIN;

-- Semente idempotente do valor inicial (45 min). Nao sobrescreve valor ja existente.
INSERT INTO public.settings (chave, valor)
VALUES ('delivery_eta_min', '45')
ON CONFLICT (chave) DO NOTHING;

-- Escrita restrita ao administrador. Valida a faixa (10..180) e faz upsert. Retorna o valor salvo (int).
CREATE OR REPLACE FUNCTION public.set_delivery_eta(p_min int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_min int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas administradores podem alterar o tempo de entrega'
      USING ERRCODE = '42501';
  END IF;

  v_min := p_min;
  IF v_min IS NULL OR v_min < 10 OR v_min > 180 THEN
    RAISE EXCEPTION 'tempo invalido: % (use entre 10 e 180 minutos)', p_min
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.settings (chave, valor)
  VALUES ('delivery_eta_min', v_min::text)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_min;
END;
$function$;

-- Grants (defense-in-depth). Leitura ja e coberta pelo get_setting existente (publico). set: so autenticado
-- (e, ainda assim, so passa se is_admin()); anon nunca escreve.
REVOKE ALL ON FUNCTION public.set_delivery_eta(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_delivery_eta(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_delivery_eta(int) TO authenticated;

COMMIT;

-- Expoe a nova funcao na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';
