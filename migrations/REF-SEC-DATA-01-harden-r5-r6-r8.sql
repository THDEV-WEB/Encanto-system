-- REF-SEC-DATA-01 — Hardening dos achados ALTO: application_logs aberto (R5) + PII cross-tenant no
-- trigger de auditoria de clientes (R6) + grant supefluo a anon/PUBLIC em 5 RPCs admin (R8).
-- Sequencia de REF-SEC-DATA-01-harden-critical.sql (R1+R2+R3+R7, ja aplicada e validada). Achados da
-- auditoria de protecao de dados de clientes (2026-08-17, fase read-only), corrigidos aqui com
-- autorizacao do dono.
--
-- ACHADO R5: application_logs_read_auth ("Auth all") FOR SELECT TO authenticated USING (true) — SEM
-- filtro de store_id, apesar da coluna existir. Qualquer cliente autenticado de QUALQUER loja lia
-- logs operacionais de TODAS as lojas. Escopo desta correcao fica restrito ao SELECT: o INSERT
-- (application_logs_insert, TO anon, authenticated) NAO e tocado — confirmado por grep que
-- src/hooks/useProducts.js chama DS.logEvent (INSERT direto, DataService.js) no fallback do catalogo
-- quando o Supabase fica indisponivel, caminho exercitado tambem por visitante ANONIMO (catalogo
-- publico); revogar quebraria esse fallback legitimo em producao. Log forging via INSERT aberto fica
-- registrado como decisao consciente, fora deste pacote.
--
-- ACHADO R6: trg_customer_audit (AFTER UPDATE ON customers, dispara quando name/phone mudam) grava em
-- order_events sem definir store_id -> cai no DEFAULT default_store_id() = SEMPRE loja Encanto (
-- heranca pre-multi-tenant). Mudanca de nome/telefone de cliente de QUALQUER OUTRA loja virava evento
-- visivel ao admin da Encanto (nome/telefone antes-depois) — unico achado desta auditoria com
-- vazamento de PII INDIVIDUAL real (nao agregado) entre tenants. Correcao espelha o padrao ja correto
-- de trg_order_audit (usa new.store_id, sempre disponivel pois customers.store_id e NOT NULL).
--
-- ACHADO R8: admin_orders_search/admin_orders_stats/admin_reports_summary/admin_order_endereco/
-- admin_find_loyalty ja sao corretamente gated por is_admin_of() internamente, mas tem EXECUTE
-- concedido tambem a anon e PUBLIC (nao so authenticated) — inofensivo hoje (auth.uid() e NULL pra
-- anon, a checagem interna nega), mas quebra o padrao de defesa em profundidade ja aplicado noutras
-- RPCs do projeto (REF-ORDER-01c). Correcao revoga o grant superfluo, mantendo authenticated.
--
-- NAO ALTERADO: application_logs_insert; logica de negocio das 5 RPCs (so os grants); demais triggers
-- de auditoria (trg_order_audit/trg_order_edit_audit/trg_order_item_audit), ja corretos.
--
-- Companion: REF-SEC-DATA-01-harden-r5-r6-r8-rollback.sql

BEGIN;

-- 1) R5 — SELECT em application_logs so pra admin da propria loja (is_admin_of(NULL) ja resolve certo
--    pra super admin nos logs de plataforma sem loja especifica — nao precisa de OR extra).
DROP POLICY IF EXISTS "application_logs_read_auth" ON public.application_logs;
CREATE POLICY "application_logs_read_admin" ON public.application_logs
  FOR SELECT TO authenticated
  USING (public.is_admin_of(store_id));

-- 2) R6 — trg_customer_audit passa a propagar store_id (mesmo padrao de trg_order_audit).
CREATE OR REPLACE FUNCTION public.trg_customer_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.order_events(order_id,tipo,usuario,payload,store_id)
    values(null,'CLIENTE_ATUALIZADO',current_user,
      jsonb_build_object('customer_id',new.id,
        'antes',jsonb_build_object('name',old.name,'phone',old.phone),
        'depois',jsonb_build_object('name',new.name,'phone',new.phone)),
      new.store_id);
  return null;
end;$function$;

-- 3) R8 — revoga EXECUTE de anon/PUBLIC nas 5 RPCs administrativas (authenticated mantido intacto).
REVOKE EXECUTE ON FUNCTION public.admin_orders_search(text, text, integer, timestamptz, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_orders_stats(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reports_summary(date, date, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_order_endereco(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_find_loyalty(text, uuid) FROM PUBLIC, anon;

COMMIT;

-- Verificacao pos-aplicacao (rodar manualmente, ou via scripts/sec-data-01-r5-r6-r8-test.mjs):
-- SELECT policyname, cmd, roles, qual FROM pg_policies WHERE tablename='application_logs';
--   -- deve mostrar application_logs_read_admin com qual referenciando is_admin_of
-- SELECT prosrc FROM pg_proc WHERE proname='trg_customer_audit';
--   -- deve incluir ",store_id" no INSERT e "new.store_id" nos values
-- SELECT routine_name, grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_schema='public' AND routine_name IN
--   ('admin_orders_search','admin_orders_stats','admin_reports_summary','admin_order_endereco','admin_find_loyalty')
--   ORDER BY 1,2;  -- anon/PUBLIC NAO devem aparecer
