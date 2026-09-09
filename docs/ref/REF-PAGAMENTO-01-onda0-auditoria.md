# REF-PAGAMENTO-01 — Onda 0: Auditoria pré-implementação

**Status: ONDA 0 CONCLUÍDA.** Read-only — nenhuma migration, RPC, componente ou Edge Function
criada nesta onda. Produz o mapa de estado real (não presumido dos documentos anteriores) e a
proposta final de schema/RPCs/testes para as Ondas 1-5.

Contexto: decisões arquiteturais da etapa anterior (`docs/ref/REF-PAGAMENTO-01-arquitetura-mercadopago.md`,
commit `2b5015e`) foram formalmente aprovadas pelo dono, com 4 refinamentos novos: (1) Payment Brick
confirmado (não mais "recomendação", decisão fechada); (2) expiração de 15min para Delivery/
Retirada; (3) Mesa funciona por sessão/fechamento (já era o modelo, agora explícito); (4) **divisão
de conta de Mesa** — requisito novo, não estava na arquitetura original, especificado nesta onda.

## 1. Reconfirmação do estado do código (git, não o documento)

3 dias se passaram desde `2b5015e` (2026-09-06) até agora (2026-09-09). `git diff --stat
2b5015e..HEAD` mostra 4 commits de OUTRAS frentes, nenhuma tocando pagamento:

- `9cf2914` **INCIDENTE-01** (ver §2 — crítico para esta onda).
- `9894c44` REF-DELIVERY-FEE-05 Onda 3.4/3.5 — cache de rota autoalimentado (pg_net/pg_cron).
- `9698195` REF-ADDRESS-02 Onda 7 — retry idempotente ao salvar endereço.
- `7f8bdc3` REF-UX-BACKBUTTON-01 — botão voltar do navegador.

`create_order()`, `_resolve_delivery_fee()`, `admin_fechar_conta_mesa()`, `mesa_sessions`, todo o
schema de Mesa e o fluxo de checkout (`CheckoutPage.jsx`, `SuccessPage.jsx`, `orderPayload.js`,
`DataService.js`) permanecem **byte-a-byte idênticos** ao que a arquitetura de `2b5015e` descreveu
— confirmado por `git log --diff-filter=AM -- migrations/*.sql` e diff de arquivo, não presumido.

**Working tree no início desta onda**: `src/constants/privacyPolicy.js` (M) e
`supabase/functions/route-distance/index.ts` (M, trabalho não commitado de REF-DELIVERY-FEE-05 em
andamento agora) + `scripts/loadtest-e2e.mjs` (??) — todos de outras sessões, nenhum tocado.

## 2. INCIDENTE-01 — verificado, não presumido

`docs/adr/REF-DELIVERY-FEE-05-onda3-incidente-01.md` (2026-09-06) documenta exatamente o cenário
que o mandato desta onda pediu para investigar: a ferramenta local `C:\Users\00thi\.encanto\run.mjs`
aceitava `--env db.e2e.env` **sem implementá-lo de verdade** — `ENV_PATH` era hardcoded para
`db.env` (produção). Migrations da Onda 3.1/3.3 da REF-DELIVERY-FEE-05 foram aplicadas em produção
por engano. Contido, revertido, validado por hash de função (`create_order`/
`_resolve_delivery_fee`/`admin_orders_search` confirmados idênticos antes/depois — nenhuma delas
tocada de fato). Impacto funcional real: zero (a tabela de cache nunca chegou a ser populada, a
Edge Function de produção nunca foi deployada).

**Correção do `run.mjs` verificada nesta onda, não só lida**:
- Li o código-fonte atual — `--env` agora resolve de verdade (`resolverEnvPath`), e existe um
  guardrail (`validarAmbiente`) que compara o project ref REAL (extraído de `PGUSER`, formato
  `postgres.<ref>`) contra o ref esperado pro nome do arquivo declarado — aborta ANTES de conectar
  (`process.exit(3)`) se não bater.
