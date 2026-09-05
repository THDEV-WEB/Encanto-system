# REF-MESA-02 — Onda 5: QR Protegido (resolve R3)

**Status: CONCLUÍDA.** Esta é a correção de segurança mais crítica de toda a REF-MESA-02 — o achado
mais grave da auditoria original (`docs/ref/REF-MESA-02-auditoria.md`, risco R3): o QR carregava só
`?mesa=<número>` em texto puro, sem nenhuma prova de posse. Qualquer pessoa com o link da loja podia
editar a URL e anexar um pedido à conta acumulada de uma mesa alheia.

## O que mudou
- `mesas.qr_token uuid UNIQUE NOT NULL DEFAULT gen_random_uuid()` — credencial opaca (122 bits),
  não previsível, não sequencial, não derivada do identificador visível. O número da mesa continua
  visível na UI, mas deixou de ser credencial de qualquer coisa.
- `resolver_mesa_por_token(p_qr_token)` — RPC pública (guest sem sessão), rate-limited
  (`_rate_limit_hit`), fail-closed genérico ("mesa nao encontrada", nunca revela token "quase válido").
- **`create_order()`**: para `origem_pedido='qr_mesa'`, passou a **exigir** `mesa_qr_token` e resolve
  `mesa_identificador`+`store_id` inteiramente a partir dele — **qualquer `mesa_identificador` que o
  client mande no payload é ignorado/sobrescrito** para este canal. `admin_garcom` (formulário do
  garçom) continua sem exigir token — não é o canal do achado R3 (já é gated por `is_admin_of`).
- Frontend: `?mesa=<número>` → `?mesa_token=<uuid>`. `useMesaFromQuery.js` nunca mais usa o valor da
  URL como identificador direto — sempre resolve via `resolver_mesa_por_token()` primeiro. Token
  inválido = falha silenciosa (comportamento idêntico a não ter `?mesa_token=` na URL).

## Testes (E2E, `scripts/mesa-02-onda5-qr-protegido-test.mjs`) — ataque real, não revisão de código
12/12, incluindo os 4 ataques centrais:
1. **Forjar `mesa_identificador` no payload** com token de OUTRA mesa válida → servidor grava o
   identificador do TOKEN, payload completamente ignorado.
2. **Ataque original da auditoria** (só `mesa_identificador` cru, sem token) → bloqueado.
3. **Token de mesa de OUTRA loja** usado numa requisição resolvida para a loja A → bloqueado
   (cross-tenant).
4. **Token aleatório/inexistente** → bloqueado.
Mais: `resolver_mesa_por_token` resolve corretamente múltiplas mesas distintas, `admin_garcom`
continua funcionando sem token (regressão), entrega/retirada intocados (regressão).

## Regressão real encontrada e corrigida (não mascarada)
`scripts/mesa-01-onda3-canal-qr-test.mjs` (Onda 3 da MESA-01) testava exatamente o padrão antigo
(`mesa_identificador` cru confiado para `qr_mesa`) — comportamento deliberadamente eliminado por
esta onda. Corrigi o teste para criar uma mesa física real e usar seu `qr_token`, em vez de mascarar
ou pular a suíte. Voltou a 8/8.

## Regressão completa
lint (0 erros, mesmos 60 warnings pré-existentes), typecheck limpo, `build` (storefront) e
`build:admin` ok, `checkout.golden.mjs` intacto (payload continua byte-compatível — `mesaQrToken` é
campo opcional, ausente preserva 100%). Backend: MESA-01 (7 suítes) 60/60 + interseção 10/10 +
MESA-02 Onda 2/3/4 46/46 + Onda 5 12/12 + DELIVERY-FEE-05 29/29 + `test:domain` verde = **157/157**.

## Rollback
Testado de verdade.

## Produção
Não tocada.
