# REF-BILLING-01 — Descoberta (fase de alinhamento/decisão)

**Status: ALINHAMENTO EM ANDAMENTO. Nenhum código, schema, RPC ou dado de produção foi alterado.**
Pedido explícito do dono (2026-09-12): "não implemente nada ainda, só vamos alinhar um plano super
profissional" — este documento é 100% especificação, produzido ANTES de qualquer trabalho técnico,
seguindo o mesmo padrão de descoberta já usado por [[encanto-ref-pagamento-01-descoberta|REF-PAGAMENTO-01]]
antes de qualquer código real ser escrito.

## Objetivo exato

Cobrar mensalidade das lojas que usam a plataforma VALION/Encanto — fecha o ciclo comercial que falta:
hoje já existe captação de loja nova (onboarding), operação completa (cardápio/pedidos/Mesa/fidelidade)
e até processamento de pagamento pro CLIENTE FINAL da loja pagar online (Mercado Pago, ao vivo). Falta
especificamente a peça que faz VALION virar um SaaS de verdade — cobrar a PRÓPRIA loja por estar na
plataforma. Ver [[encanto-visao-produto-comercial]] (Encanto deixou de ser portfólio, objetivo é vender
como SaaS real).

**Decisão explícita, não-negociável nesta rodada**: modelo é mensalidade (SaaS puro), NUNCA comissão/
fatia de cada pedido do cliente final. A loja fica com 100% do que o cliente dela paga.

## A. Estado atual (o que já existe e esta REF reaproveita)

- **REF-SAAS-01** (fundação multi-tenant, concluída): tabela `stores` (id/slug/nome/dominio/status/
  created_at), tabela `admins` (user_id ↔ store_id), função `is_admin_of(store_id)` — o gate central
  reaproveitado por praticamente TODA RPC admin-facing do sistema hoje. Onda 8 acrescentou
  `provision_store`/`link_store_admin` + conceito de "admin da plataforma" (`is_admin_anywhere`,
  distinto de admin de uma loja específica).
- **`stores.status` já tem um CHECK pronto**: `ativo | suspenso | cancelado` (confirmado por
  introspecção em produção, 2026-09-12). Hoje só `'ativo'` é usado de verdade — `'suspenso'`/
  `'cancelado'` existem no schema mas NUNCA são setados por nenhum fluxo real ainda. 7 funções no banco
  já checam `status = 'ativo'` antes de agir (a maioria no caminho de pedido/mesa do storefront, não no
  Admin).
- **Platform Console** (REF-SAAS-02): tela separada do Admin de cada loja, onde o dono (super admin) já
  vê todas as lojas da plataforma — lugar natural pra uma futura aba "Faturamento".
- **Onboarding de loja nova** (REF-STORE-ONBOARD-01/02): fluxo de trazer loja nova pra plataforma já
  existe e está em produção.
- **REF-PAGAMENTO-01** (concluída, ao vivo): Mercado Pago já integrado (Payment Brick, Edge Functions
  `mp-criar-cobranca`/`mp-webhook`) — hoje cobra só o CLIENTE FINAL da loja. Tecnicamente reaproveitável
  no futuro pra cobrar a própria loja (cobrança recorrente/assinatura é uma API diferente da usada
  hoje), mas o dono decidiu NÃO usar isso na primeira versão (ver decisão B.2).

## B. Decisões já tomadas (dono, 2026-09-12)

1. **Modelo de preço: mensalidade única.** Mesmo valor fixo pra toda loja nova, acesso completo a tudo
   (cardápio, pedidos, Mesa/QR, pagamento online, fidelidade) — sem planos por funcionalidade nesta
   primeira versão.
2. **Cobrança: manual/semi-manual pra começar.** O dono manda a cobrança (ex. Pix) por fora do sistema;
   o sistema só precisa de um jeito de marcar "esta loja pagou" e controlar o vencimento. Automação
   (cobrança recorrente de verdade) fica pra uma fase futura, só depois de validar o modelo com lojas
   reais.
3. **Inadimplência: período de carência, depois bloqueia o Admin** da loja (painel de gestão fica
   inacessível pro dono da loja). Ainda EM ABERTO se a vitrine (storefront) da loja continua no ar pro
   cliente final durante o bloqueio — ver H.3.
4. **Lojas atuais (Encanto, Aquários Bar) ficam de fora, de graça.** São piloto/do próprio dono — só
   lojas NOVAS entram no modelo pago.
5. **Nunca comissão por pedido** — reforçado, é regra dura desta REF.

## C. O que falta construir (visão geral, alto nível)

- Uma forma de guardar, por loja, o status da assinatura (em dia / carência / bloqueada / isenta) e a
  data do próximo vencimento.
- Uma forma do dono (admin da PLATAFORMA, não da loja) marcar "recebi o pagamento desta loja".
- Um gate que de fato bloqueia o Admin da loja inadimplente, sem precisar caçar e proteger RPC por RPC.
- Um job periódico que aplica a carência e o bloqueio automaticamente quando o vencimento passa.
- Avisos de transparência pro dono da loja ANTES do bloqueio (nunca bloqueio-surpresa) — mesmo espírito
  já usado no aviso de "configuração padrão" do onboarding.

## D. Modelo técnico proposto (especificação, NÃO execução)

