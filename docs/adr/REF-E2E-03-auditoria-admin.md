# REF-E2E-03 — Cobertura E2E do Painel Administrativo — Auditoria

**Status:** 🟡 Onda 1 (infraestrutura do Admin: login, permissão, sessão, logout) implementada e verificada (2026-07-23) — 7/7 specs verdes + suíte de domínio 100% sem regressão. Aguardando aprovação do dono para commitar e seguir para a Onda 2. Ondas 2-6 seguem a auditoria abaixo, 1 aprovação por onda.
**Depende de:** REF-E2E-01 (infraestrutura Playwright, projeto Supabase dedicado `encanto-e2e`, POM, `support/*`), REF-E2E-02 (padrão de fixture persistente, `workers:1`), AUTH-01 (fundação `is_admin()`/RLS), REF-ORDER-01/01b/01c (fluxo de pedidos + notificação), REF-ADMIN-CATALOG-01/REF-ADMIN-ADDONS-02 (governança do catálogo), REF-BUSINESS-HOURS-02/03, REF-DELIVERY-01, REF-LOYALTY-01.
**Relacionado:** fecha a lista "Faltam: Admin" deixada em aberto desde a auditoria da E2E-01.

Esta auditoria foi construída **inteiramente por leitura do código atual** (`src/components/admin/**`, `src/services/DataService.js`, `src/hooks/useOrders.js`, `migrations/*.sql`, e uma consulta real ao projeto `encanto-e2e` via `service_role`). Nenhuma afirmação abaixo é suposição — onde não pude confirmar com certeza total, digo isso explicitamente.

## 1. Mapeamento completo do Admin

### 1.1 Como se entra no Admin (roteamento)

