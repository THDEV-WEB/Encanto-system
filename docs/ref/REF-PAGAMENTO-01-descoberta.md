# REF-PAGAMENTO-01 — Descoberta (fase de pesquisa/decisão)

**Status: DESCOBERTA CONCLUÍDA. PARADA NO GATE — não implementar sem decisão do dono.**

Executada de forma autônoma (autorização explícita do dono, 2026-09-05, madrugada) logo após o
fechamento de REF-MESA-02 (17/17 ondas) e a confirmação de que REF-CI-01/REF-OBS-01/REF-SENTRY-01
já estavam concluídas e em produção. Esta REF foi puxada porque era o único item do roadmap paralelo
(`docs adr` — ver `encanto-roadmap-paralelo-saas01` na memória) ainda sem dono, com prioridade ●●●
explícita, cuja fase de descoberta o próprio roadmap já classificava como "pode começar já".

**Regra desta execução**: só descoberta/auditoria — zero código de produto, zero migration, zero
alteração de schema/RPC/frontend/Edge Function, zero decisão de negócio nova. Nenhuma linha de
`src/`, `migrations/`, `supabase/functions/` foi tocada. O único artefato desta REF é este documento.

## Objetivo exato (preservado do roadmap, não reinterpretado)

Do artifact publicado 2026-08-08 ("Roadmap Paralelo — Encanto / VALION SISTEMAS"),
card **REF-PAGAMENTO-01 — Gateway de pagamento online — fase descoberta** (Grupo 1, prioridade ●●●):

> "Só a fase de pesquisa/decisão: comparar Mercado Pago/Asaas/Pagar.me para Pix automático e cartão
> online, mapear compliance e estimar custo por transação."

A fase de **implementação** (webhook de confirmação, novo status de pagamento em `orders`, split se
aplicável) é um card **separado**, no Grupo 2 ("✕ Espera SaaS"), explicitamente fora do escopo desta
noite — ver §D (Dependências) sobre por que essa condição de espera pode já ter mudado.

## A. Estado atual

O Encanto hoje é **100% pagamento presencial (COD — cash/card on delivery/pickup)**. Não existe,
em nenhum lugar do código, uma integração de gateway de pagamento online. `payment_method` é um
**campo declarativo** — a intenção do cliente, escolhida no formulário — nunca uma transação real
processada pelo sistema. Nenhum real (moeda) circula pelo Encanto hoje: o dinheiro/cartão troca de
mão fisicamente entre cliente e motoboy/caixa, fora do sistema.

- 4 valores oferecidos pelo frontend: `dinheiro` / `pix` / `cartao_debito` / `cartao_credito`
  (mesmos em `CheckoutPage.jsx:139-142` e `NovoPedidoMesaModal.jsx`, PIX aqui é só um rótulo — não
  gera QR code nem cobrança real).
- **Sem enum/CHECK constraint no banco** — `orders.payment_method` e `mesa_sessions.payment_method`
  são `text` livre. Confirmado como **decisão deliberada e documentada duas vezes** (não é um
  descuido): `create_order()` só valida não-vazio (`v_pay is null then raise exception`), e o
  comentário de `admin_fechar_conta_mesa` (`REF-MESA-02-onda11-fechar-conta.sql:22-26`) explicita
  "Não valida um enum fechado de formas de pagamento — mesmo padrão de create_order(), só checa
  não-vazio, o frontend é quem oferece as opções conhecidas".
- Cobre 3 modalidades com regras próprias: entrega (taxa de distância + maquininha + adicional de
  pagamento), retirada (tudo zerado, sem motoboy), mesa (mesmo cálculo de entrega/retirada por
  pedido individual, mais um fechamento agregado por sessão com sua própria forma de pagamento).

## B. O que já existe

**Frontend:**
- `CheckoutPage.jsx` — `form.pagamento` (state), campo "Troco para quanto?" só quando `dinheiro`
  (linha 374-377).
- `NovoPedidoMesaModal.jsx` — mesma constante `PAGAMENTOS` (dinheiro/pix/cartao_debito/
  cartao_credito), usada no formulário do garçom (REF-MESA-02 Onda 7).
- `src/utils/orderPayload.js::buildOrderArgs` — monta `order.payment_method` a partir do form; é a
  FONTE ÚNICA de montagem do payload (golden test `tests/checkout.golden.mjs`).
