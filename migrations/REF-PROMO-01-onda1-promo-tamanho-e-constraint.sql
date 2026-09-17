-- REF-PROMO-01 · Onda 1 -- preco promocional POR TAMANHO (server-side, autoritativo) + validacao de
-- integridade em products.preco_promo.
--
-- CONTEXTO (auditoria REF-PROMO-01): preco_promo (topo de products) ja e' 100% funcional ponta-a-ponta
-- para produto SIMPLES (sem tamanhos) desde REF-PRICE-SOURCE-01-onda1 -- Admin escreve, ProductCard/
-- ProductModalInner exibem, _resolve_item_pricing() recalcula no servidor. O que NAO existe: promocao
-- para produto COM tamanhos[] (ex.: "Encanto Casadinho" precisa de 2 opcoes -- "1 copo" e "2 copos" --
-- cada uma com seu proprio preco promocional). Hoje _resolve_item_pricing() resolve o preco do tamanho
-- selecionado SOMENTE por tamanhos[].preco, sem olhar promocao nenhuma.
--
-- CORRECAO (aditiva, zero mudanca de comportamento para tamanhos existentes): apos resolver v_base a
-- partir do tamanho selecionado (igual a hoje), passa a checar se ESSE MESMO objeto tamanho tambem tem
-- uma chave `preco_promo` valida e, se tiver, usa-a. Regra MAIS ESTRITA que o `<> 0` do produto simples
-- (que replica o `||` frouxo do JS legado, travado por golden test -- ver pricing.js/pin "base neg
-- mantem") -- aqui e' codigo NOVO, sem contrato congelado, entao usa `> 0 AND < preco do proprio
-- tamanho` desde o primeiro dia (mesma formula do novo helper src/utils/format.js:precoTamanhoEfetivo,
-- que faz o espelho exato no lado cliente -- garante preco EXIBIDO == preco COBRADO mesmo em caso de
-- dado corrompido/malicioso). Tamanho sem a chave `preco_promo` (100% dos tamanhos hoje em producao,
-- confirmado por introspecao antes desta migration) segue EXATAMENTE como antes -- `NULLIF(...,NULL)`
-- sempre da NULL quando a chave nao existe, o IF nunca entra.
--
-- Tambem re-emite o REVOKE EXECUTE de anon/authenticated (mesmo motivo documentado em
-- REF-PRICE-HARDENING-01: alguns projetos Supabase tem ALTER DEFAULT PRIVILEGES que re-concedem EXECUTE
-- a cada CREATE OR REPLACE FUNCTION -- reafirmar aqui custa nada e fecha qualquer reabertura silenciosa).
--
-- CONSTRAINT NOVA (validacao de integridade, Fase 4 da REF-PROMO-01): products.preco_promo nunca teve
-- CHECK nenhum -- Admin (AdminProducts.jsx) ja valida no client, mas nada impedia um preco_promo
-- negativo/zero/>=preco de chegar direto via API. Auditoria previa (SELECT ... WHERE preco_promo IS NOT
-- NULL AND NOT (preco_promo > 0 AND preco_promo < preco)) confirmou ZERO linhas violando esta regra em
-- producao -- constraint 100% segura de aplicar agora. NAO cobre tamanhos[].preco_promo (JSONB, sem
-- typmod possivel) -- validado no client (AdminProducts.jsx) e neutralizado no servidor pela mesma regra
-- estrita (`> 0 AND < preco do tamanho`) dentro de _resolve_item_pricing acima -- mesmo nivel de
-- confianca ja aceito hoje para tamanhos[].preco (tambem sem CHECK de banco, mesmo padrao arquitetural).
--
-- NAO ALTERA: create_order() (assinatura/corpo de _resolve_item_pricing preservados -- so o corpo
-- interno muda), RLS, grants de qualquer outra funcao, regra de adicionais/franquia gratis.

BEGIN;

CREATE OR REPLACE FUNCTION public._resolve_item_pricing(
  p_store_id     uuid,
  p_product_id   uuid,
  p_tamanho_label text,
  p_adicionais   jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_prod          record;
  v_tamanho       jsonb;
  v_base          numeric;
  v_tamanho_promo numeric;
  v_cota          numeric;
  v_usados_gratis int := 0;
  v_soma_ads      numeric := 0;
  v_ads_out       jsonb := '[]'::jsonb;
  v_ids_vistos    uuid[] := '{}';
  v_ad_elem       jsonb;
  v_ad_id         uuid;
  v_ad            record;
  v_eh_gratis     boolean;
  v_preco_ad      numeric;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'produto invalido';
  END IF;

  SELECT preco, preco_promo, tamanhos, adicionais_gratis
    INTO v_prod
    FROM public.products
   WHERE id = p_product_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    -- cobre: produto inexistente E produto de outra loja (mesma mensagem -- anti-enumeracao,
    -- mesmo padrao ja usado em 'loja invalida').
    RAISE EXCEPTION 'produto invalido';
  END IF;

  IF jsonb_typeof(v_prod.tamanhos) = 'array' AND jsonb_array_length(v_prod.tamanhos) > 0 THEN
    -- localiza por label (identificador REAL usado pelo client -- `id` nao existe em boa parte dos
    -- tamanhos reais); ausente/nao encontrado cai no 1o tamanho, igual ao fallback do client.
    SELECT t INTO v_tamanho
      FROM jsonb_array_elements(v_prod.tamanhos) t
     WHERE p_tamanho_label IS NOT NULL AND (t->>'label') = p_tamanho_label
     LIMIT 1;
    IF v_tamanho IS NULL THEN
      v_tamanho := v_prod.tamanhos->0;
    END IF;

    -- precoTamanho(t) = Number(t?.preco ?? t?.price) || 0  (format.js) -- 'preco' vence, 'price' e'
    -- tolerancia a legado; resultado 0/invalido cai no preco do produto (mesma regra do ProductModalInner).
    v_base := NULLIF(COALESCE((v_tamanho->>'preco')::numeric, (v_tamanho->>'price')::numeric), 0);
    IF v_base IS NULL THEN v_base := v_prod.preco; END IF;

    -- REF-PROMO-01: preco promocional POR TAMANHO (aditivo). Ativa so' quando > 0 E < preco cheio DESSE
    -- tamanho -- espelho exato de src/utils/format.js:precoTamanhoEfetivo (garante vitrine == cobranca
    -- mesmo com dado corrompido). Tamanho sem a chave `preco_promo` -> NULLIF(...,NULL) = NULL -> IF
    -- nunca entra -> comportamento IDENTICO ao de antes desta migration.
    v_tamanho_promo := NULLIF((v_tamanho->>'preco_promo')::numeric, NULL);
    IF v_tamanho_promo IS NOT NULL AND v_tamanho_promo > 0 AND v_tamanho_promo < v_base THEN
      v_base := v_tamanho_promo;
    END IF;

    v_cota := COALESCE((v_tamanho->>'adicionais_gratis')::numeric, v_prod.adicionais_gratis, 0);
  ELSE
    -- precoBaseItem(item) = Number(item.preco_promo || item.preco) (pricing.js) -- promo so' vence
    -- quando != 0 (0 e' falsy em JS, negativo NAO e' falsy -- preservado tal qual, INALTERADO nesta REF).
    v_base := CASE WHEN v_prod.preco_promo IS NOT NULL AND v_prod.preco_promo <> 0
                   THEN v_prod.preco_promo ELSE v_prod.preco END;
    v_cota := COALESCE(v_prod.adicionais_gratis, 0);
  END IF;

  IF p_adicionais IS NOT NULL AND jsonb_typeof(p_adicionais) = 'array' THEN
    FOR v_ad_elem IN SELECT value FROM jsonb_array_elements(p_adicionais) LOOP
      v_ad_id := NULLIF(btrim(v_ad_elem->>'id'), '')::uuid;
      IF v_ad_id IS NULL THEN
        RAISE EXCEPTION 'adicional invalido';
      END IF;
      IF v_ad_id = ANY(v_ids_vistos) THEN
        CONTINUE; -- dedupe: mesmo id 2x no payload conta 1x so' (replica o toggle() do client).
      END IF;
      v_ids_vistos := array_append(v_ids_vistos, v_ad_id);

      SELECT id, nome, tipo, preco, grupo, subgrupo_label INTO v_ad
        FROM public.adicionais
       WHERE id = v_ad_id AND store_id = p_store_id AND ativo = true;

      IF NOT FOUND THEN
        -- cobre: adicional inexistente, inativo, E de outra loja (mesma mensagem generica).
        RAISE EXCEPTION 'adicional invalido';
      END IF;

      -- ehAdicionalGratis(ad) = ad.tipo==='gratis' || Number(ad.preco)===0 (addons.js).
      v_eh_gratis := (v_ad.tipo = 'gratis' OR v_ad.preco = 0);
      IF v_eh_gratis THEN
        v_usados_gratis := v_usados_gratis + 1;
        IF v_usados_gratis <= v_cota THEN
          v_preco_ad := 0;
        ELSE
          -- resolverPrecoAdicionais: excedente usa Number(ad.preco) || ADICIONAL_SIMPLES_PRECO (2.00).
          v_preco_ad := CASE WHEN v_ad.preco <> 0 THEN v_ad.preco ELSE 2.00 END;
        END IF;
      ELSE
        v_preco_ad := v_ad.preco;
      END IF;

      v_soma_ads := v_soma_ads + v_preco_ad;
      v_ads_out := v_ads_out || jsonb_build_array(jsonb_build_object(
        'id', v_ad.id, 'nome', v_ad.nome, 'preco', v_preco_ad,
        'tipo', v_ad.tipo, 'grupo', v_ad.grupo, 'subgrupo_label', v_ad.subgrupo_label
      ));
    END LOOP;
  END IF;

  RETURN jsonb_build_object('preco_unitario', v_base + v_soma_ads, 'adicionais', v_ads_out);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._resolve_item_pricing(uuid,uuid,text,jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._resolve_item_pricing(uuid,uuid,text,jsonb) FROM PUBLIC;

-- Validacao de integridade: preco_promo (produto simples) nunca negativo/zero/>=preco. Auditoria previa
-- confirmou zero linhas violando em producao -- aplicavel sem backfill.
ALTER TABLE public.products
  ADD CONSTRAINT products_preco_promo_check
  CHECK (preco_promo IS NULL OR (preco_promo > 0 AND preco_promo < preco));

COMMIT;
