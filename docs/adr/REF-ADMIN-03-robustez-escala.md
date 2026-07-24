# REF-ADMIN-03 — Robustez, Escalabilidade e Preparação para SaaS

**Status:** ✅ Implementada e verificada (2026-07-24) — 3 ondas (Onda 1 = decisão formal + trigger,
Onda 2 = storageKey centralizado + migração de sessão legada, Onda 3 = paginação/busca/stats
server-side). 104/104 da suíte E2E inteira (era 92 ao fim da REF-ADMIN-02) + suíte de domínio 100%
(exceto as 3 falhas pré-existentes/congeladas de `test:f1b`) + `verify:norm05`/`guard:slug`/
`test:rls`/`test:orders-rls`/`test:auth-rls` 100% verdes, sem regressão. Aguardando aprovação do dono
para o commit — **migrations pendentes de aplicação em produção** (aplicadas e validadas no projeto
dedicado de E2E; produção fica a critério do dono, por convenção deste projeto).
**Depende de:** REF-ADMIN-01/02 (as 3 limitações que esta REF fecha foram documentadas lá),
REF-ADMIN-CATALOG-01 (`categoria_ids`), NORM-06 F1B (padrão de triggers STI, referência de estilo),
REF-ORDER-01 (schema de `orders`/RPCs existentes).
**Relacionado:** encerra o ciclo REF-ADMIN-01→02→03 de robustecimento do Painel Administrativo.

## Onda 1 — Integridade definitiva das categorias

### Auditoria (schema real de produção)

Via conexão Postgres direta (credenciais `C:\Users\00thi\.encanto\db.env`, só leitura em pg_catalog/
information_schema — nenhuma escrita): `products.categoria_ids` (text[]) não tinha índice nem
enforcement nenhum no banco. `categoria_id` (legado, singular) tem FK `fk_categoria` (ON DELETE SET
NULL) + trigger STI `trg_sti_product_categoria_is_business`. O projeto JÁ TEM um sistema de triggers
STI maduro (NORM-06 F1B: `trg_sti_categoria_tipo`, `trg_sti_product_categoria`,
`trg_sti_adicional_categoria`, `trg_sti_pc_collection`) para um invariante diferente (tipo
business/collection) — o cabeçalho desse próprio migration documenta "DELETE/TRUNCATE não podem CRIAR
inconsistência de TIPO", mas não cobre a órfã de `categoria_ids` (um invariante diferente: referência
existente após o DELETE, não tipo).

### Alternativas avaliadas

- **CHECK constraint:** não se aplica (não valida contra outra tabela; array não suporta FK).
- **Trigger `BEFORE DELETE` em `categories`:** fecha o caso real (delete de categoria em uso) e
  qualquer caminho de escrita futuro fora do botão do Admin. Fecha PARCIALMENTE a corrida TOCTOU (ver
  "Escopo não coberto" abaixo).
- **RPC atômica (`delete_category_if_unused`):** mesmo efeito da trigger para o caso comum, mas exige
  reescrever a chamada de UI para uma RPC em vez de 2 chamadas `.select()`+`.delete()`; sem ganho sobre
  a trigger para justificar a reescrita.

### Decisão — reverte a conclusão da REF-ADMIN-02

A REF-ADMIN-02 (sem ler o schema real) concluiu que o guard de aplicação bastava, presumindo que uma
trigger seria infraestrutura estranha ao projeto. A auditoria desta REF mostrou o oposto: uma trigger
`BEFORE DELETE ON categories` é uma EXTENSÃO natural de um padrão já estabelecido (NORM-06 F1B), não
uma arquitetura nova. Implementado `trg_categoria_delete_guard()`/`trg_categoria_delete`, no MESMO
estilo (RAISE EXCEPTION + `ERRCODE=check_violation`, `CREATE OR REPLACE TRIGGER`,
`migrations/REF-ADMIN-03-categoria-delete-guard.sql` + rollback). Também pesou a favor: "preparação
para SaaS" (múltiplos admins/lojas concorrentes) torna a corrida TOCTOU bem menos hipotética do que no
cenário atual (1 admin, 1 loja).

