# REF-ADMIN-01 — Robustez do Painel Administrativo

**Status:** ✅ Implementada e verificada (2026-07-24) — 3 ondas, 46/46 specs do Admin (43 antigos + 3
novos, alguns reescritos) + 92/92 da suíte E2E inteira (era 87 ao fim da REF-E2E-03) + suíte de
domínio 100% (exceto as 3 falhas pré-existentes/congeladas de `test:f1b`, ver §Verificação), sem
regressão. Aguardando aprovação do dono para o commit.
**Depende de:** REF-E2E-03 (identificou os 3 achados corrigidos aqui, cobertura E2E do Admin já
existente reaproveitada integralmente), REF-ADMIN-CATALOG-01 (arquitetura `categoria_ids`), AUTH-01
(padrão de sessão do cliente, espelhado aqui para o Admin).
**Relacionado:** fecha 3 dos 4 "gaps de produto documentados, não corrigidos" listados no
fechamento da REF-E2E-03 (exclusão de categoria em uso, sessão do Admin nunca restaurada,
Dashboard sem nome/telefone). O 4º gap (Admin sem busca/filtro em Pedidos) fica fora — não fazia
parte do pedido desta REF.

Esta REF parte diretamente dos achados já documentados (leitura de código feita na REF-E2E-03,
revalidada aqui antes de cada fix) — não repete a auditoria do zero.

## Onda 1 — Exclusão de categoria em uso

**Achado (REF-E2E-03 §1.5, provado ao vivo por teste):** `DS.delCat` fazia
`DELETE FROM categories WHERE id=?` sem checar vínculo nenhum. A FK legada `categoria_id` (singular)
tem `ON DELETE SET NULL` e zera sozinha, mas `categoria_ids` (`text[]`, fonte real da arquitetura
multi-categoria da REF-ADMIN-CATALOG-01) não tem FK nenhuma — a exclusão sucedia e deixava produtos
com uma referência órfã, nunca limpa.

**Fix:** guard de aplicação, não mudança de schema (menor risco, nenhuma migration necessária).

- `src/services/DataService.js`: nova função `produtosNaCategoria(id)` conta produtos que referenciam
  a categoria (`.contains('categoria_ids',[id])`, o operador `@>` do Postgres — mesmo padrão de head-
  count já usado por `countPedidosByCustomer`). `delCat(id)` agora chama essa contagem ANTES de
  excluir; se `count > 0`, devolve `{ok:false, count}` sem tocar no banco; senão, exclui e devolve
  `{ok:true}`.
- `src/components/admin/AdminCategorias.jsx`: reage ao retorno — mostra mensagem clara
  (`Não é possível excluir "X": N produto(s) usam esta categoria.`, `data-testid="cat-erro"`) e não
  exclui nada quando bloqueado; segue o fluxo normal (recarrega a lista) quando permitido.

**Por que não um trigger no banco:** a única via de escrita em `categories.delete` hoje é este botão
(RLS já restringe a `is_admin()`); um guard de aplicação cobre o critério de aceitação por completo
sem alterar o modelo de dados. Documentado como trade-off consciente, não esquecimento.

### Testes (`e2e/tests/admin/admin-categorias.spec.js`)

- Reescrito o teste que documentava o bug ("achado real: excluir categoria em uso sucede...") para
  provar o FIX: cria categoria + produto vinculado, tenta excluir, confirma mensagem visível com a
  contagem certa, categoria e vínculo (`categoria_id`/`categoria_ids`) sobrevivem intactos no backend.
- Novo teste: categoria sem vínculo continua sendo excluída normalmente (exclusão permitida).
- `e2e/pages/AdminCategoriasPage.page.js`: novo getter `erroMensagem`.

## Onda 2 — Persistência da sessão do Admin

