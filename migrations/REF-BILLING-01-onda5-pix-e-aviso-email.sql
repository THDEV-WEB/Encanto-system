-- REF-BILLING-01 · Onda 5 — Fecha 2 furos do proprio V1 (achados so' apos revisar Ondas 1-4 contra o
-- doc de descoberta, secao G "Dentro da V1"): (1) exibicao dos dados de pagamento/Pix da VALION --
-- nunca foi construida; (2) aviso de vencimento por E-MAIL (decisao B.12 pedia visual+e-mail+WhatsApp,
-- so o visual saiu nas ondas anteriores). WhatsApp fica de fora desta onda (decisao do dono,
-- 2026-09-16 -- exige template aprovado pela Meta antes, passo manual fora do codigo).
--
-- Decisoes de implementacao:
--
--   1. platform_billing_config e uma tabela SINGLETON (1 linha so, id fixo=1) -- os dados de pagamento
--      da VALION sao da PLATAFORMA inteira, nunca por loja (nao faz sentido guardar em store_settings,
--      que e sempre por store_id). Configuravel pelo Platform Admin, visivel a QUALQUER admin (e' info
--      que a propria VALION quer que toda loja veja, nao e segredo).
--
--   2. E-mail reaproveita EXATAMENTE o mesmo padrao ja usado pelo WhatsApp (REF-ORDER-01b):
--      pg_cron + pg_net + Vault, direto no banco -- NUNCA uma Edge Function nova. Precisa de 1 segredo
--      NOVO no Vault (`resend_api_key`, uma API key do Resend -- diferente da senha SMTP ja configurada
--      pro Auth do Supabase, que so serve pro mailer interno do GoTrue, nunca pra chamadas HTTP livres).
--      Remetente reaproveita o dominio JA VERIFICADO (mail.encanto.valionsistemas.com.br, REF-AUTH-03),
--      sem precisar de nova verificacao DNS.
--
--   3. Disparo do aviso NUNCA e um cron a parte -- e so mais um passo dentro do MESMO
--      platform_billing_cron_tick() diario (encanto-billing-cron-tick, 05:00 UTC), chamando
--      platform_billing_reminder_dispatch() logo em seguida. Sem cron novo, sem infraestrutura nova.
--
--   4. Idempotencia SEM constraint/trava especial -- os proprios pontos de disparo so' acontecem 1x por
--      natureza: "vencimento proximo" so' quando proximo_vencimento = CURRENT_DATE + 3 (comparacao
--      exata, nao <=, entao so' bate 1 dia por ciclo -- a data anda 1 dia por dia); "entrada carencia"
--      so' no MOMENTO da transicao em_dia->carencia (mesmo bloco que ja grava o evento no ledger,
--      nunca reprocessado -- ver Onda 2). Sem contato_financeiro_email configurado, simplesmente nao
--      gera nada (nunca erro).
--
--   5. Ledger (store_billing_events) NAO ganha evento novo pro aviso em si -- so' os 2 tipos ja
--      decididos (vencimento/entrada_carencia) continuam sendo os unicos gravados; o outbox de e-mail
--      e o proprio rastro de "avisei ou nao" (tabela nova, nunca exposta via PostgREST).
--
-- Companion: REF-BILLING-01-onda5-pix-e-aviso-email-rollback.sql

BEGIN;

