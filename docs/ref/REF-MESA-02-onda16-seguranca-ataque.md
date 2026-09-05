# REF-MESA-02 — Onda 16: Segurança/Ataque

**Status: CONCLUÍDA — 1 achado real corrigido.** Cada onda (2-15) já embutiu testes adversariais na
própria suíte (cross-tenant, outsider sem `is_admin_of`, `sem permissao`, etc.). Esta onda é uma
**varredura dedicada**, específica para achar o que ficou de fora dessas checagens onda-a-onda —
espelhando o rigor já usado para achar R3 na Onda 5.

## Achado real: `admin_reports_summary` com `EXECUTE` para `anon`/`PUBLIC`
A varredura de grants (item 1 do checklist) encontrou: `admin_reports_summary(date, date, uuid)`
tinha `EXECUTE` concedido a `PUBLIC`/`anon` **desde a criação original** (`REF-DASHBOARD-01`) —
nenhuma migration desde então (nem `REF-MESA-01` Onda 6, nem `REF-MESA-02` Onda 12, ambas
`CREATE OR REPLACE` da mesma função) jamais corrigiu isso, porque `CREATE OR REPLACE` sobre uma
função JÁ EXISTENTE **preserva** os grants atuais — só `DROP FUNCTION` + `CREATE` reseta (a mesma
mecânica documentada desde a Onda 6 desta REF). O gap veio de nunca ter sido corrigido na criação
original, não de nenhuma mudança desta REF.

**Impacto real medido antes de corrigir**: `is_admin_of(p_store_id)` dentro da função já bloqueava
`anon` de fato — testado diretamente (`SET LOCAL ROLE anon` + chamada real): `RAISE EXCEPTION
'apenas administradores desta loja podem ver relatorios'`. **Não houve vazamento de dado nenhuma
vez.** Mas é uma violação do padrão de defesa-em-profundidade já estabelecido neste domínio desde
`REF-SEC-02` ("EXECUTE público indevido" era exatamente essa classe de achado) — corrigido por ser
exatamente o tipo de gap que esta onda existe para achar, com correção de risco zero (só `REVOKE`,
nenhuma mudança de comportamento para qualquer chamador legítimo).

## Checklist executado
1. **Varredura de grants de TODAS as 21 funções desta REF** (Ondas 2-15), via
   `has_function_privilege()` ao vivo (não releitura de migration) — 8 internas (`_*`, zero grant),
   10 admin (só `authenticated`), 3 de convidado (`create_order`/`get_mesa_config`/
   `resolver_mesa_por_token`, `anon`+`authenticated` por design).
2. `resolver_mesa_por_token()` contra token UUID aleatório bem-formado que nunca existiu — falha
   genérica, sem crash.
3. Ataque combinado: outsider (sem NENHUM vínculo admin) tentando `admin_trocar_mesa_sessao`/
   `admin_juntar_mesa_sessao`/`admin_fechar_conta_mesa`/`admin_obter_url_storefront` usando o
   `p_store_id` E um `mesa_session_id` **REAIS** de uma loja alheia (não dados inventados) — os 4
   bloqueados por `is_admin_of`, nada mudou na sessão-alvo.
4. RLS/`REVOKE` direto nas tabelas — `authenticated` tentando `SELECT`/`INSERT` direto em
   `mesa_sessions`/`mesas` (bypassando toda RPC) recebe `permission denied` de verdade, não um
   resultado silenciosamente vazio.
5. **Concorrência maliciosa real**: 2 conexões Postgres separadas tentando `admin_fechar_conta_mesa`
   na MESMA sessão ao mesmo tempo — provado via `pg_locks` (mesma técnica robusta da Onda 6, nunca
   timing de promise) que uma das duas fica genuinamente bloqueada; confirmado que exatamente 1
   vence, a perdedora recebe `sessao ja fechada`, e a forma de pagamento gravada é da que
   REALMENTE venceu (nunca da perdedora).

## Testes
`scripts/mesa-02-onda16-seguranca-ataque-test.mjs` (novo, 34/34).

Migration + rollback testados de verdade (aplicado → `anon`/`PUBLIC` confirmados revogados →
rollback → grant antigo restaurado (confirmado) → reaplicado → revogado de novo confirmado).
Regressão da suíte original de `REF-DASHBOARD-01` (`dashboard01-admin-reports-test.mjs`, 13/13) e
da suíte de `REF-MESA-01` Onda 6 (5/5) confirmadas verdes após o `REVOKE`.

## Regressão completa
lint (0 erros, 60 warnings pré-existentes), typecheck limpo. Backend: MESA-01 (60/60) +
interseção (10/10) + MESA-02 onda2-15 (160/160) + onda16 (34/34) + DELIVERY-FEE-05 (29/29) +
`dashboard01-admin-reports-test` (13/13) = **306/306** checks de banco + `npm run test:domain`
verde.

## Produção
Não tocada. Migration aplicada SOMENTE no banco E2E dedicado (`db.e2e.env`, projeto `bgzcro`). A
correção (`REVOKE ALL ... FROM PUBLIC, anon`) é estritamente restritiva — zero mudança de
comportamento para `authenticated` (mantido) e nenhum caminho legítimo hoje chama essa função como
`anon`/guest (é um relatório interno do Admin). **Este achado também existe hoje em produção** (a
função lá tem o mesmo histórico de grants) — vale considerar aplicar essa mesma `REVOKE` em
produção independente do rollout do resto desta REF, já que é uma correção isolada de 1 linha sem
qualquer dependência do schema novo (`mesa_sessions` etc.).
