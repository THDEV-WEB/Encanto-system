# REF-MESA-01 — CHECKPOINT DE RETOMADA (ler isto primeiro numa nova sessão)

**Atualizado em:** 2026-08-31, Onda 2 CONCLUÍDA, iniciando Onda 3.
**Se você é uma nova sessão/contexto retomando este trabalho:** leia este arquivo inteiro, depois
rode `git log --oneline -10` e `git status --porcelain=v1` em `C:\Projetos\Encanto\encanto-react`
para confirmar que o estado real do repositório bate com o descrito aqui ANTES de continuar. Não
repita trabalho já commitado. Não presuma nada além do que está confirmado abaixo.

---

## Onde estamos agora (resumo de 1 parágrafo)

Onda 0 (auditoria + plano), Onda 1 (fundação de banco/RPC) e Onda 2 (checkout/storefront) estão
**CONCLUÍDAS, TESTADAS E COMMITADAS LOCALMENTE** (não commitadas em produção, não pushed — commits
`af50c3a`, `e972e1a`, `fff4946`, `287ee04`). Onda 2 fechou 100% verde: lint 0 erros, typecheck limpo,
`test:domain` 40/40, E2E de checkout (9/9 specs, browser real) sem regressão. Próxima: Onda 3 (QR
Code / canal do cliente).

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

## PRÓXIMO PASSO EXATO (retomar por aqui) — Onda 3: QR Code / canal do cliente

Ainda NÃO iniciada. Plano (baseado na arquitetura já existente, sem inventar infraestrutura nova):

1. **Ideia central (simples, reaproveitando o que já existe):** o storefront já é resolvido por
   domínio por-tenant (`useStorefrontStore`/`resolve_store_from_origin` — cada loja tem seu próprio
   subdomínio). Um QR Code de mesa aponta pro MESMO subdomínio da loja (zero risco de cross-tenant,
   porque não há nenhum `store_id` no link pro cliente adulterar) só com um parâmetro a mais na URL
   identificando a mesa, ex.: `https://{slug}.valionsistemas.com.br/?mesa=07`. Isso elimina a
   necessidade de qualquer mecanismo novo de resolução de loja — o QR só pré-preenche o que o cliente
   preencheria manualmente no checkout (Onda 2).
2. **Frontend (`StoreApp.jsx` ou um hook novo `useMesaFromQuery.js`):** ler `?mesa=` da URL no mount
   (`window.location.search`/`URLSearchParams`). Se presente E `mesaConfig.canal_qr === true`: setar
   `deliveryMode='mesa'` e `mesaIdentificador=<valor>` automaticamente (o cliente já chega no
   checkout com a mesa pré-identificada, sem digitar nada — mas o campo continua editável, não
   trava). Se `mesaConfig.canal_qr` for `false` (canal desligado nessa loja) ou `mesaConfig.habilitada`
   for `false`, ignorar o parâmetro silenciosamente (cai no comportamento normal de hoje).
3. **Rastrear a origem:** precisa de um novo estado (`origemPedido`, default `'storefront'`) setado
   pra `'qr_mesa'` quando o parâmetro `?mesa=` foi de fato aplicado. Esse valor viaja em
   `extraPedido.origemPedido` (novo campo em `buildOrderArgs`, mesmo padrão opcional de
   `tipoPedido`/`mesaIdentificador` já feito na Onda 2) → `p_order.origem_pedido` → `create_order`.
4. **Backend (nova migration `REF-MESA-01-onda3-canal-qr.sql`):** dentro de `create_order`, quando
   `v_origem_pedido = 'qr_mesa'`, validar `get_mesa_config(v_store_id)->>'canal_qr'` (fail-closed,
   mesmo padrão da checagem de `mesa_habilitada` já existente) — impede um client adulterado de
   mandar `origem_pedido:'qr_mesa'` numa loja que não ligou esse canal especificamente (mesmo que
   `mesa_habilitada` geral esteja true). Devolver o MESMO tipo de erro genérico já usado
   (`'modalidade indisponivel para esta loja'` ou mensagem equivalente).
5. **Testes:** estender `scripts/mesa-01-onda1-fundacao-test.mjs` (ou um novo
   `scripts/mesa-01-onda3-canal-qr-test.mjs`) cobrindo: `canal_qr=true` aceita `origem_pedido='qr_mesa'`;
   `canal_qr=false` (mas `mesa_habilitada=true`) rejeita; parâmetro `?mesa=` na URL não pode virar
   vetor de XSS/injeção (sempre tratado como texto simples, nunca `innerHTML`); mesa_identificador
   longo/malformado cai na mesma validação de tamanho (1-40) já existente.
6. Não criar geração de imagem de QR Code nesta onda (infra de impressão/design fica de fora por ora,
   é puramente visual/operacional, não é o que a REF pediu para provar) — só o link/parâmetro e a
   validação server-side, que é a parte arquitetural que importa.
7. Seguir o mesmo fluxo de sempre: implementar → testar (domain + E2E se fizer sentido) → revisar
   diff → `git add` explícito → commit `feat(...): REF-MESA-01 Onda 3 -- ...` → atualizar este
   checkpoint → prosseguir pra Onda 4 (Admin/garçom) sem pedir autorização entre ondas.

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
