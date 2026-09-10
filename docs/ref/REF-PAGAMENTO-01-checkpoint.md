# REF-PAGAMENTO-01 — CHECKPOINT (ler primeiro numa nova sessão/retomada)

**STATUS: Onda 0 (auditoria) + Onda 1 (schema) + Onda 2 (webhook fundação) + Onda 3 (cobrança real) +
Onda 4 (webhook real) + Onda 5 (Payment Brick/Pix no frontend) + Onda 6 (cartão online, Payment Brick
completo) CONCLUÍDAS e commitadas — TODAS VALIDADAS EM NAVEGADOR REAL com o dono. Split/OAuth/
produção seguem fora do escopo até autorização explícita.**

**Atualizado:** 2026-09-10, após commit `64e40df` (Onda 6). Execução autônoma autorizada pelo dono.
Hard constraints seguem valendo: nunca produção, nunca push sem autorização explícita do gate, 1
commit por onda com `git add` explícito, nunca tocar arquivo de outra sessão.

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
64e40df feat(pagamento-01): Onda 6 (parte 2) -- cartao online (Payment Brick completo), validado em navegador real
e6e2921 feat(pagamento-01): Onda 6 (parte 1) -- orders.payment_method reflete o metodo real (pix/cartao)
02bc8a3 feat(pagamento-01): Onda 5 -- Payment Brick (Pix) no frontend, validado em navegador real
e7e2dd7 feat(pagamento-01): Onda 5 (parte 1) -- RPCs client-facing p/ config e status de pagamento
59cbf7b docs(pagamento-01): checkpoint apos fix de timestamp -- webhook validado com secret real
c3ba5db fix(pagamento-01): unidade do timestamp na assinatura do webhook (segundos, nao ms)
14db132 feat(pagamento-01): Onda 3 -- criacao de cobranca real (E2E, sandbox Mercado Pago)
```
Todos em `origin/main` até `3592718` (reconciliados, ver histórico git anterior deste doc para
detalhes); os commits a partir de `14db132` ainda são **locais**, aguardando o mesmo gate de
reconciliação já estabelecido — nenhum push sem autorização explícita.

## Testes executados e resultados (acumulado)
- Onda 1: 20/20. Onda 2: 29/29. Onda 3 A+B: 19/19. Onda 5 config/status: 7/7. Onda 6 payment_method: 7/7.
- `test:domain` limpo, lint 60 warnings pré-existentes (0 novo, 0 erro), build limpo em todas as ondas.
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
(2) considerar a REF pronta para uma avaliação de piloto controlado em produção (Onda 7 do plano —
ainda bloqueada por padrão, precisa de autorização explícita separada e nova). Tecnicamente, o
fluxo completo (Pix + cartão) já está validado ponta a ponta em ambiente de teste.
