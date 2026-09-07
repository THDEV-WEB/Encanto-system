-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-DELIVERY-FEE-05 · Onda 3.4 — cache de rota AUTOALIMENTADO pelo proprio banco (pg_net+pg_cron),
-- substituindo a dependencia de Edge Function -> PostgREST/conexao direta para ESCREVER no cache.
--
-- CONTEXTO (ver docs/adr/REF-DELIVERY-FEE-05-onda3-incidente-01.md): duas tentativas anteriores de
-- fazer a Edge Function route-distance gravar em delivery_route_cache esbarraram em bugs de
-- infraestrutura do lado do Supabase, ambos fora do nosso controle:
--   1) PostgREST nunca reconhece a funcao de escrita via API REST (erro PGRST202, "function not
--      found in schema cache"), mesmo apos reload/restart/pause+resume completos -- confirmado nao
--      ser bug de codigo (funcoes triviais criadas do zero apresentam o MESMO problema).
--   2) Uma conexao Postgres DIRETA de dentro de uma Edge Function deste projeto e' roteada, na
--      camada de rede da propria infraestrutura de Edge Functions, para um servidor Postgres
--      DIFERENTE do banco real (confirmado por diagnostico: arquitetura de CPU divergente).
--
-- NOVA ARQUITETURA: reaproveita EXATAMENTE o padrao ja usado e comprovado em producao pelo
-- dispatcher de WhatsApp (enc_dispatch_notifications, REF-ORDER-01b) -- pg_net + pg_cron, tudo
-- dentro do proprio Postgres, ZERO dependencia de PostgREST ou de qualquer Edge Function para a
-- ESCRITA do cache:
--   1) _resolve_delivery_fee(), ao cair no fallback Haversine (cache ausente/expirado), enfileira
--      (fire-and-forget, mesma transacao, nunca atrasa nem falha o pedido) um pedido de calculo em
--      delivery_route_requests.
--   2) pg_cron (a cada 20s) roda enc_dispatch_route_requests(): confirma respostas ja chegadas
--      (grava em delivery_route_cache via upsert_delivery_route_cache, SQL direto -- SEM PostgREST)
--      e despacha novos pedidos pendentes via net.http_post ao HeiGIT (chave lida do Vault, NUNCA
--      do secret da Edge Function -- duplicada de proposito, mesmo precedente do whatsapp_token).
--
-- TRADE-OFF (aceito explicitamente pelo dono): existe uma janela de ate ~20-40s entre "cache
-- ausente" e "cache pronto". O PRIMEIRO pedido para um par loja+endereco inedito sempre usa
-- Haversine (nunca trava, nunca falha) -- pedidos SEGUINTES para o MESMO par ja usam a rota real.
-- Nenhum fator de correcao/multiplicador -- mesma proibicao ja vigente desde o inicio desta REF.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── Fila de pedidos de calculo de rota (mesmo padrao de notification_outbox) ──
CREATE TABLE IF NOT EXISTS public.delivery_route_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL,
  origem_lat    numeric(8,4) NOT NULL,
  origem_lng    numeric(8,4) NOT NULL,
  destino_lat   numeric(8,4) NOT NULL,
  destino_lng   numeric(8,4) NOT NULL,
  perfil        text NOT NULL DEFAULT 'driving-car',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','done','failed')),
  net_request_id bigint,
  attempts      int NOT NULL DEFAULT 0,
  last_error    text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, origem_lat, origem_lng, destino_lat, destino_lng, perfil)
);
CREATE INDEX IF NOT EXISTS delivery_route_requests_pending_idx
  ON public.delivery_route_requests (criado_em) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS delivery_route_requests_sending_idx
  ON public.delivery_route_requests (net_request_id) WHERE status = 'sending';

ALTER TABLE public.delivery_route_requests ENABLE ROW LEVEL SECURITY;
-- Nenhuma CREATE POLICY: mesmo padrao de delivery_route_cache -- so' service_role/postgres
-- (bypassrls) ou uma funcao SECURITY DEFINER alcancam esta tabela.

