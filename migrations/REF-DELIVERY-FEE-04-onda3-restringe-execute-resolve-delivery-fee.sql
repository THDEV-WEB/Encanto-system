-- REF-DELIVERY-FEE-04 · Onda 3 -- restringe o EXECUTE de public._resolve_delivery_fee() a quem
-- realmente precisa dele. Mesmo achado/causa-raiz/correcao ja aplicados em producao pra
-- _resolve_item_pricing() via REF-PRICE-HARDENING-01 (commit b970f75, outra sessao).
--
-- ACHADO (registrado durante a validacao de producao da Onda 1+2 desta REF, nao corrigido naquela
-- acao por estar fora do escopo autorizado -- "aplicar SOMENTE as duas migrations"):
-- _resolve_delivery_fee() e' SECURITY DEFINER, somente leitura (sem INSERT/UPDATE/DELETE), nunca
-- cria pedido -- mas aparecia com EXECUTE concedido diretamente a anon/authenticated na ACL, apesar
-- do REVOKE EXECUTE ... FROM PUBLIC ja presente na migration que a criou (Onda 1).
--
-- CAUSA (identica a REF-PRICE-HARDENING-01, ver esse arquivo para a auditoria completa de
-- pg_default_acl): o schema public tem ALTER DEFAULT PRIVILEGES ativos que concedem EXECUTE a
-- anon/authenticated automaticamente em TODA funcao nova criada em public -- grant NOMEADO, direto,
-- aplicado no momento do CREATE FUNCTION. REVOKE ... FROM PUBLIC nunca neutraliza um grant nomeado
-- desses; so' REVOKE EXECUTE ... FROM <role> explicito remove.
--
-- CONFIRMADO QUE anon/authenticated NAO PRECISAM do EXECUTE direto: o UNICO consumidor de
-- _resolve_delivery_fee() em todo o banco (producao e E2E, verificado via pg_proc.prosrc) e'
-- create_order() -- e' SECURITY DEFINER, owner postgres, chama _resolve_delivery_fee() de dentro do
-- proprio corpo PL/pgSQL; essa chamada interna roda sob o contexto elevado do DEFINER (postgres),
-- que sempre tem EXECUTE por ser o dono -- nao depende do grant do role que invocou create_order()
-- por fora. Nenhum codigo do frontend (grep em src/) chama _resolve_delivery_fee() diretamente.
-- Revogar o EXECUTE de anon/authenticated nao quebra create_order().
--
-- EFEITO: reduz a superficie de execucao publica -- deixa de ser possivel a qualquer client (anon
-- ou authenticated) chamar _resolve_delivery_fee() diretamente via RPC
-- (supabase.rpc('_resolve_delivery_fee', ...)), o que hoje permitiria consultar se um dado
-- endereco_id existe/tem coordenadas numa loja (enumeracao de baixo risco, mas fora do desenho
-- original da funcao). service_role e postgres mantem EXECUTE.
--
-- NAO ALTERA: create_order(), _resolve_item_pricing(), regras de preco/comerciais/delivery, RLS,
-- grants de qualquer outra funcao. Escopo estritamente este REVOKE.

BEGIN;

REVOKE EXECUTE ON FUNCTION public._resolve_delivery_fee(uuid, boolean, text, uuid) FROM anon, authenticated;

COMMIT;
