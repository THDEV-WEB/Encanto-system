# REF-AUTH-PLATFORM-ISOLATION-01 — Super Admin × Admin de tenant (progresso)

## Problema original

Um incidente real mostrou que a identidade de **Super Admin** (papel global de plataforma,
`public.super_admins`) e a identidade de **admin operacional de tenant** (`public.admins`) podiam se
sobrepor sem qualquer proteção: o Super Admin de produção (`as992203620@gmail.com`) está, desde antes
desta REF, também vinculado como admin da Encanto em `public.admins` — porque é a única forma que a
Encanto tem hoje de ter *algum* admin. Essa sobreposição permitiu que a operação
`platform-set-store-admin-password` (criada pela REF-PROD-READINESS-01/A6 para definir a senha de um
admin de loja pelo Platform Console) pudesse, sem nenhuma guarda, ser apontada contra o próprio Super
Admin — mecanismo mais provável do incidente de bloqueio de acesso ao Super Admin já registrado.

## Onda 0 — Inventário e baseline (somente leitura)

Confirmado por consulta direta e somente-leitura ao banco de produção:

```
super_admins: b9dc7626-... (as992203620@gmail.com)         -- unico super admin

admins:
  encanto      -> b9dc7626-... (as992203620@gmail.com)      -- MESMO user_id do Super Admin
  aquariosbar  -> c3d3dbe9-... (aquariosbar806@gmail.com)   -- admin operacional real, ja separado

stores: encanto (ativo, admin_count=1) · aquariosbar (suspenso, admin_count=1)
```

Achado central: a Encanto **não tem hoje nenhum admin operacional que não seja o próprio Super Admin**
— por isso a separação definitiva (Ondas 5-7) precisa primeiro criar/validar um admin operacional
próprio da Encanto, antes de remover o vínculo do Super Admin.

Mapa de autorização (`is_super_admin()` → `is_admin_of()` → `is_admin()`/`is_admin_anywhere()`) e o
mapa completo de pontos que mutam identidade/senha/vínculo (`platform-set-store-admin-password`,
`invite-store-admin`, `link_store_admin`, `platform_unlink_store_admin`, `provision_store`,
`ConviteApp.jsx`) foram auditados e nenhum outro ponto de mutação foi encontrado além destes.

## Onda 1 — Hardening de credenciais (CONCLUÍDA)

**Objetivo:** um Super Admin nunca pode ser alvo de alteração de senha por um fluxo destinado a admin
de tenant.

**`supabase/functions/platform-set-store-admin-password/index.ts`** — nova guarda, entre a checagem de
vínculo (`public.admins`) e a chamada real a `auth.admin.updateUserById`: se o `userId` alvo estiver em
`public.super_admins`, a função recusa com `reason: "nao_e_possivel_alterar_senha_de_super_admin_por_este_fluxo"`,
mesmo que esse mesmo `userId` também esteja em `public.admins` de alguma loja (o caso real do Super
Admin da Encanto). Nenhuma outra linha de comportamento foi alterada.

**`supabase/functions/invite-store-admin/index.ts`** — auditado, **sem alteração**: esse fluxo só
alcança `service_role`/`inviteUserByEmail` quando o e-mail **não existe ainda** em `auth.users`
(`link_store_admin` retorna explicitamente "nao existe nenhuma conta" antes disso). Como a conta do
Super Admin já existe, esse caminho nunca é alcançável para ele — não há risco equivalente a corrigir.

### Testes (`scripts/auth-platform-isolation-01-onda1-test.mjs`, novo)

100% dados descartáveis, 100% projeto E2E (`bgzcrovskjbktdxkhemd`/`encanto-e2e`) — nunca o Super Admin
real, nunca o admin real da Aquarios Bar. 3 lojas descartáveis + 3 admins normais descartáveis (papéis
"tipo Encanto"/"tipo Aquarios"/"novo tenant" — o código não ramifica por loja, então qualquer admin
comum prova o mesmo comportamento) + 1 "Super Admin" descartável (vinculado a `super_admins` **e**
`admins`, replicando exatamente a sobreposição real).

