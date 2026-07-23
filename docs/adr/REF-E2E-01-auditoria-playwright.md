# REF-E2E-01 — Camada de testes End-to-End (Playwright) — Auditoria

**Status:** 🟢 Auditoria aprovada (2026-07-23) — as 4 decisões abertas foram resolvidas (ver §Decisões tomadas). Bloqueado apenas pelos pré-requisitos manuais listados no fim deste documento (criação do projeto Supabase de E2E + contas de teste).
**Depende de:** REF-APP-01 (arquitetura modular do frontend), AUTH-01 (sessão de cliente `dbCliente`/isolamento do Admin), REF-BUSINESS-HOURS-01/02/03 (override de horário), REF-ORDER-01/ORDER-01b/c (fluxo de pedidos + notificação WhatsApp real).
**Relacionado:** protege, na prática, o resultado de **todas** as fases anteriores (NORM/REF/AUTH) — é a rede de segurança contra regressão do sistema como um todo.
**Não implementado ainda.** Este documento é só a Fase 1 (Auditoria) do processo em 7 etapas descrito no pedido de abertura.

## Contexto

O Encanto hoje tem uma suíte de testes **de domínio/Node** madura (`tests/*.mjs`, ~26 scripts: golden tests, guards de RLS, smoke de render via `react-dom/server`), rodada com `node tests/x.mjs` — sem framework (nem Vitest/Jest). Essa suíte prova que os **módulos puros** (`pricing.js`, `addons.js`, `orderPayload.js`, etc.) e os **contratos de banco** (RLS, invariantes STI) se comportam corretamente, mas **nenhuma delas roda o app de verdade num navegador**. Não existe hoje nenhuma camada que:

- abra a loja num browser real e clique nos fluxos (catálogo → carrinho → checkout);
- valide o **login real** (Google/e-mail OTP) e a sessão persistida;
- valide o **Admin** (login, dashboard, mudança de status de pedido, catálogo) de ponta a ponta;
- pegue regressões **visuais/de integração** que os golden tests (que rodam componentes isolados, sem DOM/browser) estruturalmente não conseguem ver.

REF-E2E-01 fecha essa lacuna com Playwright, **sem tocar** a suíte de domínio existente (ela continua sendo a rede de baixo nível; o E2E é a rede de alto nível, cobrindo o app inteiro como o cliente/admin o usam).

### Fatos da arquitetura atual que condicionam o desenho (levantados nesta auditoria)

1. **SPA sem roteador.** `App.jsx` não usa `react-router`; a troca Loja↔Admin é um `useState('store'|'login'|'admin')`, e o Admin só é alcançado via `location.hash === '#admin-encanto'`. Não há URLs distintas por tela — toda navegação de teste é por **interação de UI**, não por `page.goto(rota)`.
2. **Zero `data-testid` no código hoje.** A única exceção é `data-prod={id}` no `ProductCard` (já usado pelos próprios golden tests de render). Boa parte dos elementos clicáveis do Admin são `<div onClick>` sem `role`/`aria-label` (ex.: abas do `AdminPanel`), e vários inputs (`CheckoutPage`, busca de endereço) não têm `<label htmlFor>` associado — só `placeholder`/`className`.
3. **Duas instâncias Supabase, duas sessões isoladas.** `db` (Admin, `signInWithPassword`, e-mail/senha reais) e `dbCliente` (loja, Google OAuth + e-mail OTP, `storageKey: 'encanto-cliente-auth'`). Nunca se misturam — o que **ajuda** o E2E (dá pra manipular a sessão do cliente sem afetar o Admin e vice-versa).
4. **Login do cliente depende de terceiros não determinísticos:** Google OAuth (tela de consentimento real do Google) e e-mail OTP (código de 6 dígitos enviado por e-mail de verdade). Nenhum dos dois é automatizável de forma determinística sem infraestrutura extra.
5. **Login do Admin é `signInWithPassword` contra um usuário real** (`as992203620@gmail.com` hoje, pré-preenchido no formulário) — não há ambiente de teste do Admin hoje.
6. **Um único backend Supabase conhecido** (produção). Não há projeto/branch de staging documentado nesta base. Qualquer pedido/cliente criado por um teste de checkout é um **registro real** no mesmo banco que serve a loja.
7. **Notificação WhatsApp real no `create_order`** (REF-ORDER-01b, pg_net/pg_cron + Edge Function). Um pedido de teste criado contra o ambiente de produção **dispara uma notificação real** a menos que os secrets/outbox estejam neutralizados nesse ambiente.
8. **Horário de funcionamento controla o checkout** (`useBusinessHours` bloqueia "Finalizar Pedido" fora do expediente), mas existe um **override oficial via Supabase** (`set_store_mode` RPC, HB-03) — dá pra forçar `OPEN` deterministicamente num teste, em vez de depender do relógio real.
9. Dependências de terceiros também na busca de endereço (`address/services/viaCepService.js`, `nominatimService.js`) — chamadas de rede reais a APIs públicas com rate limit.
10. `package.json` é `"type": "module"`, sem TypeScript em lugar nenhum do projeto — a suíte E2E deve ser **JS puro (ESM)**, não introduzir TS.

