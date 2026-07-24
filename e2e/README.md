# e2e/ — Testes End-to-End (Playwright) — REF-E2E-01

Camada de testes que roda o app **inteiro, num browser real**, cobrindo os fluxos críticos de
negócio (catálogo, carrinho, checkout, login, Admin). Complementa — **não substitui** — a suíte de
domínio existente em `../tests/*.mjs` (golden tests, guards de RLS, smoke de render sem browser).

A auditoria completa (arquitetura, decisões, riscos, plano por ondas) está em
[`../docs/adr/REF-E2E-01-auditoria-playwright.md`](../docs/adr/REF-E2E-01-auditoria-playwright.md).
Leia lá antes de adicionar um novo spec — este README é só o "como rodar/onde fica o quê" do dia a dia.

## Como rodar

```powershell
npm run test:e2e            # só Chromium (padrão) — não precisa de nada além disto instalado
npm run test:e2e:ui         # modo interativo (UI mode do Playwright)
npm run test:e2e:headed     # com o browser visível
npm run test:e2e:report     # abre o último relatório HTML
npm run test:e2e:all-browsers  # Chromium + Firefox + WebKit — rode antes `npx playwright install firefox webkit`
```

Nenhum destes comandos precisa do `npm run dev` rodando: o `playwright.config.js` sobe o app sozinho
(`vite --mode e2e`, porta `5183` — nunca colide com o `:5173` do dev normal) e derruba ao final.

### Projeto Supabase de E2E

Existe um projeto Supabase **dedicado** a E2E (`encanto-e2e`, plano free, nunca produção). `.env.e2e`
(raiz do projeto, gitignored) já aponta pra ele — os specs `@writes` (checkout, sessão logada, Admin)
rodam de verdade desde a Onda 4. Setup (idempotente, rodar de novo é seguro):

```powershell
node scripts/e2e-seed.mjs              # aplica e2e/support/seed-catalog.sql (catálogo fixture)
node scripts/e2e-fixture-accounts.mjs  # garante as contas fixture (cliente + admin)
```

Sem `.env.e2e` preenchido (`VITE_SUPABASE_URL`/`KEY` em branco), o app cai no modo degradado
(`db=null`) e usa o catálogo **MOCK** local (`src/data/mockCatalog.js`) — os specs `@read-only`
continuam passando nesse modo também (é assim que a Onda 1-3 rodaram antes do projeto existir).

## Configuração de ambiente (`.env.e2e`)

Copie `.env.e2e.example` (raiz do projeto) para `.env.e2e` (gitignored) quando o projeto Supabase
dedicado a E2E existir. **Nunca aponte para o Supabase de produção.** O Vite carrega esse arquivo
automaticamente por causa do `--mode e2e` — nenhum código em `src/` sabe que está sob teste.

Para os scripts Node de setup/teardown (`support/supabaseAdmin.js` e quem o usa), o mesmo
`.env.e2e` guarda `E2E_SUPABASE_SERVICE_ROLE_KEY` (nunca prefixado `VITE_`, então nunca vaza pro
bundle do browser).

## Estrutura

```
e2e/
├─ playwright.config.js   # config única (multi-browser, webServer, CI-ready)
├─ fixtures/index.js      # test.extend — importar daqui, não de '@playwright/test' direto
├─ support/               # infra Node (nunca importada por src/ nem pelos specs no browser)
│  ├─ supabaseAdmin.js    # clientes service_role/anon do projeto de E2E (env-gated)
│  ├─ storeMode.js        # força a loja OPEN/CLOSED (escreve direto em settings — ver Onda 4 abaixo)
│  ├─ authSession.js      # sessão real de cliente fixture, para storageState (pula a UI de login)
│  ├─ fixture-accounts.js # credenciais das contas fixture (cliente/admin) — fonte única
│  ├─ fixture-catalog.js  # ids do catálogo semeado (seed-catalog.sql) — fonte única p/ os specs
│  ├─ seed-catalog.sql    # catálogo fixo (8 categorias/produtos, espelha mockCatalog.js)
│  ├─ network-stubs.js    # mocks de ViaCEP/Nominatim/Supabase-auth via page.route — usáveis hoje
│  └─ cleanup.js          # apaga, no projeto de E2E, os dados que os specs @writes criaram
├─ pages/                 # Page Object Model — 1 classe por tela/superfície
└─ tests/                 # specs, agrupados por domínio (store/cart/checkout/auth/cliente/admin)

scripts/e2e-seed.mjs              # aplica seed-catalog.sql no projeto de E2E (ver acima)
scripts/e2e-fixture-accounts.mjs  # cria/garante as contas fixture (cliente + admin) via Admin API
```

