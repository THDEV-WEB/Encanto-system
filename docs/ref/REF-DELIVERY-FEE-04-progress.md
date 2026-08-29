# REF-DELIVERY-FEE-04 — Proteção financeira do delivery_fee/maquininha_fee

## Onda 1 — delivery_fee/maquininha_fee autoritativos no servidor

**Status: implementada, testada em E2E, commit local `4fdc1ad`. Não aplicada em produção.**

### Achado

`create_order()` aceitava `delivery_fee`/`maquininha_fee` direto do client, validando só `>= 0` —
nenhuma reconciliação contra `get_delivery_fee_config` nem contra a distância real do endereço.
Mesma classe de vulnerabilidade que `REF-PRICE-SOURCE-01` já fechou para preço de item/produto,
deixada de fora daquelas ondas de propósito. Achado durante a auditoria do P5
(`REF-STORE-ONBOARD-02`).

### Correção

Nova função interna `_resolve_delivery_fee(store_id, retirada, payment_method, endereco_id)`,
espelhando fielmente a regra já existente no frontend (`services/delivery/deliveryFeeRules.js`).
Servidor sempre vence, mesmo princípio de `_resolve_item_pricing`:
- `retirada=true` → `delivery_fee=0` e `maquininha_fee=0`, incondicional.
- `maquininha_fee` → sempre recalculado via `get_delivery_fee_config` (puro lookup).
- `delivery_fee` com `endereco_id` válido → haversine em SQL puro contra
  `company_info.lojaLat/lojaLng`, aplica a faixa real.
- `delivery_fee` sem `endereco_id` válido/de outra loja/sem coordenadas → forçado a `0` (decisão do
  dono: mesmo fallback que o client honesto já calcularia via `montarResumoFinanceiro`).

Novo campo de payload: `p_order.retirada` (opcional, ausente cai em `false`).

**Ressalva conhecida e aceita**: servidor usa haversine (distância reta); client mostra rota viária
real (HeiGIT, `REF-DELIVERY-FEE-03`). Perto de uma fronteira de faixa o valor pode divergir
ligeiramente do exibido no checkout — motivou a Onda 2.

### Testes

`scripts/delivery-fee-04-onda1-test.mjs` — 13 casos × 2 rodadas (retirada, maquininha
ligada/desligada/sem cartão, entrega perto/longe/fora-de-alcance com fee forjado, sem endereço,
endereço sem coordenadas, endereço de outra loja, cobrança desligada, isolamento entre lojas).
Regressão limpa: `PRICE-SOURCE-01` onda1 (16/16) + onda2 (15/15), `test:domain`, lint, typecheck,
build, build:admin, E2E completo 136/136.

## Onda 2 — transparência do valor recalculado

**Status: implementada, testada em E2E, commit local separado (ver abaixo). Não aplicada em
produção, não pushada.**

### Achado

`create_order()` (Onda 1) sempre recalculava `delivery_fee`/`maquininha_fee` no servidor, mas
persistia o pedido numa única chamada mesmo quando o valor recalculado divergia do exibido ao
cliente (ressalva haversine vs. rota viária, acima). O cliente nunca ficava sabendo que o valor
final mudou — uma "correção silenciosa".

### Correção

Depois de `_resolve_delivery_fee` (autoritativo já calculado) e ANTES de qualquer `INSERT`
(`customers`/`orders`/`order_items`), `create_order` compara o que o client **declarou** (se
declarou) contra o autoritativo — **comparação em centavos inteiros** (`round(valor*100)::bigint`),
nunca uma tolerância arbitrária (`utils/pricing.js` já documenta esse princípio: proibido
`Number.EPSILON`/fudge factor, divergência se resolve modelando o domínio — aqui, a unidade
monetária correta).

```sql
if (p_order ? 'delivery_fee' and round(coalesce((p_order->>'delivery_fee')::numeric,0)*100) <> round(v_delivery_fee*100))
   or (p_order ? 'maquininha_fee' and round(coalesce((p_order->>'maquininha_fee')::numeric,0)*100) <> round(v_maquininha_fee*100))
then
  return jsonb_build_object('ok', false, 'error', 'valor da entrega foi atualizado, confirme novamente',
    'divergencia_valor', true, 'delivery_fee', v_delivery_fee, 'maquininha_fee', v_maquininha_fee);
end if;
```

