-- REF-SEC-DATA-01 — Hardening critico: RPCs cron-only sem guard (R1+R2+R7) + GRANT TRUNCATE amplo (R3)
-- Achados da auditoria de protecao de dados de clientes (2026-08-17, fase read-only), corrigidos aqui
-- com autorizacao do dono. Escopo desta migration: R1, R2, R3, R7. R4 (isolamento cross-tenant de
-- addresses) fica FORA — tem REF propria aprovada (REF-AUTH-TENANT-01, Custom Access Token Hook,
-- mudanca arquitetural de autenticacao da plataforma inteira, nao um hardening pontual).
--
-- ACHADO R1: purge_old_logs(p_logs_days,p_events_days) — SECURITY DEFINER, owner postgres, EXECUTE
-- concedido a authenticated, ZERO checagem de autorizacao, parametros vindos livres do client.
-- Qualquer cliente comum (signup e self-service) podia chamar POST /rest/v1/rpc/purge_old_logs
-- {p_logs_days:0,p_events_days:0} e apagar IMEDIATAMENTE application_logs+order_events de TODA A
-- PLATAFORMA (todos os tenants). Confirmado por grep: nunca chamada pelo frontend.
--
-- ACHADO R2: reconcile_orders(p_order_id) / reconcile_and_alert() — mesmo padrao. Vazam total/
-- itens_sum/diff de pedidos com divergencia financeira de TODAS as lojas (cross-tenant) e ainda
-- GRAVAM em order_events de pedidos alheios como efeito colateral. reconcile_and_alert() chama
-- reconcile_orders() internamente (SQL-para-SQL) — ver nota de compatibilidade abaixo.
--
-- ACHADO R7: check_alert_thresholds() — mesmo padrao. Vaza contagem agregada de erros/divergencias
-- de TODA a plataforma e pode consumir o cooldown de 6h do alerta real (mascarando incidente).
--
-- Correcao R1/R2/R7: REVOKE EXECUTE ... FROM authenticated nas 4 funcoes. Confirmado por introspecao
-- (cron.job.username='postgres' nos 4 jobs; owner das 4 funcoes = postgres) que isso NAO quebra o
-- cron — o dono de uma funcao SEMPRE mantem EXECUTE implicito, independente de GRANT/REVOKE. Mesmo
-- padrao ja aplicado com sucesso neste projeto em REF-ORDER-01c-notif-grants-harden.sql (RPCs de
-- notificacao WhatsApp). anon nao tinha grant nenhuma das 4 (confirmado); service_role/postgres
-- mantidos intactos.
--
-- ACHADO R3: GRANT TRUNCATE (e DELETE/INSERT/REFERENCES/SELECT/TRIGGER/UPDATE) concedido tanto a
-- anon quanto a authenticated em ~18 tabelas do schema public, incluindo admins e super_admins (as
-- duas mais sensiveis do sistema). TRUNCATE NAO e filtrado por RLS (operacao de tabela inteira, nao
-- de linha) — RLS/policies nao protegem contra isso. Raiz confirmada via pg_default_acl: e o DEFAULT
-- PRIVILEGE do schema (ALTER DEFAULT PRIVILEGES do role postgres), nao erro pontual — mesmo padrao ja
-- corrigido HOJE so para addresses em REF-ADDRESS-SEC-01-isolamento.sql:35. Esta migration replica o
-- mesmo REVOKE nas 18 tabelas restantes e TAMBEM corrige o default (para tabela NOVA futura nao
-- nascer com o mesmo buraco). So os 3 verbos perigosos sao tocados — SELECT/INSERT/UPDATE/DELETE
-- continuam intactos (ja protegidos por RLS linha-a-linha em cada tabela).
--
-- NAO ALTERADO: nenhuma logica de negocio, nenhuma policy de RLS, nenhum SELECT/INSERT/UPDATE/DELETE.
-- Limitacao registrada: pg_default_acl tambem tem uma entrada para o role supabase_admin (alem de
-- postgres) — nao tocada aqui (a conexao de aplicacao nao e membro desse role; e quem cria as tabelas/
-- funcoes reais do projeto e sempre 'postgres', confirmado nas 18 tabelas revisadas).
--
-- Companion: REF-SEC-DATA-01-harden-critical-rollback.sql

BEGIN;

-- 1) R1 + R2 + R7 — revogar EXECUTE de authenticated nas 4 funcoes cron-only.
REVOKE EXECUTE ON FUNCTION public.purge_old_logs(integer, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_orders(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_and_alert() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.check_alert_thresholds() FROM authenticated;

-- 2) R3 — revogar TRUNCATE/REFERENCES/TRIGGER de anon+authenticated nas 18 tabelas restantes com o
--    grant amplo (addresses ja foi corrigida em REF-ADDRESS-SEC-01, nao repetida aqui).
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.address_gazetteer   FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.adicionais          FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.admins              FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.application_logs    FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.categories          FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.customers           FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.loyalty_accounts    FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.loyalty_events      FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.notification_outbox FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.order_events        FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.order_items         FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.orders              FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.product_collections FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.products            FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.settings            FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.store_settings      FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.stores              FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.super_admins        FROM anon, authenticated;

-- 3) R3 (causa raiz) — tabela NOVA futura criada pelo role postgres nao deve nascer com TRUNCATE/
--    REFERENCES/TRIGGER liberado a anon/authenticated. SELECT/INSERT/UPDATE/DELETE continuam no
--    default de sempre (cobertos por RLS em toda tabela nova, mesmo padrao ja usado no projeto).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

COMMIT;

-- Verificacao pos-aplicacao (rodar manualmente, ou via scripts/sec-data-01-harden-critical-test.mjs):
-- SELECT routine_name, grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_schema='public' AND routine_name IN
--   ('purge_old_logs','reconcile_orders','reconcile_and_alert','check_alert_thresholds')
--   ORDER BY 1,2;  -- authenticated NAO deve aparecer em nenhuma linha
-- SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND grantee IN ('anon','authenticated')
--   AND privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER') ORDER BY 1,2;  -- deve vir vazio
-- SELECT defaclacl FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace
--   AND defaclrole='postgres'::regrole AND defaclobjtype='r';  -- sem t/R/T pra anon/authenticated
