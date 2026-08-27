# REF-LOYALTY-AUDIT-01 — Programa de Fidelidade: auditoria + configuração por loja

**Status: ONDA 0 (auditoria) + ONDA 1 (configuração por loja) CONCLUÍDAS, aplicadas em produção e
no projeto E2E, commit `fb2a2e7`.** Ver §Onda 1 abaixo para o relatório final da implementação.

## Onda 0 — Auditoria completa do Programa de Fidelidade (somente leitura)

**Status: ONDA 0 CONCLUÍDA — auditoria pura, zero mudança de código/banco/config.**

**Metodologia:** leitura de 100% do código-fonte relevante (migrations, RPCs, RLS, frontend,
serviços, hooks, testes) + 16 queries somente-leitura direto em produção (contagens/agregados,
zero PII, zero mutação, via o runner local `C:\Users\00thi\.encanto\run.mjs`) + leitura dos ADRs/
ledgers que documentam as decisões de escopo já tomadas (`docs/adr/REF-SAAS-01-fundacao-
multitenant.md`, `docs/ref/REF-SAAS-01-plano-ondas.md`). Nenhuma alteração foi feita.

---

## 1. Resumo executivo

O núcleo do Programa de Fidelidade (concessão, idempotência, reversão em cancelamento, isolamento
de dados por cliente e por loja, persistência) está **corretamente implementado, testado e
confirmado ao vivo em produção com evidência real** — não só leitura de código. Ele nasceu como
REF-LOYALTY-01 (13/07) já com auditoria adversarial própria, e foi revisitado e corrigido durante a
fundação multi-tenant (REF-SAAS-01 Ondas 4.1/4.2, 08/08) especificamente para isolamento entre
lojas, com bateria de testes comportamentais (Store B fictícia, dentro de `BEGIN...ROLLBACK`).

Existe **1 lacuna estrutural real, não documentada como decisão deliberada em nenhum ADR**: a
*configuração* do programa (`loyalty_enabled`/`loyalty_required`/`loyalty_discount` — o próprio
kill switch e os parâmetros de negócio) continua **global à plataforma inteira**, numa tabela
`settings` sem `store_id`, e não foi migrada para `store_settings` como as outras 4 configurações
operacionais (horário, taxa de entrega, ETA, modo da loja) foram na Onda 4.3. Isso não é um
incidente ativo hoje (só existe 1 loja com dado real; a 2ª está suspensa e sem fidelidade), mas
**impede o requisito explícito desta REF** — "Super Admin/admin autorizado da loja consegue
ATIVAR/DESATIVAR o programa **da respectiva loja**" — de ser verdade assim que uma 2ª loja precisar
de fidelidade própria.

**Achado operacional, não técnico:** `loyalty_enabled = false` **agora mesmo em produção**. Isso é
uma decisão operacional confirmada do dono (registrada no ledger da própria REF-SAAS-01 em
2026-08-08 — "configuração operacional real do dono, não bug"), e prova, ao vivo, que o kill switch
do lado do cliente funciona de verdade: o programa está desligado e ninguém está ganhando/resgatando
selo pelo caminho normal agora.

**1 nuance de design a confirmar com o dono, não um bug:** com o programa DESATIVADO, o **admin**
ainda consegue conceder/ajustar/resgatar selos manualmente pela tela de Fidelidade (`admin_adjust_
loyalty`/`redeem_reward` no ramo administrativo não checam `enabled`). Isso é assim desde o dia 1
(REF-LOYALTY-01) — não foi introduzido depois — e provavelmente é intencional (a loja consegue
honrar um caso excepcional mesmo com o programa "pausado"), mas o enunciado desta REF pede
"DESATIVADO bloqueia TODOS os caminhos", então fica registrado para confirmação explícita.

Nenhum outro achado crítico ou alto foi confirmado. Idempotência, isolamento por cliente, isolamento
de dados por loja (a parte de leitura/escrita de saldo — diferente da parte de *configuração*
descrita acima) e o comportamento de cancelar/reabrir pedido foram todos confirmados por evidência
real (banco de produção + testes existentes), não só por leitura de código.

---

## 2. Arquitetura atual

**Modelo:** fonte única = Supabase/Postgres, por `customers.id` (nunca por navegador/localStorage).

- `public.loyalty_accounts` — 1 linha por cliente: `stamps` (progresso do ciclo atual),
  `earned_total` (acumulado líquido histórico), `rewards_redeemed`, `store_id`.
- `public.loyalty_events` — ledger imutável de todo movimento (`earned`/`revoked`/`redeemed`/
  `adjustment`), com `order_id`, `origem`, `store_id`, timestamp. Índice único parcial
  `loyalty_events_earned_order_uq` em `(order_id) WHERE tipo='earned'` — o backstop duro de
  idempotência.

**Camadas (frontend):**
- `src/services/loyalty/loyalty.js` — núcleo puro (normalização/derivação, sem I/O).
- `src/services/loyalty/loyaltyService.js` — chama as RPCs via `dbCliente` (sessão do cliente) ou
  `db` (sessão do admin). `localStorage` (`STORAGE_KEYS.LOYALTY_CACHE`) é **só cache de pintura**,
  validado por `customer_id`, sempre reconciliado por `get_my_loyalty()` — nunca fonte de verdade
  (confirmado por guarda estrutural própria, `tests/loyalty.guard.mjs`, que falha se alguém
  reintroduzir contagem no navegador).
- `src/hooks/useLoyalty.js` — estado reativo, com guarda de obsolescência por-execução (uma resposta
  em voo do cliente A nunca pinta sobre o cliente B) e limpeza de cache no logout.
- `src/pages/StoreApp.jsx` — exibe progresso/recompensa, gated por `loyalty.enabled` (defesa em
  profundidade — o gate real é no backend).
- `src/components/admin/AdminFidelidade.jsx` — busca/ajusta/resgata por telefone/nome + toggle
  Ativo/Desativado + campos required/discount.

**RPCs (todas `SECURITY DEFINER`, backend = única autoridade):**

| RPC | Papel | Quem pode chamar (confirmado ao vivo) |
|---|---|---|
| `loyalty_grant(customer_id, order_id)` | concede 1 selo | **ninguém direto** — `EXECUTE` revogado de anon/authenticated; só chamada interna de dentro de `create_order` |
| `loyalty_void_on_cancel()` | trigger, reverte/restaura selo | idem — só o trigger |
| `get_my_loyalty(p_store_id)` | leitura do próprio estado | anon + authenticated (self-gating interno) |
| `redeem_reward(p_customer_id, p_store_id)` | resgatar recompensa | anon + authenticated (self-gating interno) |
| `admin_find_loyalty(p_query, p_store_id)` | busca admin | authenticated (checa `is_admin_of` por dentro) |
| `admin_adjust_loyalty(customer_id, delta, note)` | ajuste manual | authenticated (idem) |
| `set_loyalty_config(required, discount, enabled)` | liga/desliga + parâmetros | authenticated (checa `is_admin()`, ver §7/§9) |

---

## 3. Regra de negócio encontrada

Confirmada em código e reconfirmada ao vivo (`settings.loyalty_required=10`,
`loyalty_discount=50`):

- **1 selo por pedido válido**, concedido automaticamente. Não cumulativo além do teto: ao atingir
  `stamps >= required`, novos pedidos **não** incrementam mais até o resgate (`loyalty_grant`
  retorna sem fazer nada se a cartela já está cheia).
