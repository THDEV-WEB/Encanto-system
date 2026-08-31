# REF-MESA-01 — CHECKPOINT DE RETOMADA (ler isto primeiro numa nova sessão)

**Atualizado em:** 2026-08-31, Onda 5 CONCLUÍDA, iniciando Onda 6.
**Se você é uma nova sessão/contexto retomando este trabalho:** leia este arquivo inteiro, depois
rode `git log --oneline -12` e `git status --porcelain=v1` em `C:\Projetos\Encanto\encanto-react`
para confirmar que o estado real do repositório bate com o descrito aqui ANTES de continuar. Não
repita trabalho já commitado. Não presuma nada além do que está confirmado abaixo.

**Nota sobre continuidade:** esta REF já sobreviveu a pelo menos uma renovação de contexto/sessão
(a sessão anterior não tem visibilidade de quando o limite é renovado — não há mecanismo de
"acordar sozinho"). Por isso este arquivo é a ÚNICA fonte confiável de estado — não confie em
resumos de conversa, só neste arquivo + no Git real.

---

## Onde estamos agora (resumo de 1 parágrafo)

Ondas 0-5 (auditoria/plano, fundação banco/RPC, checkout/storefront, canal QR, canal Admin/garçom,
propagação pra Admin/Comanda) estão **CONCLUÍDAS, TESTADAS E COMMITADAS LOCALMENTE** (não commitadas
em produção, não pushed — commits `af50c3a`, `e972e1a`, `fff4946`, `287ee04`, `6875bf3`, `ddb0743`,
`d1856c6`, `78e79f0`, `5c05be1`, `67f4bd2`). Onda 5 fechou 100% verde, incluindo uma REGRESSÃO REAL
encontrada e corrigida na mesma onda (não só registrada — ver seção Onda 5 abaixo). Próxima: Onda 6
(Relatórios/Métricas — `admin_reports_summary`/`AdminRelatorios.jsx` ainda classificam Mesa como
"Entrega" via a MESMA regex antiga sobre `address`, deliberadamente adiado até aqui).

---

## Estado exato do Git (no momento deste checkpoint)

Últimos commits (mais recente primeiro):
```
e972e1a feat(orders): REF-MESA-01 Onda 1 -- fundacao do dominio multicanal de atendimento
af50c3a docs(mesa): REF-MESA-01 Onda 0 -- auditoria completa + plano tecnico de ondas
df5a3d1 deploy(delivery): REF-ADDRESS-GEO-INTEGRITY-01 -- Onda 2 (bbox + ownership) aplicada em producao
... (histórico anterior, não relacionado a esta REF)
```

`git status --porcelain=v1` no momento deste checkpoint (Onda 2 ainda não commitada):
```
 M src/components/DeliveryBar.jsx
 M src/constants/privacyPolicy.js          <- NÃO É MEU. NÃO TOCAR. NÃO INCLUIR EM COMMIT.
 M src/pages/StoreApp.jsx
 M src/components/checkout/CheckoutPage.jsx
 M src/components/checkout/SuccessPage.jsx
 M src/utils/orderPayload.js
?? scripts/loadtest-e2e.mjs                <- NÃO É MEU. NÃO TOCAR. NÃO INCLUIR EM COMMIT.
?? src/hooks/useMesaConfig.js
?? src/services/mesa/
```

**`src/constants/privacyPolicy.js` e `scripts/loadtest-e2e.mjs` pertencem a outra iniciativa/sessão
(LGPD e um script de load test, nada a ver com REF-MESA-01) — confirmado por diff, não fazem parte
desta REF. NUNCA rodar `git add -A`/`git add .` neste repo — sempre `git add <arquivo>` explícito,
listando só os arquivos da Onda em andamento.**

---

## O que já foi CONCLUÍDO (não refazer)

### Onda 0 — Auditoria + Plano (commit `af50c3a`)
- `docs/ref/REF-MESA-01-auditoria.md` — auditoria completa (18 seções pedidas pelo usuário).
- `docs/ref/REF-MESA-01-plano-ondas.md` — plano técnico com decisões de nomenclatura/schema.
- Achado central: sistema não tinha tipo de pedido estruturado; Entrega/Retirada eram inferidos por
  regex `/retirada\s+na\s+loja/i` sobre `orders.address`, duplicada em JS (`comandaModel.js`) e SQL
  (`enc_tempo_estimado`, `admin_reports_summary`).