| Cenário | Resultado esperado | Resultado obtido |
|---|---|---|
| A) Super Admin (descartável) como alvo | BLOQUEADO, senha original preservada | ✅ PASS (2/2 asserções) |
| B) Admin normal "tipo Encanto" (descartável) | PERMITIDO, login com senha nova funciona | ✅ PASS (3/3) |
| C) Admin normal "tipo Aquarios" (descartável — nunca a conta real) | PERMITIDO | ✅ PASS (3/3) |
| D) Admin de tenant novo descartável | PERMITIDO | ✅ PASS (3/3) |
| E) Usuário que não é admin de nenhuma loja | BLOQUEADO | ✅ PASS (1/1) |
| Regressão (sem auth / caller não-super-admin / senha curta) | BLOQUEADO (comportamento pré-existente) | ✅ PASS (3/3) |

**16/16 PASS.** Limpeza confirmada por consulta somente-leitura ao projeto E2E: 0 stores/admins/
super_admins/auth.users órfãos com o prefixo de teste; `public.super_admins` do E2E voltou ao estado
vazio de antes do teste.

Deploy da Edge Function atualizada feito **exclusivamente** no projeto E2E (`bgzcrovskjbktdxkhemd`),
confirmado `status: ACTIVE`, `version: 2`. **Nenhum deploy em produção nesta onda** — a produção
continua rodando a versão 1 (sem a guarda) até a autorização explícita de uma onda futura para levar
esta correção também a produção.

Verificações estáticas: lint (0 erros, warnings pré-existentes não relacionados), typecheck (limpo),
build (sucesso), `test:domain` (0 falhas — esta onda não toca módulos de domínio).

## Onda 2 — Hardening do desvincular (CONCLUÍDA)

**Objetivo:** um Super Admin nunca pode ser desvinculado (`DELETE` de `public.admins`) por um fluxo
destinado a admin de tenant — mesma sobreposição da Onda 1, agora fechada também no desvincular.

**Migration nova** (`migrations/REF-AUTH-PLATFORM-ISOLATION-01-onda2-bloqueia-desvincular-super-admin.sql`
+ rollback) — `platform_unlink_store_admin(p_store_id, p_user_id)` ganha uma guarda entre a checagem de
autorização do caller (`is_super_admin()`, pré-existente, inalterada) e o `DELETE`: se `p_user_id`
estiver em `public.super_admins`, `RAISE EXCEPTION` (`ERRCODE 42501`) antes de tocar `public.admins`.
Admins normais continuam desvinculados exatamente como antes (idempotente — `DELETE` de 0 linhas
continua sendo `desvinculado:false`, nunca erro).

**Auditoria do teste pré-existente** (`scripts/saas02-onda1-platform-console-test.mjs`, ITEM 4, roda
contra produção dentro de `BEGIN...ROLLBACK`): confirmado que os 3 casos (`ITEM4-desvincula`,
`ITEM4-idempotente`, `ITEM4-admin-comum-N`) usam como alvo `ADMIN_B` (admin real de outra loja, não
super admin) ou testam a recusa pelo lado do *caller* — nenhum deles aponta a um super admin como
*alvo* da desvinculação, então a guarda nova não quebra nenhuma asserção existente. Não foi executado
nesta onda (tocaria produção, fora do escopo autorizado) — permanece válido para quando a migration for
aplicada em produção.

**`src/components/admin/PlatformTenants.jsx`** — `LinhaAdmin.desvincular()` ganhou `try/catch` +
mensagem de erro visível (`msgDesvincular`). Antes desta onda a RPC nunca lançava exceção para um caller
já autorizado, então a chamada nunca precisou de tratamento de erro; a guarda nova torna isso alcançável
pela UI (até a Onda 3 esconder o botão para linhas de Super Admin).

### Testes (`scripts/auth-platform-isolation-01-onda2-test.mjs`, novo)

100% dados descartáveis, 100% projeto E2E — nunca o Super Admin real, nunca o admin real da Aquarios
Bar. 3 lojas descartáveis + 2 admins normais descartáveis + 1 "Super Admin" descartável (vinculado a
`super_admins` **e** `admins`, replicando a sobreposição real) + 1 usuário sem nenhum vínculo.

