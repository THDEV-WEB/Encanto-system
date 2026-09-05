# REF-MESA-02 — Onda 10: Junção de Mesas

**Status: CONCLUÍDA.** Adiciona uma mesa física LIVRE a uma sessão já aberta (grupo grande ocupa
a mesa 40 e pede pra juntar a mesa 41 vazia) — as duas mesas passam a apontar para a MESMA
sessão/conta, ambas "ocupadas" simultaneamente. É exatamente o caso de uso para que
`mesa_session_mesas` foi desenhada como N:1 desde a Onda 2 ("suporta junção de mesas desde a
fundação").

## Escopo deliberadamente limitado
Só é permitido juntar uma mesa que esteja LIVRE (catálogo `disponivel`, sem sessão aberta própria)
— **não** é escopo desta onda fundir duas sessões que já têm pedidos independentes cada uma.
Motivo: `orders.mesa_session_id` é imutável desde a Onda 3 ("nunca reatribuída/limpa") — mover
pedidos já existentes de uma sessão para outra violaria essa invariante. Um "merge de duas contas
já ativas" seria uma decisão de produto nova que exigiria reconsiderar essa invariante — não
implementado aqui, registrado como gap consciente.

## O que mudou
- **`admin_juntar_mesa_sessao(p_mesa_session_id, p_identificador_adicional, p_store_id)`** (nova):
  quase idêntica a `admin_trocar_mesa_sessao` (Onda 9), mas **sem** o passo de fechar a linha
  antiga — é exatamente essa ausência que faz as duas mesas ficarem ocupadas ao mesmo tempo pela
  mesma sessão, em vez de uma substituir a outra. Reaproveita: `is_admin_of` + `WHERE store_id`
  explícito, lock `FOR UPDATE` na sessão (mesmo padrão das Ondas 6/9), `unique_violation` do
  índice da Onda 2 para "mesa já ocupada", e a regra "mesa indisponível não recebe sessão" da
  Onda 4/9. Juntar uma mesa que já está juntada a essa mesma sessão é um no-op amigável.
- `mesasFisicas.js::juntarMesaSessao()`.
- `AdminMesas.jsx`: seção "➕ Juntar mesa" no modal de conta (ao lado de "🔀 Trocar de mesa" da
  Onda 9) — lista mesas livres não incluídas ainda em `conta.mesas`.

## Testes
`scripts/mesa-02-onda10-juntar-mesas-test.mjs` (novo, 13/13): caso feliz (as 2 mesas assumem a
mesma sessão/total, nenhuma linha fechada — diferente da Onda 9), juntar uma 3ª mesa (não é
limitado a 2), no-op ao juntar mesa já juntada, mesa já ocupada por outra sessão, mesa
indisponível, mesa inexistente, sessão já fechada, cross-tenant, outsider sem permissão.

Migration + rollback testados de verdade (aplicado → função removida confirmada → reaplicado →
restaurada confirmada), só no banco E2E dedicado.

## Regressão completa
lint (0 erros, 60 warnings pré-existentes), typecheck limpo, `build:admin` ok. Backend: MESA-01
(60/60) + interseção (10/10) + MESA-02 onda2-9 (99/99) + onda10 (13/13) + DELIVERY-FEE-05 (29/29) =
**211/211** checks de banco + `npm run test:domain` verde + builds limpos.

## Produção
Não tocada. Migration aplicada SOMENTE no banco E2E dedicado (`db.e2e.env`, projeto `bgzcro`).
Aditiva pura — nenhuma função existente foi alterada, `create_order()`/`admin_orders_search()`
seguem intocadas.
