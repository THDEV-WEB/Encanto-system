# REF-MESA-02 — CHECKPOINT (ler primeiro numa nova sessão/retomada)

**Atualizado:** 2026-09-05, após commit `cd4b4ae` (Onda 15 concluída — 15 de 17 ondas do plano
mestre). Execução autônoma noturna
autorizada pelo dono do produto (2026-09-05, "quero ir dormir... deixar vc trabalhando a noite
toda") — sem pausa obrigatória entre ondas. Hard constraints seguem valendo integralmente: nunca
produção, nunca push, nunca reescrever histórico, 1 commit por subfase com `git add` explícito
(nunca `-A`/`.`), nunca tocar arquivo de outra sessão em andamento, parar de verdade só nos 8 STOP
conditions (perda de dado, tocar produção, conflito arquitetural irresolúvel, risco de vazamento
entre lojas, decisão de negócio fora do já decidido, arquivo de outra sessão, reescrever histórico,
falha de segurança séria).

**Se retomando após um corte**: rode `git log --oneline -20` e `git status --porcelain=v1` em
`C:\Projetos\Encanto\encanto-react` ANTES de qualquer coisa. Não repita trabalho já commitado.

## Estado do git (neste checkpoint)
```
cd4b4ae ref(mesa-02): implementa impressao do QR da mesa                   <- Onda 15
e23d85e test(mesa-02): confirma notificacoes agnosticas a sessao (Onda 14)
77ee4a0 test(mesa-02): confirma fidelidade agnostica a mesa/sessao (Onda 13)
f85f0ba docs(mesa-02): atualiza checkpoint apos Onda 12, detalha Onda 13
3ebe323 ref(mesa-02): corrige BI de forma de pagamento pra pedidos de mesa (R7) <- Onda 12
83784c7 ref(mesa-02): implementa fechamento da conta de mesa               <- Onda 11
0861d65 ref(mesa-02): implementa juncao de mesas                          <- Onda 10
fc8d7da ref(mesa-02): implementa troca de mesa de sessao aberta            <- Onda 9
d144a29 ref(mesa-02): adiciona consulta do total corrente da mesa (conta)   <- Onda 8
4a8d917 ref(mesa-02): adiciona adicionais pagos ao formulario do garcom     <- Onda 7
f489603 ref(mesa-02): implementa abertura implicita da sessao de mesa       <- Onda 6
000f43a ref(mesa-02): protege QR por token -- resolve R3                    <- Onda 5
cc779c0 ref(mesa-02): implementa catalogo de mesas fisicas + aba Admin       <- Onda 4
2c4da86 ref(mesa-02): adiciona relacao orders.mesa_session_id                <- Onda 3
b2d1ef8 ref(mesa-02): cria fundacao de mesa_sessions                         <- Onda 2
96724b9 docs(mesa): REF-MESA-02 Onda 1 -- precheck (BLOQUEADO, depois resolvido)
c076591 ref(mesa-02): reconcilia REF-MESA-01 com REF-DELIVERY-FEE-05
475cfef docs(mesa): REF-MESA-02 Onda 0 -- auditoria completa
```
Ondas 0-15 concluídas (de 17 do plano mestre). Faltam: 16 (segurança/ataque), 17 (regressão
completa final). R3 (achado mais grave da auditoria, QR previsível) já **resolvido** na Onda 5.
R7 (BI de forma de pagamento pra mesa) já **resolvido** na Onda 12.
Todos LOCAIS, `origin/main` não avançou (ainda só `e972e1a`, ver `encanto-ref-mesa-01.md`). Working
tree sempre tem 2 arquivos de OUTRAS sessões (nunca tocar): `src/constants/privacyPolicy.js`
(modificado) e `scripts/loadtest-e2e.mjs` (untracked). Outras sessões seguem ativas neste mesmo
repo (REF-DELIVERY-FEE-05 chegou até a Onda 3 hoje) — sempre `git status`/checar drift antes de
tocar `create_order()`/`admin_orders_search()`/`_resolve_delivery_fee()` de novo.

## O que já existe (não recriar)
- **mesa_sessions** (Onda 2): estado da conta (aberta/fechada), sem coluna escalar de mesa.
- **mesa_session_mesas** (Onda 2): associação N:1 mesa física↔sessão — suporta junção de mesas
  desde a fundação. Índice único parcial `(store_id, mesa_identificador) WHERE status_sessao='aberta'`
  é o mecanismo central de concorrência.
- **orders.mesa_session_id** (Onda 3): FK nullable, imutável uma vez gravada (nunca reatribuída/
  limpa), cross-tenant validado por trigger.
- **public.mesas** (Onda 4): catálogo físico por loja (`identificador`, `status`
  disponível/indisponível, `qr_token` desde a Onda 5). "Ocupada" é sempre derivada de
  `mesa_session_mesas`, nunca persistida. RPCs: `admin_listar_mesas`/`admin_criar_mesa`/
  `admin_set_mesa_status`. Aba "Mesas" no Admin (`AdminMesas.jsx` + `mesasFisicas.js`) — cadastro,
  toggle status, ver conta, trocar/juntar mesa, fechar conta, QR — todas já implementadas.
- **QR protegido (Onda 5 — resolve R3, achado mais grave da auditoria)**: `mesas.qr_token` (uuid
  opaco). `resolver_mesa_por_token()` (RPC pública). `create_order()` EXIGE o token pro canal
  `qr_mesa` e ignora `mesa_identificador` do payload nesse canal. Frontend: `?mesa_token=<uuid>`
  (não mais `?mesa=<numero>`), `useMesaFromQuery.js` resolve server-side antes de aplicar.
- **Abertura implícita (Onda 6)**: capability `mesa_sessao_habilitada` (4º parâmetro de
  `get/set_mesa_config`, default false). `_get_or_open_mesa_session()` (função interna) resolve/abre
  a sessão via `unique_violation` como árbitro de concorrência (provado com 2 conexões reais +
  `pg_locks`). `create_order()` grava `orders.mesa_session_id` quando `tipo_pedido='mesa'` +
  `mesa_sessao_habilitada=true` + `origem_pedido IN ('qr_mesa','admin_garcom')`.
- **create_order()/admin_orders_search()**: já passaram por 3 `CREATE OR REPLACE` desde a
  reconciliação (Ondas 5 e 6 desta REF) — sempre confirmar a versão AO VIVO no E2E antes de tocar de
  novo (não presumir o texto de nenhum arquivo de migration como "o atual" sem reconferir).
- **Adicionais pagos no garçom (Onda 7)**: `NovoPedidoMesaModal.jsx` reaproveita `utils/addons.js`
  (mesmas funções puras do checkout do cliente) e `DS.getAllAds()` (já existia desde REF-SAAS-01
  Onda 5). 100% frontend — `create_order()`/`_resolve_item_pricing` não mudaram.
- **Consulta da conta (Onda 8)**: `admin_consultar_conta_mesa(p_mesa_identificador, p_store_id)`
  (`STABLE`, só leitura) — devolve `{ok, aberta, sessao_id, mesas:[...], pedidos:[{id,
  status,total,itens:[...]}], total}`. `total` exclui pedidos `cancelado` mas eles continuam na
  lista `pedidos`. `mesas` é array (suporta junção). Botão "🧾 Ver conta" em `AdminMesas.jsx` (só
  quando `m.ocupada`).
- **Troca de mesa (Onda 9)**: `admin_trocar_mesa_sessao(p_mesa_session_id, p_novo_identificador,
  p_store_id)` — INSERT linha nova em `mesa_session_mesas` + UPDATE `status_sessao='fechada'` na
  linha antiga (a ÚNICA escrita direta nessa coluna fora da trigger de sincronização desde a Onda
  2). Histórico completo preservado. Lock `FOR UPDATE` na sessão.
- **Junção de mesas (Onda 10)**: `admin_juntar_mesa_sessao(p_mesa_session_id,
  p_identificador_adicional, p_store_id)` — igual à Onda 9 mas SEM fechar a linha antiga (2+ mesas
  ficam ocupadas pela mesma sessão). Só junta mesa LIVRE — fundir 2 sessões já ativas é fora de
  escopo (bloqueado por `orders.mesa_session_id` imutável, Onda 3).
- **Fechamento (Onda 11)**: `admin_fechar_conta_mesa(p_mesa_session_id, p_payment_method,
  p_store_id)` — grava `payment_method`/`valor_cobrado_snapshot` (auditoria, nunca 2ª fonte de
  receita), `UPDATE status='fechada'` dispara a trigger da Onda 2 que libera TODAS as mesas
  associadas. Forma de pagamento só obrigatória se total>0. `_calcular_total_sessao_mesa()` (função
  interna) reaproveitada também por `admin_consultar_conta_mesa`.
- **Relatório/reconciliação (Onda 12 — resolve R7)**: `admin_reports_summary::por_pagamento` usa
  `mesa_sessions.payment_method` (forma REAL) para sessão fechada; sessão aberta vira bucket
  `(conta em aberto)`. Sem mudança para entrega/retirada/mesa sem sessão. `total_receita` continua
  `SUM(orders.total)` — `valor_cobrado_snapshot` nunca somado (provado por teste numérico).
- **Fidelidade (Onda 13 — confirmação, zero mudança de código)**: `loyalty_grant`/
  `loyalty_void_on_cancel` são 100% agnósticas a `mesa_session_id`, confirmado com teste real (1
  selo por pedido, nunca por sessão; fechar conta não mexe em selo nenhum).
- **Notificações (Onda 14 — confirmação, zero mudança de código)**: `trg_enc_order_notify` só
  dispara em `orders.status`, nunca em `mesa_sessions` — abrir/fechar sessão não enfileira nada
  por si só. Troca de mesa não contamina notificação já enfileirada (histórico imutável).
- **Impressão do QR (Onda 15)**: `admin_obter_url_storefront(p_store_id)` (nova RPC) resolve a URL
  pública da loja no servidor (`stores.dominio` se setado, senão `<slug>.lojas.
  valionsistemas.com.br` — nunca o padrão legado). Botão "🔲 QR" em toda mesa gera o QR via nova
  dependência `qrcode` (lib padrão, browser-only no bundle) + link exibido por extenso + "Imprimir"
  reaproveitando `printComanda()` já existente sem mudança.

## Suítes de teste ativas (rodar sempre antes de commitar qualquer onda nova)
```
scripts/mesa-01-onda1-fundacao-test.mjs         26/26
scripts/mesa-01-onda3-canal-qr-test.mjs          8/8
scripts/mesa-01-onda4-canal-admin-test.mjs       8/8
scripts/mesa-01-onda5-admin-orders-search-test.mjs 4/4
scripts/mesa-01-onda6-admin-reports-test.mjs     5/5
scripts/mesa-01-onda7-notificacoes-test.mjs      9/9
scripts/mesa-01-onda8-reconciliacao-test.mjs    10/10
scripts/mesa-02-onda2-fundacao-test.mjs         27/27
scripts/mesa-02-onda3-orders-fk-test.mjs         8/8
scripts/mesa-02-onda4-mesas-fisicas-test.mjs    11/11
scripts/mesa-02-onda5-qr-protegido-test.mjs     12/12
scripts/mesa-02-onda6-abertura-implicita-test.mjs 12/12
scripts/mesa-02-onda7-adicionais-garcom-test.mjs  3/3
scripts/mesa-02-onda8-consulta-conta-test.mjs    12/12
scripts/mesa-02-onda9-trocar-mesa-test.mjs       14/14
scripts/mesa-02-onda10-juntar-mesas-test.mjs     13/13
scripts/mesa-02-onda11-fechar-conta-test.mjs     13/13
scripts/mesa-02-onda12-relatorio-reconciliacao-test.mjs 10/10
scripts/mesa-02-onda13-fidelidade-confirmacao-test.mjs  12/12
scripts/mesa-02-onda14-notificacoes-confirmacao-test.mjs 8/8
scripts/mesa-02-onda15-impressao-qr-test.mjs      5/5
scripts/delivery-fee-05-onda1-onda2-test.mjs    29/29
npm run test:domain                             verde
npm run lint / typecheck / build / build:admin  limpos
e2e/tests/admin/admin-pedidos-novo-mesa.spec.js  2/2 (Playwright, ambiente E2E configurado)
```
Total: 259 checks de banco + domain suite + builds + E2E. Banco-alvo: SOMENTE
`C:/Users/00thi/.encanto/db.e2e.env` (bgzcro), NUNCA `db.env`/produção.

## Lições aprendidas HOJE sobre os próprios scripts de teste (não repetir)
1. Dado criado dentro de um `withSavepoint()` some no `ROLLBACK TO SAVEPOINT` daquele bloco — nunca
   depender dele em um bloco posterior. Crie fora de qualquer savepoint o que precisa sobreviver.
2. `expectError()`/qualquer captura de exceção esperada PRECISA rodar num savepoint aninhado próprio
   e só fazer `ROLLBACK TO SAVEPOINT` quando HOUVE erro (nunca no sucesso, senão desfaz o efeito que
   os checks seguintes esperam ver).
3. Ao pegar 2 usuários de `auth.users` para simular "admin" vs "outsider": `LIMIT 2`, não `LIMIT 1`
   (bug real cometido na Onda 4 — `LIMIT 1` faz a 2ª identidade colapsar na 1ª silenciosamente).
   Para um outsider "sem NENHUM vínculo admin", prefira um `sub` totalmente novo (`randomUUID()`),
   não uma linha real de `auth.users` que pode legitimamente ganhar vínculo em outro caso do mesmo
   arquivo.
4. **`DROP FUNCTION` + `CREATE` sempre precisa de `REVOKE EXECUTE ... FROM PUBLIC`/`FROM anon`
   explícito antes do `GRANT` ao papel certo** — Supabase concede `EXECUTE` a `PUBLIC` por padrão em
   função NOVA do schema `public` (já documentado pela REF-SEC-02) — vale pra QUALQUER função nova,
   não só DROP+CREATE. Bug real cometido na Onda 6 ao trocar a assinatura de `set_mesa_config` —
   pego pela própria suíte de regressão antes do commit. **Sempre rodar a suíte de regressão
   completa (não só a da onda atual) antes de qualquer commit**.
5. Timing de promise (`setTimeout` + race) pra provar bloqueio de lock é **flaky** contra latência
   real de rede até um Postgres hospedado — prefira consultar `pg_locks`/`pg_stat_activity`
   diretamente (via uma 3ª conexão livre) pra confirmar `granted=false` de verdade.
6. Antes de criar QUALQUER método novo em `DataService.js` (ou qualquer "novo" helper de domínio),
   grep primeiro — `DS.getAllAds()` já existia (REF-SAAS-01 Onda 5) e eu quase dupliquei. Domínio
   compartilhado tem allowlist de consumidores em `tests/deps.audit.mjs` (D1) — todo novo
   consumidor precisa entrar nessa lista NO MESMO commit. Mudança de fluxo de UI exige atualizar o
   spec E2E existente na hora.
7. RPC `RETURNS TABLE` chamada num script de teste: usar `SELECT * FROM funcao(...)` (colunas
   reais), NUNCA `SELECT funcao(...) AS res` — isso serializa como composite-string
   (`"(a,b,c)"`), não como objeto (bug cometido na Onda 15, `admin_listar_mesas`).
8. Ao decidir uma escrita direta numa coluna que outra onda documentou como "só a trigger escreve"
   (ex.: `status_sessao`), é uma exceção deliberada e válida (Onda 9) — documentar explicitamente
   PORQUE a exceção existe, não silenciosamente contrariar o comentário antigo.

## PRÓXIMO PASSO EXATO — Onda 16: Segurança/ataque (auditoria adversarial dedicada)

Objetivo: cada onda (2-15) já embutiu testes adversariais na própria suíte (cross-tenant, outsider
sem `is_admin_of`, `sem permissao`, etc.) — esta onda é uma VARREDURA DEDICADA, específica pra achar
o que ficou de fora dessas checagens onda-a-onda, espelhando o rigor já usado pra achar R3 (Onda 5).
**Não deveria precisar de nenhuma migration** (é auditoria + teste, correção só SE algo for achado).

Checklist mínimo pra `scripts/mesa-02-onda16-seguranca-ataque-test.mjs`:
1. **Varredura de GRANTS de TODAS as funções novas desta REF** (Ondas 2-15) — consultar
   `information_schema.routine_privileges`/`pg_proc`+`aclexplode` e confirmar, pra CADA uma:
   `anon` e `PUBLIC` NUNCA têm `EXECUTE`, só `authenticated` (ou nenhum GRANT pras funções
   internas `_*`, que devem ter ZERO grants, nem pra `authenticated`). Isso é exatamente o tipo de
   bug que a Onda 6 quase deixou passar (lição 4 acima) — a varredura automatizada evita depender
   de lembrar de conferir onda a onda.
2. **`resolver_mesa_por_token()` continua fail-closed contra token forjado/aleatório** (não só o
   teste feliz da Onda 5) — token válido de OUTRA loja, token bem-formado mas inexistente, token
   nulo/vazio.
3. **`admin_trocar_mesa_sessao`/`admin_juntar_mesa_sessao`/`admin_fechar_conta_mesa`**: confirmar
   que NENHUMA delas aceita `p_store_id` de uma loja e `p_mesa_session_id`/mesa de OUTRA (já hà
   teste disso onda-a-onda, mas confirmar aqui com uma sessão real tentando "vazar" pra outro
   tenant via múltiplos parâmetros ao mesmo tempo, não só 1 por vez).
4. **`admin_obter_url_storefront`**: confirmar que não vaza `dominio`/`slug` de loja alheia sob
   nenhuma combinação de parâmetros.
5. **RLS deny-all continua intacto** em `mesas`/`mesa_sessions`/`mesa_session_mesas` — `authenticated`
   tentando `SELECT`/`INSERT`/`UPDATE` DIRETO nessas tabelas (bypassando toda RPC) continua batendo
   em `permission denied` (não em RLS silenciosamente vazio — a defesa aqui é o `REVOKE ALL`, não
   política de RLS, então confirmar que é `permission denied`, não 0 linhas).
6. **Concorrência maliciosa**: 2 conexões tentando fechar a MESMA sessão ao mesmo tempo — confirmar
   que só uma vence (a outra recebe `sessao ja fechada`, nunca um estado inconsistente/2 fechamentos
   registrados). Reaproveitar a técnica de `pg_locks` da Onda 6 (lição 5), não timing de promise.
7. Se QUALQUER achado real aparecer: decidir a correção como uma sub-migration desta mesma onda
   (`REF-MESA-02-onda16-<slug>.sql`), nunca deixar um achado de segurança sem correção só
   documentado.

Depois da Onda 16, a última: **Onda 17 (regressão completa final)** — não é uma feature nova, é
rodar TODAS as suítes acima mais uma vez do zero (útil pra pegar qualquer drift acumulado ao longo
da noite), confirmar `git log`/`git status` finais, e escrever um relatório de fechamento
(`docs/ref/REF-MESA-02-relatorio-final.md`, mesmo padrão de `REF-MESA-01-relatorio-final.md`) —
aí sim a REF inteira (17 de 17 ondas) está concluída, ainda sem push/produção (autorização de
push é decisão separada, sempre perguntar antes).

Fluxo de sempre, sem pular etapa: investigar/decidir → migration+rollback (se precisar de banco) →
aplicar SOMENTE E2E → testar (backend E2E + regressão completa de TODAS as suítes acima, sempre) →
frontend quando a onda pedir → lint/typecheck/build → documentar
(`docs/ref/REF-MESA-02-ondaN-<slug>.md`) → `git add` explícito (nunca `-A`) → commit →
**atualizar este checkpoint** → próxima onda, sem pausa. Sempre reconferir `git status`/drift de
outras sessões antes de tocar `create_order()`/`admin_orders_search()`/`_resolve_delivery_fee()`
de novo — este repositório tem múltiplas sessões ativas simultaneamente (confirmado várias vezes
nesta mesma noite).
