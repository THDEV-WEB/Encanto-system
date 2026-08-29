# REF-PRICE-SOURCE-01 · Onda 1 — Preço autoritativo no pedido

**Status: implementada e validada em E2E. NÃO aplicada em produção — aguarda aprovação/deploy.**

## Causa raiz

`create_order()` (RPC `SECURITY DEFINER` que persiste o pedido) confiava no `price`/`preco_unitario`
de cada item exatamente como o navegador enviava, validando só `price > 0`. Nenhuma reconciliação
contra `products.preco`/`preco_promo`/`tamanhos[].preco` no servidor. `orders.total` tinha o mesmo
problema — vinha cru de `p_order->>'total'`. Achado da auditoria (`REF-PRICE-SOURCE-01-auditoria.md`),
mesma classe de vulnerabilidade já fechada para `store_id` (`REF-ORDER-TENANT-01`).

## Regra server-side adotada

Nova função `public._resolve_item_pricing(store_id, product_id, tamanho_label, adicionais)` (interna —
`SECURITY DEFINER`, `REVOKE ... FROM PUBLIC`, sem grant a `anon`/`authenticated`; só chamável de dentro
de `create_order()`), chamada uma vez por item **quando `product_id` está presente**. Reproduz
fielmente a regra já existente no frontend (`src/utils/pricing.js`, `src/utils/addons.js`,
`ProductModalInner.jsx`, `format.js`) — nada de regra nova:

- **Produto simples**: `preco_promo` vence sobre `preco` só quando `preco_promo IS NOT NULL AND <> 0`
  (replica `preco_promo || preco` do JS — `0` cai no preço cheio, negativo NÃO cai).
- **Produto com `tamanhos[]`**: preço do tamanho casado por **`label`** (não por `id` — confirmado por
  introspecção direta do banco de produção que boa parte dos produtos reais tem tamanhos só com
  `label`+`preco`, sem `id`; o próprio componente React compara por `label`). Ausente/não encontrado
  cai no 1º tamanho (mesmo fallback do client: `tamanho||prod.tamanhos[0]`); preço do tamanho
  `0`/inválido cai no `preco` do produto.
- **Adicionais**: cada `id` do array enviado (na ORDEM de seleção do cliente — dado de escolha, não
  financeiro) é rebuscado em `public.adicionais` por `id+store_id+ativo=true`; o preço/tipo usado é
  **sempre** o da tabela, nunca o do payload. Franquia grátis: os N primeiros "tipo grátis-ou-preço-0",
  na ordem de seleção, custam `0` (N = `tamanho.adicionais_gratis ?? products.adicionais_gratis ?? 0`);
  excedentes usam o preço próprio ou `R$2,00` (`ADICIONAL_SIMPLES_PRECO`, `src/utils/addons.js:75`)
  quando o próprio preço é `0`. Mesmo `id` repetido no payload conta 1x só (dedupe pela 1ª ocorrência —
  replica o `toggle()` do client). Adicional inexistente/inativo/de outra loja → **pedido inteiro
  rejeitado**.
- **`orders.total`**: deixou de vir de `p_order->>'total'` — é sempre `Σ(preço_unitário autoritativo ×
  quantity)` de todos os itens + `delivery_fee` + `maquininha_fee` (essas duas seguem sem validação
  server-side, fora de escopo — ver seção "Fora de escopo").

Produto/adicional inexistente ou pertencente a outra loja → `RAISE EXCEPTION` capturada pelo bloco
`exception` já existente de `create_order()` (mesmo padrão de log em `application_logs` e retorno
`{ok:false, error, sqlstate}` de todo erro da função).

## Escopo deliberado — o que NÃO mudou (decisão consciente, não lacuna esquecida)

**Item sem `product_id`** (ausente ou não-uuid) continua usando o `price` do client, exatamente como
antes. Descoberto durante a implementação: dois testes de regressão de **outras REFs**, já em
produção — `scripts/saas01-onda4-1-pedidos-test.mjs` e `scripts/harden-orders-rls-test.mjs` — chamam
`create_order()` com itens sem `product_id` e dependem desse caminho continuar aceitando o preço
enviado. "Não alterar outras REF" era instrução explícita desta onda, então a nova autoridade se
aplica **somente quando há `product_id` válido para consultar no banco** — é também o caminho que
`src/data/mockCatalog.js` usa (ids não-uuid → `product_id: null`, `src/utils/ids.js:isUuid`).

