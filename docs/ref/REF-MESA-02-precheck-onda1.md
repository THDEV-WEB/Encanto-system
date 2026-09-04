# REF-MESA-02 — PRECHECK (Onda 1)

**Status: BLOQUEADO.** Encontrei uma regressão real e confirmada em `create_order()`/
`admin_orders_search()` causada por outra REF (`REF-DELIVERY-FEE-05`, hoje, outro autor) que já
está aplicada permanentemente em produção E no banco de E2E. Não avancei para a Onda 2 — isso
precisa da sua decisão antes de qualquer schema novo de Mesa ser construído em cima de um
`create_order()` que hoje nem aceita `tipo_pedido='mesa'` mais.

---

## Estado do repositório

- Branch `main`, HEAD = `adeadaf` (2026-09-04 14:00:36) — `feat(delivery): REF-DELIVERY-FEE-05
  Onda 2 -- adicional de pagamento`, autor `ehfbrito <ehfbrito@gmail.com>` (pessoa/conta diferente
  de você — outra sessão trabalhando neste mesmo repositório, confirmado pelo commit).
- `origin/main` ainda no mesmo ponto de antes: `e972e1a` (REF-MESA-01 Onda 1) — local está agora
  **19 commits ahead** (eram 16 na auditoria de 31/08; +1 auditoria MESA-02, +2 DELIVERY-FEE-05).
  Nenhum push novo aconteceu desde a última verificação.
- `git status`: só os 2 arquivos de sempre, de outras iniciativas, intocados
  (`src/constants/privacyPolicy.js` modificado, `scripts/loadtest-e2e.mjs` untracked) — nada meu
  pendente.
- Nenhum arquivo `REF-MESA-02-*` em `migrations/` ainda — só o doc de auditoria (`475cfef`).

## Estado MESA-01

- As 6 migrations (onda1,3,4,5,6,7) continuam existindo em `migrations/`, inalteradas.
- **Produção**: confirmado por introspecção read-only agora (`BEGIN; SET TRANSACTION READ ONLY;
  ...; ROLLBACK`, zero escrita) — `orders` **ainda não tem** `tipo_pedido`/`origem_pedido`/
  `mesa_identificador`. Isso não mudou desde a auditoria.
- **E2E**: as 3 colunas de Mesa **existem** na tabela `orders` — mas (achado novo, ver Drift
  abaixo) a função `create_order()` **não as usa mais**. O schema tem os campos; a função não os
  preenche.

## Estado MESA-02

- Só existe o relatório de auditoria (`docs/ref/REF-MESA-02-auditoria.md`, commit `475cfef`).
  Nenhuma migration, nenhum código, nenhuma linha de implementação ainda.

---

## Drift encontrado (bloqueante)

