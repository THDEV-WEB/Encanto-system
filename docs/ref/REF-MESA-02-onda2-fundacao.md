# REF-MESA-02 — Onda 2: Fundação de schema (`mesa_sessions` + `mesa_session_mesas`)

**Status: CONCLUÍDA e testada no E2E. Onda 3 NÃO iniciada** — aguardando nova autorização,
conforme "PARADA OBRIGATÓRIA" explícita do dono do produto.

## 1. Schema criado

Duas tabelas novas em `public`, nenhuma alteração em `orders`/`create_order()`/nenhuma tabela
existente:

**`mesa_sessions`** (estado da conta): `id` (uuid PK), `store_id`, `status` (`aberta`/`fechada`),
`origem_abertura` (`qr_mesa`/`admin_garcom`), `opened_at`/`opened_by_admin_user_id`,
`closed_at`/`closed_by_admin_user_id`, `payment_method`, `valor_cobrado_snapshot`, `request_id`,
`created_at`.

**`mesa_session_mesas`** (associação mesa física ↔ sessão): `id`, `mesa_session_id` (FK),
`store_id`, `mesa_identificador`, `status_sessao` (espelho do pai, mantido por trigger),
`attached_at`.

**Desvio deliberado do modelo original da auditoria**, autorizado explicitamente nesta onda: a
auditoria (`docs/ref/REF-MESA-02-auditoria.md` §3) propunha `mesa_sessions.mesa_identificador`
como coluna escalar — a própria auditoria já tinha identificado isso (risco R8) como o único ponto
do modelo que bloqueia "juntar mesas" de verdade. Como o dono confirmou "juntar mesas" como
requisito real desta REF (itens 7/8 da autorização), `mesa_sessions` **não tem nenhuma coluna de
identificador de mesa** — isso vive inteiramente em `mesa_session_mesas`, que aceita N linhas
(N identificadores físicos diferentes) apontando para a MESMA sessão. Isso resolve o risco R8 na
fundação, sem custo de retrofit depois da Onda 8 (como a própria auditoria alertava).

## 2. Constraints

- `mesa_sessions_valor_cobrado_snapshot_check`: `valor_cobrado_snapshot IS NULL OR >= 0`.
- `mesa_sessions_origem_opened_by_coerente`: `(origem_abertura='admin_garcom') = (opened_by_admin_user_id IS NOT NULL)` — fecha o gap de auditoria (R10) já identificado na análise adversarial.
- `mesa_sessions_coerencia_estado`: `aberta` exige todos os campos de fechamento NULL; `fechada`
  exige todos preenchidos e (`valor=0` OU `payment_method` presente).
- `mesa_session_mesas_identificador_len`: 1–40 caracteres (mesmo limite de `orders.mesa_identificador`).
- Índice único parcial `mesa_session_mesas_uma_aberta_por_mesa_uniq (store_id, mesa_identificador) WHERE status_sessao='aberta'` — no máximo 1 sessão aberta por identificador de mesa, por loja. É o mecanismo central de concorrência, garantido pelo Postgres.
- Índice único parcial `mesa_sessions_request_id_uniq (request_id) WHERE request_id IS NOT NULL` — idempotência de abertura, preparado para a RPC futura.

## 3. RLS

Ambas as tabelas: `ENABLE ROW LEVEL SECURITY`, **zero `CREATE POLICY`** — mesmo padrão
"tabela de config" já usado neste domínio para `store_settings`/`active_tenant`/`admins`/
`super_admins`. Deny-all estrutural: nenhuma linha visível/gravável por nenhum papel sujeito a RLS.

## 4. REVOKE/GRANT

`REVOKE ALL ... FROM anon, authenticated` explícito nas 2 tabelas (defesa em profundidade, redundante
com o RLS, mesmo padrão redundante já usado nas tabelas de config citadas acima). As 4 funções de
trigger internas (prefixo `_`) recebem `REVOKE ALL ... FROM PUBLIC, anon, authenticated` — nenhuma
é chamável diretamente por ninguém além do dono da tabela (fecha a classe de erro já documentada
pela REF-SEC-02: "Supabase concede EXECUTE a anon/authenticated por padrão em função nova").
Nenhuma RPC pública foi criada nesta onda — só o owner (`postgres`/`service_role`) toca as tabelas.

## 5. Estratégia de tenant isolation

`store_id NOT NULL DEFAULT default_store_id()` + FK para `stores(id)` em ambas as tabelas. Na
tabela filha, um trigger `BEFORE INSERT` (`_mesa_session_mesas_check_store`) valida explicitamente
que `mesa_session_mesas.store_id` bate com o `store_id` real da `mesa_sessions` pai — rejeita
qualquer tentativa de associar uma mesa de uma loja a uma sessão de outra (defesa em profundidade,
mesma classe de proteção que a auditoria recomendou para `orders.store_id`/`mesa_session_id`,
aplicada aqui um passo antes). Testado e confirmado (caso B12).

## 6. Migration

`migrations/REF-MESA-02-onda2-fundacao-mesa-sessions.sql` — cria as 2 tabelas, constraints,
índices, RLS/REVOKE, e 4 triggers: `trg_mesa_sessions_no_reopen` (sessão fechada é imutável, nunca
reabre — decisão definitiva do dono), `trg_mesa_session_mesas_check_store` (isolamento cross-tenant),
`trg_mesa_session_mesas_immutable` (só `status_sessao` pode mudar depois de criada a associação),
`trg_mesa_sessions_sync_child_status` (sincroniza `status_sessao` em todas as mesas associadas
sempre que a sessão pai muda de status — já pronta para quando a RPC de fechamento existir).

