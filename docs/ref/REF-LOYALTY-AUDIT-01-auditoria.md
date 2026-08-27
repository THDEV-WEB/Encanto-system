# REF-LOYALTY-AUDIT-01 — Onda 0: Auditoria completa do Programa de Fidelidade (somente leitura)

**Status: ONDA 0 CONCLUÍDA — auditoria pura, zero mudança de código/banco/config.** Aguardando
autorização explícita do dono para qualquer Onda 1 (implementação).

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

## Gate final desta onda

Auditoria concluída. **Nenhuma alteração foi feita em código, banco, configuração ou dado real.**
Nenhuma Onda 1 foi iniciada. Aguardando autorização explícita do dono para prosseguir com qualquer
correção listada no §17.