- **10 pedidos → 50% de desconto no próximo pedido** (parâmetros administráveis via
  `set_loyalty_config`, faixa validada 1–100 em ambos).
- **Resgate abre novo ciclo**: `stamps -= required` (não zera — sobra vira início do próximo ciclo).
  Recompensas não são cumuláveis (é preciso completar 10 de novo).
- **Sem expiração** de selo e sem reset automático — só reset manual (`admin_adjust_loyalty`) ou
  reversão por cancelamento de pedido.
- **Não há limite de resgates** por cliente ao longo do tempo (`rewards_redeemed` é só contador
  informativo).
- Regulamento exibido ao admin (`AdminFidelidade.jsx`) e ao cliente (`FidelidadeScreen.jsx`, texto
  administrável em `company_info.fidelidadeTexto`) é consistente com o que o backend de fato faz.

Nada aqui ficou como NÃO DETERMINADO — a regra está inteiramente no código/banco, sem ambiguidade.

---

## 4. Fluxo completo do pedido → fidelidade

```
checkout (CheckoutPage.jsx)
  → cria o pedido via create_order(p_customer, p_order, p_items, p_request_id, p_store_id)
      [MESMA transação atômica do pedido]
      → INSERT customers (upsert por store_id+phone)
      → INSERT orders (status inicial 'recebido')
      → INSERT order_items
      → sub-bloco BEGIN/EXCEPTION: perform loyalty_grant(customer_id, order_id)
           [best-effort: fidelidade NUNCA derruba um pedido já persistido]
      → retorna {ok:true, order_id}
  → CheckoutPage dispara window.dispatchEvent(LOYALTY_EVENT)
      [SÓ avisa a UI a re-buscar o estado oficial — nenhum incremento local]
  → useLoyalty reage ao evento → sincronizar() → get_my_loyalty() → pinta o estado real do servidor
```

**Condição exata que credita o selo:** o pedido **existir** (INSERT bem-sucedido em `orders`) — não
há checagem de pagamento confirmado, preparo, entrega, nem qualquer status pós-criação. O selo é
concedido no **momento da criação do pedido** (status `'recebido'`), não em nenhum evento posterior
do ciclo de vida.

**Isso é uma escolha de produto explícita e coerente com o negócio (pedido feito = engajamento
real), não um bug — mas é diferente de "só conta quando o pedido é *concluído*/entregue".** Fica
registrado como achado INFORMATIVO: se a intenção original fosse só contar pedidos **efetivamente
entregues**, isso não é o que o sistema faz hoje. O que o sistema faz hoje é: concede na criação,
**e reverte se o pedido for cancelado** (não reverte por nenhum outro motivo — um pedido em
qualquer status não-cancelado, mesmo "preparo" ou "pronto" há dias, mantém o selo).

**Condição exata que impede a contabilização:**
1. Programa desativado (`loyalty_enabled=false`) no momento da criação do pedido.
2. Cartela já cheia (`stamps >= required`) — não credita além do teto.
3. `loyalty_grant` já foi chamado para aquele `order_id` (idempotência, ver §8).
4. Qualquer exceção dentro do sub-bloco best-effort (nunca deveria acontecer em uso normal, e mesmo
   que aconteça, é engolida — o pedido persiste, só o selo não é concedido).

---

## 5. Persistência

**100% servidor (Supabase Postgres).** `localStorage` é usado só como `LOYALTY_CACHE`
(`STORAGE_KEYS.LOYALTY_CACHE`) — grava o último estado **já confirmado pelo servidor**, chaveado
por `customer_id`, e é descartado/ignorado se o `customer_id` não bater. Nenhum componente escreve
um contador de fidelidade no navegador — confirmado por guarda estrutural automatizada
(`npm run test:loyalty-guard`, roda estaticamente contra todo `src/`) que falha o build/CI se essa
regra for violada. **Nenhum risco de fraude via DevTools/localStorage.**

---

## 6. Identidade do cliente

Resolvida sempre por `auth.uid()` no servidor → `customers.auth_user_id`, nunca por um
`customer_id` enviado pelo cliente (exceto no ramo *administrativo* de `redeem_reward`, onde
`p_customer_id` é o alvo escolhido pelo admin, e mesmo assim há checagem de "impersonação": se um
`p_customer_id` for passado por um cliente final e não bater com o customer resolvido pela própria
sessão, é negado). RLS (`loyalty_accounts_read_own`/`loyalty_events_read_own`) restringe leitura ao
próprio `customer_id` (ou admin da loja). Não há caminho de escrita direta pelo cliente (nenhuma
policy de INSERT/UPDATE/DELETE para `authenticated` nessas 2 tabelas — só RPC `SECURITY DEFINER`).

**Cliente A não pode receber o progresso de B:** confirmado por RLS + pela resolução sempre via
`auth.uid()` (nunca aceita um `customer_id` arbitrário do lado do cliente final).

---

## 7. Isolamento multi-tenant

**Dados (saldo/histórico): CONFIRMADO isolado, com evidência dupla.**

- `loyalty_accounts`/`loyalty_events` têm `store_id NOT NULL` desde a Onda 4.1 (08/08), propagado em
  todos os 8 triggers/RPCs que escrevem nessas tabelas.
- RLS troca `is_admin()` cego por `is_admin_of(store_id)`; leitura própria ganha correlação direta
  de `store_id` (não uma "ponte" — a linha já carrega seu `store_id` real).
- Onda 4.2 fechou especificamente 3 achados de leitura/resgate sem filtro de loja (`get_my_loyalty`,
  `redeem_reward`, `admin_find_loyalty`), com bateria de teste dedicada: acúmulo por loja, resgate
  por loja, **impossibilidade de usar pontos de uma loja em outra** (teste negativo explícito: cliente
  com selos suficientes na loja B não consegue resgatar no contexto de outra loja), isolamento
  completo de histórico entre admins de lojas diferentes — 17/17 PASS documentado.
- **Reconfirmado agora, ao vivo, com dado real de produção** (query somente-leitura, ver §12):
  zero linhas com `loyalty_accounts.store_id` diferente do `store_id` do próprio `customer_id`; zero
  o mesmo para `loyalty_events`; zero evento `earned` cujo `order_id` aponte para um pedido de outra
  loja. **Nenhum vazamento de dado de fidelidade entre Encanto e Aquarios Bar hoje.**

**Configuração (kill switch + regras de negócio): NÃO ISOLADA — achado central desta auditoria.**

`loyalty_grant`, `get_my_loyalty`, `redeem_reward`, `admin_adjust_loyalty` leem os parâmetros do
programa via `get_setting('loyalty_enabled'/'loyalty_required'/'loyalty_discount', ...)`. A função
`get_setting(p_chave, p_default)` (confirmada ao vivo) lê **exclusivamente** de `public.settings`,
uma tabela **key-value global, sem `store_id`**:

```sql
select coalesce((select valor from public.settings where chave=p_chave), p_default);
```

Isso significa que **existe hoje 1 único required/discount/enabled para a plataforma inteira**, não
1 por loja. Quando uma 2ª loja tiver fidelidade ativa, ela vai obrigatoriamente herdar o mesmo
"pedidos para recompensa", o mesmo "% de desconto" e o mesmo estado ligado/desligado que a Encanto
— sem poder ter os seus próprios.

