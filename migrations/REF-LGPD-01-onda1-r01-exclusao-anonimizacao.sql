-- REF-LGPD-01 · Onda 1 · LGPD-R01 (CRITICO) — infraestrutura tecnica de exclusao/anonimizacao de dados
-- do titular. Achado da auditoria: nenhum mecanismo existia -- deletar auth.users manualmente so
-- desvinculava customers.auth_user_id (ON DELETE SET NULL), deixando nome/telefone/e-mail/enderecos
-- orfaos indefinidamente.
--
-- DECISAO TECNICA (nao juridica -- ver aviso abaixo): ANONIMIZACAO do cadastro, nao exclusao fisica de
-- pedidos. orders/order_items/order_events (historico operacional, financeiro e de auditoria) NAO sao
-- tocados -- continuam referenciando o mesmo customer_id, agora anonimizado. Isso segue a orientacao da
-- secao 12 da execucao desta REF: "quando exclusao fisica nao for apropriada, avaliar anonimizacao,
-- documentando a decisao tecnica e qualquer dependencia juridica". O QUE e' anonimizado:
--   customers.name  -> 'Cliente removido'
--   customers.phone -> placeholder unico ('removido-' || 8+ chars do proprio id) -- nunca colide com o
--                      indice unico (store_id,phone) nem pode ser reivindicado por normalize_phone()
--   customers.email -> NULL
--   customers.auth_user_id -> NULL (desvincula da conta Auth; a pessoa pode logar de novo e criar um
--                      customer novo, mas nunca reaproveita o antigo -- telefone real ja foi apagado)
--   addresses       -> DELETE (dado pessoal puro, sem necessidade de retencao contabil/legal identificada)
--   loyalty_accounts/loyalty_events -> DELETE (beneficio pessoal; sem valor apos a identidade ser
--                      removida -- telefone anonimizado nunca mais bate em nenhuma busca)
--   orders/order_items/order_events -> INTOCADOS (integridade referencial + historico operacional +
--                      dependencia juridica/contabil sobre prazo de guarda de comprovantes, LGPD-R07)
--
-- DEPENDENCIA JURIDICA/DPO explicita (nao inventada, nao resolvida por esta migration): se a LGPD/
-- legislacao fiscal aplicavel exigir retencao de dados de PEDIDOS por um prazo minimo mesmo apos
-- solicitacao de exclusao do titular, e se esse prazo tornar necessario reter TAMBEM nome/telefone
-- dentro do proprio pedido (nao so' o customer_id), esta implementacao precisa ser revisada -- hoje ela
-- assume que o vinculo customer_id + snapshot de itens/valores no proprio pedido e' suficiente pra fins
-- contabeis, sem precisar do nome/telefone identificaveis no cadastro. Essa suposicao NAO foi validada
-- juridicamente.
--
-- Tres funcoes:
--   lgpd_anonymize_customer(uuid)              -- helper interno, SEM grant a anon/authenticated
--   lgpd_delete_my_data(text)                  -- self-service, exige auth.uid() + confirmacao explicita
--   admin_lgpd_delete_customer_data(uuid,uuid) -- assistido pelo admin da loja (is_admin_of)
--
-- Companion: REF-LGPD-01-onda1-r01-exclusao-anonimizacao-rollback.sql

BEGIN;

-- ===== helper interno (nao exposto via API -- so' chamado pelas duas funcoes publicas abaixo) =====
CREATE OR REPLACE FUNCTION public.lgpd_anonymize_customer(p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_placeholder_phone text := 'removido-' || substr(replace(p_customer_id::text, '-', ''), 1, 12);
BEGIN
  DELETE FROM public.addresses WHERE customer_id = p_customer_id;
  DELETE FROM public.loyalty_events WHERE customer_id = p_customer_id;
  DELETE FROM public.loyalty_accounts WHERE customer_id = p_customer_id;

  UPDATE public.customers
     SET name = 'Cliente removido',
         phone = v_placeholder_phone,
         email = NULL,
         auth_user_id = NULL
   WHERE id = p_customer_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.lgpd_anonymize_customer(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lgpd_anonymize_customer(uuid) FROM anon, authenticated;

-- ===== self-service: o proprio titular pede a remocao dos SEUS dados =====
-- Confirmacao explicita obrigatoria (p_confirmacao = 'EXCLUIR') -- acao destrutiva/irreversivel, nunca
-- deve disparar por engano (ex.: um clique automatizado ou um retry de rede). Anonimiza TODO customer
-- vinculado a este auth_user_id, em QUALQUER loja (a mesma pessoa pode ter conta em mais de uma).
CREATE OR REPLACE FUNCTION public.lgpd_delete_my_data(p_confirmacao text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rec record;
  v_total int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sessao invalida' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_confirmacao, '') <> 'EXCLUIR' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'confirmacao ausente -- envie p_confirmacao=''EXCLUIR'' para prosseguir');
  END IF;

  FOR v_rec IN SELECT id FROM public.customers WHERE auth_user_id = v_uid LOOP
    PERFORM public.lgpd_anonymize_customer(v_rec.id);
    v_total := v_total + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'contas_anonimizadas', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.lgpd_delete_my_data(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lgpd_delete_my_data(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.lgpd_delete_my_data(text) TO authenticated;

-- ===== assistido pelo admin: atende um pedido de exclusao recebido por outro canal (WhatsApp/telefone) =====
CREATE OR REPLACE FUNCTION public.admin_lgpd_delete_customer_data(p_customer_id uuid, p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_existe boolean;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissao');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.customers WHERE id = p_customer_id AND store_id = p_store_id
  ) INTO v_existe;
  IF NOT v_existe THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cliente nao encontrado nesta loja');
  END IF;

  PERFORM public.lgpd_anonymize_customer(p_customer_id);
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_lgpd_delete_customer_data(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_lgpd_delete_customer_data(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_lgpd_delete_customer_data(uuid, uuid) TO authenticated;

COMMIT;

-- Verificacao pos-aplicacao (rodar manualmente, ou via scripts/lgpd-01-r01-test.mjs):
-- 1) Como o proprio cliente (JWT do titular):
--    SELECT lgpd_delete_my_data();                  -- deve devolver ok:false (falta confirmacao)
--    SELECT lgpd_delete_my_data('EXCLUIR');          -- deve anonimizar e devolver ok:true
--    SELECT name, phone, email, auth_user_id FROM customers WHERE id = '<id anterior>';
--      -- name='Cliente removido', phone='removido-...', email/auth_user_id NULL
--    SELECT count(*) FROM addresses WHERE customer_id = '<id anterior>';  -- 0
--    SELECT count(*) FROM orders WHERE customer_id = '<id anterior>';    -- inalterado (historico preservado)
-- 2) Como admin de OUTRA loja, tentando anonimizar um customer que nao e' da sua loja:
--    SELECT admin_lgpd_delete_customer_data('<id de customer de outra loja>', '<minha loja>');
--      -- deve devolver ok:false, 'cliente nao encontrado nesta loja' (nunca vaza nem afeta linha alheia)
