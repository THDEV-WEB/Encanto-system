# REF-ADMIN-03 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida (limite, queda, sessão encerrada), retomar
EXCLUSIVAMENTE a partir daqui — não repetir auditoria já concluída abaixo.

**Commit-base desta REF:** `3e7a15c` (REF-ADMIN-02, já commitada e aprovada).
**Regra do dono para esta REF:** executar tudo nesta sessão, apresentar relatório final, **NÃO
commitar nem dar push** — aguardar aprovação em revisão posterior.

## Estado atual

✅ REF-ADMIN-03 CONCLUÍDA INTEGRALMENTE (3/3 ondas), validação final 100% verde. Aguardando ADR +
relatório técnico final (em elaboração) e aprovação do dono para o commit. **NÃO commitar/dar push.**

## Onda 1 — Integridade definitiva das Categorias

Status: ✅ CONCLUÍDA.

**Auditoria real do schema de produção** (via conexão pg direta, credenciais `C:\Users\00thi\.encanto\db.env`,
somente leitura em pg_catalog/information_schema): `products.categoria_ids` (text[]) não tinha
NENHUM índice nem enforcement no banco (ao contrário de `categoria_id`, que tem FK `fk_categoria` +
trigger STI `trg_sti_product_categoria`). Descoberta importante: o projeto JÁ TEM um sistema de
triggers STI maduro (NORM-06 F1B, `trg_sti_*`) para outro invariante (tipo business/collection) — o
próprio comentário desse migration documenta "DELETE/TRUNCATE não podem CRIAR inconsistência de tipo",
mas não cobre a órfã de `categoria_ids`, que é um invariante DIFERENTE.

**Decisão (reverte a conclusão da REF-ADMIN-02 à luz do schema real):** implementado trigger
`BEFORE DELETE ON categories` (`trg_categoria_delete_guard`/`trg_categoria_delete`), no MESMO estilo
das triggers STI existentes (RAISE EXCEPTION + ERRCODE=check_violation, `CREATE OR REPLACE TRIGGER`).
Motivo da reversão: a auditoria anterior (REF-ADMIN-02) não tinha lido o schema real e presumiu que
uma trigger seria infraestrutura nova/estranha ao projeto — na verdade é uma EXTENSÃO natural de um
padrão já estabelecido. Também: "preparação para SaaS" (múltiplos admins concorrentes) torna a corrida
TOCTOU bem menos hipotética do que no cenário atual (1 admin). Migration aplicada e validada de
verdade no projeto DEDICADO de E2E (`encanto-e2e`, credenciais `db.e2e.env`, NUNCA produção) — teste
E2E novo prova que o banco recusa o DELETE mesmo indo direto pelo backend, sem passar pela UI/app.
**PENDENTE DONO:** aplicar em produção (`migrations/REF-ADMIN-03-categoria-delete-guard.sql`) — por
convenção do projeto, migrations de schema em produção são aplicadas manualmente pelo dono, nunca por
esta sessão (nem havia necessidade: o guard de aplicação já cobre o caso comum).

**Escopo deliberadamente NÃO coberto:** uma trigger simétrica em `products` (INSERT/UPDATE de
`categoria_ids` com `FOR SHARE` na categoria) fecharia a corrida a 100%, mas criaria um subsistema de
integridade referencial NOVO para o array inteiro (hoje `categoria_ids` não valida existência da
categoria de jeito nenhum, nem fora desta trigger) — desproporcional ao pedido desta REF (fortalecer o
que existe, não construir enforcement novo para um invariante diferente). Documentado no ADR.

Bug real corrigido: `DS.delCat` ignorava `r.error` do DELETE e sempre devolvia `{ok:true}` — se a
trigger nova (ou qualquer erro de rede) recusasse a exclusão, a UI reportaria sucesso falso. Corrigido
para checar `r.error` e reconta o vínculo antes de devolver `{ok:false,count}`.

Índice `products_categoria_ids_gin_idx` (GIN) criado — não existia nenhum sobre `categoria_ids`;
acelera tanto esta trigger quanto `DS.produtosNaCategoria`/`prodInCat` conforme o catálogo cresce.