| Cenário | Resultado esperado | Resultado obtido |
|---|---|---|
| A) Super Admin (descartável) como alvo | BLOQUEADO, linha em `admins` preservada | ✅ PASS (3/3) |
| B) Admin normal descartável | DESVINCULAÇÃO PERMITIDA | ✅ PASS (2/2) |
| C) Admin de outro tenant descartável | comportamento preservado (mesmo caminho de B) | ✅ PASS (2/2) |
| D) Usuário sem vínculo de admin | idempotente, `desvinculado:false`, sem erro (regra pré-existente) | ✅ PASS (1/1) |
| Regressão (caller não-super-admin) | BLOQUEADO (autorização pré-existente, inalterada) | ✅ PASS (2/2) |

**11/11 PASS.** Limpeza confirmada por consulta somente-leitura ao projeto E2E: 0 stores/auth.users
órfãos com o prefixo de teste; `public.super_admins` do E2E voltou ao estado vazio.

Migration aplicada **exclusivamente no projeto E2E** — confirmado por leitura direta de `pg_proc` que a
função contém a guarda nova. **Nenhuma alteração em produção nesta onda** — produção continua com a
versão anterior de `platform_unlink_store_admin` até autorização explícita de uma onda futura.

Verificações estáticas: lint (0 erros, 54 warnings pré-existentes — mesmo baseline da Onda 1), typecheck
(limpo), build (sucesso), `test:domain` (0 falhas).

## Onda 3 — Proteção visual do Platform Console (CONCLUÍDA)

**Objetivo:** a interface deve refletir a separação de papéis — defesa de INTERFACE apenas; as
proteções reais continuam sendo o backend das Ondas 1/2.

**Migration nova** (`migrations/REF-AUTH-PLATFORM-ISOLATION-01-onda3-flag-super-admin-detalhe.sql` +
rollback) — `platform_tenant_detail(p_store_id)` ganha 1 campo por administrador no array `admins`:
`is_super_admin` (`EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = a.user_id)`). Aditivo puro
— a informação já existia em `public.super_admins`, esta migration só a expõe; nenhuma autorização nova
foi criada, `RETURNS jsonb` não muda de assinatura.

**`src/components/admin/PlatformTenants.jsx`** — `LinhaAdmin` agora lê `admin.is_super_admin`: quando
`true`, renderiza o selo `👑 Super Admin da plataforma` (`data-testid="plataforma-super-admin-selo-*"`)
no lugar dos botões `🔑 Definir senha`/`Desvincular` — eles simplesmente não são renderizados nessa
linha (não apenas desabilitados). Para admins normais (`is_super_admin` ausente/`false`), o
comportamento é 100% preservado.

### Testes (`e2e/tests/admin/platform-console.spec.js`, ajustado — sem novo arquivo/fixture)

Reaproveitados os 2 testes já existentes desta suíte, que já exercitavam exatamente os 2 papéis
necessários:

| Cenário | Onde | Resultado |
|---|---|---|
| A) Linha de Super Admin (o próprio `ADMIN_FIXTURE`, promovido a `super_admins` só na janela do teste) — selo visível, `Definir senha`/`Desvincular` ausentes | Teste 1 (vincula o próprio e-mail) | ✅ PASS |
| B) Linha de admin normal (`ADMIN_B_FIXTURE`, pessoa distinta, nunca super admin) — selo ausente, `Definir senha`/`Desvincular` visíveis | Teste 2 (vincula Pessoa B) | ✅ PASS |
| C) Regressão do restante de ambos os testes (provisionamento, troca de contexto "Abrir Admin", isolamento entre Pessoa A/B) | Testes 1 e 2 | ✅ PASS |

**2/2 testes PASS** (`npx playwright test e2e/tests/admin/platform-console.spec.js`, projeto E2E).
Rodado também `admin-empresa-identidade-visual.spec.js` (usa a mesma tela de detalhe) — **1/1 PASS**,
sem regressão. Limpeza confirmada por consulta somente-leitura: 0 stores órfãs, `super_admins` do E2E
de volta a vazio.

Migration aplicada **exclusivamente no projeto E2E**. **Nenhuma alteração em produção nesta onda.**

Verificações estáticas: lint (0 erros, 54 warnings — mesmo baseline), typecheck (limpo), build
(sucesso), `test:domain` (0 falhas).

