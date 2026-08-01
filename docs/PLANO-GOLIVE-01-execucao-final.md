# PLANO-GOLIVE-01 — Plano Final de Execução (Operação Definitiva: Web + APK Android)

**Autor:** Arquiteto Técnico (sessão Claude Code) · **Data:** 2026-07-31 · **Tipo:** Roadmap de execução, não uma ADR de arquitetura — nenhuma decisão de design é tomada aqui, apenas priorização e sequenciamento do que falta.

**Regra de ouro deste plano:** preservar a arquitetura estabilizada. Nenhum item abaixo propõe refatoração, redesenho ou novo módulo. Onde havia dúvida entre "consertar agora" e "registrar como backlog consciente", a resposta default foi backlog — condizente com a instrução explícita do dono de minimizar risco de regressão na reta final.

---

## 0. Método — o que foi auditado antes de escrever este plano

Antes de priorizar qualquer coisa, verifiquei o estado real (não só a memória de sessões anteriores) do repositório e do banco de produção, **somente leitura**, sem alterar nada:

| Verificação | Método | Resultado |
|---|---|---|
| Grants das RPCs de notificação WhatsApp (`enc_claim_notifications`, `enc_enqueue_notification`, `enc_dispatch_notifications`) | `has_function_privilege()` ao vivo em produção | **`anon`=false, `authenticated`=false, `service_role`=true** nas 3 — migration `REF-ORDER-01c-notif-grants-harden.sql` está **aplicada**. Vazamento de PII documentado na auditoria REF-AUDIT-01 está **fechado**. |
| Secrets do Vault (`whatsapp_token`, `whatsapp_phone_number_id`, `whatsapp_api_version`) | `select name from vault.secrets` | **Nenhum existe ainda.** Dispatcher continua em modo degradado (no-op seguro), como desenhado. |
| Job `enc-dispatch-whatsapp` (pg_cron) | `select * from cron.job` | **Ativo**, rodando a cada 30s. |
| Fila `notification_outbox` | contagem por status | Linhas reais existem (pedidos passando por recebido/preparo/pronto/entrega/entregue) — a fila está sendo alimentada normalmente pelo trigger; só falta o envio de fato. |
| CHECK `orders_status_valid` | `pg_get_constraintdef` | Contém os 6 estados corretos, incluindo `pronto`. |
| Secrets do Vault relacionados a Mapbox | `select name ... ilike '%mapbox%'` | Nenhum — confirma que hoje a cadeia efetiva é Nominatim → Photon → gazetteer local, como o dono relatou. |
| Bundle de produção | `npm run build` limpo, hoje | 612 módulos; chunk único `index-*.js` = **614.13 kB / 174.07 kB gzip**; aviso do Vite (>500 kB) persiste; PWA precache 18 entries / 1261 KiB. |
| `StoreApp.jsx` | contagem de linhas, hoje | **682 linhas** (era ~664 na última medição registrada; cresceu com os ganchos `forwardRef`/`useImperativeHandle` do REF-CAP-01). |
| Suíte de domínio | `npm run test:domain`, hoje | **32/32 scripts verdes.** |
| Suíte E2E | contagem de arquivos | **40 specs** em `e2e/tests/`. |
| Estado do git | `git status` / `git log` | Branch `main`, working tree limpo, HEAD = `a946889` (REF-CAP-01 Onda 7 — publica o APK homologado). |
| Documentação pendente conhecida | `docs/ref/REF-CAP-01-progress.md` | Onda 8 (consolidação de ADR/progress) segue `⏳ PENDENTE` — é só texto, zero código. |

Essas verificações substituem suposições por fatos e mudam a prioridade de dois itens que o dono listou como incertos (Mapbox e WhatsApp) — ver §2.

---

## 0.1 — Auditoria completa das 34 migrations sensíveis (Onda A1, execução autônoma, 2026-07-31)

Executada como primeira atividade da Fase A (`PLANO-GOLIVE-01B`, item A1) — fecha o item P0.1 do checklist de Go-Live. Método: um snapshot único e consolidado do schema de produção (funções, colunas de todas as tabelas-chave, triggers, constraints, políticas RLS, `pg_cron`), somente leitura, cruzado contra o que cada migration em `migrations/*.sql` (excluindo rollbacks) declara criar/alterar. Onde o snapshot geral não bastou, rodei uma segunda rodada de consultas pontuais (tipos de coluna, `prosecdef`, corpo de função via `prosrc`, comparação de dados).

