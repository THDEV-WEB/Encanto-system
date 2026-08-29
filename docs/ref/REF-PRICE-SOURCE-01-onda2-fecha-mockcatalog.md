# REF-PRICE-SOURCE-01 · Onda 2 — Fecha o caminho sem `product_id` (mockCatalog)

**Status: implementada e validada em E2E. NÃO aplicada em produção — aguarda aprovação/deploy.**
Onda anterior: `REF-PRICE-SOURCE-01-onda1-preco-autoritativo.md` (commit `faa0b61`).

## Objetivo desta onda

A Onda 1 fechou a autoridade de preço para itens **com** `product_id`, mas documentou uma exceção
consciente: item sem `product_id` continuava confiando no `price` do client — o mesmo caminho usado
pelo `mockCatalog.js`. Esta onda investiga esse caminho a fundo e fecha, sem criar uma exceção do tipo
"sem `product_id`, aceita o preço do cliente".

## Investigação (antes de qualquer código)

**1. Onde `mockCatalog` é usado:** `useProducts.js`, `useCategories.js`, `useAdicionais.js` (todos os
três hooks de catálogo) e `AdminProducts.jsx` — todos caem no mock quando `DS.get*()` retorna `null`
(erro/offline) **ou** quando a resolução de loja por domínio falhou/expirou.

**2. Por que a resolução pode falhar sem o resto do Supabase estar offline:**
`StorefrontProvider.jsx` chama `get_store_by_domain(hostname)` com `Promise.race` contra `RPC_TIMEOUT`.
Qualquer erro, timeout, ou resposta vazia/inesperada **dessa única RPC** emite
`emitStorefrontResolved(false)` — o resto do Supabase (auth, `create_order`, etc.) continua
100% operacional. `storefrontResolvedBus.js` documenta isso explicitamente.

**3. Confirmação de código de que nada bloqueava o checkout:** `StoreApp.jsx` extrai `catSrc`/`prodSrc`
dos hooks (`useCategories`/`useProducts`) mas **nunca os lê** — confirmado pelo próprio `eslint`
(`'catSrc'/'prodSrc' is assigned a value but never used`, presente desde antes desta REF). Nenhum
componente usava esse sinal para desabilitar o checkout.

**4. Prova empírica (não apenas leitura de código):** teste Playwright real
(`e2e/tests/checkout/_prova-mock-catalog.spec.js`, descartado após a prova) que:
- Intercepta `**/rest/v1/rpc/get_store_by_domain*` via `page.route(...).abort('failed')` — simula
  exatamente o cenário do achado #2, sem tocar mais nada do Supabase.
- Navega, adiciona `MOCK_PRODS['pd1']` ("Marmita Média + Açaí 300 ml", preço no mock: R$29,90 — produto
  que **não existe** em `products`), preenche e finaliza o checkout.
- **Resultado, contra o código da Onda 1**: chegou à tela "Pedido realizado com sucesso!" e um pedido
  REAL foi persistido no banco: `{"id":"...", "total": 29.9}`.

Conclusão da investigação: **não é fallback visual — participa efetivamente da criação de um pedido
financeiro real.** Precisava ser fechado.

## Solução adotada

`create_order()` passa a **exigir `product_id` válido (uuid, produto existente na loja) em todo item,
sem exceção**. Removido o branch "sem `product_id`, confia no `price` do client" que a Onda 1 havia
preservado. Item sem `product_id` (ausente, `null`, formato inválido, ou uuid que não resolve a nenhum
produto da loja) → **pedido inteiro rejeitado**, mesma mensagem/padrão fail-closed já usado para
produto inexistente/de outro tenant (anti-enumeração).

Reexecutei o mesmo teste de prova contra o código desta onda: `chegouAoSucesso: false` — o servidor
rejeita. A autoridade financeira do preço agora está 100% fechada no servidor, sem exceção nenhuma.

**Camada complementar (UX, não é a proteção em si)**: novo hook `src/hooks/useCatalogoConfiavel.js`
(mesmo sinal de `storefrontResolvedBus` já consumido por `useProducts`/`useCategories`/`useAdicionais`)
integrado em `CheckoutPage.jsx` no mesmo padrão visual/estrutural já usado para "loja fechada" —
desabilita o botão de finalizar e mostra aviso claro ("Não foi possível confirmar o catálogo agora")
quando o catálogo não veio do banco. Evita que o cliente preencha todo o formulário só para ver um
erro genérico no fim; **quem fecha a vulnerabilidade de verdade é a migration**, não este gate (que
pode ser contornado por qualquer chamada direta à API — o servidor não pode).

## Não foi criada exceção nenhuma

Todo item, em todo caminho, agora exige `product_id` resolvido pelo servidor. Não existe mais um
"se X então confia no client" para preço.

## Regra de segurança preservada

`resolve_store_from_origin()`, `tenant_id`, `is_admin_of()`, `is_super_admin()`, RLS, grants — nada
disso foi tocado. A mudança está inteiramente contida no loop de itens de `create_order()`.

## Testes obrigatórios do contrato (10 casos pedidos + fidelidade/relatórios)

`scripts/price-source-01-onda2-test.mjs` — contra o banco E2E dedicado, 2 rodadas, **15/15 PASS** em
ambas:

1. `product_id` válido → aceito, preço autoritativo do banco.
2. `product_id` ausente (chave nem enviada) → rejeitado; nenhum pedido persistido.
3. `product_id = null` explícito → rejeitado.
4. `product_id` em formato inválido (não-uuid) → rejeitado.
5. Produto inexistente (uuid válido, sem linha) → rejeitado (`produto invalido`).
6. Produto de outro tenant → rejeitado (mesma mensagem — anti-enumeração).
7. Preço adulterado **com** `product_id` válido → servidor usa o preço do banco, ignora o do client.
8. Total adulterado **com** `product_id` válido → servidor recalcula.
9. Combinação: ausência de `product_id` + preço adulterado → rejeitado; nenhum pedido, nenhum
   `loyalty_event` persistido.
10. Combinação: ausência de `product_id` + total adulterado → rejeitado; nenhum pedido persistido.
    + Fidelidade: pedido válido (`product_id` ok) continua contabilizando 1 `loyalty_event` normalmente
    — confirma que a rejeição dos casos acima não tem efeito colateral no caminho feliz.

`scripts/price-source-01-onda1-test.mjs` (atualizado) — 16/16 PASS, 2 rodadas: os 15 casos da Onda 1
continuam idênticos; o caso que documentava o comportamento legado ("sem `product_id` confia no
client") foi invertido para confirmar que agora é **rejeitado**.

## Adaptação dos testes de outras REFs (não apagados — investigados e corrigidos)

`scripts/harden-orders-rls-test.mjs` (AC1/AC2) e `scripts/saas01-onda4-1-pedidos-test.mjs`
(CHECKOUT-P1/P2) usavam item "avulso" sem `product_id` só para exercitar RLS/ACL/idempotência e
isolamento multi-tenant/fidelidade — **nunca testaram catálogo**. Adaptados para inserir um produto
real **dentro da mesma transação `BEGIN...ROLLBACK`** (nunca persiste), com o **mesmo preço** que cada
teste já esperava (`10.00`, `33.00`, `44.00`) — preserva as asserções originais sem depender do
comportamento removido.

Validação da adaptação (esses 2 scripts rodam contra **produção**, e produção — achado incidental da
Onda 1 — já rejeita ambos hoje por falta de simulação do header `Origin`, dívida de
`REF-ORDER-TENANT-01`, não desta REF): rodei os dois scripts adaptados contra produção
(`BEGIN...ROLLBACK`, net-zero) e confirmei que o resultado é **idêntico** ao de antes da adaptação —
mesmo `PASS`/`FAIL` (`14/2` e `50/2`), mesma causa (`'loja nao identificada'`) — ou seja, a adaptação
não introduziu nenhum erro novo. Para confirmar que a adaptação **funciona** quando o Origin está
presente, reproduzi manualmente o payload adaptado contra o banco E2E com
`SET LOCAL request.headers` simulando o `Origin` real: `{"ok":true,"order_id":"..."}` — confirma a
mecânica.

## Fidelidade e relatórios

Não alterados. Validado no `scripts/price-source-01-onda2-test.mjs`: pedido rejeitado por
`product_id` ausente/inválido não gera `orders`, `order_items`, nem `loyalty_events` (nenhum evento
órfão); pedido válido continua concedendo 1 selo normalmente. Como nenhum pedido com preço não
autoritativo chega a ser persistido, relatórios (`admin_reports_summary`/`admin_orders_stats`)
automaticamente nunca veem esses dados — arquitetura de relatórios intocada.

## Situação do `mockCatalog.js`

Decisão desta onda: **manter o mock como está** (opção B da lista de possibilidades — permanece só
para navegação/testes), sem remover nem substituir por dados neutros. Justificativa: com esta migration
aplicada, o mock não consegue mais participar da criação de nenhum pedido financeiro real — sua função
passou a ser exclusivamente a original (fallback de navegação/exibição quando o backend está
indisponível), sem risco financeiro. Remover os preços do mock ou trocá-los por um estado
"indisponível" segue como melhoria de UX possível (evitar mostrar preços que nunca serão cobrados
exatamente assim), não uma necessidade de segurança — registrada como possível Onda 3, não decidida
aqui por não ser mais uma questão de fonte de verdade financeira.

## Testes de regressão executados

- `test:domain` (suíte de domínio completa, node puro): verde, exit 0.
- `lint`/`typecheck`/`build`/`build:admin`: verdes, sem erros novos (mesmas 55 warnings pré-existentes).
- `git diff --check`: sem problemas.
- Suíte E2E Playwright **completa** (136 testes, 48 arquivos, `--project=chromium`): ver resultado no
  commit desta onda.

## Relação com a Onda 1

Não desfaz nada da Onda 1 — é estritamente mais restritiva (remove uma exceção que a Onda 1 havia
preservado deliberadamente, agora provada perigosa). O rollback desta onda restaura exatamente o
comportamento da Onda 1 (não o pré-Onda-1).

## Limitações restantes (fora do escopo desta onda, não resolvidas)

- `delivery_fee`/`maquininha_fee` seguem sem validação server-side (achado documentado desde a
  auditoria original).
- UX de "preço mudou desde que você adicionou ao carrinho" (aviso ao cliente) — não implementada.
- `NUMERIC(10,2)` nas colunas monetárias sem escala fixa — achado separado, não tocado.
- `saas01-onda4-1-pedidos-test.mjs`/`harden-orders-rls-test.mjs` continuam falhando em produção por
  falta de simulação de `Origin` — dívida de outra REF, não corrigida aqui (achado incidental,
  registrado por transparência).
