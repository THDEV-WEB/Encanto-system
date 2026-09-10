# REF-PAGAMENTO-01 — CHECKPOINT (ler primeiro numa nova sessão/retomada)

**STATUS: PILOTO DE PRODUÇÃO COM PAGAMENTO REAL LIGADO E VALIDADO (2026-09-10).** Ondas 0-7 (auditoria,
schema, webhook fundação, cobrança real, webhook real, Payment Brick Pix, cartão online, Admin
self-service) CONCLUÍDAS. Onda 8 (piloto de produção — deploy real das Edge Functions, credenciais de
produção, webhook real registrado) também CONCLUÍDA e validada com um pagamento Pix real de ponta a
ponta (dinheiro creditado na conta Mercado Pago do dono, pedido confirmado automaticamente no banco).
Split/OAuth (cada loja com sua própria conta MP) segue fora do escopo, deferido pra REF futura.

**Atualizado:** 2026-09-10, após o piloto de produção ir ao ar e ser validado com pagamento real.
Execução autônoma autorizada pelo dono. Hard constraints seguem valendo: nunca push sem autorização
explícita, nunca aplicar em produção sem autorização explícita (progressivamente concedida nesta sessão
para o piloto), 1 commit por subfase com `git add` explícito, nunca tocar arquivo de outra sessão
concorrente, segredos/credenciais NUNCA colados no chat (o dono roda `supabase secrets set` no próprio
terminal).

## Onda 8 — Piloto de produção com pagamento real (2026-09-10)

Depois das Ondas 0-7 validadas só em ambiente de teste (E2E), o dono autorizou ligar pagamento real em
produção: (1) deploy das Edge Functions `mp-criar-cobranca`/`mp-webhook` pro projeto de produção
(`hvbcdxsagkjtfjwvnslo`), (2) registro da URL do webhook no painel real do Mercado Pago, (3) dono
configurou `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` de produção via `supabase secrets set` no próprio
terminal (nunca vistos por mim em texto), (4) Public Key de produção salva na aba Pagamento do Admin,
(5) teste com Pix real de valor baixo.

**3 bugs reais encontrados e corrigidos durante o piloto ao vivo** (além do "Achado colateral #1" de
sessão, já documentado abaixo, e do "Achado colateral #2" de CSP, também abaixo):

**a) Divergência de taxa presa ao trocar forma de pagamento depois de um aviso.** O mecanismo de
segurança da REF-DELIVERY-FEE-04 (nunca confia no valor do client, recusa e reapresenta o valor
autoritativo) guardava o valor divergente em `state`, mas nada limpava esse estado quando o cliente
trocava de forma de pagamento/endereço/modalidade DEPOIS do aviso — a tentativa seguinte misturava o
método NOVO com a taxa VELHA, produzindo avisos repetidos com valores "trocados" (maquininha/adicional
invertidos). Fix: `useEffect(() => setDivergencia(null), [form.pagamento, semEntregaFisica, endereco])`
em `CheckoutPage.jsx`. Commit `8476b9c`/pushed `0d1440b`.

**b) CSP bloqueava o Payment Brick em produção (tela branca eterna)** — ver "Achado colateral #2"
abaixo para a investigação completa (Playwright/Chromium real). Commit `1d37dcb`/pushed `8a5e8b2`.

**c) MAIS CRÍTICO — `MP_WEBHOOK_SECRET` configurado com o MESMO valor de `MP_ACCESS_TOKEN`.** Depois do
piloto ir ao ar, o dono fez um Pix real de R$2, o dinheiro caiu confirmado na conta Mercado Pago dele,
mas o pedido nunca saiu de `aguardando_pagamento`. Diagnóstico sem nunca ver nenhum segredo em texto:
comparei os HASHES retornados por `supabase secrets list` (a CLI mostra um digest, nunca o valor real)
e os hashes de `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` eram IDÊNTICOS — duas credenciais que deveriam
ser completamente diferentes (uma é o bearer token da API, a outra é o segredo HMAC de assinatura do
webhook, obtido numa tela separada do painel do Mercado Pago) tinham o mesmo valor, quase certamente
por causa da confusão entre os vários tipos de credencial durante a configuração inicial (Public Key,
Access Token, Client ID+Secret, Chave secreta do webhook). Confirmado com `application_logs`: **zero**
eventos `webhook_mercadopago` processados com sucesso em toda a sessão, para NENHUM pagamento de teste
— toda notificação real do Mercado Pago estava sendo rejeitada com assinatura inválida (401) antes de
tocar no banco (`mp-webhook/index.ts` valida a assinatura ANTES de qualquer leitura, por design —
nenhum log de erro chega no `application_logs`, só no runtime da Edge Function). Ou seja: **o fluxo de
confirmação automática de pagamento esteve quebrado silenciosamente durante toda a sessão de testes**,
mascarado porque nenhum teste anterior tinha ficado esperando confirmação tempo suficiente pra ser
notado (os pedidos de teste com cartão são aprovados na hora, sem depender do webhook pro fluxo
visível — só o Pix real expôs o problema).

