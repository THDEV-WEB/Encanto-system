-- REF-MONEY-SCALE-01 -- fixa a escala decimal (numeric(10,2)) nas colunas monetarias que hoje sao
-- `numeric` sem precisao/escala declarada. Precedente ja existente no schema: adicionais.preco ja e'
-- numeric(10,2). Achado original da auditoria REF-PRICE-SOURCE-01.
--
-- COLUNAS ALTERADAS: products.preco, products.preco_promo, order_items.price,
-- order_items.preco_unitario, orders.total, orders.delivery_fee, orders.maquininha_fee.
--
-- AUDITORIA PREVIA (leitura direta em producao, antes de escrever esta migration):
--   - Nenhuma das 7 colunas tem CREATE TABLE versionado no repo (tabelas pre-existem a disciplina
--     de migrations deste projeto) -- por isso esta migration e' so' ALTER TABLE, sem base historica.
--   - pg_depend/pg_rewrite cobrindo as 7 colunas: a UNICA dependencia de view em todo o schema e'
--     v_order_reconciliation, e ela so' depende de order_items.price e orders.total (as outras 5
--     colunas nao tem nenhuma view/regra dependente). order_logs/order_status_durations nao tocam
--     nenhuma coluna monetaria.
--   - Nenhuma RLS policy de products/order_items/orders referencia qualquer coluna monetaria (todas
--     usam so' store_id/is_admin_of/auth.uid()).
--   - Varredura de dado sujo (WHERE col IS DISTINCT FROM round(col,2)) nas 7 colunas +
--     products.tamanhos[].preco (JSONB, fora do escopo desta migration -- sem typmod possivel em
--     JSONB) em producao: ZERO linhas sujas em todas -- o cast e' 100% seguro/sem perda hoje.
--   - orders_health() le v_order_reconciliation via SELECT dinamico (nao e' dependencia de
--     catalogo) -- recriar a view com CREATE OR REPLACE de mesmo nome/colunas nao exige tocar essa
--     funcao.
--   - ACHADO durante a 1a tentativa de aplicar esta migration no E2E: alem da view, existe um
--     TRIGGER com dependencia de catalogo em orders.total -- trg_orders_audit_edit e' definido com
--     "AFTER UPDATE OF payment_method, address, observacoes, total" (lista explicita de colunas),
--     o que faz o Postgres guardar uma dependencia igual a de uma view (erro "cannot alter type of
--     a column used in a trigger definition"). Nenhum outro trigger de products/order_items/orders
--     referencia coluna monetaria em sua lista de colunas (verificado via pg_get_triggerdef nos 8
--     triggers nao-internos das 3 tabelas). Triggers nao tem ACL propria (sem GRANT/REVOKE ON
--     TRIGGER) -- drop+recreate nao perde permissao, ao contrario da view.
--   - Definicao real de v_order_reconciliation capturada AO VIVO via pg_get_viewdef (nunca esteve
--     versionada -- pre-historico do projeto): reloptions=[security_invoker=true], owner=postgres,
--     ACL={postgres=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm} (anon ja revogado por
--     REF-SEC-02/HARDEN-ORDERS-RLS -- esta migration preserva essa ausencia deliberada).
--
-- PADRAO REAPROVEITADO: migrations/REF-DATETIME-01b-schema-timestamptz.sql (mesmo tipo de erro
-- "cannot alter type of a column used by a view or rule") -- DROP VIEW -> ALTER COLUMN (idempotente)
-- -> CREATE OR REPLACE VIEW reafirmando security_invoker+grants (DROP perde ACL, precisa reemitir).
--
-- Contrato de src/utils/pricing.js ("nunca arredondar", travado por tests/pricing.golden.mjs:109 via
-- Object.is) vale so' para o calculo em memoria no browser -- nao para o tipo da coluna no Postgres.
-- O caminho de escrita real (pos REF-PRICE-SOURCE-01-onda2 + REF-DELIVERY-FEE-04) ja recalcula tudo
-- no servidor a partir de products.preco/preco_promo/tamanhos[].preco e adicionais.preco (ja
-- numeric(10,2)) -- o client nao injeta mais preco/taxa bruto no banco. Esta migration nao contradiz
-- esse contrato.
--
-- Rollback: migrations/REF-MONEY-SCALE-01-precisao-decimal-monetaria-rollback.sql

BEGIN;

-- 1) Dropa a UNICA view dependente das 7 colunas + o UNICO trigger com coluna monetaria na sua
--    lista de colunas (ambos idempotentes).
DROP VIEW IF EXISTS public.v_order_reconciliation;
DROP TRIGGER IF EXISTS trg_orders_audit_edit ON public.orders;

-- 2) numeric -> numeric(10,2) nas 7 colunas. Loop idempotente (so' altera se ainda nao for
--    numeric(10,2)). Sem USING explicito: cast padrao numeric->numeric(10,2) arredonda p/ 2 casas --
--    lossless aqui (varredura de dado sujo no cabecalho confirmou zero linhas problematicas hoje).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('products',    'preco'),
      ('products',    'preco_promo'),
      ('order_items', 'price'),
      ('order_items', 'preco_unitario'),
      ('orders',      'total'),
      ('orders',      'delivery_fee'),
      ('orders',      'maquininha_fee')
    ) AS t(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = r.table_name
        AND column_name = r.column_name
        AND (numeric_precision IS DISTINCT FROM 10 OR numeric_scale IS DISTINCT FROM 2)
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(10,2)', r.table_name, r.column_name);
    END IF;
  END LOOP;
END $$;

-- 3) Recria o trigger -- definicao IDENTICA (pg_get_triggerdef capturado ao vivo antes do drop).
CREATE TRIGGER trg_orders_audit_edit
  AFTER UPDATE OF payment_method, address, observacoes, total ON public.orders
  FOR EACH ROW EXECUTE FUNCTION trg_order_edit_audit();