-- ===== 1. platform_billing_config -- singleton, dados de pagamento/Pix da VALION. =====
CREATE TABLE public.platform_billing_config (
  id                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  chave_pix          text,
  tipo_chave_pix     text CHECK (tipo_chave_pix IS NULL OR tipo_chave_pix IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  nome_beneficiario  text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_billing_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_billing_config_read_any_admin ON public.platform_billing_config
  FOR SELECT
  USING (public.is_admin_anywhere());

-- ===== 2. platform_billing_reminder_outbox -- fila de e-mail, NUNCA exposta via PostgREST. =====
CREATE TABLE public.platform_billing_reminder_outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  tipo           text NOT NULL CHECK (tipo IN ('vencimento_proximo', 'entrada_carencia')),
  to_email       text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  net_request_id bigint,
  state          text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts       int NOT NULL DEFAULT 0,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz
);

CREATE INDEX idx_platform_billing_reminder_outbox_state ON public.platform_billing_reminder_outbox (state, created_at);

-- ===== 3. RPCs de configuracao/consulta dos dados de pagamento. =====
CREATE OR REPLACE FUNCTION public.get_platform_billing_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row public.platform_billing_config%ROWTYPE;
BEGIN
  IF NOT public.is_admin_anywhere() THEN
    RAISE EXCEPTION 'sem permissao para consultar os dados de pagamento da plataforma' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.platform_billing_config WHERE id = 1;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('configurado', false);
  END IF;

  RETURN jsonb_build_object(
    'configurado', true,
    'chave_pix', v_row.chave_pix,
    'tipo_chave_pix', v_row.tipo_chave_pix,
    'nome_beneficiario', v_row.nome_beneficiario
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_platform_billing_config() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_platform_billing_config() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_platform_billing_config() TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_configurar_dados_pagamento(p_chave_pix text, p_tipo_chave_pix text, p_nome_beneficiario text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_chave text;
  v_tipo  text;
  v_nome  text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode configurar os dados de pagamento'
      USING ERRCODE = '42501';
  END IF;

  v_chave := NULLIF(trim(both from coalesce(p_chave_pix, '')), '');
  v_tipo  := NULLIF(trim(both from coalesce(p_tipo_chave_pix, '')), '');
  v_nome  := NULLIF(trim(both from coalesce(p_nome_beneficiario, '')), '');

  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria') THEN
    RAISE EXCEPTION 'tipo de chave pix invalido: %', v_tipo USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_billing_config (id, chave_pix, tipo_chave_pix, nome_beneficiario)
  VALUES (1, v_chave, v_tipo, v_nome)
  ON CONFLICT (id) DO UPDATE
    SET chave_pix = EXCLUDED.chave_pix, tipo_chave_pix = EXCLUDED.tipo_chave_pix,
        nome_beneficiario = EXCLUDED.nome_beneficiario, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'chave_pix', v_chave, 'tipo_chave_pix', v_tipo, 'nome_beneficiario', v_nome);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_configurar_dados_pagamento(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_configurar_dados_pagamento(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_configurar_dados_pagamento(text, text, text) TO authenticated;

-- ===== 4. platform_billing_cron_tick: ganha os 2 pontos de geracao do aviso por e-mail. =====
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
  v_avisos_proximo int := 0;
  v_avisos_carencia int := 0;
  v_sub            record;
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

      -- Onda 5: aviso por e-mail na entrada da carencia -- so' se houver contato financeiro configurado.
      SELECT s.nome, sub.valor_devido, sub.proximo_vencimento, sub.contato_financeiro_email
      INTO v_sub FROM public.store_subscriptions sub JOIN public.stores s ON s.id = sub.store_id
      WHERE sub.store_id = v_store_id;
      IF v_sub.contato_financeiro_email IS NOT NULL THEN
        INSERT INTO public.platform_billing_reminder_outbox (store_id, tipo, to_email, payload)
        VALUES (v_store_id, 'entrada_carencia', v_sub.contato_financeiro_email,
                jsonb_build_object('loja_nome', v_sub.nome, 'valor_devido', v_sub.valor_devido, 'proximo_vencimento', v_sub.proximo_vencimento));
        v_avisos_carencia := v_avisos_carencia + 1;
      END IF;
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

  -- ===== Onda 5: vencimento proximo (exatamente 3 dias antes) -- so' quando AINDA em_dia. =====
  FOR v_sub IN
    SELECT s.id AS store_id, s.nome, sub.valor_devido, sub.proximo_vencimento, sub.contato_financeiro_email
    FROM public.store_subscriptions sub JOIN public.stores s ON s.id = sub.store_id
    WHERE sub.status = 'em_dia'
      AND sub.proximo_vencimento = CURRENT_DATE + 3
      AND sub.contato_financeiro_email IS NOT NULL
  LOOP
    INSERT INTO public.platform_billing_reminder_outbox (store_id, tipo, to_email, payload)
    VALUES (v_sub.store_id, 'vencimento_proximo', v_sub.contato_financeiro_email,
            jsonb_build_object('loja_nome', v_sub.nome, 'valor_devido', v_sub.valor_devido, 'proximo_vencimento', v_sub.proximo_vencimento));
    v_avisos_proximo := v_avisos_proximo + 1;
  END LOOP;

  INSERT INTO public.application_logs (module, operation, level, message, payload, version, origin)
  VALUES ('billing', 'platform_billing_cron_tick', 'info', 'tick de carencia/bloqueio concluido',
          jsonb_build_object(
            'para_carencia', COALESCE(array_length(v_para_carencia, 1), 0),
            'para_bloqueada', COALESCE(array_length(v_para_bloqueada, 1), 0),
            'avisos_vencimento_proximo', v_avisos_proximo,
            'avisos_entrada_carencia', v_avisos_carencia
          ),
          'billing-01-onda5', 'cron');

  RETURN jsonb_build_object(
    'ok', true,
    'para_carencia', COALESCE(v_para_carencia, ARRAY[]::uuid[]),
    'para_bloqueada', COALESCE(v_para_bloqueada, ARRAY[]::uuid[]),
    'avisos_vencimento_proximo', v_avisos_proximo,
    'avisos_entrada_carencia', v_avisos_carencia
  );
END;
$function$;

-- ===== 5. platform_billing_reminder_dispatch: confirma+despacha a fila de e-mail via Resend. =====
CREATE OR REPLACE FUNCTION public.platform_billing_reminder_dispatch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_api_key text;
  v_row     record;
  v_req     bigint;
  v_subject text;
  v_html    text;
  v_desp    int := 0;
  v_conf    int := 0;
BEGIN
  SELECT decrypted_secret INTO v_api_key FROM vault.decrypted_secrets WHERE name = 'resend_api_key' LIMIT 1;
  IF v_api_key IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'resend_not_configured');
  END IF;

  -- (1) CONFIRMACAO: resolve 'sending' cujos requests ja responderam.
  UPDATE public.platform_billing_reminder_outbox o SET
    state      = CASE WHEN r.status_code BETWEEN 200 AND 299 THEN 'sent' ELSE 'failed' END,
    last_error = CASE WHEN r.status_code BETWEEN 200 AND 299 THEN NULL
                      ELSE 'http_' || coalesce(r.status_code::text, r.error_msg, 'err') || ' ' || left(coalesce(r.content, ''), 240) END,
    sent_at    = now()
  FROM net._http_response r
  WHERE r.id = o.net_request_id AND o.state = 'sending';
  GET DIAGNOSTICS v_conf = ROW_COUNT;

  -- (2) DESPACHO: claim atomico de pendentes -> render -> net.http_post -> guarda request_id.
  FOR v_row IN
    UPDATE public.platform_billing_reminder_outbox o
    SET state = 'sending'
    WHERE o.id IN (
      SELECT id FROM public.platform_billing_reminder_outbox
      WHERE state = 'pending' OR (state = 'sending' AND created_at < now() - interval '15 minutes')
      ORDER BY created_at LIMIT 25 FOR UPDATE SKIP LOCKED
    )
    RETURNING o.*
  LOOP
    IF v_row.tipo = 'vencimento_proximo' THEN
      v_subject := format('%s: mensalidade vence em breve', v_row.payload->>'loja_nome');
      v_html := format(
        '<p>Olá! A mensalidade da plataforma VALION referente à loja <strong>%s</strong> vence em <strong>%s</strong> (valor R$ %s).</p><p>Consulte os dados de pagamento no Admin, aba Faturamento.</p>',
        v_row.payload->>'loja_nome', v_row.payload->>'proximo_vencimento', v_row.payload->>'valor_devido');
    ELSE
      v_subject := format('%s: mensalidade em atraso', v_row.payload->>'loja_nome');
      v_html := format(
        '<p>A mensalidade da plataforma VALION referente à loja <strong>%s</strong> venceu em <strong>%s</strong> (valor R$ %s) e ainda não foi confirmada.</p><p>Regularize o quanto antes para evitar o bloqueio do painel. Consulte os dados de pagamento no Admin, aba Faturamento.</p>',
        v_row.payload->>'loja_nome', v_row.payload->>'proximo_vencimento', v_row.payload->>'valor_devido');
    END IF;

    v_req := net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'from', 'VALION Sistemas <faturamento@mail.encanto.valionsistemas.com.br>',
        'to', v_row.to_email, 'subject', v_subject, 'html', v_html)
    );

    UPDATE public.platform_billing_reminder_outbox SET
      net_request_id = v_req, attempts = attempts + 1, last_error = NULL
    WHERE id = v_row.id;
    v_desp := v_desp + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'despachados', v_desp, 'confirmados', v_conf);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_billing_reminder_dispatch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_billing_reminder_dispatch() TO postgres, service_role;

-- ===== 6. Cron: mesmo job de sempre (encanto-billing-cron-tick), agora tambem despacha e-mail. =====
SELECT cron.unschedule('encanto-billing-cron-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encanto-billing-cron-tick');
SELECT cron.schedule('encanto-billing-cron-tick', '0 5 * * *',
  $$select public.platform_billing_cron_tick(); select public.platform_billing_reminder_dispatch();$$);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificacao pos-aplicacao:
-- SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'encanto-billing-cron-tick';
--   -- comando deve ter as 2 chamadas agora.
--
-- PASSO MANUAL FORA DESTA MIGRATION (o dono precisa fazer, nunca a IA -- e' um segredo):
--   Inserir o segredo `resend_api_key` no Vault do projeto de PRODUCAO (mesmo mecanismo ja usado pro
--   `whatsapp_token`) -- sem isso, platform_billing_reminder_dispatch() roda em NO-OP
--   (skipped:'resend_not_configured'), nunca falha, so' nao manda nada ate o segredo existir.