- `comandaModel.js:234-235` — `PAGAMENTO_LABEL[payment_method]`, com fallback pro valor cru se não
  reconhecido (nunca quebra por um valor inesperado — consistente com a ausência de enum).

**Backend (Supabase/Postgres):**
- `create_order()` (definição viva mais recente: `REF-MESA-02-onda6-abertura-implicita.sql:149-381`)
  grava `payment_method` como recebido do client, sem verificação de veracidade (não há como
  verificar — é COD).
- `_resolve_delivery_fee(p_store_id, p_retirada, p_payment_method, p_endereco_id)`
  (`REF-DELIVERY-FEE-05-onda3-3-resolve-fee-cache.sql:29`) usa `payment_method` só pra decidir
  **elegibilidade de taxa**, nunca pra processar pagamento:
  - `maquininha_fee`: só se `IN ('cartao_debito','cartao_credito')` E maquininha ativa no Admin.
  - `adicional_pagamento_fee` (REF-DELIVERY-FEE-05, R$2 default): só se
    `IN ('dinheiro','cartao_debito','cartao_credito')` — **nunca `pix`** (decisão de produto já
    tomada, PIX não aciona nenhum dos dois acréscimos).
  - Ambos os valores são **sempre recalculados do zero no servidor** — o que o client manda é só
    "advisory": se divergir do que o servidor calculou, `create_order()` recusa silenciosamente
    persistir e devolve `divergencia_valor:true` com os valores corretos (linha 287-294). Testado
    exaustivamente contra manipulação em `scripts/delivery-fee-04-onda2-test.mjs` (16 cenários,
    incluindo forjar `delivery_fee`/`maquininha_fee`/`adicional_pagamento_fee`/`total` isolados e
    combinados, endereço de outra loja, 2ª tentativa de adulteração após a 1ª ser recusada).
- `admin_fechar_conta_mesa(p_mesa_session_id, p_payment_method, p_store_id)`
  (`REF-MESA-02-onda11-fechar-conta.sql:126`) grava a forma REAL escolhida no fechamento da mesa —
  pode (e frequentemente vai) divergir do `payment_method` "declarado" em cada pedido individual da
  sessão (ex.: 3 pedidos declararam "pix" no meio da refeição, mas o grupo fechou pagando cartão) —
  isso é **intencional**, `valor_cobrado_snapshot` é auditoria de fechamento, nunca 2ª fonte de
  receita agregável (resolvido como R7 na REF-MESA-02 Onda 12: `admin_reports_summary` usa a forma
  do fechamento pra sessão fechada, não o valor operacional de cada pedido).
- Reconciliação: `SUM(orders.total)` é a ÚNICA fonte de faturamento em todos os relatórios — nunca
  soma `valor_cobrado_snapshot` nem nenhum campo de "forma de pagamento".
- `orders.total`/`delivery_fee`/`maquininha_fee` são `numeric(10,2)` desde REF-MONEY-SCALE-01 (fixou
  escala decimal, zero dado sujo encontrado em produção na auditoria daquela REF).

**O que NÃO existe (confirmado por busca ampla no repo inteiro):**
- Zero menção a Stripe/Mercado Pago/Asaas/Pagar.me/PagSeguro/Cielo/Getnet/Iugu/GerenciaNet/Efí em
  qualquer arquivo de código, migration ou Edge Function.
- Zero Edge Function de pagamento (as únicas Edge Functions do projeto são `route-distance` — cálculo
  de rota — e as de WhatsApp/notificação, nada de cobrança).
- Zero webhook receiver.
- Zero campo de status de pagamento (`orders.status` é só o status OPERACIONAL do pedido —
  recebido/preparando/etc. — nunca "pago"/"pendente"/"estornado").
- Troco: capturado só no client (`form.troco`), **nunca persistido no banco** — gap conhecido e já
  documentado (ADR REF-ORDER-01 §5, citado em `orderPayload.js:93`), não é novidade desta descoberta.

## C. O que falta (relativo ao objetivo comercial "cobrar de verdade online")

- Nenhuma cobrança real acontece — PIX no checkout é só um rótulo escolhido pelo cliente, sem QR
  code/copia-e-cola gerado, sem confirmação.