**Achado (REF-E2E-03 §1.2, provado ao vivo por teste):** `App.jsx` mantinha `mode`
(`'store'|'login'|'admin'`) num `useState` puro, sem nenhuma leitura de `db.auth.getSession()` /
`onAuthStateChange()` fora de `AdminLogin.jsx`. O client `db` já é criado com
`persistSession:true, autoRefreshToken:true` (`lib/supabase.js`) — o token sobrevive normalmente no
`localStorage` — mas nada no app o consultava no mount. Um F5 no meio do painel sempre caía na loja
(o hash `#admin-encanto` já tinha sido limpo via `history.replaceState` no 1º mount), mesmo com sessão
ainda válida. Além disso, "Sair" (sidebar) e "← Ver loja" (topo) chamavam o MESMO handler `onExit`,
que só trocava `mode` — nenhum dos dois chamava `db.auth.signOut()`.

**Fix:** novo hook `src/hooks/useAdminSession.js`, que move o gate de acesso para fora de `App.jsx` e
espelha o padrão já usado por `AuthProvider`/`AuthService` do lado do CLIENTE (`getSession()` no
mount + `onAuthStateChange()` para manter o estado sincronizado) — sem provider próprio, porque só
`App.jsx` consome esse estado (não há árvore de componentes do Admin abaixo que precise dele antes da
hora), e sem "carregar customer" (o Admin não tem perfil de cliente).

- `getSession()` no mount: se houver sessão válida, restaura `mode='admin'` — tanto vindo de
  `'store'` (F5 direto no painel) quanto de `'login'` (reabrir pelo link com `#admin-encanto` já
  autenticado, não precisa digitar senha de novo).
- `onAuthStateChange()`: mantém `admin`/`mode` sincronizados se a sessão cair enquanto o Admin está
  aberto (ex.: refresh token revogado) — uma única transição para `'store'`, sem loop.
- **Dois botões, dois comportamentos agora** (antes eram idênticos): "← Ver loja" (`verLoja()`) só
  troca de tela — é uma prévia, a sessão do Supabase permanece válida (F5 depois volta ao Admin).
  "Sair" (`sair()`, sidebar) chama `db.auth.signOut()` de verdade — depois disso, F5 cai na loja até
  logar de novo. Fecha o gap "logout que não desloga" identificado na REF-E2E-03.
- `src/App.jsx`: usa o hook no lugar do `useState` inline; `AdminPanel` recebe `onExit={verLoja}` e o
  novo prop `onLogout={sair}`.
- `src/components/admin/AdminPanel.jsx`: prop `onLogout` nova; o item "Sair" da sidebar (antes um
  `<div>` sem `role` nem `data-testid`, compartilhando handler com "← Ver loja") ganhou
  `data-testid="admin-logout"` e passou a chamar `onLogout` — separado de "← Ver loja" (`onExit`),
  que continua um `<button>` de texto estável.

**Modo degradado preservado:** se `db` for `null` (offline), o hook não tenta nada — mesmo
comportamento anterior (hash decide `mode` na inicialização síncrona, sem restauração).

### Testes

- `e2e/tests/admin/admin-sessao.spec.js` reescrito: o teste que documentava "reload perde o estado e
  cai na loja (achado real)" agora prova o oposto (sessão restaurada, sem re-pedir login); novo teste
  cobre acessar `#admin-encanto` já autenticado (pula direto para o painel); o teste de sessão
  forjada (token inválido não trava o boot) foi mantido e o comentário atualizado — a chave agora É
  lida pelo app, mas uma sessão forjada ainda resolve para `null` sem lançar erro nem travar a tela
  de login.
- `e2e/tests/admin/admin-logout.spec.js` reescrito: um teste por botão — "Ver loja" não chama
  `signOut()` (prévia) e a sessão sobrevive a um F5; "Sair" chama `signOut()` de verdade (prova por
  rede, `page.route('**/auth/v1/logout**')`) e a sessão NÃO sobrevive a um F5 depois.
- `e2e/pages/AdminPanel.page.js`: `sairButton`/`sair()` (que na prática testavam só "Ver loja", por
  serem o mesmo handler) viraram `verLojaButton`/`verLoja()` explícitos + novo `logoutButton`/
  `logout()` (via `data-testid="admin-logout"`) para o botão que agora tem comportamento próprio.

## Onda 3 — Dashboard operacional (nome/telefone do cliente)

