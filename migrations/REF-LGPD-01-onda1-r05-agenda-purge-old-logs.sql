-- REF-LGPD-01 · Onda 1 · LGPD-R05 — CORRECAO DE ROTA apos introspeccao direta do banco de producao
-- (2026-08-19): o achado original da auditoria ("nenhuma evidencia tecnica de agendamento real") estava
-- INCORRETO. `SELECT jobname, schedule, command FROM cron.job` confirmou que o job 'encanto-purge-logs'
-- (schedule '30 3 * * *', comando `select public.purge_old_logs(90, 365);`) JA EXISTE e roda todo dia
-- com sucesso (5+ execucoes consecutivas confirmadas em cron.job_run_details, ultima em 2026-08-19
-- 03:30 UTC, status 'succeeded'). O agente de auditoria so' tinha acesso ao repositorio git, nunca ao
-- banco ao vivo -- por isso nao viu esse job, criado fora de migration versionada (mesmo padrao ja
-- admitido pra get_setting/normalize_phone/send_alert, achado R19 da REF-SEC-DATA-01).
--
-- O gap REAL remanescente e' bem menor do que o achado original sugeria: GOVERNANCA (job existe mas
-- nunca foi versionado), nao ausencia funcional de purga. Esta migration corrige so' isso -- VERSIONA o
-- job EXATAMENTE como ja esta rodando hoje (mesmo jobname, mesmo schedule, mesmo comando, mesmos 90/365
-- dias -- valores operacionais REAIS ja em uso, nao inventados por esta REF). cron.schedule faz upsert
-- por jobname (comportamento nativo do pg_cron); reaplicar isto e' inofensivo (idempotente) e NUNCA move
-- o job pra outro horario/jobname/parametro.
--
-- Os 90/365 dias ja em producao NAO foram confirmados juridicamente por esta REF (ninguem validou se
-- esse e' o prazo correto) -- mas tambem nao sao alterados aqui; so' ficam documentados/versionados
-- como estao. Ajuste de prazo, se necessario, continua dependente de LGPD-R07 (validacao juridica/
-- contabil), fora do escopo desta correcao.
--
-- Companion: REF-LGPD-01-onda1-r05-agenda-purge-old-logs-rollback.sql

BEGIN;

SELECT cron.unschedule('encanto-purge-logs')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encanto-purge-logs');
SELECT cron.schedule('encanto-purge-logs', '30 3 * * *',
  $$select public.purge_old_logs(90, 365);$$);

COMMIT;

-- Verificacao pos-aplicacao:
-- SELECT jobname, schedule, command, active FROM cron.job WHERE jobname = 'encanto-purge-logs';
--   -- deve ser IDENTICO ao que ja rodava antes desta migration (mesmo schedule/comando) -- esta
--   -- migration documenta o estado real, nunca o altera.