`src/App.jsx`: **não há router nenhum**, nem no Admin nem na loja. `App()` mantém um `useState('store'|'login'|'admin')`. O único jeito de chegar ao Admin é a URL `#admin-encanto` (lido uma vez no `useState` inicial, depois o hash é limpo via `history.replaceState`) → `mode='login'` → `<AdminLogin onLogin={...}/>`. Login bem-sucedido chama `onLogin(u)` → `mode='admin'` → `<AdminPanel onExit={...}/>`. `onExit` (botão "Sair"/"← Ver loja") devolve a `mode='store'`, **sem** deslogar do Supabase (`AdminPanel`'s "Sair" não chama `signOut()` — ver §1.2).

Dentro do `AdminPanel`, as 8 "telas" (Dashboard/Pedidos/Products/Categorias/Adicionais/Status/Fidelidade/Saúde) são **outro `useState('dashboard'|...)`**, sem URL própria — clicar num item do menu lateral não muda `location.hash`. Confirma o achado já registrado na auditoria da E2E-01 (tabela de seletores): a navegação entre abas é 100% por interação de UI, nunca por `page.goto`.

### 1.2 Autenticação do Admin — achados confirmados no código

- `AdminLogin.jsx` usa o client `db` (`src/lib/supabase.js`, **não** `dbCliente` — instância separada da loja, mesma convenção do AUTH-01) e chama **só** `db.auth.signInWithPassword({email, password})`. Sucesso = `data.session.access_token` truthy → `onLogin({email, session})`. Não há verificação de `is_admin()` no cliente.
- **O campo e-mail vem pré-preenchido com o e-mail REAL do administrador de produção** (`as992203620@gmail.com`, hardcoded como valor inicial do `useState`). Mesmo risco que a auditoria da E2E-01 já havia identificado para o login do Admin ("nunca a conta real") — aqui fica confirmado que o próprio código expõe esse e-mail como valor padrão do formulário.
- **Achado crítico — NÃO existe restauração de sessão do Admin.** `db` é criado com `persistSession:true, autoRefreshToken:true` (`lib/supabase.js`), então a sessão de fato persiste no `localStorage` do navegador. Busquei em todo `src/` por `db.auth.getSession()` / `db.auth.onAuthStateChange()` fora de `AdminLogin.jsx` — **não existe nenhuma chamada**. `App.jsx` também não consulta a sessão no mount: `mode` só vira `'admin'` através do callback `onLogin` da tela de login. **Conclusão: um F5 (ou reabrir o navegador) na tela do Admin sempre volta para a tela de login, mesmo que o token da sessão anterior ainda seja válido no `localStorage`.** Isto é o oposto do comportamento do cliente (`AuthProvider.jsx`, que restaura a sessão via `getSession()` no mount) — não é um bug a corrigir nesta REF, mas um comportamento real que os testes de "persistência de sessão" do Admin precisam **verificar como é** (queda para o login a cada reload), não assumir que funciona como o login do cliente.
- **Achado crítico — NÃO existe verificação de `is_admin()` no cliente, em lugar nenhum.** Busquei `is_admin` em todo `src/`: todas as ocorrências são comentários referenciando a checagem do **servidor**; zero chamadas reais no frontend. Isso significa que **qualquer usuário autenticado do Supabase** (ex.: um cliente comum que criou conta via OTP/Google na loja — mesmo projeto Supabase, `auth.users` compartilhada) que souber e-mail/senha de uma conta com senha definida chega à **UI inteira do Admin** (sidebar, 8 abas, todos os formulários). Só as **operações de dado** (leitura/escrita em `products`/`categories`/`adicionais`/`orders`/`customers`/etc.) são bloqueadas pela RLS (`is_admin()` nas policies — ver §5). Na prática, um "usuário autenticado sem permissão" veria a casca do Admin renderizar, mas dashboards vazios, saves falhando (mensagem genérica "Não foi possível salvar" onde exista tratamento, ou erro silencioso onde não exista) — **nunca uma tela de "acesso negado"**. Isso é o cenário exato que a lista do pedido chama de "Usuário sem permissão" — vou testar esse comportamento real, não um bloqueio que não existe.
- Logout: o botão "Sair" do `AdminPanel` (`onExit`) só troca `mode` para `'store'` — **não chama `db.auth.signOut()`**. A sessão do Supabase continua tecnicamente ativa até expirar (embora, como visto acima, isso seja irrelevante na prática porque nada a restaura de qualquer forma).

### 1.3 Dashboard (`AdminDashboard.jsx`)

Cards (pedidos hoje / faturamento hoje / em preparo / ticket médio / total geral) + breakdown por status + tabela "Últimos pedidos" (10 mais recentes). Fonte: `useOrders()` → `DS.getPedidos()` (`orders` + `customers(name,phone)` + `order_items(*)`, `limit(100)`, sem paginação/filtro). Auto-refresh a cada 60s (`setInterval`) + botão manual "🔄 Atualizar". Estado vazio: `orders.length===0` → "Nenhum pedido". Sem tratamento de erro visível além do array vazio (se `DS.getPedidos()` falhar, `DS.run` já devolve `{data:null}` e o método retorna `r.data ?? []` — um erro real de rede parece IDÊNTICO a "zero pedidos" na tela; não há distinção). **Achado:** não há como diferenciar, hoje, "carregando" de "vazio" de "erro" no Dashboard — os 3 estados colapsam visualmente (exceto o loading intermediário, que também não usa `<Spinner/>` aqui — só a tabela "Últimos pedidos" e os cards renderizam direto com os arrays vazios/zerados no primeiro paint).

### 1.4 Pedidos (`AdminPedidos.jsx` + `PedidoHistorico.jsx` + `PedidoNotificacoes.jsx` + `comanda/*`)

Não é uma tabela — é um **quadro de cards** (`OrderCard`), um por pedido, com:
- Cabeçalho: número sequencial (`orders.length - i`, decrescente — **não é o id nem estável entre reloads se a lista mudar**), ref curta (8 hex do id), tipo (🏪 Retirada / 🛵 Entrega — detectado por regex no `address`, ver `comandaModel.js`), status atual.
- Cliente + total + horário.
- Trilha visual (chips) — **diferente por tipo**: entrega = `recebido→preparo→pronto→entrega→entregue`; retirada = `recebido→preparo→pronto→entregue` (sem "saiu para entrega", ver `pedidoStatus.js` `FLUXO_ENTREGA`/`FLUXO_RETIRADA`).
- Ações sempre visíveis: **Avançar** (`DS.setStatus(id, próximoStatus)`), **Comanda** (abre `ComandaModal`), **Histórico** (expande `PedidoHistorico`, lê `order_events`, só leitura), **Mensagens** (expande `PedidoNotificacoes`, lê `notification_outbox`, só leitura), **Cancelar** (`window.confirm` nativo → `setStatus('cancelado')`) ou **Reabrir** (se já cancelado, volta para `'recebido'`).
- **Achado confirmado — NÃO existe busca nem filtro nesta tela.** O pedido do usuário lista "Busca. Filtros." no escopo esperado; o código de `AdminPedidos.jsx` não tem nenhum campo de busca, nenhum filtro por status/data/cliente — é a lista inteira (até 100 pedidos) sempre renderizada. Isto **não é uma lacuna de teste**, é uma funcionalidade que **não existe hoje** no produto. Ajuste de escopo proposto no §3.
- **Mudar status enfileira notificação real (trigger de banco).** `trg_enc_order_notify` (INSERT/UPDATE de `orders.status`) chama `enc_enqueue_notification`, que grava em `notification_outbox` — isso acontece **sempre**, em qualquer projeto Supabase onde a migration `REF-ORDER-01-order-ops.sql` foi aplicada (faz parte do schema `public`, portanto **presente também no projeto `encanto-e2e`**, clonado via `pg_dump --schema-only --schema=public` da produção). O **envio de verdade** depende de `enc_dispatch_notifications()`, que só funciona com segredos no Vault (`whatsapp_token`/`whatsapp_phone_number_id`) e é **agendado por um job do `pg_cron`** (schema `cron`, fora de `public`). Como o dump da E2E-01 usou `--schema=public`, **nem o job do cron nem os segredos do Vault existem no projeto `encanto-e2e`** — mesmo que alguém chame `enc_dispatch_notifications()` manualmente, a função retorna `{ok:true, skipped:'whatsapp_not_configured'}` (no-op). **Conclusão com alta confiança (raciocínio arquitetural, não testado ao vivo): mudar status de pedido no Admin, no ambiente de E2E, sempre cria uma linha em `notification_outbox` (inofensivo, dado do próprio projeto de teste) mas NUNCA dispara uma mensagem real** — mesma garantia já estabelecida pela E2E-01/02. Ainda assim, recomendo uma verificação pontual (consultar `cron.job`/segredos do Vault do projeto `encanto-e2e`, se acessível) antes de rodar a Onda de Pedidos, só para eliminar a última dúvida.
- `ComandaModal`: preview via `<iframe srcDoc>` (WYSIWYG, HTML gerado por `comandaHTML(buildComanda(order,...))` — domínio puro, já coberto por `tests/comanda.golden.mjs`), seletor de largura (80mm/58mm), botão "Imprimir/Reimprimir" chama `window.print()`. **Imprimir de verdade não é testável de forma determinística em Playwright headless** — o teste E2E deve verificar que o clique dispara `window.print` (interceptável/observável), não o resultado da impressão física.

### 1.5 Catálogo

**Produtos (`AdminProducts.jsx`)** — o componente admin mais complexo do projeto. Tabela com miniatura/nome/categoria/preço/disponibilidade (toggle inline)/ações; modal de criar/editar com: nome, descrição, preço + preço promo (ocultos se o produto usa tamanhos), editor de **tamanhos** (array dinâmico add/remove, cada um com label+preço+adicionais grátis — PRICE-DOMAIN-01), categoria principal (select), "aparece também em" (multi-categoria via toggle-buttons — REF-ADMIN-CATALOG-01), ordem de exibição, badge (select fixo de 4 opções), adicionais grátis (número), **grupos de adicionais disponíveis** (toggle-buttons dinâmicos, dependem da categoria escolhida e dos adicionais cadastrados — REF-ADMIN-ADDONS-02), upload de imagem (`ImageUploader`), toggles de Disponível/Destaque.
**Achado de seletor — nenhum `<input>`/`<select>` deste formulário tem `<label htmlFor>` associado.** Todos são `<label className="form-label">Texto</label>` seguido de um `<input>` **irmão**, sem `id`/`htmlFor` — `getByLabel` não funciona em nenhum campo. A maioria também não tem `placeholder` (só os campos de "tamanho" têm: `"300 ml"`, `"0.00"`). **Este formulário vai precisar de bem mais `data-testid` do que qualquer tela já tocada nas REFs anteriores** — não por escolha, mas porque não há alternativa semântica sem reescrever o formulário inteiro (fora de escopo). Cada `data-testid` será adicionado só quando o spec que o usa precisar, no mesmo commit, seguindo a convenção já estabelecida.

**Categorias (`AdminCategorias.jsx`)** — CRUD simples (nome/ícone-emoji/cor/ordem), mesma ausência de `htmlFor`. **Achado:** excluir uma categoria (`DS.delCat`) não verifica se há produtos vinculados antes de tentar — se `categories.id` for referenciado por `products.categoria_id` com FK sem `ON DELETE`, a exclusão pode falhar silenciosamente (o `catch` de `DS.run` não relança por padrão, `throwOnError` não é passado em `delCat`) e a tela nem mostra erro. **Preciso testar esse caminho como ele realmente se comporta**, não como eu assumiria que deveria se comportar.

**Adicionais (`AdminAdicionais.jsx`)** — CRUD simples (nome/tipo grátis-ou-pago/grupo/preço condicional), mesma ausência de `htmlFor`.

Os guardas de domínio já existentes (`test:admin-catalog`, `test:admin-addons` — análise estática pura, sem browser) protegem a **arquitetura** (uso de `categoria_ids`/`grupos_ad`, sincronia do toggle Destaque, não-uso das colunas dormentes). A REF-E2E-03 **não deve duplicar** essas garantias — o valor do E2E aqui é provar que o **fluxo real na UI** (clicar, preencher, salvar, ver refletido) funciona de ponta a ponta contra o backend real, não re-provar a arquitetura.

### 1.6 Configurações

- **Status da loja (`AdminStatus.jsx`)** — 3 botões (Automático/Forçar Aberta/Forçar Fechada) → `definirModo(modo)` (`services/businessHours/override.js`) → RPC `set_store_mode` (`is_admin()`-gated, já usado pela E2E-01 como *setup* via `support/storeMode.js`, mas **nunca testado pela UI real do Admin até agora**). Reconciliação "truthful" documentada no próprio código (não confia em cache otimista para reportar sucesso). Efeito é **GLOBAL** (mesma tabela `settings.store_mode` que o checkout usa) — mesmíssimo cuidado de serialização já em vigor desde a E2E-01/02.
- **Tempo de entrega (`AdminDeliveryEta.jsx`)** — presets (30/35/40/45/50/60) + campo numérico + botão "Salvar" (nunca auto-save) → `definirEta(n)` → RPC `set_delivery_eta` (`is_admin()`-gated, valida 10-180 no servidor). Também **GLOBAL** (mesma chave `delivery_eta_min` que a loja lê via `useDeliveryEta`).
- **Fidelidade — visão do Admin (`AdminFidelidade.jsx`)** — 2 partes: (a) configuração do programa (required/discount/enabled) via `set_loyalty_config`; (b) busca de UM cliente por telefone/nome (`admin_find_loyalty`) + ajuste manual de selos (`admin_adjust_loyalty`, ±1) + resgate administrativo (`admin_resgatar`/`redeem_reward` com `p_customer_id`). Complementa (não duplica) a fidelidade já testada do lado do cliente na E2E-02 — aqui o ângulo é o **operador** ajustando/consultando a conta de outro cliente.

### 1.7 Saúde (`AdminHealth.jsx`)

Painel de observabilidade, só leitura: `DS.getHealth()` → RPC `orders_health()` (agregados, sem PII: pedidos hoje/faturamento/ticket médio/total/erros 24h/divergências/série 7 dias). Estado vazio (`!h`) e loading (`<Spinner/>`) tratados.

### 1.8 Uploads — achado crítico de infraestrutura (verificado ao vivo)

`ImageUploader.jsx` usa `db.storage.from('products').upload(...)` + `getPublicUrl(...)`. Validação **client-side, síncrona, antes de qualquer chamada de rede**: tamanho máx. 5 MB, tipos aceitos `image/jpeg|png|webp|gif` — os casos "erro"/"imagem inválida" do pedido são 100% testáveis **sem depender de nenhuma infraestrutura de Storage** (a validação nunca chega a chamar `db.storage`).
**Consultei ao vivo o projeto `encanto-e2e` (`service_role`, `storage.listBuckets()`): a lista voltou vazia — `buckets: []`.** Não existe nenhum bucket no projeto de E2E hoje. Isso é esperado: o clone de schema da E2E-01 usou `pg_dump --schema=public` (Postgres), e buckets/políticas de Storage **não vivem no schema Postgres dumpável** — são geridos à parte pela API/dashboard de Storage do Supabase (foi assim, provavelmente, que o bucket `products` da produção foi criado). **Upload real (caminho feliz) e teste de política de Storage exigem decisão explícita — ver §7, pergunta 1.**

### 1.9 Permissões — matriz confirmada no código (`migrations/AUTH-01-step1/step2/step3-*.sql` + REFs específicas)

| Recurso | Anon | Autenticado comum | Admin (`is_admin()`) |
|---|---|---|---|
| `products`/`categories`/`adicionais` — SELECT | ✅ (loja pública) | ✅ | ✅ |
| `products`/`categories`/`adicionais`/`product_collections` — INSERT/UPDATE/DELETE | ❌ (sem policy) | ❌ (`WITH CHECK (is_admin())` falha) | ✅ |
| `orders`/`customers`/`order_items` — ALL | ❌ (só via `create_order` SECURITY DEFINER) | ❌ exceto **as próprias** linhas (policies "Cliente lê próprio…", só SELECT) | ✅ (`is_admin()`) |
| `notification_outbox` — SELECT | ❌ | ❌ | ✅ |
| `notification_outbox` — INSERT/UPDATE | ❌ (só trigger `SECURITY DEFINER`) | ❌ | ❌ (nem admin — só o trigger/dispatcher) |
| `admins` — SELECT | ❌ | ✅ só a própria linha | ✅ (via `is_admin()`, que é `SECURITY DEFINER`) |
| RPCs `set_store_mode`/`set_delivery_eta`/`set_loyalty_config`/`admin_*`/`redeem_reward(p_customer_id)` | ❌/revogado | ❌ (checagem `is_admin()` explícita dentro da função) | ✅ |
| RPC `get_store_mode`/`get_my_loyalty` (leitura) | ✅ (devolve dados públicos/zerados) | ✅ | ✅ |
| Storage bucket `products` | — | — | **bucket inexistente no projeto de E2E hoje (ver §1.8)** |

Todas as linhas desta tabela vêm de migrations lidas nesta auditoria (`AUTH-01-step1/2/3`, `REF-LOYALTY-01(-a)`, `REF-BUSINESS-HOURS-03`, `REF-DELIVERY-01`, `REF-ORDER-01-order-ops`) — nenhuma suposição.

### 1.10 Integrações — classificação pedida explicitamente

| Integração | Classificação | Detalhe |
|---|---|---|
| WhatsApp (envio de notificação) | **Fora do escopo desta REF** (é a REF-ORDER-01b, já implementada; aqui só cobrimos que o *enfileiramento* acontece e a *prévia* renderiza — nunca o envio real) | Ver §1.4 |
| RPCs administrativas (`set_store_mode`, `set_delivery_eta`, `set_loyalty_config`, `admin_*`, `redeem_reward`) | **Cobertas nesta REF** | São o coração do escopo "Configurações"/"Fidelidade admin" |
| Storage (`products` bucket) | **Dependente de decisão de infraestrutura** (§7, pergunta 1) — sem bucket, upload real fica fora do escopo até ser provisionado | |
| Supabase Functions (Edge Functions) | **Não existe nenhuma neste projeto.** Corrijo aqui uma imprecisão de memória própria: comentários antigos mencionavam uma "Edge Function whatsapp-notify", mas a REF-ORDER-01b **substituiu esse desenho por `pg_net`+`pg_cron`+Vault, sem Edge Function nenhuma** (confirmado lendo `REF-ORDER-01b-whatsapp-dispatch.sql`, cujo próprio cabeçalho diz "SEM Edge Function"). | |
| `pg_cron` | **Fora do escopo** (o job `enc-dispatch-whatsapp` não existe no projeto de E2E — schema `cron` fora do dump) | |
| Realtime | **Não utilizado em nenhum lugar do projeto** (confirmei via busca por `.channel(`/`.subscribe(` em todo `src/` — zero ocorrências; Dashboard/Pedidos usam só polling manual/`setInterval`) | Fora do escopo por não existir |

## 2. Funcionalidades parcialmente implementadas ou com lacunas reais

1. **Sessão do Admin não persiste na prática** (§1.2) — todo reload volta ao login.
2. **Nenhuma verificação de `is_admin()` no cliente** — a UI inteira do Admin é alcançável por qualquer autenticado; só os dados são protegidos.
3. **Busca/filtros de Pedidos não existem** — lista simples, até 100 registros.
4. **Diferenciação loading/vazio/erro no Dashboard é fraca** — os 3 estados praticamente colapsam.
5. **Exclusão de Categoria sem checagem de produtos vinculados** — comportamento real a confirmar em teste, não assumido.
6. **Formulário de Produtos sem nenhum `<label htmlFor>`** — maior densidade de `data-testid` necessária de toda a suíte E2E até aqui.
7. **Bucket de Storage inexistente no ambiente de E2E** — upload real bloqueado até decisão de infraestrutura.

Nenhuma dessas lacunas é para esta REF corrigir — são fatos a testar/documentar como estão, e a ajustar o escopo de teste quando não há nada real para exercitar (mesmo padrão já usado na E2E-02 com o gap do chip de Fidelidade).

## 3. Ajuste de escopo proposto

- **"Busca. Filtros." (Pedidos):** não existe hoje — proposta é **remover** esse item do escopo de teste (não simular uma feature inexistente) e registrar como gap de produto conhecido, à disposição do dono decidir se quer abrir um REF de produto à parte.
- **"Sessão expirada" (Autenticação Admin):** dado que não há refresh automático nem detecção de expiração na UI (mesmo raciocínio do achado #1.2), o teste relevante é *sessão inválida/forjada* — o app deve, na pior das hipóteses, continuar mostrando a tela de login (que é literalmente o estado padrão) sem travar. Comportamento **mais simples** de provar do que o equivalente do cliente (E2E-02), porque não há restauração para "desfazer".
- **Upload real (Storage):** ver pergunta aberta §7.1 — a validação client-side (tipo/tamanho) entra sem depender de decisão nenhuma; o caminho feliz (upload real) só entra após a decisão de infraestrutura.

## 4. Arquitetura proposta (reuso máximo)

Reaproveitado sem mudança: `playwright.config.js` (`workers:1`, já corrigido na E2E-02), `fixtures/index.js`, `support/supabaseAdmin.js`, `support/authSession.js` (padrão para inspirar um equivalente do Admin, ver abaixo), `support/fixture-accounts.js` (`ADMIN_FIXTURE` **já existe e já está registrado em `public.admins`** desde a Onda 4 da E2E-01 — `scripts/e2e-fixture-accounts.mjs`), `support/storeMode.js`, `support/network-stubs.js`, `support/cleanup.js`, `support/fixture-catalog.js`, `support/fixture-order.js`.

**Decisão de arquitetura de autenticação do Admin (diferente do cliente, e por quê):** ao contrário do cliente (Google/OTP, mecanicamente impossível de automatizar de ponta a ponta), o login do Admin é um formulário de e-mail/senha **igual a qualquer login de produção testável**. Não há ganho em replicar o padrão `storageState` da E2E-02 aqui — a própria auditoria descobriu que a sessão do Admin **não é restaurada automaticamente** de qualquer forma (§1.2), então injetar `storageState` não pularia a tela de login como pulava no cliente. **Proposta: todo teste de Admin realiza o login de verdade pela UI** (`AdminLoginPage.login(email, senha)`, usando `ADMIN_FIXTURE`) — mais simples, mais barato, e prova exatamente o comportamento real (inclusive o próprio gap de não-persistência, quando for o alvo do teste).

Já existem, criados como esboço na Onda 1 da E2E-01 e nunca usados: `e2e/pages/AdminLoginPage.js` e `e2e/pages/AdminPanel.page.js`. Serão **completados**, não recriados.

Novo, com ganho arquitetural claro:
- `e2e/pages/AdminPedidosPage.page.js` — cards, ações (avançar/cancelar/reabrir/comanda/histórico/mensagens), usado por múltiplos specs.
- `e2e/pages/AdminProductsPage.page.js` — formulário mais complexo do projeto, reusado por vários specs (criar/editar/tamanhos/destaque/grupos).
- `e2e/pages/AdminCategoriasPage.page.js` / `e2e/pages/AdminAdicionaisPage.page.js` — CRUDs simples, mas repetidos por specs suficientes para justificar.
- `e2e/support/fixture-catalog-admin.js` (novo) — helper de limpeza para registros de catálogo criados por teste (produtos/categorias/adicionais com prefixo `E2E_TEST_`), simétrico ao `cleanup.js` já existente para clientes/pedidos — **nunca toca o catálogo fixture do seed** (`fixture-catalog.js`, usado pelos specs de loja da E2E-01).
- Pequena extensão em `e2e/support/cleanup.js` OU novo arquivo dedicado — a decidir na implementação conforme o tamanho real do helper (mantém a mesma disciplina de não duplicar).

Produção — ajustes propostos (todos aditivos, justificados por spec):
- `data-testid="admin-tab-{id}"` nas 8 abas do `AdminPanel.jsx` (`<div onClick>` sem `role`) — **item já estava listado na tabela de seletores da própria auditoria da E2E-01**, nunca aplicado até agora.
- `data-testid` no formulário de `AdminProducts.jsx` — quantidade maior que o habitual (nenhum campo tem `<label htmlFor>` nem, na maioria, `placeholder`), aplicados só conforme os specs da Onda 4 precisarem.
- `data-testid` pontuais em `AdminCategorias.jsx`/`AdminAdicionais.jsx` (mesma ausência de `htmlFor`, formulários bem menores).

## 5. Estratégia de dados/fixtures

- **Conta admin fixture:** já existe (`ADMIN_FIXTURE`, `e2e/support/fixture-accounts.js`), já registrada em `public.admins` no projeto `encanto-e2e`. Reaproveitada integralmente.
- **Nova conta "autenticada, sem admin"** — necessária para o cenário real de "usuário sem permissão" (§1.2). Proposta: reaproveitar o **próprio `CLIENTE_FIXTURE`** já existente (da E2E-02) para esse papel — ele já é um usuário autenticado válido e **não** está em `public.admins`. Zero conta nova a criar; zero duplicação.
- **Catálogo de teste (Produtos/Categorias/Adicionais):** nunca reaproveita nem edita o catálogo fixture do seed (`fixture-catalog.js`, com specs de loja/carrinho já dependendo dele desde a E2E-01). Todo registro criado por um spec de Admin leva prefixo `E2E_TEST_` no nome e é apagado no `afterEach`/`afterAll` do próprio spec.
- **`store_mode`/`delivery_eta_min` (globais):** specs de Configurações devem, ao final, devolver os valores ao baseline conhecido (`OPEN`/`30` — o mesmo baseline que a E2E-01/02 já assume) para não vazar estado para os specs de loja/checkout que rodam depois na mesma suíte. `workers:1` (já em vigor desde a E2E-02) elimina a corrida entre arquivos.
- **Pedidos de teste do Admin:** reaproveita `criarPedidoFixture()` (E2E-02) quando servir (cria um pedido do **cliente fixture**); para cenários que precisam de um pedido "avulso"/genérico sem vínculo com o cliente fixture (ex.: testar a lista/dashboard sem afetar os specs de Meus Pedidos), usar telefone com prefixo reservado + nome `E2E_TEST_`, limpo por `limparDadosDeTeste()` (já existente, já filtra por esse prefixo).

## 6. Divisão em ondas

**Onda 1 — Infraestrutura do Admin: login, navegação entre abas, logout, sessão**
- `data-testid="admin-tab-{id}"` nas 8 abas (único ajuste de produção previsto nesta onda).
- `AdminLoginPage.js`/`AdminPanel.page.js` completados (login, `irPara(tab)`, sair).
- `admin-login.spec.js`: login com sucesso, senha errada, e-mail inexistente.
- `admin-permissao.spec.js` (parte 1): login com o `CLIENTE_FIXTURE` (autenticado, não-admin) — prova o comportamento real (chega na UI, dados vêm vazios/erro genérico), não um bloqueio inexistente.
- `admin-sessao.spec.js`: reload cai para o login (documenta o gap real, não testa uma restauração que não existe); "sessão inválida" via `storageState` forjado (mesma técnica da E2E-02) só precisa provar que não trava.
- `admin-logout.spec.js`.

**Onda 2 — Dashboard + Pedidos**
- `AdminPedidosPage.page.js` novo.
- `admin-dashboard.spec.js` (cards, estado vazio, atualizar manual).
- `admin-pedidos-lista.spec.js` (cards refletem dados reais).
- `admin-pedidos-status.spec.js` (trilha entrega vs. retirada, avançar até o fim, cancelar/reabrir).
- `admin-pedidos-historico.spec.js` / `admin-pedidos-mensagens.spec.js` (só leitura; mensagens prova só a prévia, nunca envio real).
- `admin-pedidos-comanda.spec.js` (abre modal, troca largura, conteúdo correto no iframe; imprimir só verifica o disparo, não o resultado).

**Onda 3 — Catálogo: Categorias + Adicionais**
- `AdminCategoriasPage.page.js` / `AdminAdicionaisPage.page.js` novos.
- CRUD completo + validação (nome vazio) + exclusão (comportamento real, incluindo o caso "em uso" tal como ele se comporta hoje).

**Onda 4 — Catálogo: Produtos (a mais complexa)**
- `AdminProductsPage.page.js` novo; `data-testid` no formulário conforme necessidade dos specs.
- Criar produto simples / com tamanhos / editar / alterar preço / disponibilidade / destaque / grupos de adicionais / excluir / validação.
- Upload de imagem: validação client-side (tipo/tamanho) sempre; caminho feliz condicionado à decisão de infraestrutura (§7.1).

**Onda 5 — Configurações + Fidelidade (visão Admin)**
- `admin-status.spec.js` (AUTO/OPEN/CLOSED pela UI real, restaura `OPEN` ao final).
- `admin-delivery-eta.spec.js` (presets + manual + salvar, restaura `30` ao final).
- `admin-fidelidade.spec.js` (config do programa + busca/ajuste/resgate de um cliente).

**Onda 6 — Permissões (matriz completa) + Saúde + fechamento**
- `admin-permissao.spec.js` (parte 2): usuário anônimo tentando operações de escrita via chamadas diretas (RLS bloqueia — prova a tabela do §1.9 na prática, não só na leitura das migrations).
- `admin-saude.spec.js` (leitura dos agregados).
- Revisão final do README/ADR, fechamento do escopo.

## 7. Decisões tomadas (2026-07-23)

1. **Upload de imagem: mockado via `page.route`** (mesmo padrão já usado para ViaCEP/Nominatim/e-mail — `network-stubs.js`) — cobre a mecânica da UI sem provisionar bucket real. A validação client-side (tipo/tamanho inválido) já é 100% testável sem isso, por não depender de rede. Upload real contra Storage de verdade fica fora do escopo desta REF.
2. **Conta "autenticada sem permissão de admin": reaproveita o `CLIENTE_FIXTURE`** já existente (E2E-02) — zero conta nova, zero duplicação.
3. **`pg_cron`/Vault do WhatsApp no projeto `encanto-e2e`: conclusão por raciocínio arquitetural aceita** (schema-only dump exclui os schemas `cron`/`vault` → nunca dispara envio real nesse ambiente). Segue para a Onda 2 sem verificação ao vivo adicional.

## Onda 1 — executada (2026-07-23)

Implementada exatamente como planejada em §6, sem desvio de escopo. Arquivos:

- `src/components/admin/AdminPanel.jsx`: `data-testid="admin-tab-{id}"` nas 8 abas.
- `src/components/admin/AdminLogin.jsx`: `data-testid` em e-mail/senha/mensagem de erro (`admin-login-email`/`admin-login-senha`/`admin-login-erro`) — únicos ajustes de produção desta onda, além das abas.
- `e2e/pages/AdminLoginPage.js` / `e2e/pages/AdminPanel.page.js` — completados (esboços da E2E-01 Onda 1), TODOs removidos.
- `e2e/support/fixture-order.js` — nova `criarPedidoAvulso()` (pedido real para um cliente genérico, sem vínculo com `CLIENTE_FIXTURE`, prefixo `E2E_TEST_`, limpo por `limparDadosDeTeste()` já existente).
- 4 specs novos em `e2e/tests/admin/`: `admin-login.spec.js`, `admin-permissao.spec.js`, `admin-sessao.spec.js`, `admin-logout.spec.js` (7 casos de teste).

**Nenhum achado novo durante a execução** — as 3 previsões arquiteturais da própria auditoria (§1.2) se confirmaram ao rodar de verdade, na primeira tentativa, sem ajuste:
1. Reload no meio do painel realmente cai na **loja** (`mode='store'`), não numa tela de login — porque o hash `#admin-encanto` já foi limpo via `history.replaceState` no 1º mount, então o F5 (sem hash) usa o branch padrão do `App.jsx`. Mais preciso do que a frase original da auditoria ("sempre volta para a tela de login") — corrigido aqui para refletir o comportamento real observado.
2. Sessão forjada sob a chave padrão do client `db` (`sb-<ref>-auth-token`, calculada em runtime a partir de `E2E_ENV.url` — não é um literal fixo como o `STORAGE_KEY` do cliente) não trava o boot nem gera erro não-capturado.
3. `CLIENTE_FIXTURE` (autenticado, nunca em `public.admins`) chega à UI inteira do Admin; o pedido "avulso" criado por `criarPedidoAvulso()` (cliente diferente, sem relação nenhuma com o fixture) provou-se real no backend mas invisível no Dashboard dessa sessão — a RLS bloqueia de fato, não é só "tela vazia por acaso".

**Correção de precisão nesta ADR:** o texto original de §1.2 dizia que um F5 "sempre volta para a tela de login" — o comportamento real e verificado é que ele volta para a **loja** (mode padrão `'store'`), não para o login (`mode='login'` só é alcançado ao entrar via `#admin-encanto`). A conclusão prática (sessão de admin nunca é restaurada automaticamente) continua correta; só a tela de destino do fallback estava imprecisa.

Verificação: `npx playwright test --project=chromium e2e/tests/admin` (7/7) e a suíte completa (`npm run test:e2e`, 56/56, incluindo Ondas anteriores) + toda a suíte de domínio (`test:pricing` … `test:whatsapp-svc`) sem regressão.

## 8. Critérios objetivos de aprovação (por onda, mesmo padrão das REFs anteriores)

- `npm run test:e2e` verde para os specs entregues na onda.
- Suíte de domínio (`tests/*.mjs`, incluindo os guards `test:admin-catalog`/`test:admin-addons`) 100% verde, sem regressão.
- Zero dado de teste remanescente no projeto `encanto-e2e` ao final da run (catálogo/pedidos de teste apagados; `store_mode`/`delivery_eta_min` de volta ao baseline).
- Nenhuma notificação WhatsApp real disparada.
- `e2e/README.md` e este ADR atualizados a cada onda.

## 9. Estimativa de impacto

- Nova pasta de specs `e2e/tests/admin/` — zero overlap com `store/`/`cart/`/`checkout/`/`auth/`/`cliente/`.
- ~5-6 Page Objects novos + 2 já esboçados (E2E-01) a completar.
- 1 novo helper de limpeza de catálogo de teste.
- Ajustes de produção: `data-testid` nas 8 abas do Admin (aditivo) + `data-testid` no formulário de Produtos (o maior volume de toda a suíte E2E até aqui, mas ainda assim aditivo/sem mudança visual) + pontuais em Categorias/Adicionais.
- Nenhuma mudança em `playwright.config.js`/`fixtures/index.js`/infraestrutura já existente.
- Onda de Produtos (4) é a mais cara em tempo de implementação, dado o tamanho do formulário; Onda de Permissões (6) é a mais barata (specs curtos, sem UI complexa).