### Onda 1 — Fundação de banco/RPC (commit `e972e1a`)
- `migrations/REF-MESA-01-onda1-fundacao.sql` + `-rollback.sql`.
- `scripts/mesa-01-onda1-fundacao-test.mjs`.
- **Aplicada e validada SOMENTE no projeto Supabase de E2E dedicado** (`C:/Users/00thi/.encanto/db.e2e.env`,
  project ref `bgzcro...`, "nunca produção" por documentação do próprio repo em `e2e/README.md`).
  **NUNCA aplicada em `db.env`/`.env` (ref `hvbcdx...`) nem em produção real.** O usuário havia
  autorizado usar `hvbcdx` (respondeu "não é produção real, pode aplicar lá"), mas optei pelo caminho
  ainda mais conservador (E2E dedicado) porque (a) é explicitamente documentado como nunca-produção,
  e (b) já estava mais atualizado que `hvbcdx` nas mesmas funções (tinha o hardening da
  REF-ADDRESS-GEO-INTEGRITY-01 que `hvbcdx` ainda não tinha) — decisão registrada, não pergunte de
  novo, só continue usando `db.e2e.env` para qualquer teste de banco desta REF.
- Resultado: 26/26 testes novos (estrutural + histórico/entrega/retirada/mesa habilitada-desabilitada/
  bypass anon+authenticated/cross-tenant/idempotência/fidelidade/notificações/views/triggers/RLS) +
  114 checks de regressão de 7 suites de outras REFs (`address-geo-integrity-01-onda2-test.mjs`,
  `delivery-fee-04-onda1/2/3-test.mjs`, `price-source-01-onda1/2-test.mjs`,
  `price-hardening-01-test.mjs`, `money-scale-01-test.mjs`) — **todos verdes, zero regressão**.
- Decisões técnicas fixadas (não reabrir sem motivo forte):
  - `orders.tipo_pedido text NOT NULL DEFAULT 'entrega' CHECK IN ('entrega','retirada','mesa')` — o
    valor persistido da modalidade de entrega continua **`'entrega'`, não `'delivery'`** (zero-churn,
    consistente com o resto da base). Ver `REF-MESA-01-plano-ondas.md` §1.1 para a justificativa.
  - `orders.origem_pedido text NOT NULL DEFAULT 'storefront' CHECK IN ('storefront','qr_mesa','admin_garcom')`.
  - `orders.mesa_identificador text NULL` (obrigatório só quando `tipo_pedido='mesa'`, via CHECK).
  - Capability por loja: `store_settings` com 3 chaves flat (`mesa_habilitada`, `mesa_canal_qr`,
    `mesa_canal_admin`) — mesmo molde de `loyalty_enabled`/`loyalty_required`/`loyalty_discount`
    (NÃO um único JSON, ao contrário do que o plano da Onda 0 cogitou inicialmente — confirmado
    contra o código vivo que o padrão real usado é 3 chaves separadas).
  - RPCs novas: `get_mesa_config(p_store_id)` (pública, `anon`+`authenticated`) e
    `set_mesa_config(p_habilitada, p_canal_qr, p_canal_admin, p_store_id)` (só `authenticated`,
    gate `is_admin_of`). **Ainda não existe nenhuma tela de Admin que chame `set_mesa_config`** — só
    foi testado via chamada direta de RPC/script. Isso é um GAP conhecido, não uma onda do plano
    original do usuário — decidir em qual onda entra (provavelmente cabe em Onda 4 "Admin/garçom" ou
    precisa de uma onda extra; sinalizar no relatório final, não inventar sozinho).
  - `create_order()`: aceita `p_order.tipo_pedido`/`p_order.mesa_identificador` opcionais, 100%
    retrocompatível (ausentes → deriva de `retirada` exatamente como antes). Valida capacidade de
    Mesa logo após resolver `v_store_id` (mesmo ponto de `REF-ORDER-TENANT-01`), fail-closed,
    mensagem genérica `'modalidade indisponivel para esta loja'`. `_resolve_delivery_fee` **NÃO foi
    tocada** — `create_order` só passa `(v_tipo_pedido <> 'entrega')` no lugar do antigo `v_retirada`
    como argumento, reaproveitando o ramo "sem taxa" que retirada já tinha.
  - `address` continua `NOT NULL`, mas vira só texto de EXIBIÇÃO (`'Mesa ' || mesa_identificador`
    quando o client não mandar nada) — nunca mais fonte de verdade do tipo.