**Fix**: dono reconfigurou `MP_WEBHOOK_SECRET` com o valor correto (copiado da tela "Webhooks" do
painel do Mercado Pago, nunca visto por mim) via `supabase secrets set` no terminal; `mp-webhook`
reimplantado pra garantir que pegasse o novo valor. **Validado com um SEGUNDO Pix real**: pedido
`989068cd...`, R$2,00, `payment_intents.status` foi de `pendente` pra `aprovado` automaticamente
(`status_detail: 'accredited'`), `orders.status` virou `recebido`, `application_logs` registrou a
primeira transição `webhook_mercadopago` bem-sucedida da sessão. Fluxo end-to-end (cobrança → webhook →
confirmação → pedido pago) confirmado funcionando em produção com dinheiro real.

**d) Refinamentos de UX pedidos pelo dono ao vivo, durante o piloto**: "Pagar agora" (pagamento
antecipado, sem taxa de maquininha) movido pra primeira posição na lista de formas de pagamento
(antes era a última, depois de Dinheiro/PIX/Débito/Crédito); e-mail do cliente logado pré-preenchido no
Payment Brick (`initialization.payer.email`) — o Brick some com a pergunta "insira seu e-mail pra
receber o código Pix" quando o e-mail já é conhecido, evitando que o cliente desista achando que
precisa esperar um e-mail chegar. Commit `3b1870e`/pushed `9e6026a`. Pequena legenda abaixo de cada
nome de forma de pagamento também adicionada ("Pague na hora da entrega" nas 4 opções físicas, "Sem
taxa extra" no Pagar agora) — reforça visualmente por que pagar antecipado é vantajoso. Commit
`83c5907`/pushed `b4ecbae`.

**Pedidos de teste descartáveis** (loja real `encanto`, valores baixos de R$2-58, a maioria cancelada
por expiração do Pix de 15min ou confirmada depois do fix do webhook) ficaram no histórico do cliente
de teste do dono — não foram limpos automaticamente (são pedidos reais, mesmo que de valor simbólico;
limpar exigiria autorização explícita separada).

## Achado colateral #2 — CSP bloqueava o Payment Brick em produção (tela branca)

Testando a Onda 7 em produção, dono relatou tela branca ("Pagamento online / Escolha Pix ou cartão")
que nunca saía do lugar, mesmo depois de escolher método nenhum. Diagnosticado SEM depender do
navegador do dono — construí um repro com Chromium real (Playwright, já instalado no projeto p/ E2E)
que reproduz o mesmo `mp.bricks().create(...)` que `PagamentoOnlinePage.jsx` faz.

**Causa raiz confirmada empiricamente**: `vercel.json` liberava `*.mlstatic.com` em `img-src`/
`connect-src`, mas **nunca em `script-src`**. O Payment Brick carrega peças de JS (`components/
payment.js` e outros chunks) de `http2.mlstatic.com` — CSP bloqueava esse script em produção (onde o
CSP É de fato aplicado; `vite dev` NUNCA aplica CSP, por isso isso nunca apareceu nas Ondas 5/6,
exatamente o risco que o checkpoint já registrava desde a Onda 5: "CSP... não testável localmente").
**Achado extra do mesmo tipo**: `api.mercadolibre.com` (telemetria do Brick) também faltava em
`connect-src`.

**Comportamento traiçoeiro confirmado**: com o script bloqueado, `mp.bricks().create(...)` **RESOLVE**
a Promise (nunca rejeita) com um controller quebrado — nem `.catch()` nem `onError` disparam. A tela
ficava presa em "coletando" pra sempre, sem nenhum erro visível.

**Fix duplo**:
1. `vercel.json`: `mlstatic.com` adicionado a `script-src`; `api.mercadolibre.com` adicionado a
   `connect-src`.
2. `PagamentoOnlinePage.jsx`: timeout de segurança (10s) — se `onReady` não disparar a tempo, assume
   falha e mostra a tela de erro já existente (nunca mais uma tela branca eterna, seja qual for a
   causa futura). `.catch()` também adicionado em `mp.bricks().create(...)` como defesa adicional
   (não teria pego ESTE bug específico, já que a Promise resolve — mas cobre outras falhas reais).

**Fecha um gap estrutural**: criado `scripts/pagamento-01-onda7-csp-brick-test.mjs`, um teste de
regressão PERMANENTE que sobe Chromium real (Playwright) com o CSP **lido direto de vercel.json**
(fonte única, nunca duplica a string) e confirma que o Brick monta de verdade, sem nenhuma violação de
CSP envolvendo mercadopago/mlstatic/mercadolibre — fecha de vez o "CSP não testável localmente" que
vinha sendo aceito como risco desde a Onda 5. 4/4 verde.

## Achado colateral #1 (fora do escopo desta REF) — bug real de sessão em create_order

Testando a Onda 7 em produção pela primeira vez, o dono achou `delivery_fee=R$0` inesperado num
pedido de entrega. Investigação (ver histórico do chat) revelou um bug REAL, PRÉ-EXISTENTE, **não
relacionado a pagamento**: `DataService.savePedido` (create_order do storefront) sempre chamava a RPC
via `db` (cliente Supabase do ADMIN, `lib/supabase.js`) em vez de `dbCliente` (sessão real do cliente,
`lib/dbCliente.js`) — `db` nunca carrega a sessão de um cliente logado no bundle da loja. Resultado:
`auth.uid()` sempre nulo dentro de `create_order`, então a checagem de posse do endereço (Onda
ORDER-TENANT-01) recusava vincular `endereco_id` sempre que o endereço já tinha um `customer_id`
(salvo corretamente por `addressRepository`, que já usava `dbCliente`) — e a taxa de entrega saía
R$0 silenciosamente pra QUALQUER cliente logado que pedisse entrega. Confirmado num pedido real de
07/09 (antes desta sessão), então não é regressão desta REF nem desta sessão — só foi descoberto
agora por acaso.

**Fix** (`src/services/DataService.js`): `savePedido` passou a rodar via um runner dedicado
(`runCliente`, novo) que usa `dbCliente`; `savePedidoAdmin` continua via `db`/`run()`, intocado.
Zero migration — mudança client-side pura. Validado com `scripts/pagamento-01-onda7-fix-sessao-
checkout-test.mjs`: login real (supabase-js) como cliente fixture do E2E, salva endereço, cria pedido
— confirma `endereco_id` preenchido e `delivery_fee > 0` (6/6). `test:domain`/lint/build (web+admin)
limpos. Commit separado do resto da Onda 7 (bug não é sobre pagamento).

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

## CSP (vercel.json) — CORRIGIDO e agora testável localmente (achado colateral #2)

Estava incompleto: `mlstatic.com` faltava em `script-src` (script real do Brick), causando tela branca
em produção — ver "Achado colateral #2" acima para a história completa. Corrigido (`script-src` +
`connect-src`) e agora coberto por `scripts/pagamento-01-onda7-csp-brick-test.mjs` (Chromium real via
Playwright, CSP lido direto de vercel.json) — deixa de ser "best-effort, não testável localmente".

## Secret REAL do webhook (Onda 4) — CONFIGURADO e VALIDADO

Dono registrou a URL do `mp-webhook` no painel "Webhooks" da aplicação (ambiente Teste) e configurou
o `MP_WEBHOOK_SECRET` real via `supabase secrets set` (nunca visto por mim). Achado crítico (bug de
unidade do timestamp, `ts` em segundos não milissegundos) corrigido no commit `c3ba5db` — confirmado
com pagamentos reais retornando 200 no painel do Mercado Pago depois do fix.

## Credenciais — todas configuradas pelo dono, nenhuma vista por mim em texto

**Teste (projeto E2E, `bgzcrovskjbktdxkhemd`)**:
- Public Key de teste: em `store_settings` (por loja) — pública por design do MP.
- Access Token de teste: secret de Edge Function (`MP_ACCESS_TOKEN`).
- Webhook secret de teste: secret de Edge Function (`MP_WEBHOOK_SECRET`).

**Produção (projeto `hvbcdxsagkjtfjwvnslo`, Onda 8)**:
- Public Key de produção: salva na aba Pagamento do Admin, loja `encanto`.
- Access Token de produção: secret de Edge Function (`MP_ACCESS_TOKEN`) — precisou de ativação prévia
  das "Credenciais de produção" no painel do Mercado Pago (formulário único: Setor/Site/privacidade/
  reCAPTCHA) antes de existir.
- Webhook secret de produção: secret de Edge Function (`MP_WEBHOOK_SECRET`) — configurado errado
  inicialmente (mesmo valor do Access Token, ver Onda 8 item "c"), corrigido e validado com pagamento
  real em 2026-09-10.

## Estado do git

**Onda 8 (piloto de produção, commits locais isolados e pushed nesta sessão, 2026-09-10)**:
```
9e6026a feat(pagamento-01): Pagar agora em 1o lugar + pre-preenche email do Pix pra cliente logado
0d1440b fix(checkout): divergencia de taxa presa ao trocar forma de pagamento/endereco depois do aviso
8a5e8b2 fix(pagamento-01): CSP bloqueava o Payment Brick em producao (tela branca) + timeout de seguranca
e2e17cc fix(checkout): create_order do storefront usa dbCliente (sessao real), nao db (sessao do Admin)
```
`b4ecbae` (legenda "pague na hora da entrega"/"sem taxa extra") e `87d0fb4` (REF-DELIVERY-FEE-05 Onda 5,
PIX na maquininha física custa igual cartão — achado do dono durante o piloto, tratado como REF
separada, ver `migrations/REF-DELIVERY-FEE-05-onda5-*`) também pushed, mas não são estritamente desta
REF. A correção do `MP_WEBHOOK_SECRET` (Onda 8 item "c") foi só configuração de secret + redeploy da
Edge Function — sem commit de código associado.

**Ondas 0-7 (2026-09-09)**:
```
eb6954b feat(pagamento-01): Onda 7 -- aba Pagamento no Admin (self-service), validado em navegador real
64e40df feat(pagamento-01): Onda 6 (parte 2) -- cartao online (Payment Brick completo), validado em navegador real
e6e2921 feat(pagamento-01): Onda 6 (parte 1) -- orders.payment_method reflete o metodo real (pix/cartao)
02bc8a3 feat(pagamento-01): Onda 5 -- Payment Brick (Pix) no frontend, validado em navegador real
e7e2dd7 feat(pagamento-01): Onda 5 (parte 1) -- RPCs client-facing p/ config e status de pagamento
59cbf7b docs(pagamento-01): checkpoint apos fix de timestamp -- webhook validado com secret real
c3ba5db fix(pagamento-01): unidade do timestamp na assinatura do webhook (segundos, nao ms)
14db132 feat(pagamento-01): Onda 3 -- criacao de cobranca real (E2E, sandbox Mercado Pago)
```
**PUSHED em 2026-09-09** (`3592718..eb6954b`, fast-forward, sem divergência com `origin/main`) — dono
autorizou explicitamente. Deploy automático na Vercel disparado pelo push.

**Migrations aplicadas em PRODUÇÃO em 2026-09-10** (Ondas 1 a 7, nesta ordem, dono autorizou
explicitamente após achado ao vivo: o Admin tentou salvar na aba Pagamento em produção e recebeu
`Could not find the function public.set_pagamento_config(...) in the schema cache` — nenhuma migration
desta REF tinha sido aplicada em produção até então, só no projeto E2E). Confirmado por introspecção
antes/depois: banco de produção estava 100% limpo desta REF antes (nenhuma tabela/função), as 7
migrations aplicaram sem erro, e a capability `get_pagamento_config` continuava `habilitada:false,
public_key:null` para as 2 lojas reais (`encanto`, `aquariosbar`) logo depois de aplicar — nada mudou
no comportamento real de nenhuma loja naquele momento, só a aba Pagamento do Admin passou a salvar de
verdade.

**Edge Functions e credenciais de PRODUÇÃO — LIGADAS (Onda 8, ver acima)**: `mp-criar-cobranca` e
`mp-webhook` deployadas no projeto de produção (`hvbcdxsagkjtfjwvnslo`), webhook registrado no painel
real do Mercado Pago, `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET`/Public Key de produção configurados pelo
dono. A loja `encanto` ligou a capability pra pilotar com pagamento real — cobrança real em produção
JÁ NÃO está mais bloqueada, está validada e funcionando (ver Onda 8). Nenhuma outra loja real ligou o
recurso ainda; o gap do Access Token global (ver "Próximo gate" abaixo) segue valendo pra qualquer loja
nova que ligar o pagamento online.

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
dependências instáveis).