Só compara quando o client **declarou** o campo — ausência (chamador legado/script antigo) preserva
o comportamento da Onda 1 (correção silenciosa), sem regressão de segurança: o valor PERSISTIDO
continua sempre o autoritativo, a checagem é só sinalização de UX.

Por construção, nenhum efeito colateral (trigger `notification_outbox`, `loyalty_grant`) pode ocorrer
numa tentativa divergente — ambos só rodam depois do `INSERT INTO orders`, que a checagem intercepta
antes.

### Contrato da RPC (aditivo, retrocompatível)

`ok:false` + `divergencia_valor:true` + `delivery_fee`/`maquininha_fee` autoritativos. Qualquer
chamador antigo que só cheque `res.ok` trata como falha genérica (nunca cria pedido) — mesmo
tratamento já existente. `DS.savePedido` (único consumidor de `create_order` no client, confirmado
por grep) passa a retornar `{ orderId, divergencia, deliveryFee, maquininhaFee }` em vez de
`orderId|null`.

### Frontend (`CheckoutPage.jsx`)

Novo estado `divergencia`. Quando `DS.savePedido` sinaliza divergência: banner inline (âmbar, tom
informativo, não de erro) com `buildDivergenciaView` (`orderPayload.js`, reaproveita `fmt()` — G-CK2)
mostrando o que mudou ("Para garantir o valor correto, atualizamos o valor de entrega de R$X para
R$Y."); botão muda para "Continuar com novo valor • R$ novo total". Ao confirmar, `submit()` roda de
novo com o MESMO `requestIdRef` — mas desta vez **declara os valores autoritativos** (não o `resumo`
local, que gerou a divergência) — o servidor recalcula do zero de qualquer forma; só muda o que o
client afirma esperar.

### Testes

`scripts/delivery-fee-04-onda2-test.mjs` (novo) — 16/16 cenários pedidos × 2 rodadas: valor
igual/menor/maior, confirmação com valor autoritativo, recusa (nenhum pedido), 2ª tentativa
adultera de novo, maquininha divergente sozinha, delivery+maquininha juntos, retirada honesta (sem
divergência indevida), endereço inválido/de outra loja, cross-tenant, fidelidade (0 eventos na
divergência, exatamente 1 na confirmada), notificação (`notification_outbox` vazio na divergência),
idempotência/retry (mesmo `request_id` não duplica), manipulação de total (sempre ignorado,
regressão). `scripts/delivery-fee-04-onda1-test.mjs` adaptado — os 12 casos que forjam valor viram
fluxo de 2 chamadas (1ª espera divergência sem persistir, 2ª confirmada cria o pedido) — 26/26 × 2
rodadas. `tests/checkout.golden.mjs` — pin de fonte atualizado (`resumoEnvio`).

Regressão: `PRICE-SOURCE-01` onda1/onda2 intactos, `saas01-onda4-1`/`harden-orders-rls` só com as 2
falhas pré-existentes já documentadas (Origin, outra REF). `test:domain`, lint, typecheck, build,
build:admin verdes. E2E completo: 2 rodadas rodadas — a 1ª teve 40 falhas amplas e não relacionadas
(até specs de boot/catálogo, nada delivery-fee), com erro real `net::ERR_CONNECTION_REFUSED` —
instabilidade do servidor de dev local sob invocações repetidas do Playwright nesta sessão (muitos
runs consecutivos), não regressão de código. 2ª rodada limpa: 133/136 passaram, 2 falhas isoladas
confirmadas como rate-limit autoinfligido (`create_order`, 60/10min, de tantos runs seguidos) +
flakiness de timing num teste de popup do WhatsApp — ambos reexecutados sozinhos e passaram
(8/8).

### Escopo deliberado — o que NÃO mudou

Preço de item/produto (`REF-PRICE-SOURCE-01`) continua correção silenciosa — divergência é só
`delivery_fee`/`maquininha_fee`. `_resolve_delivery_fee`/`_resolve_item_pricing` intocados. Nenhuma
mudança em RLS/tenant/WhatsApp/onboarding. Sem produção, sem push nesta rodada.

## Próximos passos (fora desta REF, não implementados)

1. Aplicar Onda 1 + Onda 2 em produção (aguarda aprovação/deploy separados).
2. Upgrade do haversine para rota viária real dentro do servidor — avaliado, não recomendado (exigiria
   chamada HTTP de dentro do Postgres, ganho marginal frente ao risco).