---

## Onda 2 — Checkout/Storefront (CONCLUÍDA, commit `287ee04`)

Tudo descrito abaixo já foi implementado, testado e commitado. Não refazer.

### Arquivos já criados (novos, prontos, não commitados)
- `src/services/mesa/mesaConfig.js` — espelha `services/delivery/deliveryFeeConfig.js` (cache +
  `sincronizarMesaConfig` via RPC `get_mesa_config`). Só a metade de LEITURA (sem `definirMesaConfig`
  — não há UI de escrita ainda, ver gap acima).
- `src/hooks/useMesaConfig.js` — espelha `hooks/useDeliveryFeeConfig.js` 1:1.

### Arquivos já editados (não commitados)
- `src/components/DeliveryBar.jsx` — 3ª opção `<option value="mesa">Mesa</option>` no `<select>`,
  **só renderizada quando `mesaHabilitada` (prop) é true**. `aria-label` do select também virou
  condicional (2 vs 3 opções) — isso corrigiu de propósito um possível choque com o snapshot de
  `tests/render.smoke.mjs` (ver "Próximo passo" abaixo, ainda preciso CONFIRMAR que passou).
  `delivery-eta`/`delivery-place` ganharam um 3º ramo pra mesa (texto "Pedido para a mesa X" /
  "Atendimento presencial", sem endereço nenhum).
- `src/pages/StoreApp.jsx` — novo estado `mesaIdentificador`/`setMesaIdentificador` (mesmo nível de
  `deliveryMode`, sobrevive à navegação cardápio↔checkout). `mesaConfig = useMesaConfig()`. Passa
  `mesaHabilitada`/`mesaIdentificador` pro `DeliveryBar`; passa `mesaIdentificador`/
  `setMesaIdentificador` pro `CheckoutPage`; passa `mesaIdentificador` pro `SuccessPage`.
- `src/utils/orderPayload.js` — `buildOrderArgs(cart, form, endereco, requestId, enderecoId, resumo, extra = {})`
  ganhou um 7º parâmetro OPCIONAL (`extra.tipoPedido`/`extra.mesaIdentificador`) — ausente preserva
  100% o payload antigo. **ESTE é o parâmetro que quebrou o pin de teste, ver abaixo.**
- `src/components/checkout/CheckoutPage.jsx` — mudanças principais:
  - `const mesa = deliveryMode === 'mesa'; const semEntregaFisica = retirada || mesa;`
  - `enderecoEntrega`: 3 ramos agora (`mesa ? 'Mesa '+mesaIdentificador : retirada ? '...' : endereco?.label`).
  - Geocoding effect, `montarResumoFinanceiro`, gate de endereço obrigatório, persistência de
    `endereco_id`, `entregaAConfirmar`/`entregaConfigPadrao`: todos trocaram `retirada` por
    `semEntregaFisica` nos pontos onde mesa deve se comportar IGUAL a retirada (sem taxa, sem
    geocoding, sem endereço obrigatório). `retirada` sozinho continua onde o TEXTO difere.
  - Novo campo obrigatório "Número da mesa" (`<input>`, substitui o bloco `<AddressSummary>` inteiro
    quando `mesa===true`) + validação `if (mesa && !mesaIdentificador?.trim())`.
  - `buildOrderArgs(...)` agora recebe um 7º argumento `extraPedido = mesa ? {tipoPedido:'mesa', mesaIdentificador: mesaIdentificador.trim()} : {}`.
  - `enderecoEstruturado: semEntregaFisica ? null : endereco` na mensagem de confirmação.
  - Breadcrumbs Sentry ganharam `tipoPedido: deliveryMode` (observabilidade, não obrigatório mas
    barato e coerente com o domínio).