## Convenções

- **Specs:** `<fluxo>.spec.js`, agrupados por pasta de domínio.
- **Page Objects:** expõem só localizadores + ações; **nenhuma asserção** vive lá — isso fica no spec.
- **Seletores, em ordem de preferência:** `getByRole`/`getByLabel` (semântica real) → `data-testid`
  (quando o elemento não é semântico o bastante) → nunca texto de cópia, posição ou classe CSS como
  estratégia permanente. Onde o componente ainda não tem seletor estável, o Page Object correspondente
  tem um comentário `TODO(REF-E2E-01 · Onda X)` apontando o que falta e em qual onda entra — não
  adicionamos `data-testid` soltos sem um spec que os use na mesma sub-fase/commit.
- **Tags:** `@read-only` (catálogo/busca/categorias/carrinho local — seguro em qualquer ambiente,
  inclusive sem `.env.e2e`) vs. `@writes` (checkout real, sessão logada, Admin — só contra o projeto
  de E2E dedicado). Ver `test.describe('...', { tag: [...] })`.
- **Sem TypeScript** — o projeto inteiro é JS puro (ESM); a suíte E2E segue o mesmo padrão.

## Multi-browser

Os 3 engines (Chromium/Firefox/WebKit) já estão configurados em `playwright.config.js`. Hoje só o
binário do Chromium está instalado (`npx playwright install chromium`) — é ele que roda por padrão em
`npm run test:e2e`. Para rodar a matriz completa: `npx playwright install firefox webkit` uma vez, e
depois `npm run test:e2e:all-browsers` (ou `--project=firefox` / `--project=webkit` isoladamente).

## Preparado para CI (GitHub Actions) — ainda não criado

`playwright.config.js` já reage a `process.env.CI` (retries, `reuseExistingServer`) e o `webServer`
sobe o app sozinho — quando o workflow `.github/workflows/e2e.yml` for criado (fase própria, fora do
escopo desta Onda), não deve exigir nenhuma refatoração daqui, só o arquivo de workflow chamando
`npm ci && npx playwright install --with-deps && npm run test:e2e`. `workers` é `1` sempre (local e
CI, ver §Onda 4 da REF-E2E-02 abaixo) — não varia mais com `CI`.

## Onde isto para hoje

- **Onda 1 (infra):** config, estrutura, Page Object Model, fixtures, helpers de `support/` (env-gated),
  spec de boot. FEITO.
- **Onda 2 (catálogo/busca/categorias, `@read-only`):** FEITO.
- **Onda 3 (carrinho, `@read-only`):** FEITO.
- **Onda 4 (checkout guest + gate de horário, `@writes`):** projeto de E2E provisionado, schema
  clonado de produção (`pg_dump --schema-only`), catálogo fixture semeado, contas fixture criadas.
  FEITO.
- **Próximas ondas** (cada uma seu commit, revisão antes de cada um — ver auditoria): mecânica de
  login + sessão de cliente logado (Minha Conta/Meus Pedidos/Fidelidade), e Admin.

### REF-E2E-02 — cliente autenticado (auditoria em
[`../docs/adr/REF-E2E-02-auditoria-cliente-autenticado.md`](../docs/adr/REF-E2E-02-auditoria-cliente-autenticado.md))

- **Onda 1 (mecânica de login, mock, `e2e/tests/auth/`):** FEITO. `data-testid` nos 4 CTAs de
  `LoginScreen.jsx` (`login-google-btn`/`login-email-btn`/`login-send-code-btn`/`login-confirm-code-btn`
  — único ajuste de produção desta REF); `login-email-otp.spec.js` (validação, cooldown, código
  incompleto/inválido, sucesso — backend stubado via `network-stubs.js`); `login-google-trigger.spec.js`
  (disparo do `signInWithOAuth`, sem automatizar a tela real do Google). `StorePage.abrirLogin()` novo
  (abre menu → "Entre ou cadastre-se").
