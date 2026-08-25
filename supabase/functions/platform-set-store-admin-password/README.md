# platform-set-store-admin-password — Super admin define a senha de um admin de loja (REF-PROD-READINESS-01 · A6)

Segundo ponto do sistema que usa `service_role` (o primeiro é `invite-store-admin`). Define a senha de
um administrador de loja **já vinculado** (`auth.admin.updateUserById`) só depois de confirmar — pela
própria RPC já auditada `is_super_admin()`, com o JWT de quem chamou, nunca por conta própria — que o
caller é super admin. Ver o cabeçalho de `index.ts` para o desenho completo.

## Por que esta função existe

Antes dela, a única forma de definir a senha de um admin de loja sem acesso ao e-mail de convite era um
script ad-hoc que gerava uma senha aleatória e **imprimia em texto puro no console** — foi exatamente
assim que a senha real do admin da Aquarios Bar acabou exposta (achado A6 da auditoria
`REF-PROD-READINESS-01`). Esta função nunca loga a senha em lugar nenhum — nem em sucesso, nem em erro.

## Arquitetura do fluxo

```
Platform Console (detalhe da loja → admin vinculado → "Definir senha")
        │
        ▼
db.functions.invoke('platform-set-store-admin-password', {userId, newPassword})   (JWT do super admin)
        │
        ▼
platform-set-store-admin-password (esta função)
        │
        ├─ is_super_admin()  [JWT do caller]  ──▶ false? para aqui, service_role nunca é tocado.
        │
        ├─ userId está em public.admins?  [service_role, leitura]  ──▶ não? recusa (nunca um usuário
        │                                                              arbitrário, mesmo com payload adulterado)
        │
        └─ auth.admin.updateUserById(userId, {password})  [service_role]  ──▶ senha definida, nunca logada
```

## Deploy

```bash
supabase login   # ou SUPABASE_ACCESS_TOKEN no ambiente
supabase link --project-ref hvbcdxsagkjtfjwvnslo
supabase functions deploy platform-set-store-admin-password
```

Sem secrets novos para configurar — `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` já
são injetados automaticamente pela plataforma em toda Edge Function.

## Segurança

- Autorização 100% delegada a `is_super_admin()` — nunca duplicada dentro da função.
- Alvo restrito a usuários já presentes em `public.admins` — nunca um `userId` arbitrário.
- Senha mínima de 8 caracteres, validada na função (defesa em profundidade — o cliente/UI já valida
  antes de chamar).
- Rate limit de 5 chamadas / 5 min por usuário (throttle leve, não é a fronteira de segurança real).
- A senha **nunca** é logada — nem em `console.log`, nem no corpo de erro, nem na resposta de sucesso.
