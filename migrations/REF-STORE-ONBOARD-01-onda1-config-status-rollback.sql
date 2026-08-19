-- Rollback REF-STORE-ONBOARD-01 · Onda 1 — remove get_store_config_status(uuid). Funcao nova (nao
-- substitui nenhuma RPC anterior), entao o rollback e' um DROP simples: nenhum outro objeto depende dela
-- (nenhuma view, nenhuma outra funcao, nenhuma policy). O frontend (AdminBusinessHours.jsx/
-- AdminTaxaEntrega.jsx) trata falha desta chamada como "status desconhecido" e simplesmente nao mostra o
-- banner -- reverter esta migration nao quebra nenhuma tela, so remove o aviso.

BEGIN;

DROP FUNCTION IF EXISTS public.get_store_config_status(uuid);

COMMIT;

NOTIFY pgrst, 'reload schema';
