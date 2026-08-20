# invite-store-admin — Convite de administrador (REF-STORE-ONBOARD-01 · Onda 2)

Único ponto do sistema que usa `service_role`. Cria a identidade Auth de um novo administrador
(`auth.admin.inviteUserByEmail`) só depois de confirmar — pela própria RPC `link_store_admin`, com o
JWT de quem chamou, nunca por conta própria — que o caller é super admin e que o e-mail realmente não
existe ainda. Ver o cabeçalho de `index.ts` para o desenho completo (por que não duplica autorização,
por que não precisa de rollback).

## Arquitetura do fluxo

```
Platform Console (botão "Vincular")
        │
        ▼
db.functions.invoke('invite-store-admin', {storeId, email})   (JWT do super admin logado)
        │
        ▼
invite-store-admin (esta função)
        │
        ├─ link_store_admin(storeId, email)  [JWT do caller]  ──▶ e-mail já existe? vincula e termina.
        │
        └─ e-mail não existe ──▶ auth.admin.inviteUserByEmail(email, {redirectTo}) [service_role]
                                          │
                                          ▼
                          e-mail com o link de convite (via Resend, mesmo SMTP de produção)
                                          │
                                          ▼
                    convite.html/ConviteApp.jsx (bundle isolado) — define a senha inicial
                                          │
                                          ▼
                          link_store_admin(storeId, email)  [JWT do caller, de novo] — completa o vínculo
```

## Pré-requisito 1: deploy

```bash
# 1) login (uma vez por máquina) — ou SUPABASE_ACCESS_TOKEN no ambiente pra rodar sem prompt interativo
supabase login

# 2) linkar ao projeto (uma vez por checkout do repo)
supabase link --project-ref hvbcdxsagkjtfjwvnslo

# 3) deploy — SEM secrets pra configurar: SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY já
#    são injetados automaticamente pela plataforma em toda Edge Function.
supabase functions deploy invite-store-admin
```

## Pré-requisito 2: Redirect URL do convite (Supabase Dashboard, FORA desta função)

O link do e-mail de convite só funciona se a URL de destino estiver na allow-list do Auth. Sem isso, o
convite é enviado normalmente mas o clique no link falha (GoTrue rejeita o `redirectTo`).

**Authentication → URL Configuration → Redirect URLs**, adicionar:

```
https://admin.*.valionsistemas.com.br/convite.html          (padrao legado -- so Encanto)
https://admin-*.lojas.valionsistemas.com.br/convite.html    (padrao novo -- Onda 2 · Opcao C)
```

(coringa `*` cobre qualquer slug de loja em cada padrão — mesmo domínio que já serve `admin.html` hoje,
`convite.html` sai no mesmo deploy). Se o projeto não aceitar coringa nessa posição, adicionar uma
entrada por loja até confirmar o padrão aceito.

**Confirmado e aplicado em produção em 2026-08-19** via Management API (`PATCH /v1/projects/{ref}/config/auth`,
aditivo — só acrescentou as 3 URLs originais, nenhuma entrada anterior foi removida). Em 2026-08-20,
mais uma entrada aditiva (`https://admin-*.lojas.valionsistemas.com.br/convite.html`) foi acrescentada
para o padrão novo (REF-STORE-ONBOARD-01 Onda 2 · Opção C — ver `docs/adr` da REF para a especificação
completa de por que o padrão de domínio mudou de `admin.{slug}.valionsistemas.com.br` para
`admin-{slug}.lojas.valionsistemas.com.br` em lojas novas). `uri_allow_list` hoje tem 11 entradas,
nenhuma removida desde a criação desta função.

## Teste manual (produção, após deploy + redirect URL configurados)

1. Platform Console → loja sem administrador → campo de e-mail → "Vincular" com um e-mail que não existe
   em `auth.users`.
2. Deve retornar `{convidado: true, vinculado: true, ...}` (ou `vinculado:false` com o motivo, se o
   segundo `link_store_admin` falhar — nesse caso, clicar em "Vincular" de novo resolve).
3. Checar a caixa de entrada do e-mail convidado — o link deve levar a `.../convite.html`.
4. Definir a senha na tela que abrir, confirmar redirecionamento pro login normal do Admin.
5. Logar com e-mail + a senha definida — deve entrar normalmente (mesmo `signInWithPassword` de sempre).
