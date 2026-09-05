# REF-MESA-02 — Onda 4: Mesas Físicas / Capability

**Status: CONCLUÍDA.**

## Schema
`public.mesas` (catálogo por loja): `id`, `store_id`, `identificador` (1-40 chars, texto livre — catálogo com id estável formal fica para evolução futura, mesmo padrão que `orders.mesa_identificador`), `status` (`disponivel`/`indisponivel`, controlado pelo Admin), `created_at`. `UNIQUE(store_id, identificador)`.

**Decisão de modelagem**: "OCUPADA" não é um valor persistido — é **derivado em tempo real** checando se existe uma sessão aberta em `mesa_session_mesas` para aquele identificador. Evita denormalização e evita a mesa ficar presa em "ocupada" se algo falhar no fechamento (a fonte de verdade de ocupação é sempre `mesa_session_mesas`).

**Enforcement de "indisponível bloqueia nova sessão"**: registrado como responsabilidade da RPC de abertura de sessão (onda futura) — não existe ainda nenhum caminho que abra sessão de mesa, então não há regressão possível aqui.

## RPCs
`admin_listar_mesas`, `admin_criar_mesa`, `admin_set_mesa_status` — todas `SECURITY DEFINER`, `is_admin_of` + `WHERE store_id` explícito nas operações por id (nunca só o papel).

## Segurança
`mesas` segue o padrão "config" (RLS deny-all, zero policy, REVOKE ALL de anon/authenticated). RPCs de escrita só para `authenticated`.

## Frontend
Nova aba **"Mesas"** no Admin (nome já decidido) — `AdminMesas.jsx`: cadastrar mesa, listar com status e badge "🍽️ Ocupada agora" quando aplicável, alternar disponível/indisponível. Serviço `src/services/mesa/mesasFisicas.js` (mesmo padrão de `buildStoreRpcParam()` já usado em todo o domínio de Mesa).

## Testes (E2E, `scripts/mesa-02-onda4-mesas-fisicas-test.mjs`)
11/11: criação, duplicata na mesma loja, isolamento entre tenants, listagem, toggle de status, "ocupada" derivada corretamente, cross-tenant bloqueado (mensagem genérica "mesa nao encontrada", não vaza existência), outsider sem vínculo bloqueado, acesso direto via anon negado (RLS+REVOKE na tabela e na RPC).

Durante a escrita achei e corrigi **2 bugs no meu script de teste** (não na migration): um `LIMIT 1` que devia ser `LIMIT 2` (fazia duas identidades de teste colapsarem na mesma), e um `try/catch` sem savepoint aninhado que "envenenava" a transação após capturar o erro esperado.

## Regressão
lint (0 erros), typecheck limpo, `build:admin` ok, MESA-01 60/60 + interseção 10/10 + Onda 2 27/27 + Onda 3 8/8 + DELIVERY-FEE-05 29/29 + `test:domain` verde = **150/150** + 3 builds/checks estáticos limpos.

## Rollback
Testado de verdade.

## Produção
Não tocada.

## Nota de escopo
Não escrevi spec Playwright dedicado para esta tela agora (fica para a prova E2E ponta-a-ponta do fluxo de QR e para a regressão final completa, mais adiante no plano) — decisão de ritmo para a execução noturna, registrada aqui explicitamente, não esquecida.