## Objetivo

Implantar `@playwright/test` cobrindo os fluxos críticos de negócio (lista no pedido de abertura), com testes **independentes, determinísticos e legíveis**, organizados em Page Object Model, preparados para CI (GitHub Actions) sem refatoração futura, e com o **menor número possível de alterações no código de produção** (só `data-testid` cirúrgicos, justificados caso a caso).

## Arquitetura proposta

```
encanto-react/
├─ tests/                     # INALTERADO — suíte de domínio/Node (golden/guard/smoke), continua sendo a rede de baixo nível
├─ e2e/                       # NOVO — camada Playwright (alto nível, browser real)
│  ├─ playwright.config.js    # config única; projetos chromium (+ mobile viewport); webServer=vite preview
│  ├─ .auth/                  # storageState gerados em runtime (gitignored) — sessão de cliente/admin de teste
│  ├─ fixtures/
│  │  └─ index.js             # test.extend(...) — injeta helpers/páginas prontas em todo spec
│  ├─ support/                # infra de teste (Node), nunca importada por src/
│  │  ├─ supabaseAdmin.js     # client service_role — SÓ para setup/teardown (nunca no browser)
│  │  ├─ storeMode.js         # força status da loja (AUTO/OPEN/CLOSED) via set_store_mode antes do teste
│  │  ├─ authSession.js       # cria sessão real (Admin API) p/ storageState — sem passar pela tela de login
│  │  ├─ network-stubs.js     # page.route(...) p/ ViaCEP/Nominatim/Supabase Auth (mecânica de UI)
│  │  └─ cleanup.js           # apaga dados criados por teste (tag/prefixo), usado no teardown
│  ├─ pages/                  # Page Object Model — 1 classe por tela/superfície, isola seletor da asserção
│  │  ├─ StorePage.js
│  │  ├─ CartSidebar.page.js
│  │  ├─ CheckoutPage.page.js
│  │  ├─ LoginModal.page.js
│  │  ├─ AdminLoginPage.js
│  │  └─ AdminPanel.page.js
│  └─ tests/                  # os specs em si, agrupados por domínio de negócio
│     ├─ store/          (boot, catálogo, busca, categorias)
│     ├─ cart/           (carrinho, adicionais)
│     ├─ checkout/       (guest, logado, gate de horário)
│     ├─ auth/           (mecânica de login, sessão restaurada)
│     ├─ cliente/        (Minha Conta, Meus Pedidos, Fidelidade)
│     └─ admin/          (login, dashboard, pedidos, catálogo)
├─ .env.e2e.example           # modelo das variáveis específicas do E2E (sem segredo real)
└─ package.json                # + devDependency @playwright/test + scripts test:e2e*
```

`tests/` e `e2e/` **não se misturam**: o primeiro prova os módulos puros e os contratos de banco; o segundo prova a experiência de ponta a ponta. Isso preserva literalmente a frase da missão — "os testes devem se adaptar ao sistema" — sem reformular a suíte que já existe e já é gate de todo commit (7/7).

## Convenções de nomenclatura

- Diretórios/arquivos: `kebab-case`. Specs: `<fluxo>.spec.js` (ex.: `checkout-guest.spec.js`), padrão nativo do Playwright — paralelo ao `.golden.mjs`/`.guard.mjs`/`.smoke.mjs` já usado em `tests/`, só que no vocabulário Playwright.
- Page Objects: `PascalCase` + sufixo `.page.js` quando o nome puro colidiria com um componente React homônimo (`CheckoutPage.page.js` para não confundir com `src/components/checkout/CheckoutPage.jsx`); sufixo livre (`StorePage.js`) quando não há colisão.
- `data-testid` (quando necessário — ver §Seletores): `kebab-case`, nome do **papel funcional**, nunca do texto visível (`checkout-submit-btn`, não `finalizar-pedido-btn`) — sobrevive a mudança de copy.
- Tags de teste (`@smoke`, `@destructive`, `@admin`) via `test.describe('...', { tag: [...] })` do próprio Playwright — usadas para filtrar o que roda em CI vs. localmente vs. manual (ver §Isolamento).