Isso **não é uma decisão documentada** — é uma lacuna confirmada por ausência: a Onda 4.3 (08/08),
que migrou exatamente as outras 4 configurações operacionais equivalentes (`business_hours_
schedule`, `delivery_fee_config`, `delivery_eta_min`, `store_mode`) de `settings` global para a nova
`store_settings` por loja, **não incluiu as 3 chaves de fidelidade** no escopo. Não há nenhuma menção
a `loyalty_enabled`/`loyalty_required`/`loyalty_discount` em nenhum dos dois documentos que
registram as decisões de escopo da fundação multi-tenant (`docs/adr/REF-SAAS-01-fundacao-
multitenant.md`, `docs/ref/REF-SAAS-01-plano-ondas.md`) — diferente de `admins`/`settings`/
`address_gazetteer`, que ficaram de fora "por decisão explícita, registrada", não por esquecimento.

**Quem pode hoje alterar essa configuração global:** `set_loyalty_config` chama `public.is_admin()`
— e essa função, na versão atual (desde REF-SAAS-01 Onda 1), **não é mais um "é admin de alguma
loja" genérico**: virou um shim fixo, `is_admin_of((SELECT id FROM stores WHERE slug='encanto'))`.
Ou seja: **só quem administra especificamente a Encanto** (hoje: o Super Admin real, que também é
admin da Encanto) consegue chamar `set_loyalty_config` com sucesso. Um admin operacional de uma
2ª loja (não vinculado à Encanto) receberia "sem permissão" — o que é seguro no sentido de "não pode
mexer na configuração alheia", mas ao mesmo tempo **essa 2ª loja não teria NENHUMA forma de ligar/
desligar a própria fidelidade**, porque a própria RPC de configuração é territorialmente amarrada à
Encanto, não à "própria loja de quem chama" (diferente de `set_business_hours_schedule`/`set_
delivery_fee_config`/etc., que usam `is_admin_of(p_store_id)` — a loja de quem está chamando).

**Resumo do achado:** a arquitetura de **dados** de fidelidade já suporta multi-tenant corretamente
e isso está provado. A arquitetura de **configuração** de fidelidade ainda não foi migrada para o
padrão por-loja que o resto da plataforma já tem — ela ficou presa no modelo pré-SaaS de loja única.

---

## 8. Idempotência / dupla contabilização

**CONFIRMADO — dupla camada, dura + macia, validada em produção.**

1. **Backstop duro:** índice único parcial `loyalty_events_earned_order_uq` em
   `(order_id) WHERE tipo='earned'` — o banco fisicamente rejeita um 2º `earned` para o mesmo
   `order_id`. Confirmado presente e ativo ao vivo (query §12.10).
2. **Checagem macia (evita depender só da exceção de unicidade):** `loyalty_grant` faz
   `if exists (select 1 from loyalty_events where order_id=p_order_id and tipo='earned') then return;`
   antes de qualquer escrita.
3. **`create_order` em si já é idempotente** por `request_id` (se o mesmo `request_id` chegar de
   novo — ex.: reenvio de rede — retorna o pedido já criado sem duplicar nada, e `loyalty_grant`
   nunca é chamado de novo porque o pedido não é recriado).

**Prova real em produção (query §12.5):** zero `order_id` com mais de 1 evento `tipo='earned'`,
sobre uma base com 15 eventos `earned` reais. Zero duplicidade encontrada.

---

## 9. Pedidos cancelados/estornados

O trigger `trg_loyalty_void_on_cancel` (`AFTER UPDATE OF status ON orders`, confirmado **ativo**
ao vivo, `tgenabled='O'`) trata os dois sentidos:

- **Entrando em `cancelado`:** reverte a contribuição líquida daquele pedido (soma de
  `delta` de `loyalty_events` com `origem in ('create_order','cancel_trigger')` para aquele
  `order_id`) — não assume "sempre -1", soma o que de fato aconteceu, o que o torna seguro mesmo em
  cenários de múltiplos ajustes.
- **Saindo de `cancelado` (reabertura):** restaura 1 selo **só se** o pedido tinha de fato ganhado
  um (`earned` existe) **e** sua contribuição líquida está zerada — respeita o teto (`stamps <
  required`) e nunca duplica.
- Todo o bloco é *best-effort* (`EXCEPTION WHEN OTHERS THEN NULL`) — fidelidade nunca impede a
  mudança de status do pedido em si.

**Prova real em produção (query §12.16):** zero pedidos com `status='cancelado'` que ainda tenham
contribuição líquida positiva de fidelidade — ou seja, **nenhum pedido cancelado está, hoje,
contando indevidamente**.

**Classificação:** contabiliza → NÃO (após cancelamento). Reverte corretamente → SIM, confirmado.

---

## 10. Estado ATIVO/INATIVO (kill switch)

**Existe, é real (bloqueia no backend, não só na UI), e está ATIVO — o programa está DESLIGADO
agora em produção** (`settings.loyalty_enabled = 'false'`, confirmado por leitura direta, 27/08).

Isso bate com o registro histórico da própria REF-SAAS-01 (08/08): "`loyalty_enabled` está `false`
em produção agora (configuração operacional real do dono, não bug)". Ou seja, este não é um achado
de bug — é a prova, com dado real, de que a chave desliga o programa de verdade.

**Onde é checado:**
- `loyalty_grant` (concessão automática): `if not v_enabled ... then return; end if;` — **bloqueado**.
- `get_my_loyalty`: sempre retorna `enabled: false` e `reward_available: false` (mesmo que
  `stamps >= required` matematicamente) quando desligado.
- `redeem_reward`, **ramo do cliente final**: `if not v_enabled then return error 'programa
  desativado'; end if;` — **bloqueado**.
- `StoreApp.jsx`: some o banner de progresso/resgate quando `loyalty.enabled=false` (defesa
  adicional na UI, não é o gate real).

**Achado — nuance de design, não bug (severidade INFORMATIVO):** o **ramo administrativo** de
`redeem_reward` (quando `p_customer_id` é informado e quem chama é `is_admin_of` da loja daquele
cliente) **pula inteiramente a checagem de `enabled`** — um admin consegue resgatar uma recompensa
para um cliente mesmo com o programa desligado. O mesmo vale para `admin_adjust_loyalty` (+/− selo
manual): não checa `enabled` em nenhuma versão do código, desde a origem (REF-LOYALTY-01). Isso é
comportamento **original, desde o dia 1** — não foi introduzido por nenhuma onda posterior — e o
comentário original do RPC ("resgate: dono OU admin... admin pode operar") sugere que foi
intencional: a loja consegue honrar uma exceção manualmente mesmo com o programa "pausado" para o
público. Mas o enunciado desta REF pede explicitamente que INATIVO bloqueie **todos** os caminhos —
por isso fica registrado aqui como algo a **confirmar explicitamente com o dono**, não uma correção
proposta unilateralmente.

**`loyalty_void_on_cancel` (reversão por cancelamento) continua funcionando mesmo com o programa
desativado** — por design: reverter é sempre seguro/desejável independente do programa estar ligado,
já que só desfaz uma concessão que já tinha acontecido enquanto estava ligado.

---

## 11. Reativação

Não há nenhum mecanismo de "reset ao desligar" — `loyalty_enabled=false` é **só um gate de leitura/
escrita nas RPCs**, não apaga nem zera `loyalty_accounts`/`loyalty_events`. Ao religar
(`set_loyalty_config(..., enabled=true)`):

