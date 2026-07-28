# REF-AUTH-03 — SMTP profissional (Resend) para o Supabase Auth

## Contexto

O Encanto usa e-mail em dois pontos do Auth: login por código de 6 dígitos (OTP, client-side em
`AuthService.signInWithEmailOtp`/`verifyEmailOtp`) e troca de e-mail em "Minha Conta"
(`AuthService.atualizarEmail`). Hoje os dois passam pelo **mailer embutido do Supabase** — serviço
sem SMTP customizado, pensado só para desenvolvimento/teste, não para produção.

Nota de nomenclatura: este número de referência já havia sido reservado (memória do projeto,
sessão anterior) para o kit de SMTP via Resend, na época bloqueado por falta de domínio próprio.
`REF-AUTH-02` é uma referência diferente e já concluída (separação de sessão Loja/Admin,
`docs/ref/REF-AUTH-02-progress.md`) — não tem relação com e-mail.

## Onda 0 — Auditoria (achados)

Levantamento via Supabase Management API (`GET /v1/projects/{ref}/config/auth`) + leitura de código.

**Site URL / Redirect URLs**
- `site_url`: `https://valionsistemas.com.br/encanto` (corrigido nesta sessão, ver
  `docs/ref/REF-AUTH-03-progress.md` para o antes/depois).
- `uri_allow_list`: os 3 domínios em produção + `localhost:5173` — completo, sem gap.