**Nova tabela `store_subscriptions`** (nome provisório, 1:1 com `stores`): `store_id` (FK), `status`
(`em_dia` | `carencia` | `bloqueada` | `isenta` — `isenta` cobre Encanto/Aquários Bar), `proximo_vencimento`
(date), `dias_carencia` (int — configurável, provavelmente global no início), `marcado_pago_em`/
`marcado_pago_por` (auditoria de quem confirmou o pagamento manual e quando).

**RPCs novas** (nomes provisórios):
- `platform_marcar_mensalidade_paga(store_id, proximo_vencimento)` — só quem é admin da PLATAFORMA
  (reaproveita o mesmo gate `is_admin_anywhere` da Onda 8 do SAAS-01, não `is_admin_of` de uma loja só).
- `get_billing_status(store_id)` — o próprio Admin da loja consulta seu status/vencimento (pro banner
  de aviso).

**Gate de bloqueio — o ponto mais importante tecnicamente**: em vez de proteger RPC por RPC, a proposta
é `is_admin_of()` ganhar uma checagem adicional e aditiva — se a assinatura da loja está `bloqueada`,
toda RPC que já depende de `is_admin_of` (é a esmagadora maioria das ações administrativas do sistema
hoje) passa a recusar automaticamente. Reaproveita TODA a superfície de proteção já existente, sem
caçar função por função — mesmo espírito arquitetural de toda REF anterior deste projeto (capability
opt-in, ponto único de verdade).

**Cron**: um novo job pg_cron (mesmo padrão já usado por REF-ORDER-01/REF-PAYMENT-SEC-02 Onda 6, Vault
pra segredo se precisar) rodando 1x/dia: passa lojas vencidas pra `carencia`, e as que estouraram os
`dias_carencia` pra `bloqueada`.

## E. Impacto no Admin / Platform Console

- **Platform Console**: nova aba "Faturamento" — lista de todas as lojas com vencimento/status e botão
  "marcar como pago".
- **Admin de cada loja**: banner discreto de aviso quando o vencimento está próximo ou já em carência
  (transparência antes do bloqueio).
- **Loja com Admin bloqueado**: mensagem clara ("mensalidade pendente, entre em contato") no lugar do
  painel normal — nunca uma tela de erro genérica/confusa.

## F. Segurança

- `platform_marcar_mensalidade_paga` só pode ser chamada por admin da PLATAFORMA — nunca por um admin
  de loja comum (evitaria a própria loja se auto-declarar em dia).
- Bloqueio nunca apaga/afeta dado existente (pedidos, histórico, catálogo continuam intactos) — só a
  CAPACIDADE de agir no Admin é que para, e só depois da carência.

## G. O que fica fora do escopo por ora (decisão do dono)

- Cobrança automática/recorrente via Mercado Pago — fase futura, só após validar o modelo manual.
- Planos por funcionalidade (Básico/Pro) — só mensalidade única por enquanto.
- Cobrar % de cada pedido do cliente final — nunca, regra dura.
- Encanto/Aquários Bar entrarem no modelo pago — ficam isentas.

## H. Perguntas ainda em aberto (precisam de decisão do dono antes de qualquer implementação)

1. **Valor da mensalidade** (R$ quanto?) — decisão comercial, não técnica, não posso sugerir sozinho.
2. **Duração da carência** (quantos dias entre o vencimento e o bloqueio de fato)?
3. Quando o Admin é bloqueado, **a vitrine da loja continua no ar** pro cliente final continuar
   pedindo normalmente (só o DONO da loja fica sem conseguir mexer no painel), ou o sistema também
   para de aceitar pedido novo? (Sua resposta foi "bloqueia o Admin" — confirmando que entendi certo:
   loja continua vendendo, só sem o dono conseguir gerenciar?)
4. Vencimento em data fixa (ex. todo dia 5 de cada mês) ou "30 dias corridos a partir da última vez que
   pagou"?
5. Existe **período de teste grátis** pra loja nova antes da primeira cobrança (ex. 15-30 dias), ou já
   nasce no ciclo de cobrança desde o primeiro dia?
6. O aviso de vencimento próximo é só visual dentro do Admin, ou também dispara WhatsApp/e-mail pro
   dono da loja (reaproveitando a infra de notificação que já existe pra pedidos)?

## I. Ondas propostas (SE o dono decidir avançar — estrutura NÃO vinculante, só pra dar noção de tamanho)

- Onda 1: schema (`store_subscriptions`) + RPCs de leitura/marcar-pago + gate aditivo em `is_admin_of`.
- Onda 2: cron de carência/bloqueio automático.
- Onda 3: UI no Platform Console (lista de lojas + marcar como pago).
- Onda 4: UI no Admin de cada loja (banner de aviso/vencimento).
- Onda 5 (futura, não agora): automação de cobrança via Mercado Pago recorrente.

## Resumo executivo

A plataforma já tem toda a base técnica pronta (multi-tenant, onboarding, gateway de pagamento já
validado com dinheiro real) pra suportar cobrança de mensalidade das lojas — falta só essa peça
específica, que é mais decisão de negócio do que desafio técnico. O dono já definiu 4 dos 5 pilares
(mensalidade única, cobrança manual pra começar, carência+bloqueio do Admin, lojas piloto isentas).
Restam 6 perguntas pontuais (seção H, principalmente valor e regras finas de prazo) antes de qualquer
implementação começar. Tecnicamente, a peça mais elegante da proposta é reaproveitar `is_admin_of()`
como ponto único de bloqueio — zero necessidade de proteger dezenas de RPCs uma por uma.
