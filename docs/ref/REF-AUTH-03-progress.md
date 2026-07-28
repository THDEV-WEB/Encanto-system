# REF-AUTH-03 — SMTP profissional (Resend) — progresso

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

Detalhe arquitetural completo em `docs/adr/REF-AUTH-03-smtp-profissional-resend.md`.

## Estado atual

✅ CONCLUÍDA. Todas as 8 ondas (0 a 7) executadas, validadas ao vivo em produção. Zero linha de
código de aplicação alterada — mudança 100% de configuração externa (DNS + Supabase Auth config).

## Onda 0 — Auditoria (concluída)

Ver seção "Onda 0" do ADR para o levantamento completo. Resumo executivo:
- Mailer 100% no padrão do Supabase (`smtp_host` etc. todos `null`), teto de **2 e-mails/hora**.
- OTP validado ao vivo nesta sessão (pedido → e-mail recebido → código `742853` → sessão real criada
  com `access_token`/`refresh_token`, `amr:[{"method":"otp"}]`) — login por e-mail **funciona hoje**,
  esta REF é sobre profissionalizar a infraestrutura, não consertar uma quebra.
- `site_url` estava desatualizado (`encanto-system.vercel.app`) — corrigido nesta mesma sessão
  (PATCH via Management API) para `https://valionsistemas.com.br/encanto`. Confirmado sem efeito
  colateral (releitura completa do config: `uri_allow_list`, templates, Google OAuth, rate limits —
  todos intactos) e sem regressão no Google OAuth (reteste dos 3 domínios, todos `302` pro consent
  do Google).
- Templates de OTP (`confirmation`, `magic_link`) já corretos (`{{ .Token }}`, PT-BR). Templates não
  usados no fluxo principal (`recovery`, `invite`, `reauthentication`) seguem no padrão em inglês —
  não é bug (nunca disparados pela aplicação), é polimento pendente.
- Zero fluxo de recuperação de senha e zero fluxo de convite em todo o código (grep confirmado) —
  `recovery`/`invite` são capacidades dormentes da plataforma.

## Onda 1 — Planejamento (concluído)

Decisão original: subdomínio dedicado `mail.valionsistemas.com.br` (não o ápice). Revisada na
**Onda 1a** (comparação técnica formal pedida pelo dono, ápice vs. subdomínio único vs. subdomínio
por produto): decisão final é **`mail.encanto.valionsistemas.com.br`** — subdomínio escopado por
PRODUTO, não um "mail." genérico compartilhado por toda a Valion. Padrão estabelecido para sistemas
futuros: `mail.<produto>.valionsistemas.com.br`. Remetente:
`"Encanto" <nao-responda@mail.encanto.valionsistemas.com.br>`. Justificativa completa, tabela de
registros DNS e payload exato do PATCH de SMTP: ver ADR (seção "Onda 1a").

Nota de nomenclatura: o dono se referiu a esta decisão como "REF-AUTH-02" no chat — mantido aqui como
REF-AUTH-03 por já ser o número reservado desde o início da sessão para este trabalho de SMTP
(REF-AUTH-02 é outra referência, já concluída, sobre sessão Loja/Admin).

## Onda 2 — Ação externa do dono (concluída)

Domínio `mail.encanto.valionsistemas.com.br` cadastrado no Resend e **verificado com sucesso**.

Achado real durante a auditoria de DNS pré-verificação: os hostnames que o Resend mostra no painel
são relativos à zona (`resend._domainkey.mail.encanto`, sem o sufixo `.valionsistemas.com.br`), e o
Resend sugeriu o registro de DMARC no **ápice** (`_dmarc`) — o que teria furado o isolamento por
produto decidido na Onda 1a (DMARC do Encanto vazando pra política da Valion inteira). Corrigido
antes da publicação: DMARC escopado em `_dmarc.mail.encanto.valionsistemas.com.br`. Auditoria de DNS
completa (autoritativo `a.sec.dns.br`/`b.sec.dns.br` + resolvedores públicos, checagem de
conflito/duplicidade/TTL) feita antes da verificação — ver histórico do chat desta REF.

## Onda 3 — Configuração do SMTP no Supabase (concluída)

PATCH aplicado via Management API (`smtp_host=smtp.resend.com`, `smtp_port=465` — atenção: a API
exige **string**, não number —, `smtp_user=resend`, `smtp_pass=<API key Resend>`,
`smtp_admin_email=nao-responda@mail.encanto.valionsistemas.com.br`, `smtp_sender_name=Encanto`,
`smtp_max_frequency=60`). Confirmado por releitura completa: nenhum outro campo (`uri_allow_list`,
`site_url`, templates, Google OAuth) foi afetado.

Validado ao vivo, e-mail real (`thiagoluiz.fullstack@gmail.com`):
- OTP: pedido → e-mail chegou na caixa principal (não spam), remetente correto → código verificado →
  sessão real criada (`access_token`/`refresh_token`, `amr:[{"method":"otp"}]`).