| Migration | Status | Evidência |
|---|---|---|
| `AUTH-01-step1-fundacao.sql` | ✅ CONFIRMADA | `admins` (id, user_id, created_at) + `customers.auth_user_id` existem |
| `AUTH-01-step2-harden-rls.sql` | ✅ CONFIRMADA | Políticas RLS em `customers` ativas (`Admin all customers`, `Cliente le proprio customer`), `relrowsecurity=true` |
| `AUTH-01-step3-harden-orders-rls.sql` | ✅ CONFIRMADA | Políticas RLS em `orders`/`order_items` ativas e com os roles corretos |
| `HARDEN-ORDERS-RLS-step1.sql` | ✅ CONFIRMADA | Mesma cadeia de políticas confirmada acima |
| `HARDEN-ORDERS-RLS-step2.sql` | ✅ CONFIRMADA | Idem |
| `LOGIN-ARCH-02.1-hybrid-auth.sql` | ✅ CONFIRMADA | `link_customer_to_auth()` existe |
| `NORM-05-fonte-unica.sql` | ✅ CONFIRMADA | `adicionais` com `subgrupo_label`/`aplica_categoria_id` presentes |
| `NORM-06-F1A-step2/3/4.sql` | ✅ CONFIRMADA | `products.categoria_ids`, `categories.tipo/estrategia/definicao`, triggers STI presentes |
| `NORM-06-F1B-step1.sql` | ✅ CONFIRMADA | `trg_sti_adicional_categoria`, `trg_sti_pc_collection` existem |
| `NORM-06-F1B-errata-01-securitydefiner.sql` | ✅ CONFIRMADA | As 4 funções STI têm `prosecdef=true` |
| `NORM-06.1-step1.sql` | ✅ CONFIRMADA | Parte da mesma cadeia RLS confirmada acima |
| `PRICE-DOMAIN-01-backfill-preco-espelho.sql` | ✅ CONFIRMADA | 12/12 produtos com `tamanhos[]` têm `preco = MIN(tamanhos[].preco)` exato |
| `REF-ADDRESS-02-onda1-schema.sql` | ✅ CONFIRMADA | Colunas estruturadas (`rua`,`numero`,`bairro`,`confidence`,`provider`,...) em `addresses` |
| `REF-ADDRESS-02-onda4-gazetteer.sql` | ✅ CONFIRMADA | Tabela `address_gazetteer` existe |
| `REF-ADDRESS-02-onda6-create-order.sql` | ✅ CONFIRMADA | `create_order()` + `orders.endereco_id` existem |
| **`REF-ADMIN-03-categoria-delete-guard.sql`** | 🔴 **GAP — NÃO APLICADA** | Trigger `trg_categoria_delete` e função `trg_categoria_delete_guard()` **não existem** em produção — ver §0.2 |
| `REF-ADMIN-03-orders-scale.sql` | ✅ CONFIRMADA | `admin_orders_search()`/`admin_orders_stats()` existem (já confirmada por `REF-REGRESSION-01`) |
| `REF-ADMIN-CATALOG-01-catalog.sql` | ✅ CONFIRMADA | `products.categoria_ids` existe |
| `REF-BOOT-02-cleanup-drop-boot-diag.sql` | ✅ CONFIRMADA | Tabela `boot_diag` ausente do schema — confirma o `DROP` aplicado |
| `REF-BUSINESS-HOURS-03-store-mode-rpc.sql` | ✅ CONFIRMADA | `get_store_mode()`/`set_store_mode()` existem |
| `REF-CLIENTE-02-order-events-rls.sql` | ✅ CONFIRMADA | Política `order_events_read_own` ativa |
| `REF-COMANDA-ENDERECO-01-admin-order-endereco.sql` | ✅ CONFIRMADA | `admin_order_endereco()` existe |
| `REF-COMPANY-01-institutional-info.sql` | ✅ CONFIRMADA | `get_company_info()`/`set_company_info()` existem |
| `REF-COMPANY-02-nome-split.sql` | ✅ CONFIRMADA | `settings.company_info` tem as chaves `nomeCurto` e `nomeCompleto` |
| `REF-COMPANY-02-notify-empresa.sql` | ✅ CONFIRMADA | `enc_enqueue_notification()` chama `get_company_info()`; `enc_render_message()` usa o placeholder `{{empresa}}` |
| `REF-DATETIME-01-orders-health-fix.sql` | ✅ CONFIRMADA | `orders_health()` existe |
| `REF-DATETIME-01b-schema-timestamptz.sql` | ✅ CONFIRMADA | Todas as colunas `created_at`/`sent_at`/etc. são `timestamp with time zone` |
| `REF-DELIVERY-01-delivery-eta-rpc.sql` | ✅ CONFIRMADA | `set_delivery_eta()` existe |
| `REF-DELIVERY-01a-get-delivery-eta-reader.sql` | ✅ CONFIRMADA | `get_delivery_eta()` existe |
| `REF-LOYALTY-01-loyalty.sql` | ✅ CONFIRMADA | `loyalty_accounts`/`loyalty_events` + `get_my_loyalty()`/`redeem_reward()`/`loyalty_grant()` existem |
| `REF-LOYALTY-01a-link-hardening.sql` | ✅ CONFIRMADA | `admin_link_customer_to_auth()` existe |
| `REF-ORDER-01-order-ops.sql` | ✅ CONFIRMADA | `orders_status_valid` com os 6 estados, `notification_outbox`, triggers de notificação |
| `REF-ORDER-01b-whatsapp-dispatch.sql` | ✅ CONFIRMADA | Funções de dispatch + `pg_cron` `enc-dispatch-whatsapp` ativo |
| `REF-ORDER-01c-notif-grants-harden.sql` | ✅ CONFIRMADA | Grants corretos (verificado 2x nesta sessão) |