## Estratégia de organização (Page Object Model)

Cada Page Object expõe **só** localizadores + ações de alto nível (`cartPage.addProduct(nome)`, `checkoutPage.preencherEIdentificar(dados)`), nunca asserções — as asserções ficam no spec. Isso evita duplicação de seletor entre specs (um seletor muda em 1 lugar só) e mantém os specs legíveis como roteiro de negócio, não como script de cliques.

Seletores dentro dos Page Objects seguem esta ordem de preferência (arquitetura de seletor pedida no briefing):
1. `getByRole` com nome acessível (quando o elemento já é semântico: `<button>`, `<input>` com label real).
2. `getByLabel` / `getByPlaceholder` quando existe e é estável (ex.: os inputs de OTP já têm `aria-label="Dígito N"`).
3. `data-testid` — só quando (1) e (2) não são possíveis sem reescrever a semântica do componente (divs clicáveis do Admin, inputs sem label, botões só-emoji). Cada adição é justificada no diff/commit daquela sub-fase, nunca em lote solto.
4. **Nunca**: texto de cópia como seletor principal, posição (`nth`), ou classe CSS (as classes existentes como `.add-btn`/`.checkout-btn` são de estilo, não de contrato de teste, e podem mudar em qualquer refino visual futuro como os já feitos em REF-UI-*).

### Levantamento concreto de onde faltam seletores estáveis (não exaustivo — cresce por onda)

| Componente | Situação hoje | Ação proposta |
|---|---|---|
| `AdminPanel.jsx` (abas do menu) | `<div onClick>` sem `role`/`aria-*`, texto duplica ícone+label (uma até com bug de copy: `label:'products'` minúsculo) | `data-testid="admin-tab-{id}"` por aba |
| `CartSidebar.jsx` (fechar/qty/remover) | Botões só-emoji (`✕`,`−`,`+`,`🗑`), sem `aria-label` | `data-testid` (`cart-close`, `cart-qty-dec`, `cart-qty-inc`, `cart-item-remove`) |
| `CheckoutPage.jsx` (nome/telefone/obs) | `<input>`/`<textarea>` sem `<label htmlFor>` | `data-testid` (`checkout-nome`, `checkout-telefone`, `checkout-obs`) |
| `LoginScreen.jsx` (OTP) | Já tem `aria-label="Dígito {n}"` por dígito | Reusar via `getByLabel` — **sem** mudança de código |
| `LoginScreen.jsx` (CTAs Google/e-mail/enviar/confirmar) | Só texto (`"Continuar com Google"` etc.) | `data-testid` nos 4 CTAs — evita acoplar teste à copy de marketing |
| `ProductCard.jsx` | Já tem `data-prod={id}` | Reusar como está — **sem** mudança |
| Admin: acesso à tela | `location.hash === '#admin-encanto'` | Nenhuma mudança — `page.goto('/#admin-encanto')` já é estável |

Toda edição desta tabela é JSX-only (atributo a mais), não muda markup renderizado em produção (sem `data-testid` no build de produção seria ideal, mas Vite não faz strip automático disso — mudança aditiva e inócua, mesmo padrão que outros frameworks aceitam; se o dono preferir, dá pra condicionar via `import.meta.env.DEV`, mas isso adicionaria complexidade não pedida — **fica como pergunta aberta**, ver §Decisões pendentes).

## Estratégia de autenticação

### Cliente (loja)

- **Mecânica de UI do login por e-mail (OTP):** testada com o **backend de auth stubado** via `page.route()` interceptando `POST **/auth/v1/otp` e `**/auth/v1/verify` com respostas fixas — cobre validação de e-mail, cooldown de reenvio, código incompleto, erro de código inválido e transição de tela. É a mesma UI/código de produção; só a rede de terceiro (Supabase Auth) é controlada, para o teste ser determinístico.
- **Login Google:** **fora do escopo de automação real** (recomendação — ver §Decisões pendentes). Automatizar a tela de consentimento real do Google é frágil, sujeito a CAPTCHA/2FA e violaria os termos de automação do Google — prática padrão de mercado é não fazer isso em E2E. Cobrimos apenas o disparo (clique em "Continuar com Google" chama `signInWithOAuth`, verificável por `page.route` interceptando a chamada) — o que acontece **depois** do OAuth (sessão restaurada) é indistinguível do fluxo de e-mail do ponto de vista do `AuthProvider`, então é coberto pelo item abaixo.
- **Estados "já logado" (Minha Conta, Meus Pedidos, Fidelidade):** em vez de repetir a UI de login em cada teste (lento e frágil), um helper Node (`support/authSession.js`) usa a **Supabase Admin API** (chave `service_role`, só em Node/CI, nunca no navegador) para mintar uma sessão real de um cliente fixo de teste e a injeta como `storageState` (`localStorage['encanto-cliente-auth']`) **antes** da navegação. É sessão real (RLS funciona de verdade), só pula a etapa de UI já coberta pelo teste de mecânica acima — padrão recomendado pelo próprio Playwright ("authenticate once, reuse storageState").