- Nenhum status de pagamento rastreável.
- Nenhum webhook/callback de confirmação de nenhum provedor.
- Nenhuma reconciliação automática entre "declarado" e "realmente recebido" — depende 100% de humano;
  só a Mesa tem um fechamento formal (`admin_fechar_conta_mesa`), entrega/retirada não têm nenhum
  "confirmar recebimento" equivalente.
- Nenhuma integração de gateway — zero SDK, zero secret, zero linha de código.

## D. Dependências

O card de implementação do roadmap (2026-08-08) citava como bloqueio: *"toca orders no mesmo domínio
que a [REF-SAAS-01] Onda 4 vai reescrever. Melhor nascer store_id-aware do que integrar duas vezes."*

**Achado desta descoberta: essa condição de espera não existe mais.** REF-SAAS-01 está concluída
(Ondas 0-6+7.1+8, ver memória `encanto-ref-saas-01-auditoria`) — `orders`/`create_order()` já são
100% `store_id`-aware, confirmado e reconfirmado exaustivamente ao longo de MESA-01/MESA-02
(multi-tenant, `resolve_store_from_origin()`, `default_store_id()`, tenant no JWT via
REF-AUTH-TENANT-01). Isso **não é autorização pra avançar pra implementação** — é só um fato técnico
que muda o cálculo de "quando" fica disponível para o dono decidir, registrado aqui para não ficar
esquecido na próxima vez que este roadmap for revisitado.

Outras dependências reais (não removidas):
- Escolha do gateway (saída desta própria descoberta, decisão do dono — ver §R).
- Decisão de modelo de cobrança da VALION sobre o Encanto/lojistas (REF-BILLING-01, backlog Grupo 3,
  nunca iniciada) — split automático de comissão só faz sentido se a VALION já decidiu SE/COMO vai
  cobrar dos lojistas.
- Cada lojista (tenant) precisaria abrir/aprovar uma subconta própria no provedor escolhido — atrito
  de onboarding real, não é "ligar uma configuração".

## E. Riscos

- **Risco atual (hoje, sem gateway): zero** — não há dinheiro real passando pelo sistema, logo não há
  superfície de fraude financeira online pra proteger.
- **Se avançar pra implementação**: qualquer gateway com split exige que a VALION opere como
  marketplace/subadquirente perante o provedor — isso traz responsabilidade regulatória adicional
  (KYC de cada lojista, retenção de dados bancários de terceiros, obrigações de compliance do próprio
  provedor) que hoje o Encanto não tem.
- **Achado de baixa severidade (não é vulnerabilidade explorável, é gap de integridade de dado)**:
  `payment_method` aceita qualquer string não-vazia — um client malicioso ou um bug de frontend
  poderia gravar um valor fora dos 4 conhecidos. Impacto real limitado: não afeta cálculo financeiro
  (`_resolve_delivery_fee` só reconhece 3 valores específicos nos `IN(...)`, qualquer coisa fora
  disso simplesmente não aciona nenhum acréscimo — fail-safe, não fail-open), só afeta a exibição no
  relatório/comanda (`comandaModel.js` já trata isso com fallback pro texto cru, não quebra).
  Documentado aqui pela primeira vez como observação, **não corrigido** (é comportamento deliberado
  e documentado 2x no próprio código, mudar isso é decisão de produto — trocar pra enum fechado
  quebraria a filosofia "frontend define as opções" atual, e retroagir dado existente é uma migration
  própria, fora do escopo de descoberta).

## F. Segurança

Auditoria específica pedida (quem pode criar/alterar, se é confiável, RLS/grants):

- **Quem pode criar/alterar `payment_method`**: só via `create_order()` (na criação, qualquer
  cliente/guest pode declarar qualquer um dos 4 valores — é escolha do cliente, não é segredo) e via
  `admin_fechar_conta_mesa()` (só admin da própria loja, `is_admin_of(p_store_id)` + `WHERE store_id`
  explícito, mesmo padrão fail-closed usado em toda a base). **Não existe nenhuma RPC que permita
  editar `payment_method` de um pedido já criado** (nem Admin) — é imutável após a criação, exceto
  pelo fechamento de mesa (que é uma agregação separada, não uma edição do pedido).
