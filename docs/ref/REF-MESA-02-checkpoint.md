# REF-MESA-02 — CHECKPOINT (ler primeiro numa nova sessão/retomada)

**Atualizado:** 2026-09-05, após commit `fc8d7da` (Onda 9 concluída — 9 de 17 ondas do plano
mestre). Execução autônoma noturna
autorizada pelo dono do produto (2026-09-05, "quero ir dormir... deixar vc trabalhando a noite
toda") — sem pausa obrigatória entre ondas. Hard constraints seguem valendo integralmente: nunca
produção, nunca push, nunca reescrever histórico, 1 commit por subfase com `git add` explícito
(nunca `-A`/`.`), nunca tocar arquivo de outra sessão em andamento, parar de verdade só nos 8 STOP
conditions (perda de dado, tocar produção, conflito arquitetural irresolúvel, risco de vazamento
entre lojas, decisão de negócio fora do já decidido, arquivo de outra sessão, reescrever histórico,
falha de segurança séria).

**Se retomando após um corte**: rode `git log --oneline -15` e `git status --porcelain=v1` em
`C:\Projetos\Encanto\encanto-react` ANTES de qualquer coisa. Não repita trabalho já commitado.

## Estado do git (neste checkpoint)
```
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
Ondas 0-9 concluídas (de 17 do plano mestre). R3 (achado mais grave da auditoria, QR previsível) já
**resolvido** na Onda 5.
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
  `admin_set_mesa_status`. Aba "Mesas" no Admin (`AdminMesas.jsx` + `mesasFisicas.js`) já existe e
  funciona (cadastrar/listar/toggle status) — AINDA NÃO mostra/imprime o QR (onda futura de
  impressão) nem tela de conta/fechamento (ondas futuras).
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
- **Adicionais pagos no garçom (Onda 7)**: `NovoPedidoMesaModal.jsx` agora tem passo de seleção de
  adicionais antes de confirmar item no resumo, reaproveitando `utils/addons.js` (as MESMAS funções
  puras do checkout do cliente — `resolverAdicionais/ehAdicionalGratis/cotaGratis/
  resolverPrecoAdicionais`) e `DS.getAllAds()` (já existia desde REF-SAAS-01 Onda 5, não recriar).
  100% frontend — `create_order()`/`_resolve_item_pricing` não mudaram (já aceitavam adicionais).
- **Consulta da conta (Onda 8)**: `admin_consultar_conta_mesa(p_mesa_identificador, p_store_id)`
  (nova, `STABLE`, só leitura) — devolve `{ok, aberta, sessao_id, mesas:[...], pedidos:[{id,
  status,total,itens:[...]}], total}`. `total` exclui pedidos `cancelado` (mesmo critério do BI,
  REF-DASHBOARD-01) mas eles continuam na lista `pedidos`. `mesas` já é array (suporta junção da
  Onda 10 sem mudar formato). `mesasFisicas.js::consultarContaMesa()` + botão "🧾 Ver conta" em
  `AdminMesas.jsx` (só aparece quando `m.ocupada`). Aditiva pura, não mexeu em `create_order()`.
- **Troca de mesa (Onda 9)**: `admin_trocar_mesa_sessao(p_mesa_session_id, p_novo_identificador,
  p_store_id)` — INSERT linha nova em `mesa_session_mesas` + UPDATE `status_sessao='fechada'` na
  linha antiga (a ÚNICA escrita direta nessa coluna fora da trigger de sincronização desde a Onda
  2 — decisão documentada na migration). Histórico completo preservado (linha antiga não é
  apagada). Lock `FOR UPDATE` na sessão (mesmo padrão de `_get_or_open_mesa_session`). Seletor
  "Trocar de mesa" no modal de conta (`AdminMesas.jsx`).

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
scripts/delivery-fee-05-onda1-onda2-test.mjs    29/29
npm run test:domain                             verde
npm run lint / typecheck / build / build:admin  limpos
e2e/tests/admin/admin-pedidos-novo-mesa.spec.js  2/2 (Playwright, ambiente E2E configurado)
```
Total: 198 checks de banco + domain suite + builds + E2E. Banco-alvo: SOMENTE
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
   função NOVA do schema `public` (já documentado pela REF-SEC-02). Bug real cometido na Onda 6 ao
   trocar a assinatura de `set_mesa_config` — pego pela própria suíte de regressão (checagem
   explícita de grants) antes do commit, mas quase passou despercebido. **Sempre rodar a suíte de
   regressão completa (não só a da onda atual) antes de qualquer commit** — foi exatamente essa
   disciplina que pegou o problema.
5. Timing de promise (`setTimeout` + race) pra provar bloqueio de lock é **flaky** contra latência
   real de rede até um Postgres hospedado — prefira consultar `pg_locks`/`pg_stat_activity`
   diretamente (via uma 3ª conexão livre) pra confirmar `granted=false` de verdade, em vez de inferir
   pelo tempo de resolução da promise.
6. Antes de criar QUALQUER método novo em `DataService.js` (ou qualquer "novo" helper de domínio),
   grep primeiro — `DS.getAllAds()` já existia (REF-SAAS-01 Onda 5) e eu quase dupliquei (pego pelo
   `no-dupe-keys` do lint na Onda 7, mas não deveria depender disso). Domínio compartilhado
   (`utils/addons.js`, etc.) tem allowlist de consumidores em `tests/deps.audit.mjs` (D1) — todo novo
   consumidor precisa entrar nessa lista NO MESMO commit, nunca contornar o guard. E qualquer mudança
   de fluxo de UI (passo intermediário novo, etc.) exige atualizar o spec E2E existente na hora, nunca
   deixar quebrado/skip.

## PRÓXIMO PASSO EXATO — Onda 10: Junção de mesas

Objetivo: adicionar uma mesa física LIVRE a uma sessão já aberta (grupo grande ocupa a mesa 5 e
pede pra juntar a mesa 6 vazia) — as duas mesas passam a apontar pra MESMA sessão/conta, ambas
"ocupadas" simultaneamente. É exatamente o caso de uso pra que `mesa_session_mesas` foi desenhada
como N:1 desde a Onda 2 ("suporta junção de mesas desde a fundação").

**Escopo deliberadamente limitado (decidir e documentar, não parar)**: só é permitido juntar uma
mesa que esteja LIVRE (catálogo `disponivel`, sem sessão aberta própria) — **NÃO** é escopo desta
onda fundir DUAS sessões que já têm pedidos independentes cada uma. Motivo: `orders.mesa_session_id`
é imutável desde a Onda 3 ("nunca reatribuída/limpa") — mover pedidos já existentes de uma sessão
pra outra violaria essa invariante. Se um "merge de duas contas já ativas" for pedido depois, é uma
decisão de produto nova que exige reconsiderar essa invariante — registrar como gap, não inventar
agora.

Implementação (quase idêntica à Onda 9, sem o passo de fechar a linha antiga):
1. Nova RPC `admin_juntar_mesa_sessao(p_mesa_session_id, p_identificador_adicional, p_store_id)`
   (SECURITY DEFINER, `is_admin_of` + `WHERE store_id` explícito).
2. Lock a sessão (`SELECT ... FOR UPDATE`, mesmo padrão das Ondas 6/9) — confirma `aberta`.
3. Confirma `p_identificador_adicional` existe no catálogo e está `disponivel` (mesma regra da
   Onda 4/9).
4. Se a mesa já estiver juntada a ESTA MESMA sessão, no-op amigável (mesmo padrão do "trocar pra
   mesma mesa" da Onda 9).
5. `INSERT` linha nova em `mesa_session_mesas` — índice único parcial da Onda 2 arbitra
   concorrência via `unique_violation` (`mesa ja ocupada`), mesmo mecanismo de sempre. **Diferença
   da Onda 9: NÃO fecha nenhuma linha existente** — as mesas antigas continuam `aberta`, é isso
   que faz as duas ficarem "ocupadas" ao mesmo tempo pela mesma conta.
6. Retorna `{ok:true, mesa_session_id, mesas:[...todos os identificadores abertos]}`.

Frontend: no modal de conta (`AdminMesas.jsx`), ação "Juntar mesa" ao lado de "Trocar de mesa"
(Onda 9) — mesmo componente de seleção, reaproveitar o filtro de mesas livres já escrito lá.

Depois da Onda 10, seguir literalmente a ordem do plano mestre (mensagem do dono, seção 32):
Onda 11 (fechamento) → 12 (relatório/reconciliação) → 13 (fidelidade, só testes de confirmação) →
14 (notificações) → 15 (impressão QR) → 16 (segurança/ataque) → 17 (regressão completa).

Fluxo de sempre, sem pular etapa: investigar/decidir → migration+rollback (se precisar de banco) →
aplicar SOMENTE E2E → testar (backend E2E + regressão completa de TODAS as suítes acima, sempre) →
frontend quando a onda pedir → lint/typecheck/build → documentar
(`docs/ref/REF-MESA-02-ondaN-<slug>.md`) → `git add` explícito (nunca `-A`) → commit →
**atualizar este checkpoint** → próxima onda, sem pausa. Sempre reconferir `git status`/drift de
outras sessões antes de tocar `create_order()`/`admin_orders_search()`/`_resolve_delivery_fee()`
de novo — este repositório tem múltiplas sessões ativas simultaneamente (confirmado várias vezes
nesta mesma noite).
