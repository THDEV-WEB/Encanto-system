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

## Pendências / próximas ondas (não iniciadas)

- Onda 4 (auditoria do onboarding), Onda 5-7 (criação do admin operacional próprio da Encanto e
  separação definitiva do vínculo do Super Admin) — aguardando autorização explícita, onda por onda.
- **Deploy em produção das correções das Ondas 1, 2 e 3** também depende de autorização própria — está
  fora do escopo aprovado até aqui (regra explícita: nenhuma alteração em produção nestas ondas).
  Produção hoje roda: `platform-set-store-admin-password` versão 1 (sem a guarda), e
  `platform_unlink_store_admin`/`platform_tenant_detail` sem as guardas/campo novos — ou seja, hoje em
  produção o Platform Console **ainda não mostra** o selo de Super Admin (o campo não existe na resposta
  da RPC em produção até a migration ser aplicada lá).
