# REF-E2E-02 — Cobertura E2E do cliente autenticado — Auditoria

**Status:** 🟢 Auditoria aprovada (2026-07-23; cenário de "conta virgem"/1º acesso ficou fora do escopo, por decisão do dono). Onda 1 (mecânica de login, mock) aplicada — ver §Divisão em ondas.
**Depende de:** REF-E2E-01 (infraestrutura Playwright, projeto Supabase dedicado `encanto-e2e`, Page Object Model, fixtures, `support/*`), AUTH-01/LOGIN-ARCH-02.1/02.2 (autenticação híbrida do cliente), REF-CLIENTE-02/03 (Meus Pedidos/Minha Conta), REF-LOYALTY-01/01a (fidelidade + hardening anti-roubo de identidade), REF-CHECKOUT-ADDRESS-01 (endereço fonte única).
**Relacionado:** preenche as pastas `e2e/tests/auth/` e `e2e/tests/cliente/` já esboçadas (vazias) no diagrama de arquitetura da auditoria da E2E-01, e estende `e2e/tests/checkout/` com o caminho autenticado.

## Contexto — como o login funciona hoje (auditoria de código, não suposição)

### Duas instâncias Supabase, duas sessões isoladas

`src/lib/dbCliente.js` cria um client Supabase **dedicado ao cliente da loja**, com `storageKey: 'encanto-cliente-auth'` — isolado do client do Admin (`db`, `src/lib/supabase.js`). `persistSession:true` + `autoRefreshToken:true` + `detectSessionInUrl:true` + `flowType:'pkce'` (necessário para capturar o `?code=` do retorno do Google).

### Credenciais suportadas

- **Google OAuth:** `AuthService.signInWithGoogle()` → `dbCliente.auth.signInWithOAuth({provider:'google', redirectTo: origin})`. Redireciona para o Google de verdade; o retorno é capturado pelo próprio client (PKCE).
- **E-mail por código (OTP):** `signInWithEmailOtp(email)` → `signInWithOtp({email, shouldCreateUser:true})`, seguido de `verifyEmailOtp(email, token)` → `verifyOtp({email, token, type:'email'})`. UI em `LoginScreen.jsx`: 6 caixas de dígito com `aria-label="Dígito {n}"` (auto-avanço, backspace, colar), cooldown de reenvio de 30s, mensagens de erro amigáveis.

### Identidade = TELEFONE (modelo híbrido)

`customers.phone` é a identidade principal; e-mail/Google são só credencial. RPC `link_customer_to_auth(p_phone, p_email, p_name)` (SECURITY DEFINER, lock por `pg_advisory_xact_lock` no telefone) resolve 3 ramos, **sempre `auth.uid()`-scoped**:

1. Já existe `customers` com esse telefone e sem dono (`auth_user_id IS NULL`) → vincula (ou recusa com `status:'requer_verificacao'` se esse telefone **já tiver histórico** de pedidos/selos — hardening REF-LOYALTY-01a contra roubo de fidelidade de convidado).
2. O `auth.uid()` atual já tem uma linha `customers` (outro telefone) → **UPDATE na mesma linha** (nome/telefone/e-mail) — `customer.id` **nunca muda** neste ramo.
3. Nada existe → `INSERT` novo.

Isso importa para o desenho dos testes: editar o perfil do cliente fixture (Minha Conta) sempre cai no ramo 2 (mesmo `id`), nunca recria a linha — **desde que a linha já exista** (ver §Riscos, achado 2).

### Restauração de sessão e "recuperação automática"

