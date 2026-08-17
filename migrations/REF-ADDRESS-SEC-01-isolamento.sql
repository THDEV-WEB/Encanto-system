-- REF-ADDRESS-SEC-01 — Isolamento de public.addresses (nucleo de RLS + hardening do RPC)
-- Aprovado pelo dono em 2026-08-17 (nucleo + hardening juntos, um so commit de decisao).
-- Pre-requisito de seguranca da REF-ADDRESS-UX-01 (historico de enderecos, pausada ate esta fechar).
--
-- ACHADO (auditoria read-only, mesma data): a unica policy existente em public.addresses era
-- "Auth all addresses" FOR ALL TO authenticated USING (true) WITH CHECK (true) — sem isolamento
-- nenhum por customer_id/store_id. Combinado com grants diretos de SELECT/INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER pra authenticated, qualquer cliente autenticado (de qualquer loja)
-- podia ler/alterar/apagar/truncar o endereco de qualquer outro cliente de qualquer loja. anon nao
-- tem grant direto (so via RPC) — nao afetado.
--
-- ACHADO que simplifica a correcao: admin_order_endereco(p_order_id, p_store_id) (versao REALMENTE
-- publicada no banco, nao a do arquivo antigo em disco) ja e SECURITY DEFINER com is_admin_of(p_store_id)
-- checado internamente — ignora RLS por completo. Admin NAO precisa de policy nova nesta tabela;
-- deliberadamente NAO criamos uma (nem com is_admin_of, nem com is_admin() legado hardcoded p/ Encanto).
--
-- Modelo de autorizacao: customer_id (nunca store_id sozinho) identifica o dono. customer_id ja e
-- 1:1 por (pessoa, loja) na origem (customers.store_id NOT NULL, 1 linha por loja por pessoa) —
-- filtrar por customer_id via auth.uid() ja garante isolamento de tenant automaticamente.
--
-- NAO altera nenhuma linha de addresses. NAO preenche customer_id das 22 linhas legadas (todas ficam
-- inacessiveis por RLS apos esta migration — fail closed, intencional, documentado no relatorio
-- final). NAO toca store_id. Drift de store_id continua em REF-ADDRESS-STOREID-01.
--
-- Companion: REF-ADDRESS-SEC-01-isolamento-rollback.sql

BEGIN;

-- 1) Remove a policy insegura (unica existente)
DROP POLICY IF EXISTS "Auth all addresses" ON public.addresses;

-- 2) Grants minimos — authenticated nunca precisou de TRUNCATE/REFERENCES/TRIGGER. Critico: TRUNCATE
--    nao e filtrado por RLS de forma nenhuma (e operacao de tabela inteira, nao de linha) — sem este
--    REVOKE, qualquer autenticado poderia apagar a tabela inteira mesmo com as policies corretas.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.addresses FROM authenticated;

-- 3) Policies por operacao — cliente so enxerga/edita os PROPRIOS enderecos, via customer_id ->
--    customers.auth_user_id = auth.uid() (mesmo padrao ja usado em orders/order_events/loyalty_*).
CREATE POLICY "addresses_select_own" ON public.addresses
  FOR SELECT TO authenticated
  USING (customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid()));

CREATE POLICY "addresses_insert_own" ON public.addresses
  FOR INSERT TO authenticated
  WITH CHECK (customer_id IS NULL OR customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid()));

CREATE POLICY "addresses_update_own" ON public.addresses
  FOR UPDATE TO authenticated
  USING (customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid()))
  WITH CHECK (customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid()));

CREATE POLICY "addresses_delete_own" ON public.addresses
  FOR DELETE TO authenticated
  USING (customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid()));

-- 4) Indice de performance (a subquery de auth.uid()->customers roda em toda linha sem isso)
CREATE INDEX IF NOT EXISTS addresses_customer_id_idx ON public.addresses (customer_id);

-- 5) Hardening do RPC de escrita: save_structured_address hoje confia cegamente no customer_id que o
--    CLIENT manda no payload. A RLS acima ja bloqueia o vazamento de LEITURA/ALTERACAO/EXCLUSAO; isso
--    fecha o vazamento de ESCRITA (um client malicioso, chamando a RPC direto, nao consegue mais
--    gravar um endereco em nome do customer_id de outra pessoa). So aceita o customer_id se ele
--    pertencer de fato a sessao atual (auth.uid()); caso contrario grava NULL — mesmo comportamento
--    de hoje para visitante/convidado (nunca um fallback silencioso pra "outro" customer, so ausencia
--    de dono, que e exatamente o que ja acontece para 100% das gravacoes atuais). Assinatura, demais
--    campos e contrato de retorno IDENTICOS — nenhum call-site muda por causa desta parte.
CREATE OR REPLACE FUNCTION public.save_structured_address(p_address jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id uuid;
  v_customer_id uuid;
BEGIN
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RAISE EXCEPTION 'p_address ausente/invalido';
  END IF;

  v_customer_id := NULLIF(btrim(p_address->>'customer_id'), '')::uuid;
  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = v_customer_id AND c.auth_user_id = auth.uid()
  ) THEN
    v_customer_id := NULL;
  END IF;

  INSERT INTO public.addresses (
    customer_id, rua, numero, bairro, cidade, complemento,
    estado, cep, referencia, latitude, longitude,
    place_id, formatted_address, provider, confidence
  ) VALUES (
    v_customer_id,
    NULLIF(btrim(p_address->>'rua'), ''),
    NULLIF(btrim(p_address->>'numero'), ''),
    NULLIF(btrim(p_address->>'bairro'), ''),
    NULLIF(btrim(p_address->>'cidade'), ''),
    NULLIF(btrim(p_address->>'complemento'), ''),
    NULLIF(btrim(p_address->>'estado'), ''),
    NULLIF(btrim(p_address->>'cep'), ''),
    NULLIF(btrim(p_address->>'referencia'), ''),
    NULLIF(p_address->>'latitude', '')::double precision,
    NULLIF(p_address->>'longitude', '')::double precision,
    NULLIF(btrim(p_address->>'place_id'), ''),
    NULLIF(btrim(p_address->>'formatted_address'), ''),
    NULLIF(btrim(p_address->>'provider'), ''),
    NULLIF(btrim(p_address->>'confidence'), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

COMMIT;

-- Verificacao pos-aplicacao (rodar manualmente):
-- SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename='addresses';
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='addresses' AND grantee IN ('anon','authenticated') ORDER BY 1,2;
-- SELECT prosecdef FROM pg_proc WHERE proname='save_structured_address';
