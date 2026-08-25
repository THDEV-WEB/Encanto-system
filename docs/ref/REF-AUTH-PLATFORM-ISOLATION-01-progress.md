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

## Pendências / próximas ondas (não iniciadas)

- Onda 2 (hardening de `platform_unlink_store_admin`), Onda 3 (proteção visual do Platform Console),
  Onda 4 (auditoria do onboarding), Onda 5-7 (criação do admin operacional próprio da Encanto e
  separação definitiva do vínculo do Super Admin) — aguardando autorização explícita, onda por onda.
- **Deploy em produção da correção desta Onda 1** também depende de autorização própria — está fora do
  escopo aprovado até aqui (regra explícita: nenhuma alteração em produção nesta onda).
