# ADR HARDEN-ORDERS-RLS — Endurecimento de RLS das tabelas de pedido

- **Status:** 🔒 **CONGELADO (2026-06-30)** — decisões **D-RPC/D-ANON-READ/D-GRANTS/D-VIEW ratificadas** pelo usuário; recon read-only concluído. Execução do runbook (§6) **autorizada**. Extraído do NORM-06.1 (D2). Trilha de pedidos: HARDEN-01..07 → **este**.
- **Escopo:** `orders`, `customers`, `order_items`, `order_events`, `addresses`, e a view `v_order_reconciliation`. Toca o **caminho do checkout** (código de negócio) → rito design→congelar→executar, com revisão extra.
- **Objetivo:** fechar o **vazamento de privacidade**: hoje qualquer `anon` lê/edita/apaga **todos** os pedidos (nomes, telefones, endereços). Alvo: `anon` só **cria** pedido (via RPC) e, opcionalmente, lê **o próprio**; `authenticated` (admin) acessa tudo.

---

## 0. Ground truth (recon read-only, 2026-06-30, banco `hvbcdxsagkjtfjwvnslo`)

**Vazamento (confirmado, TOTAL):**

| Tabela | Policy atual | Grants anon | RLS |
|---|---|---|---|
| `orders` | `Allow all operations` **ALL public USING(true) WITH CHECK(true)** | ALL | on |
| `customers` | `Allow all operations` ALL public true/true | ALL | on |
| `order_items` | `Allow all operations` ALL public true/true | ALL | on |
| `order_events` | `order_events_read_auth` SELECT authenticated | ALL | on |
| `addresses` | **nenhuma policy** (RLS on → sem acesso PostgREST) | ALL | on |
| `v_order_reconciliation` (view) | — | **SELECT** | **`security_invoker` ausente → roda como owner, BYPASSA RLS** |

> **Correção à memória:** a nota "anon revogado" (HARDEN-07) **não se confirma** — `anon` mantém grants `ALL` em todas as tabelas de pedido. Hoje o **único** gate é a policy RLS, e ela é `USING(true)`. **Além disso**, `v_order_reconciliation` (sem `security_invoker`) com `SELECT` do anon vaza `order_id/total/diff` de todos os pedidos. `order_logs` já é `security_invoker=true` (ok).

**Colunas sensíveis (PII):** `customers.name/phone`; `orders.address/observacoes`; `order_items.observacoes`; `addresses.rua/numero/bairro/cidade/complemento` (0 linhas); `order_events.payload` (snapshots).

