# REF-MESA-01 — Onda 8: Reconciliação com REF-DELIVERY-FEE-05

**Status: CONCLUÍDA e testada no E2E. REF-MESA-02 continua bloqueada** até você validar/aprovar
esta reconciliação — não avancei para a Onda 2 da REF-MESA-02.

## 1. Conflito encontrado

Durante o precheck (Onda 1) da REF-MESA-02, descobri que `migrations/REF-DELIVERY-FEE-05-onda2-
adicional-pagamento.sql` (outra REF, outro autor — `ehfbrito`, 2026-09-04) reescreveu `create_order()`
e `admin_orders_search()` inteiros a partir da baseline de **produção** (que nunca teve Mesa
aplicada) e essa migration foi de fato aplicada, permanentemente, em produção **e** no banco de E2E
dedicado. Isso apagou toda a lógica de Mesa dessas duas funções no E2E — as colunas
`tipo_pedido`/`origem_pedido`/`mesa_identificador` continuavam existindo em `orders`, mas
`create_order()` parou de as ler/validar/persistir.

## 2. Causa raiz

Duas REFs independentes reescreveram a mesma função crítica (`create_order()`), cada uma partindo
de uma baseline diferente, sem se verem: a REF-MESA-01 nunca soube da REF-DELIVERY-FEE-05 (ainda
não existia quando a MESA-01 foi escrita); a REF-DELIVERY-FEE-05 partiu deliberadamente da baseline
de produção (que nunca teve Mesa), por instrução explícita do dono de "não antecipar Mesa fora do
escopo desta REF". Nenhuma das duas está "errada" isoladamente — o problema é estrutural: este
projeto usa `CREATE OR REPLACE FUNCTION` para SQL versionado (substitui o corpo inteiro, nunca faz
merge), e nenhuma das duas migrations sabia que a outra existia.

## 3. Baseline utilizada

O corpo **atual** de `create_order()`/`admin_orders_search()` — confirmado, por instrução explícita
do dono, como a única baseline válida (nunca uma versão histórica). Verifiquei por introspecção
read-only (`BEGIN; SET TRANSACTION READ ONLY; ...; ROLLBACK`, zero escrita) que esse corpo é
byte-a-byte idêntico entre (a) o que está realmente ao vivo em produção hoje e (b) o arquivo
`migrations/REF-DELIVERY-FEE-05-onda2-adicional-pagamento.sql` — confirmando que o git e a
produção estão consistentes nesse ponto específico.

## 4. Migration criada

- `migrations/REF-MESA-01-onda8-reconciliacao-delivery-fee-05.sql` + `-rollback.sql`.
- Reincorpora, por cima da baseline com `adicional_pagamento_fee`: declaração de
  `v_tipo_pedido`/`v_origem_pedido`/`v_mesa_identificador`/`v_mesa_cfg`; o bloco de capability de
  Mesa (`mesa_habilitada`/`mesa_canal_qr`/`mesa_canal_admin` + `is_admin_of` para `admin_garcom`),
  logo após resolver `v_store_id`; validação de valores permitidos de `tipo_pedido`/`origem_pedido`;
  a regra de endereço opcional para Mesa (`address` vira `'Mesa <identificador>'`); a troca do 2º
  argumento de `_resolve_delivery_fee` de `v_retirada` para `(v_tipo_pedido <> 'entrega')`; e as 3
  colunas de Mesa no `INSERT INTO orders`.
- `admin_orders_search()`: `RETURNS TABLE` passa a ter as 3 colunas de Mesa **e**
  `adicional_pagamento_fee` simultaneamente (nenhuma REF isolada tinha as duas). Precisou de
  `DROP FUNCTION` de novo (mudança de shape). `GRANT` restaurado para `TO PUBLIC` — reconferido ao
  vivo nos dois ambientes (produção e E2E) que é isso que está genuinamente em vigor hoje (o
  comentário da migration da REF-DELIVERY-FEE-05, que assumia `TO authenticated`, não bateu com a
  introspecção real feita agora; a autorização de verdade sempre foi o `is_admin_of()` dentro do
  corpo, nunca o `GRANT` de `EXECUTE`).

## 5. Comportamento restaurado (REF-MESA-01)

Idêntico, linha a linha, ao que a Onda 4/5 da REF-MESA-01 já tinham: capability por loja, canais QR/
Admin-garçom, validação de `tipo_pedido`/`origem_pedido`, endereço opcional para Mesa,
`_resolve_delivery_fee` recebendo `tipo_pedido<>'entrega'`, persistência das 3 colunas, propagação
para `admin_orders_search()`. Nenhuma mensagem de erro nova, nenhuma regra nova.