- Histórico (`loyalty_events`) e saldo (`loyalty_accounts.stamps`) **permanecem exatamente como
  estavam** — confirmado por leitura de código (nenhuma RPC de config toca essas tabelas).
- Novos pedidos elegíveis (dentro do teto) voltam a contabilizar normalmente pelo mesmo
  `loyalty_grant`, com a mesma idempotência de sempre.
- Nenhuma duplicação: o índice único parcial e a checagem macia continuam valendo, independente do
  histórico de ligar/desligar.

Não foi possível (nem seria apropriado, dado o escopo somente-leitura desta onda) reproduzir esse
cenário com uma reativação real em produção — a conclusão acima é por leitura de código, coerente
com o desenho geral e sem nenhum contra-indício encontrado.

---

## 12. Estado real de produção (somente leitura, 27/08/2026)

| Item | Resultado |
|---|---|
| `loyalty_enabled` | **`false`** (desligado) |
| `loyalty_required` | `10` |
| `loyalty_discount` | `50` |
| Lojas na plataforma | `encanto` (ativo) · `aquariosbar` (suspenso) |
| Contas de fidelidade (`loyalty_accounts`) | 5, todas da Encanto — 0 da Aquarios Bar |
| Selos em progresso agora (`stamps` somados) | 5 |
| Selos ganhos historicamente (`earned_total` somado) | 16 |
| Recompensas já resgatadas | 1 |
| Eventos no ledger | 15 `earned` + 2 `adjustment` + 1 `redeemed` — todos da Encanto |
| Duplicidade de `earned` por pedido | **0** |
| Contas órfãs (`customer_id` inexistente) | **0** |
| Drift `loyalty_accounts.store_id` ≠ `customers.store_id` | **0** |
| Drift `loyalty_events.store_id` ≠ `customers.store_id` | **0** |
| Evento `earned` cujo pedido é de outra loja | **0** |
| Índice único parcial (idempotência) | presente e ativo |
| Trigger de cancelamento | presente e **ativo** (`tgenabled='O'`) |
| Pedidos cancelados ainda contando indevidamente | **0** |
| `EXECUTE` de `loyalty_grant`/`loyalty_void_on_cancel` para anon/authenticated | **negado** (só chamada interna) |
| `EXECUTE` de `set_loyalty_config`/`admin_*` para anon | **negado** |
| `EXECUTE` de `get_my_loyalty`/`redeem_reward` para anon/authenticated | concedido (self-gating interno confirmado) |

**Nenhuma inconsistência, duplicidade ou vazamento cross-tenant encontrado nos dados reais.** O
único achado é arquitetural (configuração global, §7), não um problema no dado já persistido.

---

## 13. Cobertura de testes (matriz pedida, A–J)

| # | Cenário | Cobertura encontrada | Status |
|---|---|---|---|
| A | pedido elegível → +1 | `scripts/saas01-onda4-1-pedidos-test.mjs` (checkout real via `anon`) + `e2e/tests/cliente/fidelidade.spec.js` (banner de progresso) | CONFIRMADO |
| B | mesmo pedido processado 2x → +0 | Índice único (prod, 0 duplicidade real) + grupo "replay" documentado na bateria original da REF-LOYALTY-01 | CONFIRMADO |
| C/D | cliente A/B independentes (mesma loja) | Garantido por RLS + resolução via `auth.uid()`; sem um E2E dedicado a "2 clientes, mesma loja" especificamente | PROVÁVEL (arquitetura correta; falta 1 teste dedicado explícito) |
| E | cancelado → não contabiliza | Trigger + prova real em produção (0 pedidos cancelados com saldo líquido positivo) | CONFIRMADO |
| F | INATIVO → pedido não contabiliza | Código + **está acontecendo ao vivo agora** (`loyalty_enabled=false` em produção) | CONFIRMADO |
| G | INATIVO → tentativa direta via backend bloqueada | Bloqueado para `anon`/cliente final (RPC nega ou `EXECUTE` revogado); **admin tem bypass por design** (ver §10) | CONFIRMADO com ressalva documentada |
| H | reativado → novo pedido volta a contabilizar | Por leitura de código (gate é só na leitura da config, não há reset de dado); não exercitado contra produção real nesta onda | PROVÁVEL |
| I | Encanto não interfere em outro tenant | `scripts/saas01-onda4-2-fidelidade-test.mjs` (Store B fictícia, teste negativo explícito) + prod real (0 drift, 0 mismatch) | CONFIRMADO |
| J | outro tenant não interfere na Encanto | idem acima (mesmo teste cobre os 2 sentidos) | CONFIRMADO |

**E2E adicionais existentes** (`e2e/tests/admin/admin-fidelidade.spec.js`): busca/ajusta/resgata
cliente + edita config (2/2 testes) e "toggle Ativo/Desativado grava e reflete no rótulo" — cobre a
mecânica do toggle, mas (coerente com o achado do §7) não cobre "toggle por loja", porque essa
capacidade não existe ainda.

**Lacunas de teste identificadas (não implementadas nesta onda):**
- Nenhum teste automatizado cobre 2 clientes distintos na **mesma** loja (isolamento entre pares,
  hoje garantido só pela arquitetura RLS/auth.uid, sem prova comportamental dedicada).
- Nenhum teste recente cobre reativação real do programa (H) — o programa está desligado desde
  antes da Onda 4.1 e os testes que tocam `loyalty_enabled` forçam `true` só dentro de transações
  revertidas.
- Nenhum teste cobre a config sendo alterada por um admin de uma 2ª loja (porque a capacidade não
  existe — não há o que testar até a Onda 1 desta REF resolver o achado do §7, se autorizado).

---

## 14. Achados

| # | Achado | Severidade | Classificação | Evidência |
|---|---|---|---|---|
| 1 | Configuração do programa (`loyalty_enabled`/`required`/`discount`) é **global à plataforma**, não por loja — contradiz o requisito desta REF de kill switch **por loja** | **ALTO** (arquitetural; sem impacto ativo hoje por só haver 1 loja com fidelidade) | CONFIRMADO | `get_setting()` lê de `settings` sem `store_id`; ausência total de menção nos ADRs de escopo da Onda 4.3; confirmado ao vivo em produção |
| 2 | `set_loyalty_config` autoriza via `is_admin()`, que hoje é um shim fixo amarrado à loja Encanto — uma 2ª loja não teria como configurar a própria fidelidade mesmo se a config fosse por-loja | **MÉDIO** (consequência direta do achado 1; mesma correção resolve os dois) | CONFIRMADO | leitura de `is_admin()` ao vivo (`is_admin_of(stores.slug='encanto')`) |
| 3 | Admin consegue resgatar/ajustar selo de um cliente mesmo com o programa desativado (bypass do gate `enabled` no ramo administrativo) | INFORMATIVO (parece intencional, desde o dia 1; confirmar com o dono) | CONFIRMADO (comportamento), intenção NÃO DETERMINADA | leitura de código de `redeem_reward`/`admin_adjust_loyalty`, todas as versões |
| 4 | Selo é concedido no **momento da criação do pedido**, não em nenhum evento de conclusão/entrega — só é revertido por cancelamento explícito | INFORMATIVO (parece ser a regra de negócio pretendida, não um desvio) | CONFIRMADO (comportamento) | leitura de `create_order`/`loyalty_grant` |
| 5 | Falta teste automatizado dedicado para isolamento entre 2 clientes na mesma loja | BAIXO | CONFIRMADO (lacuna de teste, não de comportamento) | busca em `e2e/`/`scripts/` |