**Resultado: 33/34 confirmadas aplicadas em produção. 1 gap real encontrado.**

### 0.2 — Gap encontrado e FECHADO: `REF-ADMIN-03-categoria-delete-guard.sql`

**Status: ✅ APLICADA EM PRODUÇÃO em 2026-08-01**, via Supabase Management API (token fornecido pelo dono para esta etapa específica), com autorização explícita. Ver §0.2.2 para o relatório completo de aplicação e validação.

**O que a migration faz:** cria uma trigger `BEFORE DELETE ON categories` que bloqueia a exclusão de uma categoria ainda referenciada por `products.categoria_ids` (array, sem suporte a FK nativa do Postgres) — é um backstop de integridade no banco, no mesmo estilo das triggers STI já existentes (`NORM-06-F1B`).

**Severidade real (não é uma falha ativa nem um incidente):** o próprio ADR de origem documenta que a única proteção hoje é um guard **de aplicação** (`DS.delCat`, que conta produtos via `.contains()` antes do `DELETE`) — ou seja, o caminho normal do Admin (a única forma de deletar categoria no produto hoje) já impede o caso comum. O que falta é só o backstop de banco para escrita fora da aplicação (SQL direto, uma futura API). **Não bloqueia o go-live**, mas deveria ser fechado antes de declarar "operação definitiva" por ser justamente o tipo de proteção que existe para nunca ser precisa.

**Ação necessária (Fase B / item B1 de `PLANO-GOLIVE-01B`):** rodar `migrations/REF-ADMIN-03-categoria-delete-guard.sql` no SQL editor do Supabase — arquivo já existe, pronto, idempotente (`CREATE OR REPLACE`), com rollback em arquivo separado. Não depende de nenhuma outra mudança.

**Nota de corroboração:** o E2E `admin-categorias.spec.js:115` ("DB: trigger `trg_categoria_delete` bloqueia o DELETE mesmo direto pelo backend") passa 100% contra o projeto Supabase dedicado de E2E — confirma que a trigger funciona corretamente quando aplicada; reforça que o gap é só a aplicação em produção, não um problema de design ou implementação.

### 0.2.1 — Dossiê de aplicação (reauditoria em 2026-07-31, antes da execução pelo dono)

**Reconfirmação ao vivo (read-only, momentos antes deste dossiê):** trigger, função e índice continuam ausentes em produção — gap ainda aberto, nada mudou desde a auditoria original.

