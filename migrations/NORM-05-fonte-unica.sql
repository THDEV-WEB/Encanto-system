-- ════════════════════════════════════════════════════════════════════════════
-- NORM-05 — Fonte única de adicionais (migrar MOCK_ADS → tabela, remover seam c3)
-- Idempotente. Rodar com backup ANTES: node C:\Users\00thi\.encanto\backups\snapshot.mjs pre-norm-05
-- Aplicar: node C:\Users\00thi\.encanto\run.mjs --file <este arquivo>
-- Rollback: ver NORM-05-rollback.sql + git revert do código.
--
-- CONTRATO DE SCHEMA (congelado a partir do NORM-05) — colunas do domínio:
--   grupo · subgrupo_label · aplica_categoria_id · ordem · tipo · preco
-- Alterar estas colunas exige: migração dedicada + atualização dos snapshots + revisão + commit exclusivo.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- (1) DDL aditivo: permitir os grupos do modelo legado (acai/marmita/bebida) + coluna de subgrupo.
ALTER TABLE public.adicionais DROP CONSTRAINT IF EXISTS adicionais_grupo_check;
ALTER TABLE public.adicionais ADD  CONSTRAINT adicionais_grupo_check
  CHECK (grupo = ANY (ARRAY['simples','premium','frutas_premium','chocolates','acai','marmita','bebida']));
ALTER TABLE public.adicionais ADD COLUMN IF NOT EXISTS subgrupo_label text;

-- (2) DADOS: migrar os 20 MOCK_ADS verbatim. aplica_categoria_id=NULL → valem p/ todas as categorias
--     (mesma semântica do MOCK em código: !ad.aplica_categoria_id => aplica a todos).
--     `ordem` preserva a ordem de exibição do MOCK (acai 1-15: gratis 1-6, premium 7-10, frutas 11-13,
--     choco 14-15; marmita 1-5). Idempotente via NOT EXISTS (UNIQUE é NULLS DISTINCT → ON CONFLICT
--     não cobriria aplica=NULL).
INSERT INTO public.adicionais (nome, grupo, tipo, preco, ativo, ordem, aplica_categoria_id, subgrupo_label)
SELECT v.nome, v.grupo, v.tipo, v.preco, true, v.ordem, NULL, v.subgrupo_label
FROM (VALUES
  ('Banana','acai','gratis',0,1,NULL),('Granola','acai','gratis',0,2,NULL),
  ('Paçoca','acai','gratis',0,3,NULL),('Amendoim','acai','gratis',0,4,NULL),
  ('Leite Condensado','acai','gratis',0,5,NULL),('Leite em Pó','acai','gratis',0,6,NULL),
  ('Nutella','acai','pago',8,7,'Adicionais Premium'),('Creme de Avelã','acai','pago',6,8,'Adicionais Premium'),
  ('Creme de Leitinho','acai','pago',6,9,'Adicionais Premium'),('Doce de Leite','acai','pago',5,10,'Adicionais Premium'),
  ('Morango','acai','pago',6,11,'Frutas Premium'),('Kiwi','acai','pago',6,12,'Frutas Premium'),
  ('Uva Verde','acai','pago',6,13,'Frutas Premium'),
  ('Coloretti','acai','pago',4,14,'Chocolates'),('Ovomaltine','acai','pago',4,15,'Chocolates'),
  ('Carne Extra','marmita','pago',5,1,NULL),('Frango Extra','marmita','pago',5,2,NULL),
  ('Linguiça Extra','marmita','pago',4,3,NULL),('Ovo','marmita','pago',2,4,NULL),('Batata Frita','marmita','pago',3,5,NULL)
) AS v(nome,grupo,tipo,preco,ordem,subgrupo_label)
WHERE NOT EXISTS (
  SELECT 1 FROM public.adicionais a
  WHERE a.nome = v.nome AND a.grupo = v.grupo AND a.aplica_categoria_id IS NULL
);

COMMIT;

-- Verificação esperada após aplicar:
--   SELECT grupo, count(*) FROM public.adicionais GROUP BY grupo ORDER BY grupo;
--   → acai=15, chocolates=2, frutas_premium=3, marmita=5, premium=4, simples=6  (total 35)
