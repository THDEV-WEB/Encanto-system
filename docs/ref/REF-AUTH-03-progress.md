# REF-AUTH-03 — SMTP profissional (Resend) — progresso

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

Detalhe arquitetural completo em `docs/adr/REF-AUTH-03-smtp-profissional-resend.md`.

## Estado atual

🟡 EM ANDAMENTO — Onda 0 (auditoria) e Onda 1 (planejamento) concluídas. Onda 2 **bloqueada em ação
manual do dono** (criar conta Resend + registros DNS) — ver instruções numeradas abaixo.

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

Decisão: subdomínio dedicado `mail.valionsistemas.com.br` (não o ápice), remetente
`"Encanto" <nao-responda@mail.valionsistemas.com.br>`, DNS na mesma zona Registro.br já em uso.
Justificativa completa, tabela de registros DNS e payload exato do PATCH de SMTP: ver ADR.

## Onda 2 — Ação externa (BLOQUEADA — depende do dono)

Só o dono tem acesso à conta Resend (serviço de terceiro) e ao painel de DNS do domínio para os
valores EXATOS de SPF/DKIM (o Resend gera uma chave DKIM única por domínio no momento em que ele é
cadastrado — não é um valor previsível antes disso). Passos exatos entregues no chat (numerados);
resumo aqui para retomada:

1. Criar conta em resend.com (ou reaproveitar, se já existir).
2. Add Domain → `mail.valionsistemas.com.br`.
3. Resend mostra 3-4 registros DNS (SPF/DKIM/MX/opcionalmente DMARC) → adicionar na zona de
   `valionsistemas.com.br` no Registro.br (mesmo painel "modo avançado" já usado na REF-BRAND-01).
4. Aguardar Resend marcar o domínio como "Verified" (propagação DNS, normalmente minutos a poucas
   horas).
5. Gerar uma API key no Resend (Settings → API Keys) — essa API key é a `smtp_pass` no PATCH do
   Supabase (usuário SMTP é sempre a string literal `resend`, host `smtp.resend.com`, porta `465`).
6. Colar aqui: (a) confirmação de domínio verificado, (b) a API key.

## Pendente após o dono liberar a Onda 2

- Onda 3: PATCH do SMTP no Supabase (payload já definido no ADR) + validar OTP/troca de e-mail/demais
  fluxos usando o transporte novo (confirmar headers/remetente na mensagem recebida de verdade).
- Onda 4: hardening (revisar `mailer_otp_exp` 3600→menor, traduzir assuntos/templates dormentes pro
  PT-BR, DMARC `p=none` inicial).
- Onda 5: regressão completa (OTP, troca de e-mail, Google OAuth, sessão, logs, desktop/mobile).
- Onda 6: limpeza (nenhuma referência antiga pra remover no código — mudança é 100% de config externa
  ao repo; confirmar isso explicitamente como parte da limpeza).
- Onda 7: relatório final + fechar este arquivo como CONCLUÍDA.

## Commits desta REF até agora

Nenhum — Ondas 0/1 foram só auditoria/planejamento (arquivos novos em `docs/`, sem mudança de
comportamento). Primeiro commit será junto da Onda 3 (config de SMTP + docs), conforme instrução do
dono de commitar por onda relevante.