- **É confiável?** No sentido de "é isso que o cliente vai realmente pagar": não, e não precisa ser —
  é um modelo COD, o dinheiro/cartão troca de mão fisicamente e o operador vê na hora. No sentido de
  "o servidor confia cegamente nele pra calcular valores": só pra decidir elegibilidade de taxa
  (maquininha/adicional), nunca pro valor em si — testado exaustivamente contra forjamento
  (`delivery-fee-04-onda2-test.mjs`).
- **RLS/grants**: `create_order()` é `SECURITY DEFINER`, chamável por `anon`+`authenticated` (rota de
  guest checkout, esperado). `admin_fechar_conta_mesa()`:
  `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;` — confirmado
  correto, mesmo padrão gated por `is_admin_of` dentro do corpo. `_resolve_delivery_fee` e
  `_calcular_total_sessao_mesa` são funções internas (prefixo `_`), sem grant a ninguém — só
  chamadas de dentro de outras `SECURITY DEFINER`.
- **PII**: nenhum dado de pagamento sensível (número de cartão, CVV, chave PIX) é armazenado em
  lugar nenhum — só o rótulo da forma escolhida. Consistente com a auditoria da REF-SEC-DATA-01, que
  não encontrou (nem precisou tratar) nenhuma coluna de pagamento como PII — o achado se confirma
  aqui de novo, por busca direta na migration de hardening (`REF-SEC-DATA-01-harden-r9-r18-r19.sql`),
  zero menção a pagamento.
- **Troco**: nunca persistido — logo nunca exposto em nenhuma consulta futura (gap conhecido, ver §B).

**Nenhum achado crítico de segurança nesta descoberta.** O único item documentado (payment_method
sem enum) é uma observação de integridade de dado de baixa severidade, não uma vulnerabilidade.

## G. Impacto no banco (se avançar pra implementação — especificação, não execução)

- `orders` precisaria de um campo de status de pagamento separado do status operacional (ex.:
  `payment_status text` — pendente/pago/estornado/falhou) — hoje inexistente.
- Nova tabela de idempotência/auditoria de webhooks recebidos (evitar processar o mesmo evento 2x —
  todo gateway reenvia webhook em caso de timeout do lado do receptor).
- `orders.payment_method` provavelmente ganha um valor novo por gateway (ex.: `pix_online`,
  `cartao_online`) pra distinguir do COD atual — decisão de design, não uma obrigação.
- `mesa_sessions` não muda necessariamente — fechamento de mesa é presencial por natureza, cobrança
  online ali é uma decisão de produto separada (ver §K).

## H. Impacto no frontend (especificação, não execução)

- `CheckoutPage.jsx` precisaria de um fluxo pós-submit inteiramente novo (QR code / redirect /
  polling de confirmação) — hoje o submit vai direto pro WhatsApp automático (REF-CHECKOUT-02), essa
  UX muda estruturalmente se o pagamento passa a ser confirmado antes da confirmação do pedido.
- `NovoPedidoMesaModal.jsx` (garçom) provavelmente continua 100% COD — não faz sentido cobrar online
  no meio do consumo de uma mesa presencial, salvo se o produto quiser oferecer "pagar a conta pelo
  QR da mesa" no fechamento (decisão de produto separada, não assumida aqui).

## I. Impacto no backend (especificação, não execução)

- Nova Edge Function dedicada (webhook receiver) — precedente direto já existe no repo:
  `supabase/functions/route-distance/index.ts` (Edge Function isolada, chamada só de dentro do
  banco) é o mesmo padrão arquitetural a reaproveitar.
- `create_order()` ganharia um branch condicional pro fluxo online, ou (mais provável, pra não inchar
  uma função já grande) uma RPC nova dedicada à criação de cobrança — decisão de design de uma futura
  Onda 1/2, não desta descoberta.

## J. Impacto em Admin (especificação, não execução)

- `AdminPedidos.jsx` precisaria exibir o status de pagamento real (hoje só mostra o rótulo
  declarado).
- Nova aba/seção de configuração de gateway por loja (chave de API, ativar/desativar) — mesmo padrão
  já usado por `AdminTaxaEntrega.jsx` (maquininha/adicional de pagamento configuráveis por loja hoje).

## K. Impacto em Mesa