### Admin

- Login real via `signInWithPassword`, mas contra uma **conta de teste dedicada** (recomendação — nunca a conta real `as992203620@gmail.com`), com credenciais em variável de ambiente (`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`), nunca hardcoded no repo.

## Estratégia de isolamento dos testes

- Cada teste roda em um **browser context** isolado (padrão Playwright — cookies/localStorage não vazam entre testes), com seu próprio `storageState` quando precisa de sessão.
- Nenhum teste depende de ordem de execução ou de estado deixado por outro (`test.describe.configure({ mode: 'parallel' })` seguro por construção).
- Testes que **escrevem** no backend (checkout, cadastro, fidelidade) usam dados **gerados por teste** (telefone/e-mail com sufixo único por execução, ex. timestamp), nunca reaproveitam registros fixos entre execuções concorrentes.
- Separação por tag: `@read-only` (catálogo/nav/busca/carrinho local — seguros em qualquer ambiente) vs. `@writes` (checkout/login real/admin — só rodam contra o ambiente que o dono aprovar, ver decisão pendente abaixo).

## Estratégia de limpeza dos dados utilizados

Esta é a peça que **depende de uma decisão do dono** (§Decisões pendentes) — o levantamento abaixo é o motivo:

- O projeto tem **um único Supabase conhecido** (produção). Um teste de checkout real cria uma linha real em `orders`/`customers`/`order_items`, e — pior — pode **disparar uma notificação WhatsApp real** via o pipeline do REF-ORDER-01b.
- Caminho A (recomendado): **projeto Supabase dedicado para E2E**, com o schema aplicado a partir dos próprios `migrations/*.sql` já versionados no repo (fonte única já existente, sem re-trabalho de modelagem) e sem os secrets de WhatsApp configurados (notificação vira no-op nesse ambiente). Limpeza fica simples: `TRUNCATE`/DELETE por tabela no teardown, ou até resetar o projeto entre execuções de CI. Zero risco a dado real.
- Caminho B (fallback, mais arriscado): mesmo projeto de produção, com **tag rígida** nos dados de teste (ex. nome prefixado `E2E_TEST_`, telefone numa faixa reservada) + `support/cleanup.js` (service_role) deletando por esse marcador no teardown de cada run, e **obrigatoriamente** neutralizando o disparo de WhatsApp para pedidos tagueados (ou aceitando que a notificação será real — inaceitável sem confirmação explícita).
- Em ambos os casos, testes **somente-leitura** (catálogo, navegação, busca, carrinho local) não escrevem nada e podem rodar em qualquer ambiente sem limpeza alguma.

## Estratégia para evitar flaky tests

- Só asserções web-first do próprio Playwright (`expect(locator).toBeVisible()` etc., com auto-retry embutido) — **nunca** `waitForTimeout` arbitrário.
- **Horário de funcionamento:** em vez de depender do relógio real (a loja fecha fora do expediente configurado em `services/businessHours`), o setup de testes de checkout chama a RPC oficial `set_store_mode('OPEN')` (o mesmo mecanismo do override do Admin, HB-03) antes do teste — determinístico, não fica esperando o "horário comercial" bater.
- **Catálogo:** testes não devem depender de conteúdo específico que o Admin pode alterar a qualquer momento (nome exato de um produto, por exemplo). Com o Caminho A (ambiente dedicado), seed idempotente de 1-2 categorias/produtos fixos resolve isso de vez; com o Caminho B, os specs usam "o primeiro produto disponível" em vez de nomes hardcoded.
- **APIs de terceiro não relacionadas ao fluxo testado** (ViaCEP/Nominatim na busca de endereço) são interceptadas via `page.route()` com resposta fixa — o teste de checkout não deve flakar por causa de uma API pública de CEP fora do ar ou rate-limited.
- Retries: `0` localmente, `2` só em CI (`process.env.CI`), trace/vídeo/screenshot `on-first-retry`/`retain-on-failure` — dá sinal de causa sem inflar tempo de execução local.

