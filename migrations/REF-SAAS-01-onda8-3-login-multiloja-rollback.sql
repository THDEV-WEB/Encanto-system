-- REF-SAAS-01 · Onda 8.3 — Rollback: remove is_admin_anywhere().
-- ATENCAO: se aplicado, reverte AdminLogin.jsx tambem (ver commit) -- senao o frontend chama uma RPC
-- inexistente e todo login do Admin passa a falhar.

BEGIN;

DROP FUNCTION IF EXISTS public.is_admin_anywhere();

COMMIT;

NOTIFY pgrst, 'reload schema';
