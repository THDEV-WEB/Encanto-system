# REF-PAGAMENTO-01 — CHECKPOINT (ler primeiro numa nova sessão/retomada)

**STATUS: Onda 0 (auditoria) + Onda 1 (schema) + Onda 2 (webhook fundação) + Onda 3 (cobrança real) +
Onda 4 (webhook real) + Onda 5 (Payment Brick/Pix no frontend, VALIDADO EM NAVEGADOR REAL)
CONCLUÍDAS e commitadas. Split/OAuth/cartão online/produção seguem fora do escopo até autorização
explícita.**

**Atualizado:** 2026-09-09, após commit `02bc8a3` (Onda 5). Execução autônoma autorizada pelo dono.
Hard constraints seguem valendo: nunca produção, nunca push sem autorização explícita do gate, 1
commit por onda com `git add` explícito, nunca tocar arquivo de outra sessão.

## Onda 5 — Payment Brick (Pix) no frontend, checkout real testado com o dono

**Escopo desta onda: só Pix online.** Cartão online fica para uma onda futura — não por causa da
antiga preocupação de taxa de maquininha vazando (isso já se resolveu sozinho, `_resolve_delivery_fee`
usa lista de permissão, qualquer `payment_method` novo cai em R$0 de taxa extra automaticamente, sem
precisar mexer em nada da REF-DELIVERY-FEE-05) — só para não somar a complexidade do formulário de
cartão do Brick nesta primeira validação real.

**O que foi construído:**
- Capability `pagamento_online_habilitada` (opt-in por loja, default desligado — nenhuma loja ganha
  isso sem configurar) + `mp_public_key` gravados em `store_settings` (RPC `get_pagamento_config`,
  Onda 5 backend).
- "Pix agora" como 5ª opção de pagamento no checkout, só aparece quando a loja liga a capability. COD
  continua 100% disponível e é o default sempre.
- Pedido nasce `aguardando_pagamento` (não `recebido`) quando pago online — `buildOrderArgs` ganhou um
  override opcional (`extra.status`), `create_order()` **não foi alterado** (já aceitava esse campo
  desde sempre, achado confirmado já na Onda 0).
- `PagamentoPixPage.jsx`: Brick só coleta e-mail/CPF do pagador (customization restringe a
  `bankTransfer`) — o QR Code e a tela de espera são **tela própria** (não dependem do Brick
  renderizar isso sozinho), com polling em `consultar_status_pagamento` até `aprovado`.
- **WhatsApp/SuccessPage só disparam DEPOIS da confirmação real do pagamento** — nunca antes, para a
  loja não começar a preparar um pedido que pode nunca ser pago (Pix pode expirar sem ser escaneado).
- `mp-criar-cobranca` (Onda 3) ganhou o campo `pix` na resposta (`qr_code`/`qr_code_base64`/
  `ticket_url`) — necessário para o frontend renderizar o QR, não existia antes desta onda.

## 3 achados reais — API de inicialização do Payment Brick rejeitava `'none'`

Testando ao vivo com o dono no navegador (Edge, modo E2E — nunca produção), 3 rodadas de erro 422
consecutivas: `creditCard`/`debitCard`/`prepaidCard`/`ticket` **não aceitam a string `'none'`** — só
`'all'` ou uma lista de opções específicas (ex.: "options for (credit_card): amex, elo, master,
visa"). **Lista vazia (`[]`) é a forma correta de desabilitar** esses campos — `mercadoPago` (saldo
da carteira) foi o único campo realmente booleano que aceitou `'none'` sem erro. Documentação oficial
do Mercado Pago (fetchada durante o planejamento) mostrava `'none'` como válido para todos — não bate
com o comportamento real observado, por isso a importância de ter testado ao vivo em vez de confiar
só na doc.

## Validação real de ponta a ponta (com o dono, ao vivo)

Pedido criado no checkout → Brick coletou e-mail → QR Pix **real** gerado (copia-e-cola genuíno do
Mercado Pago, valor batendo com o carrinho) → aprovação simulada via banco (mesma função interna que
o webhook usaria) → **polling detectou sozinho, sem reload** → tela de sucesso + WhatsApp abriram
automaticamente. `orders.status='recebido'`/`payment_status='aprovado'` confirmados no banco depois.
Dados de teste (4 pedidos + 1 cliente + a capability temporária) limpos da loja `encanto`
compartilhada do E2E ao final — capability voltou ao padrão desligado (mesma convenção já usada por
`mesa_habilitada`, que também fica off por padrão no fixture compartilhado).

## CSP (vercel.json) — best-effort, não testável localmente