**Consequência para o achado do mockCatalog** (pedido explícito desta onda — investigar, não corrigir
automaticamente): a nova autoridade **não fecha completamente** o vetor do mock. Um pedido com item
vindo do catálogo mock (fallback offline/falha de resolução de loja) ainda tem seu preço aceito do
client, porque não há `product_id` real para consultar. Registrado como **Onda 2 proposta** — fechar
isso exige decidir se aceitar item sem `product_id` é um caso de uso legítimo do sistema (e então
precisaria de outro mecanismo de preço) ou se deve deixar de existir (quebraria os 2 testes acima e
possivelmente uma funcionalidade real ainda não identificada); fora do escopo "preço autoritativo".

**Curadoria de adicionais** (`CAT_ADDON_GROUP`, whitelist textual `MARMITA_PERMITIDOS` em
`src/utils/addons.js`) não foi replicada — é regra de *o que a UI oferece para qual produto*, não de
*preço*; o próprio `addons.js` documenta essa whitelist como dívida ("frágil a rename"). O que importa
financeiramente (preço/tipo de cada adicional e a cota de franquia) sempre vem da tabela.

**`delivery_fee`/`maquininha_fee`** seguem sem validação server-side — achado conhecido e já
documentado separadamente na auditoria, mesma família do que `REF-DELIVERY-FEE-02` corrigiu para a
taxa em si; explicitamente fora do escopo desta onda.

## Mudança de contrato do payload

`p_items[].tamanho_label` (novo campo, opcional): identifica QUAL tamanho foi escolhido — nunca o
preço em si. Derivado inteiramente em `src/utils/orderPayload.js` (função pura, sem tocar
`ProductModalInner.jsx`/`useCart.js`): casa o `preco` já resolvido do item do carrinho com
`tamanhos[].preco` (via `precoTamanho`, tolerante a `preco`/`price` legado). Funciona tanto para itens
novos quanto para itens de carrinho já persistidos no `localStorage` antes desta REF (ambos guardam
`tamanhos` completo + `preco` do tamanho escolhido). Sem correspondência → `null`, servidor cai no 1º
tamanho.

## Admin

Intocado. `Admin → DataService → products → banco` continua sendo o único caminho de escrita de
preço; a nova autoridade só afeta a **leitura** feita por `create_order()` no momento do pedido —
lê exatamente o que o Admin gravou por último, dentro da mesma transação.

## Carrinho

Não foi alterado — continua guardando o preço no momento da adição (snapshot local, `localStorage`,
TTL 12h), usado só para **apresentação** (resumo do checkout). A partir desta onda, esse valor deixou
de ter qualquer peso financeiro quando o item tem `product_id`: o servidor sempre recalcula do banco
no momento do pedido. Se o preço mudou enquanto o item estava no carrinho, o cliente **paga o preço
atual do banco**, não o que via na tela — investigado o padrão existente (não havia nenhuma
reconciliação antes) e essa foi a opção adotada (preço do banco prevalece), em vez de bloquear o
checkout com erro explícito de "preço mudou" — decisão alinhada ao mesmo princípio já usado para
`delivery_fee`/tamanho/promoção neste sistema (nunca travar o checkout por divergência, sempre usar o
valor correto). Registrado, não escondido: não há aviso ao cliente quando isso acontece — possível
melhoria de UX para uma onda futura, fora do escopo financeiro desta.

## Fidelidade

Não alterada. `loyalty_grant(customer_id, order_id)` roda depois do `INSERT` de `orders`/`order_items`
(já com os valores autoritativos persistidos) — o selo é concedido sobre o pedido real, nunca sobre um
valor manipulado. Validado em E2E real (`e2e/tests/cliente/fidelidade.spec.js`,
`e2e/tests/admin/admin-fidelidade.spec.js`, 8/8 verde).

## Relatórios

Não alterada a arquitetura (`admin_reports_summary`/`admin_orders_stats` continuam lendo
`orders`/`order_items` direto). Como esses valores agora são sempre autoritativos, os relatórios
passam a refletir o valor correto automaticamente. Validado em E2E real
(`e2e/tests/admin/admin-relatorios.spec.js`, `admin-dashboard.spec.js`).

## Efeito colateral nos fixtures de teste E2E (ajuste necessário, não regressão)

`e2e/support/fixture-order.js` (`criarPedidoAvulso`) usava um total **fictício** (R$12,50) com
`product_id` de um produto real cujo preço no banco é R$15,99 — só "funcionava" porque o servidor
confiava cegamente no total do client, exatamente o que esta onda corrige. Ajustado para R$15,99
(preço real), junto com os 2 specs que verificavam o valor exato:
`e2e/tests/admin/admin-relatorios.spec.js` e `e2e/tests/admin/admin-pedidos-lista.spec.js`. Não é
alteração de lógica de outra REF — é consequência direta e correta da correção (o fixture dependia do
próprio bug sendo corrigido).

