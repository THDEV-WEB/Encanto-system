-- REF-SAAS-01 · Onda 6.2 — Branding por loja: company_info migra de settings (global) para
-- store_settings (por loja), mesmo padrao da Onda 4.3 (business_hours_schedule/delivery_fee_config/
-- delivery_eta_min/store_mode). Ganha 7 campos novos: logoUrl, faviconUrl, corPrimaria, corSecundaria,
-- corDestaque, termosSecoes, fidelidadeTexto — os 2 ultimos aposentam TERMOS_SECOES/FIDELIDADE_TEXTO
-- (constants/storeInfo.js), ja anotados no proprio arquivo como "proximos candidatos naturais" desde a
-- REF-COMPANY-03. Defaults dos 7 campos novos sao BYTE-IDENTICOS ao que ja esta no ar hoje para a
-- Encanto — migracao sem nenhuma mudanca visual no dia da aplicacao.
--
-- set_company_info troca o gate de is_admin() para is_admin_of(p_store_id) (mesmo padrao das 4 chaves
-- da Onda 4.3). get_company_info/set_company_info mudam de 0/1 argumento para 1/2 (com DEFAULT) —
-- overload NOVO, nao substitui o antigo (regra permanente da Onda 4): DROP FUNCTION IF EXISTS antes de
-- cada CREATE, GRANT/REVOKE reaplicados explicitamente.
--
-- enc_enqueue_notification (Onda 4.1/4.3) resolve v_store a partir de orders.store_id e ja propaga
-- corretamente para enc_tempo_estimado(p_address, v_store) — mas chamava get_company_info() SEM
-- argumento (sempre caia no default_store_id(), mesmo lapso que a propria Onda 4.3 corrigiu para
-- enc_tempo_estimado). Corrigida aqui para get_company_info(v_store).
--
-- Requer REF-SAAS-01-onda4-3-config-operacional.sql e REF-DELIVERY-FEE-02-loja-coords-validacao.sql
-- (ja aplicadas). Rollback em arquivo separado.

BEGIN;

-- ===== 1. Migra o dado real de producao (preserva 100% do que ja foi salvo; nenhum campo perdido) =====
INSERT INTO public.store_settings (store_id, chave, valor)
SELECT (SELECT id FROM public.stores WHERE slug = 'encanto'), 'company_info', valor
FROM public.settings
WHERE chave = 'company_info'
ON CONFLICT (store_id, chave) DO NOTHING;

-- ===== 2. get_company_info: 0 -> 1 argumento (overload novo — DROP a assinatura antiga primeiro) =====
DROP FUNCTION IF EXISTS public.get_company_info();

CREATE OR REPLACE FUNCTION public.get_company_info(p_store_id uuid DEFAULT public.default_store_id())
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    '{"nomeCurto":"Encanto","nomeCompleto":"Encanto — Açaí & Marmitas","telefone":"5547992722920","whatsapp":"5547992722920","email":"contato@encantoacai.com.br","whatsappFloatEnabled":true,
      "corPrimaria":"#A62786","corSecundaria":"#6B1F5D","corDestaque":"#FFBF00",
      "termosSecoes":[
        {"titulo":"Uso do serviço","corpo":"Ao realizar um pedido você concorda com as condições de compra, prazos de entrega e formas de pagamento informadas no checkout."},
        {"titulo":"Privacidade","corpo":"Coletamos apenas os dados necessários para processar o seu pedido (nome, contato e endereço). Não compartilhamos seus dados com terceiros sem necessidade operacional."},
        {"titulo":"Cancelamento e trocas","corpo":"Pedidos em preparo podem ter regras específicas de cancelamento. Em caso de problemas, fale conosco pelo WhatsApp."},
        {"titulo":"Contato","corpo":"Dúvidas sobre estes termos podem ser tratadas pelos nossos canais de contato."}
      ],
      "fidelidadeTexto":[
        "A cada pedido você acumula um selo no seu cartão de fidelidade.",
        "Ao completar a cartela, você ganha um benefício especial no próximo pedido.",
        "Entre na sua conta para acompanhar seus selos em qualquer dispositivo (em breve)."
      ]
     }'::jsonb
    || COALESCE((SELECT valor::jsonb FROM public.store_settings WHERE store_id = p_store_id AND chave = 'company_info' LIMIT 1), '{}'::jsonb);