## Riscos

1. **Notificação WhatsApp real disparada por pedido de teste** — crítico se o Caminho B for escolhido sem neutralizar o pipeline. Mitigação: Caminho A, ou desativar o secret/outbox nesse cenário antes de rodar `@writes`.
2. **Poluição de dados reais** (clientes/pedidos/fidelidade de teste aparecendo no Admin de produção) — mesmo risco do item acima, mitigado da mesma forma.
3. **Primeira onda exige editar componentes de produção** (adicionar `data-testid`) — risco baixo (aditivo, não muda markup/CSS/comportamento), mas é código de produção sendo tocado por causa de teste; cada edição entra no commit do spec que a usa, revisável isoladamente.
4. **Terceiros não determinísticos** (Google, e-mail real, ViaCEP/Nominatim) se não forem mockados corretamente — vira fonte de flakiness crônica; mitigado pelas estratégias acima.
5. **CI ainda não existe neste repo** — primeira execução do Playwright baixa browsers (~300 MB) e roda localmente; sem pipeline, o gate "suíte E2E verde" depende de execução manual disciplinada até a Onda de CI.
6. **Credenciais de teste** (admin de teste, service_role key) precisam de um lugar seguro (`.env.e2e` local gitignored; secret de CI mais adiante) — nunca comitados.

## Impactos

- +1 devDependency: `@playwright/test` (primeiro framework de teste "de verdade" do projeto — hoje são scripts Node soltos; convivem sem conflito).
- Nova pasta `e2e/` — zero overlap com `tests/`, `src/`, `scripts/`.
- Pequenas edições cirúrgicas de `data-testid` em ~4-5 componentes existentes (tabela acima) — aditivas, sem mudança visual/comportamental.
- Possível criação de 1-2 usuários de teste no Supabase (cliente fixture + admin fixture) e, se o Caminho A for escolhido, de um projeto Supabase novo — ações que dependem de credenciais que só o dono tem (ou que ele me autoriza a criar via Admin API, a definir).
- Novos scripts em `package.json` (`test:e2e`, `test:e2e:ui`, `test:e2e:report`) — não alteram os scripts existentes.

## Plano de rollback

- Código: tudo isolado em `e2e/` + `.env.e2e.example` + 1 devDependency + edições **aditivas** de `data-testid` → `git revert` do(s) commit(s) da fase/sub-fase remove a camada inteira sem tocar em lógica de negócio, schema ou dados.
- Ambiente (Caminho A): apagar o projeto Supabase de E2E não afeta produção em nada.
- Ambiente (Caminho B): rodar `support/cleanup.js` remove os dados tagueados; se uma notificação WhatsApp real chegou a disparar, **não há rollback possível** — por isso esse caminho exige neutralização do pipeline **antes** de qualquer run com `@writes`, não depois.

## Compatibilidade com CI (GitHub Actions) futura

`playwright.config.js` já nasce com `webServer` (sobe `vite preview` sozinho, tanto local quanto em CI), `retries`/`workers` condicionados a `process.env.CI`, e relatório HTML portátil — quando o workflow `.github/workflows/e2e.yml` for criado (fase própria, fora do escopo desta auditoria), não deve exigir nenhuma refatoração da suíte, só o arquivo de workflow em si.

## Escopo proposto — Onda 1 (ordem sugerida, cada uma sua própria sub-fase/commit)

1. **Infra:** instalar `@playwright/test`, `playwright.config.js`, 1 spec trivial (app inicia, loja renderiza) — prova a esteira antes de qualquer fluxo de negócio.
2. **Catálogo/navegação/busca** (`@read-only`) — boot, categorias (REF-UI-CATEGORY-01), busca (REF-UI-SEARCH-01). Zero risco, roda em qualquer ambiente.
3. **Carrinho + adicionais** (`@read-only`, tudo local/localStorage) — adicionar produto, variar quantidade, resolver adicionais.
4. **Checkout guest** (`@writes`) — **depende do Caminho A/B decidido**.
5. **Login (mecânica) + sessão restaurada** (Minha Conta/Meus Pedidos/Fidelidade via `storageState`).
6. **Admin:** login (conta de teste) + Dashboard + mudança de status de pedido + catálogo.