## Onda 4 — Auditoria do modelo de onboarding (CONCLUÍDA — modelo confirmado correto, nenhum problema encontrado)

**Objetivo:** prova técnica, antes de autorizar a separação definitiva (Onda 5-7), de que criar uma loja
nova nunca depende de criar outro Super Admin, e de que o Super Admin continua conseguindo administrar
qualquer loja pelo Platform Console **sem precisar ser admin operacional dela**.

Auditoria somente-leitura confirmou as 9 alegações pedidas:

| # | Alegação | Confirmado por |
|---|---|---|
| 1 | Nova loja NÃO exige novo Super Admin | `provision_store()` (`migrations/REF-SAAS-01-onda8-provisionamento.sql`) nunca insere em `super_admins`, só em `stores`/`store_settings`/`admins` |
| 2 | Nova loja pode receber admin operacional independente | `link_store_admin()` vincula qualquer `auth.users` existente a qualquer `store_id`, sem exigir `super_admins` |
| 3 | Admin operacional não precisa estar em `super_admins` | mesma evidência — nenhuma FK/checagem liga as 2 tabelas |
| 4 | **Super Admin administra a loja sem ser admin operacional dela** | `is_admin_of(store_id) = is_super_admin() OR EXISTS(admins...)` — o `OR` sozinho já basta. **Provado empiricamente** (não só por leitura de código) contra o projeto E2E: ver abaixo |
| 5 | Nova loja não exige novo projeto Supabase | `provision_store()` só grava linhas no mesmo banco — nenhuma chamada à Management API |
| 6 | Nova loja não exige novo projeto Vercel | `vercel.json` roteia por host (`rewrites`/`redirects`) — mesmo deploy atende qualquer slug/domínio |
| 7 | Modelo suporta múltiplos tenants na mesma aplicação/projeto | Já em produção: Encanto + Aquarios Bar, 1 projeto Supabase, 1 deploy Vercel |
| 8 | Vínculo de admin é específico por `store_id` | `UNIQUE(store_id, user_id)` em `public.admins` desde `REF-SAAS-01-onda1-autorizacao.sql` |
| 9 | Isolamento do admin operacional continua protegido por RLS/autorização | `is_admin_of(store_id)` usado tanto nas RLS de `products`/`categories`/`adicionais`/`product_collections`/`orders`/`customers`/`order_items` quanto nas RPCs `admin_orders_*` (SECURITY DEFINER) — nenhuma tabela de tenant ficou no `is_admin()` legado (Encanto-only) |

**Achado importante sobre os testes existentes**: em todos os testes anteriores desta REF, o caller
"super admin" usado (`ADMIN_FIXTURE`) **também** tinha uma linha real em `public.admins` da Encanto no
projeto E2E — ou seja, a alegação 4 (a mais crítica, pois é a premissa de toda a Onda 5-7) **nunca havia
sido provada empiricamente** para o caso "Super Admin SEM absolutamente nenhum vínculo administrativo na
loja alvo", que é exatamente o estado em que o Super Admin real ficará em relação à Encanto após a
Onda 7.

### Prova nova (`scripts/auth-platform-isolation-01-onda4-audit-proof.mjs`)

Fecha essa lacuna objetiva. Reaproveita os 2 fixtures **permanentes** do projeto E2E deliberadamente sem
nenhum admin (`bar-da-sogra-e2e`/`loja-inativa-e2e`, criados pela REF-AUTH-TENANT-01 Onda 4) — **nenhum
dado novo foi criado ou destruído**, só promoção/revogação temporária de `ADMIN_FIXTURE` em
`super_admins` (mesmo padrão já usado nos scripts anteriores).

| Prova | Resultado |
|---|---|
| Confirma a premissa: `bar-da-sogra-e2e` com `admin_count=0` e `ADMIN_FIXTURE` sem nenhuma linha em `admins` para essa loja | ✅ PASS |
| `platform_tenant_detail` funciona para essa loja sem nenhum vínculo (Platform Console) | ✅ PASS |
| `admin_orders_stats`/`admin_orders_search` (gate `is_admin_of`) funcionam sem nenhum vínculo — só por ser super admin (Admin operacional) | ✅ PASS |
| Controle negativo: cliente comum (não admin, não super admin) continua **bloqueado** na mesma loja | ✅ PASS |