## Descoberta incidental (não introduzida por esta onda, registrada por transparência)

`scripts/saas01-onda4-1-pedidos-test.mjs` (CHECKOUT-P1/P2) e `scripts/harden-orders-rls-test.mjs`
(AC1/AC2) — testes de regressão de outras REFs — **já falham hoje em produção**, antes de qualquer
mudança desta onda: ambos chamam `create_order()` sem simular o header `Origin`, e desde
`REF-ORDER-TENANT-01` o checkout guest sem `Origin` reconhecido retorna `'loja nao identificada'`
(fail-closed). Confirmado rodando os dois scripts originais (sem minha migration aplicada) contra
produção via `BEGIN...ROLLBACK`: ambos já retornam esse erro. Dívida de infraestrutura de teste de
outra REF, fora do escopo desta onda — não corrigida aqui.

## Testes de manipulação (E2E — banco dedicado, nunca produção)

`scripts/price-source-01-onda1-test.mjs` — 16 casos, cada um em `BEGIN...ROLLBACK` isolado, contra o
projeto Supabase dedicado a E2E, com `set_config('request.jwt.claims', ...)` simulando `tenant_id`
assinado (mesmo padrão de `scripts/prod-golive-01-tenant-fix-test.mjs`). Rodado **2 vezes** — 16/16
PASS em ambas as rodadas:

1. Preço normal (client = banco) → aceito.
2. Client tenta pagar menos → servidor grava o preço do banco, nunca o do client.
3. Client tenta pagar mais → idem.
4. Preço negativo/zero do client (com `product_id`) → irrelevante, servidor recalcula.
5. `product_id` inexistente → rejeitado (`produto invalido`).
6. Produto de outra loja → rejeitado (mesma mensagem — anti-enumeração).
7. Produto com tamanhos: `tamanho_label` manipulado junto com `price` mentiroso → servidor usa o
   preço do tamanho pedido, nunca o preço base nem o valor do client. (7b) `tamanho_label` ausente →
   cai no 1º tamanho.
8. Promoção: `preco_promo` vence sobre `preco` cheio e sobre qualquer valor do client.
9. Adicionais: preço vem sempre da tabela, nunca do payload — inclui franquia grátis dentro da cota,
   excedente (`ADICIONAL_SIMPLES_PRECO`), dedupe de id repetido, e rejeição de adicional de outra loja.
10. Adulteração simultânea de `price`+`preco_unitario`+`total` → servidor determina os 3 valores.
    + Regressão consciente: item sem `product_id` continua confiando no `price` do client.

**E2E via UI real (Playwright, `.env.e2e`)** — 58/58 specs verdes, cobrindo toda a área tocada:
checkout guest/logado/WhatsApp (7), dashboard/relatórios/lista/carrinho/catálogo (25), pedidos-admin
restantes (busca/status/histórico/mensagens/comanda/escala) + fidelidade cliente/admin (26).

**Suíte de domínio** (`npm run test:domain`, node puro) — 100% verde, exit 0, incluindo
`checkout.golden.mjs` atualizado (novo campo `tamanho_label` no `GOLDEN_PAYLOAD` + 4 checks novos
cobrindo a derivação).

**`lint`/`typecheck`/`build`/`build:admin`/`git diff --check`** — todos verdes, sem erros novos.

## Arquivos alterados

- `migrations/REF-PRICE-SOURCE-01-onda1-server-side-pricing.sql` (+ `-rollback.sql`) — nova função
  `_resolve_item_pricing` + `create_order()` recalculando preço/total. **Aplicada só no banco E2E.**
- `src/utils/orderPayload.js` — deriva `tamanho_label` por item.
- `tests/checkout.golden.mjs` — golden atualizado + 4 checks novos + pin de fonte.
- `e2e/support/fixture-order.js`, `e2e/tests/admin/admin-relatorios.spec.js`,
  `e2e/tests/admin/admin-pedidos-lista.spec.js` — total fictício → preço real.
- `scripts/price-source-01-onda1-test.mjs` (novo) — 16 casos de manipulação.

## Próximos passos (fora desta onda, não implementados)

1. Aplicar esta migration em **produção** (aguarda aprovação/deploy — não feito aqui).
2. Onda 2 proposta: decidir o destino de itens sem `product_id` (fecha o vetor residual do mock).
3. Aviso ao cliente no checkout quando o preço mudou desde a adição ao carrinho (UX).
4. `NUMERIC(10,2)` nas colunas monetárias sem escala — achado separado da auditoria.
5. Corrigir `Origin` ausente em `saas01-onda4-1-pedidos-test.mjs`/`harden-orders-rls-test.mjs`
   (dívida de outra REF, descoberta incidentalmente).