- `src/components/checkout/SuccessPage.jsx` — `mesa = deliveryMode === 'mesa'`. Bloco de "tempo
  estimado" vira "Pedido enviado — Mesa X" sem número de minutos (não inventa ETA de preparo, que
  não existe em lugar nenhum do sistema). `steps` da trilha de status ganhou uma variante SEM o passo
  "Em entrega" pra mesa (`Recebido→Em preparo→Pronto→Servido`), atendendo a regra explícita do
  usuário ("Mesa não pode aparecer o fluxo 'saiu para entrega'"). Isso é uma correção LOCAL só deste
  componente — `src/components/pedidos/pedidoStatus.js` (`fluxoDoTipo`, usado pelo Admin) continua
  INTOCADO, propositalmente adiado pra Onda 5.

### Verificações feitas na Onda 2 (todas verdes, confirmado)
- `npm run lint` → 0 erros (59 warnings pré-existentes, nenhum novo).
- `npm run typecheck` → limpo.
- `npm run test:domain` → 40/40 verde (os 2 pins de `tests/checkout.golden.mjs` foram atualizados
  pro novo texto-fonte; `render.smoke.mjs` confirmado incólume — a 3ª opção só aparece com
  `mesaHabilitada=true`, os snapshots existentes chamam `DeliveryBar` sem essa prop).
- `npx playwright test e2e/tests/checkout/` → 9/9 specs verdes (guest/logado/whatsapp/preço-divergente),
  browser real contra o projeto E2E dedicado — zero regressão em Entrega/Retirada.
- Diff final: 8 arquivos (`DeliveryBar.jsx`, `StoreApp.jsx`, `CheckoutPage.jsx`, `SuccessPage.jsx`,
  `orderPayload.js`, `useMesaConfig.js` novo, `services/mesa/mesaConfig.js` novo,
  `checkout.golden.mjs`), commit `287ee04`. `privacyPolicy.js`/`loadtest-e2e.mjs` (outra sessão)
  confirmados fora do commit.

---

## Onda 3 — Canal QR (CONCLUÍDA, commit `ddb0743`)

- `src/hooks/useMesaFromQuery.js` (novo) — lê `?mesa=` da URL no boot, só aplica
  `deliveryMode='mesa'`/`mesaIdentificador`/`origemPedido='qr_mesa'` quando `mesaConfig.canal_qr===true`.
- `StoreApp.jsx` — novo estado `origemPedido` (default `'storefront'`), chama `useMesaFromQuery(...)`,
  repassa `origemPedido` pro `CheckoutPage`.
- `orderPayload.js` — `extra.origemPedido` opcional em `buildOrderArgs` → `p_order.origem_pedido`.
- `CheckoutPage.jsx` — inclui `origemPedido` em `extraPedido` quando `mesa===true`.
- `migrations/REF-MESA-01-onda3-canal-qr.sql` (+rollback) — `create_order()` ganhou checagem: quando
  `origem_pedido='qr_mesa'`, exige `mesa_canal_qr=true` (reusa o mesmo `v_mesa_cfg` já buscado pra
  `mesa_habilitada`); `origem_pedido='qr_mesa'` sem `tipo_pedido='mesa'` também é rejeitado (combinação
  sem sentido). Aplicada no E2E (bgzcro), nunca em hvbcdx/produção.
- `scripts/mesa-01-onda3-canal-qr-test.mjs` (novo) — 8/8 verde.
- Regressão completa rodada de novo (create_order foi substituído): `mesa-01-onda1-fundacao-test.mjs`
  26/26, as 8 suites de outras REFs (129 checks), `test:domain` 40/40, E2E checkout 9/9 — tudo verde.
- **Gap registrado, não bloqueante:** não existe spec Playwright dedicado provando o fluxo `?mesa=`
  ponta-a-ponta via browser real ainda (só a parte de servidor foi provada exaustivamente + revisão
  de código do hook). Mencionar no relatório final.