**10/10 PASS.** Limpeza confirmada: `super_admins` do E2E de volta a vazio, nenhum outro dado tocado.

### Conclusão

**O modelo já está correto — nenhum problema encontrado.** As 9 alegações estão confirmadas por código
e, na mais crítica (#4/#9), também por prova empírica ao vivo. A separação planejada para a Onda 5-7
(remover o vínculo do Super Admin real em `admins` da Encanto, mantendo-o em `super_admins`) é segura
pela arquitetura já existente — o Super Admin continuará administrando a Encanto inteira (Platform
Console e Admin operacional) exatamente como administra hoje `bar-da-sogra-e2e`/`loja-inativa-e2e`.

Nenhuma migration foi necessária nesta onda (nenhuma correção a fazer). Único arquivo novo: o script de
prova. Verificações estáticas: lint (0 erros, 54 warnings — mesmo baseline), typecheck (limpo), build
(sucesso), `test:domain` (0 falhas). Nenhuma alteração em produção; nenhum usuário real tocado.

## Onda 5 — Admin operacional independente da Encanto (CONCLUÍDA, em produção)

**Objetivo:** criar/vincular uma identidade operacional própria da Encanto, preparando a Onda 7
(remoção do vínculo do Super Admin real).

**Auditoria (antes de executar):** o caminho mais seguro é o próprio botão "Vincular" do Platform
Console — a Edge Function `invite-store-admin` já delega 100% da autorização a `link_store_admin`
(`is_super_admin()`), nunca envolve alguém escolhendo/vendo uma senha (a pessoa convidada define a
própria via link oficial do Supabase, `ConviteApp.jsx`), e o `redirectTo` já resolve corretamente para o
domínio real da Encanto (`dominio='encanto.valionsistemas.com.br'`, padrão legado →
`https://admin.encanto.valionsistemas.com.br/convite.html`).

**Execução (autorizada explicitamente pelo dono, e-mail fornecido por ele: `encantomarmitaria@gmail.com`):**
como esta sessão não tem — e não deve ter — a senha do Super Admin real para logar e obter o JWT de
caller que a Edge Function exige, os 2 efeitos que `invite-store-admin`+`link_store_admin` produziriam
foram replicados diretamente via `service_role` (mesmo padrão já usado nesta REF para o reset de senha
do Super Admin e o fix de e-mail da Aquarios): confirmado o projeto de produção pela URL antes de
qualquer chamada; `auth.admin.inviteUserByEmail()` (nunca uma senha escolhida/vista por ninguém) +
`INSERT` em `public.admins (store_id, user_id)` — exatamente a mesma inserção que `link_store_admin`
faria. Script temporário (`_tmp_onda5_convite_admin_encanto.mjs`) deletado imediatamente após a
execução; `git status` confirmou nada indevido no working tree.

### Validação (10 provas pedidas)

| # | Prova | Resultado |
|---|---|---|
| 1 | Novo usuário existe em `auth.users` | ✅ confirmado (`user_id=0a8def19-...`) |
| 2 | Vinculado à Encanto em `public.admins` | ✅ confirmado |
| 3 | NÃO está em `public.super_admins` | ✅ confirmado |
| 4 | Consegue autenticar | ⏳ **pendente** — depende da pessoa real aceitar o convite e definir a própria senha (fluxo self-service, ninguém mais tem acesso a essa senha) |
| 5 | Acessa somente o Admin da Encanto | ⏳ garantido arquiteturalmente (`is_admin_of` só retorna `true` para a loja onde há vínculo — mesmo mecanismo já provado empiricamente na Onda 4) — confirmação real depende do login |
| 6 | Executa operações administrativas da Encanto | ⏳ mesma dependência do item 5 |
| 7 | NÃO administra Aquarios | ✅ confirmado (0 linhas em `admins` para `aquariosbar`) |
| 8 | NÃO recebe privilégios de plataforma | ✅ confirmado (0 linhas em `super_admins`) |
| 9 | Super Admin real continua exatamente como estava | ✅ confirmado (`super_admins` intacto, ainda 1 linha em `admins` da Encanto — vínculo do Super Admin **não foi removido**, como exigido nesta onda) |
| 10 | Aquarios continua exatamente como estava | ✅ confirmado (`status='suspenso'`, vínculo do admin real intacto) |

Encanto agora tem **2 linhas** em `public.admins`: o Super Admin real (inalterado, será removido só na
Onda 7) + o novo admin operacional. Nenhuma senha foi vista, gerada, registrada ou logada em nenhum
momento — fluxo 100% self-service via convite oficial do Supabase.

Nenhum código foi alterado nesta onda (ação de dado em produção, via API oficial) — lint/typecheck/
build/`test:domain` reconfirmados verdes (estado idêntico à Onda 4). E2E não re-executado: nenhum
caminho de código foi tocado, nada a validar por essa via.

**Pendência explícita para a Onda 6:** aguardar a pessoa real aceitar o convite (`encantomarmitaria@gmail.com`)
e confirmar login real no Admin da Encanto antes de considerar os itens 4-6 fechados.

**Achado de CI investigado e resolvido**: o commit da documentação (`4920a2e`) veio com o job E2E
vermelho (`admin-adicionais.spec.js:52`/`:88` por timeout puro, `admin-categorias.spec.js:29` flaky).
Investigação: `git diff --stat 60b880b 4920a2e` mostra **zero arquivos de código/teste alterados** entre
o último CI verde e este — nenhuma onda desta REF tocou `admin-adicionais.spec.js`, `admin-categorias.
spec.js` ou `AdminPanel.page.js`/`AdminPanel.jsx`. Confirmado flakiness de runner (não regressão) por
retrigger (`e49e6d3`, commit vazio) — **CI verde na reexecução**.

## Onda 6-A — Investigação: login real falhou ("Invalid login credentials")

Ao tentar o primeiro login real, `encantomarmitaria@gmail.com` continuava com `email_confirmed_at=NULL`
e `last_sign_in_at=NULL` em produção — o mesmo padrão do incidente anterior da Aquarios Bar. Investigação
somente-leitura (produção) + reprodução em dados descartáveis (E2E):

| Item auditado | Resultado |
|---|---|
| `ConviteApp.jsx` | Depende 100% de `detectSessionInUrl` + `onAuthStateChange`; **nunca lê `error`/`error_code` do fragmento** — timeout genérico de 6s cai em "Link inválido ou expirado" sem revelar o motivo real |
| `convite.html` | Entry point real do build (`vite.config.js`), existe na raiz do repo — sem problema |
| `invite-store-admin` | Sem TTL próprio — herda 100% da config global do projeto |
| `vercel.json` | Nenhum rewrite toca `/convite.html` (só `/` é reescrito por host) — **descartado** |
| Redirect URLs (produção) | `https://admin.encanto.valionsistemas.com.br/convite.html` explicitamente na allow-list — **descartado** |
| **`mailer_otp_exp` (produção)** | **600 segundos (10 minutos)** — E2E usa 3600s. Achado central. |

**Reprodução E2E** (`scripts/auth-platform-isolation-01-onda6a-ttl-test.mjs`, dados descartáveis): fluxo
completo (`generateLink → verify HTTPS → fragmento → setSession → updateUser(senha) → signInWithPassword`)
— **7/7 PASS** quando o link é usado fresco, confirmando que o mecanismo em si não tem bug estrutural.

**Conclusão**: causa **PROVÁVEL** (não confirmável sem gravar em produção, fora do escopo daquela onda) —
o convite caiu em spam, o token expirou em 10 minutos antes de ser aberto, e `ConviteApp.jsx` nunca
revela esse motivo ao usuário. Nenhuma correção foi feita nesta onda (investigação pura).

## Onda 6-B — Correção do TTL + novo convite (CONCLUÍDA)

**Fase 1 (gate E2E)**: `scripts/auth-platform-isolation-01-onda6b-fase1-e2e-test.mjs` — fluxo completo
(convite → abertura → confirmação → sessão → senha → logout → login normal → `email_confirmed_at` →
`last_sign_in_at`) contra o projeto E2E (que já usa `mailer_otp_exp=3600s`). **10/10 PASS.** Limpeza
confirmada (0 usuários órfãos).

**Fase 2 (produção, config)**: `mailer_otp_exp` alterado via Supabase Management API —

```
ANTES:  600 segundos (10 minutos)
DEPOIS: 3600 segundos (1 hora)
```

Confirmado por leitura antes/depois. Nenhum outro campo de Auth mudou (allow-list, `mailer_autoconfirm`,
`smtp_host`, `site_url`, `sms_otp_exp`, `disable_signup` — todos reconferidos idênticos).

**Fase 3 (produção, novo convite real)**: `auth.admin.inviteUserByEmail('encantomarmitaria@gmail.com',
{redirectTo: 'https://admin.encanto.valionsistemas.com.br/convite.html'})` chamado diretamente via
`service_role` (mesmo padrão desta REF — sem sessão do Super Admin real disponível). Confirmado: **mesmo
`user_id`** de antes (`0a8def19-...`, nenhum usuário novo criado), `invited_at` atualizado para um
timestamp fresco, vínculo com Encanto em `public.admins` preservado, `email_confirmed_at` continua NULL
(esperado — só muda quando o convite for de fato aceito).

**Fase 4**: parado após o envio, conforme instruído — nenhuma tentativa de aceitar o convite, definir
senha ou confirmar e-mail em nome do destinatário.

**Estado final confirmado (leitura)**:

| Conta | Estado |
|---|---|
| Super Admin real (`b9dc7626-...`) | Inalterado — continua em `super_admins`, vínculo com Encanto preservado |
| Aquarios Bar (`c3d3dbe9-...`) | Inalterada — `status=suspenso`, vínculo intacto |
| `encantomarmitaria@gmail.com` | Convite reenviado com TTL corrigido, aguardando aceite real |
| `public.admins` da Encanto | 2 linhas (Super Admin + novo admin) — nenhum vínculo removido |

Nenhuma alteração de código nesta onda (config de produção via API oficial + ação de dado via API
oficial). Verificações estáticas não se aplicam (nada em `src/`/`supabase/functions/`/`migrations/`
mudou).

**Pendência explícita para a Onda 6 (continuação)**: aguardar `encantomarmitaria@gmail.com` abrir o novo
convite (agora com 1h de validade) e confirmar login real antes de fechar a validação do admin
operacional e cogitar a Onda 7.

## Onda 6-C — Investigação do redirecionamento (2º convite também falhou)

Mesmo com o TTL corrigido, o 2º convite real também falhou: usuário clicou "Aceitar convite" e caiu
**direto na tela de login normal** (não na tela "Defina sua senha"), depois "Invalid login credentials".

**Evidência decisiva** (leitura de produção): `email_confirmed_at` e `last_sign_in_at` da conta real
ficaram preenchidos com **41 milissegundos de diferença** — prova que o `/verify` do Supabase **funcionou**
e criou uma sessão real (o convite não estava mais expirado). O problema estava depois disso.

**Causa raiz identificada**: o build do Admin (`vite.config.js`, `buildPwaPlugin(false, 'sw-admin.js',
'admin.html', [...])`) configura o Workbox com `navigateFallback: 'admin.html'` **sem nenhum
`navigateFallbackDenylist`**. `convite.html` é deliberadamente excluído do *precache* (`globIgnores`),
mas isso nunca protegeu contra o *fallback*: qualquer navegação que não bata com o precache é
interceptada pelo Service Worker e recebe `admin.html` de volta. Se esse Service Worker já estava ativo
no navegador usado (de uma visita anterior a `admin.encanto.valionsistemas.com.br`), a navegação para
`/convite.html` nunca chegava à rede — o navegador mostrava a tela de login normal, com o token do
convite ignorado no fragmento da URL.

Reprodução com navegador real (Playwright/Chromium) confirmou **por título de página**: build antigo →
`<title>` renderizado = "Encanto Admin" (errado, veio do `admin.html` cacheado); build com a correção →
`<title>` = "Definir senha — Encanto Admin" (correto). Investigação 100% somente-leitura em produção;
reprodução 100% em dados descartáveis no E2E, revertendo toda config temporária ao final.

## Onda 6-D — Correção do Service Worker (CONCLUÍDA, deploy pendente de autorização)

**Arquivo alterado**: `vite.config.js`.

**Correção exata**: `buildPwaPlugin` ganhou um 5º parâmetro `navigateFallbackDenylist` (default `[]` —
web/capacitor continuam idênticos a antes), repassado para `workbox.navigateFallbackDenylist`. A chamada
do build `admin` passa `[/\/convite\.html$/]` — exclui **exclusivamente** essa rota do fallback do
Service Worker; nenhum outro comportamento (precache, offline das demais páginas, `clientsClaim`) muda.

**Validação da configuração compilada**: inspecionado o `dist/sw-admin.js` gerado byte a byte —
`e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("admin.html"),{denylist:[/\/convite\.html$/]}))`
— denylist presente e correta. Build web (`dist/encanto/sw.js`) confirmado com `{denylist:[]}` (default
vazio, comportamento idêntico a antes — Workbox trata array vazio exatamente como ausência da opção).

**Teste que reproduziu o problema** (antes da correção, navegador real com Service Worker já ativo):
`<title>` renderizado = "Encanto Admin" ao navegar para `/convite.html` — bug confirmado.

**Teste que comprovou a correção** (`scripts/auth-platform-isolation-01-onda6d-sw-fix-test.mjs`, build
real `vite build --mode admin` + `vite preview` + Playwright/Chromium, projeto E2E, e-mail 100%
descartável, Service Worker registrado ANTES do convite para replicar exatamente o cenário do bug):

| Passo | Resultado |
|---|---|
| Service Worker ativo/controlando a página antes do convite | ✅ |
| `convite.html` carrega o documento correto (não o shell do `admin.html`) | ✅ |
| Tela "Defina sua senha" aparece (ConviteApp processa a sessão) | ✅ |
| Senha definida com sucesso | ✅ |
| Login normal funciona | ✅ |
| `email_confirmed_at`/`last_sign_in_at` preenchidos | ✅ |

**8/8 PASS.** Achado colateral do próprio teste (não é bug do produto): o bundle do Admin precisa ser
buildado com as credenciais do MESMO projeto Supabase que emitiu o token sendo testado — buildar com
`.env` de produção para testar um token do E2E produz um 403 na API de Auth (checagem cruzada de
projeto), o que inicialmente mascarou o resultado do teste. Corrigido no próprio script (env vars do
E2E injetadas só no build de teste).

Limpeza confirmada: allow-list temporária do E2E revertida (`""`), 0 usuários órfãos. Regressão
verificada: `platform-console.spec.js` (2/2 PASS, sem relação com este fix, mas toca o mesmo
`vite.config.js`). Verificações estáticas: lint (0 erros, 54 warnings — baseline), typecheck (limpo),
build web e admin (sucesso), `test:domain` (0 falhas).

**Nenhum convite foi reenviado nesta onda.** Estado da conta real inalterado desde a Onda 6-C:
`email_confirmed_at`/`last_sign_in_at` preenchidos (sessão do 2º convite, agora expirado/consumido),
senha ainda não considerada validada, vínculo com Encanto preservado, fora de `super_admins`. Super
Admin real e Aquarios Bar confirmados inalterados.

**Deploy em produção desta correção**: pendente de autorização explícita separada (regra do projeto —
nenhum deploy de produção sem pedido específico).

## Pendências / próximas ondas (não iniciadas)

- Deploy em produção da correção do Service Worker (Onda 6-D) — aguardando autorização explícita.
- 3º convite real para `encantomarmitaria@gmail.com`, só depois do deploy acima — aguardando autorização.
- Confirmação real de login de `encantomarmitaria@gmail.com` — depende do destinatário, após o convite acima.
- Onda 7 (separação definitiva do vínculo do Super Admin) — só após a confirmação acima, aguardando
  autorização explícita.
- **Deploy em produção das correções das Ondas 1, 2 e 3** (hardening de credenciais/desvincular/selo do
  Platform Console) também depende de autorização própria — está fora do escopo aprovado até aqui.
  Produção hoje roda: `platform-set-store-admin-password` versão 1 (sem a guarda), e
  `platform_unlink_store_admin`/`platform_tenant_detail` sem as guardas/campo novos — ou seja, hoje em
  produção o Platform Console **ainda não mostra** o selo de Super Admin (o campo não existe na resposta
  da RPC em produção até a migration ser aplicada lá).