## 7. Rollback

`migrations/REF-MESA-02-onda2-fundacao-mesa-sessions-rollback.sql` — `DROP TABLE` das 2 tabelas
(greenfield, nenhuma RPC grava nelas ainda) + `DROP FUNCTION` das 4 funções de trigger. **Testado de
verdade** (não só revisado): apliquei o rollback no E2E, confirmei que as 2 tabelas desapareceram,
reapliquei a migration direta, e confirmei que voltaram vazias — E2E ficou no estado "Onda 2
aplicada" ao final, pronto para a Onda 3.

## 8. Testes (E2E, `scripts/mesa-02-onda2-fundacao-test.mjs`, 27 casos)

Estrutural (6): colunas exatas das 2 tabelas, índices únicos parciais, RLS habilitada sem policy,
zero grants a anon/authenticated (tabelas e funções). Comportamental (21): estados válidos/inválidos
das 8 combinações de coerência; **junção de mesas** (2 identificadores diferentes na mesma sessão,
provado diretamente); isolamento entre tenants (mesmo identificador em lojas diferentes não
conflita); acesso cruzado bloqueado (store_id incoerente); imutabilidade (tentativa de mudar
`mesa_identificador`/`mesa_session_id` numa linha existente); sincronização de status
pai→filhas no fechamento; sessão fechada nunca reabre; identificador liberado após fechamento;
acesso direto via `anon`/`authenticated` (SELECT/INSERT nas 2 tabelas, chamada direta de função de
trigger) sempre `permission denied`.

Durante a escrita do teste encontrei e corrigi **2 bugs no meu próprio script** (não na migration):
um dado criado dentro de um `SAVEPOINT` sendo descartado antes de casos posteriores dependerem dele
(mesma lição já registrada na REF-MESA-01 Onda 1), e duas chamadas `expectError` compartilhando um
savepoint, onde a primeira falha "envenenava" a transação para a segunda — corrigido fazendo
`expectError` sempre operar em savepoint aninhado próprio.

**Resultado: 27/27.**

## 9. Regressão

| Suíte | Resultado |
|---|---|
| `mesa-01-onda1-fundacao-test.mjs` | 26/26 |
| `mesa-01-onda3-canal-qr-test.mjs` | 8/8 |
| `mesa-01-onda4-canal-admin-test.mjs` | 8/8 |
| `mesa-01-onda5-admin-orders-search-test.mjs` | 4/4 |
| `mesa-01-onda6-admin-reports-test.mjs` | 5/5 |
| `mesa-01-onda7-notificacoes-test.mjs` | 9/9 |
| `mesa-01-onda8-reconciliacao-test.mjs` (interseção Mesa × adicional_pagamento_fee) | 10/10 |
| `delivery-fee-05-onda1-onda2-test.mjs` | 29/29 |
| `mesa-02-onda2-fundacao-test.mjs` (novo) | 27/27 |
| `npm run test:domain` | verde, exit 0 |

**Total: 126/126** checks de banco + domain suite verde. Nenhuma regressão.

Nota operacional: durante esta onda, outra sessão deixou arquivos novos e não commitados no
working tree (`migrations/REF-DELIVERY-FEE-05-onda3-1-cache-tabela.sql` + rollback) — confirmei
(grep) que não tocam `create_order`/`admin_orders_search`/`mesa_sessions`/`mesa_session_mesas`, não
toquei nesses arquivos, e não interferem com nada desta onda.

## 10. Commit

Um commit próprio da Onda 2, sem squash, sem alterar histórico, **sem push**.

## 11. Confirmação: produção NÃO foi alterada

Migration e rollback aplicados/testados **exclusivamente** no projeto Supabase de E2E dedicado
(`db.e2e.env`, `bgzcrovskjbktdxkhemd`). Nenhum comando foi executado contra `db.env`/produção nesta
onda.

## 12. Riscos residuais

- **`mesa_identificador` continua texto livre** (sem catálogo formal de mesas físicas com id
  estável) — mesmo risco já herdado da REF-MESA-01, não resolvido nem agravado por esta onda; fica
  para a onda futura de "Mesas Físicas/Capability".
- **Consistência `status_sessao` depende do trigger, não de uma FK/CHECK direta**: um acesso direto
  ao banco por um papel com bypass de RLS (superuser/`service_role`, fora do alcance de RPC) poderia
  em teoria escrever `status_sessao` fora de sincronia com o pai sem passar pelo trigger de origem —
  risco de baixíssima severidade (exige acesso de superusuário, mesmo nível de confiança de qualquer
  outra função deste domínio), registrado por completude.
- **Nenhuma RPC ainda usa estas tabelas** — são inertes até a Onda de `abrir_sessao_mesa()`/
  `create_order()` integrado (mais adiante no plano de ondas da auditoria). Isso é esperado e
  deliberado para esta onda, não um gap.
- Achado do R8 da auditoria (junção de mesas) está **estruturalmente resolvido pela fundação**, mas
  a RPC de junção em si (`mesclar_sessoes`/equivalente) ainda não existe — só o schema está pronto
  para suportá-la sem retrofit.

---

**PARADO. Onda 3 não iniciada, aguardando nova autorização.**