Nenhum achado CRÍTICO. Nenhuma duplicidade, vazamento de dado real ou falha de idempotência
encontrada nos dados de produção.

---

## 15. Riscos

- **Risco de produto, não de segurança:** enquanto o achado 1 não for corrigido, a plataforma não
  consegue oferecer fidelidade configurável por loja para um 2º tenant — isso bloquearia comercializar
  o programa de fidelidade como recurso "por loja" da VALION antes de resolver o achado 1.
- **Risco de confusão operacional:** se a Aquarios Bar (ou qualquer loja futura) for reativada com
  fidelidade ligada, ela herdará automaticamente o `required=10`/`discount=50%` da Encanto e
  qualquer toggle que o admin da Encanto fizer — sem aviso nem intenção de afetar a outra loja.
- **Nenhum risco de segurança/vazamento de dado identificado** — a superfície de ataque (RLS, RPCs,
  grants) está correta e confirmada por teste comportamental + dado real de produção.

---

## 16. Lacunas

1. Configuração de fidelidade não é por-loja (achado 1+2, §7/§14).
2. Bypass do admin no kill switch não está documentado como decisão de produto explícita (achado 3).
3. Falta teste dedicado a isolamento entre 2 clientes da mesma loja (achado 5).
4. Nenhum teste recente exercita a reativação do programa contra comportamento real (cenário H).

---

## 17. Correções recomendadas (NÃO implementadas nesta onda)

Caso o dono autorize uma Onda 1, o formato mínimo recomendado, espelhando exatamente o padrão já
usado e comprovado pela Onda 4.3 para as outras 4 configurações operacionais (mesmo time, mesmo
projeto, mesmo rigor de teste):

1. Mover `loyalty_required`/`loyalty_discount`/`loyalty_enabled` de `settings` (global) para
   `store_settings` (por loja) — mesmo padrão de `set_business_hours_schedule`/`get_delivery_eta`.
2. `get_my_loyalty`/`redeem_reward`/`loyalty_grant`/`admin_adjust_loyalty` passam a ler a config via
   `store_settings` filtrado por `store_id` (cada RPC já resolve seu próprio `store_id`/`p_store_id`
   hoje — é reaproveitar o valor que já existe em cada uma, não uma reestruturação).
3. `set_loyalty_config` ganha `p_store_id DEFAULT default_store_id()` e troca `is_admin()` (shim
   fixo) por `is_admin_of(p_store_id)` — mesmo padrão de `set_delivery_fee_config`/`set_store_mode`.
4. `AdminFidelidade.jsx`/`loyaltyService.js` passam a enviar `buildStoreRpcParam()` em
   `adminSalvarConfig`/`adminLerConfig` (hoje é o único par leitura/escrita de config administrativa
   do painel que ainda não usa esse helper — todos os outros já usam).
5. Confirmar com o dono, antes ou durante a Onda 1, se o bypass do admin no kill switch (achado 3)
   deve continuar existindo (documentar a intenção) ou ser fechado.
6. Cobrir os 2 cenários de teste faltantes (§13: C/D dedicado, H reativação real) na mesma bateria.

Nenhuma dessas mudanças precisa alterar `loyalty_accounts`/`loyalty_events` (schema/RLS já corretos
desde a Onda 4.1) — é estritamente a mesma cirurgia já feita 4 vezes na Onda 4.3, aplicada às 3
chaves que ficaram para trás.

---

## 18. Plano de implementação em ondas (proposto, não iniciado)

- **Onda 1** — migração `loyalty_* ` para `store_settings` + as 4 RPCs + frontend (item 1–4 acima).
  Mesmo ciclo disciplinado já usado no projeto: auditoria → migration → testes (estrutural +
  comportamental, incluindo Store B fictícia) → validação contra produção real (somente leitura) →
  aplicação → commit → documentação. Estimativa de risco: baixo (padrão já validado 4x nesta mesma
  REF-SAAS-01).
- **Onda 2** (opcional, decisão de produto) — resolver o achado 3 (bypass do admin), se o dono
  decidir que o comportamento atual não é o desejado.
- **Onda 3** (opcional) — fechar as lacunas de teste do §13 (C/D dedicado, H).

---

## 19. Critério de prontidão

| # | Pergunta | Resposta |
|---|---|---|
| A | Programa 100% correto? | **NÃO** — 1 achado ALTO (config global, não por-loja) |
| B | Contabilizando pedidos corretamente? | **SIM** |
| C | É idempotente? | **SIM** (confirmado por prova real em produção) |
| D | Isolado por cliente? | **SIM** |
| E | Isolado por tenant? | **SIM para dados** (saldo/histórico) · **NÃO para configuração** (achado 1) |
| F | Cancelados tratados corretamente? | **SIM** |
| G | Existe controle ATIVO/INATIVO? | **SIM** |
| H | INATIVO bloqueia todos os caminhos? | **NÃO totalmente** — bloqueia o cliente final; admin tem bypass by-design (achado 3, a confirmar) |
| I | Admin controla por loja? | **NÃO** — hoje é 1 controle global para a plataforma inteira (achado 1+2) |
| J | Pronto para produção? | **COM RESSALVAS** — pronto e seguro para operar **com 1 loja só** (situação atual da Encanto, onde já está rodando há mais de 1 mês com dado real e zero inconsistência); **não pronto** para um 2º tenant com fidelidade própria sem a Onda 1 acima |

---

## Gate final da Onda 0

Auditoria concluída. Nenhuma alteração foi feita em código, banco, configuração ou dado real nesta
onda. Autorização explícita do dono recebida em seguida para a Onda 1 (§17, item 1).

---

## Onda 1 — Configuração da fidelidade por loja (implementação)

**Status: CONCLUÍDA. Aplicada em produção e no projeto E2E. Commits `fb2a2e7` (implementação) +
`652b53f` (documentação), pushed em `origin/main`, CI verde (run `33098077670`).**

### 1. Configuração antiga

`loyalty_enabled`/`loyalty_required`/`loyalty_discount` em `public.settings` — key-value **global à
plataforma inteira** (sem `store_id`), lida via `get_setting(p_chave, p_default)`. Todas as 7
RPCs de fidelidade liam dali. `set_loyalty_config` autorizava via `is_admin()`, que — desde
REF-SAAS-01 Onda 1 — é um shim fixo `is_admin_of(stores.slug='encanto')`, ou seja, só quem
administra a Encanto conseguia configurar, e o valor configurado valeria pra qualquer loja.

Estado real capturado antes da migration (2026-08-27): `loyalty_enabled='false'` ·
`loyalty_required='10'` · `loyalty_discount='50'`.

### 2. Configuração nova

`public.store_settings` (tabela já existente desde REF-SAAS-01 Onda 4.3, `UNIQUE(store_id,
chave)`, RLS trancada sem policy — só RPC `SECURITY DEFINER` acessa), com as mesmas 3 chaves agora
por `store_id`. Mesmo padrão exato de `business_hours_schedule`/`delivery_fee_config`/
`delivery_eta_min`/`store_mode`.