`AuthProvider.jsx`: no mount, `getSession()` restaura a sessão persistida (com checkpoints síncronos do REF-BOOT-02 para diagnosticar travas de WebView). Em paralelo, `onAuthStateChange` escuta **todos os eventos indistintamente** (`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, etc.) e só reage a "tem sessão ou não" — não há tratamento diferenciado por tipo de evento nem mensagem de "sua sessão expirou". Isso significa que uma sessão com refresh token inválido/expirado se comporta **exatamente como logout**: `autoRefreshToken` falha silenciosamente, o SDK dispara `SIGNED_OUT`, o app cai para `anon`. **Fato de arquitetura, não bug** — os testes de "sessão inválida" devem esperar esse comportamento (queda graciosa para anônimo), não uma UX de erro específica.

Achado de concorrência já documentado no código (REF-CLIENTE-03): o callback de `onAuthStateChange` roda **dentro do lock interno do gotrue-js** — por isso `carregarCustomer` é **deferido** (`setTimeout(...,0)`) em vez de aguardado ali, evitando deadlock. Não afeta o desenho dos testes (é implementação interna), mas explica por que o perfil pode levar um instante extra para aparecer após login — os testes devem usar asserções web-first (auto-retry), nunca `waitForTimeout`.

### Logout

`sair()` = `AuthService.signOut()` + limpa `customer`/`precisaTelefone` local. Não há redirecionamento nem tela de confirmação.

### 1º acesso (`CompletarCadastro`) e Minha Conta (edição)

Após login (Google/e-mail), se o `customer` carregado não tiver telefone, `precisaTelefone=true` e o modal "Complete seu cadastro" aparece (dispensável — guest-first, nunca bloqueia compra). `MinhaContaScreen.jsx` (REF-CLIENTE-03) permite, já autenticado: ver nome/e-mail/telefone/"membro desde"; editar nome/telefone (mesma RPC, mesmo `customer.id`); trocar e-mail via fluxo **oficial** do Supabase (`auth.updateUser({email})` → e-mail de confirmação enviado, só efetiva quando o link é clicado — **não é completável em um teste automatizado sem acesso à caixa de entrada**).

### Meus Pedidos e Fidelidade

`useMeusPedidos` só busca quando `isLogged && customer.id`, e filtra **sempre** por `customer_id` (nunca confia só na RLS — o comentário do próprio código explica que `is_admin()` enxerga todos os pedidos, então um `.limit(1)` sem filtro traria linha alheia). `PedidoCard` expande para timeline (`order_events`) + itens + "Pedir novamente" (recompra usa o catálogo **atual**, nunca preço antigo).

Fidelidade tem **duas superfícies distintas**: `FidelidadeScreen.jsx` (menu → "Programa de Fidelidade") é só texto de regulamento, sem estado — nada a testar além do render estático. O modal **interativo** de verdade vive em `StoreApp.jsx` (`showLoyalty`, aberto pelo chip "Programa de Fidelidade" do topo): mostra progresso (`loyaltyCount`/`required`), estado de recompensa disponível, e botão "Usar desconto agora" → `resgatar()` → RPC `redeem_reward()` (server-side, resolve o cliente por `auth.uid()`, **zera o ciclo** — ação destrutiva ao estado do fixture, ver §Riscos achado 8). Fonte de verdade sempre `get_my_loyalty` (RPC); cache local é só pintura rápida.

### Checkout autenticado

`CheckoutPage.jsx`: se `isLogged && customer`, pré-preenche nome/telefone (só quando os campos ainda estão vazios — não sobrescreve o que o usuário já digitou) e **trava o campo telefone** (`identidadeTravada = isLogged && !!customer.phone`, `disabled`, legenda explicativa) — o telefone é a identidade, não deve ser trocado no checkout. Guest continua 100% editável. O vínculo pedido↔conta acontece no backend por **casamento de telefone** dentro de `create_order` (mesmo padrão do checkout guest já testado na E2E-01 Onda 4) — a prova real de vínculo é consultar `orders.customer_id` depois e comparar com o `customer.id` do fixture, não assumir pela UI.

**Endereço não é uma feature de conta.** `AddressProvider` mantém **um único objeto**, persistido em `localStorage`, compartilhado por toda a loja **independente de estar logado ou não** — não existe lista de "endereços salvos" por cliente. Uma tabela `addresses` existe no schema do banco, mas **está dormente**: busca confirmada (`grep` em todo `src/`) de zero referências a `.from('addresses')` em qualquer client Supabase do frontend. Ver ajuste de escopo abaixo.

## Levantamento dos fluxos do usuário autenticado (o que existe para testar)

| Fluxo | Onde | Observação |
|---|---|---|
| Login e-mail OTP (mecânica) | `LoginScreen.jsx` | Já coberto por infraestrutura pronta da E2E-01 (`mockEmailOtpAuth`), nunca exercitado em spec ainda |
| Login Google (disparo) | `LoginScreen.jsx` | Idem (`mockGoogleOAuthTrigger`), nunca exercitado em spec ainda |
| Sessão restaurada (storageState) | app inteiro | `sessaoClienteFixture()` já existe (E2E-01), nunca exercitado em spec ainda |
| Persistência entre reloads | app inteiro | Novo |
| Logout | `LoginScreen.jsx`/`SideDrawer.jsx` | Novo |
| Sessão inválida/expirada | app inteiro | Novo — prova a queda graciosa p/ anônimo |
| Minha Conta — ver dados | `MinhaContaScreen.jsx` | Novo |
| Minha Conta — editar nome/telefone | `MinhaContaScreen.jsx` | Novo — **muta o fixture**, precisa restaurar |
| Minha Conta — trocar e-mail | `MinhaContaScreen.jsx` | Novo — só até "confirmação enviada" |
| Meus Pedidos — vazio | `MeusPedidosScreen.jsx` | Novo |
| Meus Pedidos — lista + timeline + itens | `MeusPedidosScreen.jsx`/`PedidoCard.jsx` | Novo — precisa de 1 pedido real |
| Fidelidade — progresso | modal `StoreApp.jsx` | Novo |
| Fidelidade — resgate | modal `StoreApp.jsx` | Novo — **destrutivo**, zera o ciclo do fixture |
| Checkout autenticado — pré-preenchimento + telefone travado | `CheckoutPage.jsx` | Novo |
| Checkout autenticado — vínculo pedido↔conta | backend (`create_order`) | Novo — verificado por query direta, não só UI |
| Completar cadastro (1º acesso) | `CompletarCadastro.jsx` | Fora do escopo desta REF — só se manifesta para uma conta **sem** telefone; o fixture sempre terá telefone garantido pelo setup (ver §Ajustes de infraestrutura). Se o dono quiser cobri-lo, é um cenário à parte com uma 2ª conta fixture "virgem". |
| "Endereços salvos" por conta | — | **Não existe hoje** (ver Contexto acima) — ajuste de escopo proposto abaixo |
| Admin (login, dashboard, etc.) | — | **Fora do escopo** desta REF (não está na lista do pedido; fica como onda própria futura, já registrado no README da E2E-01) |

## Riscos, dependências e fontes de flakiness (o cerne desta auditoria)

1. **CRÍTICO — `cleanup.js` apagaria a linha `customers` do cliente fixture.** `limparDadosDeTeste()` (criado na Onda 4 da E2E-01) filtra por `phone.in(CLIENTE_FIXTURE.telefone) OR name.ilike('E2E_TEST_%')` e ao final **deleta a linha inteira em `customers`** (não só os pedidos). Isso nunca foi exercitado até agora porque o checkout-guest usa telefone **aleatório** por execução, nunca o do fixture. Assim que a REF-E2E-02 vincular o telefone do fixture (login real + `link_customer_to_auth`), reusar essa função como está apagaria a conta vinculada a cada `afterEach` — quebrando a estabilidade de `customer.id` entre specs e fazendo `precisaTelefone` voltar a `true` inesperadamente. **Proposta:** separar em `limparPedidosDeTeste()` (deleta só `orders`/`order_items`/`order_events`/`loyalty_events`/`loyalty_accounts` pelos `customerIds` — sempre seguro após qualquer teste `@writes`) e reservar a deleção da própria linha `customers` **só** para o padrão convidado (`E2E_TEST_%`, telefone aleatório) — nunca para o telefone fixo do fixture. O cliente fixture passa a se comportar como o admin fixture: criado uma vez, nunca apagado, só resetado.
2. **Linha `customers` do fixture ainda não existe.** `scripts/e2e-fixture-accounts.mjs` garante hoje só o **usuário de Auth** do cliente fixture, não a linha `public.customers` vinculada — nenhum código cria isso ainda. Sem essa linha, `customer` é `null` na primeira carga (`precisaTelefone=true`), e qualquer spec que assuma "cliente já cadastrado" quebraria na primeira execução. **Proposta:** helper idempotente (novo `support/fixture-customer.js`) que faz login como o fixture e chama `link_customer_to_auth(telefone, email, nome)` uma vez no `beforeAll` de qualquer describe que precise do perfil pronto — autocurativo, seguro rodar sempre (mesmo padrão de idempotência já usado no seed de catálogo e nas contas fixture).
3. **Edições de perfil (Minha Conta) precisam restaurar o baseline.** Testes que mudam nome/telefone do fixture devem devolver os valores originais (`CLIENTE_FIXTURE.nome`/`.telefone`) no `afterEach`/`afterAll` via a mesma RPC — senão o telefone diverge do valor que outros specs assumem (ex.: o checkout autenticado depende de `customer.phone === CLIENTE_FIXTURE.telefone` para a trava de telefone).
4. **Troca de e-mail não é completável via automação** (fluxo oficial do Supabase exige clicar um link no e-mail real). Escopo do teste: disparo + mensagem "confirmação enviada" apenas — mesma decisão já tomada para OTP/Google na E2E-01 (não automatizar terceiros não determinísticos).
5. **OTP real dispararia e-mail de verdade** (sem SMTP customizado no projeto de E2E — rate limit baixo no free tier, e não há caixa de entrada para ler o código). Mantém-se a estratégia já aprovada: mecânica de UI **mockada** via `network-stubs.js` (já cobre sucesso/cooldown/código incompleto/inválido/erro de envio); a sessão real pós-login continua via `storageState` (`sessaoClienteFixture`), nunca repetindo a UI de login com backend real.
6. **`store_mode` é GLOBAL** (mesmo achado da E2E-01 Onda 4). Se algum spec de checkout autenticado precisar reabrir o gate de horário, deve reusar a mesma serialização (`test.describe.configure({mode:'serial'})` + `afterAll` restaurando `OPEN`) — mas como o comportamento do gate já está provado no checkout guest, a REF-E2E-02 não deveria precisar tocar `store_mode` de novo (checkout logado assume loja aberta via `forcarStoreMode('OPEN')` no `beforeAll`, sem testar o `CLOSED` de novo).
7. **Sessão inválida/expirada não ocorre naturalmente em run curto.** Estratégia: injetar via `storageState` um objeto de sessão com `access_token`/`refresh_token` deliberadamente forjados (mesmo formato de `sessaoClienteFixture`, valores inválidos) — ao carregar, a tentativa de validar/renovar falha e o app deve cair para `anon` sem travar (proteção que já existe desde REF-BOOT-02: sem loader infinito). É uma prova negativa real, não um mock de UI.
8. **`redeem_reward` é destrutivo ao estado do fixture** (zera o ciclo de selos). Testes de resgate precisam rodar serializados e deixar o estado do fixture limpo ao final (mesma lógica do achado 1) para não vazar estado para outros specs/execuções.
9. **Concorrência entre specs que mutam o mesmo cliente fixture.** Como o `playwright.config.js` já usa `fullyParallel:true`, dois arquivos diferentes que editam o perfil/fidelidade do MESMO fixture ao mesmo tempo podem ler estado inconsistente um do outro. Mitigação: agrupar todo teste que muta o fixture sob uma tag dedicada (proposta: `@writes-fixture-cliente`) servindo de sinal para rodar esse grupo com `--workers=1` localmente, além da serialização interna de cada describe.

## Ajustes de infraestrutura propostos (antes de qualquer spec novo)

- **`e2e/support/cleanup.js`:** dividir em `limparPedidosDeTeste(...)` (nunca apaga `customers`, só dados transacionais) e manter a deleção de `customers` restrita a linhas identificadas pelo prefixo `E2E_TEST_` (convidado). Pequena refatoração no mesmo arquivo, comentário atualizado explicando a distinção fixture-persistente vs. convidado-efêmero.
- **Novo `e2e/support/fixture-customer.js`:** `garantirClienteFixtureVinculado()` — login como o cliente fixture + `link_customer_to_auth` idempotente, garantindo baseline (`nome`/`telefone` = `CLIENTE_FIXTURE`) antes de qualquer describe que dependa de "cliente já cadastrado".
- Nenhuma outra mudança em `support/`, `fixtures/index.js`, `playwright.config.js` — tudo reaproveitado como está.
- **Produção:** único ajuste é os 4 `data-testid` do `LoginScreen.jsx` já planejados (e nunca aplicados) desde a auditoria da E2E-01 (`login-google-btn`, `login-email-btn`, `login-send-code-btn`, `login-confirm-code-btn`) — os únicos elementos do fluxo de auth sem seletor semântico estável hoje. Tudo o mais (Minha Conta, Meus Pedidos, Fidelidade, Checkout) já é 100% acessível por `getByRole`/`getByLabel`/`getByText`, sem precisar tocar produção.

## Ajuste de escopo proposto

- **"Endereços salvos (caso existam)":** não existem como feature de conta hoje — é um único endereço por **dispositivo** (`localStorage`), o mesmo objeto para visitante e logado, sem lista nem persistência por `customer_id` (tabela `addresses` dormente no schema). Proposta: o teste relevante é confirmar que o endereço já escolhido **permanece o mesmo** antes e depois de logar (nenhuma duplicação/perda ao autenticar) — não simular "múltiplos endereços por conta", que não existe. Se o dono quiser essa feature de verdade, é um REF de produto à parte, fora do escopo de testes.
- **Admin** permanece fora do escopo (não está na lista do pedido de abertura desta REF) — fica como onda própria futura, como já registrado no `e2e/README.md`.
- **Completar cadastro (1º acesso, telefone ausente):** não entra nesta REF por padrão — o fixture sempre terá telefone garantido pelo setup idempotente. Cobrir esse cenário exigiria uma 2ª conta fixture "virgem" (sem telefone), uma escolha de escopo que fica aberta ao dono (ver pergunta abaixo).

## Arquitetura proposta (reuso total da infraestrutura da E2E-01)

Reaproveitado sem mudança: `playwright.config.js`, `fixtures/index.js` (`test.extend`), `support/authSession.js` (`sessaoClienteFixture`), `support/network-stubs.js` (`mockEmailOtpAuth`, `mockGoogleOAuthTrigger`), `support/storeMode.js`, `support/fixture-accounts.js`, POM já existentes (`StorePage`, `LoginModal.page.js` — já tem os `TODO` certos, `CheckoutPage.page.js`).

Novo, mínimo, com ganho arquitetural claro:
- `e2e/pages/MinhaContaPage.page.js` — tela com vários inputs/estados, justifica um POM próprio.
- `e2e/pages/MeusPedidosPage.page.js` — lista + expandir + timeline, idem.
- Fidelidade: **sem** POM novo — poucos elementos, acessados direto por `getByText`/`getByRole` no spec (POM dedicado para 2-3 asserções seria over-engineering).
- `e2e/support/fixture-customer.js` (novo, conforme acima).
- `e2e/support/cleanup.js` (editado, não recriado).

Specs novos:
```
e2e/tests/auth/
├─ login-email-otp.spec.js       (Onda 1)
├─ login-google-trigger.spec.js  (Onda 1)
├─ session-restore.spec.js       (Onda 2)
├─ session-persist-reload.spec.js(Onda 2)
├─ logout.spec.js                (Onda 2)
└─ session-invalida.spec.js      (Onda 2)
e2e/tests/cliente/
├─ minha-conta.spec.js           (Onda 3)
├─ fidelidade.spec.js            (Onda 3 leitura + Onda 4 resgate)
└─ meus-pedidos.spec.js          (Onda 3 vazio + Onda 4 com pedido real)
e2e/tests/checkout/
└─ checkout-logado.spec.js       (Onda 4)
```

## Divisão em ondas

**Onda 1 — Mecânica de login (mock, zero escrita real)**
- `data-testid` nos 4 CTAs do `LoginScreen.jsx` (único ajuste de produção desta REF).
- `login-email-otp.spec.js`: opções → e-mail → enviar código → cooldown → código incompleto → código inválido → sucesso.
- `login-google-trigger.spec.js`: clique dispara `signInWithOAuth(provider=google)`.
- Roda em qualquer ambiente, inclusive sem `.env.e2e` preenchido.

**Onda 2 — Sessão real: persistência, restauração, logout, sessão inválida**
- `fixture-customer.js` criado.
- `session-restore.spec.js`, `session-persist-reload.spec.js`, `logout.spec.js`, `session-invalida.spec.js`.
- Só toca o usuário de Auth do fixture — nenhuma tabela de negócio (`customers`/`orders`) ainda.

**Onda 3 — Cliente autenticado: Minha Conta + Fidelidade (leitura) + Meus Pedidos (vazio)**
- `cleanup.js` dividido (proposta acima) — pré-requisito desta onda.
- `MinhaContaPage.page.js` novo.
- `minha-conta.spec.js` (ver dados, editar e restaurar, trocar e-mail até "enviado").
- `fidelidade.spec.js` parte 1 (estado zerado exibido corretamente).
- `meus-pedidos.spec.js` parte 1 (estado vazio).
- Describes que mutam o fixture rodam serializados; estado do fixture idêntico ao início ao final da run.

**Onda 4 — Checkout autenticado + vínculo pedido↔conta + Meus Pedidos com pedido real + resgate de fidelidade**
- `MeusPedidosPage.page.js` novo.
- `checkout-logado.spec.js`: sessão real, telefone travado, nome pré-preenchido, pedido concluído; verificação de vínculo por query direta (`orders.customer_id === customer.id` do fixture).
- `meus-pedidos.spec.js` parte 2 (pedido aparece, timeline/itens expandem).
- `fidelidade.spec.js` parte 2 (contador incrementa após o pedido; resgate testado e revertido).
- Reusa `forcarStoreMode('OPEN')` e o novo `limparPedidosDeTeste()` no `afterEach`.

## Critérios objetivos de aprovação (por onda)

- `npm run test:e2e` verde para os specs entregues na onda.
- Suíte de domínio (`tests/*.mjs`) 100% verde, sem regressão.
- Zero dado remanescente do cliente fixture ao final da run (pedidos/loyalty zerados; nome/telefone nos valores originais).
- Nenhuma notificação WhatsApp real disparada (ambiente `encanto-e2e` já não tem os secrets, herda a garantia da E2E-01).
- `e2e/README.md` e este ADR atualizados a cada onda.

## Pergunta aberta ao dono

Cobrir o cenário de **1º acesso (Completar Cadastro, telefone ausente)** exigiria uma **2ª conta fixture "virgem"** (login funciona, mas sem linha `customers` vinculada ainda) — hoje fora do escopo proposto (o fixture único sempre terá telefone garantido pelo setup). Quer que eu inclua isso como uma sub-fase extra (Onda 2 ou 3), ou fica de fora desta REF?
