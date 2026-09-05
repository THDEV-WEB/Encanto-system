-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-DELIVERY-FEE-05 · Onda 3.1 — delivery_route_cache: tabela + escrita restrita a service_role.
--
-- OBJETIVO (Onda 3 completa, Alternativa D aprovada): fazer o SERVIDOR (create_order/
-- _resolve_delivery_fee) usar a distancia de ROTA VIARIA real (HeiGIT/OpenRouteService, ja calculada
-- hoje pela Edge Function route-distance para exibicao) como fonte AUTORITATIVA, sem que isso exija
-- uma chamada HTTP sincrona/bloqueante dentro de create_order() -- risco descartado nesta REF apos
-- introspeccao real: max_connections=60 em producao E em E2E, e o unico modo sincrono de pg_net
-- (net.http_collect_response(...,async:=false)) prende uma conexao do pool durante toda a espera do
-- provedor. Com create_order() sendo a funcao mais chamada do sistema, isso seria um risco de
-- esgotar o pool inteiro sob concorrencia (nao so a taxa de entrega -- o banco inteiro).
--
-- DESENHO (Onda 3.1 = so a tabela + a funcao de ESCRITA; leitura entra na Onda 3.3):
--   1) O client ja chama route-distance hoje, no mesmo momento em que monta o resumo em tempo real
--      (antes de clicar "Confirmar"). A partir da Onda 3.2, a Edge Function tambem GRAVA o resultado
--      aqui, usando a SERVICE_ROLE_KEY (que ela ainda nao usa hoje -- injetada automaticamente pela
--      plataforma em toda Edge Function, mesmo precedente de supabase/functions/invite-store-admin).
--   2) Quando o client finalmente chama create_order() (segundos depois), _resolve_delivery_fee
--      (Onda 3.3) LE esta tabela primeiro -- leitura de indice, sem rede, sem bloqueio de conexao.
--      Cache fresco -> distancia viaria autoritativa. Cache ausente/expirado -> Haversine SQL
--      (fallback tecnico ja existente, NUNCA removido, NUNCA multiplicado/corrigido).
--
-- POR QUE CHAVE NUMERICA (nao chave textual concatenada, ao contrario de routeCache.js/route-distance):
-- uma chave TEXTUAL exigiria que o SQL e o Deno formatassem o MESMO numero arredondado como a MESMA
-- string byte-a-byte (JS "-26.85" vs. numeric::text do Postgres, que preenche zeros a direita:
-- "-26.8500") -- uma fonte de cache-miss silencioso e dificil de depurar. Em vez disso, a tabela guarda
-- origem/destino como colunas numeric(8,4) e a comparacao no lookup (Onda 3.3) e NUMERICA
-- (round(x::numeric,4) = coluna), nunca textual -- imune a diferenca de formatacao entre as duas
-- linguagens. 4 casas decimais = ~11m de precisao, MESMA granularidade ja usada em routeCache.js/
-- route-distance/index.ts (CASAS_DECIMAIS=4).
--
-- SEGURANCA (autorizacao explicita do dono, 2026-09-04):
--   - RLS habilitado, ZERO policy para anon/authenticated (nem SELECT) -- bloqueia qualquer acesso via
--     PostgREST desses dois roles, tanto leitura quanto escrita. So' quem bypassa RLS (postgres,
--     service_role -- atributo nativo do Supabase) ou uma funcao SECURITY DEFINER (roda como dono)
--     consegue tocar a tabela.
--   - Escrita NUNCA e' feita direto na tabela via PostgREST (`.from(...).upsert(...)`) -- e' sempre via
--     _upsert_delivery_route_cache(), SECURITY DEFINER, com GRANT EXECUTE revogado de PUBLIC/anon/
--     authenticated e concedido SO' a service_role. Mesmo padrao de correcao ja aplicado nesta base em
--     REF-ORDER-01c (funcoes SECURITY DEFINER nunca podem ficar com o EXECUTE default do Postgres,
--     que e' PUBLIC).
--   - Nenhuma RPC de LEITURA e' criada aqui (nem nesta nem na Onda 3.3) -- a leitura fica inteiramente
--     dentro de _resolve_delivery_fee (ja SECURITY DEFINER), nunca exposta como endpoint separado.
--   - store_id participa da IDENTIDADE da entrada (parte do UNIQUE/lookup) -- isolamento tenant por
--     construcao, mesmo principio ja usado em routeCache.js/route-distance (defesa em profundidade,
--     nunca depende so da geometria de origem/destino nao coincidir entre lojas).
--
-- IDEMPOTENTE (CREATE TABLE IF NOT EXISTS, funcao via CREATE OR REPLACE, grants via REVOKE/GRANT
-- repetiveis). Rollback em arquivo separado.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.delivery_route_cache (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL,
  origem_lat    numeric(8,4) NOT NULL,
  origem_lng    numeric(8,4) NOT NULL,
  destino_lat   numeric(8,4) NOT NULL,
  destino_lng   numeric(8,4) NOT NULL,
  perfil        text NOT NULL DEFAULT 'driving-car',
  distance_km   numeric NOT NULL CHECK (distance_km >= 0),
  duration_min  numeric,
  provider      text NOT NULL DEFAULT 'heigit',
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, origem_lat, origem_lng, destino_lat, destino_lng, perfil)
);