**1. Idempotência:** total. As 3 operações usam formas idempotentes nativas do Postgres — `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `CREATE OR REPLACE TRIGGER`. Rodar a migration 2x seguidas produz o mesmo estado final sem erro. Todo o corpo está dentro de `BEGIN;`/`COMMIT;` — aplica tudo ou nada (se qualquer instrução falhar, nenhuma fica meio-aplicada).

**2. Conflito com migrations posteriores:** nenhum. Busquei em **todo** `migrations/*.sql` por qualquer arquivo que toque a tabela `categories` — só 4 aparecem (`REF-ADMIN-CATALOG-01`, `AUTH-01-step2-harden-rls`, `NORM-06.1-step1`, `NORM-06-F1B-step1`), todos **anteriores** a esta migration e nenhum cria trigger `BEFORE DELETE` nem usa os nomes `trg_categoria_delete`/`trg_categoria_delete_guard`/`products_categoria_ids_gin_idx` — únicos a esses 2 arquivos (o principal e o rollback). Confirmado também ao vivo: os únicos triggers hoje em `categories`/`products` são os STI (`trg_sti_categoria_tipo` BEFORE UPDATE, `trg_sti_product_categoria` BEFORE INSERT/UPDATE) — nenhum é BEFORE DELETE, zero sobreposição. Os únicos índices hoje em `products` são `products_pkey` e `unique_nome_categoria` — sem colisão de nome com o índice novo.

**3. Impacto esperado em produção:**
- **Estrutural:** cria 1 índice GIN (`products_categoria_ids_gin_idx`) + 1 função + 1 trigger `BEFORE DELETE ON categories`. Não altera nenhuma coluna, tabela, policy ou dado existente.
- **Comportamental:** de agora em diante, um `DELETE` em `categories` cuja linha ainda seja referenciada por `products.categoria_ids` de **qualquer** produto passa a ser **recusado pelo banco** (exceção `check_violation`), em vez de silenciosamente suceder e deixar `categoria_ids` órfão. Só afeta `DELETE` de categoria — zero efeito em `SELECT`/`INSERT`/`UPDATE`, checkout, catálogo, pedidos ou qualquer leitura.
- **No dia a dia do Admin:** nenhuma mudança perceptível. O guard de aplicação (`DS.delCat`) já barra esse mesmo caso ANTES de chegar ao banco, com uma mensagem amigável — a trigger só age se esse caminho normal for contornado (SQL direto, bug futuro, API futura). Volume atual (medido ao vivo): 9 categorias, 38 produtos, tabela `products` com 72 kB — a criação do índice é praticamente instantânea (só 1 conexão ativa no banco no momento da checagem, sem contenção esperada).
- **Lock:** `CREATE INDEX` (sem `CONCURRENTLY`) toma um lock que bloqueia escritas em `products` durante a construção do índice — irrelevante na prática dado o tamanho da tabela (frações de segundo), mas registrado por honestidade. Não há downtime de leitura em nenhum momento.

**4. Procedimento de aplicação (Supabase SQL Editor):**
1. Abrir o **Supabase Dashboard do projeto de PRODUÇÃO** (conferir o nome/ref do projeto antes de colar — nunca o projeto `encanto-e2e`) → SQL Editor.
2. Colar o conteúdo integral de `migrations/REF-ADMIN-03-categoria-delete-guard.sql` (já vem com `BEGIN`/`COMMIT` — não envolver em outra transação).
3. Executar. Sucesso esperado: `Success. No rows returned` (mesma assinatura das demais migrations já aplicadas neste projeto).

**5. Validação pós-aplicação (read-only, copiar/colar no SQL Editor):**
```sql
-- (a) indice criado
SELECT indexname FROM pg_indexes WHERE tablename='products' AND indexname='products_categoria_ids_gin_idx';
-- (b) trigger criada
SELECT tgname FROM pg_trigger WHERE tgrelid='public.categories'::regclass AND NOT tgisinternal;
-- deve listar trg_categoria_delete
```
Teste funcional **seguro e não-destrutivo** (já vem pronto nos comentários finais do próprio arquivo da migration — cria categoria+produto de teste, tenta deletar, espera falha, e desfaz tudo com `ROLLBACK`, nunca persiste nada):
```sql
BEGIN;
  INSERT INTO categories(id,nome,ordem,ativo,slug,tipo) VALUES ('zz_test','zz_test',999,true,'zz-test-verif','business');
  INSERT INTO products(id,nome,descricao,preco,categoria_id,categoria_ids,disponivel,adicionais_gratis)
    VALUES (gen_random_uuid(),'zz_test_prod','x',1,'zz_test',ARRAY['zz_test'],true,0);
  DELETE FROM categories WHERE id='zz_test'; -- deve falhar com check_violation
ROLLBACK;
```
Se a linha `DELETE` devolver o erro `categoria zz_test(zz_test) nao pode ser excluida: 1 produto(s) a referenciam via categoria_ids`, a proteção está ativa e confirmada.

**6. Testes mínimos após aplicar:**
- O teste funcional seguro do item 5 (suficiente como evidência formal — já é o mesmo desenho usado pelo E2E dedicado, só que direto em produção e auto-reversível).
- 1 checagem manual rápida no Admin real: tentar excluir uma categoria que hoje tem produtos (ex.: qualquer uma das 8 categorias com produtos) e confirmar que a mensagem de erro amigável de sempre continua aparecendo, sem mudança de comportamento visível — prova que o guard de aplicação e o novo guard de banco não conflitam.
- **Não é necessário** rodar a suíte de domínio, `test:db-guards` ou E2E de novo por causa desta migration especificamente — é uma mudança isolada de banco, sem nenhuma linha de código de app envolvida, e a cobertura funcional (`admin-categorias.spec.js:115`) já está validada no projeto E2E dedicado (nota acima). Se quiser reconfirmar por excesso de cautela, o comando é `npx playwright test e2e/tests/admin/admin-categorias.spec.js --config=e2e/playwright.config.js --project=chromium` — mas roda contra o projeto E2E dedicado, não produção, então não serve como prova da aplicação em si (só da lógica, que já está provada).

**7. Rollback, se necessário:** `migrations/REF-ADMIN-03-categoria-delete-guard-rollback.sql` — remove exatamente trigger + função + índice, atômico, não toca em mais nada.

### 0.2.2 — Relatório de aplicação (2026-08-01)

Aplicada pela sessão, com autorização explícita do dono e token da Management API do Supabase fornecido para esta etapa específica (não a conexão Postgres direta local, que segue sem privilégio de escrita). Projeto de produção confirmado antes de qualquer escrita via `GET /v1/projects` (nome "Açai", ref `hvbcdxsagkjtfjwvnslo` — o mesmo ref que já aparecia nas checagens read-only desta sessão desde a auditoria original; `encanto-e2e` listado à parte, nunca tocado).

| Etapa | Resultado |
|---|---|
| Preflight (Management API, read-only) | Cruzado com a conexão direta: gap ainda aberto, 9 categorias/38 produtos — bate exato |
| Aplicação (`POST /database/query` com o SQL integral da migration) | HTTP 201, corpo vazio (mesma assinatura de sucesso de uma migration sem `SELECT`) |
| Validação de objetos (índice/função/trigger) | Confirmada 2x, por 2 caminhos independentes (Management API e conexão pg direta): `products_categoria_ids_gin_idx`, `trg_categoria_delete_guard`, `trg_categoria_delete` — todos presentes |
| Teste funcional seguro (`BEGIN`/2 `INSERT`/`DELETE`/`ROLLBACK`) | `DELETE` recusado com `ERROR 23514: categoria zz_test(zz_test) nao pode ser excluida: 1 produto(s) a referenciam via categoria_ids` — exatamente a mensagem prevista no dossiê |
| Confirmação de zero dado persistido | Busca direta por `id='zz_test'`/`slug='zz-test-verif'`/`nome='zz_test_prod'` — **0 linhas** nas duas tabelas; contagem total inalterada (9 categorias, 38 produtos, antes e depois) |
| Regressão (`npm run test:f1b`, mesma suíte que exercita `categories`/`products`) | **Idêntico ao baseline pré-migration:** 19 PASS · 3 FAIL (as mesmas 3 falhas conhecidas e pré-existentes, RA1-RA3, limitação do harness local — não relacionadas a esta migration) · 1 SKIP. O teste de concorrência `C1·concorrencia` (TOCTOU em `categories`) segue PASS, sem interferência entre a trigger nova e as triggers STI existentes |

**Gap oficialmente encerrado.** As 34 migrations sensíveis auditadas em §0.1 estão agora 34/34 confirmadas aplicadas em produção.

**Nota de segurança:** o token da Management API foi usado só nesta etapa, nunca escrito em arquivo persistente do repositório nem em nenhum commit. Por ter sido colado em texto puro na conversa, **recomenda-se revogá-lo/regenerá-lo no painel do Supabase após esta sessão** (mesmo cuidado já registrado antes neste projeto para outras credenciais coladas em chat, ver `REF-CAP-01-app-nativo-android.md`).

---

## 0.3 — Onda A5: revisão de acessibilidade focada (login, checkout, checkout admin) — execução autônoma, 2026-07-31

Única atividade da Fase A que altera código de produto (as demais Ondas foram auditoria/config/documentação). Escopo: fluxos que geram receita ou são pré-requisito de conta — exatamente o que `PLANO-GOLIVE-01B` (item A5) definiu, nada além disso.

**Achados e correções (todas aditivas — nenhuma classe/CSS/comportamento existente removido ou alterado):**

| Arquivo | Achado | Correção |
|---|---|---|
| `components/checkout/CheckoutPage.jsx` | Labels (Nome, WhatsApp, Troco, Observações) não associados aos inputs (sem `htmlFor`/`id`) — leitor de tela não anuncia o rótulo ao focar o campo | `id`/`htmlFor` pareados nos 4 campos |
| `components/checkout/CheckoutPage.jsx` | Seletor de forma de pagamento (`.payment-opt`, `<div onClick>`) **sem nenhum suporte a teclado** — impossível de operar sem mouse/touch | `role="radiogroup"`/`role="radio"`/`aria-checked`/`tabIndex={0}` + handler de teclado (Enter/Espaço); ícone decorativo marcado `aria-hidden`; anel de foco novo em `index.css` (`.payment-opt:focus-visible`, mesmo padrão já usado em `.catnav-trigger`/`.delivery-mode-dropdown`) |
| `components/checkout/CheckoutPage.jsx` | Erro de validação (`checkout-erro`) não é anunciado ao aparecer (fora de live region) | `role="alert"` |
| `components/menu/LoginScreen.jsx` | Input de e-mail sem rótulo algum (só placeholder, que não é substituto de label) | `aria-label="E-mail"` (zero mudança visual) |
| `components/menu/LoginScreen.jsx` | 3 mensagens de erro (opções/e-mail/código) fora de live region | `role="alert"` nas 3 |
| `components/menu/ScreenModal.jsx` (compartilhado por 8 telas: Login, Minha Conta, Meus Pedidos, Fidelidade, Contato, Sobre, Termos, Completar Cadastro) | Sem semântica de diálogo (`role="dialog"`/`aria-modal`/`aria-labelledby`); sem fechar via Esc | Adicionados os 3 atributos + handler de `Escape` → `onClose`. `aria-labelledby` usa `useId()` (não um `id` estático) porque `CompletarCadastro` pode renderizar simultaneamente com outro `ScreenModal` (ex.: login logo após 1º acesso via Google) — `id` fixo causaria duplicação inválida no DOM |
| `components/menu/CompletarCadastro.jsx` | Inputs de nome/telefone sem rótulo; erro fora de live region | `aria-label` nos 2 inputs + `role="alert"` no erro (mesmo padrão dos demais) |
| `components/admin/AdminLogin.jsx` | Labels (E-mail, Senha) não associados aos inputs; erro fora de live region | `id`/`htmlFor` pareados + `role="alert"` |

**Validação:** `render.smoke` não cobre nenhum destes componentes (confirmado antes de editar — zero risco de golden quebrado). Suíte de domínio 32/32 verde após as mudanças. Suíte E2E 113/113 verde (chromium, gate oficial do CI) — inclui specs reais de checkout guest/logado e login que exercitam os elementos alterados. Nenhuma mudança de `data-testid`, texto visível, classe CSS existente ou comportamento de clique.

**Fora do escopo desta Onda (registrado, não esquecido):** foco automático/trap completo dentro do modal (mudança mais invasiva, maior superfície de risco — deixada para uma revisão dedicada futura, não faz parte do pedido de "mínima e cirúrgica"); auditoria WCAG completa do resto do app (P2.4, backlog).

---

## 1. Classificação por prioridade

### P0 — bloqueia o go-live definitivo

| # | Item | Por quê é P0 | Risco se ignorado | Depende de |
|---|---|---|---|---|
| P0.1 | **Confirmação consolidada de migrations sensíveis em produção** | O dono listou isso como incerteza aberta; a auditoria acima já resolveu o item mais crítico (RPCs WhatsApp), mas o checklist de go-live deve fechar os demais nomes de forma explícita, não por lembrança | Se alguma migration de segurança/RLS recente não estiver aplicada, o app roda em produção com um comportamento diferente do testado em E2E — risco de dados incorretos ou expostos | Nenhuma — é só verificação, mesmo método usado em §0 |
| P0.2 | **QA completa em pelo menos 1 Android físico, no ciclo atual** | REF-CAP-01 já teve homologação física (D10), mas isso validou instalação/catálogo — não o checklist inteiro (offline, atualização, notificações, ambos os fluxos de checkout). "Operação definitiva" exige a validação completa, não uma amostra parcial reaproveitada de um teste anterior com escopo menor | Regressão descoberta só depois do lançamento, em produção, sem rede de segurança | Nenhuma (pode rodar já) |
| P0.3 | **Smoke test manual em produção (Web + Admin) no dia do go-live** | CI e E2E cobrem comportamento contra ambiente dedicado; nenhum dos dois prova que o deploy real da Vercel está servindo o bundle esperado (lição já registrada: "push para main ≠ deploy no ar") | Ir ao ar acreditando que uma correção está no ar quando não está | P0.1 |
| P0.4 | **CI verde + suíte completa verde no commit final da `main`** | Gate mínimo de qualidade já estabelecido pelo próprio projeto (`ci.yml`); não é um item novo, é a confirmação de que nada ficou quebrado por commits recentes | Ir ao ar com uma regressão que o próprio projeto já sabe detectar, só que sem checar | Nenhuma |

### P1 — fortemente recomendado, mas o sistema já degrada bem sem isso (decisão consciente do dono, não bloqueio técnico)

| # | Item | Por quê é P1, não P0 | Risco se adiado | Depende de |
|---|---|---|---|---|
| P1.1 | **Secrets da Meta (WhatsApp Cloud API) no Vault** | Arquitetura 100% pronta e já rodando em produção (cron ativo, fila sendo alimentada); sem os 2 secrets, o pior caso é "cliente não recebe notificação automática" — zero erro, zero exposição, comportamento **já verificado ao vivo hoje** (§0) | Nenhum risco técnico. Risco é só de **produto**: notificação automática — que o dono citou como objetivo — não funciona até as credenciais existirem. É dependência **externa** (aprovação/registro no Meta for Developers), não uma tarefa de engenharia | Dono obter token+phone_number_id na Meta; inserir no Vault (SQL/Management API); zero deploy |
| P1.2 | **Fechar REF-CAP-01 Onda 8 (documentação)** | É só markdown (registrar as 3 formas oficiais de uso: Navegador/PWA/APK); risco zero, mas deixa uma REF oficialmente "fechada" solta se não for feito | Nenhum risco técnico, só desorganização documental | Nenhuma |
| P1.3 | **Revisão de acessibilidade focada nos fluxos críticos** (login, checkout, checkout admin) — não uma auditoria WCAG completa | ~61 atributos aria já existem, safe-area e pinch-zoom já corrigidos; falta só uma passada final nos 2-3 fluxos que geram receita, não o app inteiro | Baixo — a base já foi endereçada; o resíduo é polimento, não uma barreira de uso | Nenhuma |

### P2 — backlog consciente, não deve tocar o código antes do go-live

| # | Item | Por quê fica de fora agora | Quando revisitar |
|---|---|---|---|
| P2.1 | **Token real do Mapbox** | Fallback Nominatim→Photon já é uma melhoria comprovada sobre o estado anterior (achado real: "Rua João Schlay" que antes dava 0 resultado). Adapter Mapbox já está codificado, testado com fixtures, e ativa sozinho no dia em que a env var existir — zero mudança de código necessária | Quando o dono decidir contratar o Mapbox; ativação é config, não projeto |
| P2.2 | **Code splitting do bundle** | 174 kB gzip não é um problema de performance comprovado — é um aviso genérico do Vite (limiar fixo de 500 kB). O app é PWA (precache: usuário recorrente já não paga esse custo de novo) e o público é uma loja local, não uma base global sensível a cada 100ms. Mexer em `build.rollupOptions.manualChunks` nesta fase tocaria uma configuração que hoje serve **3 saídas simultâneas** (Web/encanto, Capacitor, upload de source maps do Sentry) — mexer agora = risco real de regressão em 3 pipelines por um ganho não comprovado | Só se o Sentry Performance (já instrumentado) mostrar dado real de usuário sofrendo com o tamanho, ou se o app crescer substancialmente |
| P2.3 | **Divisão do `StoreApp.jsx` (682 linhas)** | É dívida técnica real e conhecida (NORM-06 F2+), mas o arquivo está testado (`render.smoke`, E2E), funcional, e acabou de receber uma integração nova e sensível (back button nativo do Capacitor via `forwardRef`/`useImperativeHandle`, REF-CAP-01 Onda 4). Fazer uma refatoração estrutural bem no momento de estabilizar Android é o exato oposto de "mínimo risco de regressão" | Ciclo dedicado futuro, só se uma feature real precisar tocar o arquivo e o tamanho atrapalhar concretamente o trabalho — não como exercício de limpeza isolado |
| P2.4 | **Auditoria de acessibilidade completa (WCAG)** | A base crítica já foi feita; uma auditoria completa é trabalho de melhoria contínua, não um requisito de lançamento | Backlog pós-go-live |
| P2.5 | **Navegação por URL real (rotas)** | O próprio dono já definiu: "sem necessidade de alterar isso sem justificativa técnica". Não há justificativa técnica pendente — registrado aqui só para fechar o assunto explicitamente, não como pendência | Não se aplica — fora de escopo por decisão já tomada |

**Decisão ratificada (2026-07-31, Onda A6 — `PLANO-GOLIVE-01B`):** o dono aprovou este plano por completo, incluindo explicitamente a classificação P2 acima. P2.1–P2.5 passam de "recomendação" para **decisão tomada**: nenhum deles entra em execução neste ciclo de go-live. Nenhum código relacionado a code splitting, divisão do `StoreApp.jsx`, auditoria WCAG completa ou navegação por URL foi tocado na Fase A — a única mudança de código autônoma deste ciclo foi a revisão de acessibilidade focada (P1.3, escopo já aprovado, ver commit próprio). Revisitar qualquer item desta lista exige um novo pedido explícito do dono, não decisão unilateral de uma sessão futura.

---

## 2. Onde a auditoria mudou a leitura original das pendências

O dono listou "Deploy da Edge Function do WhatsApp" e "Confirmar Token Mapbox" como pendências abertas. Os dois merecem uma correção de enquadramento, registrada explicitamente para não gerar trabalho desnecessário:

- **Não existe mais um "deploy de Edge Function" pendente como caminho crítico.** O ADR `REF-ORDER-01-fluxo-pedidos-profissional.md` (§3.1) documenta que a introspecção do banco revelou `pg_net`+`pg_cron`+`supabase_vault` disponíveis, e o envio real foi movido para **dentro do próprio banco** (`enc_dispatch_notifications()` + cron a cada 30s) — confirmado ativo agora (§0). A Edge Function `whatsapp-notify/` continua no repositório como *worker alternativo*, não como bloqueio. O que falta é **só** inserir 2 segredos no Vault — uma tarefa de configuração de ~10 minutos, não uma tarefa de deploy de engenharia.
- **Mapbox nunca foi uma integração parcialmente implementada** — é uma integração **completa e testada com fixtures**, **desativada por design** na ausência do token, com fallback funcional e comprovadamente melhor que o estado anterior do produto. Não há "trabalho de integração" pendente, só uma decisão de compra do dono.

Isso rebaixa os dois de "possível P0" para **P1.1 (WhatsApp, decisão de produto)** e **P2.1 (Mapbox, backlog)**, respectivamente.

---

## 3. Ondas de execução

A sequência abaixo prioriza **verificação e configuração antes de qualquer coisa que toque código**, exatamente para manter a reta final livre de risco de regressão.

### Onda 1 — Auditoria de fechamento (zero código, pode começar imediatamente)
- Rodar a checklist de confirmação de migrations sensíveis (P0.1), consolidando em uma lista nomeada (ver §4) o que já foi verificado hoje (§0) + o que falta conferir.
- Fechar REF-CAP-01 Onda 8 (P1.2) — só documentação.
- **Critério de saída:** lista de migrations com status "confirmada" para cada uma, sem pendência desconhecida.

### Onda 2 — Configuração de integrações externas (paralela à Onda 1, não bloqueia nem é bloqueada)
- Dono obtém credenciais da Meta (WhatsApp Cloud API) e insere os 2 secrets no Vault (P1.1). Validar com 1 pedido de teste ponta a ponta (mudar status → ver mensagem chegar → outbox marcar sucesso).
- Decisão consciente sobre Mapbox (P2.1): ativar agora (se o dono já tiver token) ou registrar formalmente como backlog.
- **Critério de saída:** WhatsApp ativo e validado com 1 envio real, OU decisão explícita registrada de ir ao ar sem notificação automática nesta fase.

### Onda 3 — QA final em dispositivos reais (P0.2 — só o dono pode executar; agendar por último, mais perto do go-live)
- Checklist completo REF-MOBILE-01 num Android físico: instalação, modo standalone, ícone/splash, login (e-mail + Google), catálogo, checkout (entrega e retirada), notificação (se a Onda 2 já ativou) ou fila segura sem notificação (se não), atualização de versão via PWA, comportamento offline.
- Smoke test manual em produção Web (P0.3): fluxo cliente completo + fluxo Admin completo, direto na URL pública, não em ambiente local.
- **Critério de saída:** checklist assinado pelo dono, sem item vermelho não documentado.

### Onda 4 — Decisões de backlog (documentação, zero implementação)
- Registrar formalmente P2.2 (code splitting), P2.3 (divisão do StoreApp) e P2.4 (auditoria WCAG completa) como backlog consciente, com a justificativa de não bloquearem o go-live (conteúdo já coberto em §1, só precisa ser carimbado como "decisão tomada" para não reaparecer como dúvida depois).

### Onda 5 — Go-live formal
- CI verde no commit final da `main` (P0.4).
- Checklist de Go-Live (§5) 100% marcado.
- Liberação declarada como "operação definitiva".

**Por que essa ordem minimiza regressão:** nenhuma onda antes do go-live escreve código de produto. Onda 1 e 2 são verificação/configuração; Onda 3 é teste manual; Onda 4 é só registro. O código já em produção não é tocado em nenhum momento deste plano — o que é, na prática, a estratégia de menor risco possível para uma reta final.

---

## 4. Checklist de Go-Live

### Backend / Dados
- [x] `REF-ORDER-01c-notif-grants-harden.sql` aplicada em produção — **✅ confirmado ao vivo em 2026-07-31 (§0)**
- [x] Auditoria completa das 34 migrations sensíveis — **✅ concluída em 2026-07-31 (§0.1): 33/34 confirmadas**
- [x] **`REF-ADMIN-03-categoria-delete-guard.sql` — ✅ APLICADA E VALIDADA em produção (2026-08-01, §0.2.2). 34/34 migrations sensíveis confirmadas.**
- [x] `pg_cron` `enc-dispatch-whatsapp` ativo — **✅ já confirmado ao vivo (§0)**

### Integrações externas
- [ ] Secrets do Vault (`whatsapp_token`, `whatsapp_phone_number_id`) inseridos e validados com 1 envio real **OU** decisão explícita registrada de lançar sem notificação automática
- [ ] `VITE_MAPBOX_TOKEN` configurado na Vercel **OU** decisão explícita registrada de manter o fallback Nominatim/Photon

### Qualidade / CI
- [x] Suíte de domínio 100% verde — **✅ confirmado em 2026-07-31: 32/32 scripts** (`npm run test:domain`), revalidado depois dos fixes de acessibilidade (Onda A5)
- [x] Guards de banco (read-only) — **✅ confirmado em 2026-07-31: `verify:norm05`, `guard:slug`, `test:rls` 17/17, `test:orders-rls` 16/16, `test:auth-rls` 10/10, `test:address-schema` 8/8, `test:address-gazetteer` 5/5, `test:address-onda6-orders` 8/8, `test:comanda-endereco` 8/8, `test:datetime-schema` 9/9 — todos verdes.** `test:f1b` teve 3 falhas conhecidas e pré-existentes (RA1-RA3, limitação do harness local de troca de role sem JWT — a cobertura real de RLS autenticado é o `test:rls`, 17/17 verde; ver nota no memory do projeto)
- [x] Suíte E2E (gate oficial do CI, `npm run test:e2e`, chromium) — **✅ confirmado em 2026-07-31: 113/113 specs verdes**, rodado 2x (1ª rodada teve 65 falhas por conflito de porta entre 2 execuções simultâneas da própria sessão — diagnosticado e descartado; 2ª rodada limpa 100% verde)
- [x] `npm run build` (Web) e `npm run build:capacitor` (Android) — **✅ ambos limpos em 2026-07-31**, aviso de chunk >500kB persiste (decisão registrada, não bloqueia — ver P2.2)
- [ ] `.github/workflows/ci.yml` verde no commit final da `main` — depende de push (fora do escopo desta sessão; local está tudo verde)

### Mobile
- [ ] Checklist REF-MOBILE-01 executado por completo em pelo menos 1 Android físico **neste ciclo** (não reaproveitar só a validação de instalação já feita em REF-CAP-01 D10)
- [ ] `public/downloads/Encanto.apk` corresponde ao build validado (hash confere)

### Web
- [ ] Smoke test manual em produção (Vercel): busca, carrinho, checkout guest, checkout logado, fidelidade
- [ ] Smoke test manual do Admin em produção: login, pedidos, categorias, adicionais, configurações, comanda

### Observabilidade
- [ ] Sentry recebendo eventos do release atual (source maps batendo com o commit)
- [ ] Sem erro novo/recorrente relevante nas 24-48h antes do go-live

### Documentação
- [ ] REF-CAP-01 Onda 8 fechada
- [ ] Este plano marcado com data de execução e responsável por item

---

## 5. Resumo para decisão rápida

**Pode ir ao ar sem:** WhatsApp automático (P1, degrada bem, já provado), Mapbox real (P2, fallback já funciona), code splitting (P2, sem dor comprovada), divisão do StoreApp (P2, congelar), auditoria WCAG completa (P2).

**Não pode ir ao ar sem:** confirmação final das migrations sensíveis (a mais crítica já está confirmada), QA completo em Android físico neste ciclo, smoke test manual em produção no dia, CI verde no commit final.

**Maior risco real remanescente hoje:** não é técnico — é o hábito já registrado neste projeto de declarar "deploy disparado" sem verificar o bundle ao vivo (lição de REF-UI-TOPBAR-02). O checklist de Go-Live (§4) existe primariamente para não repetir esse erro na hora que mais importa.
