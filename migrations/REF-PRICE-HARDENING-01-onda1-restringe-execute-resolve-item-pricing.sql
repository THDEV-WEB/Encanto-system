-- REF-PRICE-HARDENING-01 -- restringe o EXECUTE de public._resolve_item_pricing() a quem realmente
-- precisa dele.
--
-- ACHADO (registrado durante a validacao de producao da REF-PRICE-SOURCE-01, nao corrigido naquela
-- acao por estar fora do escopo autorizado -- "aplicar SOMENTE as migrations"): _resolve_item_pricing()
-- e' SECURITY DEFINER, somente leitura (sem INSERT/UPDATE/DELETE), nunca cria pedido -- mas aparece com
-- EXECUTE concedido diretamente a anon/authenticated na ACL, apesar do REVOKE EXECUTE ... FROM PUBLIC
-- ja presente na migration que a criou (REF-PRICE-SOURCE-01-onda1-server-side-pricing.sql).
--
-- CAUSA CONFIRMADA (auditoria desta acao, leitura direta de pg_default_acl em producao e no projeto
-- E2E): o schema public deste projeto tem DOIS ALTER DEFAULT PRIVILEGES ativos (um da plataforma
-- Supabase, grantor supabase_admin; um do proprio projeto, grantor postgres) que concedem EXECUTE a
-- anon/authenticated/service_role automaticamente em TODA funcao nova criada em public -- um grant
-- NOMEADO, direto, aplicado no momento do CREATE FUNCTION. REVOKE ... FROM PUBLIC nunca neutraliza um
-- grant nomeado desses; so' REVOKE EXECUTE ... FROM <role> explicito remove.
--
-- CONFIRMADO ANTES DESTA MIGRATION QUE anon/authenticated NAO PRECISAM do EXECUTE direto: o UNICO
-- consumidor de _resolve_item_pricing() em todo o banco (producao e E2E, verificado via pg_proc.prosrc)
-- e' create_order() -- e' SECURITY DEFINER, owner postgres, chama _resolve_item_pricing() de dentro do
-- proprio corpo PL/pgSQL; essa chamada interna roda sob o contexto elevado do DEFINER (postgres), que
-- sempre tem EXECUTE por ser o dono -- nao depende, em nenhum momento, do grant do role que invocou
-- create_order() por fora. Nenhum codigo do frontend (grep em src/) chama _resolve_item_pricing()
-- diretamente. Revogar o EXECUTE de anon/authenticated nao quebra create_order().
--
-- EFEITO: reduz a superficie de execucao publica de uma funcao interna -- deixa de ser possivel a
-- qualquer client (anon ou authenticated) chamar _resolve_item_pricing() diretamente via RPC
-- (supabase.rpc('_resolve_item_pricing', ...)); service_role e postgres mantem EXECUTE (nao fazem
-- parte do achado, sem motivo para restringir).
--
-- NAO ALTERA: create_order(), _resolve_delivery_fee(), regras de preco/comerciais, RLS, grants de
-- qualquer outra funcao. Escopo estritamente este REVOKE.

BEGIN;

REVOKE EXECUTE ON FUNCTION public._resolve_item_pricing(uuid, uuid, text, jsonb) FROM anon, authenticated;

COMMIT;