Índice `products_categoria_ids_gin_idx` (GIN) criado — não existia nenhum sobre `categoria_ids`;
acelera tanto esta trigger quanto `DS.produtosNaCategoria`/`prodInCat` conforme o catálogo cresce.

**Bug real corrigido:** `DS.delCat` ignorava o `error` do `.delete()` e sempre devolvia `{ok:true}` —
se a trigger nova (ou qualquer erro de rede) recusasse a exclusão, a UI reportaria sucesso falso.
Corrigido para checar `r.error`, reconta o vínculo e devolve `{ok:false,count}` com a mesma precisão
do caminho normal.

### Escopo deliberadamente NÃO coberto

Uma trigger simétrica em `products` (`BEFORE INSERT OR UPDATE OF categoria_ids`, com `FOR SHARE` na(s)
categoria(s) referenciada(s)) fecharia a corrida TOCTOU a 100% (mesmo desenho de lock do NORM-06 F1B:
o `DELETE` já toma um lock de linha na categoria; um `FOR SHARE` do lado de `products` serializaria as
duas operações). NÃO implementada nesta REF: criaria um subsistema de integridade referencial NOVO
para o array inteiro (hoje `categoria_ids` não valida existência de categoria de jeito nenhum, nem
fora desta trigger) — desproporcional ao pedido ("fortalecer o que existe", não "construir enforcement
novo para um invariante diferente"). Reavaliar se REALMENTE aparecer operação multi-admin concorrente
na mesma categoria (hoje: 1 admin, ações sequenciais via clique + confirm).

### Validação

Migration aplicada e testada de verdade no projeto Supabase DEDICADO de E2E (`encanto-e2e`,
credenciais `db.e2e.env`, JAMAIS produção — confirmado por comparação de `PGUSER`/ref do projeto antes
de qualquer DDL). Teste novo (`admin-categorias.spec.js`) prova, via `supabaseAdmin()` direto
(bypassa UI/app por completo), que o banco recusa o DELETE sozinho. **PENDENTE DONO:** aplicar
`migrations/REF-ADMIN-03-categoria-delete-guard.sql` em produção (convenção deste projeto: schema de
produção é sempre aplicado manualmente pelo dono, nunca por esta sessão — nem por necessidade real,
já que o guard de aplicação já cobre o caso comum sozinho).

## Onda 2 — Sessão Admin totalmente resiliente

### Achado

`db` (cliente Supabase do Admin) nunca teve `storageKey` explícito — dependia da chave DEFAULT que o
supabase-js deriva da URL do projeto (`sb-<ref>-auth-token`, formato interno/não documentado da lib),
ao contrário de `dbCliente` (sempre teve chave própria, `'encanto-cliente-auth'`, isolando a sessão do
cliente da do Admin). `useAdminSession.js` (REF-ADMIN-02) e os specs de E2E tinham CADA UM sua própria
cópia da lógica de reconstruir essa chave a partir da URL — dependência implícita do formato interno
da lib, espalhada em 2 lugares.

### Fix

Novo `src/constants/authStorage.js` — folha pura (zero imports), importável tanto pelo bundle Vite
quanto por specs Node puros (mesmo padrão de `utils/searchText.js`) — centraliza as DUAS chaves
(`ADMIN_AUTH_STORAGE_KEY`, `CLIENTE_AUTH_STORAGE_KEY`). `lib/supabase.js` passa
`storageKey: ADMIN_AUTH_STORAGE_KEY` explicitamente; `lib/dbCliente.js` importa
`CLIENTE_AUTH_STORAGE_KEY` da mesma fonte (era um literal solto). `useAdminSession.js` só IMPORTA a
constante — nenhuma reconstrução de URL. `admin-sessao.spec.js` idem, eliminando a dependência
implícita tanto do lado de produção quanto do lado de teste.

### Compatibilidade (exigência explícita desta onda)

Trocar a storageKey por si só deslogaria todo Admin já autenticado em produção no próximo deploy (a
sessão antiga fica sob a chave antiga, ilegível pela nova). Fix: `migrarChaveSessaoAdminLegada()` em
`lib/supabase.js`, roda 1× no load do módulo, ANTES do `createClient()` — varre `localStorage` por
qualquer chave no formato `sb-*-auth-token` (só o formato default bate esse padrão; `dbCliente` sempre
teve chave própria, sem risco de colisão) e migra o valor para a chave nova, removendo a antiga. Sem
chave antiga presente = no-op instantâneo (não atrasa o boot de ninguém). Validado por um teste E2E
que injeta uma sessão REAL (login de verdade via `signInWithPassword`) sob a chave antiga simulada e
confirma: painel abre sem pedir login de novo + chave nova populada + chave antiga removida.

### Reavaliação completa do hook (pedida explicitamente pela REF)

O restante de `useAdminSession.js` (máquina de estados `mode`, dupla verificação
`getSession()`+`onAuthStateChange`, separação Ver-loja/Sair) foi relido por completo — nenhuma outra
simplificação de baixo risco identificada. A dupla verificação espelha DELIBERADAMENTE o padrão já
usado por `AuthProvider` do lado do cliente (documentado assim desde a REF-ADMIN-01) — não é
duplicação acidental. Removê-la trocaria um padrão robusto e testado por uma economia marginal de
linhas, sem ganho real e com risco de regressão num fluxo sensível (sessão). Decisão consciente de NÃO
mexer, registrada aqui em vez de mudar por mudar.

## Onda 3 — Escalabilidade do módulo de Pedidos

### Causa raiz (2 bugs latentes, mascarados só pelo volume atual — 71 pedidos)

`DS.getPedidos()` fazia `select('*, customers(...), order_items(*))'.limit(100)` — sem paginação nem
filtro server-side. Consequências:
1. `AdminDashboard.jsx` computava "Total geral" (`orders.length`) e o breakdown por status
   (`orders.filter(...).length`) reduzindo esse MESMO array capado em 100 — correto só enquanto o
   histórico total coubesse nessas 100 linhas; assim que a loja passasse de 100 pedidos HISTÓRICOS
   (não só do dia), esses números ficariam silenciosamente errados.
2. A busca/filtro de Pedidos (REF-ADMIN-02 · Onda 3) rodava client-side sobre esse MESMO array — um
   pedido antigo fora da janela dos 100 mais recentes nunca apareceria numa busca por telefone.
Nenhum índice em `orders.status` (só `created_at DESC` e `customer_id`).

### Solução

2 RPCs `SECURITY INVOKER` (respeitam a RLS já existente automaticamente — as policies "Admin all
orders/customers" já liberam tudo para `is_admin()`; um chamador não-admin só veria os PRÓPRIOS
pedidos, via a policy "Cliente le proprios orders", nunca vazando dado alheio mesmo fora do uso
pretendido) em `migrations/REF-ADMIN-03-orders-scale.sql`:

- **`admin_orders_stats()`** — agregados do Dashboard (total geral, hoje/faturamento hoje, breakdown
  por status) calculados em SQL sobre a tabela INTEIRA, nunca capados por um `limit()` do app. "Hoje"
  calculado no fuso da loja (`created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'`),
  espelhando `dataLojaYMD` do lado cliente.
- **`admin_orders_search(p_search,p_status,p_limit,p_cursor_created_at,p_cursor_id)`** — busca
  (nome/telefone do cliente, uuid completo, ref curta) + filtro de status + paginação por CURSOR
  (keyset: `(created_at,id) < (cursor)`, não OFFSET — O(log n) via índice, estável mesmo com pedidos
  novos chegando entre páginas, ao contrário de OFFSET que degrada linearmente e pode pular/repetir
  linhas). Retorna `customers`/`order_items` no MESMO formato do embed PostgREST
  (`customers(name,phone)`/`order_items(*)`) — compatibilidade total com `comandaModel.js`/
  `PedidoNotificacoes.jsx`/`AdminPedidos.jsx`, sem mudar nenhum consumidor downstream.
- Índice novo: `orders_status_created_at_idx (status, created_at DESC)` — suporta
  `WHERE status=X ORDER BY created_at DESC` sem sequential scan + sort.

**DataService:** `getPedidos()` (legado) removido — substituído por `getPedidosStats()`,
`getPedidosRecentes(n)` (só para o Dashboard, não precisa order_items nem busca) e
`getPedidosPagina({busca,status,limit,cursor})`. Guard de anatomia (`test:ds-micro`) atualizado (24
métodos, não mais 22) e reforçado com um check explícito de que `getPedidos()` não deve voltar.

**Hooks novos:** `useOrdersStats` (Dashboard — agregados + N mais recentes; auto-refresh 60s,
preservando o intervalo de antes) e `useOrdersPagina` (Pedidos — busca debounced 300ms + filtro +
"Carregar mais" via cursor). `useOrders.js` (antigo) removido — nenhum consumidor restante.

**Componentes:** `AdminDashboard.jsx` e `AdminPedidos.jsx` migrados para os hooks novos, MESMO
layout/UX. Os stat-cards de `AdminPedidos.jsx` passam a usar o MESMO agregado global do Dashboard
(`useOrdersStats(0)` — sem custo da consulta de "recentes", só os agregados), em vez de contar sobre a
página local carregada (que agora é só um recorte, não o total).

### Decisão — número sequencial "#N" retirado do card de Pedidos

O `#N` (posição no array COMPLETO, `orders.length - i`) não compõe com busca/paginação sobre a tabela
inteira sem um custo desproporcional: calcular a "posição global" de um pedido arbitrário exigiria uma
window function sobre TODA a tabela orders a cada request (rank global), o que reintroduziria
exatamente o tipo de full-scan que esta onda existe para eliminar. "Ref. XXXXXXXX" (8 primeiros chars
do id) já era exibido no card e já é o identificador usado em outros pontos do sistema (Meus Pedidos do
cliente, notificação WhatsApp — "a cozinha casa pelo REF curta", não pelo número) — vira o único
identificador curto do card. `comandaModel.numeroFormatado` já tinha um fallback pronto para quando
`numero` não é passado (usa a mesma ref curta) — nenhuma mudança necessária no domínio da comanda;
`AdminPedidos.jsx` simplesmente parou de passar esse argumento.

**Alternativa descartada:** uma coluna `orders.numero_sequencial` persistida (sequence + backfill)
resolveria com custo O(1) de leitura e preservaria o número exato — mas é uma mudança de schema (nova
coluna, migration de backfill, aplicação em produção) desproporcional a um detalhe cosmético de
exibição, sem nenhum lugar do sistema que dependa desse número como identificador de negócio (o WhatsApp
e o "Meus Pedidos" do cliente já usam a ref curta, nunca o "#N"). Descartada conscientemente.

**Índice de busca em `customers.name/phone` (trigram/pg_trgm) — NÃO criado:** `customers` cresce por
PESSOA única, não por pedido; mesmo em "dezenas de milhares" de pedidos, a base de clientes de um
único comércio tende a ficar ordens de grandeza menor — um sequential scan no `ILIKE` continua na
casa de poucos ms. Reavaliar só se a base de clientes um dia crescer de forma independente (ex.: SaaS
multi-loja somando bases de clientes distintas).

### Bug real encontrado e corrigido — race condition em `useOrdersPagina`

Ao rodar a suíte Playwright **inteira** (não só a pasta `admin`), o teste
"filtro por status mostra só pedidos daquele status" (`admin-pedidos-busca.spec.js`, herdado da
REF-ADMIN-02) falhou de forma intermitente — passava isolado, falhava dentro do conjunto completo.
Causa raiz: mudar o filtro de status logo após o mount de `AdminPedidos` dispara 2 requests (o inicial
sem filtro, do mount + o novo, filtrado) — sem garantia de ORDEM de resposta de rede; se o request SEM
filtro respondesse DEPOIS do filtrado, `setOrders` era chamado por último com a lista INTEIRA,
sobrescrevendo o resultado correto (um clássico bug de "resposta fora de ordem" em hooks de fetch).
Corrigido com um `requestIdRef` incremental — cada chamada de `carregar()` captura seu próprio id;
qualquer resposta cujo id não seja mais o mais recente é descartada silenciosamente. Reexecutada a
suíte inteira depois do fix: 104/104 verdes, sem flake.

### Testes (`e2e/tests/admin/admin-pedidos-escala.spec.js`, novo)

3 testes, provados DIRETO contra o backend (`supabaseAdmin()`, mesmo padrão do teste do trigger da
Onda 1) — mais baratos e determinísticos do que criar dezenas de pedidos só para forçar "Carregar
mais" pela UI: (1) busca encontra um pedido antigo mesmo com `p_limit=1` e um pedido mais novo
existindo — prova que o WHERE roda antes do LIMIT, não é limitado pela "primeira página"; (2)
paginação por cursor não pula nem repete pedidos entre 2 páginas consecutivas; (3)
`admin_orders_stats()` reflete o total real (incrementa exatamente 1 ao inserir 1 pedido novo),
independente de qualquer `limit()` do app.

## Verificação final

- `npx playwright test --project=chromium e2e/tests/admin` — 52/52 (isolado).
- `npm run test:e2e` (suíte inteira, todos os domínios) — **104/104** (era 92 ao fim da REF-ADMIN-02;
  1ª rodada pegou o flake real da race condition, 2ª rodada 100% verde após o fix).
- Suíte de domínio completa (mesma lista das REFs anteriores, ~24 scripts) — 100% verde.
- `verify:norm05`, `guard:slug` — verdes, zero escrita persistida.
- `test:rls` (PASS=15), `test:orders-rls` (PASS=16), `test:auth-rls` (PASS=10) — 100% verde, zero
  escrita persistida.
- `test:f1b` — PASS=19, FAIL=3 (RA1·I2/RA2·I2/RA3·I2): as MESMAS falhas pré-existentes/congeladas
  desde a REF-ADMIN-CATALOG-01, confirmadas de novo sem relação com nenhum arquivo tocado por esta REF.
- `npm run build` — build de produção limpo.

## Limitações conhecidas (fora do escopo desta REF)

- Onda 1: trigger simétrica em `products.categoria_ids` (fecharia a corrida TOCTOU a 100%) não criada
  — decisão consciente, ver §Onda 1.
- Onda 2: `possivelSessaoAdmin()`/migração dependem da chave `ADMIN_AUTH_STORAGE_KEY` permanecer a
  fonte única — centralizado em `constants/authStorage.js`, então uma mudança futura só precisa tocar
  1 arquivo.
- Onda 3: coluna `numero_sequencial` persistida não criada (ver §Onda 3); índice trigram em
  `customers` não criado (ver §Onda 3); `admin_orders_search` pagina por `created_at`/`id` — uma
  ordenação diferente (ex.: por total) não é suportada nesta 1ª versão (não foi pedida).
- 2 migrations desta REF (`REF-ADMIN-03-categoria-delete-guard.sql`,
  `REF-ADMIN-03-orders-scale.sql`) aplicadas e validadas no projeto DEDICADO de E2E — **pendentes de
  aplicação em produção pelo dono**, por convenção já estabelecida neste projeto.

## Recomendações para futuras REFs

- Se o volume de pedidos crescer de forma substancial, revisitar a expressão de fuso-horário de
  `admin_orders_stats()` (`hoje_count`/`hoje_total`) — hoje faz um scan completo com conversão de fuso
  por linha; um índice de expressão sobre a data-loja resolveria se algum dia isso for perceptível.
  Não foi criado agora por ser prematuro para o volume atual.
- Se a REF-ADMIN-CATALOG-01/02/03 evoluir para múltiplos admins operando simultaneamente na mesma
  categoria, reavaliar a trigger simétrica em `products.categoria_ids` descartada na Onda 1.
- `admin_orders_search` foi desenhada para ordenação fixa por `created_at DESC` — se um dia for pedida
  ordenação por outro campo (total, status), precisará de um cursor composto diferente por campo de
  ordenação.