- **Onda 2 (sessão real, `e2e/tests/auth/`):** FEITO. `session-restore.spec.js`, `session-persist-reload.spec.js`,
  `logout.spec.js` (sessão real do cliente fixture via `storageState`/`authSession.js`) e
  `session-invalida.spec.js` (sessão forjada/expirada — prova a queda graciosa para anônimo, sem
  travar o boot). Achados durante a execução (ver ADR §Ajustes encontrados na execução): corrigido um
  bug pré-existente no formato do `storageState` em `authSession.js` (nunca antes exercitado); criado
  `e2e/support/fixture-customer.js` (garante o cliente fixture vinculado com telefone, senão o modal
  "Complete seu cadastro" aparece por cima de qualquer tela); `aria-label="Login"` adicionado ao botão
  do topo do drawer (`SideDrawer.jsx` — nome acessível antes mudava com o estado de login).
- **Onda 3 (cliente autenticado, `e2e/tests/cliente/`):** FEITO. `minha-conta.spec.js` (ver dados,
  editar nome/telefone com restauração do baseline, solicitar troca de e-mail) e `meus-pedidos.spec.js`
  (estado vazio). `e2e/support/cleanup.js` dividido: `limparPedidosDoFixture()` (nunca apaga a linha
  `customers` do fixture, só dados transacionais) vs. `limparDadosDeTeste()` (guest efêmero, apaga
  tudo). Novo `MinhaContaPage.page.js`. Achados: e-mail `.local` é rejeitado pela validação de domínio
  do Supabase e o envio real esbarra no rate limit do plano free — troca de e-mail passou a usar
  `mockEmailChangeAuth` (novo em `network-stubs.js`), mesmo racional do OTP mockado. **Ajuste de
  escopo:** Fidelidade saiu desta onda — o chip "Programa Fidelidade" da home está ligado a um `alert()`
  de placeholder, não ao modal real (que só abre com `loyaltyCount>0`); sem pedido nenhum, não há
  caminho de UI até lá. Fidelidade de verdade entra inteira na Onda 4 (ver ADR).
- **Onda 4 (checkout autenticado + vínculo + Meus Pedidos com pedido real + Fidelidade):** FEITO.
  `checkout-logado.spec.js` (telefone travado, nome pré-preenchido, vínculo pedido↔conta verificado por
  query direta — não só pela UI). `meus-pedidos.spec.js` ganhou a parte 2 (pedido aparece, timeline/itens
  expandem). Novo `fidelidade.spec.js` (0→1 selo depois de 1 pedido real; resgate testado e revertido).
  Novos `support/fixture-order.js` (cria 1 pedido real do fixture via `create_order` direto, sem UI —
  setup rápido para specs que só leem o resultado) e `MeusPedidosPage.page.js`.
  **Achado crítico da execução:** com 3 arquivos `@writes` diferentes mutando o MESMO cliente fixture
  (orders/loyalty), rodar com múltiplos workers (padrão local) causava corrida real entre arquivos —
  o `afterEach` de um apagava o estado que outro tinha acabado de armar. Cada describe já se serializa
  consigo mesmo, mas isso nunca protegeu contra outro ARQUIVO rodando em paralelo. Corrigido na raiz:
  `playwright.config.js` agora fixa `workers: 1` sempre (antes só CI era seguro).
- **Próximas ondas:** nenhuma pendente na lista original desta REF — ver ADR para o escopo fechado.

### REF-E2E-03 — Admin (auditoria em
[`../docs/adr/REF-E2E-03-auditoria-admin.md`](../docs/adr/REF-E2E-03-auditoria-admin.md))

Cobertura E2E do Painel Administrativo, tratado como aplicação distinta da loja (nunca mistura
fluxos) — reaproveita 100% da infra de E2E-01/02 (Playwright, projeto `encanto-e2e`, `workers:1`,
`ADMIN_FIXTURE`/`CLIENTE_FIXTURE`, `support/*`).