**Fluxo de escrita (checkout):** `anon` cria pedido **exclusivamente** via RPC `create_order` (`DS.savePedido`, [App.jsx:320-335](../../src/App.jsx#L320)); callsite único em [App.jsx:1089-1106](../../src/App.jsx#L1089). **Nenhum** INSERT/UPDATE/DELETE/SELECT direto do anon nas tabelas de pedido. `create_order` é **`SECURITY INVOKER`** (`prosecdef=false`, sem `SET search_path`); só insere hoje porque a policy `Allow all` permite — corpo todo qualificado (`public.*`), sem SQL dinâmico, sem `auth.uid()`. Idempotência: `orders.request_id` + índice único parcial `orders_request_id_uniq` (sem tabela `idempotency_keys`); leitura idempotente **dentro** da função.

**Fluxo de leitura:** **não existe** consulta do próprio pedido pelo cliente — a "barra de status" da SuccessPage é cosmética (estado React, não lê o banco; [App.jsx:1196-1258](../../src/App.jsx#L1196)). **Todas** as leituras de pedido são **admin-only** (`authenticated`): `DS.getPedidos` (`orders` + JOIN `customers(name,phone)` + `order_items`, [App.jsx:336-341](../../src/App.jsx#L336)), `DS.setStatus` (UPDATE orders), `DS.getHealth` (RPC `orders_health`). Cliente e admin compartilham **um** `db` singleton (anon key); admin difere só por ter sessão JWT (`signInWithPassword`). **Identificador de "meu pedido" hoje: nenhum retido** — `create_order` retorna `order_id` mas o callsite ignora; `request_id` (durável em localStorage) é apagado no sucesso ([App.jsx:1133-1134](../../src/App.jsx#L1133)).

**Já compatível com endurecimento:** as 6 triggers de auditoria e `reconcile_orders`/`reconcile_and_alert`/`orders_health`/`check_alert_thresholds`/`purge_old_logs`/`send_alert` já são `SECURITY DEFINER` (owner postgres) → continuam funcionando sob RLS endurecida. `anon` **não** tem EXECUTE nessas (só em `create_order`, `normalize_phone`, `get_setting`).

---

## 0.1 Fatos ratificados pelo recon (registro explícito no congelamento)

Comprovados pela investigação read-only de 2026-06-30 (evidências em [src/App.jsx](../../src/App.jsx)) e fixados como base desta fase:

1. **Não existe** funcionalidade de acompanhamento de pedidos pelo cliente. A barra de status da `SuccessPage` ([App.jsx:1234-1250](../../src/App.jsx#L1234)) é **apenas placeholder visual**: `statusIdx` é fixo em `0` (`setStatusIdx` nunca é chamado — única ocorrência é a declaração em [App.jsx:1200](../../src/App.jsx#L1200)) e **não realiza nenhuma leitura do banco**. `SuccessPage` recebe só `{msg, cart, onBack}` — nenhum `order_id`.
2. **O painel administrativo é interface exclusiva para usuários autenticados** (`mode==='admin'` só após `signInWithPassword` com sessão, [App.jsx:1271-1283](../../src/App.jsx#L1271)/[3854-3855](../../src/App.jsx#L3854)) e **continuará sendo a única interface de gestão de pedidos nesta fase**. A futura remoção da **engrenagem** do cabeçalho ([App.jsx:3082-3084](../../src/App.jsx#L3082)) é **apenas** alteração de acesso ao Admin (há outros 2 caminhos: 5-cliques-na-logo [3035-3046](../../src/App.jsx#L3035) e hash `#admin-encanto` [3845](../../src/App.jsx#L3845)) — **não faz parte deste hardening**.
3. **A futura funcionalidade de acompanhamento será feature independente, com ADR próprio**, via **RPC de escopo mínimo + prova de posse** (tracking token / order token / equivalente), **sem reabrir acesso direto** às tabelas de pedido.
4. **Objetivo desta fase: eliminar a exposição pública dos pedidos preservando integralmente o comportamento funcional existente.** Não introduz novas funcionalidades nem altera a experiência atual do cliente.

## 1. Objetivo, escopo e não-objetivos

**Objetivo:** `anon` deixa de ter acesso direto às tabelas de pedido; o checkout passa a ser a **única** porta (RPC `create_order`), que vira `SECURITY DEFINER`; `authenticated` (admin) mantém acesso pleno; a view vazadora é fechada.

**Não-objetivos (extraídos):**
- Particionamento de `orders`/`idempotency_keys` desacoplado (NORM-06A §3.3 / HARDEN-08) — reserva.
- Construir a UI de **acompanhamento self-service** do cliente — é **feature nova** (ver §5; arquitetura desenhada aqui, implementação em ADR/feature própria).
- Mexer em RLS de catálogo (já feito na NORM-06.1) ou em `application_logs` (já endurecido).

---

## 2. Alternativas e trade-offs

### 2.1 Como o `anon` cria pedido sem policy de tabela

| Opção | Descrição | Trade-off |
|---|---|---|
| **A — RPC `SECURITY DEFINER`** ✅ recomendada | `create_order` vira DEFINER (roda como owner, bypassa RLS); remover policies `Allow all`; anon sem policy de tabela | Porta única e auditável; idempotência intacta; mesmo padrão da F1B-errata. Contra: `current_user` nos logs vira `postgres` (cosmético) |
| B — manter INVOKER + policy `INSERT WITH CHECK` p/ anon | anon mantém INSERT direto gateado por WITH CHECK | Reabre escrita direta de tabela ao anon (maior superfície); não dá pra validar invariantes transacionais como a RPC faz; **rejeitada** |

### 2.2 Estratégia "cliente lê só o próprio pedido" (sem `auth.uid()` — anon não tem usuário)

| Opção | Descrição | Trade-off |
|---|---|---|
| **A — Sem leitura anon (fechar; tracking adiado)** ✅ recomendada p/ ESTA fase | anon = zero leitura; acompanhamento via WhatsApp (canal atual) | **Zero mudança de comportamento** (não há tracking hoje); menor superfície; entrega a correção de segurança já. Contra: sem self-service (mas não existe hoje) |
| **B — Bearer `order_id` via RPC `SECURITY DEFINER`** | `get_order(p_order_id uuid)` retorna só aquele pedido; cliente **retém** o `order_id` (uuid 122-bit, hoje descartado) | Habilita tracking; uuid inadivinhável = prova de posse. Contra: credencial = PK interna (se vazar em URL/log, expõe aquele pedido); sem revogação |
| **C — Token de acompanhamento dedicado** | nova coluna `orders.tracking_token` (random, ≠ PK); `get_order_by_token(token)` | Credencial separada da PK; rotacionável. Contra: +coluna/migração; +complexidade |
| **D — Token/id + telefone (defesa em profundidade)** | RPC exige id/token **e** telefone correspondente | Dois fatores; token vazado sozinho não basta. Contra: telefone é fraco/enumerável (faz pouca diferença real); +fricção |

> **Recomendação:** **2.1=A** e **2.2=A para esta fase** (fecha o vazamento, zero mudança de comportamento), com **B (ou C)** desenhada como **arquitetura oficial do tracking futuro** — implementação numa feature própria (não dentro de uma fase de segurança). Se você quiser **incluir o tracking já**, recomendo **C** (token dedicado) + RPC `SECURITY DEFINER` retornando projeção mínima (sem PII de terceiros).

---

## 3. Decisões RATIFICADAS (congelamento 2026-06-30) ✅

- **D-RPC:** `create_order` → `SECURITY DEFINER` (+ `search_path` fixo, EXECUTE mínimo mantendo anon). *(necessária; sem ela o checkout quebra ao remover as policies.)*
- **D-ANON-READ:** `anon` = **sem leitura** das tabelas de pedido nesta fase (tracking self-service = feature futura). *(Alternativa: incluir o tracking agora via opção 2.2-C.)*
- **D-GRANTS:** revogar grants de tabela do `anon` em orders/customers/order_items/order_events/addresses (defesa em profundidade além do RLS). Manter EXECUTE de `create_order` e INSERT em `application_logs`.
- **D-VIEW:** `v_order_reconciliation` → `security_invoker=true` **e** revogar SELECT do anon.

---

## 4. Estado-alvo (desenho das policies/grants)

| Objeto | anon | authenticated (admin) |
|---|---|---|
| `orders` | sem policy (sem acesso direto) · grants revogados | `FOR ALL` (SELECT/INS/UPD/DEL) |
| `customers` | idem | `FOR ALL` |
| `order_items` | idem | `FOR ALL` |
| `order_events` | sem acesso (mantém) | SELECT (mantém `order_events_read_auth`) |
| `addresses` | sem policy (mantém) · grants do anon revogados | **sem policy (mantém — app não usa)** |
| `create_order` (RPC) | **EXECUTE (mantém)** — única porta de escrita | EXECUTE |
| `v_order_reconciliation` | SELECT revogado | `security_invoker=true` (respeita RLS; admin lê) |

```sql
-- (desenho; aplicar só após congelamento)
-- 1) RPC vira a porta: SECURITY DEFINER (mesmo padrão F1B-errata)
ALTER FUNCTION public.create_order(jsonb,jsonb,jsonb,uuid) SECURITY DEFINER SET search_path = pg_catalog, public;
-- 2) remover policies permissivas
DROP POLICY "Allow all operations on orders"       ON public.orders;
DROP POLICY "Allow all operations on customers"    ON public.customers;
DROP POLICY "Allow all operations on order_items"  ON public.order_items;
-- 3) admin (authenticated) acesso pleno
CREATE POLICY "Auth all orders"      ON public.orders      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth all customers"   ON public.customers   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth all order_items" ON public.order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- (addresses: mantém SEM policy — app não usa; preserva comportamento. Só revoga grants do anon abaixo.)
-- 4) defesa em profundidade: revogar grants de tabela do anon
REVOKE ALL ON public.orders, public.customers, public.order_items, public.order_events, public.addresses FROM anon;
-- 5) fechar a view vazadora
ALTER VIEW public.v_order_reconciliation SET (security_invoker = true);
REVOKE ALL ON public.v_order_reconciliation FROM anon;
```
*(Nomes/forma exatos finalizados na migração; `anon` mantém EXECUTE de `create_order`/`normalize_phone`/`get_setting` e INSERT em `application_logs`.)*

---

## 5. Estratégia "cada cliente só o próprio pedido" (detalhe)

**Princípio:** sem `auth.uid()` para o anon, a prova de "é meu" é **posse de um segredo inadivinhável** ligado ao pedido, consumido por uma **RPC `SECURITY DEFINER`** que retorna **apenas aquele pedido** com **projeção mínima** (status, itens, total — **nunca** dados de outro cliente).

**Arquitetura recomendada (feature futura):**
1. `create_order` já retorna `order_id`; o cliente passa a **retê-lo** (localStorage, como faz com `request_id`) — ou, na opção C, retornar um `tracking_token` dedicado.
2. Nova RPC `get_order(p_id uuid)` (ou `get_order_by_token`) `SECURITY DEFINER`, EXECUTE para `anon`, retornando `jsonb` **só** do pedido casado: `{status, created_at, itens:[{nome,qty,preco}], total}` — **sem** `name/phone/address` de terceiros (e idealmente sem PII alguma; o cliente já tem os próprios dados).
3. RLS das tabelas permanece fechada ao anon (a RPC é a única leitura, controlada e de escopo único).
4. (D, opcional) exigir `phone` correspondente como 2º fator.

**Por que não policy RLS parametrizada por anon:** o anon não tem identidade no JWT; uma policy `USING(true)` reabriria tudo, e PostgREST não permite parametrizar a policy por um segredo do cliente de forma segura. A RPC `SECURITY DEFINER` com escopo de 1 id é o caminho correto.

**Para ESTA fase:** D-ANON-READ = fechar (sem `get_order`); a UI de tracking real (que hoje é cosmética) é feature à parte. **Implementação do `get_order` só se você escolher incluir agora.**

---

## 6. Plano de migração (após congelamento)

Rito F1B/NORM-06.1: **backup → revisão adversarial → aplicar → validar → build → testes → funcional → commit**.
1. **Pré-flight (read-only):** confirmar que nenhum caminho anon lê pedido (recon já confirmou: só `create_order`); snapshot + dump `pg_policies`/grants §0.
2. **`create_order` → SECURITY DEFINER** (+ search_path; auditar owner/sem-SQL-dinâmico/EXECUTE). Testar checkout anon **antes** de remover policies (deve continuar inserindo).
3. **Remover** policies `Allow all` (orders/customers/order_items) + **criar** policies `authenticated FOR ALL`.
4. **Revogar** grants de tabela do anon (orders/customers/order_items/order_events/addresses).
5. **Fechar** `v_order_reconciliation` (`security_invoker=true` + revoke anon).
6. (Se D-ANON-READ=incluir tracking) criar `get_order`/token + ajuste no cliente.
7. Build + `test:orders-rls` + funcional + commit + docs.

---

## 7. Testes necessários (`test:orders-rls`, via `SET ROLE`)

**Negativos (anon DEVE ser bloqueado):**
- anon `SELECT/INSERT/UPDATE/DELETE` em orders/customers/order_items → negado (42501 p/ INSERT; 0 linhas p/ UPDATE/DELETE/SELECT).
- anon `SELECT v_order_reconciliation` → negado (após `security_invoker` + revoke).
- anon `SELECT order_events/addresses` → negado.

**Positivos (caminho legítimo DEVE passar):**
- anon `rpc('create_order', …)` → **cria pedido** (em tx revertida) — o checkout não quebra.
- **idempotência:** 2ª chamada com mesmo `request_id` → `{idempotent:true}`, sem duplicar.
- `authenticated` `SELECT orders + JOIN customers + order_items` (equivalente a `getPedidos`) → retorna.
- `authenticated` `UPDATE orders SET status` (equivalente a `setStatus`) → ok.
- `authenticated` `rpc('orders_health')` → ok.
- (se tracking incluído) anon `rpc('get_order', meu_id)` → só o próprio; `get_order(outro_id)` por outro anon → também só aquele id (posse), **nunca** lista nem PII de terceiros.

**Auditoria:** `create_order` `SECURITY DEFINER` — owner=postgres, `search_path` fixo, sem SQL dinâmico, EXECUTE = {anon, authenticated, service_role} (anon necessário) sem PUBLIC. Net-zero (tudo em `BEGIN…ROLLBACK`). Funcional: pedido real tel 44 intacto.

---

## 8. Rollback (ordem)

```sql
ALTER VIEW public.v_order_reconciliation RESET (security_invoker);  -- (e re-grant se desejado)
DROP POLICY "Auth all orders/customers/order_items/addresses" ...;
CREATE POLICY "Allow all operations on orders/customers/order_items" ... ALL public true/true;  -- restaura §0
-- re-GRANT ALL ... TO anon (restaura §0)
ALTER FUNCTION public.create_order(...) SECURITY INVOKER RESET search_path;  -- volta ao INVOKER
```
> ⚠️ Reverter `create_order` p/ INVOKER **só** junto com a restauração das policies `Allow all` (senão o checkout anon quebra). Restore point real = rollback SQL (fase ~100% policies/grants/função).

---

## 9. Riscos

| Risco | Mitigação |
|---|---|
| `create_order` DEFINER mal-feito quebra o checkout | testar o checkout anon **antes** de remover policies; padrão F1B-errata já validado; auditoria SECURITY DEFINER |
| Caminho anon esquecido lê pedido e quebra | recon confirmou: só `create_order`; `test:orders-rls` cobre os caminhos; pré-flight |
| `current_user` nos logs vira `postgres` | cosmético (campo `origin`); documentado; opcional capturar role antes |
| pg_cron/edge (reconcile/purge/alert) | já SECURITY DEFINER owner=postgres → imunes ao RLS do anon |
| Bearer token (se tracking) vaza | uuid 122-bit + projeção mínima; opção C/D p/ separar credencial / 2º fator |

---

## 10. Decisões abertas (para o congelamento)

1. **D-ANON-READ:** fechar leitura anon agora (recomendado) **ou** já incluir o tracking self-service (2.2-C)?
2. **D-VIEW:** confirmar `security_invoker=true` + revoke anon em `v_order_reconciliation` (recomendado).
3. **Nome/numeração** do ADR (HARDEN-ORDERS-RLS) e se entra como bloqueador do F2 (você já definiu: **sim**).

> Após seu **congelamento** (com as decisões acima), executo o runbook §6 com rigor F1B/NORM-06.1. **Nada será implementado antes disso.**