Liberado `sdk.mercadopago.com` (script), `*.mercadopago.com`/`*.mlstatic.com` (connect/img/frame) —
baseado no que o Brick de fato carregou durante o teste real (`http2.mlstatic.com` confirmado via
DevTools). CSP só é aplicado pelo Vercel em produção/preview (dev local não aplica) — **não foi
possível validar esta lista de verdade**, pode precisar de ajuste fino quando a REF chegar no gate de
deploy real.

## Secret REAL do webhook (Onda 4) — CONFIGURADO e VALIDADO

O dono registrou a URL `https://bgzcrovskjbktdxkhemd.supabase.co/functions/v1/mp-webhook` no painel
"Webhooks" da aplicação (ambiente Teste) e configurou o `MP_WEBHOOK_SECRET` real via
`supabase secrets set` (nunca visto por mim). Achado crítico (bug de unidade do timestamp, `ts` em
segundos não milissegundos) encontrado e corrigido no commit `c3ba5db` — confirmado com 2 pagamentos
reais retornando 200 no painel do Mercado Pago depois do fix.

## Credenciais de teste do Mercado Pago — todas em uso

- **Public Key de teste**: gravada em `store_settings` (por loja, via `mp_public_key`) — pública por
  design do MP, sem risco.
- **Access Token de teste**: secret de Edge Function (`MP_ACCESS_TOKEN`), projeto E2E.
- **Webhook secret real**: secret de Edge Function (`MP_WEBHOOK_SECRET`), projeto E2E.
- Nenhuma dessas três foi vista por mim em texto — só os hashes que o CLI mostra, ou (no caso da
  Public Key) o próprio valor porque é seguro por design.

## Estado do git
```
02bc8a3 feat(pagamento-01): Onda 5 -- Payment Brick (Pix) no frontend, validado em navegador real
e7e2dd7 feat(pagamento-01): Onda 5 (parte 1) -- RPCs client-facing p/ config e status de pagamento
59cbf7b docs(pagamento-01): checkpoint apos fix de timestamp -- webhook validado com secret real
c3ba5db fix(pagamento-01): unidade do timestamp na assinatura do webhook (segundos, nao ms)
fbba06e docs(pagamento-01): checkpoint apos Onda 4 -- webhook receiver real validado
1e8b438 feat(pagamento-01): Onda 4 -- webhook receiver real (Edge Function publica, sandbox MP)
14db132 feat(pagamento-01): Onda 3 -- criacao de cobranca real (E2E, sandbox Mercado Pago)
```
Todos em `origin/main` até `3592718` (reconciliados, ver histórico anterior deste doc); os commits
mais recentes (a partir de `14db132`) ainda são **locais**, aguardando o mesmo gate de reconciliação
já estabelecido — nenhum push sem autorização explícita.

## Reconciliação de histórico (contexto de sessões anteriores, não repetido aqui)

Ver revisões anteriores deste arquivo no git log — resumo: outra sessão fez rollout de produção da
REF-DELIVERY-FEE-05 e replantou os commits desta REF por cima do `origin/main` atualizado, com
autorização direta do dono. `main` local está idêntica a `origin/main` até esse ponto, nenhum
trabalho foi perdido (verificado por patch-id).

## Testes executados e resultados (acumulado)
- Onda 1: 20/20. Onda 2: 29/29. Onda 3 A+B: 19/19. Onda 5 config/status: 7/7.
- Onda 3/4 "chamada real" (scripts dedicados): validados quando escritos, hoje presos a secrets já
  substituídos (documentado nos próprios scripts) — a validação real atual vem do teste manual desta
  Onda 5 e do painel do Mercado Pago (200 nos webhooks).
- `test:domain` limpo, lint 60 warnings pré-existentes (0 novo, 0 erro), build limpo.
- Pin do golden de checkout (`tests/checkout.golden.mjs`) atualizado conscientemente para refletir o
  override opcional de `status`.

## O que foi REALMENTE validado (vs. simulado) — atualizado

**Esta é a primeira onda com validação real em NAVEGADOR** (não só scripts Node): criação de pedido,
Payment Brick, geração de QR Pix real, e confirmação automática via polling — tudo testado ao vivo
pelo dono, com achados reais corrigidos na hora (os 3 erros 422 do Brick). Ainda NÃO validado: cartão
online (fora do escopo desta onda), split/OAuth (fora do escopo até segunda ordem), qualquer coisa em
produção (bloqueado, gate separado).

## Próximo gate necessário

Decisão do dono: (1) autorizar cartão online (Payment Brick completo) como próxima onda, (2) decidir
sobre o gate de reconciliação/push que segue pendente desde a Onda 3, ou (3) considerar a REF pronta
para uma avaliação de piloto controlado em produção (Onda 6 do plano original — ainda bloqueada por
padrão, precisa de autorização explícita separada e nova).
