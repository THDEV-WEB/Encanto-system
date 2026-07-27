-- REF-BOOT-02 — encerramento. Remove a infraestrutura de telemetria TEMPORARIA criada so para o
-- diagnostico forense do loader infinito relatado em aparelhos Xiaomi/HyperOS.
--
-- Causas raiz CONFIRMADAS (2026-07-27, ver memoria do projeto REF-BOOT-02 e docs/ref/REF-OBS-01-progress.md),
-- nenhuma delas bug de codigo:
--   1) Redmi Note 11 (vetor de abertura): o navegador embutido do WhatsApp em MIUI/HyperOS falhava em
--      abrir a URL ("URL nao suportado" -> "Abrir no navegador" -> volta pro WhatsApp). Copiar o link
--      direto no navegador funcionou. Resolucao definitiva = evoluir a arquitetura p/ PWA (futuro).
--   2) Poco C75: JavaScript estava DESATIVADO no navegador do aparelho (H-N6, confirmada exatamente
--      como a investigacao previa). Ativar JS resolveu — configuracao do proprio aparelho.
--
-- A tabela boot_diag foi criada FORA de migration versionada (via Supabase Management API, 2026-07-18 —
-- ver memoria do projeto) para receber o beacon do coletor v3 (index.html). Com a causa raiz confirmada e
-- nenhuma correcao de codigo pendente, a instrumentacao (coletor + beacon + esta tabela) e removida por
-- completo: index.html volta a ser so o loader estatico + mount point (sem o script IIFE de diagnostico);
-- os checkpoints window.__ENC_BOOT__ espalhados por main.jsx/App.jsx/StoreApp.jsx/lib/supabase.js/
-- lib/dbCliente.js/providers/AuthProvider.jsx/services/businessHours/businessHours.js foram removidos no
-- mesmo commit (frontend). A blindagem REAL do Intl (REF-BOOT-01, businessHours.js) e o Error Boundary
-- de raiz (main.jsx RootBoundary, com integracao Sentry via REF-OBS-01) sao PERMANENTES e NAO foram
-- tocados — a observabilidade de producao continua via Sentry.
--
-- Rollback: migrations/REF-BOOT-02-cleanup-drop-boot-diag-rollback.sql (recria schema vazio; os dados
-- coletados durante a investigacao — 1778 linhas, so telemetria de boot sem PII — nao sao preservados,
-- as conclusoes ja estao documentadas na memoria do projeto).
BEGIN;

DROP TABLE IF EXISTS public.boot_diag;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO ──────────────────────────────────────────────────────────────────────────────────
-- SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='boot_diag';
--   -- esperado: 0 linhas.