## 6. Comportamento da REF-DELIVERY-FEE-05 preservado

100% intocado: cálculo de `adicional_pagamento_fee` (via `_resolve_delivery_fee`, não tocada por
esta migration), checagem de divergência em centavos incluindo o novo campo, soma em `v_total`,
persistência em `orders.adicional_pagamento_fee`, e a mesma coluna em `admin_orders_search()`.
Confirmado que Mesa **automaticamente** fica isenta de `adicional_pagamento_fee` — sem nenhuma
mudança em `_resolve_delivery_fee` — porque `(v_tipo_pedido <> 'entrega')` entra no mesmo ramo
`IF p_retirada THEN RETURN {delivery_fee:0, maquininha_fee:0, adicional_pagamento_fee:0}` que já
zerava as taxas de Retirada. Isso é exatamente o que o cabeçalho da própria migration da
REF-DELIVERY-FEE-05-onda2 já antecipava ("quando a REF-MESA-01 for aplicada... o contrato já é
extensível por construção").

## 7. Testes MESA-01 (regressão completa, contra E2E)

| Suíte | Resultado |
|---|---|
| `mesa-01-onda1-fundacao-test.mjs` | 26/26 (era 14/25 quebrado antes da reconciliação) |
| `mesa-01-onda3-canal-qr-test.mjs` | 8/8 |
| `mesa-01-onda4-canal-admin-test.mjs` | 8/8 |
| `mesa-01-onda5-admin-orders-search-test.mjs` | 4/4 |
| `mesa-01-onda6-admin-reports-test.mjs` | 5/5 (1 assertion corrigida — ver §9) |
| `mesa-01-onda7-notificacoes-test.mjs` | 9/9 |
| `mesa-01-onda8-reconciliacao-test.mjs` (**novo**, intersecção Mesa × adicional_pagamento_fee) | 10/10 |

## 8. Testes REF-DELIVERY-FEE-05

`scripts/delivery-fee-05-onda1-onda2-test.mjs`: **29/29**, idêntico ao resultado antes da
reconciliação — nenhuma regressão introduzida.

## 9. Limitação residual encontrada e corrigida (não é regressão desta reconciliação)

`mesa-01-onda6-admin-reports-test.mjs`, caso B5, tinha um total hardcoded (`R$80`) que ficou
desatualizado pela introdução legítima de `adicional_pagamento_fee`: o fixture cria 1 pedido de
entrega pago em dinheiro, que agora corretamente ganha +R$2,00 (Retirada e Mesa continuam em R$0,
confirmado por B3/B4 do mesmo teste). Corrigi a expectativa para `R$82`, com comentário explicando
a origem da mudança — não mascarei a falha, investiguei a causa raiz antes de tocar no teste.

## 10. Status final do E2E

Todas as suítes relevantes verdes: **99/99** checks (26+8+8+4+5+9+10 da MESA-01 + 29 da
DELIVERY-FEE-05). `npm run test:domain` (JS, sem banco): verde, exit 0, zero falhas.

## 11. Commit

Um commit próprio (`ref(mesa-02): reconcilia REF-MESA-01 com REF-DELIVERY-FEE-05`), sem squash de
commits anteriores, sem alterar histórico, **sem push**.

## 12. Confirmação: produção NÃO foi alterada

A migration de reconciliação foi aplicada **somente** no projeto Supabase de E2E dedicado
(`db.e2e.env`, `bgzcrovskjbktdxkhemd`). Toda consulta a produção (`db.env`, `hvbcdxsagkjtfjwvnslo`)
nesta reconciliação foi estritamente `BEGIN; SET TRANSACTION READ ONLY; ...; ROLLBACK` — zero
escrita. Não rodei `git push` em nenhum momento.

## 13. Confirmação: REF-MESA-02 continua bloqueada

Esta Onda 8 é uma correção da REF-MESA-01, não parte da REF-MESA-02. Nenhuma tabela `mesa_sessions`,
nenhuma RPC nova de sessão/conta, nenhum código de frontend novo foi criado. A REF-MESA-02 permanece
no gate — aguardando sua validação desta reconciliação antes de eu iniciar a Onda 2
(`docs/ref/REF-MESA-02-auditoria.md`).
