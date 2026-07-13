-- REF-BUSINESS-HOURS-03 — Persistencia GLOBAL do override da loja (store_mode) no Supabase.
-- Fonte oficial do modo AUTO/OPEN/CLOSED sai do localStorage (por-navegador) e passa a viver na tabela
-- REUTILIZADA public.settings (chave/valor). Sem tabela nova. Acesso via 2 RPCs SECURITY DEFINER (a RLS de
-- settings segue TRANCADA — ninguem le/escreve settings direto; so pelas funcoes abaixo):
--   get_store_mode()      -> leitura publica (anon + authenticated), default 'AUTO'.
--   set_store_mode(text)  -> escrita restrita a ADMIN (is_admin()); valida o modo; upsert em settings.
-- IDEMPOTENTE (CREATE OR REPLACE / ON CONFLICT / grants repetiveis), VERSIONADA, preserva os dados
-- existentes de settings (so acrescenta a chave 'store_mode'). Rollback em arquivo separado.

BEGIN;

-- Semente idempotente do estado inicial (AUTO = segue o cronograma). Nao sobrescreve valor ja existente.
INSERT INTO public.settings (chave, valor)
VALUES ('store_mode', 'AUTO')
ON CONFLICT (chave) DO NOTHING;

-- Leitura publica do modo atual (default 'AUTO' se, por algum motivo, a chave nao existir).
CREATE OR REPLACE FUNCTION public.get_store_mode()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE((SELECT valor FROM public.settings WHERE chave = 'store_mode' LIMIT 1), 'AUTO');
$function$;

-- Escrita restrita ao administrador. Valida o modo (AUTO/OPEN/CLOSED) e faz upsert. Retorna o modo salvo.
CREATE OR REPLACE FUNCTION public.set_store_mode(p_mode text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_mode text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas administradores podem alterar o status da loja'
      USING ERRCODE = '42501';
  END IF;

  v_mode := upper(coalesce(p_mode, ''));
  IF v_mode NOT IN ('AUTO', 'OPEN', 'CLOSED') THEN
    RAISE EXCEPTION 'modo invalido: % (use AUTO, OPEN ou CLOSED)', p_mode
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.settings (chave, valor)
  VALUES ('store_mode', v_mode)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_mode;
END;
$function$;

-- Grants explicitos (defense-in-depth). get: publico (loja anon + admin). set: so autenticado (e, ainda
-- assim, so passa se is_admin()); anon nunca escreve.
REVOKE ALL ON FUNCTION public.get_store_mode()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_store_mode(text)    FROM PUBLIC;
-- Supabase concede EXECUTE a anon/authenticated por DEFAULT PRIVILEGES ao criar a funcao; revogamos
-- explicitamente o anon da ESCRITA (defense-in-depth; is_admin() ja bloqueia de qualquer forma).
REVOKE EXECUTE ON FUNCTION public.set_store_mode(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_store_mode()     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_store_mode(text) TO authenticated;

COMMIT;

-- Expoe as novas funcoes na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';
