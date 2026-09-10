# REF-PAGAMENTO-01 — CHECKPOINT (ler primeiro numa nova sessão/retomada)

**STATUS: Onda 0 (auditoria) + Onda 1 (schema) + Onda 2 (webhook fundação) + Onda 3 (cobrança real) +
Onda 4 (webhook real) + Onda 5 (Payment Brick/Pix no frontend) + Onda 6 (cartão online, Payment Brick
completo) + Onda 7 (aba "Pagamento" no Admin, self-service) CONCLUÍDAS e commitadas — TODAS VALIDADAS
EM NAVEGADOR REAL com o dono. Split/OAuth/produção seguem fora do escopo até autorização explícita.**

**Atualizado:** 2026-09-09, após o commit local da Onda 7 (admin self-service). Execução autônoma
autorizada pelo dono. Hard constraints seguem valendo: nunca produção, nunca push sem autorização
explícita do gate, 1 commit por onda com `git add` explícito, nunca tocar arquivo de outra sessão.

## Onda 7 — Aba "Pagamento" no Admin (self-service), validada com o dono ao vivo

Primeira tela de self-service desta REF — até aqui, ligar a capability/editar a chave pública exigia
mim rodando SQL direto (nenhuma das Ondas 0-6 tinha RPC de escrita). Fecha esse gap com o mesmo padrão
já usado por `set_company_info` (REF-SAAS-01 · Onda 6.2): `set_pagamento_config(p_habilitada, p_public_key,
p_store_id)`, `is_admin_of(p_store_id)`, upsert em `store_settings`, `RAISE EXCEPTION` com ERRCODE pro
cliente distinguir erro de validação.

**Escopo decidido explicitamente pelo dono** (pergunta feita antes de começar, ver AskUserQuestion desta
sessão): só o que já é seguro circular pela tela — toggle + Public Key (pública por design do próprio
Mercado Pago). O Access Token continua FORA do Admin (segredo de Edge Function, configurado à parte) —
a tela é transparente sobre isso no bloco "Como funciona hoje": hoje existe 1 única conta Mercado Pago
recebendo o dinheiro de todas as lojas que ligarem o recurso, mesmo com chave pública própria por loja.
Resolver isso de vez (cada loja com a própria conta) é escopo de uma REF futura de Split/OAuth.

**Validações server-side** (cobertas por `scripts/pagamento-01-onda7-admin-config-test.mjs`, 13/13):
não-admin é barrado (`is_admin_of`); não deixa habilitar sem chave; formato da chave é validado por
regex (`TEST-`/`APP_USR-` + UUID) — pega o erro real mais provável (colar o Access Token, que tem
formato bem diferente, no lugar da Public Key); limpar o campo (string vazia) remove a linha de
`store_settings` em vez de deixar lixo; upsert idempotente.

**Achado no teste do script** (não afeta o RPC em si): o SELECT de verificação direto em
`store_settings` feito pelo script de teste, rodando como role `authenticated` (simulando o admin via
`SET LOCAL role` + `request.jwt.claims`), voltava 0 linhas mesmo após a escrita confirmada — RLS da
tabela filtra o quê o role `authenticated` pode ver diretamente; `RESET ROLE` antes da leitura de
verificação resolveu. `get_pagamento_config`/`set_pagamento_config` (SECURITY DEFINER) nunca foram
afetados — é uma particularidade só do SELECT cru feito pelo próprio script de teste.

**Frontend**: `pagamentoConfig.js` ganhou `salvarPagamentoConfig(habilitada, publicKey)` (mesmo padrão
TRUTHFUL de `salvarCompanyInfo` — só atualiza o cache com o valor confirmado pelo servidor).
`AdminPagamento.jsx` (aba nova, ícone 💳) segue o padrão visual/de fluxo de `AdminEmpresa.jsx` (form
pendente + "Salvar Alterações" único, não toggle instantâneo — aqui o toggle e a chave são
interdependentes, precisam ser confirmados juntos): bloco de Status com toggle, bloco da Public Key com
validação client-side + badge de ambiente detectado pelo prefixo da chave (🧪 Teste / ✅ Produção),
bloco "Como funciona hoje" (transparência sobre a limitação do Access Token global) e um bloco
informativo de referência de taxas do Mercado Pago (valores de mercado, com aviso explícito pra
confirmar sempre no painel real da conta — não uma promessa de taxa exata).

