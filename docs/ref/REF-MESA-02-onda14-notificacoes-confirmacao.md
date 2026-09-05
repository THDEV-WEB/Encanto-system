# REF-MESA-02 — Onda 14: Notificações (Confirmação)

**Status: CONCLUÍDA — sem mudança de código de produção.** A auditoria (`docs/ref/REF-MESA-02-
auditoria.md`, seção 7) já havia registrado: "Notificações/fidelidade continuam por pedido, não
por sessão... esta modelagem não resolve nem piora, só tornou o cenário 'vários pedidos pequenos
na mesma visita' operacionalmente comum pela primeira vez (R11)" — R11 é risco **Baixa** severidade,
já aceito. Confirmado por leitura de código antes de escrever qualquer teste:
`trg_enc_order_notify` dispara SOMENTE em `AFTER INSERT OR UPDATE OF status ON orders`
(`REF-ORDER-01-order-ops.sql`) — não existe nenhum trigger em `mesa_sessions`, então abrir (Onda 6)
ou fechar (Onda 11) uma sessão não pode, por construção, enfileirar notificação nenhuma por si só.

## O que foi confirmado (com teste real, não só leitura de código)
- Um pedido de mesa com sessão habilitada enfileira notificação `recebido` com o mesmo conteúdo já
  estabelecido na REF-MESA-01 Onda 7 (`vars.mesa`, `vars.tempo = 'preparo em andamento'`,
  `vars.situacao` no template `pronto`) — `mesa_session_id` não interfere em nada.
- Uma sessão com 3 pedidos gera **3 notificações independentes** (1 por pedido, nunca consolidado
  por sessão/conta) — confirma que o comportamento aceito pela auditoria continua exatamente o
  mesmo, não regrediu para menos nem virou consolidado sem decisão explícita.
- **Fechar a conta (Onda 11) não enfileira notificação nenhuma** — o trigger é só em
  `orders.status`, `UPDATE` em `mesa_sessions` é invisível para esse subsistema.
- **Interação Onda 9 (troca de mesa) × notificações**: a notificação de um pedido criado ANTES da
  troca continua referenciando a mesa física ANTIGA (`orders.mesa_identificador` é imutável — é
  histórico correto, não um bug), e um pedido criado DEPOIS da troca (mesma sessão) usa a mesa
  NOVA — as duas features compõem sem contaminação cruzada.

## Testes
`scripts/mesa-02-onda14-notificacoes-confirmacao-test.mjs` (novo, 8/8).

## Regressão completa
lint (0 erros, 60 warnings pré-existentes), typecheck limpo. Backend: MESA-01 (60/60) +
interseção (10/10) + MESA-02 onda2-13 (147/147) + onda14 (8/8) + DELIVERY-FEE-05 (29/29) =
**254/254** checks de banco + `npm run test:domain` verde.

## Produção
Não tocada — nenhuma migration nesta onda (nenhum código de produção mudou, só um teste novo).