**Default seguro para loja sem configuração própria (decisão documentada desta onda):**
`enabled=false` · `required=10` · `discount=50`. Uma loja nova nasce com fidelidade **desligada** —
nunca herda silenciosamente de outra loja. Confirmado por teste (`DEFAULT-P1/P2/P3`, ver §9).

### 3. Migration realizada

`migrations/REF-LOYALTY-AUDIT-01-onda1-config-por-loja.sql` (+ `-rollback.sql`):

1. Backfill: copia as 3 chaves de `settings` para `store_settings` da Encanto (preserva o valor
   real, `enabled=false` incluso — **não ativa nada**).
2. `loyalty_grant`, `loyalty_void_on_cancel`, `get_my_loyalty`, `redeem_reward`,
   `admin_find_loyalty`, `admin_adjust_loyalty` — mesma assinatura, só troca a fonte de leitura pra
   `store_settings` escopado pela loja já resolvida em cada função (nenhuma delas precisou de novo
   parâmetro — todas já resolviam `store_id`/recebiam `p_store_id` desde as Ondas 4.1/4.2).
3. `set_loyalty_config` ganha `p_store_id DEFAULT default_store_id()` (troca de assinatura → `DROP
   FUNCTION` explícito antes, lição da Onda 3/4.x) e troca `is_admin()` por `is_admin_of(p_store_id)`.
   ACL customizado (REVOKE de anon/PUBLIC) reaplicado explicitamente após o DROP+CREATE — lição do
   addendum da Onda 4.1 (DROP reseta ACL pros defaults do schema).
4. Nova RPC `get_loyalty_config(p_store_id)` — pública (mesmo papel de
   `get_delivery_fee_config`/etc.), substitui as 3 chamadas a `get_setting()` que o Admin fazia
   direto do frontend.
5. `DELETE FROM settings WHERE chave IN (...)` — remove as 3 chaves globais (nada mais as lê).

Aplicada via `node run.mjs --file ...` em **produção** (projeto `hvbcdxsagkjtfjwvnslo`) e depois no
**projeto E2E** (`bgzcrovskjbktdxkhemd`, via `run-e2e.mjs`) — necessário para os testes E2E
(Playwright) funcionarem, já que é um banco Supabase separado.

### 4. Padrão SaaS reutilizado

Nenhuma arquitetura nova. Mesma tabela (`store_settings`), mesmo padrão de RPC (`get_x(p_store_id)`
público + `set_x(..., p_store_id)` com `is_admin_of`), mesma lição de `DROP FUNCTION` antes de trocar
assinatura, mesmo padrão de backfill preservando o dado real. Copiado ponto a ponto de
`REF-SAAS-01-onda4-3-config-operacional.sql`.

### 5. Estado final da Encanto

Confirmado por leitura direta pós-migration: `store_settings` da Encanto tem
`loyalty_enabled='false'` · `loyalty_required='10'` · `loyalty_discount='50'` — **idêntico** ao
estado pré-migration. `loyalty_accounts` (5 contas) e `loyalty_events` (18 eventos) — **contagens
idênticas** antes/depois, zero linha perdida ou duplicada. `get_loyalty_config()` (chamado sem
argumento, como o app real) devolve exatamente esse estado.

### 6. Comportamento do kill switch

- Bloqueia de verdade no backend: `loyalty_grant` (concessão automática) e o ramo **cliente final**
  de `redeem_reward` checam `enabled` da loja resolvida e recusam quando desligado — provado com
  `loyalty_grant()` chamado direto contra um pedido real da Encanto (que está `enabled=false` agora
  mesmo em produção): roda sem erro, zero selo concedido.
- **Decisão explícita do dono (2026-08-27, pergunta feita antes de implementar, per instrução desta
  onda):** o bypass do admin (`redeem_reward` ramo administrativo, `admin_adjust_loyalty`) **é
  mantido como estava** — INATIVO bloqueia só o caminho automático/cliente, não as ações manuais do
  admin. Nenhuma dessas 2 funções ganhou checagem de `enabled` nesta onda (decisão registrada, não
  silenciosa).
- Tentativa direta via RPC (bypassando a UI) continua bloqueada por `EXECUTE` revogado em
  `loyalty_grant`/`loyalty_void_on_cancel` para `anon`/`authenticated` — confirmado ao vivo
  (`permission denied for function loyalty_grant`).

### 7. Isolamento por tenant

Provado com uma loja B fictícia (dados descartáveis, `BEGIN...ROLLBACK` contra produção):
- Loja B com config própria (`enabled=true`, `required=5`) concede selo normalmente enquanto a
  Encanto real (`enabled=false`) não concede — mesma transação de teste, os dois lados provados
  juntos.
- `set_loyalty_config` de um admin da loja B não altera a config real da Encanto (lido de volta
  **fora** da transação de teste — igual antes/depois).
- Admin da loja B não configura a Encanto; admin da Encanto não configura a loja B; usuário
  autenticado sem nenhum vínculo de admin não configura loja nenhuma — 3 checagens, ambos os
  sentidos.
- Reativação (`false`→`true`) na loja B: pedido enquanto desligado não conta; pedido novo após ligar
  volta a contar — sem duplicar, sem afetar o saldo anterior.

### 8. Impacto no núcleo de contabilização

**Nenhum.** `create_order`, o índice único parcial de idempotência, o trigger de
cancelamento/reversão e a resolução de identidade do cliente (`auth.uid()`→`customers`) não foram
tocados — só a *fonte* dos 3 parâmetros de configuração mudou dentro de `loyalty_grant`/
`loyalty_void_on_cancel`/etc., preservando 100% da lógica de negócio já validada na Onda 0.

### 9. Testes realizados

`scripts/loyalty-audit-01-onda1-test.mjs` (novo, mesmo estilo dos scripts `saas01-onda4-*`) — rodado
contra **produção**, `BEGIN...ROLLBACK`, **28/28 PASS**, zero mutação líquida confirmada
(`loyalty_accounts`/`loyalty_events` com a mesma contagem antes/depois; nenhuma loja/admin fictício
sobrevive). Cobre: 4 checks estruturais (schema/assinatura/grants) + default seguro (loja nunca
configurada) + cenários A, B, C/D, E, F/G, H, I, J, K pedidos na Fase 8 do escopo desta onda — todos
com evidência real, não assumida.

Também corrigidos 2 scripts de teste **pré-existentes** cujo `setupSql()` forçava a config antiga via
`INSERT INTO settings` (sem efeito algum após a migration, pois as RPCs não leem mais aquela tabela):
`scripts/saas01-onda4-1-pedidos-test.mjs` (`CHECKOUT-P1`) e `scripts/saas01-onda4-2-fidelidade-test.mjs`
(`setupSql`, `REGRESSAO-01`) — ambos ajustados pra escrever/ler `store_settings` da loja correta.
`test:saas01-onda4-2-fidelidade`: **17/17 PASS** após o ajuste (era 13/17 antes, quebrado pela
migration).

