-- ============================================================================
-- REF-MESA-02 · Onda 16 — Segurança/ataque (auditoria adversarial dedicada)
-- ----------------------------------------------------------------------------
-- Varredura de GRANTS de TODAS as funções tocadas por esta REF (2-15) via
-- `has_function_privilege()` ao vivo (não releitura de texto de migration --
-- é exatamente o tipo de divergência que a Onda 6 já pegou uma vez: Supabase
-- concede EXECUTE a PUBLIC por padrão em função NOVA, e um DROP+CREATE
-- "esquece" REVOKEs antigos).
--
-- ACHADO REAL (não hipotético, confirmado com teste antes desta migration):
-- `admin_reports_summary(date, date, uuid)` tinha EXECUTE concedido a
-- PUBLIC/anon desde a criação original (REF-DASHBOARD-01) -- NENHUMA
-- migration desde então (nem REF-MESA-01 Onda 6, nem REF-MESA-02 Onda 12,
-- ambas CREATE OR REPLACE da mesma função) jamais revogou isso, porque
-- CREATE OR REPLACE sobre uma função JÁ EXISTENTE preserva os grants atuais
-- (só DROP+CREATE reseta) -- então o gap veio de nunca ter sido corrigido na
-- criação original, não de nenhuma mudança desta REF.
--
-- IMPACTO REAL: is_admin_of(p_store_id) dentro da função já bloqueia `anon`
-- de fato (testado: RAISE EXCEPTION 'apenas administradores...') -- não
-- houve vazamento de dado nenhuma vez. Mas é uma violação do padrão de
-- defesa-em-profundidade já estabelecido neste domínio desde REF-SEC-02
-- ("EXECUTE publico indevido" era exatamente essa classe de achado) --
-- corrigido aqui por ser exatamente o tipo de gap que esta onda existe pra
-- achar, e a correção é só REVOKE (zero mudança de comportamento pra
-- qualquer chamador legítimo).
--
-- Testes: scripts/mesa-02-onda16-seguranca-ataque-test.mjs (E2E) -- varredura
-- de grants de TODAS as 21 funções desta REF + ataques adicionais (token
-- forjado, cross-tenant combinado, RLS direto nas tabelas, concorrência real
-- em fechar_conta_mesa).
-- Rollback: REF-MESA-02-onda16-seguranca-ataque-rollback.sql (restaura o
-- GRANT a PUBLIC/anon -- reversibilidade de teste, não recomendação).
-- ============================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.admin_reports_summary(date, date, uuid) FROM PUBLIC, anon;
-- authenticated ja tinha EXECUTE (confirmado ao vivo antes desta migration) -- preservado, sem
-- necessidade de novo GRANT.

NOTIFY pgrst, 'reload schema';

COMMIT;