**`REF-DELIVERY-FEE-05-onda2-adicional-pagamento.sql`** (commit `adeadaf`, hoje) reescreveu
`create_order()` e `admin_orders_search()` inteiros — mas partindo da **baseline de produção sem
Mesa** (o próprio cabeçalho da migration documenta isso explicitamente: *"create_order() ativo ==
byte-idêntico a REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte2... sem tipo_pedido/mesa_identificador"*).
Isso é coerente do ponto de vista de quem escreveu (produção mesmo não tinha Mesa), mas essa
migration **foi aplicada de verdade** — não só testada — tanto em produção quanto no banco de E2E.

Confirmei ao vivo (2 introspecções read-only, produção e E2E, sem nenhuma escrita):

| | Produção | E2E |
|---|---|---|
| `orders.adicional_pagamento_fee` | ✅ existe | ✅ existe |
| `orders.tipo_pedido/origem_pedido/mesa_identificador` | ❌ nunca existiu | ✅ existe (coluna) |
| `create_order()` referencia campos de Mesa | ❌ (nunca teve) | **❌ (tinha, foi perdido)** |
| `create_order()` referencia `adicional_pagamento_fee` | ✅ | ✅ |

**Prova concreta, não só inferência**: rodei a suíte de teste da própria REF-MESA-01
(`scripts/mesa-01-onda1-fundacao-test.mjs`) contra o E2E agora. Resultado: **14 PASS / 11 FAIL**
(era 26/26 antes). Todo pedido com `tipo_pedido='mesa'` hoje falha com `"address e obrigatorio"` —
`create_order()` voltou a exigir endereço para Mesa porque a lógica que isentava Mesa (e que lia/
validava capability/persistia os 3 campos) foi inteiramente substituída pelo `CREATE OR REPLACE`
da Onda 2 do Delivery-Fee-05, que nunca soube que essa lógica existia.

**Consequência prática, confirmada por leitura direta do SQL aplicado:**
- `create_order()` hoje não lê `p_order.tipo_pedido`/`origem_pedido`/`mesa_identificador` — nenhum
  pedido novo os grava, mesmo que o client mande. `NovoPedidoMesaModal.jsx` (que a Delivery-Fee-05
  também tocou, só para adicionar `adicional_pagamento_fee: 0` ao payload) hoje cria pedidos que
  **caem silenciosamente como `tipo_pedido='entrega'`**, não mesa.
- Nenhuma das 3 checagens de capability de Mesa (`mesa_habilitada`/`mesa_canal_qr`/
  `mesa_canal_admin` + `is_admin_of` para o canal admin) roda mais.
- `admin_orders_search()` também perdeu as 3 colunas de Mesa no `RETURNS TABLE` (voltou à forma
  anterior à Onda 5) — e o `GRANT` mudou de `TO PUBLIC` (assumido pela migration original da
  REF-MESA-01) para `TO authenticated` (confirmado ao vivo como o real em produção agora — outra
  REF de hardening havia restringido isso no meio do caminho, sem eu/REF-MESA-01 saber).
- `get_mesa_config`/`set_mesa_config`, `admin_reports_summary`, `enc_enqueue_notification`/
  `enc_render_message` **não foram tocadas** por essa migration — continuam com a lógica de Mesa
  intacta. Mas ficam órfãs: não há mais nenhum pedido novo chegando com `tipo_pedido='mesa'` pra
  elas processarem.

**Por que isso bloqueia a REF-MESA-02**: a REF-MESA-02 inteira depende de `create_order()`
continuar resolvendo `tipo_pedido='mesa'` corretamente — é o alicerce sobre o qual `mesa_sessions`
seria construída. Construir cima de um `create_order()` que nem aceita mais Mesa seria implementar
sobre uma base quebrada, e a próxima pessoa a mexer em `create_order()` (esta REF precisaria fazer
isso na Onda 8 do plano de auditoria) correria o risco real de reverter o `adicional_pagamento_fee`
que agora está ao vivo em produção — exatamente o padrão de regressão silenciosa que a própria
auditoria da REF-MESA-02 já tinha sinalizado como risco (R12), só que já aconteceu antes mesmo de
eu começar a implementar.

---

## Riscos/bloqueios

1. **[BLOQUEANTE]** `create_order()`/`admin_orders_search()` precisam de uma migration de
   **reconciliação** que preserve as DUAS lógicas (Mesa + adicional de pagamento) — nenhuma delas
   pode ser simplesmente reaplicada por cima da outra sem perder uma das duas.
2. Isso não é escopo original da REF-MESA-02 (é uma regressão de outra REF) — mas, pela sua própria
   regra (seção 38, exceção: "impedir Mesa de funcionar corretamente"), não posso simplesmente
   registrar e seguir em frente. Preciso corrigir antes de construir `mesa_sessions` em cima.
3. Menor, não bloqueante: `admin_orders_search()` GRANT real (`TO authenticated`) diverge do que a
   migration original da REF-MESA-01 assumia (`TO PUBLIC`) — preciso usar o valor real confirmado
   agora, não repetir o assumido.
4. A regressão provavelmente cascateia para as suítes de teste das Ondas 3-7 da MESA-01 (mesmo
   `create_order()` raiz) — não rodei todas ainda (rodar 1 já bastou pra provar a causa raiz; as
   outras teriam a mesma causa).

## Plano de implementação (proposta, aguardando sua decisão)

**Opção recomendada**: antes de qualquer Onda da REF-MESA-02, escrever e aplicar (só em E2E por
enquanto) uma migration de reconciliação — `migrations/REF-MESA-01-onda8-reconciliacao-delivery-
fee-05.sql` (numerando como continuação da REF-MESA-01, já que é ela que está quebrada, não uma
onda nova da MESA-02) — que parte do `create_order()`/`admin_orders_search()` **atualmente vigentes
em produção** (com `adicional_pagamento_fee`) e reincorpora, por cima, exatamente a lógica de Mesa
da Onda 4/5 (capability checks, campos, `RETURNS TABLE` com as 3 colunas, `GRANT` corrigido para o
valor real `TO authenticated`). Depois, rodar a suíte de regressão completa da MESA-01 (deve voltar
a 26/26, 8/8, 8/8, 4/4, 5/5, 9/9) mais a suíte nova da Delivery-Fee-05 (deve continuar 29/29) — só
então a REF-MESA-02 pode começar sua própria Onda 2 (`mesa_sessions`) com segurança.

Isso não é reescrever a REF-MESA-01 nem misturar REFs indevidamente — é a mesma disciplina que
vocês já usam neste projeto (nunca editar migration antiga, sempre um arquivo novo) aplicada ao
fato de que duas REFs independentes reescreveram a mesma função sem se verem.

**Alternativa** (não recomendada por mim, mas possível): esperar por uma correção vinda de quem fez
a REF-DELIVERY-FEE-05, e a REF-MESA-02 só recomeça quando `create_order()` estiver reconciliado por
outra sessão. Mais lento, mas evita eu tocar numa área que outra pessoa está ativamente mexendo.

## Próxima ação

**Aguardando sua decisão** — nenhuma implementação, migration ou commit foi feito além deste
documento. Preciso que você escolha:

1. Eu escrevo e testo a migration de reconciliação agora (Opção recomendada acima), como um passo
   prévio explícito antes da Onda 2 da REF-MESA-02?
2. Você prefere coordenar com quem fez a REF-DELIVERY-FEE-05 primeiro?
3. Alguma outra direção?

Não vou prosseguir para a Onda 2 (fundação de `mesa_sessions`) até essa decisão.