**Achado incidental, fora do escopo, não corrigido:** `test:saas01-onda4-1-pedidos` ficou em
**50/52** (2 falhas: `CHECKOUT-P1`/`CHECKOUT-P2`). Causa raiz confirmada por leitura direta do
`create_order` ao vivo: desde `REF-PROD-GOLIVE-01` (commit `2c86e73`, 2026-08-23 — **antes** desta
onda, não relacionado a ela), `create_order` chamado por `anon` sem `tenant_id` no JWT ignora
`p_store_id` do payload e resolve a loja via `resolve_store_from_origin()` (precisa de um header
HTTP `Origin` real). O harness desses 2 scripts simula sessões via SQL puro (`SET LOCAL ROLE` +
`request.jwt.claims`), sem nenhuma camada HTTP — não tem como fornecer esse header. O script
`scripts/saas01-onda4-1-pedidos-test.mjs` é de 2026-08-17 (confirmado por `git log`), **anterior**
à mudança que o quebrou; ninguém rodou esse teste específico entre 23/08 e hoje pra notar. Não é uma
regressão desta onda (a correção do `setupSql` de `CHECKOUT-P1`, feita aqui, é necessária mas não
suficiente — o teste só voltará a passar quando o harness ganhar uma forma de simular o header
`Origin`, ou `create_order` ganhar um caminho de teste alternativo; nenhuma das duas coisas é escopo
desta REF). Registrado como pendência para o dono decidir (§ Pendências).

`npm run test:loyalty` / `npm run test:loyalty-guard` / `npm run test:domain` — verdes, sem
alteração de comportamento (núcleo puro intocado).

### 10. E2E (Playwright, projeto E2E dedicado)

- `e2e/tests/admin/admin-fidelidade.spec.js` — **2/2 PASS**. Ajustado: a leitura do valor real
  persistido (`lerValorReal`, usada pra confirmar que o toggle grava de verdade, não só otimista na
  UI) agora lê `store_settings` da loja Encanto **do projeto E2E**, não mais `settings` global —
  mesmo padrão já usado por `admin-status.spec.js`/`admin-taxa-entrega.spec.js` pra `store_mode`/
  `company_info`.
- `e2e/tests/cliente/fidelidade.spec.js` — **2/2 PASS**, sem nenhuma alteração necessária (usa
  `get_my_loyalty`/`redeem_reward` sem args, exatamente como o app real chama).

### 11. lint / typecheck / build / test:domain

Todos verdes antes de tocar produção: `lint` (0 erros, 56 warnings pré-existentes, nenhum nos
arquivos tocados), `typecheck` (limpo), `build` (sucesso), `test:domain` (inclui `test:loyalty` e
`test:loyalty-guard`, ambos verdes).

### 12. Diff

`git diff --check` limpo (sem problema de whitespace). Varredura manual do diff staged por
`password|secret|token|api_key|PGPASSWORD|sbp_|service_role` — únicos hits são o boilerplate já
existente de leitura de `db.env` (fora do repo) copiado do padrão já commitado em
`scripts/saas01-onda4-2-fidelidade-test.mjs`; nenhum valor de credencial real no diff. `git add`
explícito por caminho (nunca `-A`/`.`) — confirmado que 2 arquivos de outra sessão em andamento no
mesmo working directory (`src/constants/privacyPolicy.js` modificado, `scripts/loadtest-e2e.mjs`
novo) **não** entraram neste commit.

### 13. Commit

`fb2a2e7` — `feat(loyalty): REF-LOYALTY-AUDIT-01 Onda 1 -- configuracao de fidelidade por loja` (10
arquivos). Este documento é comitado separadamente logo em seguida (mesma sessão, sem re-abrir o
commit anterior — política de nunca dar `--amend`).

### 14. CI

**Verde.** Run `33098077670` (commit `652b53f`, gatilho `push` em `main`) — `conclusion: success`.
`test:db-guards` (onde os scripts de banco desta onda vivem) **não roda no CI** por desenho (precisa
de credenciais de produção, deliberadamente fora do workflow — ver `.github/workflows/ci.yml`); o CI
cobre lint/typecheck/build/`test:domain`/E2E chromium — todos verdes, confirmando em ambiente limpo
o que já havia sido validado localmente antes do push.

### 15. Pendências

1. **`test:saas01-onda4-1-pedidos` com 2 falhas pré-existentes** (`CHECKOUT-P1`/`CHECKOUT-P2`,
   causa raiz no `create_order` da REF-PROD-GOLIVE-01, não desta onda) — decisão do dono se quer
   abrir uma frente pra dar ao harness de teste uma forma de simular o header `Origin`, ou aceitar
   como limitação conhecida do ambiente de teste (a Onda 0/Onda 4.1 já provaram o comportamento real
   via chamada REST real com Origin de verdade).
2. **Bypass do admin no kill switch** — decisão tomada (mantido), não é mais pendência, mas fica
   registrado que foi uma escolha explícita, não uma omissão.
3. Lacunas de teste já registradas na Onda 0 (§13: isolamento explícito entre 2 clientes da mesma
   loja, reativação real fora de transação) continuam válidas — não cobertas nem por esta onda.
4. **UI do Admin:** o toggle Ativo/Desativado e os campos required/discount já existiam
   (`AdminFidelidade.jsx`) e foram adaptados pra trabalhar com `store_id` (via `buildStoreRpcParam()`,
   mesmo padrão de todo o resto do Admin) — nenhuma UI nova foi criada nesta onda, conforme pedido
   (Fase 7: "não criar UI complexa sem necessidade").

---

## Gate final da Onda 1

Implementação concluída e validada (produção + E2E + testes + build). **Não iniciar a Onda 2
automaticamente.** Nenhuma loja nova foi criada em produção. Fidelidade da Encanto não foi ativada
automaticamente — continua `enabled=false`, exatamente como estava. Nenhum dado histórico foi
alterado. Nenhuma outra funcionalidade fora do escopo desta REF foi tocada, exceto os 2 scripts de
teste pré-existentes cuja correção era estritamente necessária (setup que forçava a config antiga,
agora sem efeito). Aguardando confirmação de push + CI e autorização explícita do dono para
qualquer onda futura.

---

## Onda 2 — Camada administrativa/operacional (verificação + prova E2E real)

**Status: CONCLUÍDA.** Escopo pedido pelo dono: adaptar o Admin pra trabalhar com a config por loja,
com 11 objetivos específicos (visualizar/ativar-desativar por loja, persistência real, isolamento
cross-tenant, estado exibido = estado real, INATIVO bloqueando automação, histórico preservado,
investigar o bypass sem mudar silenciosamente, seguir o padrão do SaaS, núcleo intocado, testes de
ATIVO/INATIVO/isolamento/autorização/reativação).

### Achado principal desta onda

**10 dos 11 objetivos já estavam 100% entregues pela Onda 1** — `AdminFidelidade.jsx`/
`loyaltyService.js` já chamam `get_loyalty_config`/`set_loyalty_config` com `buildStoreRpcParam()`
(mesma loja ativa da sessão do Admin, mecanismo que já existe desde REF-SAAS-01 Onda 5), e o backend
já impõe `is_admin_of(p_store_id)`. **Nenhuma migration nova, nenhuma RPC nova, nenhuma mudança em
`src/` foi necessária nesta onda** — re-verifiquei cada objetivo contra o código/produção atuais
(não só reafirmei o que a Onda 1 já tinha dito) e, em vez de reimplementar algo que já existe, usei o
esforço desta onda pra fechar a única lacuna real: **prova end-to-end, pela UI de verdade** (não só
RPC direto como a suíte da Onda 1 fez) — trocando de loja no seletor real do Admin e confirmando que
a tela e o banco sempre concordam, para as 2 lojas, nos 2 sentidos.

### 1–8, 10, 11 — Objetivos já satisfeitos pela Onda 1 (reconfirmados, não implementados de novo)