**Validado ao vivo com o dono**: subi o servidor local em modo `admin` (pra ter `base:'/'`, servindo
`/admin.html` na raiz) com as credenciais do Supabase injetadas via env var inline pra apontar pro
projeto E2E (não existe `.env.admin` dedicado — `--mode e2e` sozinho não ativa `isAdmin`, os dois
precisam ser combinados manualmente pra testar o Admin contra o banco de testes). Login com a conta
fixture já existente (`e2e-admin@teste.encanto.local`, `e2e/support/fixture-accounts.js` — não foi
preciso criar nada novo). Dono testou ao vivo: habilitar sem chave bloqueia com a mensagem certa,
salvar com a chave de teste real (`TEST-25c32e88-...`) mostra o badge "Ambiente de Teste" e a mensagem
de sucesso, desligar + limpar a chave reverte tudo — confirmado também via SELECT direto no banco
(`pagamento_online_habilitada='false'`, sem linha de `mp_public_key`) antes do commit, mesma convenção
de sempre (loja de teste volta ao padrão desligado).

## Onda 6 — Cartão online (Payment Brick completo), validado com o dono ao vivo

Brick habilitado pra Pix **e** cartão de crédito/débito juntos — uma única porta de entrada no
checkout ("Pagar agora", antes "Pix agora"), a escolha entre Pix/cartão acontece dentro do próprio
Brick ("Meios de pagamento"). `form.pagamento` mudou de `'pix_online'` pra `'online'` (genérico, já
que a escolha real só acontece depois).

**Achado real corrigido (motivado diretamente por habilitar cartão)**: `orders.payment_method`
gravava `'online'` fixo pra todo pedido pago online — inofensivo enquanto só Pix existia, mas
quebraria relatórios por forma de pagamento assim que cartão entrasse (todo cartão apareceria como
"online" genérico). `_registrar_criacao_pagamento` ganhou um mapeamento aditivo:
`payment_type_id` do Mercado Pago (`credit_card`/`debit_card`/`bank_transfer`) → vocabulário já
existente do projeto (`cartao_credito`/`cartao_debito`/`pix`). Tipo desconhecido nunca sobrescreve
(mantém `'online'`, nunca adivinha). Seguro em relação a fee: `_resolve_delivery_fee` só roda na
CRIAÇÃO do pedido, antes desse UPDATE existir.

**BUG REAL encontrado ao vivo**: o formulário de cartão do Brick sumia sozinho segundos depois de
preenchido — o cliente digitava os dados e a tela voltava pra escolha do método. Causa: `msg`/
`onSuccess` (funções recriadas a cada render do componente pai, `StoreApp.jsx`) estavam nas
dependências do `useEffect` que monta o Brick — qualquer re-render do pai (por motivo nenhum
relacionado ao pagamento) desmontava e remontava o Brick do zero, apagando o que o cliente tinha
digitado. Corrigido com refs (`msgRef`/`onSuccessRef`) pra manter o valor mais recente disponível
sem re-disparar a montagem — padrão React padrão pra esse tipo de problema.

**Validado de ponta a ponta com o dono**: cartão de crédito de teste oficial (Mastercard, nome do
titular `APRO` — aprovação automática do ambiente de teste) aprovado na hora, pulou direto pra tela
de sucesso/WhatsApp sem passar pela tela de QR (diferente do Pix, que sempre nasce pendente).
Confirmado no banco: `payment_method='cartao_credito'` (não mais genérico), `payment_status=
'aprovado'`, `mp_payment_id` real. Dados de teste limpos da loja `encanto` compartilhada do E2E,
capability revertida ao padrão desligado (mesma convenção de `mesa_habilitada`).

## Onda 5 — Payment Brick (Pix), base desta REF no frontend

**O que foi construído:**
- Capability `pagamento_online_habilitada` + `mp_public_key` em `store_settings` (RPC
  `get_pagamento_config`, opt-in por loja, default desligado).
- Pedido nasce `aguardando_pagamento` (não `recebido`) quando pago online — `buildOrderArgs` ganhou
  override opcional (`extra.status`), `create_order()` **não foi alterado** (já aceitava esse campo).
- `PagamentoOnlinePage.jsx` (antes `PagamentoPixPage.jsx`): QR/espera são **tela própria** (não
  dependem do Brick renderizar sozinho), polling em `consultar_status_pagamento` até `aprovado`.
- **WhatsApp/SuccessPage só disparam DEPOIS da confirmação real do pagamento** — nunca antes.
- `mp-criar-cobranca` (Onda 3) ganhou o campo `pix` na resposta (`qr_code`/`qr_code_base64`/
  `ticket_url`) — necessário pro frontend renderizar o QR.

**3 achados reais da Onda 5** — API de inicialização do Payment Brick rejeitava (422) a string
`'none'` pra `creditCard`/`debitCard`/`prepaidCard`/`ticket` — só `'all'` ou lista de opções
específicas. **Lista vazia (`[]`) é a forma correta de desabilitar** — documentação oficial do MP
mostrava `'none'` como válido pra todos, não bate com o comportamento real observado.

## CSP (vercel.json) — best-effort, não testável localmente

