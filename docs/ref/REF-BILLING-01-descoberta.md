# REF-BILLING-01 — Descoberta (fase de alinhamento/decisão)

**Status: ALINHAMENTO CONCLUÍDO (2026-09-12) — 16/16 decisões de negócio fechadas, zero pergunta
comercial em aberto. Nenhum código, schema, RPC ou dado de produção foi alterado ainda; aguardando
autorização específica e separada pra iniciar a implementação (Onda 1).**
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
2. **Cobrança: ASSISTIDA/MANUAL na V1** (refinado em 2026-09-12 — substitui a ideia anterior de "manual
   puro"). O pagamento em si continua manual (a loja paga por fora do sistema, ex. Pix), mas o CONTROLE
   FINANCEIRO passa a ser sistematizado pelo próprio sistema. Diferença conceitual:
   - **Manual puro** (descartado): "eu mando um Pix pelo WhatsApp e depois entro no sistema e marco que
     pagou" — sistema não sabe de nada até a marcação manual.
   - **Cobrança assistida** (decidido): o sistema possui a mensalidade, valor, vencimento, dados de
     pagamento, status, histórico, confirmação, auditoria e próximo vencimento — só o RECEBIMENTO do
     dinheiro em si continua manual.

   Fluxo V1 desejado:
   1. VALION (Platform Admin) gera/abre a mensalidade da loja.
   2. Sistema registra o valor devido.
   3. Sistema registra o vencimento (ver B.6, vencimento configurável por loja).
   4. Sistema disponibiliza/exibe os dados de pagamento/Pix definidos pela VALION pra essa cobrança.
   5. Loja realiza o pagamento fora do sistema.
   6. Platform Admin confirma que recebeu o pagamento.
   7. Sistema registra a confirmação.
   8. Sistema registra quem confirmou e quando.
   9. Sistema calcula/registra o próximo vencimento.
   10. Sistema controla automaticamente: status da mensalidade, vencimento, carência, inadimplência,
       bloqueio do Admin.

   Automação (cobrança recorrente de verdade via gateway) fica fora da V1 — ver seção "Evolução
   planejada (V1→V2→V3)" mais abaixo.
3. **Inadimplência: período de carência, depois bloqueia o Admin** da loja (painel de gestão fica
   inacessível pro dono da loja). Ainda EM ABERTO se a vitrine (storefront) da loja continua no ar pro
   cliente final durante o bloqueio — não presumir, ver H.3.
4. **Lojas atuais (Encanto, Aquários Bar) ficam de fora, de graça.** São piloto/do próprio dono — só
   lojas NOVAS entram no modelo pago. (Preservada sem alteração.)
5. **Nunca comissão por pedido** — reforçado, é regra dura desta REF. A VALION não recebe comissão nem
   percentual sobre os pedidos dos clientes finais; a loja fica com 100% do valor pago pelo cliente
   final. O billing da VALION é uma mensalidade SaaS independente do faturamento da loja.
6. **Vencimento mensal CONFIGURÁVEL INDIVIDUALMENTE POR LOJA** (decisão nova, 2026-09-12 — fecha a
   antiga pergunta aberta "data fixa global vs. 30 dias corridos"). Não existe uma data única pra todas
   as lojas: cada loja tem seu próprio "dia do mês" de referência pro ciclo de cobrança (ex.: Loja A →
   dia 5, Loja B → dia 10, Loja C → dia 20). Esse campo é configurado exclusivamente pelo **Platform
   Admin** — o admin da própria loja NUNCA pode alterar seu próprio dia de vencimento. Toda alteração
   deve ter auditoria (quem mudou, quando, de/para qual dia).
7. **Alteração de vencimento nunca é retroativa.** Se o Platform Admin muda o dia de vencimento de uma
   loja que já tem um ciclo ativo, a mudança NÃO recalcula a mensalidade/ciclo atual — só passa a valer
   a partir do PRÓXIMO ciclo. Objetivo: evitar alterar obrigação financeira já em curso, preservar
   histórico, manter rastreabilidade. A mecânica exata de transição entre ciclos (o que acontece com o
   ciclo "no meio do caminho" no momento da troca) ainda não está detalhada — fica como ponto a
   especificar na implementação (não inventar agora, ver H).
8. **Dias de carência: 5 dias, sempre contados a partir do vencimento de CADA loja** (fecha a antiga
   pergunta aberta, incl. a dúvida "fixo global ou por loja" — não é um número separado configurável
   por loja, é sempre 5 dias corridos após a data de vencimento configurada daquela loja; como o
   vencimento já varia por loja (B.6), a data-calendário da carência varia junto naturalmente, mas o
   NÚMERO de dias — 5 — é o mesmo pra todo mundo).
9. **Bloqueio da V1 afeta SOMENTE o Admin.** A vitrine (storefront) da loja continua no ar e vendendo
   normalmente pro cliente final durante o bloqueio — só o dono/gerente perde acesso ao painel de
   gestão. (Fecha a antiga pergunta aberta H.3.)
10. **Vencimento é uma DATA FIXA por loja, configurada no Platform Console.** Depois de configurada pela
    primeira vez, o dia permanece fixo mês a mês (ex.: loja configurada pro dia 10 vence todo dia 10,
    todo mês) — reforça/confirma B.6, sem mudança de mecânica.
11. **Trial grátis de 15 dias pra loja nova**, antes da primeira cobrança. (Fecha a antiga pergunta
    aberta H.5 — regra do primeiro ciclo dentro do trial ainda pode precisar de detalhe na
    implementação, mas o prazo do trial em si está definido.)
12. **Aviso de vencimento: visual no Admin + e-mail + WhatsApp.** (Fecha a antiga pergunta aberta H.6.)
13. **Contato de cobrança é DEDICADO, não o contato público da loja.** Cadastro/config da loja no
    Platform Console ganha um campo de "responsável financeiro" (nome + e-mail + WhatsApp do dono ou
    gerente) — os avisos de vencimento vão pra esse contato específico, nunca pro número/e-mail
    genérico de atendimento ao cliente da loja (motivo: funcionário de balcão não tem motivo pra dar
    atenção a um aviso de cobrança; quem decide/paga precisa ser quem recebe o aviso).
14. **Valor da mensalidade: R$ 99,00/mês**, FECHADO (dono, 2026-09-12) — mesmo valor pra toda loja nova,
    sem camadas.
15. **Primeiro ciclo ao fim do trial: SEM cobrança proporcional.** Loja entra, usa 15 dias grátis, e o
    primeiro pagamento de R$99 cheio só acontece no primeiro dia de vencimento configurado que vier
    DEPOIS do trial — mesmo que isso signifique alguns dias extras "de brinde" entre o fim do trial e
    esse primeiro vencimento. Nunca calcula rateio/proporcional.
16. **Transição de vencimento: o próximo vencimento já agendado NUNCA muda.** Quando o Platform Admin
    altera o dia de vencimento de uma loja com ciclo ativo, o vencimento que já estava "programado"
    continua valendo do jeito que estava — só o vencimento SEGUINTE a esse passa a usar o novo dia
    configurado. Leitura mais literal de "nunca retroativo" (B.7).

## C. O que falta construir (visão geral, alto nível)

- Uma forma de guardar, por loja, o status da assinatura (em dia / carência / bloqueada / isenta) e a
  data do próximo vencimento.
- Uma forma do dono (admin da PLATAFORMA, não da loja) marcar "recebi o pagamento desta loja".
- Um gate que de fato bloqueia o Admin da loja inadimplente, sem precisar caçar e proteger RPC por RPC.
- Um job periódico que aplica a carência e o bloqueio automaticamente quando o vencimento passa.
- Avisos de transparência pro dono da loja ANTES do bloqueio (nunca bloqueio-surpresa) — mesmo espírito
  já usado no aviso de "configuração padrão" do onboarding.

## D. Modelo técnico proposto (especificação, NÃO execução)

**Importante — separação explícita pedida pelo dono**: o que segue nesta seção é PROPOSTA TÉCNICA
(rascunho, não vinculante, nomes de tabela/campo/RPC provisórios), distinta das DECISÕES DE NEGÓCIO da
seção B (essas sim já fechadas). A lista abaixo é o que a V1 precisa ter capacidade CONCEITUAL de
controlar — não é schema definitivo, cada campo ainda precisa ser justificado/detalhado na
implementação: loja; mensalidade; valor devido; vencimento; dia de vencimento configurado; status;
período de carência; pagamento confirmado; data/hora da confirmação; responsável pela confirmação;
próximo vencimento; histórico/auditoria.

**Nova tabela `store_subscriptions`** (nome provisório, 1:1 com `stores` — estado ATUAL da assinatura):
`store_id` (FK), `status` (`em_dia` | `carencia` | `bloqueada` | `isenta` — `isenta` cobre Encanto/
Aquários Bar), `dia_vencimento` (int, 1-31 — configurável por loja, só Platform Admin altera, fixo mês
a mês depois de configurado, ver B.6/B.10), `proximo_vencimento` (date), `dias_carencia` (int — sempre
5, mesmo número global pra toda loja, contado a partir do `proximo_vencimento` de CADA loja — ver B.8),
`valor_devido` (decimal — R$99,00 fixo pra toda loja, ver B.14),
`trial_ate` (date — fim dos 15 dias de teste grátis de loja nova, ver B.11), `contato_financeiro_nome`/
`contato_financeiro_email`/`contato_financeiro_whatsapp` (responsável financeiro/dono/gerente da loja,
DISTINTO do contato público da loja — ver B.13; avisos de vencimento vão pra cá).

**Nova tabela `store_billing_events`** (nome provisório, 1:N com `stores` — ledger/histórico IMUTÁVEL,
nunca editado/apagado, só inserido): registra cada acontecimento de billing pra rastreabilidade
completa — tipos de evento propostos: `mensalidade_gerada`, `vencimento`, `pagamento_confirmado`,
`alteracao_vencimento`, `entrada_carencia`, `bloqueio`, `isencao`. Cada linha carrega quem/quando/o que
mudou. Não é schema definitivo — proposta a refinar campo a campo na implementação.

**RPCs novas** (nomes provisórios):
- `platform_marcar_mensalidade_paga(store_id, proximo_vencimento)` — só quem é admin da PLATAFORMA
  (reaproveita o mesmo gate `is_admin_anywhere` da Onda 8 do SAAS-01, não `is_admin_of` de uma loja só).
- `platform_configurar_dia_vencimento(store_id, dia)` — idem, só Platform Admin; aplica a regra "vale
  a partir do próximo ciclo" (B.7), nunca recalcula o ciclo corrente.
- `platform_configurar_contato_financeiro(store_id, nome, email, whatsapp)` — idem, só Platform Admin
  (cadastro do responsável financeiro/dono/gerente que recebe os avisos, ver B.13).
- `get_billing_status(store_id)` — o Admin da PRÓPRIA loja só CONSULTA seu status/vencimento (nunca
  escreve/confirma nada — confirmação é ação exclusiva do Platform Admin, ver F).

**Avisos de vencimento** (visual + e-mail + WhatsApp, ver B.12): reaproveita a infra de notificação já
existente no projeto (mesmo padrão pg_cron/Vault de WhatsApp usado em REF-ORDER-01, e o provedor SMTP
já configurado desde REF-AUTH-03) — sem inventar um canal novo de envio, só um novo tipo de evento
disparando os canais que já existem. Destinatário é sempre o contato financeiro dedicado (B.13), nunca
o contato público da loja.

**Dados de pagamento/Pix**: a V1 precisa que o sistema apresente os dados necessários pra cobrança
assistida (Pix/dados definidos pela VALION) junto da mensalidade gerada — isso é só EXIBIÇÃO de dado
configurado pela VALION, não é integração de gateway nenhuma.

**Gate de bloqueio — o ponto mais importante tecnicamente**: em vez de proteger RPC por RPC, a proposta
é `is_admin_of()` ganhar uma checagem adicional e aditiva — se a assinatura da loja está `bloqueada`,
toda RPC que já depende de `is_admin_of` (é a esmagadora maioria das ações administrativas do sistema
hoje) passa a recusar automaticamente. Reaproveita TODA a superfície de proteção já existente, sem
caçar função por função — mesmo espírito arquitetural de toda REF anterior deste projeto (capability
opt-in, ponto único de verdade).

**Cron**: um novo job pg_cron (mesmo padrão já usado por REF-ORDER-01/REF-PAYMENT-SEC-02 Onda 6, Vault
pra segredo se precisar) rodando 1x/dia: passa lojas vencidas pra `carencia`, e as que estouraram os
`dias_carencia` pra `bloqueada`. Esse job é responsável só pelo ESTADO do billing (transição de
status) — o RECEBIMENTO do dinheiro continua 100% manual/confirmado pelo Platform Admin na V1.

**Não reaproveitar o Mercado Pago já integrado para esta REF.** `mp-criar-cobranca`/`mp-webhook`
existem e estão ao vivo, mas servem exclusivamente pro CLIENTE FINAL pagar o PEDIDO da loja — são
problemas diferentes (pagamento do cliente final ≠ mensalidade SaaS da loja pra VALION). Misturar os
dois fluxos não está no escopo desta REF.

**Evolução planejada (V1 → V2 → V3)**, só pra dar norte — nada além da V1 está autorizado a avançar:
- **V1** (esta REF, escopo atual): cobrança assistida/manual — sistema controla tudo, dinheiro migra
  manualmente.
- **V2** (futura, não iniciada): cobrança automática/semi-automática.
- **V3** (futura, não iniciada): recorrência automática de verdade via gateway (provavelmente Mercado
  Pago assinatura, mas isso também é decisão futura, não travada agora).

## E. Impacto no Admin / Platform Console

- **Platform Console**: nova aba "Faturamento" — o Platform Admin deve conseguir, no mínimo: visualizar
  situação de billing da loja, visualizar a mensalidade/valor devido/vencimento, **configurar o dia de
  vencimento daquela loja**, **configurar o contato financeiro** (nome/e-mail/WhatsApp do
  dono/gerente), visualizar status (incl. se está em trial e até quando), **confirmar pagamento
  recebido**, e visualizar histórico/auditoria (via `store_billing_events`). Confirmar pagamento,
  configurar vencimento e configurar contato financeiro são ações EXCLUSIVAS do Platform Admin.
- **Admin de cada loja**: só CONSULTA sua própria situação de billing (status/vencimento) — nunca marca
  a própria mensalidade como paga, nunca altera seu próprio vencimento. Banner discreto de aviso quando
  o vencimento está próximo ou já em carência (transparência antes do bloqueio).
- **Loja com Admin bloqueado**: mensagem clara ("mensalidade pendente, entre em contato") no lugar do
  painel normal — nunca uma tela de erro genérica/confusa.

## F. Segurança

- Somente Platform Admin pode operar a cobrança da plataforma: `platform_marcar_mensalidade_paga` e
  `platform_configurar_dia_vencimento` só podem ser chamadas por admin da PLATAFORMA — nunca por um
  admin de loja comum (evitaria a própria loja se auto-declarar em dia ou mudar seu próprio vencimento).
- O admin da loja tem acesso SOMENTE DE LEITURA à própria situação de billing (`get_billing_status`) —
  nunca escreve/confirma nada.
- O bloqueio de inadimplência deve ser aplicado por uma camada CENTRAL de autorização/gate (proposta:
  `is_admin_of()`, ver seção D) — evita espalhar verificações inconsistentes por vários RPCs.
- Não alterar a arquitetura de autorização existente sem evidência/necessidade real — a proposta é
  ADITIVA em cima do que já existe (`is_admin_of`/`is_admin_anywhere`), nunca substituição.
- Bloqueio nunca apaga/afeta dado existente (pedidos, histórico, catálogo continuam intactos) — só a
  CAPACIDADE de agir no Admin é que para, e só depois da carência.

## G. Escopo da V1

**Dentro da V1:**
- Mensalidade SaaS (valor devido por loja).
- Cobrança assistida/manual (ver B.2 — sistema controla tudo, dinheiro migra manualmente).
- Dia de vencimento configurável por loja (ver B.6/B.7).
- Status (em_dia/carência/bloqueada/isenta) e controle de carência.
- Confirmação de pagamento manual pelo Platform Admin (exclusiva).
- Histórico e auditoria (`store_billing_events`).
- Próximo vencimento calculado/registrado pelo sistema.
- Bloqueio administrativo (Admin da loja) por inadimplência.
- Automação diária de transição de status (em_dia→carência→bloqueada).
- Exibição dos dados de pagamento/Pix da VALION pra cobrança.
- Trial grátis de 15 dias pra loja nova.
- Contato financeiro dedicado por loja (dono/gerente, distinto do contato público) + avisos por
  visual/e-mail/WhatsApp.

**Fora da V1** (decisão do dono, não avançar sem nova autorização):
- Comissão ou percentual sobre pedidos do cliente final — nunca, regra dura desta REF.
- Cobrança recorrente automática / Mercado Pago recorrente (isso é V2/V3, ver seção D).
- Reaproveitar o fluxo de Mercado Pago já existente (`mp-criar-cobranca`/`mp-webhook`) pra cobrar a
  mensalidade — são problemas diferentes (pagamento do cliente final ≠ mensalidade da loja).
- Planos por funcionalidade (Básico/Pro/etc.) — só mensalidade única por enquanto.
- Múltiplos planos comerciais.
- Billing baseado no faturamento/volume de pedidos da loja.
- Encanto/Aquários Bar entrarem no modelo pago — ficam isentas.

## H. Perguntas — todas FECHADAS em 2026-09-12

*(Histórico: ver seção B para todas as 16 decisões de negócio — vencimento por loja (B.6/B.10), dias de
carência = 5 sempre relativos ao vencimento de cada loja (B.8), bloqueio só do Admin (B.9), trial de 15
dias (B.11), canais de aviso visual+e-mail+WhatsApp (B.12), contato financeiro dedicado (B.13), valor
da mensalidade = R$99,00/mês (B.14), primeiro ciclo do trial (B.15), mecânica de transição de
vencimento (B.16).)*

Nenhuma pergunta comercial ou de regra de negócio segue aberta. O que resta é só detalhe de
IMPLEMENTAÇÃO técnica (nomes exatos de campo/tabela/RPC, texto exato de mensagens de UI, etc.) — normal
de refinar durante a própria implementação, não bloqueia o início dela.

## I. Ondas propostas (SE o dono decidir avançar — estrutura NÃO vinculante, só pra dar noção de tamanho)

- Onda 1: schema (`store_subscriptions` com `dia_vencimento` por loja + `store_billing_events` ledger)
  + RPCs de leitura/marcar-pago/configurar-vencimento + gate aditivo em `is_admin_of`.
- Onda 2: cron de carência/bloqueio automático (transição de status apenas, não recebimento).
- Onda 3: UI no Platform Console (lista de lojas, configurar vencimento, marcar como pago, histórico).
- Onda 4: UI no Admin de cada loja (banner de aviso/vencimento, tela de consulta somente-leitura).
- V2/V3 (futuras, fora desta REF): cobrança automática/semi-automática, depois recorrência de verdade
  via gateway — ver "Evolução planejada" na seção D.

## Resumo executivo

A plataforma já tem toda a base técnica pronta (multi-tenant, onboarding, gateway de pagamento já
validado com dinheiro real) pra suportar cobrança de mensalidade das lojas. O dono fechou as 16
decisões de negócio da seção B: mensalidade única de **R$99,00/mês**, cobrança ASSISTIDA/manual
(sistema controla tudo, dinheiro migra manualmente por fora), carência de 5 dias (sempre relativa ao
vencimento de cada loja), bloqueio da V1 afeta SÓ o Admin (storefront continua vendendo), lojas piloto
isentas, nunca comissão, vencimento em DATA FIXA configurável POR LOJA (só Platform Admin altera),
trial grátis de 15 dias sem cobrança proporcional no primeiro ciclo, transição de vencimento nunca
mexe no próximo vencimento já agendado, avisos por visual+e-mail+WhatsApp, e contato financeiro
DEDICADO (dono/gerente, não o contato público da loja). **Zero pergunta comercial em aberto.**

Tecnicamente, a peça mais elegante da proposta (seção D, ainda proposta técnica não definitiva) é
reaproveitar `is_admin_of()` como ponto único de bloqueio — zero necessidade de proteger dezenas de
RPCs uma por uma — somada a um ledger imutável (`store_billing_events`) pra rastreabilidade completa de
todo o histórico.

**Único ponto NÃO técnico fora do radar deste documento até agora, vale uma decisão rápida antes de
emitir cobrança de verdade**: obrigação fiscal da VALION ao cobrar as lojas (emissão de nota fiscal de
serviço, enquadramento tributário — MEI/Simples/etc.) — é questão contábil/jurídica, fora do escopo
técnico desta REF, mas relevante antes dela virar dinheiro real recorrente.

**Confirmação explícita: nenhum código, banco, migration, deploy, commit ou push foi realizado nesta
atualização — só o documento de descoberta foi revisado.**
