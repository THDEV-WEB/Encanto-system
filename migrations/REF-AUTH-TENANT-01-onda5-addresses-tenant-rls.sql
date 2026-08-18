-- REF-AUTH-TENANT-01 — Onda 5: RLS/RPC de `addresses` usando o claim tenant_id
--
-- *** SÓ APLICAR NO PROJETO E2E POR ENQUANTO. NÃO APLICAR EM PRODUÇÃO. ***
-- Produção ainda tem o Custom Access Token Hook DESLIGADO (Onda 3) — se esta migration for aplicada
-- lá agora, `auth.jwt()->>'tenant_id'` nunca existe pra ninguém, e as 4 policies abaixo (que exigem
-- tenant_id IS NOT NULL) bloqueiam TODO acesso a `addresses` pra todo mundo. Aplicar em produção só
-- depois que o Hook estiver ligado lá também (decisão separada, fora desta onda).
--
-- Substitui as 4 policies da SEC-01 (customer_id -> auth.uid() sozinho, sem escopo de loja) pelas
-- policies que fecham o gap encontrado na revisão de SEC-02: mesma pessoa, 2 lojas legítimas, sessão
-- de UMA loja não pode enxergar/alterar dado da OUTRA, mesmo com customer_id/store_id manipulados —
-- porque a autorização não depende mais de nenhum parâmetro do client, só do claim assinado.
--
-- Regra em cada policy (SELECT/INSERT/UPDATE/DELETE, mesma forma): tenant_id precisa existir no JWT
-- E bater com addresses.store_id da PRÓPRIA linha E com o store_id do customer dono da linha. As 3
-- condições em conjunto: linha pertence ao tenant certo, dono pertence ao tenant certo, sessão está
-- no tenant certo. Sem tenant_id no JWT (Hook desligado, ou loja desativada — Hook já remove o claim
-- nesse caso) -> DENY em tudo, sem exceção (fail-closed, nunca cai pra "session sem tenant = acesso
-- livre").
--
-- save_structured_address ganha a MESMA disciplina: deriva store_id do customer validado (nunca de
-- um parâmetro), e quando há tenant_id no JWT exige coerência (o customer_id só é aceito se pertencer
-- à loja do tenant ativo) — sem tenant_id (Hook desligado hoje em produção), cai pro comportamento já
-- corrigido de sempre confiar em customers.store_id do customer_id validado, sem quebrar nada hoje.
--
-- admin_order_endereco/is_admin_of NÃO são tocadas — o Admin já tem seu próprio mecanismo correto
-- (Onda anterior desta REF confirmou: Admin não precisa de tenant claim, is_admin_of(store_id) já
-- resolve o caso de uso dele, gerenciar várias lojas na MESMA sessão é o comportamento pretendido).

BEGIN;

DROP POLICY IF EXISTS "addresses_select_own" ON public.addresses;
DROP POLICY IF EXISTS "addresses_insert_own" ON public.addresses;
DROP POLICY IF EXISTS "addresses_update_own" ON public.addresses;
DROP POLICY IF EXISTS "addresses_delete_own" ON public.addresses;

CREATE POLICY "addresses_select_tenant" ON public.addresses FOR SELECT TO authenticated
USING (
  (auth.jwt()->>'tenant_id') IS NOT NULL
  AND store_id = (auth.jwt()->>'tenant_id')::uuid
  AND customer_id IN (
    SELECT c.id FROM public.customers c
    WHERE c.auth_user_id = auth.uid() AND c.store_id = (auth.jwt()->>'tenant_id')::uuid
  )
);

CREATE POLICY "addresses_insert_tenant" ON public.addresses FOR INSERT TO authenticated
WITH CHECK (
  (auth.jwt()->>'tenant_id') IS NOT NULL
  AND store_id = (auth.jwt()->>'tenant_id')::uuid
  AND (
    customer_id IS NULL
    OR customer_id IN (
      SELECT c.id FROM public.customers c
      WHERE c.auth_user_id = auth.uid() AND c.store_id = (auth.jwt()->>'tenant_id')::uuid
    )
  )
);

CREATE POLICY "addresses_update_tenant" ON public.addresses FOR UPDATE TO authenticated
USING (
  (auth.jwt()->>'tenant_id') IS NOT NULL
  AND store_id = (auth.jwt()->>'tenant_id')::uuid
  AND customer_id IN (
    SELECT c.id FROM public.customers c
    WHERE c.auth_user_id = auth.uid() AND c.store_id = (auth.jwt()->>'tenant_id')::uuid
  )
)
WITH CHECK (
  (auth.jwt()->>'tenant_id') IS NOT NULL
  AND store_id = (auth.jwt()->>'tenant_id')::uuid
  AND customer_id IN (
    SELECT c.id FROM public.customers c
    WHERE c.auth_user_id = auth.uid() AND c.store_id = (auth.jwt()->>'tenant_id')::uuid
  )
);

CREATE POLICY "addresses_delete_tenant" ON public.addresses FOR DELETE TO authenticated
USING (
  (auth.jwt()->>'tenant_id') IS NOT NULL
  AND store_id = (auth.jwt()->>'tenant_id')::uuid
  AND customer_id IN (
    SELECT c.id FROM public.customers c
    WHERE c.auth_user_id = auth.uid() AND c.store_id = (auth.jwt()->>'tenant_id')::uuid
  )
);

CREATE OR REPLACE FUNCTION public.save_structured_address(p_address jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id uuid;
  v_customer_id uuid;
  v_tenant_id uuid;
  v_store_id uuid;
BEGIN
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RAISE EXCEPTION 'p_address ausente/invalido';
  END IF;

  v_tenant_id := NULLIF(auth.jwt()->>'tenant_id', '')::uuid;
  v_customer_id := NULLIF(btrim(p_address->>'customer_id'), '')::uuid;

  IF v_customer_id IS NOT NULL THEN
    -- Deriva store_id do PRÓPRIO customer validado (nunca de parâmetro do client). Quando há
    -- tenant_id no JWT, exige coerência extra: o customer precisa pertencer à loja do tenant ativo
    -- (sessão da Encanto não pode gravar endereço vinculado ao customer da Bar, mesmo sendo a MESMA
    -- pessoa nas duas). Sem tenant_id (Hook desligado, caso de produção hoje), cai pro comportamento
    -- já correto de confiar no customers.store_id do customer_id validado.
    SELECT c.store_id INTO v_store_id
    FROM public.customers c
    WHERE c.id = v_customer_id
      AND c.auth_user_id = auth.uid()
      AND (v_tenant_id IS NULL OR c.store_id = v_tenant_id);

    IF v_store_id IS NULL THEN
      v_customer_id := NULL; -- ownership ou coerencia de tenant falhou -> mesmo fallback silencioso de sempre (vira orfao)
    END IF;
  END IF;

  INSERT INTO public.addresses (
    customer_id, store_id, rua, numero, bairro, cidade, complemento,
    estado, cep, referencia, latitude, longitude,
    place_id, formatted_address, provider, confidence
  ) VALUES (
    v_customer_id, v_store_id,
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