---

## Onda 4 — Admin/garçom (CONCLUÍDA, commit `78e79f0`)

- `migrations/REF-MESA-01-onda4-canal-admin.sql` (+rollback) — `create_order()` ganhou: quando
  `origem_pedido='admin_garcom'`, exige `mesa_canal_admin=true` (mesmo `v_mesa_cfg`) **e**
  `is_admin_of(v_store_id)` (diferente do canal QR — este exige que o CHAMADOR seja admin da loja).
  Aplicada no E2E, nunca em hvbcdx/produção.
- `src/services/DataService.js` — `savePedidoAdmin` (nova, usa `buildStoreRpcParam` de `adminStore.js`)
  + `_executarCreateOrder` (retry/timeout/erro extraído, compartilhado com `savePedido`). **Achado
  crítico evitado:** `savePedido` (do cliente) usa `buildStorefrontRpcParam`, que nunca resolve dentro
  do bundle Admin — reusar direto criaria pedido na loja errada em cenários multi-loja.
- `src/components/admin/NovoPedidoMesaModal.jsx` (novo) — form: busca produto (`DS.getAllProds`, não
  `useProducts` — este só funciona no bundle storefront), tamanho (quando o produto tiver), número da
  mesa, nome/telefone do cliente, forma de pagamento. Preço mostrado é só estimativa.
- `src/components/admin/AdminPedidos.jsx` — botão "🍽️ Novo pedido de mesa", só visível com
  `mesaConfig.canal_admin` (via `useMesaConfig`, já funciona certo no bundle Admin desde a Onda 2).
- `e2e/support/mesaMode.js` (novo) — liga/desliga capacidade de Mesa direto via `service_role` (mesmo
  padrão de `storeMode.js`), para setup de specs E2E. `e2e/tests/admin/admin-pedidos-novo-mesa.spec.js`
  (novo, 2 specs) + `e2e/pages/AdminPedidosPage.page.js` ganhou os locators do modal novo.
- `scripts/mesa-01-onda4-canal-admin-test.mjs` (novo) — 8/8 verde.
- Regressão completa: `mesa-01-onda1` 26/26, `mesa-01-onda3` 8/8, 8 suites de outras REFs (129
  checks), `test:domain` 40/40, lint 0 erros, typecheck limpo, E2E checkout+admin-pedidos existentes
  (10/10) — tudo verde, zero vazamento de estado entre specs (confirmado rodando checkout logo depois).
- **Gaps registrados, não bloqueantes:**
  - Adicionais/extras pagos não são selecionáveis no formulário ainda (só produto+tamanho+observação
    em texto livre, que NÃO gera cobrança) — mencionar no relatório final.
  - Ainda não existe tela para LIGAR `mesa_canal_admin`/`mesa_habilitada`/`mesa_canal_qr` em si (RPC
    `set_mesa_config` existe desde a Onda 1, sem consumidor de UI de escrita — só foi ligado via
    script/service_role nos testes). Precisa de decisão: onde essa tela entra (talvez uma nova
    sub-onda, ou dentro da Onda 5/8) — **não inventar sozinho, sinalizar no relatório final.**

---

## Onda 5 — Operação/Comanda/Admin (CONCLUÍDA, commit `67f4bd2`)