## Critérios objetivos de aprovação (Onda 1)

- `npm run test:e2e` verde localmente, para todos os specs entregues na onda.
- Suíte de domínio existente (`test:pricing`, `test:addons`, `test:deps`, `test:render`, etc. — o conjunto vigente) permanece 100% verde, sem nenhuma regressão.
- Zero dado de teste remanescente no ambiente usado, verificado após a run.
- Nenhuma notificação WhatsApp real disparada pelos testes.
- `e2e/README.md` (ou seção neste ADR) explicando como rodar localmente; estrutura pronta para o workflow de CI ser só "mais um arquivo", sem refatoração.

## Decisões tomadas (2026-07-23)

1. **Ambiente de dados:** **Caminho A** — projeto Supabase **dedicado** para E2E, schema aplicado a partir dos `migrations/*.sql` já versionados no repo. Nenhum teste de escrita roda contra produção.
2. **Login Google:** **escopo reduzido** — só o disparo (`signInWithOAuth`) é testado; o pós-OAuth (sessão restaurada) é coberto via `storageState` injetado, sem automatizar a tela real do Google.
3. **Admin de teste:** **conta separada**, isolada de `as992203620@gmail.com`.
4. **`data-testid`:** mantidos **sempre** no bundle (produção inclusa) — sem condicional de build.

## Como o app vai apontar para o Supabase de E2E (mecanismo concreto)

O app lê `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` de `.env` em build/dev time (`src/lib/supabase.js`). Em vez de qualquer hack de runtime, uso o suporte **nativo** do Vite a modos: um arquivo `.env.e2e` (gitignored; ao lado do `.env.example` existente, um `.env.e2e.example` versionado com placeholders) guarda a URL/chave do projeto de E2E, e o `playwright.config.js` sobe o app com `vite dev --mode e2e` (ou `vite preview --mode e2e` para validar o bundle de produção quando fizer sentido) — o Vite carrega `.env.e2e` automaticamente por convenção própria dele, sem qualquer código novo no app. Zero mudança em `src/`.

## Convenção de credenciais fora do repo (reaproveitada, não inventada)

Esta auditoria encontrou que os scripts de RLS existentes (`scripts/auth-rls-test.mjs`, `norm06-1-rls-test.mjs`, `harden-orders-rls-test.mjs` etc.) já seguem um padrão: conexão Postgres direta lida de `C:\Users\00thi\.encanto\db.env` (fora do repo, fora de qualquer `.git`). Para o E2E, proponho o mesmo padrão em vez de inventar outro: um arquivo irmão `C:\Users\00thi\.encanto\db.e2e.env` (mesmas chaves `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` ou `SUPABASE_DB_URL`, apontando para o projeto de E2E) — usado só pelo script de setup/seed (`scripts/e2e-seed.mjs`, a criar na sub-fase de infra) para aplicar as migrations e criar as contas de teste. Nunca toca o `db.env` de produção.

## Pré-requisitos manuais (bloqueiam a Onda 1 — ação do dono)

Nenhum destes eu consigo fazer sozinho (não tenho acesso ao dashboard/conta Supabase do dono):

1. **Criar o projeto Supabase de E2E** (novo projeto, plano free serve) e me passar (fora do chat, direto nos arquivos locais abaixo — nunca colados na conversa):
   - `C:\Users\00thi\.encanto\db.e2e.env` com a conexão Postgres direta (mesmo formato do `db.env` atual) — eu uso para aplicar `migrations/*.sql` e rodar o seed/criação das contas de teste.
   - `.env.e2e` na raiz do `encanto-react` (gitignored) com `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` (anon/publishable) **desse** projeto — eu crio o `.env.e2e.example` (placeholders) e adiciono `.env.e2e` ao `.gitignore` na sub-fase de infra; o dono só precisa preencher os valores reais.
2. **Confirmar que não há secrets de notificação WhatsApp configurados** nesse projeto novo (ou que a Edge Function `whatsapp-notify` simplesmente não existe/não está agendada lá) — garante que pedidos de teste nunca disparam mensagem real. Por padrão, um projeto Supabase novo já nasce sem isso; fica aqui só como checagem explícita antes de rodar `@writes`.
3. Depois que 1–2 estiverem prontos, eu assumo a partir daí: aplico as migrations, crio a conta de cliente-fixture e a conta de admin-fixture (+ `INSERT INTO admins`) via script próprio, e sigo para a sub-fase de infra do Playwright (instalação, config, primeiro spec trivial) com revisão antes de cada commit, como de costume.