**Onda 8 foi validada em PRODUÇÃO REAL, com dinheiro real**: dono fez 2 Pix reais de R$2,00 pra sua
própria conta Mercado Pago. O primeiro expôs o bug do `MP_WEBHOOK_SECRET` (dinheiro creditado, mas
pedido preso em `aguardando_pagamento` — ver Onda 8 acima); o segundo, já com o secret corrigido,
confirmou o ciclo completo funcionando: `payment_intents.status` `pendente` → `aprovado`
(`status_detail: 'accredited'`), `orders.status` → `recebido`, `application_logs` registrando a
transição via webhook. Único ponto ainda não confirmado visualmente pelo dono: o WhatsApp automático
pós-confirmação (o redirecionamento em si foi bloqueado como pop-up pelo navegador mobile, mas o pedido
foi confirmado e registrado corretamente — não depende do WhatsApp abrir).

Ainda NÃO validado: split/OAuth (fora do escopo até segunda ordem), boleto/carteira Mercado Pago (fora
do escopo, decisão consciente — não fazem sentido pro negócio hoje), qualquer LOJA além de `encanto`
com pagamento online ligado em produção.

## Próximo gate necessário

**Piloto de produção já está no ar e validado** (Onda 8) — não há mais gate bloqueando o fluxo técnico
em si. Itens em aberto, nenhum bloqueante:

