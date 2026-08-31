# REF-MESA-01 — CHECKPOINT DE RETOMADA (ler isto primeiro numa nova sessão)

**Atualizado em:** 2026-08-31, durante execução autônoma da Onda 2.
**Se você é uma nova sessão/contexto retomando este trabalho:** leia este arquivo inteiro, depois
rode `git log --oneline -10` e `git status --porcelain=v1` em `C:\Projetos\Encanto\encanto-react`
para confirmar que o estado real do repositório bate com o descrito aqui ANTES de continuar. Não
repita trabalho já commitado. Não presuma nada além do que está confirmado abaixo.

---

## Onde estamos agora (resumo de 1 parágrafo)

Onda 0 (auditoria + plano) e Onda 1 (fundação de banco/RPC) estão **CONCLUÍDAS, TESTADAS E
COMMITADAS LOCALMENTE** (não commitadas em produção, não pushed). Onda 2 (checkout/storefront) está
**EM ANDAMENTO, código já escrito, lint/typecheck limpos, mas `npm run test:domain` ainda está
VERMELHO** — 2 testes "pin de fonte" em `tests/checkout.golden.mjs` esperam o texto-fonte antigo de
`CheckoutPage.jsx` (antes desta onda) e precisam ser atualizados para o novo texto-fonte. Isso é
trabalho NORMAL de onda (o próprio fluxo pedido pelo usuário é
`IMPLEMENTAÇÃO → TESTES → CORREÇÃO DE REGRESSÕES`), não um bug — só ainda não foi terminado.

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

## O que está EM ANDAMENTO agora (Onda 2 — Checkout/Storefront)

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

### Verificações já feitas nesta Onda 2
- `npm run lint` → **0 erros**, 59 warnings (todos pré-existentes, nenhum novo introduzido pelos
  arquivos desta onda — confirme lendo a lista se quiser, mas já foi conferido).
- `npm run typecheck` → **limpo**.
- `npm run test:domain` → **FALHOU, exit 1**. Falha isolada em `tests/checkout.golden.mjs`, seção
  "(B) PIN DE FONTE": 2 testes que checam por REGEX EXATO o texto-fonte de `CheckoutPage.jsx`
  (técnica de "pin" já usada por várias REFs anteriores neste arquivo de teste) ainda esperam o texto
  ANTIGO, de antes desta onda. Não é uma regressão de comportamento — é literalmente o teste
  "travando" a string antiga, que mudou de propósito nesta onda. Localização exata:
  `tests/checkout.golden.mjs` linhas 265-266:
  ```js
  pinCk('endereco estruturado so persiste em entrega, nunca bloqueia (Onda 6)', /const\s+enderecoId\s*=\s*\(!retirada\s*&&\s*endereco\)\s*\?\s*await\s+addressRepository\.salvar\(enderecoParaSalvar\)\s*:\s*null;/);
  pinCk('buildOrderArgs recebe enderecoId + resumoEnvio (Onda 6 + REF-DELIVERY-FEE-01 + REF-DELIVERY-FEE-04 Onda 2)', /buildOrderArgs\(cart,\s*form,\s*enderecoEntrega,\s*requestIdRef\.current,\s*enderecoId,\s*resumoEnvio\)/);
  ```
  Precisam virar (ajustar a regex pro texto NOVO, mantendo a descrição do teste atualizada pra
  mencionar Mesa/Onda 2 se fizer sentido, seguindo o estilo das descrições vizinhas):
  ```js
  pinCk('endereco estruturado so persiste fora de mesa/retirada, nunca bloqueia (Onda 6 + REF-MESA-01 Onda 2)', /const\s+enderecoId\s*=\s*\(!semEntregaFisica\s*&&\s*endereco\)\s*\?\s*await\s+addressRepository\.salvar\(enderecoParaSalvar\)\s*:\s*null;/);
  pinCk('buildOrderArgs recebe enderecoId + resumoEnvio + extraPedido (Onda 6 + REF-DELIVERY-FEE-01 + REF-DELIVERY-FEE-04 Onda 2 + REF-MESA-01 Onda 2)', /buildOrderArgs\(cart,\s*form,\s*enderecoEntrega,\s*requestIdRef\.current,\s*enderecoId,\s*resumoEnvio,\s*extraPedido\)/);
  ```
  **Ainda não apliquei esse ajuste — é o próximo passo exato, ver abaixo.**

