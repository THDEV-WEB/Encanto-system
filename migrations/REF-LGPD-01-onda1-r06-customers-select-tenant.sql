-- REF-LGPD-01 · Onda 1 · LGPD-R06 — RLS de leitura propria de `customers` ganha correlacao de
-- tenant_id como CAMADA ADICIONAL, sem tocar no comportamento hoje em producao.
--
-- Historico da policy "Cliente le proprio customer" (nao reabre nenhuma REF fechada, so registra o
-- contexto pra esta mudanca fazer sentido):
--   AUTH-01-step1-fundacao.sql            -> USING (auth_user_id = auth.uid())
--   REF-SAAS-01-onda3-identidade-cliente  -> ganhou ancora: AND store_id = default_store_id()
--   REF-SAAS-01-onda6-1-storefront-dominio -> ancora REMOVIDA deliberadamente: default_store_id() nao
--     faz mais sentido num storefront multi-tenant (um bundle so, varias lojas por dominio); a mesma
--     pessoa pode legitimamente ter customer em mais de uma loja (ADR SAAS-01 §2). Decisao registrada:
--     o isolamento por loja passa a vir da QUERY do client (AuthService.getMeuCustomer ja faz
--     .eq('store_id', storefrontId) quando a loja esta resolvida -- src/services/AuthService.js:116-123),
--     nao mais da RLS.
--
-- Achado da auditoria REF-LGPD-01 (LGPD-R06): a RLS sozinha, hoje, devolve TODAS as linhas de customers
-- da mesma pessoa em QUALQUER loja quando a query nao filtra por store_id -- nao e' vazamento entre
-- pessoas diferentes (auth_user_id = auth.uid() continua sendo a base), mas e' uma dependencia total da
-- disciplina do client pra nao misturar contas da mesma pessoa entre lojas diferentes, inconsistente com
-- o padrao ja usado em addresses (REF-AUTH-TENANT-01 Onda 5, tenant_id do JWT).
--
-- Correcao (deliberadamente NAO fail-closed, ao contrario de addresses_select_tenant): manter
-- auth_user_id = auth.uid() como base SEMPRE, e SO quando o claim tenant_id ja estiver presente no JWT
-- (pos-ativacao de tenant, ver custom_access_token_hook), exigir tambem store_id = tenant_id. Quando
-- tenant_id ainda nao existe no token (ex.: janela entre login e a sincronizacao de
-- AuthService.syncTenant/activate_tenant, ver AuthProvider.jsx:78-84), a policy se comporta EXATAMENTE
-- como hoje -- nenhuma regressao de UX na tela "Minha Conta"/1o carregamento do customer. Uma vez que o
-- tenant_id sincroniza (refreshSession dispara onAuthStateChange, recarregando o customer), a policy
-- passa a excluir por RLS -- nao so' por query -- linhas de outras lojas da mesma pessoa.
--
-- Companion: REF-LGPD-01-onda1-r06-customers-select-tenant-rollback.sql

BEGIN;

ALTER POLICY "Cliente le proprio customer" ON public.customers
  USING (
    auth_user_id = auth.uid()
    AND (
      (auth.jwt()->>'tenant_id') IS NULL
      OR store_id = (auth.jwt()->>'tenant_id')::uuid
    )
  );

COMMIT;

-- Verificacao pos-aplicacao (rodar manualmente, ou via scripts/lgpd-01-r06-test.mjs):
-- SELECT policyname, cmd, roles, qual FROM pg_policies WHERE tablename = 'customers'
--   AND policyname = 'Cliente le proprio customer';
--   -- qual deve conter "tenant_id" alem de "auth_user_id"
-- Cenario A (sessao SEM tenant_id no JWT): SELECT ainda devolve as linhas do proprio auth_user_id em
--   qualquer loja -- comportamento identico ao pre-migracao.
-- Cenario B (sessao COM tenant_id no JWT, apos activate_tenant): SELECT devolve so a linha cujo
--   store_id bate com o tenant_id ativo -- linhas do mesmo auth_user_id em OUTRAS lojas somem da
--   consulta, mesmo sem filtro explicito na query.