- **Pendente de confirmação do dono**: se o preço do produto de teste (baixado pra testar pagamento
  real) já foi revertido ao valor normal.
- **Cosmético, não bloqueante**: em alguns navegadores mobile, o redirecionamento automático pro
  WhatsApp pós-pagamento é bloqueado como pop-up (já existe fallback com botão "Abrir WhatsApp
  novamente" — comportamento aceitável, não investigado a fundo ainda).
- **Pedidos de teste** com Pix real de valor baixo (R$2-58) ficaram no histórico da loja `encanto` —
  não foram limpos (decisão consciente, exige autorização separada pra apagar pedidos reais). Um deles
  (`a9c06490...`, R$2,00) tem dinheiro REAL confirmado na conta Mercado Pago do dono mas ficou
  `cancelado`/`expirado` no nosso banco — dono decidiu conscientemente não reconciliar manualmente
  (ver gap abaixo).

**Gap novo encontrado (não corrigido, baixo risco, documentado)**: `_transicao_payment_status_valida`
não permite `('expirado', 'aprovado')` — se o cliente demorar mais que os 15min da expiração interna
(`_expirar_payment_intents_pendentes`) pra confirmar um Pix, e o Mercado Pago só notificar a aprovação
DEPOIS desse cancelamento automático, o sistema recusa aplicar a confirmação (pedido já cancelado,
dinheiro já recebido, sem reconciliação automática). Foi exatamente o que aconteceu com o pedido
`a9c06490...` acima — a expiração interna rodou antes do fix do `MP_WEBHOOK_SECRET` chegar a tempo.
Caso real, baixo risco (janela de 15min é generosa pra Pix, que normalmente confirma em segundos), mas
vale considerar numa REF futura: permitir `('expirado', 'aprovado')` como transição válida (reabre o
pedido cancelado) ou, no mínimo, alertar o dono quando isso acontecer.

Gap real que segue aberto (documentado, não escondido): Access Token ainda é 1 segredo GLOBAL — uma
loja nova que ligar o pagamento online hoje manda o dinheiro pra MESMA conta Mercado Pago de sempre
(hoje, a conta do dono do Encanto). Resolver isso (cada loja com a própria conta, via Split/OAuth) é
escopo de uma REF futura separada, fora desta onda por decisão explícita do dono.