**Arquivos:**
- `migrations/REF-ADMIN-03-categoria-delete-guard.sql` (novo) + `-rollback.sql` (novo)
- `src/services/DataService.js` — `delCat` checa `r.error`
- `e2e/tests/admin/admin-categorias.spec.js` — novo teste (trigger via backend direto)
- `tests/dataservice.micro.mjs` — novo guard R6 (delCat não pode voltar a ignorar `r.error`)

**Testes:** `test:ds-micro` (R6 novo) verde; `admin-categorias.spec.js` 5/5 (1 novo).

## Onda 2 — Sessão Admin totalmente resiliente

Status: ✅ CONCLUÍDA.

**Achado:** `db` (sessão do Admin) nunca teve `storageKey` explícito — dependia da chave DEFAULT que
o supabase-js deriva da URL do projeto (`sb-<ref>-auth-token`, formato interno/não documentado), ao
contrário de `dbCliente` (que sempre teve chave própria, `'encanto-cliente-auth'`). `useAdminSession.js`
E os specs de E2E tinham CADA UM sua própria cópia da lógica de reconstruir essa chave a partir da
URL — dependência implícita espalhada em 2 lugares.

**Fix:** novo `src/constants/authStorage.js` (folha pura, zero imports, importável tanto pelo bundle
Vite quanto por specs Node puros) centraliza as DUAS chaves (`ADMIN_AUTH_STORAGE_KEY`,
`CLIENTE_AUTH_STORAGE_KEY`). `lib/supabase.js` agora passa `storageKey: ADMIN_AUTH_STORAGE_KEY`
explicitamente ao criar `db`; `lib/dbCliente.js` passa a importar `CLIENTE_AUTH_STORAGE_KEY` da mesma
fonte (era um literal solto). `useAdminSession.js` só IMPORTA a constante — nenhuma reconstrução de
URL. `admin-sessao.spec.js` idem.

**Compatibilidade (exigência explícita da REF):** trocar a storageKey por si só DESLOGARIA todo Admin
já autenticado em produção no próximo deploy (sessão antiga fica sob a chave antiga, ilegível pela
nova). Fix: `migrarChaveSessaoAdminLegada()` em `lib/supabase.js`, roda 1x no load do módulo, ANTES do
`createClient` — varre `localStorage` por qualquer chave no formato `sb-*-auth-token` (só a do Admin
usa esse formato; `dbCliente` sempre teve chave própria, sem risco de colisão) e copia o valor para a
chave nova, removendo a antiga. Sem chave antiga = no-op instantâneo (não atrasa o boot de ninguém).
Validado por um teste E2E que injeta uma sessão REAL sob a chave antiga e confirma: painel abre sem
pedir login de novo + chave nova populada + chave antiga removida.

**Reavaliação completa do hook (pedida explicitamente):** o restante de `useAdminSession.js` (máquina
de estados mode, dupla verificação getSession()+onAuthStateChange, separação Ver-loja/Sair) foi relido
por completo — nenhuma outra simplificação de baixo risco identificada. A dupla verificação espelha
DELIBERADAMENTE o padrão já usado por `AuthProvider` do cliente (não é duplicação acidental); removê-la
trocaria um padrão robusto e testado por uma economia marginal de linhas, sem ganho real e com risco de
regressão num fluxo sensível (sessão). Documentado no ADR como decisão consciente de NÃO mexer.

**Arquivos:**
- `src/constants/authStorage.js` (novo)
- `src/lib/supabase.js` — storageKey explícito + migração 1x da chave legada
- `src/lib/dbCliente.js` — importa a constante em vez do literal solto
- `src/hooks/useAdminSession.js` — remove a derivação via URL, só importa a constante
- `e2e/tests/admin/admin-sessao.spec.js` — idem + novo teste de migração da chave legada

**Testes:** `npm run build` limpo; `admin-sessao.spec.js` 5/5 (1 novo: migração da chave legada);
`admin-logout.spec.js` 2/2; suíte `e2e/tests/auth` (cliente, `dbCliente`) 8/8 — confirma isolamento
admin/cliente preservado.

## Onda 3 — Escalabilidade do módulo de Pedidos

Status: ✅ CONCLUÍDA.

