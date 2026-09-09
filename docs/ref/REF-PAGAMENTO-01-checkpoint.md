# REF-PAGAMENTO-01 — CHECKPOINT (ler primeiro numa nova sessão/retomada)

**STATUS: Onda 0 (auditoria) + Onda 1 (fundação de schema) CONCLUÍDAS e commitadas. Onda 2 em
diante BLOQUEADA por credencial — não é algo que autonomia resolve.**

**Atualizado:** 2026-09-09, após commit `20e29be` (Onda 1). Execução autônoma autorizada pelo dono
(mandato "CONTINUIDADE OFICIAL — REF-PAGAMENTO-01... IMPLEMENTAÇÃO DO PAGAMENTO COM MERCADO PAGO").
Hard constraints seguem valendo: nunca produção, nunca push, 1 commit por onda com `git add`
explícito, nunca tocar arquivo de outra sessão (`src/constants/privacyPolicy.js`,
`supabase/functions/route-distance/index.ts` — REF-DELIVERY-FEE-05 ativa agora —,
`scripts/loadtest-e2e.mjs`).

## Estado do git
```
20e29be feat(pagamento-01): Onda 1 -- fundacao de schema (payment_intents + divisao de conta de Mesa)
282d449 docs(pagamento-01): Onda 0 -- auditoria pre-implementacao
2b5015e docs(pagamento-01): arquitetura tecnica -- integracao Mercado Pago
459bd8c docs(pagamento-01): descoberta completa -- gateway de pagamento online
```
Todos LOCAIS, `origin/main` não avançou. Working tree só tem os 3 arquivos de outras sessões acima
(nunca tocados).

## O que já existe (não recriar)

- **`payment_intents`** (Onda 1): 1 linha por tentativa de cobrança, `order_id` XOR
  `mesa_session_id` (CHECK), RLS deny-all estrutural (mesmo padrão de `mesa_sessions` desde
  REF-MESA-02 Onda 2) — toda leitura/escrita só via RPC `SECURITY DEFINER`. Ainda sem nenhuma linha
  real (Onda 2, que criaria de verdade, está bloqueada).
- **`mesa_session_payment_allocations`** (Onda 1): divisão de conta de Mesa entre PESSOAS
  PRESENTES — não confundir com Split Mercado Pago (financeiro, VALION vs. restaurante, não
  implementado). `admin_dividir_conta_mesa(p_mesa_session_id, p_alocacoes, p_store_id)` valida
  `SUM(valor) = total autoritativo` (nunca confia no client, nunca "ajusta" diferença sozinho) e
  não permite dividir 2x a mesma sessão. `admin_registrar_pagamento_alocacao(p_alocacao_id,
  p_metodo, p_store_id)` confirma 1 fatia (presencial, admin-gated — fatia online seria confirmada
  pelo webhook, Onda 4, não implementado).
- **`admin_fechar_conta_mesa`**: ganhou 1 guarda aditiva — sessão com QUALQUER fatia pendente não
  fecha; sessão SEM nenhuma fatia continua **byte-a-byte idêntica** ao comportamento da REF-MESA-02
  Onda 11 (regressão confirmada, 13/13). Sessão com todas as fatias pagas grava
  `payment_method='dividido'` (sentinela — `mesa_sessions_coerencia_estado` exige NOT NULL quando
  há valor cobrado, e um único campo text não pode representar N métodos diferentes fielmente; cada
  fatia guarda seu próprio método real em `mesa_session_payment_allocations.metodo`).
- **`orders.payment_status`**: coluna nova, nullable, sem CHECK/enum (mesmo padrão de
  `payment_method`). `NULL` sempre para todo pedido COD (confirmado, `create_order()` intocado).
- **Decisão técnica confirmada nesta rodada**: Mercado Pago recomenda hoje a **Orders API**
  (`/v1/orders`) para Payment Brick, não a `/v1/payments` clássica — resolve a ambiguidade que
  ficara aberta em `2b5015e` §17.2.
- **INCIDENTE-01 verificado**: `run.mjs` (ferramenta local) tinha bug real que mandava migrations
  de teste pra produção por engano (2026-09-06, outra REF). Corrigido e **comprovado com teste real
  rodado nesta sessão** (`run.guard.test.mjs`, 11/11). Prefira `run-e2e.mjs` (sem flag `--env`,
  estruturalmente só aponta pro E2E) para qualquer SQL cru desta REF.

## BLOQUEIO REAL — Onda 2 em diante

**Não posso criar uma aplicação no painel do Mercado Pago Developers nem gerar credenciais de
teste — isso exige uma ação humana num painel de 3º provedor.** Sem isso:
- Onda 2 (RPC/Edge Function criando cobrança de verdade contra o sandbox) não pode ser testada.
- Onda 3 (Payment Brick renderizando/tokenizando de verdade) precisa da `public_key` de teste.
- Teste do webhook contra o simulador oficial do Mercado Pago também depende da aplicação existir.

**Classificação: BLOQUEADO POR CREDENCIAL.**

## Se retomando esta REF numa sessão futura

1. Ler este checkpoint + `docs/ref/REF-PAGAMENTO-01-onda0-auditoria.md` (mapa completo) +
   `docs/ref/REF-PAGAMENTO-01-arquitetura-mercadopago.md` (arquitetura/threat model).
2. **Se o dono já criou a aplicação de teste do Mercado Pago e forneceu as credenciais via
   Supabase Secrets** (nunca por chat) — prosseguir para Onda 2 real.
3. **Se ainda não** — ainda há trabalho útil e credential-independent disponível:
   - Lógica de validação HMAC do webhook (`x-signature`) é pura matemática — testável com um
     secret FALSO gerado localmente, sem nenhuma chamada real ao Mercado Pago.
   - Job de expiração de 15min (`pg_cron`, mesmo mecanismo já usado por REF-ORDER-01/
     REF-DELIVERY-FEE-05) para `payment_intents` presas em `pendente`.
   - Mais testes de segurança da divisão de conta de Mesa (arredondamento com centavos ímpares,
     concorrência entre 2 admins tentando dividir a mesma sessão ao mesmo tempo).
4. Nunca reabrir REF-MESA-02, nunca tocar REF-DELIVERY-FEE-05.
