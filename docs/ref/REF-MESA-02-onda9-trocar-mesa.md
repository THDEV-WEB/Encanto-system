# REF-MESA-02 — Onda 9: Troca de Mesa

**Status: CONCLUÍDA.** Move uma sessão ABERTA da mesa física A para a mesa física B (cliente muda
de lugar) sem fechar nada — sessão, pedidos e total continuam os mesmos, só a mesa física
associada muda.

## Decisão de design (desvio de invariante, documentado deliberadamente)
Não dá para fazer isso com `UPDATE mesa_session_mesas SET mesa_identificador = ...` — a trigger
`_mesa_session_mesas_immutable` (Onda 2) bloqueia explicitamente mudar `mesa_identificador` numa
linha existente (histórico/auditoria permanente, por design). A abordagem escolhida preserva o
histórico completo de por quais mesas a sessão passou:
1. `INSERT` uma linha NOVA em `mesa_session_mesas` para o identificador novo (o índice único
   parcial da Onda 2 arbitra concorrência via `unique_violation` se outra sessão já estiver lá —
   mesmo mecanismo de `_get_or_open_mesa_session`, Onda 6, não um novo).
2. `UPDATE mesa_session_mesas SET status_sessao = 'fechada'` na linha ANTIGA — **a única escrita
   direta em `status_sessao` fora da trigger de sincronização automática desde a Onda 2**. Até
   aqui, o comentário da tabela dizia "mantido por trigger, nunca escrito diretamente" — essa é a
   exceção deliberada: sem ela, a mesa antiga nunca ficaria livre de novo enquanto a sessão
   seguisse aberta (a trigger só sincroniza quando o STATUS DO PAI muda, e o pai continua `aberta`
   o tempo todo numa troca de mesa).

## O que mudou
- **`admin_trocar_mesa_sessao(p_mesa_session_id, p_novo_identificador, p_store_id)`** (nova,
  `SECURITY DEFINER`): `is_admin_of(p_store_id)` + `WHERE store_id` explícito. Lock da sessão via
  `SELECT...FOR UPDATE` (mesmo padrão de `_get_or_open_mesa_session`) — serializa contra
  fechamento concorrente. Valida: sessão existe/pertence à loja/está aberta; mesa destino existe
  no catálogo e está `disponivel` (mesma regra já registrada na Onda 4); reutiliza o
  `unique_violation` do índice da Onda 2 para "mesa já ocupada" (nenhum mecanismo novo de
  concorrência). Trocar para a mesma mesa onde já está é um no-op amigável (não duplica linha).
- `mesasFisicas.js::trocarMesaSessao(mesaSessionId, novoIdentificador)`.
- `AdminMesas.jsx`: dentro do modal de conta (Onda 8), quando a sessão está aberta, um seletor
  "Trocar de mesa" lista as mesas `disponivel` e não ocupadas; ao confirmar, recarrega a lista de
  mesas e reabre o modal já na mesa nova.

## Testes
`scripts/mesa-02-onda9-trocar-mesa-test.mjs` (novo, 14/14): caso feliz (mesa antiga liberada, mesa
nova assume a mesma sessão/total, histórico preservado — as 2 linhas continuam existindo em
`mesa_session_mesas`, uma fechada, uma aberta), no-op ao trocar para a mesma mesa, mesa destino já
ocupada por outra sessão, mesa destino indisponível, mesa destino inexistente, sessão já fechada,
cross-tenant (sessão de uma loja não é encontrada por outra), outsider sem permissão.

Migration + rollback testados de verdade (aplicado → função removida confirmada → reaplicado →
restaurada confirmada), só no banco E2E dedicado.

## Regressão completa
lint (0 erros, 60 warnings pré-existentes), typecheck limpo, `build:admin` ok. Backend: MESA-01
(60/60) + interseção (10/10) + MESA-02 onda2-8 (85/85) + onda9 (14/14) + DELIVERY-FEE-05 (29/29) =
**198/198** checks de banco + `npm run test:domain` verde + builds limpos.

## Produção
Não tocada. Migration aplicada SOMENTE no banco E2E dedicado (`db.e2e.env`, projeto `bgzcro`).
Aditiva pura — nenhuma função existente foi alterada, `create_order()`/`admin_orders_search()`
seguem intocadas. Rollback não apaga nenhuma linha de dado (trocas já realizadas ficam como
histórico permanente, mesmo padrão de qualquer outro rollback deste domínio).