- **Onda 1 (infraestrutura: login, permissão, sessão, logout, `e2e/tests/admin/`):** FEITO.
  `data-testid="admin-tab-{id}"` nas 8 abas de `AdminPanel.jsx` + `data-testid` em e-mail/senha/erro
  de `AdminLogin.jsx` (únicos ajustes de produção). `AdminLoginPage.js`/`AdminPanel.page.js`
  (esboçados na Onda 1 da E2E-01) completados. **Decisão de arquitetura:** ao contrário do cliente
  (Google/OTP, mecanicamente impossível de automatizar de ponta a ponta), o login do Admin é
  e-mail/senha real — todo teste faz login de verdade pela UI (`ADMIN_FIXTURE`), sem `storageState`
  (a própria auditoria achou que a sessão do Admin **não é restaurada automaticamente** de nenhuma
  forma — ver achado abaixo). `admin-login.spec.js` (sucesso/senha errada/e-mail inexistente,
  mesma mensagem genérica do Supabase nos 2 últimos). `admin-permissao.spec.js` parte 1 (reaproveita
  `CLIENTE_FIXTURE` da E2E-02 como conta "autenticada, sem admin" — zero conta nova; prova que a UI
  inteira renderiza, sem gate de `is_admin()` no cliente, mas um pedido "avulso" de outro cliente —
  novo `criarPedidoAvulso()` em `support/fixture-order.js` — fica invisível no Dashboard, a RLS
  bloqueia de verdade). `admin-sessao.spec.js` (reload no meio do painel cai na **loja**, não no
  login — o hash `#admin-encanto` já foi limpo no 1º mount; sessão forjada sob a chave padrão do
  client `db`, `sb-<ref>-auth-token`, não trava o boot). `admin-logout.spec.js` ("Sair" só troca o
  `mode` de volta para `store`, sem chamar `signOut()` — provado interceptando a chamada de rede via
  `page.route`, não só lendo o código). **Achado confirmado ao rodar (não hipótese):** as 3
  previsões da auditoria se confirmaram sem ajuste nenhum na 1ª execução — ver ADR "Onda 1 —
  executada" para o detalhe, incluindo uma correção de precisão no texto original da auditoria (o
  fallback do reload é a loja, não uma tela de login).