- **Rodei o teste de verdade** (`node run.guard.test.mjs`, 2026-09-09): **11/11 passaram**,
  incluindo o cenário exato do incidente ("E2E declarado mas PGUSER resolve para produção →
  aborta") e o inverso ("produção declarada mas PGUSER resolve para E2E → aborta"). Não aceitei o
  documento como prova — rodei o teste eu mesmo.
- Existe também `C:\Users\00thi\.encanto\run-e2e.mjs` — versão AINDA MAIS segura, sem nenhum flag
  `--env`: `ENV_PATH` hardcoded pra `db.e2e.env`, estruturalmente impossível de apontar pra
  produção por engano (nenhum parâmetro pra errar).

**Política adotada para toda esta REF**: preferir `run-e2e.mjs` (zero ambiguidade estrutural) para
qualquer SQL cru fora dos scripts de teste `.mjs` já usados desde REF-MESA-01/02 (que sempre leem
`db.e2e.env` diretamente via `readFileSync` próprio — confirmado pelo próprio INCIDENTE-01 como o
padrão que, por não depender de `run.mjs`, nunca foi afetado). Se `run.mjs --env db.e2e.env` for
usado por algum motivo, **sempre conferir a linha impressa `[run.mjs] --env=... | projeto=...`
bate com `bgzcrovskjbktdxkhemd`** antes de considerar qualquer resultado válido.

## 3. Checkout atual — ponto de integração exato

`CheckoutPage.jsx::submit()` (linhas 144-259): fluxo hoje é
`buildOrderArgs → DS.savePedido (create_order) → orderId confirmado → buildOrderConfirmationMessage
→ cart.clear() → onSuccess(msg)` (que monta `SuccessPage`, abre WhatsApp automaticamente).

**Ponto de integração**: entre `orderId` confirmado (linha 232) e `cart.clear()`/`onSuccess(msg)`
(linhas 257-258). Para um pedido com método online, este é o ponto exato onde o fluxo precisa
desviar: em vez de ir direto pro sucesso, renderizar o Payment Brick (cartão) ou o QR (Pix) e
aguardar confirmação real antes de chamar `onSuccess`. **Nenhuma mudança na lógica ANTES desse
ponto é necessária** — `buildOrderArgs`/`create_order` continuam gerando o pedido exatamente como
hoje, com `orders.status='aguardando_pagamento'` em vez de `'recebido'` quando o método for online
(única mudança de comportamento em `create_order`, ver §6).

## 4. Mesa — schema real (re-lido, não presumido)

Confirmado por leitura direta de `migrations/REF-MESA-02-onda11-fechar-conta.sql` (última versão
viva, nenhuma migration posterior tocou):
- `_calcular_total_sessao_mesa(p_mesa_session_id, p_store_id)` — `SUM(orders.total) FILTER (WHERE
  status <> 'cancelado')`, função interna reaproveitável, **não será duplicada**.
- `admin_fechar_conta_mesa(p_mesa_session_id, p_payment_method, p_store_id)` — hoje exige UM
  `payment_method` só, grava `mesa_sessions.payment_method`/`valor_cobrado_snapshot`, fecha a
  sessão (dispara a trigger que libera as mesas). **Este é o caminho "sem divisão" — precisa
  continuar funcionando EXATAMENTE assim, é o caso majoritário.**
- `mesa_sessions` já tem `closed_by_admin_user_id` (auditoria de quem fechou) — mesmo padrão que a
  nova estrutura de divisão vai reaproveitar (§5).

## 5. Proposta de schema — divisão de conta de Mesa (novo requisito, §1.12 do mandato)

**Diferenciação preservada, conforme exigido**: isto é "dividir a conta entre pessoas presentes",
NUNCA "Split Mercado Pago entre recebedores" (VALION vs. restaurante) — são conceitos
completamente diferentes, o 2º não é implementado nesta REF (§10 da arquitetura de `2b5015e`,
inalterado).

**Desenho (aditivo, reaproveita `_calcular_total_sessao_mesa`, não duplica)**:

```sql
mesa_session_payment_allocations (nome provisório)
  id uuid PK
  mesa_session_id uuid FK -> mesa_sessions(id)
  store_id uuid                    -- redundante de propósito, mesmo padrão de mesa_session_mesas
  valor numeric(10,2)              -- a fatia desta pessoa
  metodo text                      -- dinheiro/pix/cartao_debito/cartao_credito/pix_online/cartao_online
  status text                      -- 'pendente' | 'pago'
  payment_intent_id uuid NULL FK -> payment_intents(id)   -- só preenchido se metodo for online
  paga_em timestamptz NULL
  registrada_por_admin_user_id uuid NULL   -- quem confirmou (presencial) -- mesmo padrão de closed_by_admin_user_id
  criada_em timestamptz DEFAULT now()
```

**RPCs novas (nenhuma existente é modificada em comportamento no caminho sem divisão)**:
- `admin_dividir_conta_mesa(p_mesa_session_id, p_alocacoes jsonb, p_store_id)` — recebe a lista de
  fatias (ex.: `[{valor:40},{valor:30},{valor:30}]` ou por item — decisão de UX de onda futura,
  schema já suporta ambos porque `valor` é sempre o resultado final, nunca a regra de derivação).
  **Valida `SUM(valor) = _calcular_total_sessao_mesa(...)` (autoritativo, nunca confia em valor do
  client) — se não bater exatamente, rejeita** (arredondamento é responsabilidade do CLIENTE propor
  e do SERVIDOR confirmar, nunca o servidor "ajusta" silenciosamente uma diferença). Cria N linhas
  `pendente`.
- `admin_registrar_pagamento_alocacao(p_alocacao_id, p_metodo, p_store_id)` — confirma UMA fatia
  como paga (presencial, admin-gated, `is_admin_of`) — para fatia online, esta mesma transição
  acontece via webhook (server-side, nunca client-facing) quando `payment_intent` correspondente
  aprovar.
- **`admin_fechar_conta_mesa` ganha 1 guarda nova, aditiva**: se a sessão tem QUALQUER linha em
  `mesa_session_payment_allocations`, exige TODAS `status='pago'` antes de permitir o fechamento
  (substitui a exigência de `p_payment_method` único nesse caso). Se a sessão NÃO tem nenhuma linha
  (caminho de hoje, sem divisão), comportamento **100% inalterado**.

**Por que este design não duplica nem quebra nada**: `orders`/`create_order()` nunca sabem que uma
divisão está acontecendo — a divisão vive inteiramente no nível da SESSÃO (fechamento), exatamente
onde `admin_fechar_conta_mesa` já opera hoje. Histórico de pedidos individuais permanece intocado
(`orders.mesa_session_id` imutável, como sempre foi desde a Onda 3 da REF-MESA-02).

## 6. `orders.status='aguardando_pagamento'` — único novo valor, opt-in

Confirmado no schema atual: `orders.status` é `text` livre (sem enum/CHECK), mesmo padrão já
documentado pra `payment_method`. Adicionar um valor novo não exige migration de tipo — só disciplina
de uso. `create_order()` precisa de UMA mudança condicional: quando
`pagamento_online_habilitada=true` E o método escolhido for `pix_online`/`cartao_online`, gravar
`status='aguardando_pagamento'` em vez de `'recebido'`. **Isso é a única mudança prevista dentro de
`create_order()` em toda a REF** — tudo o resto é aditivo em cima (RPCs novas, tabelas novas). Puro
opt-in: nenhuma loja sem a capability, nenhum pedido COD, é afetado.

## 7. Decisão técnica: geração de API do Mercado Pago

Pesquisa adicional na doc oficial confirma: Payment Brick usa hoje o endpoint **`/v1/orders`
(Orders API)**, com `processing_mode` (manual/automático) definido na criação — a doc oficial
declara explicitamente que o Mercado Pago está migrando sua integração recomendada pra essa API. **A
Onda 1/2 desta REF usa a Orders API**, não a `/v1/payments` clássica — resolve a ambiguidade deixada
em aberto em `2b5015e` §17.2. Isso muda nomenclatura interna (ex.: o objeto principal do Mercado
Pago se chama "order", não "payment") — `payment_intents.mp_payment_id` (nome já genérico o
suficiente, guarda o id do recurso independente de qual API o criou).

## 8. Bloqueio real e concreto: credenciais do Mercado Pago

**A Onda 2 (chamada real à API do Mercado Pago, mesmo em sandbox) não pode ser executada por mim.**
Confirmado na pesquisa da etapa anterior: é preciso que o dono crie uma aplicação no painel do
Mercado Pago Developers e gere credenciais de TESTE (Public Key + Access Token do ambiente sandbox).
Nenhuma credencial foi solicitada nesta sessão (nem seria aceita por chat, por instrução explícita).
**Classificação: BLOQUEADO POR CREDENCIAL** — não é algo que autonomia resolve, é uma ação humana
fora do meu alcance (criar conta/aplicação no painel de um 3º provedor).

**Consequência pro sequenciamento**: reorganizei as ondas propostas em `2b5015e` §14 pra separar o
que é possível **sem** credencial do que **depende** dela:
- **Sem credencial (posso fazer agora)**: Onda 1 (schema — `payment_intents`,
  `orders.payment_status`, `mesa_session_payment_allocations`, capability, RLS/grants), a lógica de
  validação HMAC do webhook (testável com um secret FALSO gerado localmente, só a matemática da
  assinatura — não uma chamada real), a máquina de estados/RPCs de divisão de Mesa (fatias
  presenciais funcionam 100% sem nenhum gateway).
- **Depende de credencial (bloqueado até o dono agir)**: Onda 2 real (criar cobrança de verdade
  contra o sandbox), Onda 3 real (Payment Brick de fato renderizando/tokenizando — precisa da
  `public_key` de teste), teste ponta-a-ponta do webhook contra o simulador oficial do Mercado Pago.

## 9. Máquina de estados — nomenclatura confirmada

O mandato desta onda propôs `PENDING/PROCESSING/APPROVED/REJECTED/EXPIRED` em inglês/maiúsculo
como exemplo conceitual, mas todo o resto do schema do projeto (todas as 40+ REFs anteriores) usa
**português minúsculo** (`aberta`/`fechada`, `recebido`/`preparando`, `pendente`/`aprovado` já em
uso em outras RPCs). Mantenho consistência com a convenção existente do projeto:
`pendente → aprovado | recusado | expirado`, e `aprovado → em_contestacao → estornado`
(inalterado de `2b5015e` §5) — mesmo conceito do mandato, nomenclatura consistente com o resto da
base. `payment_intents.status`/`status_detail` continuam guardando o valor CRU do Mercado Pago sem
tradução (auditoria), como já especificado.

## 10. Expiração de 15 minutos — verificação pendente, não assumida

Direção aprovada pelo dono: 15 minutos para `payment_intent` de Delivery/Retirada. Documentado
explicitamente (mandato §1.10) que isso é a política INTERNA do Encanto, não necessariamente igual
ao timeout nativo do Mercado Pago (que varia por método — Pix tem expiração própria configurável na
criação da order/payment; cartão não "expira" da mesma forma, é aprovado/recusado quase
imediatamente). **Mecanismo proposto**: `payment_intents` ganha implicitamente uma expiração
verificável por `created_at + 15min` — um job (`pg_cron`, mesmo mecanismo já usado por
REF-ORDER-01/REF-DELIVERY-FEE-05 pra tarefas periódicas, nenhuma tecnologia nova) varre
`payment_intents` em `pendente` há mais de 15min sem confirmação e transiciona pra `expirado` +
cancela o `order` associado (novo status `cancelado_expirado` ou reaproveita `cancelado` existente
— decisão de nomenclatura pra Onda 1). **Não implementado nesta onda** — só desenhado, pois depende
da Onda 1 existir primeiro.

## 11. Segredos — nenhum criado, política confirmada

Nenhum secret foi solicitado, colado ou criado nesta sessão. Mantida a decisão de `2b5015e` §3:
`mp_access_token`/webhook secret SOMENTE no Supabase Vault (mesmo mecanismo já em uso pelo WhatsApp
Cloud API desde REF-ORDER-01 — não é tecnologia nova). `mp_public_key` pode ir em `store_settings`
(seguro por design do próprio Mercado Pago).

## 12. Matriz de testes proposta (referência às Ondas 1-5)

Ver `2b5015e` §11 (threat model) e o mandato desta continuidade §8 — nenhuma mudança na lista, só
uma adição: testes de **divisão de conta** (SUM(alocações)≠total rejeitado, fechamento bloqueado
com alocação pendente, alocação de outra sessão/loja rejeitada, pagamento presencial vs. online
convivendo na mesma sessão, arredondamento determinístico servidor-side).

## 13. Riscos e conflitos com REFs existentes

- **REF-DELIVERY-FEE-05 está ativa agora** (working tree tem `route-distance/index.ts` modificado,
  não commitado) — zero sobreposição de arquivo com esta REF, mas reforça a necessidade de
  `git status`/diff antes de QUALQUER commit desta REF, sempre.
- **Nenhum conflito de schema** — `payment_intents`/`mesa_session_payment_allocations` são tabelas
  novas, `orders.payment_status` é coluna nova nullable, zero colisão com trabalho de outra REF.
- **Risco real**: é a primeira vez que este projeto lida com dinheiro passando de fato por um
  gateway externo — por isso Onda 1 (schema) será tratada com o MESMO rigor de
  apply→rollback→reapply testado já usado em toda REF anterior, mesmo sendo "só" schema.

## 14. Proposta final de migrations/RPCs/Edge Functions (Onda 1 em diante)

Ver §5-§10 acima — consolidado: **Onda 1** cria `payment_intents`,
`mesa_session_payment_allocations`, `orders.payment_status`, capability
`pagamento_online_habilitada` + `mp_public_key` em `store_settings`, RLS/grants em ambas as tabelas
novas, e as 2 RPCs de divisão de Mesa (`admin_dividir_conta_mesa`,
`admin_registrar_pagamento_alocacao`) + o guard aditivo em `admin_fechar_conta_mesa`. **Onda 2+**
(RPC de criação de cobrança real, Edge Function de integração, webhook) ficam **bloqueadas** até o
dono fornecer credenciais de teste do Mercado Pago (§8).

## 15. Confirmação do ambiente E2E

`C:\Users\00thi\.encanto\db.e2e.env` resolve pro projeto `bgzcrovskjbktdxkhemd` (encanto-e2e) —
mesmo projeto usado em toda REF-MESA-01/02, confirmado pelo mapeamento `REF_ESPERADO_POR_ARQUIVO`
em `run.mjs` e pela disciplina já estabelecida (nunca `db.env`). Ferramenta de proteção verificada
com teste real rodado nesta onda (§2). Nenhuma operação mutável foi executada ainda — Onda 1 será a
primeira, e vai imprimir/confirmar o projeto-alvo antes de qualquer `CREATE TABLE`.

---

## Conclusão da Onda 0

Sem bloqueio estrutural que impeça iniciar a Onda 1 (schema, sem credencial de gateway necessária).
Prosseguindo autonomamente para a Onda 1 conforme autorização do mandato (§14: "Se não houver
bloqueio estrutural, você pode seguir autonomamente"). O bloqueio real e documentado (§8,
credenciais do Mercado Pago) afeta só a Onda 2 em diante, não a fundação de schema.