Liberado `sdk.mercadopago.com` (script), `*.mercadopago.com`/`*.mlstatic.com` (connect/img/frame) —
baseado no que o Brick de fato carregou durante os testes reais. CSP só é aplicado pelo Vercel em
produção/preview (dev local não aplica) — pode precisar de ajuste fino quando a REF chegar no gate de
deploy real.

## Secret REAL do webhook (Onda 4) — CONFIGURADO e VALIDADO

Dono registrou a URL do `mp-webhook` no painel "Webhooks" da aplicação (ambiente Teste) e configurou
o `MP_WEBHOOK_SECRET` real via `supabase secrets set` (nunca visto por mim). Achado crítico (bug de
unidade do timestamp, `ts` em segundos não milissegundos) corrigido no commit `c3ba5db` — confirmado
com pagamentos reais retornando 200 no painel do Mercado Pago depois do fix.

## Credenciais de teste do Mercado Pago — todas em uso, nenhuma vista por mim em texto

- **Public Key de teste**: em `store_settings` (por loja) — pública por design do MP.
- **Access Token de teste**: secret de Edge Function (`MP_ACCESS_TOKEN`), projeto E2E.
- **Webhook secret real**: secret de Edge Function (`MP_WEBHOOK_SECRET`), projeto E2E.

## Estado do git
```
(novo) feat(pagamento-01): Onda 7 -- aba Pagamento no Admin (self-service), validado em navegador real
64e40df feat(pagamento-01): Onda 6 (parte 2) -- cartao online (Payment Brick completo), validado em navegador real
e6e2921 feat(pagamento-01): Onda 6 (parte 1) -- orders.payment_method reflete o metodo real (pix/cartao)
02bc8a3 feat(pagamento-01): Onda 5 -- Payment Brick (Pix) no frontend, validado em navegador real
e7e2dd7 feat(pagamento-01): Onda 5 (parte 1) -- RPCs client-facing p/ config e status de pagamento
59cbf7b docs(pagamento-01): checkpoint apos fix de timestamp -- webhook validado com secret real
c3ba5db fix(pagamento-01): unidade do timestamp na assinatura do webhook (segundos, nao ms)
14db132 feat(pagamento-01): Onda 3 -- criacao de cobranca real (E2E, sandbox Mercado Pago)
```
Todos em `origin/main` até `3592718` (reconciliados, ver histórico git anterior deste doc para
detalhes); os commits a partir de `14db132` (inclusive o novo da Onda 7) ainda são **locais**,
aguardando o mesmo gate de reconciliação já estabelecido — nenhum push sem autorização explícita.

## Testes executados e resultados (acumulado)
- Onda 1: 20/20. Onda 2: 29/29. Onda 3 A+B: 19/19. Onda 5 config/status: 7/7. Onda 6 payment_method: 7/7.
  Onda 7 admin config: 13/13.
- `test:domain` limpo, lint 61 warnings pré-existentes (0 novo de comportamento — só o mesmo warning
  `react-hooks/exhaustive-deps` já aceito em `AdminEmpresa.jsx`, replicado por design em
  `AdminPagamento.jsx`; 0 erro), build limpo (web + admin) em todas as ondas.
- Pin do golden de checkout (`tests/checkout.golden.mjs`) atualizado conscientemente (override de
  `status`).

## O que foi REALMENTE validado (vs. simulado) — atualizado

**Onda 5 e Onda 6 foram validadas em NAVEGADOR REAL, com o dono testando ao vivo**: criação de
pedido, Payment Brick completo (Pix + cartão), QR Pix real, cartão de teste aprovado na hora,
confirmação automática via polling, `orders.payment_method` refletindo o método real. 2 bugs reais
encontrados e corrigidos durante os testes (customização inválida do Brick, remontagem indevida por
dependências instáveis). Ainda NÃO validado: split/OAuth (fora do escopo até segunda ordem), qualquer
coisa em produção (bloqueado, gate separado), boleto/carteira Mercado Pago (fora do escopo,
decisão consciente — não fazem sentido pro negócio hoje).

## Próximo gate necessário

Decisão do dono: (1) decidir sobre o gate de reconciliação/push pendente desde a Onda 3, ou
(2) considerar a REF pronta para uma avaliação de piloto controlado em produção (ainda bloqueada por
padrão, precisa de autorização explícita separada e nova). Tecnicamente, o fluxo completo (Pix + cartão
+ configuração self-service no Admin) já está validado ponta a ponta em ambiente de teste.

Gap real que segue aberto (documentado, não escondido): Access Token ainda é 1 segredo GLOBAL — uma
loja nova que ligar o pagamento online hoje manda o dinheiro pra MESMA conta Mercado Pago de sempre.
Resolver isso (cada loja com a própria conta, via Split/OAuth) é escopo de uma REF futura separada,
fora desta onda por decisão explícita do dono.
