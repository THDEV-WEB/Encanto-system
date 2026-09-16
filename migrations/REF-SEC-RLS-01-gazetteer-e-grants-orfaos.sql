-- ============================================================================
-- REF-SEC-RLS-01 — dois achados do "Raio-X do Encanto" (auditoria de 2026-09-12): uma policy
-- que promete admin e não checa, e 6 tabelas com GRANT total pra anon/authenticated seguras só
-- por não terem nenhuma policy de RLS.
-- ----------------------------------------------------------------------------
-- ACHADO 1 — address_gazetteer."Escrita admin gazetteer" tinha USING(true)/WITH CHECK(true) pro
-- papel authenticated, apesar do nome. Raiz: a migration original (REF-ADDRESS-02-onda4-gazetteer,
-- 2026-07-27) já dizia no comentário "escrita só authenticated (curadoria manual via SQL editor por
-- enquanto; UI de admin fica pra fase futura)" — era um placeholder deliberado, nunca apertado
-- depois. Confirmado por leitura de código: nenhum caminho do app (src/ nem supabase/functions/)
-- escreve nessa tabela — a curadoria real sempre foi via SQL editor (bypassa RLS, superuser), então
-- a policy nunca teve uso legítimo. Tabela não tem store_id (é referência de plataforma, compartilhada
-- entre TODAS as lojas, não pertence a nenhuma) — troca pra is_super_admin() (só o time VALION), não
-- is_admin_anywhere(): admin de uma loja não tem motivo legítimo pra editar/apagar dado compartilhado
-- de outras lojas que não são a dele. Decisão explícita do dono (2026-09-16); afrouxar depois (se um
-- dia existir feature de curadoria por admin de loja) é mudança simples e segura -- o oposto (começar
-- aberto demais) foi exatamente a causa do achado original.
--
-- ACHADO 2 — stores, store_settings, rate_limit_hits, delivery_route_cache, delivery_route_requests
-- e settings tinham GRANT SELECT/INSERT/UPDATE/DELETE liberado pra anon E authenticated, mas como
-- RLS está ligado e nenhuma das 6 tem uma única policy, o Postgres nega tudo por padrão hoje —
-- funciona, mas é uma arma destravada: a primeira policy mal escrita que alguém adicionar aqui no
-- futuro já nasce com CRUD completo, sem nenhuma segunda camada de contenção. Confirmado por leitura
-- de código que NENHUM caminho do app usa essas tabelas via anon/authenticated direto (zero
-- `.from('<tabela>')` em src/ ou supabase/functions/ pra qualquer uma das 6) — todo acesso real passa
-- por função SECURITY DEFINER (roda como dono da função, não como anon/authenticated, portanto
-- imune a este REVOKE) ou por service_role (idem). REVOKE aqui é, por construção, invisível pro
-- comportamento do app.
--
-- NÃO TOCA: active_tenant, mesa_sessions, mesas, mesa_session_mesas, payment_intents,
-- mesa_session_payment_allocations (mesmo padrão RLS-sem-policy, mas SEM grant de anon/authenticated
-- pra começo de conversa — já não têm essa arma destravada, nada a revogar).
--
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY (mesmo nome, sem risco de overload — policy não
-- é função); REVOKE é idempotente por natureza (revogar o que já não existe não erra). Testado no
-- projeto E2E (bgzcrovskjbktdxkhemd) antes de qualquer cogitação de produção — ver
-- scripts/sec-rls-01-test.mjs. Compat produção (Supabase/Postgres 17).
-- ============================================================================

BEGIN;

-- ACHADO 1: fecha a policy de escrita do gazetteer.
DROP POLICY IF EXISTS "Escrita admin gazetteer" ON public.address_gazetteer;
CREATE POLICY "Escrita admin gazetteer" ON public.address_gazetteer
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ACHADO 2: revoga o grant orfao (RLS sem policy ja bloqueava tudo; isto so' remove a superficie
-- que sobraria destravada se algum dia uma policy for adicionada sem cuidado).
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.stores                   FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.store_settings           FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.rate_limit_hits          FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.delivery_route_cache     FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.delivery_route_requests  FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.settings                 FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
