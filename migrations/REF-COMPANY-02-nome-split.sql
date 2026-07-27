-- REF-COMPANY-02 (1/9) — Divide o campo institucional 'nome' em 'nomeCurto' + 'nomeCompleto'.
--
-- CONTEXTO (REF-AUDIT-COMPANY-01): company_info.nome existe e e administravel no Admin desde a
-- REF-COMPANY-01, mas nunca e lido por nenhuma UI alem do proprio formulario que o edita — todo nome
-- institucional realmente exibido hoje (header, sidebar do Admin, login, comanda, notificacoes) e um
-- literal hardcoded "Encanto" espalhado pelo codigo. Esta ref conecta o campo aos consumidores reais.
--
-- POR QUE DOIS CAMPOS (nao um so)? O header da loja ja mostra o nome ao lado de uma tagline
-- ("Marmita e Açaí") e da cidade ("Timbó"); o valor hoje salvo em 'nome' ("Encanto — Açaí & Marmitas")
-- duplicaria a tagline e estouraria o espaco de superficies compactas (sidebar do Admin, titulo do
-- login, comanda termica 50/72mm). A tarefa proibe derivar o nome curto do completo via
-- substring()/split() (paliativo) — a unica solucao sem gambiarra e dois campos independentes e
-- administraveis. Custo zero de RPC nova: company_info ja e um objeto JSON schemaless (REF-COMPANY-01
-- §2.1), entao adicionar um campo e so mais um `IF p_patch ? 'x'` em set_company_info.
--
-- DADOS: a migration RENOMEIA a chave JSON (nome -> nomeCompleto) preservando o valor JA GRAVADO em
-- producao (nunca reseta o que o admin salvou), e ACRESCENTA nomeCurto com o default 'Encanto' (o
-- literal que ja esta hoje, hardcoded, em todo lugar — a migracao fica visualmente byte-identica ao
-- que ja esta no ar). Idempotente: o UPDATE so roda se a chave antiga 'nome' ainda existir.
--
-- RPCs: get_company_info/set_company_info sao redefinidas via CREATE OR REPLACE (mesma assinatura,
-- mesmos grants — nao precisa reconceder). set_company_info troca o bloco unico de validacao de 'nome'
-- por dois blocos identicos (trim, minimo 2 chars) para nomeCurto/nomeCompleto.
--
-- Requer REF-COMPANY-01-institutional-info.sql (ja aplicada). Rollback em arquivo separado.

BEGIN;

-- Migra o valor ja salvo (idempotente: sem-op se a chave 'nome' nao existir mais, ou se a linha nao existir).
UPDATE public.settings
SET valor = (
  (valor::jsonb - 'nome')
  || jsonb_build_object(
       'nomeCompleto', COALESCE(valor::jsonb->'nome', to_jsonb('Encanto — Açaí & Marmitas'::text)),
       'nomeCurto',    COALESCE(valor::jsonb->'nomeCurto', to_jsonb('Encanto'::text))
     )
)::text
WHERE chave = 'company_info'
  AND valor::jsonb ? 'nome';

-- Leitura PUBLICA — mesmo padrao de REF-COMPANY-01 (SECURITY DEFINER, ignora RLS, defaults cobrem
-- qualquer campo ainda nao salvo, ex.: base nova).
CREATE OR REPLACE FUNCTION public.get_company_info()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    '{"nomeCurto":"Encanto","nomeCompleto":"Encanto — Açaí & Marmitas","telefone":"5547992722920","whatsapp":"5547992722920","email":"contato@encantoacai.com.br","whatsappFloatEnabled":true}'::jsonb
    || COALESCE((SELECT valor::jsonb FROM public.settings WHERE chave = 'company_info' LIMIT 1), '{}'::jsonb);
$function$;

-- Escrita restrita a ADMIN. Mesma logica de REF-COMPANY-01, so troca o bloco de validacao de 'nome'
-- por dois blocos identicos (nomeCurto/nomeCompleto), mesma regra (trim, minimo 2 chars).
CREATE OR REPLACE FUNCTION public.set_company_info(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_atual   jsonb;
  v_merged  jsonb;
  v_nomec   text;
  v_nomef   text;
  v_tel     text;
  v_wa      text;
  v_email   text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas administradores podem alterar os dados da empresa'
      USING ERRCODE = '42501';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'payload invalido: esperado um objeto JSON'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'nomeCurto' THEN
    v_nomec := trim(both from (p_patch->>'nomeCurto'));
    IF v_nomec IS NULL OR length(v_nomec) < 2 THEN
      RAISE EXCEPTION 'nome curto invalido: informe ao menos 2 caracteres'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{nomeCurto}', to_jsonb(v_nomec));
  END IF;

  IF p_patch ? 'nomeCompleto' THEN
    v_nomef := trim(both from (p_patch->>'nomeCompleto'));
    IF v_nomef IS NULL OR length(v_nomef) < 2 THEN
      RAISE EXCEPTION 'nome completo invalido: informe ao menos 2 caracteres'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{nomeCompleto}', to_jsonb(v_nomef));
  END IF;

  IF p_patch ? 'telefone' THEN
    v_tel := public.enc_normalize_phone_br(p_patch->>'telefone');
    IF length(v_tel) NOT BETWEEN 12 AND 13 THEN
      RAISE EXCEPTION 'telefone invalido: % (informe DDD + numero)', p_patch->>'telefone'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{telefone}', to_jsonb(v_tel));
  END IF;

  IF p_patch ? 'whatsapp' THEN
    v_wa := public.enc_normalize_phone_br(p_patch->>'whatsapp');
    IF length(v_wa) NOT BETWEEN 12 AND 13 THEN
      RAISE EXCEPTION 'whatsapp invalido: % (informe DDD + numero)', p_patch->>'whatsapp'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{whatsapp}', to_jsonb(v_wa));
  END IF;

  IF p_patch ? 'email' THEN
    v_email := lower(trim(both from (p_patch->>'email')));
    IF v_email !~ '^.+@.+\..+$' THEN
      RAISE EXCEPTION 'email invalido: %', p_patch->>'email'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{email}', to_jsonb(v_email));
  END IF;

  IF p_patch ? 'whatsappFloatEnabled' AND jsonb_typeof(p_patch->'whatsappFloatEnabled') <> 'boolean' THEN
    RAISE EXCEPTION 'whatsappFloatEnabled invalido: use true ou false'
      USING ERRCODE = '22023';
  END IF;

  SELECT valor::jsonb INTO v_atual FROM public.settings WHERE chave = 'company_info' LIMIT 1;
  v_merged := COALESCE(v_atual, '{}'::jsonb) || p_patch;

  INSERT INTO public.settings (chave, valor)
  VALUES ('company_info', v_merged::text)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_merged;
END;
$function$;

COMMIT;

-- Expoe as funcoes redefinidas na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';