`admin_fechar_conta_mesa` já centraliza o fechamento de conta — se cobrança online algum dia entrar
pra Mesa, essa RPC é o ponto natural de integração (fechar = cobrar de verdade). **Fora de escopo
desta descoberta** — não assumido como decidido, só registrado como observação arquitetural.

## L. Impacto financeiro

Comparativo levantado nesta descoberta (dados públicos de mercado, 2026 — sujeitos a mudança,
confirmar direto com cada provedor antes de qualquer decisão final):

| Provedor | Pix (checkout online) | Cartão de crédito | Cartão de débito | Split nativo via API | Observação |
|---|---|---|---|---|---|
| **Mercado Pago** | 0% no Checkout online (0,49% com maquininha/QR físico; CNPJ com faturamento ≥R$15k/mês tem Pix a 0,49%) | 4,98% à vista / 3,98% em 30 dias | 1,99% | Sim — percentual ou valor fixo, taxas descontadas em cascata (plataforma → marketplace → vendedor) | Solução de split mais madura/documentada das 3 |
| **Asaas** | Até 0,99% (taxa máxima) | 2,99%–4,99% | (incluso na faixa de cartão) | Sim — subcontas via API, percentual sobre valor líquido ou fixo | Sem mensalidade; boleto R$1,99–3,49 se quiser oferecer |
| **Pagar.me (Stone)** | Sem taxa de transação mencionada nas fontes públicas consultadas | Variável por bandeira/parcelamento — número exato não publicado, requer contato comercial | Variável por bandeira | Sim — subcontas com dados bancários, paga direto na conta do lojista sem esse precisar ter conta própria no provedor | Split operacionalmente mais simples (lojista não precisa criar conta), mas taxas de cartão não avaliáveis sem contato direto |

Compliance/KYC (comum aos 3): a conta-mãe (VALION) precisa ser CNPJ para operar split/marketplace;
cada lojista (subconta/recebedor) precisa cadastrar CPF/CNPJ + dados bancários, sujeitos a aprovação/
análise de risco do provedor — não é automático, tem fila de aprovação humana do lado do provedor.

Nenhum dos 3 foi contatado comercialmente nesta descoberta (fora do escopo de uma pesquisa
autônoma noturna) — os números acima vêm de páginas públicas de preço/blog, não de proposta
comercial negociada.

