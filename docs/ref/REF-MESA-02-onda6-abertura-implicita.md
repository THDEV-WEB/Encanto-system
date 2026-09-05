# REF-MESA-02 — Onda 6: Abertura Implícita da Sessão

**Status: CONCLUÍDA.**

## O que mudou
- Nova capability opt-in `mesa_sessao_habilitada` em `store_settings` (via `get_mesa_config`/
  `set_mesa_config`, que ganhou o 4º parâmetro) — enquanto desligada (default), `tipo_pedido='mesa'`
  se comporta exatamente como antes desta onda (`mesa_session_id` sempre `NULL`).
- `_get_or_open_mesa_session()` (função interna, sem GRANT a ninguém): resolve/abre a sessão da mesa
  usando o índice único parcial da Onda 2 como árbitro da concorrência — nunca espera passiva/retry
  em loop, o próprio `unique_violation` do Postgres resolve a corrida.
- `create_order()`: quando `tipo_pedido='mesa'` + `mesa_sessao_habilitada=true` +
  `origem_pedido IN ('qr_mesa','admin_garcom')`, resolve/abre a sessão e grava
  `orders.mesa_session_id` — sem exigir nenhuma mudança de payload do client.

## Concorrência — prova real, não simulação
Ver seção 26 da autorização ("usar duas conexões reais... não considerar teste unitário isolado
suficiente"). O teste abre 2 conexões Postgres genuinamente separadas e faz 2 "primeiros pedidos"
simultâneos para a mesma mesa. Depois de uma primeira tentativa com inferência por timing de
promise se mostrar flaky (sensível à latência real de rede até o Supabase hospedado), troquei por
uma prova robusta: consulta direta a `pg_locks` confirmando que uma das duas conexões está
genuinamente bloqueada (`granted=false`) esperando a outra, antes de liberar o commit. Resultado:
exatamente 1 sessão criada, ambos os pedidos resolvem para ela.

## Achado real corrigido antes do commit (não é regressão de outra onda — bug meu, desta mesma onda)
Ao trocar a assinatura de `set_mesa_config` (`DROP FUNCTION` + `CREATE`), esqueci o `REVOKE EXECUTE
... FROM PUBLIC`/`FROM anon` explícito que a migration original da Onda 1 já tinha (achado
documentado pela REF-SEC-02: Supabase concede `EXECUTE` a `PUBLIC` por padrão em função **nova** do
schema `public`). Sem isso, `anon` teria ganhado acesso de escrita à função (a autorização real
dentro do corpo — `is_admin_of` — continuava correta, mas o `GRANT` em si ficou mais permissivo do
que deveria). Descoberto pela própria suíte de regressão (`mesa-01-onda1-fundacao-test.mjs::A6`,
que checa grants explicitamente) antes de qualquer commit — corrigido na mesma migration, nunca
chegou a ser commitado incorreto.

## Testes (E2E, `scripts/mesa-02-onda6-abertura-implicita-test.mjs`)
12/12: `sessao_habilitada` default/set/get, 1º pedido abre sessão, 2º pedido da mesma mesa reaproveita
a mesma sessão, ambos gravados com o mesmo `mesa_session_id`, sessão registra `origem_abertura`/
`opened_by_admin_user_id` corretamente, regressão (`mesa_sessao_habilitada=false` preserva
`mesa_session_id=NULL`, entrega intocada), e a Camada C de concorrência real (3 casos).

## Regressão completa
MESA-01 (7 suítes) 60/60 + interseção 10/10 + MESA-02 onda2/3/4/5 58/58 + onda6 12/12 +
DELIVERY-FEE-05 29/29 + `test:domain` verde = **169/169**.

## Rollback
Testado de verdade.

## Produção
Não tocada.
