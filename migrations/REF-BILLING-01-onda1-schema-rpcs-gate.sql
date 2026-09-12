-- REF-BILLING-01 · Onda 1 — Schema (store_subscriptions + store_billing_events) + RPCs +
-- gate aditivo em is_admin_of. Doc de referencia: docs/ref/REF-BILLING-01-descoberta.md (16/16
-- decisoes de negocio fechadas em 2026-09-12, autorizacao explicita do dono pra iniciar a Onda 1
-- na mesma data).
--
-- Escopo desta migration (Onda 1 do doc, secao I): guardar por loja o estado ATUAL da assinatura
-- (store_subscriptions) + o historico IMUTAVEL de eventos (store_billing_events) + as RPCs de
-- leitura/marcar-pago/configurar-vencimento/configurar-contato + o gate de bloqueio aditivo. NAO
-- inclui: cron de carencia/bloqueio automatico (Onda 2), UI no Platform Console (Onda 3) nem UI no
-- Admin da loja (Onda 4) -- essas ficam pra proximas ondas, autorizacao separada.
--
-- Decisoes de implementacao tomadas AQUI (o doc e proposta tecnica nao vinculante, nomes
-- provisorios -- secao H confirma que so restam detalhes de implementacao, nao pende pergunta de
-- negocio):
--
--   1. Gate exclusivo de Platform Admin usa is_super_admin(), NAO is_admin_anywhere() como o
--      rascunho da secao D sugeria. is_admin_anywhere() retorna true pra QUALQUER admin de
--      QUALQUER loja (nao so o dono da plataforma) -- usa-lo aqui deixaria um admin comum de uma
--      loja confirmar pagamento/mudar vencimento de OUTRA loja. is_super_admin() e o mesmo gate ja
--      usado por provision_store/link_store_admin (REF-SAAS-01 Onda 8) pras mesmas acoes
--      exclusivas de plataforma -- mantem consistencia com o padrao real ja em producao.
--
--   2. is_admin_of(store_id) bloqueado NUNCA bloqueia o super admin (Platform Admin) pra aquela
--      loja -- so o vinculo "admin comum da propria loja" e afetado. Sem essa excecao ninguem
--      conseguiria desbloquear a loja depois (o proprio Platform Admin ficaria de fora das RPCs
--      admin-facing daquela loja). Consistente com a secao F: bloqueio afeta so a CAPACIDADE de
--      agir do admin da loja, nunca apaga/impede acao do dono da plataforma.
--
--   3. get_billing_status(store_id) NAO usa is_admin_of (que ja reflete o bloqueio) -- usa uma
--      checagem direta de vinculo (admins OU super admin). Motivo: se o Admin bloqueado nao
--      conseguisse nem CONSULTAR seu proprio status de billing, a secao E ("mensagem clara" no
--      lugar do painel bloqueado) nunca teria como ser montada no frontend. Leitura do proprio
--      status precisa sobreviver ao proprio bloqueio que ela explica.
--
--   4. proximo_vencimento NAO e calculado automaticamente nesta onda (nem no primeiro cadastro nem
--      na troca de dia). platform_configurar_dia_vencimento so grava/atualiza dia_vencimento
--      (nunca mexe em proximo_vencimento ja agendado -- e assim, de graca, que a regra B.16 "o
--      proximo vencimento ja agendado nunca muda" fica satisfeita: nada aqui o toca). O primeiro
--      proximo_vencimento e QUALQUER seguinte so avancam quando o Platform Admin chama
--      platform_marcar_mensalidade_paga(store_id, proximo_vencimento) informando a proxima data --
--      humano decide a data exata, sistema so guarda/audita (== "cobranca ASSISTIDA", B.2). A
--      matematica de datas do "primeiro ciclo apos o trial" (B.15) fica pra quando essa tela for
--      construida (Onda 3), aqui so existe o campo trial_ate pra guardar o dado.
--
--   5. Alteracao de contato financeiro NAO gera linha em store_billing_events -- a auditoria
--      obrigatoria da secao B.6 e explicita sobre MUDANCA DE VENCIMENTO, nao sobre o cadastro do
--      contato. Nao inventar tipo de evento fora da lista ja proposta no doc (secao D).
--
--   6. Seed de dados: Encanto e Aquarios Bar (as 2 unicas lojas hoje, confirmado por introspeccao)
--      ja nascem com status='isenta' (decisao B.4, "de graca, sem excecao") + 1 evento 'isencao'
--      cada, pra nunca aparecerem como "sem assinatura" quando a Onda 4 (UI do Admin) for construida.
--
-- Seguranca (secao F do doc): RLS habilitado nas 2 tabelas, SOMENTE policy de SELECT (admin da
-- propria loja ou super admin) -- nenhuma policy de INSERT/UPDATE/DELETE pra authenticated/anon,
-- toda escrita passa exclusivamente pelas RPCs SECURITY DEFINER abaixo (mesmo padrao ja usado por
-- toda RPC administrativa deste projeto).

BEGIN;

-- ===== 1. store_subscriptions -- estado ATUAL da assinatura, 1:1 com stores. =====
CREATE TABLE public.store_subscriptions (
  store_id                  uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  status                    text NOT NULL DEFAULT 'em_dia'
                             CHECK (status IN ('em_dia', 'carencia', 'bloqueada', 'isenta')),
  dia_vencimento            smallint
                             CHECK (dia_vencimento IS NULL OR dia_vencimento BETWEEN 1 AND 31),
  proximo_vencimento        date,
  dias_carencia             smallint NOT NULL DEFAULT 5,
  valor_devido              numeric(10,2) NOT NULL DEFAULT 99.00,
  trial_ate                 date,
  contato_financeiro_nome     text,
  contato_financeiro_email    text,
  contato_financeiro_whatsapp text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.store_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_subscriptions_read_own ON public.store_subscriptions
  FOR SELECT
  USING (public.is_super_admin() OR public.is_admin_of(store_id));

-- ===== 2. store_billing_events -- ledger IMUTAVEL, 1:N com stores, nunca editado/apagado. =====
CREATE TABLE public.store_billing_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN (
               'mensalidade_gerada', 'vencimento', 'pagamento_confirmado',
               'alteracao_vencimento', 'entrada_carencia', 'bloqueio', 'isencao'
             )),
  payload    jsonb,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_store_billing_events_store_data ON public.store_billing_events (store_id, created_at DESC);

ALTER TABLE public.store_billing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_billing_events_read_own ON public.store_billing_events
  FOR SELECT
  USING (public.is_super_admin() OR public.is_admin_of(store_id));

-- ===== 3. get_billing_status: consulta (admin da propria loja OU super admin). Nunca escreve. =====
CREATE OR REPLACE FUNCTION public.get_billing_status(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row public.store_subscriptions%ROWTYPE;
BEGIN
  -- Checagem direta de vinculo (NAO is_admin_of) -- ver decisao de implementacao #3 no cabecalho:
  -- billing precisa ser legivel mesmo com a loja bloqueada.
  IF NOT (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = p_store_id AND a.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'sem permissao para consultar o billing desta loja' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.store_subscriptions WHERE store_id = p_store_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('store_id', p_store_id, 'status', 'sem_assinatura');
  END IF;

  RETURN jsonb_build_object(
    'store_id', v_row.store_id,
    'status', v_row.status,
    'dia_vencimento', v_row.dia_vencimento,
    'proximo_vencimento', v_row.proximo_vencimento,
    'dias_carencia', v_row.dias_carencia,
    'valor_devido', v_row.valor_devido,
    'trial_ate', v_row.trial_ate,
    'contato_financeiro_nome', v_row.contato_financeiro_nome,
    'contato_financeiro_email', v_row.contato_financeiro_email,
    'contato_financeiro_whatsapp', v_row.contato_financeiro_whatsapp
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_billing_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_billing_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_billing_status(uuid) TO authenticated;

-- ===== 4. platform_marcar_mensalidade_paga: exclusiva do Platform Admin. =====
CREATE OR REPLACE FUNCTION public.platform_marcar_mensalidade_paga(p_store_id uuid, p_proximo_vencimento date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_existe boolean;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode confirmar pagamento de mensalidade'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id) THEN
    RAISE EXCEPTION 'loja nao encontrada: %', p_store_id USING ERRCODE = '22023';
  END IF;

  IF p_proximo_vencimento IS NULL OR p_proximo_vencimento <= CURRENT_DATE THEN
    RAISE EXCEPTION 'proximo vencimento invalido: informe uma data futura' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.store_subscriptions WHERE store_id = p_store_id) INTO v_existe;

  IF v_existe THEN
    UPDATE public.store_subscriptions
    SET status = 'em_dia', proximo_vencimento = p_proximo_vencimento, updated_at = now()
    WHERE store_id = p_store_id;
  ELSE
    INSERT INTO public.store_subscriptions (store_id, status, proximo_vencimento)
    VALUES (p_store_id, 'em_dia', p_proximo_vencimento);
  END IF;

  INSERT INTO public.store_billing_events (store_id, tipo, payload, criado_por)
  VALUES (p_store_id, 'pagamento_confirmado',
          jsonb_build_object('proximo_vencimento', p_proximo_vencimento), auth.uid());

  RETURN jsonb_build_object('ok', true, 'store_id', p_store_id, 'status', 'em_dia',
                             'proximo_vencimento', p_proximo_vencimento);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_marcar_mensalidade_paga(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_marcar_mensalidade_paga(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_marcar_mensalidade_paga(uuid, date) TO authenticated;

-- ===== 5. platform_configurar_dia_vencimento: exclusiva do Platform Admin. =====
CREATE OR REPLACE FUNCTION public.platform_configurar_dia_vencimento(p_store_id uuid, p_dia smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode configurar o dia de vencimento'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id) THEN
    RAISE EXCEPTION 'loja nao encontrada: %', p_store_id USING ERRCODE = '22023';
  END IF;

  IF p_dia IS NULL OR p_dia < 1 OR p_dia > 31 THEN
    RAISE EXCEPTION 'dia de vencimento invalido: % (use 1-31)', p_dia USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.store_subscriptions (store_id, dia_vencimento, trial_ate)
  VALUES (p_store_id, p_dia, CURRENT_DATE + INTERVAL '15 days')
  ON CONFLICT (store_id) DO UPDATE
    SET dia_vencimento = EXCLUDED.dia_vencimento, updated_at = now();
    -- proximo_vencimento de proposito NAO e tocado aqui -- ver decisao de implementacao #4.

  INSERT INTO public.store_billing_events (store_id, tipo, payload, criado_por)
  VALUES (p_store_id, 'alteracao_vencimento', jsonb_build_object('dia_vencimento', p_dia), auth.uid());

  RETURN jsonb_build_object('ok', true, 'store_id', p_store_id, 'dia_vencimento', p_dia);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_configurar_dia_vencimento(uuid, smallint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_configurar_dia_vencimento(uuid, smallint) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_configurar_dia_vencimento(uuid, smallint) TO authenticated;

-- ===== 6. platform_configurar_contato_financeiro: exclusiva do Platform Admin. =====
CREATE OR REPLACE FUNCTION public.platform_configurar_contato_financeiro(
  p_store_id uuid, p_nome text, p_email text, p_whatsapp text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_nome     text;
  v_email    text;
  v_whatsapp text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode configurar o contato financeiro'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id) THEN
    RAISE EXCEPTION 'loja nao encontrada: %', p_store_id USING ERRCODE = '22023';
  END IF;

  v_nome := NULLIF(trim(both from coalesce(p_nome, '')), '');
  v_email := NULLIF(lower(trim(both from coalesce(p_email, ''))), '');
  v_whatsapp := NULLIF(trim(both from coalesce(p_whatsapp, '')), '');

  IF v_email IS NOT NULL AND v_email !~ '^.+@.+\..+$' THEN
    RAISE EXCEPTION 'email invalido' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.store_subscriptions (store_id, contato_financeiro_nome, contato_financeiro_email, contato_financeiro_whatsapp)
  VALUES (p_store_id, v_nome, v_email, v_whatsapp)
  ON CONFLICT (store_id) DO UPDATE
    SET contato_financeiro_nome = EXCLUDED.contato_financeiro_nome,
        contato_financeiro_email = EXCLUDED.contato_financeiro_email,
        contato_financeiro_whatsapp = EXCLUDED.contato_financeiro_whatsapp,
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'store_id', p_store_id,
                             'contato_financeiro_nome', v_nome,
                             'contato_financeiro_email', v_email,
                             'contato_financeiro_whatsapp', v_whatsapp);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_configurar_contato_financeiro(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_configurar_contato_financeiro(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_configurar_contato_financeiro(uuid, text, text, text) TO authenticated;

-- ===== 7. is_admin_of: gate aditivo -- bloqueia SOMENTE o admin comum da loja, nunca o super admin. =====
CREATE OR REPLACE FUNCTION public.is_admin_of(p_store_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.is_super_admin()
      OR (
        EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = p_store_id AND a.user_id = auth.uid())
        AND NOT EXISTS (
          SELECT 1 FROM public.store_subscriptions s
          WHERE s.store_id = p_store_id AND s.status = 'bloqueada'
        )
      );
$function$;

-- ===== 8. Seed: Encanto + Aquarios Bar nascem isentas (decisao B.4), nunca "sem assinatura". =====
INSERT INTO public.store_subscriptions (store_id, status)
SELECT id, 'isenta' FROM public.stores WHERE slug IN ('encanto', 'aquariosbar')
ON CONFLICT (store_id) DO NOTHING;

INSERT INTO public.store_billing_events (store_id, tipo, payload)
SELECT id, 'isencao', jsonb_build_object('motivo', 'loja piloto do dono (REF-BILLING-01 B.4)')
FROM public.stores WHERE slug IN ('encanto', 'aquariosbar');

COMMIT;

NOTIFY pgrst, 'reload schema';
