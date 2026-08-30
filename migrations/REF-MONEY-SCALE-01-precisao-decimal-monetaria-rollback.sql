-- Rollback de REF-MONEY-SCALE-01-precisao-decimal-monetaria.sql -- devolve as 7 colunas para
-- `numeric` sem precisao/escala declarada. Lossless (numeric(10,2) -> numeric bruto nunca perde
-- digito, so' remove o teto declarado). Mesma restricao do Postgres na direcao inversa -- dropa a
-- view antes, recria depois, mesma definicao/grants da migration original.

BEGIN;

DROP VIEW IF EXISTS public.v_order_reconciliation;
DROP TRIGGER IF EXISTS trg_orders_audit_edit ON public.orders;

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
        AND (numeric_precision IS NOT NULL OR numeric_scale IS NOT NULL)
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric', r.table_name, r.column_name);
    END IF;
  END LOOP;
END $$;

CREATE TRIGGER trg_orders_audit_edit
  AFTER UPDATE OF payment_method, address, observacoes, total ON public.orders
  FOR EACH ROW EXECUTE FUNCTION trg_order_edit_audit();

CREATE OR REPLACE VIEW public.v_order_reconciliation
WITH (security_invoker = true)
AS
SELECT id AS order_id,
    total,
    COALESCE((SELECT sum(oi.price * oi.quantity::numeric) FROM order_items oi WHERE oi.order_id = o.id), 0::numeric) AS itens_sum,
    total - COALESCE((SELECT sum(oi.price * oi.quantity::numeric) FROM order_items oi WHERE oi.order_id = o.id), 0::numeric) AS diff
FROM orders o;

ALTER VIEW public.v_order_reconciliation OWNER TO postgres;
-- REVOKE FROM PUBLIC nao basta -- ALTER DEFAULT PRIVILEGES do schema public concede anon
-- automaticamente em toda relacao nova (mesmo achado da migration original, ver seu cabecalho).
REVOKE ALL ON public.v_order_reconciliation FROM PUBLIC, anon;
GRANT ALL ON public.v_order_reconciliation TO postgres, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
