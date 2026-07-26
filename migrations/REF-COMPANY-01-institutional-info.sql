-- REF-COMPANY-01 — Dados institucionais da empresa como configuracao administrativa (nao mais hardcoded).
-- Reutiliza a tabela public.settings (chave/valor) — UMA chave 'company_info', valor = objeto JSON (texto).
-- Espelha o padrao ja provado por REF-BUSINESS-HOURS-03 (store_mode) e REF-DELIVERY-01 (delivery_eta_min):
-- RPC SECURITY DEFINER dedicada (nao a get_setting generica — ver REF-DELIVERY-01a: get_setting NAO e
-- SECURITY DEFINER, a RLS de settings e TRANCADA, entao chamada do browser anonimo ela sempre devolve o
-- fallback; por isso get_company_info() aqui e SEU PROPRIO leitor DEFINER, publico).
--
-- Por que UM objeto JSON (nao uma linha por campo, como store_mode/delivery_eta_min)? Este modulo precisa
-- crescer (hoje: nome/telefone/whatsapp/email/toggle do botao; amanha: instagram/facebook/cnpj/endereco/
-- pix/...) SEM exigir uma nova migration a cada campo novo. set_company_info(p_patch jsonb) faz PATCH
-- (merge raso sobre o objeto salvo) — o admin manda so o que mudou (ou o objeto inteiro, tanto faz), e um
-- campo novo (ex.: "instagram") pode ser lido/escrito pelo frontend assim que existir, sem alterar o RPC.
-- Validacao SERVIDOR so acontece para os campos que ja tem regra de negocio conhecida (nome/telefone/
-- whatsapp/email/toggle); campos futuros sem regra especifica sao aceitos como estao (mesmo espirito de
-- set_loyalty_config, que tambem grava so os campos que conhece).
--
-- Telefone/whatsapp reusam enc_normalize_phone_br(text) (ja aplicada em REF-ORDER-01b, espelho SQL de
-- WhatsAppService.normalizePhoneBR) — NAO cria um 4o normalizador de telefone (ha uma divida ja registrada,
-- PEND-PHONE-SSOT, sobre isso: normalizePhoneBR/enc_normalize_phone_br/normalize_phone convivendo hoje).
--
-- Sem tabela nova, sem localStorage, FONTE UNICA no banco. IDEMPOTENTE (INSERT ... ON CONFLICT DO NOTHING /
-- CREATE OR REPLACE / grants repetiveis), VERSIONADA, preserva os dados existentes de settings (so
-- acrescenta a chave 'company_info'). Rollback em arquivo separado.

BEGIN;

-- Semente idempotente com os valores REAIS de producao hoje (REF-CONTACT-01: numero oficial da loja).
-- Nao sobrescreve se a chave ja existir (nao reseta um valor que o admin ja tenha salvo).
INSERT INTO public.settings (chave, valor)
VALUES (
  'company_info',
  '{"nome":"Encanto — Açaí & Marmitas","telefone":"5547992722920","whatsapp":"5547992722920","email":"contato@encantoacai.com.br","whatsappFloatEnabled":true}'
)
ON CONFLICT (chave) DO NOTHING;

-- Leitura PUBLICA (loja anon precisa exibir telefone/whatsapp/botao flutuante). SECURITY DEFINER: le
-- settings direto, ignora a RLS (mesma razao de get_store_mode/get_delivery_eta). Sempre retorna o objeto
-- COMPLETO: os defaults abaixo cobrem qualquer campo ainda nao salvo (ex.: base nova, ou campo futuro sem
-- valor ainda) — o frontend nunca recebe undefined nos campos conhecidos.
CREATE OR REPLACE FUNCTION public.get_company_info()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    '{"nome":"Encanto — Açaí & Marmitas","telefone":"5547992722920","whatsapp":"5547992722920","email":"contato@encantoacai.com.br","whatsappFloatEnabled":true}'::jsonb
    || COALESCE((SELECT valor::jsonb FROM public.settings WHERE chave = 'company_info' LIMIT 1), '{}'::jsonb);
$function$;

-- Escrita restrita a ADMIN. p_patch e um PATCH (merge raso sobre o valor salvo) — nao precisa reenviar o
-- objeto inteiro. Valida os campos conhecidos QUANDO presentes no patch; campos desconhecidos (futuros)
-- passam direto (sem regra ainda). Retorna o objeto MERGEADO e ja persistido (fonte de verdade truthful:
-- o frontend so pode confiar no que este RETURN devolve, nunca no que enviou).
CREATE OR REPLACE FUNCTION public.set_company_info(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_atual  jsonb;
  v_merged jsonb;
  v_nome   text;
  v_tel    text;
  v_wa     text;
  v_email  text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas administradores podem alterar os dados da empresa'
      USING ERRCODE = '42501';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'payload invalido: esperado um objeto JSON'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'nome' THEN
    v_nome := trim(both from (p_patch->>'nome'));
    IF v_nome IS NULL OR length(v_nome) < 2 THEN
      RAISE EXCEPTION 'nome invalido: informe ao menos 2 caracteres'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{nome}', to_jsonb(v_nome));
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

-- Grants (defense-in-depth, mesmo padrao de get_store_mode/set_store_mode e get_delivery_eta/set_delivery_eta).
REVOKE ALL ON FUNCTION public.get_company_info() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_info() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.set_company_info(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_company_info(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_company_info(jsonb) TO authenticated;

COMMIT;

-- Expoe as novas funcoes na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';