- `migrations/REF-MESA-01-onda5-admin-orders-search.sql` (+rollback) — `admin_orders_search()` passa
  a devolver `tipo_pedido`/`origem_pedido`/`mesa_identificador`. **Achado técnico:** mudar
  `RETURNS TABLE(...)` exige `DROP FUNCTION` antes (CREATE OR REPLACE sozinho falha com "cannot change
  return type") — e DROP apaga grants, precisou `GRANT EXECUTE ... TO PUBLIC` explícito depois.
  `useOrdersPagina`/`DS.getPedidosPagina` não filtram campos, então as 3 colunas chegam em `order.*`
  no Admin sem NENHUMA mudança de código JS na camada de dados.
- `src/components/admin/comanda/comandaModel.js::tipoDoPedido` — lê `order.tipo_pedido` primeiro,
  regex vira só fallback defensivo. `tipoLabel`/`tipoLabelCliente`/`previsao`/`previsaoLabel`/`endereco`
  ganharam o 3º ramo explícito pra mesa (endereço nunca aparece; `previsao` mostra "Mesa {id}" em vez
  de inventar um tempo de deslocamento).
- `src/components/pedidos/pedidoStatus.js` — `FLUXO_MESA` novo (reusa os 4 status de retirada —
  `orders.status` não tem valor próprio pra mesa, criar um exigiria migration de schema fora do
  escopo desta onda). `fluxoDoTipo` deixou de ser ternário.
- `src/components/admin/AdminPedidos.jsx` — badge virou mapa `TIPO_BADGE` de 3 entradas, mostra
  `order.mesa_identificador` quando presente.
- `src/services/delivery/deliveryEtaFormat.js::textoTempoEntrega` — texto neutro pra mesa ("preparo
  em andamento"). Beneficia de graça `PedidoNotificacoes.jsx` (preview), mas a notificação AUTOMÁTICA
  de verdade (SQL, `enc_render_message`/`enc_tempo_estimado`) só é corrigida na Onda 7 — até lá o
  preview do Admin fica correto ANTES do envio real acompanhar (gap conhecido, registrado).
- **Regressão REAL encontrada e CORRIGIDA nesta mesma onda** (não só registrada — era causada pela
  própria mudança desta onda): `e2e/support/fixture-order.js` (`criarPedidoFixture`/
  `criarPedidoAvulso`) criava pedidos "retirada" só via texto de endereço, sem o campo `retirada` no
  payload — funcionava por acidente via regex antes; com `tipo_pedido` estruturado tendo prioridade,
  esses fixtures passaram a persistir `tipo_pedido='entrega'` errado, quebrando 3 specs E2E
  (admin-pedidos-lista/status/comanda). Corrigido pra mandar `retirada` explícito, igual o checkout
  real já fazia.
- Testes novos: 9 casos em `tests/comanda.golden.mjs`, 4 em `tests/order-status.guard.mjs`, 1 em
  `tests/whatsapp-templates.golden.mjs`; `scripts/mesa-01-onda5-admin-orders-search-test.mjs` (4/4);
  `e2e/tests/admin/admin-pedidos-novo-mesa.spec.js` estendido com prova visual real (badge "🍽️ Mesa
  12" + comanda "MESA" via browser).
- Regressão completa: `test:domain` 40/40, lint 0 erros, typecheck limpo, as 4 suites de banco
  próprias da REF (26+8+8+4), 23 specs E2E (checkout + admin-pedidos + fidelidade + meus-pedidos) —
  tudo verde.

---

## PRÓXIMO PASSO EXATO (retomar por aqui) — Onda 6: Relatórios/Métricas

Ainda NÃO iniciada. Objetivo: `admin_reports_summary()`/`AdminRelatorios.jsx` ainda classificam Mesa
como "Entrega" (achado mais grave da auditoria original, §10) via a MESMA regex sobre `address` —
agora que `orders.tipo_pedido` está estruturado (Onda 1) e a solução do "DROP FUNCTION antes de mudar
RETURNS TABLE" já está provada (Onda 5), esta onda deve ser direta:

1. **Investigar primeiro:** ler a definição VIVA de `admin_reports_summary()` no E2E (mesmo padrão
   das ondas anteriores — script de recon via `db.e2e.env`) antes de escrever a migration, para
   confirmar a query exata da CTE `base`/`por_tipo` (a versão auditada está em
   `migrations/REF-DASHBOARD-01-admin-reports.sql`, mas pode ter mudado desde então).
2. **Migration nova** (`REF-MESA-01-onda6-admin-reports.sql`): a CTE `base` precisa incluir
   `o.tipo_pedido` no SELECT; a CTE `por_tipo` troca `CASE WHEN address ~* 'retirada...' THEN
   'retirada' ELSE 'entrega' END` por `o.tipo_pedido` direto (`GROUP BY o.tipo_pedido`) — elimina a
   regex de vez neste ponto. Provavelmente NÃO muda `RETURNS jsonb` (é só `jsonb`, não `TABLE`), então
   talvez baste `CREATE OR REPLACE` simples desta vez (confirmar antes de assumir).
3. **`src/components/admin/AdminRelatorios.jsx`** (linha do card "Entrega vs. retirada", achado mais
   grave da auditoria original: `t.tipo === 'retirada' ? '🏪 Retirada' : '🚚 Entrega'` — um 3º valor
   cairia silenciosamente em "Entrega", distorcendo o BI sem erro visível). Trocar por mapa de 3
   entradas — considerar reaproveitar/extrair o `TIPO_BADGE` já criado em `AdminPedidos.jsx` (Onda 5)
   pra um módulo compartilhado, já que seria a 2ª tela precisando exatamente dos mesmos 3 rótulos
   (evita duplicar/divergir label+emoji entre as duas telas).
4. **Testes:** `scripts/dashboard01-admin-reports-test.mjs` já existe (REF-DASHBOARD-01) — verificar
   se cobre `por_tipo` e estender com um caso de pedido de mesa; `tests/` não parece ter golden de
   domínio puro pra `admin_reports_summary` (é só SQL) — confirmar antes de presumir.
5. Fluxo de sempre: investigar → migration → frontend → testar (script SQL dedicado ou estendido +
   regressão das ondas anteriores + E2E `admin-relatorios.spec.js` se existir) → revisar diff →
   `git add` explícito → commit `feat(admin): REF-MESA-01 Onda 6 -- ...` → atualizar checkpoint →
   Onda 7 (WhatsApp/notificações — a última peça que ainda depende da regex antiga).

1. **Backend primeiro (mesmo padrão das Ondas 1/3):** nova migration
   `REF-MESA-01-onda4-canal-admin.sql`. Dentro de `create_order()`, quando `origem_pedido='admin_garcom'`:
   - Exigir `mesa_canal_admin=true` (mesmo `v_mesa_cfg`, mesmo padrão de `canal_qr` da Onda 3).
   - **Diferença importante da Onda 3:** este canal exige que o CHAMADOR seja um admin autenticado
     DAQUELA loja — adicionar `if not public.is_admin_of(v_store_id) then return 'sem permissao'`
     (ou mensagem equivalente) especificamente pro ramo `admin_garcom`. Sem isso, qualquer
     `authenticated` (não só admin) poderia se passar por garçom. `qr_mesa`/`storefront` continuam
     sem essa exigência (são os canais voltados ao cliente final, guest ou logado).
   - Reaproveitar a MESMA validação de `tipo_pedido='mesa'` + `mesa_habilitada` já existente (Onda 1)
     — `admin_garcom` sem `tipo_pedido='mesa'` também deveria ser rejeitado, mesmo raciocínio da
     Onda 3 pra `qr_mesa`.
2. **Frontend — novo componente no Admin** (não existe nada parecido hoje, é uma tela nova):
   - Reaproveitar o catálogo/produtos já carregados pelo Admin (ver `useProducts`/hooks de catálogo
     já usados por `AdminCatalog`/telas de produto do Admin — **investigar antes de escrever** qual
     hook/serviço já existe pra listar produtos no bundle Admin, não duplicar).
   - Form simples: selecionar produtos (nome + quantidade, mesmo padrão de item que `create_order`
     já aceita — `product_id`, `quantity`, `tamanho_label`/`adicionais` se o produto tiver), número da
     mesa, forma de pagamento (mesmas opções do checkout do cliente), nome/telefone do cliente
     (MESMOS campos obrigatórios do checkout — não inventar uma regra nova de "cliente anônimo pra
     pedido de garçom", não há pedido do usuário pra isso).
   - Submit chama a MESMA `create_order()` (nunca um insert direto em `orders` — regra explícita do
     usuário: "não criar um segundo mecanismo de persistência de pedidos"), com
     `p_order.tipo_pedido='mesa'`, `origem_pedido='admin_garcom'`, `mesa_identificador=<escolhido>`.
   - Chamada precisa rodar com a SESSÃO do admin logado (`auth.uid()` = admin), não anônima — conferir
     como o Admin hoje monta suas chamadas RPC autenticadas (deve já existir um client Supabase do
     bundle Admin com sessão ativa, ver `AdminApp.jsx`/`useAdminStore`/serviços do Admin).
   - Gate visual: essa tela/botão "+ Novo pedido de mesa" só aparece se `mesaConfig.canal_admin` for
     true pra loja ativa (mesmo padrão de `useMesaConfig` já usado no storefront, mas lido no bundle
     Admin — conferir se `useMesaConfig`/`mesaConfig.js` (Onda 2) já funciona no bundle Admin via
     `buildStoreRpcParam` (que já suporta os dois bundles, ver `resolveStoreParam.js`) ou se precisa
     de ajuste).
3. **Onde colocar a tela:** mais provável dentro da área de Pedidos do Admin (`AdminPedidos.jsx`) como
   um botão/modal "+ Novo pedido", já que é ali que o operador já vê a lista — mas CONFIRMAR isso lendo
   `AdminPedidos.jsx`/`AdminPanel.jsx` antes de decidir (não presumir a estrutura de abas do Admin sem
   olhar o código atual).
4. **Testes:** script SQL dedicado (`scripts/mesa-01-onda4-canal-admin-test.mjs`, mesmo padrão dos
   anteriores) cobrindo: admin da própria loja consegue criar; admin de OUTRA loja não consegue
   (cross-tenant); authenticated sem vínculo de admin não consegue; anon não consegue (grant de
   `create_order` pra anon continua existindo, então isso precisa ser barrado pela lógica, não só por
   ausência de sessão); `mesa_canal_admin=false` bloqueia mesmo admin sendo admin de verdade.
5. Fluxo de sempre: implementar → testar (domain + backend, considerar E2E se a tela ficar pronta a
   tempo) → revisar diff → `git add` explícito (cuidado redobrado: Admin tem MUITOS arquivos, outras
   sessões podem estar mexendo lá também — sempre `git status` antes) → commit
   `feat(admin): REF-MESA-01 Onda 4 -- ...` → atualizar este checkpoint → prosseguir pra Onda 5.

---

## Gaps e decisões registradas (não reabrir, não "corrigir de carona")

- **Sem tela de Admin para ligar/desligar Mesa** (`set_mesa_config` sem consumidor de UI). Gap real,
  não inventado — sinalizar no relatório final, decidir onda quando chegar lá (provavelmente Onda 4).
- **Comanda/Admin/Relatórios/WhatsApp ainda classificam Mesa como "entrega"** via a regex antiga
  sobre `address` — DELIBERADAMENTE adiado pra Ondas 5/6/7, conforme o plano do próprio usuário. Não
  é regressão, é sequenciamento. Endereço agora é só "Mesa {id}" (não bate com
  `/retirada\s+na\s+loja/i`), então cai no ramo "entrega" desses pontos até essas ondas corrigirem.
- **Bugs pré-existentes fora de escopo** (já documentados em `REF-MESA-01-auditoria.md`, não corrigir
  de carona): `v_order_reconciliation` não desconta taxa do `diff`; duplicação JS/SQL da regex
  `RE_RETIRADA`; `PedidoTimeline.jsx` (cliente) não usa `fluxoDoTipo`; falta filtro por tipo no Admin
  Orders; falta tela de criação manual de pedido no Admin (relevante pra Onda 4).
- **Banco-alvo de todos os testes desta REF: SOMENTE `db.e2e.env` (bgzcro), NUNCA `db.env`/`.env`
  (hvbcdx), NUNCA produção real.** Já esclarecido com o usuário, não perguntar de novo.
- **Nunca fazer push.** Commits ficam 100% locais até pedido explícito.
- **Sempre `git status` antes de `git add`, sempre listar arquivos explicitamente** — este repo tem
  múltiplas sessões/iniciativas concorrentes confirmadas (REF-CART-PRICE-DRIFT-01 já commitada,
  REF-LGPD-01 com `privacyPolicy.js` ainda dirty, `scripts/loadtest-e2e.mjs` de origem desconhecida).