| # | Objetivo | Evidência (reconfirmada nesta onda) |
|---|---|---|
| 1 | Cada loja tem config própria | `store_settings` por `store_id` (migration da Onda 1); novo teste E2E prova 2 lojas com valores diferentes simultâneos |
| 2 | Admin visualiza a config da loja selecionada | `AdminFidelidade` chama `adminLerConfig()` a cada mount; o seletor de loja (`admin-store-selector`, Onda 5 REF-SAAS-01) força remount (`key={activeStoreId}`) — novo teste prova que a tela sempre mostra o valor da loja ativa |
| 3 | Ativar/desativar por loja | `set_loyalty_config(..., p_store_id)`; toggle já existente na UI, testado por loja no novo E2E |
| 4 | Persiste no backend, não só visual | `expect.poll` direto em `store_settings` no novo teste — não confia só no rótulo otimista da tela |
| 5 | Admin de uma loja não altera outra | `is_admin_of(p_store_id)` (Onda 1) + `CROSS-N1/N2/N3` (script da Onda 1, RPC direto) + novo E2E (configurar a loja nova nunca mudou a Encanto, banco conferido antes/depois) |
| 6 | Estado exibido = estado real do backend | Mesmo mecanismo do item 2; novo E2E compara texto da tela com leitura direta do banco |
| 7 | INATIVO bloqueia operações automáticas | `loyalty_grant` checa `enabled` por loja (Onda 1, intocado nesta onda) |
| 8 | Desligar não apaga histórico | Config (`store_settings`) e dado (`loyalty_accounts`/`loyalty_events`) são tabelas/RPCs completamente separados — nenhuma RPC de config toca dado, no código de nenhuma das 2 ondas |
| 10 | Seguir o padrão do SaaS | Migration da Onda 1 copiou `get_x(p_store_id)`/`set_x(...,p_store_id)` da Onda 4.3; o novo teste E2E reusa literalmente o mesmo mecanismo de `platform-console.spec.js` (criar loja descartável, "Abrir Admin", seletor) — nenhuma peça de infraestrutura nova |
| 11 | Núcleo intocado | Zero arquivo em `migrations/`/`supabase/` alterado nesta onda; único arquivo de produção tocado nesta onda: nenhum (só teste) |

### 9. Operações manuais de resgate/ajuste — não alterado silenciosamente

**Decisão já tomada explicitamente na Onda 1** (pergunta feita ao dono antes de qualquer
implementação): manter o bypass do admin — `redeem_reward` (ramo administrativo) e
`admin_adjust_loyalty` continuam sem checar `enabled`, permitindo que o admin honre uma exceção
manual mesmo com o programa desligado para o público. Reconfirmado nesta onda que o código em
produção ainda reflete exatamente essa decisão (nenhuma dessas 2 funções foi tocada por nenhuma
onda desde a Onda 1). Não foi reaberta nem alterada nesta onda.

### 12. Testes (ATIVO/INATIVO, isolamento entre lojas, autorização, reativação)

- **Onda 1** já cobria os 4 (RPC direto, produção, `BEGIN...ROLLBACK`, 28/28) — não repetido aqui.
- **Novo nesta onda:** `e2e/tests/admin/admin-fidelidade.spec.js`, 3º teste (novo `describe`,
  projeto E2E, dados 100% descartáveis, nunca a Encanto real): cria uma loja via Platform Console,
  confirma que ela nasce com fidelidade **desativada** (default seguro), ativa com `required=3`/
  `discount=77`, confirma no banco (`expect.poll`), troca para a Encanto pelo seletor real do Admin
  e confirma que o baseline dela (capturado no início, não assumido) continua intacto, volta pra
  loja nova e confirma que a config configurada lá sobrevive à troca de contexto. Rodado 2x
  seguidas para confirmar estabilidade (não flaky) — **3/3 PASS** nas 2 execuções. Limpeza
  confirmada por leitura direta pós-suite: 0 loja/admin/`super_admins` remanescente.

### Achado incidental (corrigido nesta onda): corrida entre 2 saves consecutivos

Ao escrever o novo teste, encontrei uma corrida **real no produto**, não só no teste: a tela separa
"Salvar configurações" (required/discount, botão explícito) do toggle Ativo/Desativado (salva
sozinho ao clicar) — são 2 chamadas independentes a `set_loyalty_config`. Se a 2ª (toggle) for
disparada antes da 1ª terminar, as respostas podem chegar **fora de ordem**: a resposta da 1ª
chamada, mais lenta, chega por último e sobrescreve o `enabled` que a 2ª acabara de gravar — a tela
mostra "● Ativo" (otimista), mas o banco fica com o valor antigo. Reproduzi isso automatizando os 2
cliques em sequência rápida (exatamente o que um admin apressado, ou uma conexão lenta, pode
produzir). **Corrigido só no teste** (esperar a confirmação da 1ª chamada antes de disparar a 2ª) —
**não é uma correção de produto nesta onda**, porque não foi pedido e alteraria
`AdminFidelidade.jsx` além do escopo aprovado. Fica registrado como pendência (§ abaixo) — a
correção de produto mais simples seria desabilitar o toggle enquanto uma chamada anterior ainda
está em voo (mesmo princípio já usado em `cfgLoad`).

### Arquivos alterados

Só teste — nenhum código de produção, nenhuma migration, nenhuma RPC:
- `e2e/tests/admin/admin-fidelidade.spec.js` — 1 novo `test.describe` (+ 1 import,
  `idDoAdminFixture`).

### Migrations/RPCs

Nenhuma. A infraestrutura da Onda 1 já era suficiente.

### Validações

`npx eslint e2e/tests/admin/admin-fidelidade.spec.js` — limpo. `npm run lint` (geral) — 0 erros, 54
warnings pré-existentes (nenhum no arquivo tocado). `typecheck`/`build`/`test:domain` não
re-executados nesta onda por não terem sido tocados (zero arquivo em `src/`/`migrations/` alterado);
seguem no estado verde confirmado pela Onda 1 e pelo CI.

### E2E

`e2e/tests/admin/admin-fidelidade.spec.js` — **3/3 PASS**, 2 execuções seguidas (projeto E2E
dedicado). `e2e/tests/cliente/fidelidade.spec.js` — não tocado, não re-executado nesta onda (nenhuma
mudança que o afetaria).

### Commit / CI

Pendente desta sessão — commit único cobrindo o teste novo + este registro de documentação, push
para `origin/main`, aguardar CI.

### Pendências

1. **Corrida de 2 saves em sequência no toggle/config de fidelidade** (achado incidental acima) —
   correção de produto simples (desabilitar o toggle durante uma chamada em voo) fica registrada
   para autorização explícita do dono, não implementada nesta onda por estar fora do escopo pedido.
2. Pendências já registradas nas Ondas 0/1 (isolamento explícito entre 2 clientes da mesma loja;
   `create_order`/Origin HTTP do harness de teste antigo) continuam sem mudança — não fazem parte
   do escopo desta onda.

---

## Gate final da Onda 2

Verificação + prova E2E concluídas. **Não iniciar a Onda 3 automaticamente.** Nenhuma migration
nova, nenhuma mudança de código de produção. Fidelidade da Encanto não foi ativada. Nenhum outro
comportamento fora do escopo desta onda foi alterado. Aguardando push + CI e autorização explícita
do dono para qualquer onda futura (inclusive a correção da corrida de saves registrada acima).