**Causa raiz (2 bugs latentes hoje, mascarados só pelo volume atual de 71 pedidos):**
`DS.getPedidos()` fazia `select(...).limit(100)` sem paginação nem filtro server-side. (1)
`AdminDashboard.jsx` computava "Total geral" e o breakdown por status reduzindo esse MESMO array de
no máximo 100 linhas — ficaria silenciosamente errado (capado) assim que o histórico total passasse de
100 pedidos. (2) A busca/filtro de Pedidos (REF-ADMIN-02) rodava client-side sobre essa mesma janela —
um pedido antigo fora dos 100 mais recentes nunca apareceria numa busca por telefone. Nenhum índice em
`orders.status` (só `created_at DESC`/`customer_id`).

**Solução:** 2 RPCs SECURITY INVOKER (respeitam a RLS existente automaticamente — "Admin all
orders/customers" já libera tudo para is_admin(), sem duplicar o check) em
`migrations/REF-ADMIN-03-orders-scale.sql`:
- `admin_orders_stats()` — agregados (total geral, hoje/faturamento hoje, breakdown por status) via
  SQL sobre a tabela INTEIRA, nunca capados por um `limit()` do app.
- `admin_orders_search(p_search,p_status,p_limit,p_cursor_created_at,p_cursor_id)` — busca
  (cliente/telefone/ref/id) + filtro de status + paginação por CURSOR (keyset, não OFFSET — estável
  com pedidos novos chegando entre páginas). Retorna `customers`/`order_items` no MESMO formato que o
  embed do PostgREST já produzia (compatibilidade total com comandaModel.js/PedidoNotificacoes.jsx).
- Índice novo: `orders_status_created_at_idx (status, created_at DESC)`.
- Migration aplicada e validada de verdade no projeto DEDICADO de E2E (mesmo procedimento da Onda 1) —
  3 testes novos (`admin-pedidos-escala.spec.js`) provam DIRETO contra o backend: busca encontra um
  pedido mesmo com `p_limit` menor que a posição dele; paginação por cursor não pula nem repete linhas;
  `admin_orders_stats` reflete o total real sem depender de nenhum `limit()` do app.
  **PENDENTE DONO:** aplicar em produção (mesma convenção da Onda 1).

**DataService:** `getPedidos()` (legado) removido — substituído por `getPedidosStats()`,
`getPedidosRecentes(n)` (só o Dashboard) e `getPedidosPagina({busca,status,limit,cursor})`. Guard de
anatomia (`test:ds-micro`) atualizado para refletir o novo contrato (24 métodos, não mais 22).

**Hooks novos:** `useOrdersStats` (Dashboard: agregados + N mais recentes, auto-refresh 60s, mesmo
intervalo de antes) e `useOrdersPagina` (Pedidos: busca debounced 300ms + filtro + "Carregar mais"
via cursor). `useOrders.js` (antigo, só usado por esses 2 componentes) removido — sem consumidores
restantes.

**Componentes:** `AdminDashboard.jsx` consome `useOrdersStats` (mesmo layout/UX, fonte de dados
trocada). `AdminPedidos.jsx` consome `useOrdersPagina` + `useOrdersStats(0)` (stat-cards agora usam o
MESMO agregado global do Dashboard, não mais a lista local); botão "Carregar mais" quando há próxima
página; estado vazio distingue "nenhum pedido ainda" de "nenhum com esses filtros".

**Decisão deliberada — número sequencial "#N" retirado do card:** o `#N` (posição no array completo)
não compõe com busca/paginação sobre a tabela inteira sem um full-scan a cada request (calcular
"posição global" exigiria uma window function sobre TODA a tabela). "Ref. XXXXXXXX" (8 chars do id) já
era exibido e já é o identificador usado em outros pontos do sistema (Meus Pedidos do cliente,
notificação WhatsApp) — vira o único identificador curto. `comandaModel.numeroFormatado` já tinha
fallback pronto para quando `numero` não é passado (usa a mesma ref curta) — zero mudança no domínio
da comanda. Alternativa descartada: coluna `numero_sequencial` persistida (sequence) resolveria com
custo O(1) de leitura, mas é mudança de schema (nova coluna + backfill) desproporcional a um detalhe
cosmético — descartada conscientemente (ver ADR).

**Índice de busca em `customers.name/phone` (pg_trgm) — NÃO criado:** customers cresce por PESSOA
única, não por pedido; mesmo em "dezenas de milhares" de pedidos, a base de clientes de um único
comércio tende a ficar ordens de grandeza menor — sequential scan no ILIKE continua na casa de poucos
ms. Reavaliar só se a base de clientes crescer de forma independente (ex.: SaaS multi-loja).

**Bug real encontrado e corrigido (achado ao rodar a suíte INTEIRA, não só a pasta admin):** race
condition em `useOrdersPagina` — mudar o filtro de status logo após o mount disparava 2 requests (o
inicial sem filtro + o novo filtrado); sem garantia de ordem de resposta da rede, se o request SEM
filtro respondesse DEPOIS do filtrado, sobrescrevia o resultado correto com a lista inteira
(`admin-pedidos-busca.spec.js` "filtro por status" pegou isso ao rodar `npm run test:e2e` completo,
mesmo passando isolado na pasta admin). Corrigido com `requestIdRef` — descarta qualquer resposta que
não seja mais a da chamada MAIS RECENTE (padrão clássico para race de fetch em hooks).

**Arquivos (Onda 3):**
- `migrations/REF-ADMIN-03-orders-scale.sql` (novo) + `-rollback.sql` (novo)
- `src/services/DataService.js` — getPedidos() removido, 3 métodos novos
- `src/hooks/useOrdersStats.js` (novo), `src/hooks/useOrdersPagina.js` (novo), `src/hooks/useOrders.js` (removido)
- `src/components/admin/AdminDashboard.jsx`, `src/components/admin/AdminPedidos.jsx`
- `tests/dataservice.micro.mjs` — anatomia atualizada (24 métodos)
- `e2e/tests/admin/admin-pedidos-escala.spec.js` (novo, 3 testes)
- `e2e/tests/admin/admin-dashboard.spec.js`, `e2e/tests/admin/admin-pedidos-busca.spec.js` — comentários atualizados

**Testes:** suíte admin completa 52/52 na 1ª rodada isolada; suíte `test:e2e` INTEIRA 104/104 (após o
fix da race condition — 1ª rodada pegou o flake real, 2ª rodada 100% verde).

## VALIDAÇÃO FINAL (checkpoint obrigatório antes de iniciar a próxima referência)

- ✅ 3/3 ondas concluídas (Onda 1 decisão formal + trigger; Onda 2 storageKey centralizado + migração
  de sessão legada; Onda 3 paginação/busca/stats server-side + fix de race condition)
- ✅ Todas as correções relacionadas implementadas (delCat ignorava erro; race condition em useOrdersPagina)
- ✅ Documentação atualizada: este arquivo de progresso + ADR `docs/adr/REF-ADMIN-03-...md` +
  `e2e/README.md` (seção nova)
- ⚠️ Migrations: 2 migrations novas (`REF-ADMIN-03-categoria-delete-guard.sql`,
  `REF-ADMIN-03-orders-scale.sql`) aplicadas e validadas no projeto DEDICADO de E2E (nunca produção,
  por convenção estabelecida deste projeto); **PENDENTES no dono para produção**
- ✅ Todos os testes desta REF executados (7 novos no total: 1 Onda 1 + 1 Onda 2 + 1 do fix + 3 Onda 3;
  na prática 5 specs novos/atualizados — ver contagem exata no relatório final)
- ✅ Suíte Playwright completa reexecutada: **104/104** (era 92 no início desta REF)
- ✅ Testes de domínio (~24 scripts): 100% verde
- ✅ `verify:norm05`/`guard:slug`/`test:rls`/`test:orders-rls`/`test:auth-rls`: 100% verde, zero escrita persistida
- ⚠️ `test:f1b`: PASS=19/FAIL=3 — as MESMAS 3 falhas pré-existentes/congeladas desde REF-ADMIN-CATALOG-01
  (RA1·I2/RA2·I2/RA3·I2), confirmadas de novo sem relação com nenhum arquivo tocado por esta REF
- ✅ `npm run build`: limpo
- ✅ **Zero regressões confirmadas** (o único achado, uma race condition genuína introduzida por esta
  própria REF, foi encontrado pela suíte e corrigido antes do encerramento)

**PRÓXIMO PASSO:** apresentar ADR final + relatório técnico completo, depois iniciar REF-CI-01
automaticamente (autorização já concedida pelo dono), sem commitar/dar push desta REF.