- **Onda 2 (Dashboard + Pedidos):** FEITO. `data-testid={`pedido-card-${order.id}`}` em cada card de
  `AdminPedidos.jsx` (o número exibido #N é posição na lista, não estável — todo locator escopa por
  `orderId`) + `data-testid` nos painéis de `PedidoHistorico.jsx`/`PedidoNotificacoes.jsx`. Novo
  `AdminPedidosPage.page.js` (cards, ações, comanda). `criarPedidoAvulso()` ganhou o parâmetro
  `endereco` (permite gerar pedidos tipo 'entrega', além do default 'retirada'). `admin-dashboard.spec.js`
  (5 cards + breakdown, estado vazio, atualizar manual). `admin-pedidos-lista.spec.js` (card reflete
  cliente/total/tipo reais). `admin-pedidos-status.spec.js` (trilha de retirada pula "Saiu para
  entrega", trilha de entrega passa por ela, cancelar/reabrir). `admin-pedidos-historico.spec.js` /
  `admin-pedidos-mensagens.spec.js` (só leitura; mensagens prova a prévia + o estado real "na fila",
  nunca envio). `admin-pedidos-comanda.spec.js` (abre para o pedido certo, troca de largura, "Imprimir"
  dispara `window.print` via init script — sem depender de diálogo real de SO). **2 achados
  confirmados ao rodar:** (a) bug real e pré-existente no Dashboard — `o.cliente_nome`/
  `o.cliente_telefone` nunca existem no retorno de `DS.getPedidos()`, a coluna "Cliente" da tabela
  sempre renderiza em branco (fora de escopo corrigir, é achado de produto); (b) race real entre
  avançar status e abrir um painel expansível no mesmo card — `AdminPedidos` desmonta/remonta todo
  `OrderCard` enquanto `loading` é `true` (troca por `<Spinner/>`), resetando o painel aberto —
  corrigido no spec aguardando o novo status assentar antes de interagir. Ver ADR "Onda 2 — executada".
- **Onda 3 (Categorias + Adicionais):** FEITO — **com 2 correções reais de produção** (fora do
  princípio geral "só testar" desta REF, pedidas explicitamente pelo dono ao ser confrontado com os
  bugs). `data-testid` nas linhas da tabela (`cat-row-{id}`/`ad-row-{id}`) e nos campos do formulário
  (nenhum tem `<label htmlFor>`) de `AdminCategorias.jsx`/`AdminAdicionais.jsx`. Novos
  `AdminCategoriasPage.page.js`/`AdminAdicionaisPage.page.js` e `support/fixture-catalog-admin.js`
  (`limparCatalogoDeTeste()`, simétrico a `cleanup.js`). `admin-categorias.spec.js` (CRUD, validação
  de nome vazio, exclusão "em uso"). `admin-adicionais.spec.js` (CRUD, validação). **2 bugs reais
  corrigidos** (confirmados por teste direto contra o backend, não hipótese): (1) "+ Nova Categoria"
  sempre falhava silenciosamente em qualquer ambiente — `categories.slug` é `NOT NULL` sem default e
  o insert nunca o enviava; corrigido com um `slugifyCategoria()` novo em `DataService.js`, só no
  create. (2) "+ Novo/Editar Adicional" tinha 2 problemas: criar sempre falhava (`adicionais.grupo`
  também `NOT NULL` sem default, nunca enviado) e editar Tipo/Grupo de um adicional existente era
  silenciosamente ignorado (o payload de update nunca incluía essas colunas); corrigido em
  `AdminAdicionais.jsx` (`save()` passa a enviar `tipo`/`grupo`; reset do "+ Novo" inicializa os 2).
  **Achado preservado, não corrigido** (fora do pedido do dono): excluir uma categoria "em uso" (com
  produtos em `categoria_ids`) sucede sem erro — não há FK protegendo esse array; a coluna legada
  `categoria_id` zera sozinha (FK com `ON DELETE SET NULL`), mas `categoria_ids` fica órfão. Ver ADR
  "Onda 3 — executada" para o racional completo e as 2 perguntas feitas ao dono.
- **Onda 4 (Produtos, o formulário mais complexo do projeto):** FEITO. `data-testid` em TODOS os
  campos de `AdminProducts.jsx` (nenhum `<label htmlFor>`) + `prod-row-{id}` na tabela + containers
  dos toggle-buttons dinâmicos + wrapper do `ImageUploader` (também instrumentado). Novo
  `AdminProductsPage.page.js`. `fixture-catalog.js` ganhou 8 constantes `CAT_*` (ids das categorias
  do seed). `limparCatalogoDeTeste()` agora também apaga `products` de teste. Novo
  `mockImageUpload()` em `network-stubs.js` (só o POST de upload; `getPublicUrl` é local, sem rede).
  5 specs novos (10 casos): `admin-produtos-crud.spec.js` (simples: criar/editar/disponibilidade/
  excluir/validação), `admin-produtos-tamanhos.spec.js` (criar/validação/sincronização de preço com
  o menor tamanho/volta ao modo simples), `admin-produtos-categorias-destaque.spec.js` (multi-
  categoria + destaque + ordem), `admin-produtos-adicionais.spec.js` (grupos de adicionais dinâmicos
  por categoria), `admin-produtos-imagem.spec.js` (validação client-side + upload mockado + URL
  manual). **2 achados de teste confirmados ao rodar** (nenhum bug de produto): (1) os toggles
  "Disponível"/"Destaque" usam `.toggle-switch input{opacity:0;width:0;height:0}` — o `<input>` real
  nunca é "visível" para o Playwright, `.click()`/`.check()` diretos travam; o Page Object clica no
  `.toggle-slider` visível (mesmo alvo de um usuário real), usando o `<input>` só para `toBeChecked`.
  (2) corrida real entre `salvar()` (assíncrono) e uma consulta direta ao backend logo em seguida,
  sem esperar confirmação visível na UI — passava isolado, falhava dentro da suíte inteira; mesma
  lição já vista na Onda 2 (race avançar-status × abrir painel). Ver ADR "Onda 4 — executada".
- **Próxima onda:** Configurações+Fidelidade admin (5), Permissões (matriz completa)+Saúde (6) — ver
  ADR §6.

### Nota sobre `set_store_mode` (Onda 4)

A RPC oficial `set_store_mode` exige `is_admin()=true` (checagem explícita no corpo da função, não é
RLS) — um client `service_role` via PostgREST não satisfaz isso sozinho (`auth.uid()` fica nulo sem
uma sessão real de admin). `support/storeMode.js` escreve direto na tabela `settings` via conexão
Postgres (mesma infra de `scripts/e2e-seed.mjs`) para o SETUP de teste — efeito idêntico ao da RPC,
sem forjar uma sessão de admin só pra isso.
