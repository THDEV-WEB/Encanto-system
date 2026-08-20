-- Rollback de REF-LGPD-01-onda1-r06-customers-select-tenant.sql — restaura a policy exatamente como
-- deixada por REF-SAAS-01-onda6-1-storefront-dominio.sql.

BEGIN;

ALTER POLICY "Cliente le proprio customer" ON public.customers
  USING (auth_user_id = auth.uid());

COMMIT;