-- 4) Recria v_order_reconciliation -- definicao IDENTICA a capturada ao vivo antes do drop.
CREATE OR REPLACE VIEW public.v_order_reconciliation
WITH (security_invoker = true)
AS
SELECT id AS order_id,
    total,
    COALESCE((SELECT sum(oi.price * oi.quantity::numeric) FROM order_items oi WHERE oi.order_id = o.id), 0::numeric) AS itens_sum,
    total - COALESCE((SELECT sum(oi.price * oi.quantity::numeric) FROM order_items oi WHERE oi.order_id = o.id), 0::numeric) AS diff
FROM orders o;

ALTER VIEW public.v_order_reconciliation OWNER TO postgres;
-- REVOKE FROM PUBLIC nao basta: o schema public tem ALTER DEFAULT PRIVILEGES (supabase_admin E
-- postgres) que concedem arwdDxtm a anon/authenticated/service_role automaticamente em toda
-- relacao NOVA (mesmo mecanismo do achado de _resolve_item_pricing na REF-PRICE-HARDENING-01,
-- so' que para defaclobjtype='r' -- tabelas/views -- em vez de 'f' -- funcoes). CREATE OR REPLACE
-- apos o DROP se comporta como CREATE novo -> anon recebe grant nomeado direto, que REVOKE FROM
-- PUBLIC nao remove. Confirmado empiricamente no E2E (anon_select=true antes deste REVOKE
-- explicito). Precisa revogar de anon por nome pra restaurar a ACL capturada antes do drop.
REVOKE ALL ON public.v_order_reconciliation FROM PUBLIC, anon;
GRANT ALL ON public.v_order_reconciliation TO postgres, authenticated, service_role;
-- anon: nenhum grant (deliberado -- estado pos REF-SEC-02/HARDEN-ORDERS-RLS; coberto por
-- AO4/GR1 de scripts/harden-orders-rls-test.mjs, que continuam PASS apos esta migration).

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO (comentada, rodar manualmente pos-apply) ────────────────────────────────────────
-- SELECT table_name, column_name, numeric_precision, numeric_scale FROM information_schema.columns
--   WHERE table_schema='public' AND (table_name,column_name) IN
--     (('products','preco'),('products','preco_promo'),('order_items','price'),
--      ('order_items','preco_unitario'),('orders','total'),('orders','delivery_fee'),
--      ('orders','maquininha_fee'));  -- esperado: precision=10, scale=2 nas 7 linhas
-- SELECT relname, reloptions FROM pg_class WHERE relnamespace='public'::regnamespace
--   AND relname='v_order_reconciliation';  -- esperado: {security_invoker=true}
-- SELECT grantee, privilege_type FROM information_schema.table_privileges
--   WHERE table_schema='public' AND table_name='v_order_reconciliation' ORDER BY 1,2;
--   -- esperado: so' postgres/authenticated/service_role; NENHUMA linha p/ anon