**Achado (REF-E2E-03 §1.3, provado ao vivo por teste):** a tabela "Últimos pedidos" usava
`o.cliente_nome`/`o.cliente_telefone` — campos que NUNCA existiram no retorno de `DS.getPedidos()`
(o `select` traz `customers:{name,phone}` aninhado). A coluna "Cliente" sempre renderizava em branco.

**Fix:** `src/components/admin/AdminDashboard.jsx` passa a usar `o.customers?.name || '—'` /
`o.customers?.phone || ''` — o MESMO acesso já usado (e já funcionando) em `AdminPedidos.jsx` (aba
Pedidos); nenhuma consulta nova, nenhuma mudança de layout, reaproveita a estrutura que
`DS.getPedidos()` já trazia. O fallback `'—'` cobre pedidos sem `customer_id` vinculado
(compatibilidade com pedidos antigos/avulsos).

### Testes (`e2e/tests/admin/admin-dashboard.spec.js`)

- Novo teste: cria um pedido avulso real e confirma que nome e telefone aparecem na linha
  correspondente da tabela.
- Novo teste: zera `customer_id` de um pedido (via `service_role`, simulando um pedido sem cliente
  vinculado) e confirma que a tabela mostra `—` sem quebrar (ausência de regressão/compatibilidade).

## Verificação final

- `npx playwright test --project=chromium e2e/tests/admin` — 43/43 (inclui os 3 specs
  novos/reescritos desta REF).
- `npm run test:e2e` (suíte inteira, todos os domínios) — 92/92.
- Suíte de domínio completa (`test:pricing`, `test:addons`, `test:checkout`, `test:ds-micro`,
  `test:deps`, `test:render`, `test:price-domain`, `test:recompra`, `test:auth-lock`, `test:hours`,
  `test:store-status`, `test:loyalty`, `test:loyalty-guard`, `test:address*`, `test:catalog`,
  `test:catnav`, `test:spy`, `test:searchtext`, `test:admin-catalog`, `test:admin-addons`,
  `test:comanda`, `test:order-status`, `test:whatsapp*`, `verify:norm05`, `guard:slug`, `test:rls`,
  `test:orders-rls`, `test:auth-rls`) — 100% verde.
- `test:f1b` — PASS=19, FAIL=3 (RA1·I2/RA2·I2/RA3·I2): falhas **pré-existentes**, já registradas e
  congeladas desde a REF-ADMIN-CATALOG-01 (NORM-06), sem relação com nenhum arquivo tocado por esta
  REF — confirmado por leitura do próprio diff (nenhuma mudança em RLS/migrations/`tipo=collection`).
- `npm run build` — build de produção limpo, sem erro de módulo (confirma que a remoção do
  `useState` inline em `App.jsx` e o novo hook não quebram a árvore de imports).
- Zero dado de teste remanescente no projeto `encanto-e2e` (cada spec novo limpa o que cria).

## Limitações conhecidas (fora do escopo desta REF)

- Enforcement da Onda 1 é só em nível de aplicação (não há trigger/constraint no Postgres) — se
  algum dia outro caminho de escrita em `categories` surgir fora deste botão, o guard não o alcança.
  Aceito conscientemente para não alterar o modelo de dados sem necessidade comprovada (ver §Onda 1).
- A REF não introduziu busca/filtro em Pedidos (gap remanescente da REF-E2E-03, fora do pedido).
- `useAdminSession` não expõe um estado de "verificando sessão" — o 1º paint sempre assume `'store'`
  (ou `'login'` via hash) e só troca para `'admin'` quando `getSession()` resolve; para a maioria dos
  visitantes (sem sessão de Admin) isso é invisível, mas um Admin recarregando a página vê a loja por
  uma fração de segundo antes do painel assumir. Trade-off deliberado: bloquear o 1º paint da loja
  para TODO visitante enquanto se verifica uma sessão que só existe para o Admin contrariaria o
  histórico do projeto (REF-BOOT-01/02) de nunca atrasar o boot da loja por conta de uma verificação
  que quase nunca se aplica.