-- Leitura por _resolve_delivery_fee (Onda 3.3) filtra por store_id + janela de frescor -- indice
-- cobre exatamente essa consulta (o UNIQUE acima ja cobre as colunas de igualdade; este cobre a busca
-- por store_id isolado, ex.: rotina de limpeza/observabilidade futura).
CREATE INDEX IF NOT EXISTS delivery_route_cache_store_id_idx ON public.delivery_route_cache (store_id);

ALTER TABLE public.delivery_route_cache ENABLE ROW LEVEL SECURITY;
-- Nenhuma CREATE POLICY: RLS habilitado sem excecao bloqueia TUDO (SELECT/INSERT/UPDATE/DELETE) para
-- anon/authenticated. So' service_role/postgres (bypassrls nativo) ou uma funcao SECURITY DEFINER
-- (roda como dono, ignora RLS) alcancam esta tabela.

-- Escrita restrita: SECURITY DEFINER, upsert por (store_id, origem, destino, perfil). Falha
-- silenciosamente (RETURN, nunca RAISE) em entrada invalida -- gravar cache NUNCA pode derrubar a
-- resposta ao cliente que a Edge Function (Onda 3.2) esta prestes a devolver.
CREATE OR REPLACE FUNCTION public._upsert_delivery_route_cache(
  p_store_id     uuid,
  p_origem_lat   double precision,
  p_origem_lng   double precision,
  p_destino_lat  double precision,
  p_destino_lng  double precision,
  p_distance_km  numeric,
  p_duration_min numeric DEFAULT NULL,
  p_provider     text DEFAULT 'heigit',
  p_perfil       text DEFAULT 'driving-car'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog', 'public'
AS $function$
BEGIN
  IF p_store_id IS NULL
     OR p_origem_lat IS NULL OR p_origem_lng IS NULL
     OR p_destino_lat IS NULL OR p_destino_lng IS NULL
     OR p_distance_km IS NULL OR p_distance_km < 0
  THEN
    RETURN;
  END IF;

  INSERT INTO public.delivery_route_cache
    (store_id, origem_lat, origem_lng, destino_lat, destino_lng, perfil, distance_km, duration_min, provider, atualizado_em)
  VALUES
    (p_store_id, round(p_origem_lat::numeric, 4), round(p_origem_lng::numeric, 4),
     round(p_destino_lat::numeric, 4), round(p_destino_lng::numeric, 4),
     coalesce(p_perfil, 'driving-car'), p_distance_km, p_duration_min, coalesce(p_provider, 'heigit'), now())
  ON CONFLICT (store_id, origem_lat, origem_lng, destino_lat, destino_lng, perfil) DO UPDATE SET
    distance_km   = excluded.distance_km,
    duration_min  = excluded.duration_min,
    provider      = excluded.provider,
    atualizado_em = now();
END;
$function$;

REVOKE ALL     ON FUNCTION public._upsert_delivery_route_cache(uuid, double precision, double precision, double precision, double precision, numeric, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._upsert_delivery_route_cache(uuid, double precision, double precision, double precision, double precision, numeric, numeric, text, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._upsert_delivery_route_cache(uuid, double precision, double precision, double precision, double precision, numeric, numeric, text, text) TO   service_role;

-- Tabela em si: nenhum GRANT para anon/authenticated (nem SELECT) -- RLS ja bloquearia, mas negar o
-- privilegio na origem e' defesa em profundidade (mesmo padrao de notification_outbox: so' quem
-- precisa ganha grant explicito). service_role/postgres ja tem acesso nativo (bypassrls + dono).

COMMIT;

NOTIFY pgrst, 'reload schema';