- Recuperação de senha (`/auth/v1/recover`): disparo confirmado, e-mail chegou.
- Troca de e-mail (`updateUser({email})`): testado com o endereço de sandbox oficial do Resend
  (`delivered@resend.dev`) como novo e-mail — API retornou 200, `new_email` pendente de confirmação.
  Como `mailer_secure_email_change_enabled=true`, a troca exige confirmação nos DOIS lados; como
  ninguém confirma no sandbox, a conta real nunca é alterada — teste seguro por construção, zero
  risco à conta de teste usada.
- Logout (`/auth/v1/logout`): `204`.

## Onda 4 — Hardening (concluído)

Achado real: **`rate_limit_email_sent` continuava em `2`/hora mesmo depois do SMTP customizado
configurado** — é um teto de abuso do GoTrue independente do transporte, nunca coberto pelo payload
original da Onda 3 (só campos `smtp_*`). Corrigido: `rate_limit_email_sent: 2 → 30`.

Demais melhorias aplicadas (payload único, PATCH):
- `mailer_otp_exp`: `3600` → `600` (1h → 10min — reduz a janela de validade do código sem
  comprometer o uso normal; testado ao vivo, round-trip rápido funciona sem atrito).
- `mailer_subjects_confirmation`, `mailer_subjects_magic_link`: assunto traduzido pro PT-BR ("Seu
  código de acesso - Encanto") — antes ficavam em inglês mesmo com o corpo já em português.
- `mailer_subjects_email_change`, `mailer_subjects_recovery` + os respectivos
  `mailer_templates_*_content`: traduzidos e rebrandados (mantendo `{{.ConfirmationURL}}`/
  `{{.Email}}`/`{{.NewEmail}}` intactos).
- **Decisão deliberada, não esquecimento:** `invite`, `reauthentication` e as notificações de
  mudança de senha/e-mail/telefone continuam em inglês/padrão — são capacidades dormentes,
  inalcançáveis por qualquer caminho de código hoje (`mailer_notifications_*_enabled` todos
  `false`, zero fluxo de convite no app). Traduzir agora seria escopo sem benefício funcional
  nenhum; revisitar se essas features forem construídas no futuro.
- DMARC (`p=none`, modo report-only) já publicado na Onda 2, escopado ao subdomínio do Encanto.

## Onda 5 — Testes e regressão (concluída)

- Login OTP: validado 2x ao vivo (round-trip completo), incluindo depois do hardening da Onda 4.
- Recuperação de senha: disparo confirmado.
- Troca de e-mail: confirmado via sandbox do Resend (ver Onda 3).
- Logout: confirmado (`204`).
- Re-login: implícito nos múltiplos round-trips de OTP bem-sucedidos ao longo da REF.
- Persistência de sessão: arquitetura inalterada (localStorage, `AuthProvider`) — zero código tocado
  nesta REF, não há o que regressar aqui.
- Google OAuth: revalidado nos 3 domínios de produção (`302` intacto) depois de CADA mudança de
  config (Onda 3 e Onda 4) — zero regressão em nenhum momento.
- `npm run test:domain`: exit 0, 0 falhas.
- `npm run test:e2e` (suíte Playwright completa, chromium): **113/113 passed (7.3min)** — cobre
  desktop/mobile, carrinho, checkout guest/logado, Minha Conta, Meus Pedidos, Fidelidade, busca,
  categorias, boot. Roda contra o projeto Supabase DEDICADO `encanto-e2e` (não o de produção) — serve
  como prova de que nenhum código de aplicação foi afetado, não como teste do SMTP em si (isso já foi
  validado diretamente em produção, acima).

Achado colateral do processo de teste (não é bug de configuração): dois códigos de verificação
falharam com `otp_expired` durante a sessão de testes — ambos os casos aconteceram logo após uma
mudança de config, num teste "por chat" onde o código precisa ser relayado por uma pessoa em vez de
digitado direto no app; um round-trip mais rápido logo em seguida sempre confirmou que o transporte e
o código-fonte estavam corretos. Não afeta uso real (usuário confere o próprio e-mail e digita em
segundos), mas é um lembrete de que 10 minutos é justo para testes manuais mediados por chat.

## Onda 6 — Limpeza (concluída, sem ação necessária)

Nenhuma referência antiga para remover: esta REF nunca teve SMTP algum configurado antes (todos os
campos `smtp_*` partiam de `null`), e nenhum código de aplicação referencia configuração de e-mail —
é inteiramente responsabilidade do backend do Supabase, invisível ao repositório. Limpeza = confirmar
essa ausência de resíduo, o que foi feito.

## Onda 7 — Documentação (concluída)

Este arquivo + `docs/adr/REF-AUTH-03-smtp-profissional-resend.md` constituem a documentação final.
Relatório de encerramento entregue ao dono no chat desta REF.

## Commits desta REF

- `4f58bdf` — docs: auditoria e plano (Ondas 0-1).
- `54c3fae` — docs: revisão do domínio de envio para escopo por produto (Onda 1a).
- Ondas 2-7 não geraram commit: mudança 100% de configuração externa (DNS no Registro.br + Supabase
  Auth config via Management API) — nenhum arquivo do repositório muda de conteúdo além da própria
  documentação, já commitada acima.