---

## PRÓXIMO PASSO EXATO (retomar por aqui)

1. Editar `tests/checkout.golden.mjs` linhas 265-266 com as 2 regexes novas acima (usar Edit, não
   reescrever o arquivo inteiro).
2. Rodar `npm run test:domain` de novo. Prestar atenção especial a:
   - `tests/render.smoke.mjs` — faz snapshot HTML LITERAL do `DeliveryBar` (2 `<option>`s antes desta
     onda). Como a 3ª opção só aparece com `mesaHabilitada=true` e os cenários existentes desse
     snapshot certamente chamam `DeliveryBar` sem essa prop (→ `undefined`, falsy), o snapshot
     provavelmente NÃO quebrou — mas CONFIRME rodando, não presuma.
   - `tests/checkout.golden.mjs` seção (A)/(C)/(D) — os outros golden tests de `buildOrderArgs`/
     `buildOrderConfirmationMessage` chamam essas funções SEM o novo 7º parâmetro `extra` — como ele
     tem default `{}`, devem continuar passando sem alteração nenhuma, mas CONFIRME.
   - Se aparecer qualquer outra falha inesperada (não só os 2 pins já identificados), investigue antes
     de seguir — não assuma que é "mais do mesmo".
3. Quando `npm run test:domain` estiver 100% verde, considerar também rodar `npm run test:e2e`
   (Playwright) pelo menos nos specs de checkout (`e2e/tests/checkout/*.spec.js`) — ainda não usam
   Mesa (não há Page Object nem fixture pra isso, isso é trabalho de Onda 3/5 nos testes, conforme já
   mapeado na auditoria original), então o objetivo aqui é só confirmar ZERO regressão em Entrega/
   Retirada via browser real, não testar Mesa via E2E ainda.
4. Revisar o diff completo (`git diff -- <cada arquivo da Onda 2>`) mais uma vez antes de comitar.
5. `git add` EXPLICITAMENTE (nunca `-A`/`.`) exatamente estes arquivos:
   ```
   src/components/DeliveryBar.jsx
   src/pages/StoreApp.jsx
   src/components/checkout/CheckoutPage.jsx
   src/components/checkout/SuccessPage.jsx
   src/utils/orderPayload.js
   src/hooks/useMesaConfig.js
   src/services/mesa/mesaConfig.js
   tests/checkout.golden.mjs
   ```
   **NUNCA incluir** `src/constants/privacyPolicy.js` nem `scripts/loadtest-e2e.mjs` (de outra
   sessão/iniciativa — confirmar de novo com `git status` que ainda são só esses 2 "estranhos" antes
   de comitar, porque outra sessão pode ter mexido em mais coisa nesse meio-tempo).
6. Commitar como `feat(checkout): REF-MESA-01 Onda 2 -- mesa no storefront/checkout` (mensagem
   completa, estilo ASCII sem acento, ver commits anteriores desta REF pro tom exato), citando o que
   foi testado (lint/typecheck/test:domain verdes, o que ficou de fora — E2E de Mesa em si, Admin
   toggle da capability).
7. Atualizar ESTE checkpoint marcando Onda 2 como CONCLUÍDA, e prosseguir automaticamente para a
   Onda 3 (QR Code / canal do cliente) conforme o plano original do usuário — sem pedir autorização
   entre ondas (autorização já dada), só parando nas condições de parada já definidas (arquivo de
   outra sessão, necessidade de produção, ambiguidade de decisão de negócio não prevista, etc.).

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