-- ── Enfileiramento: chamada FIRE-AND-FORGET de dentro de _resolve_delivery_fee. NUNCA lanca
-- excecao (protegida por BEGIN/EXCEPTION interno) -- enfileirar cache e' sempre secundario ao
-- calculo do pedido em si. Upsert idempotente: nao duplica solicitacao ja pending/sending/done;
-- reseta para 'pending' apenas se a tentativa anterior tinha falhado (permite retry natural). ──
CREATE OR REPLACE FUNCTION public._enfileirar_calculo_rota(
  p_store_id    uuid,
  p_origem_lat  double precision,
  p_origem_lng  double precision,
  p_destino_lat double precision,
  p_destino_lng double precision,
  p_perfil      text DEFAULT 'driving-car'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog', 'public'
AS $function$
BEGIN
  IF p_store_id IS NULL OR p_origem_lat IS NULL OR p_origem_lng IS NULL
     OR p_destino_lat IS NULL OR p_destino_lng IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.delivery_route_requests
    (store_id, origem_lat, origem_lng, destino_lat, destino_lng, perfil)
  VALUES
    (p_store_id, round(p_origem_lat::numeric, 4), round(p_origem_lng::numeric, 4),
     round(p_destino_lat::numeric, 4), round(p_destino_lng::numeric, 4), coalesce(p_perfil, 'driving-car'))
  ON CONFLICT (store_id, origem_lat, origem_lng, destino_lat, destino_lng, perfil) DO UPDATE SET
    status = CASE WHEN delivery_route_requests.status = 'failed' THEN 'pending' ELSE delivery_route_requests.status END,
    atualizado_em = CASE WHEN delivery_route_requests.status = 'failed' THEN now() ELSE delivery_route_requests.atualizado_em END;
EXCEPTION WHEN OTHERS THEN
  -- Enfileirar e' sempre secundario -- qualquer falha aqui NUNCA pode propagar e derrubar o
  -- calculo do delivery fee que esta' em andamento.
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._enfileirar_calculo_rota(uuid, double precision, double precision, double precision, double precision, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._enfileirar_calculo_rota(uuid, double precision, double precision, double precision, double precision, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._enfileirar_calculo_rota(uuid, double precision, double precision, double precision, double precision, text) TO service_role;

-- ── Dispatcher: mesmo desenho de enc_dispatch_notifications (CONFIRMA respostas ja chegadas,
-- depois DESPACHA pendentes). Chave do HeiGIT vem do Vault (heigit_api_key) -- ausente = NO-OP
-- (fila fica pending, nada quebra). Grava no cache via SQL direto (upsert_delivery_route_cache),
-- NUNCA via PostgREST/RPC HTTP -- e' exatamente essa chamada de rede que estava bloqueada. ──
CREATE OR REPLACE FUNCTION public.enc_dispatch_route_requests()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog', 'public'
AS $function$
DECLARE
  v_api_key text;
  v_row     record;
  v_req     bigint;
  v_desp    int := 0;
  v_conf    int := 0;
  v_body    jsonb;
  v_status  int;
  v_dist_m  numeric;
  v_dur_s   numeric;
BEGIN
  SELECT decrypted_secret INTO v_api_key FROM vault.decrypted_secrets WHERE name = 'heigit_api_key' LIMIT 1;
  IF v_api_key IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'heigit_api_key_not_configured');
  END IF;

  -- (1) CONFIRMACAO: resolve 'sending' cujos requests ja responderam.
  FOR v_row IN
    SELECT o.id, o.store_id, o.origem_lat, o.origem_lng, o.destino_lat, o.destino_lng, o.perfil,
           r.status_code, r.content
      FROM public.delivery_route_requests o
      JOIN net._http_response r ON r.id = o.net_request_id
     WHERE o.status = 'sending'
  LOOP
    IF v_row.status_code BETWEEN 200 AND 299 THEN
      v_body := v_row.content::jsonb;
      v_dist_m := COALESCE(
        (v_body->'routes'->0->'summary'->>'distance')::numeric,
        (v_body->'features'->0->'properties'->'summary'->>'distance')::numeric
      );
      v_dur_s := COALESCE(
        (v_body->'routes'->0->'summary'->>'duration')::numeric,
        (v_body->'features'->0->'properties'->'summary'->>'duration')::numeric
      );
      IF v_dist_m IS NOT NULL THEN
        PERFORM public.upsert_delivery_route_cache(
          v_row.store_id, v_row.origem_lat::double precision, v_row.origem_lng::double precision,
          v_row.destino_lat::double precision, v_row.destino_lng::double precision,
          round((v_dist_m / 1000)::numeric, 4), round((v_dur_s / 60)::numeric, 2), 'heigit', v_row.perfil
        );
        UPDATE public.delivery_route_requests SET status = 'done', atualizado_em = now() WHERE id = v_row.id;
      ELSE
        UPDATE public.delivery_route_requests SET status = 'failed', attempts = attempts + 1,
          last_error = 'resposta_sem_distancia', atualizado_em = now() WHERE id = v_row.id;
      END IF;
    ELSE
      UPDATE public.delivery_route_requests SET status = 'failed', attempts = attempts + 1,
        last_error = 'http_' || v_row.status_code, atualizado_em = now() WHERE id = v_row.id;
    END IF;
    v_conf := v_conf + 1;
  END LOOP;

  -- (2) DESPACHO: pendentes mais antigos primeiro, lote pequeno (mesmo teto de bom senso do
  -- dispatcher de WhatsApp) -- nunca estoura a cota diaria do HeiGIT (2000 req/dia) de uma vez.
  FOR v_row IN
    SELECT id, origem_lat, origem_lng, destino_lat, destino_lng, perfil
      FROM public.delivery_route_requests
     WHERE status = 'pending' AND attempts < 5
     ORDER BY criado_em ASC
     LIMIT 10
     FOR UPDATE SKIP LOCKED
  LOOP
    v_req := net.http_post(
      url     := 'https://api.heigit.org/openrouteservice/v2/directions/' || v_row.perfil,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', v_api_key),
      body    := jsonb_build_object('coordinates', jsonb_build_array(
                   jsonb_build_array(v_row.origem_lng, v_row.origem_lat),
                   jsonb_build_array(v_row.destino_lng, v_row.destino_lat)
                 )),
      timeout_milliseconds := 8000
    );
    UPDATE public.delivery_route_requests SET status = 'sending', net_request_id = v_req, atualizado_em = now()
     WHERE id = v_row.id;
    v_desp := v_desp + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'despachados', v_desp, 'confirmados', v_conf);
END;
$function$;

REVOKE ALL ON FUNCTION public.enc_dispatch_route_requests() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enc_dispatch_route_requests() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enc_dispatch_route_requests() TO service_role;

COMMIT;

-- Agendamento (fora da transacao) -- a cada 20s, mesmo espirito do dispatcher de WhatsApp (30s).
-- Reaplicavel (unschedule antes).
SELECT cron.unschedule('enc-dispatch-route-requests') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enc-dispatch-route-requests');
SELECT cron.schedule('enc-dispatch-route-requests', '20 seconds', $$SELECT public.enc_dispatch_route_requests();$$);

NOTIFY pgrst, 'reload schema';