$function$;

REVOKE ALL ON FUNCTION public.get_company_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_info(uuid) TO anon, authenticated;

-- ===== 3. set_company_info: is_admin() -> is_admin_of(p_store_id); settings -> store_settings;
-- +4 blocos de validacao novos (logoUrl/faviconUrl, corPrimaria/corSecundaria/corDestaque,
-- termosSecoes, fidelidadeTexto). Corpo base = versao vigente hoje (REF-DELIVERY-FEE-02). =====
DROP FUNCTION IF EXISTS public.set_company_info(jsonb);

CREATE OR REPLACE FUNCTION public.set_company_info(p_patch jsonb, p_store_id uuid DEFAULT public.default_store_id())
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
  v_lat     double precision;
  v_lng     double precision;
  v_el      jsonb;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
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

  -- REF-DELIVERY-FEE-02: localizacao operacional da loja — null e valido (limpar o pino); presente
  -- PRECISA ser um numero JSON dentro do intervalo geografico global.
  IF p_patch ? 'lojaLat' THEN
    IF jsonb_typeof(p_patch->'lojaLat') = 'null' THEN
      NULL;
    ELSIF jsonb_typeof(p_patch->'lojaLat') <> 'number' THEN
      RAISE EXCEPTION 'lojaLat invalido: informe um numero (ou null para limpar)'
        USING ERRCODE = '22023';
    ELSE
      v_lat := (p_patch->>'lojaLat')::double precision;
      IF v_lat < -90 OR v_lat > 90 THEN
        RAISE EXCEPTION 'lojaLat invalido: % (fora do intervalo -90..90)', v_lat
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'lojaLng' THEN
    IF jsonb_typeof(p_patch->'lojaLng') = 'null' THEN
      NULL;
    ELSIF jsonb_typeof(p_patch->'lojaLng') <> 'number' THEN
      RAISE EXCEPTION 'lojaLng invalido: informe um numero (ou null para limpar)'
        USING ERRCODE = '22023';
    ELSE
      v_lng := (p_patch->>'lojaLng')::double precision;
      IF v_lng < -180 OR v_lng > 180 THEN
        RAISE EXCEPTION 'lojaLng invalido: % (fora do intervalo -180..180)', v_lng
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  -- REF-SAAS-01 Onda 6.2: logoUrl/faviconUrl — null e valido (remover); presente precisa ser URL http(s).
  IF p_patch ? 'logoUrl' THEN
    IF jsonb_typeof(p_patch->'logoUrl') = 'null' THEN
      NULL;
    ELSIF jsonb_typeof(p_patch->'logoUrl') <> 'string' OR (p_patch->>'logoUrl') !~ '^https?://' THEN
      RAISE EXCEPTION 'logoUrl invalido: informe uma URL http(s) (ou null para remover)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'faviconUrl' THEN
    IF jsonb_typeof(p_patch->'faviconUrl') = 'null' THEN
      NULL;
    ELSIF jsonb_typeof(p_patch->'faviconUrl') <> 'string' OR (p_patch->>'faviconUrl') !~ '^https?://' THEN
      RAISE EXCEPTION 'faviconUrl invalido: informe uma URL http(s) (ou null para remover)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Paleta de cores — sempre um hex #RRGGBB (nunca null: a loja sempre tem uma cor efetiva, mesmo
  -- que seja a default de fabrica).
  IF p_patch ? 'corPrimaria' AND (jsonb_typeof(p_patch->'corPrimaria') <> 'string' OR (p_patch->>'corPrimaria') !~ '^#[0-9A-Fa-f]{6}$') THEN
    RAISE EXCEPTION 'corPrimaria invalida: use o formato #RRGGBB' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'corSecundaria' AND (jsonb_typeof(p_patch->'corSecundaria') <> 'string' OR (p_patch->>'corSecundaria') !~ '^#[0-9A-Fa-f]{6}$') THEN
    RAISE EXCEPTION 'corSecundaria invalida: use o formato #RRGGBB' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'corDestaque' AND (jsonb_typeof(p_patch->'corDestaque') <> 'string' OR (p_patch->>'corDestaque') !~ '^#[0-9A-Fa-f]{6}$') THEN
    RAISE EXCEPTION 'corDestaque invalida: use o formato #RRGGBB' USING ERRCODE = '22023';
  END IF;

  -- Termos de uso — array de secoes {titulo, corpo}, ambos texto.
  IF p_patch ? 'termosSecoes' THEN
    IF jsonb_typeof(p_patch->'termosSecoes') <> 'array' THEN
      RAISE EXCEPTION 'termosSecoes invalido: esperado um array de secoes' USING ERRCODE = '22023';
    END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_patch->'termosSecoes') LOOP
      IF jsonb_typeof(v_el) <> 'object' OR NOT (v_el ? 'titulo') OR NOT (v_el ? 'corpo')
         OR jsonb_typeof(v_el->'titulo') <> 'string' OR jsonb_typeof(v_el->'corpo') <> 'string' THEN
        RAISE EXCEPTION 'termosSecoes invalido: cada secao precisa de {titulo, corpo} em texto' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  -- Fidelidade — array de paragrafos (texto).
  IF p_patch ? 'fidelidadeTexto' THEN
    IF jsonb_typeof(p_patch->'fidelidadeTexto') <> 'array' THEN
      RAISE EXCEPTION 'fidelidadeTexto invalido: esperado um array de paragrafos' USING ERRCODE = '22023';
    END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_patch->'fidelidadeTexto') LOOP
      IF jsonb_typeof(v_el) <> 'string' THEN
        RAISE EXCEPTION 'fidelidadeTexto invalido: cada paragrafo precisa ser texto' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  SELECT valor::jsonb INTO v_atual FROM public.store_settings WHERE store_id = p_store_id AND chave = 'company_info' LIMIT 1;
  v_merged := COALESCE(v_atual, '{}'::jsonb) || p_patch;

  INSERT INTO public.store_settings (store_id, chave, valor)
  VALUES (p_store_id, 'company_info', v_merged::text)
  ON CONFLICT (store_id, chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_merged;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_company_info(jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_company_info(jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_company_info(jsonb, uuid) TO authenticated;

-- ===== 4. enc_enqueue_notification: get_company_info() -> get_company_info(v_store) — mesma
-- assinatura da funcao (CREATE OR REPLACE direto, sem DROP). =====
CREATE OR REPLACE FUNCTION public.enc_enqueue_notification(p_order_id uuid, p_customer_id uuid, p_status text, p_address text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_phone text; v_name text; v_empresa text; v_store uuid;
BEGIN
  IF p_status NOT IN ('recebido','preparo','pronto','entrega','entregue') THEN RETURN; END IF;
  SELECT c.phone, c.name INTO v_phone, v_name FROM public.customers c WHERE c.id = p_customer_id;
  SELECT o.store_id INTO v_store FROM public.orders o WHERE o.id = p_order_id;
  SELECT public.get_company_info(v_store)->>'nomeCurto' INTO v_empresa;
  INSERT INTO public.notification_outbox (order_id, to_phone, status, vars, store_id)
  VALUES (
    p_order_id, v_phone, p_status,
    jsonb_build_object(
      'cliente', COALESCE(v_name, ''),
      'numero',  UPPER(LEFT(REPLACE(p_order_id::text, '-', ''), 8)),
      'tempo',   public.enc_tempo_estimado(p_address, v_store),
      'empresa', COALESCE(v_empresa, 'Encanto')
    ),
    v_store
  );
END;
$function$;

-- ===== 5. Remove a chave migrada de settings (dado morto — mesma disciplina da Onda 4.3, ADR §12.1) =====
DELETE FROM public.settings WHERE chave = 'company_info';

COMMIT;

-- Expoe as funcoes redefinidas na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';