*Sources: [Mercado Pago — quanto custa vender online](https://www.mercadopago.com.br/blog/quanto-custa-vender-on-line-com-mercado-pago) · [Mercado Pago — Pix e QR](https://www.mercadopago.com.br/blog/quanto-custa-receber-pagamentos-via-pix-e-codigo-qr) · [Mercado Pago — Split de pagamento](https://www.mercadopago.com.br/blog/split-de-pagamento-dividir-comissoes-automaticamente) · [Asaas — API de pagamentos](https://www.asaas.com/api-de-pagamentos) · [Asaas — Split de pagamentos](https://blog.asaas.com/split-de-pagamento/) · [Asaas — Criação de subcontas](https://docs.asaas.com/docs/criacao-de-subcontas) · [Pagar.me/Stone — tarifa do Pix](https://www.pagar.me/blog/tarifa-do-pix) · [Central de Ajuda Stone — Split para marketplace](https://pagarme.helpjuice.com/pt_BR/p1-funcionalidades/marketplace-como-funciona-o-split-de-pagamentos)*

## M. Testes necessários (se avançar pra implementação — especificação)

- Idempotência de webhook (reentrega/replay do mesmo evento não deve processar 2x).
- Verificação de assinatura/autenticidade do webhook (evitar que qualquer request externo forje uma
  confirmação de pagamento — este seria o achado crítico de segurança real de uma futura
  implementação, não existe hoje porque não existe webhook).
- Concorrência: 2 webhooks quase simultâneos pro mesmo pedido.
- Sandbox de cada gateway testado ponta a ponta antes de qualquer produção (mesmo padrão de rigor já
  usado em REF-SENTRY-01 — validar com evidência real, não suposição).

## N. Ondas propostas (SE o dono decidir avançar — estrutura NÃO vinculante, baseada no que foi encontrado)

- **Onda 0 — esta descoberta.** ✅ Concluída.
- **Onda 1** — decisão humana: qual gateway, modelo de split/comissão da VALION, timing. (fora do meu
  alcance, ver §R)
- **Onda 2** — fundação de schema: `payment_status`, tabela de idempotência/webhooks.
- **Onda 3** — Edge Function de integração (criar cobrança + receiver de webhook + verificação de
  assinatura).
- **Onda 4** — frontend: novo fluxo de checkout online (mantendo COD como opção sempre disponível).
- **Onda 5** — segurança: testes adversariais dedicados (forjar webhook, replay, race condition).
- **Onda 6** — regressão completa + documentação.
- **Onda 7** — piloto controlado (1 loja, período limitado) antes de qualquer rollout geral.

## O. Critérios de aceite (para uma futura fase de implementação, quando/se autorizada)

- COD continua funcionando 100% como hoje — pagamento online é aditivo, nunca obrigatório.
- Nenhum pedido "confirmado como pago" sem webhook validado por assinatura.
- Reconciliação automática bate 100% com `SUM(orders.total)` (mesma fonte única de sempre).
- Zero regressão nas 3 modalidades existentes (entrega/retirada/mesa) e na suíte completa já existente
  (checkout.golden, deliveryFee.golden, comanda.golden, delivery-fee-04, money-scale-01, mesa-01/02).

## P. Rollback

- **Nesta fase (descoberta)**: nada a reverter — nenhum código, schema ou configuração foi alterado.
- **Fase de implementação (futura, hipotética)**: manter COD como fallback permanente é o próprio
  mecanismo de rollback de produto — nunca uma migration precisaria "desfazer" a possibilidade de
  pagar na entrega.

## Q. Dependências externas

- Conta empresarial (CNPJ da VALION) no provedor escolhido.
- Aprovação de KYC de cada lojista que quiser aceitar pagamento online (processo do provedor, fora do
  controle do Encanto).
- Nenhuma credencial/secret foi solicitada, criada ou usada nesta descoberta.

## R. O que exige decisão humana (nada disto foi decidido aqui)

1. **Qual gateway** — Mercado Pago (split mais maduro, Pix no checkout online gratuito, cartão mais
   caro), Asaas (taxas competitivas, sem mensalidade), Pagar.me/Stone (split mais simples
   operacionalmente, mas taxas de cartão não avaliadas), ou outro não pesquisado.
2. **Se a VALION vai operar como marketplace (split automático entre lojistas)** ou se cada lojista
   integraria sua própria conta — isso muda decisivamente a complexidade de compliance.
3. **Modelo de monetização da VALION sobre isso** — comissão por transação? Mensalidade? Nada por
   enquanto (só oferece a conveniência ao lojista)? Depende de REF-BILLING-01, ainda não iniciada.
4. **Timing** — o bloqueio original do roadmap (esperar SAAS-01 Onda 4) não existe mais tecnicamente,
   mas isso não é uma recomendação para começar agora — é só um fato que remove um "não pode" técnico,
   a decisão de prioridade continua 100% do dono.
5. **Se vale a pena fechar o gap do troco não-persistido** (§B) independentemente de gateway — é uma
   REF pequena e separada, não teria nenhuma dependência de gateway escolhido.

## Achados-chave desta descoberta (resumo executivo)

1. Sistema é 100% COD hoje — zero gateway, zero cobrança real, zero risco financeiro online (porque
   não existe online).
2. `payment_method` sem enum é decisão deliberada e documentada 2x no código, não um bug — só
   registrado aqui pela primeira vez como observação de baixa severidade.
3. Já existe defesa robusta e testada contra forjamento de VALORES (delivery_fee/maquininha_fee/
   adicional_pagamento_fee/total) — a fundação financeira já é sólida, o que falta é especificamente
   a peça "gateway real", não hardening do que já existe.
4. **O bloqueio de dependência citado pelo roadmap (esperar SAAS-01 Onda 4) já foi resolvido** — SAAS-01
   está concluída, `orders` já é store_id-aware. Vale re-visitar essa condição na próxima revisão do
   roadmap com o dono.
5. Comparativo de 3 gateways levantado com dados públicos — Mercado Pago tem o split mais maduro/
   documentado, Asaas tem as taxas mais competitivas publicadas, Pagar.me tem o split operacionalmente
   mais simples mas taxas de cartão não avaliáveis sem contato comercial direto.
