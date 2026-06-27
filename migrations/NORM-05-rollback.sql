-- ════════════════════════════════════════════════════════════════════════════
-- NORM-05 — ROLLBACK da migração de fonte única.
-- Aplicar: node C:\Users\00thi\.encanto\run.mjs --file <este arquivo>
-- Depois: git revert do commit de código (restaura o seam c3) e, se necessário,
-- restore do snapshot pre-norm-05.
-- PRÉ-CONDIÇÃO: antes do NORM-05 NÃO existiam linhas com aplica_categoria_id IS NULL
-- (todas as 15 tinham aplica='c3'), logo o DELETE abaixo remove exatamente os migrados.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- (1) Remover as 20 linhas migradas (escopo seguro: aplica NULL + grupos do legado).
DELETE FROM public.adicionais
WHERE aplica_categoria_id IS NULL AND grupo IN ('acai','marmita','bebida');

-- (2) Restaurar o CHECK restritivo original (só c3-model). Só é possível APÓS remover acima.
ALTER TABLE public.adicionais DROP CONSTRAINT IF EXISTS adicionais_grupo_check;
ALTER TABLE public.adicionais ADD  CONSTRAINT adicionais_grupo_check
  CHECK (grupo = ANY (ARRAY['simples','premium','frutas_premium','chocolates']));

-- (3) Remover a coluna adicionada.
ALTER TABLE public.adicionais DROP COLUMN IF EXISTS subgrupo_label;

COMMIT;

-- Verificação esperada: total=15, grupos = simples/premium/frutas_premium/chocolates, todos aplica='c3'.