**SMTP atual**
- `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `smtp_admin_email`, `smtp_sender_name`: todos
  `null` — confirma que não há SMTP customizado configurado; 100% no mailer padrão do Supabase.
- `rate_limit_email_sent: 2` (e-mails/hora) — o teto real do mailer padrão. É o principal risco de
  produção hoje: qualquer pico de tráfego (2+ pessoas pedindo código na mesma hora) estoura o limite
  e os pedidos seguintes falham silenciosamente do lado do usuário.
- `smtp_max_frequency: 60` (segundos entre envios pro MESMO destinatário) — este campo é do SMTP
  customizado, ainda não usado; não confundir com o rate limit acima, que é do mailer padrão.

**Templates** (`mailer_templates_*_content`)
- `confirmation` (1º acesso por e-mail, novo usuário) e `magic_link` (login de usuário já existente)
  — **já customizados**, em PT-BR, mostrando `{{ .Token }}` (código de 6 dígitos) — nenhum dos dois
  usa link mágico, coerente com a UI (`CodigoInput` em `LoginScreen.jsx`).
- `recovery`, `email_change`, `invite`, `reauthentication` e as notificações — ainda no **template
  padrão em inglês** (`{{ .ConfirmationURL }}`). Achado de menor impacto: `email_change` é
  efetivamente usado (`atualizarEmail`, fluxo "Minha Conta"), mas nunca traduzido/rebrandado.
- **Assuntos** (`mailer_subjects_*`) — todos em inglês, inclusive os dois templates de OTP já
  traduzidos no corpo (`"Confirm Your Signup"`, `"Your Magic Link"`). Inconsistência cosmética:
  corpo em PT-BR, assunto em EN.

**Providers**
- `external_email_enabled: true`, `external_google_enabled: true` (client_id/secret presentes).
  Nenhum outro provider habilitado (todos os `external_*_enabled` restantes são `false`).

**Rate limits relevantes**
- `rate_limit_otp: 30` (verificações de código/hora) — folgado, não é o gargalo.
- `mailer_otp_exp: 3600` (1h de validade do código) — generoso; sem indício de causar problema, mas
  candidato a redução na Onda 4 (hardening) por boas práticas (códigos de acesso vivendo 1h é mais
  janela de ataque do que o necessário para um fluxo que o usuário completa em segundos).
- `password_min_length: 6` — usado só pelo login do Admin (senha), não pelo Cliente (sem senha).

**Fluxos existentes (código, não hipótese)**
- `AuthService.signInWithEmailOtp`/`verifyEmailOtp` (`src/services/AuthService.js:38-45`): OTP puro,
  sem `redirectTo`, sem link — zero dependência de domínio.
- `AuthService.signInWithGoogle` (mesma classe, linha 25): OAuth com `redirectTo` explícito
  (`origin + BASE_URL`) — zero dependência de `site_url`.
- `AuthService.atualizarEmail` (linha 75-80): `updateUser({email})` **sem** `redirectTo` explícito —
  único ponto que depende de `site_url` para montar o link do e-mail de confirmação de troca.
  `mailer_secure_email_change_enabled: true` no projeto — Supabase exige confirmação em AMBOS os
  e-mails (atual e novo) antes de efetivar a troca.
- **Recuperação de senha:** **não existe nenhuma tela ou chamada** a `resetPasswordForEmail` em todo
  o repositório (grep confirmado, zero ocorrências) — nem para Cliente (não tem senha, só OTP/Google)
  nem para Admin (login por senha em `AdminLogin.jsx`, mas sem UI de "esqueci minha senha"; reset,
  se algum dia necessário, seria manual via dashboard do Supabase). O template `recovery` existe só
  como capacidade dormente da plataforma, nunca disparado pela aplicação.
- **Convites:** **não existem** (`inviteUserByEmail`/`auth.admin.*` — zero ocorrências). Sem fluxo
  de admin convidando outro admin; acesso administrativo é hoje 1 conta fixa + `is_admin()`.

**Conclusão da Onda 0:** o login por e-mail funciona hoje (validado ao vivo nesta sessão, ver
progress doc), mas está apoiado inteiramente no mailer de teste do Supabase — sem SMTP próprio, sem
remetente com identidade de domínio (SPF/DKIM), e com um teto de 2 e-mails/hora que não sobrevive a
uso real. Isso é o gap que esta REF fecha.

## Onda 1 — Decisão arquitetural

**Domínio de envio: subdomínio dedicado, não o ápice.** Proposta: `mail.valionsistemas.com.br`.

Por quê um subdomínio e não `valionsistemas.com.br` direto:
- Isola a reputação de envio transacional (OTP) da reputação do domínio institucional — se o volume
  de disparo do Encanto algum dia tiver um problema de deliverability, não contamina e-mail
  corporativo/institucional que possa existir no ápice no futuro.
- Evita colisão de registros MX: o Resend pede um MX próprio no domínio verificado (recebimento de
  bounce/complaint via Amazon SES, que é quem processa o envio por trás do Resend). Se o ápice algum
  dia ganhar uma caixa de e-mail real (Google Workspace, Zoho etc.), um MX de bounce do Resend no
  mesmo domínio entraria em conflito. Um subdomínio dedicado nunca disputa esse espaço.
- É a prática recomendada pelo próprio Resend para domínios que também servem outros propósitos.

**Remetente proposto:** `"Encanto" <nao-responda@mail.valionsistemas.com.br>` — nome de exibição
igual ao já usado em toda a UI (`useCompanyInfo`/REF-COMPANY-02), endereço não-respondido porque não
há caixa de entrada monitorada do outro lado (sem suporte via e-mail hoje).

**DNS necessários (valores exatos só são gerados quando o domínio é adicionado no painel do
Resend — os nomes de registro abaixo são fixos, os valores são específicos da conta):**

| Tipo | Host | Finalidade |
|---|---|---|
| TXT | `mail.valionsistemas.com.br` (ou `send.mail...`, Resend especifica) | SPF (`v=spf1 include:amazonses.com ~all`) |
| TXT | `resend._domainkey.mail.valionsistemas.com.br` | DKIM (chave pública RSA, gerada pelo Resend) |
| MX | `mail.valionsistemas.com.br` | Recebimento de bounce/complaint (`feedback-smtp...amazonses.com`) |
| TXT (opcional, recomendado) | `_dmarc.mail.valionsistemas.com.br` | `v=DMARC1; p=none;` — modo report-only inicial, sem risco de bloquear entrega própria |

Todos os 4 registros vão no MESMO provedor DNS já usado (Registro.br, mesma zona de
`valionsistemas.com.br` onde o CNAME de `encanto.valionsistemas.com.br` já foi criado nesta mesma
sessão) — nenhuma ferramenta nova.

**Configuração do Supabase (Auth → SMTP, via Management API `PATCH /config/auth`):**

```json
{
  "smtp_host": "smtp.resend.com",
  "smtp_port": 465,
  "smtp_user": "resend",
  "smtp_pass": "<API key do Resend>",
  "smtp_admin_email": "nao-responda@mail.valionsistemas.com.br",
  "smtp_sender_name": "Encanto",
  "smtp_max_frequency": 60
}
```

`smtp_max_frequency` mantido em 60s (intervalo mínimo entre envios pro MESMO destinatário — já é o
valor atual, evita reenvio abusivo do botão "Reenviar código", que já tem cooldown próprio de 30s na
UI, `LoginScreen.jsx:59`). Uma vez preenchido `smtp_host`, o Supabase **para de usar o mailer
padrão automaticamente** para TODOS os e-mails de Auth (OTP, magic link, troca de e-mail, recovery,
convite) — não existe um jeito de migrar só parte dos fluxos; é tudo ou nada, o que é exatamente o
pedido ("garantir que nenhum fluxo continue no mailer padrão").

**Impacto avaliado:**
- Google OAuth: zero impacto (nenhuma dependência de e-mail).
- OTP: sem mudança de comportamento — mesmo template, mesmo `{{ .Token }}`, só troca o transporte.
- Troca de e-mail: sem mudança de comportamento, só passa a sair com identidade de domínio própria.
- `uri_allow_list`/`site_url`: intocados por esta REF.
- Rate limit de 2/hora: deixa de existir — `rate_limit_email_sent` é específico do mailer padrão;
  com SMTP customizado o teto passa a ser o limite da conta Resend (free tier: 100 e-mails/dia,
  3.000/mês — folgado para o volume atual da loja; documentar decisão de upgrade se o volume crescer).

**Rollback:** reverter é 1 PATCH — devolver `smtp_host`/`smtp_port`/`smtp_user`/`smtp_pass` a `null`
volta instantaneamente ao mailer padrão do Supabase, sem tocar em código, sem deploy. Risco de
rollback: nenhum (mudança 100% de configuração externa, zero linha de código de aplicação alterada).

## Alternativas rejeitadas

- **SendGrid/Mailgun/Postmark:** tecnicamente equivalentes, mas o kit já preparado em sessão anterior
  (memória do projeto) era especificamente para Resend — sem motivo para reabrir essa escolha.
- **Verificar o ápice `valionsistemas.com.br` direto no Resend:** rejeitado pelo motivo de isolamento
  de MX/reputação acima.
- **DMARC em modo `p=reject` desde o início:** rejeitado — sem histórico de envio pelo domínio novo,
  começar em `p=none` (report-only) é a prática segura; endurecer depois de confirmar entregabilidade
  estável é trabalho de uma REF futura, não desta.
