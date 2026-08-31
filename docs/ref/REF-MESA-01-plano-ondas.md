# REF-MESA-01 — Plano técnico de ondas (Onda 0)

**Status: Onda 0 concluída. Execução das Ondas 1-8 BLOQUEADA por 2 achados — ver "Achados que travam
a execução" no final deste documento. Nenhum código/schema/dado alterado até aqui.**

Este documento detalha as decisões técnicas concretas para implementar o domínio multicanal de
atendimento (Delivery/Retirada/Mesa × storefront/QR/admin-garçom) descrito na REF-MESA-01, com base
no relatório de auditoria (`REF-MESA-01-auditoria.md`) e numa varredura de confirmação do estado
atual do repositório.

---

## 1. Modelo de dados — decisão proposta

### 1.1 `orders.tipo_pedido` (modalidade)

```sql
ALTER TABLE public.orders ADD COLUMN tipo_pedido text NOT NULL DEFAULT 'entrega';
ALTER TABLE public.orders ADD CONSTRAINT orders_tipo_pedido_valid
  CHECK (tipo_pedido IN ('entrega', 'retirada', 'mesa'));
```

**Decisão a confirmar com você:** seu texto usa os rótulos conceituais `delivery`/`retirada`/`mesa`
para as MODALIDADES. O valor já persistido e usado em toda a base hoje para a modalidade de entrega é
a string `'entrega'` (não `'delivery'`) — em `orders.address` (heurística atual), em `status`
(`orders_status_valid` já usa o literal `'entrega'` como um dos *status*, namespace diferente mas
mesma palavra), em `pedidoStatus.js` (`FLUXO_ENTREGA`), em `comandaModel.js` (`tipoLabel`). Estou
propondo manter `'entrega'` como o valor persistido dessa modalidade (não `'delivery'`) por três
razões: (a) zero-churn — nenhum dado histórico precisa ser reinterpretado nem migrado; (b)
`DEFAULT 'entrega'` fica trivial e correto para as ~centenas de milhares de pedidos antigos; (c)
consistência com o restante do domínio, que é todo em pt-BR. `'delivery'` no seu texto entendo como o
nome conceitual/inglês da modalidade, não uma instrução literal de renomear o valor já em produção —
mas quero sua confirmação explícita antes de decidir isso sozinho, já que envolve o valor que fica
gravado para sempre em cada linha nova de `orders`.

### 1.2 `orders.origem_pedido` (canal)

```sql
ALTER TABLE public.orders ADD COLUMN origem_pedido text NOT NULL DEFAULT 'storefront';
ALTER TABLE public.orders ADD CONSTRAINT orders_origem_pedido_valid
  CHECK (origem_pedido IN ('storefront', 'qr_mesa', 'admin_garcom'));
```

Diferente de `tipo_pedido`, o backfill aqui é **100% exato, não uma heurística**: todo pedido já
existente veio, comprovadamente, do storefront do cliente — não existiam outros canais até esta REF.
`DEFAULT 'storefront'` para o histórico não é uma suposição, é um fato.

### 1.3 `orders.mesa_identificador` (identificação da mesa)

```sql
ALTER TABLE public.orders ADD COLUMN mesa_identificador text NULL;
ALTER TABLE public.orders ADD CONSTRAINT orders_mesa_identificador_coerente
  CHECK (tipo_pedido = 'mesa' OR mesa_identificador IS NULL);
```

Nasce na Onda 1 (mesmo que só usado a partir da Onda 2/3) para não exigir remodelagem de `orders`
quando o canal QR (Onda 3) ou Admin/garçom (Onda 4) forem ligados — exatamente a régua que seu texto
colocou ("não crie uma arquitetura que exija remodelagem de `orders` quando o segundo canal for
ativado"). Guardado como campo estruturado próprio, nunca reaproveitando `address` (esse é o ponto
central que esta REF existe para resolver: parar de sobrecarregar `address` como "gaveta de metadado
de tipo").

`address` continua `NOT NULL` (nenhuma mudança de constraint) — para Mesa, seu valor passa a ser
apenas um texto de exibição (ex. `'Mesa ' || mesa_identificador`), nunca mais a fonte de verdade do
tipo. Isso resolve a exigência "eliminar a dependência estrutural de inferir o tipo do pedido pelo
texto de `address`" sem exigir uma segunda migration para relaxar uma constraint amplamente usada.

### 1.4 Capability por loja — `store_settings`

Seguindo o precedente `loyalty_enabled`/`delivery_fee_config` (mesmo par `get_X`/`set_X`,
`STABLE SECURITY DEFINER` público para leitura, `SECURITY DEFINER` com `is_admin_of(p_store_id)` para
escrita):

```sql
-- chave = 'mesa_config', valor = JSON: {"habilitada": bool, "canal_qr": bool, "canal_admin": bool}
get_mesa_config(p_store_id uuid DEFAULT default_store_id()) returns jsonb
set_mesa_config(p_habilitada boolean, p_canal_qr boolean, p_canal_admin boolean,
                p_store_id uuid DEFAULT default_store_id()) returns void
```

Default seguro (ausência de linha em `store_settings`): `{"habilitada": false, "canal_qr": false,
"canal_admin": false}` — nenhuma loja existente ganha Mesa automaticamente. Uma única chave JSON (não
3 chaves separadas) porque é o padrão já usado por `delivery_fee_config`/`loyalty_config` neste
projeto, e já satisfaz "permitir separar futuramente" — os 3 sub-flags já nascem independentes dentro
do mesmo objeto, sem exigir nova coluna quando o canal QR ou Admin for ligado depois.

### 1.5 `create_order()` — mudança de contrato, com compatibilidade

- Client atual (sem mudança nenhuma no frontend) continua mandando só `p_order.retirada: boolean`.
  Se `p_order` não trouxer `tipo_pedido`, o servidor deriva exatamente como hoje
  (`v_retirada ? 'retirada' : 'entrega'`) — **zero mudança de comportamento para Delivery/Retirada**.
- Client novo (a partir da Onda 2) pode mandar `p_order.tipo_pedido = 'mesa'` +
  `p_order.mesa_identificador`. Servidor, nesta ordem, depois de `v_store_id` já resolvido com
  confiança (mesmo padrão de `_resolve_delivery_fee`):
  1. Se `tipo_pedido = 'mesa'`: consulta `get_mesa_config(v_store_id)`; se `habilitada != true`,
     `RAISE`/retorna erro genérico (`'modalidade indisponivel'`) — fail-closed, sem revelar se a
     loja existe. Fecha o vetor de bypass via RPC direta citado no seu texto (anon, authenticated,
     cross-tenant, frontend adulterado — todos passam pelo mesmo ponto).
  2. `_resolve_delivery_fee` ganha um terceiro caso (`tipo_pedido IN ('retirada','mesa')` → zera taxa
     incondicionalmente, idêntico ao que já faz para retirada hoje) — evita herdar cálculo de
     distância/geocoding por acidente.
  3. `address` gravado como texto de exibição (`'Mesa ' || mesa_identificador`), nunca mais lido de
     volta para inferir tipo.
- `INSERT INTO orders(...)` ganha as 3 colunas novas na lista.

### 1.6 O que a Onda 1 explicitamente NÃO toca (por escopo, adiado para ondas específicas)

- `enc_tempo_estimado()`/`enc_render_message()` (notificação WhatsApp) — continuam fazendo regex
  sobre `address`. Para um pedido `tipo_pedido='mesa'`, a regex não bate com
  `/retirada\s+na\s+loja/i`, então o texto cairia no ramo "entrega" (prazo "até Nmin", mensagem de
  motoboy) — **gap real, documentado aqui, mas é escopo explícito da Onda 7** ("regra absoluta de
  escopo": não corrigir de carona). Registrado como achado a não esquecer.
- `admin_reports_summary()`/`AdminRelatorios.jsx` (rótulo "Entrega vs Retirada") — mesma situação,
  cairia no `ELSE 'entrega'`. Escopo da Onda 6. Registrado.
- `comandaModel.js`/`AdminPedidos.jsx` (badge, comanda) — escopo da Onda 5. Registrado.
- Nenhum desses gaps é explorável como falha de segurança (não afeta cobrança nem isolamento de
  tenant) — são gaps de exibição/operação, conscientemente adiados pela ordem de ondas que você
  definiu, não esquecidos.

---

## 2. Testes da Onda 1 (antes de avançar para a Onda 2)

Seguindo o padrão dos scripts `scripts/*-test.mjs` já usados por toda REF anterior (estrutural +
comportamental via `BEGIN...ROLLBACK`/`SET LOCAL ROLE`): `scripts/mesa-01-onda1-fundacao-test.mjs`,
cobrindo exatamente a lista que seu texto pediu — pedido histórico (nenhuma coluna nova quebra
leitura), Delivery sem mudança, Retirada sem mudança, Mesa com `mesa_config.habilitada=true`, Mesa
com `habilitada=false` (deve falhar), tentativa de bypass (anon e authenticated mandando
`tipo_pedido='mesa'` direto pra RPC numa loja sem a capability), cross-tenant, idempotência
(`request_id` repetido com `tipo_pedido` diferente não deveria duplicar), fidelidade (`loyalty_grant`
chamado igual para os 3 tipos), views/triggers (nenhum trigger existente referencia as colunas novas,
então nenhuma mudança de comportamento esperada ali — o teste apenas confirma isso).

---

## 3. Impacto por onda (arquivos, já mapeados pela auditoria — resumo de navegação)

| Onda | Arquivos principais |
|---|---|
| 1 | nova migration + rollback; `create_order`, `_resolve_delivery_fee`, `get_mesa_config`/`set_mesa_config` |
| 2 | `DeliveryBar.jsx`, `CheckoutPage.jsx`, `SuccessPage.jsx`, `orderPayload.js`, `pedidoStatus.js` (`FLUXO_MESA`), `deliveryFeeRules.js`, `deliveryEtaFormat.js` |
| 3 | rota/leitura de contexto de QR (novo), validação server-side do `store_id`/mesa vindos do QR |
| 4 | tela nova de "novo pedido" no Admin (não existe hoje — lacuna já registrada na auditoria), gate por `mesa_config.canal_admin` |
| 5 | `comandaModel.js`, `comandaHtml.js`(sem mudança, é passivo), `AdminPedidos.jsx`, `PedidoNotificacoes.jsx`, `PedidoCard.jsx`/`PedidoTimeline.jsx` (storefront) |
| 6 | `AdminRelatorios.jsx`, `admin_reports_summary()` |
| 7 | `enc_render_message`, `enc_enqueue_notification`, `enc_tempo_estimado`, `messageTemplates.js` |
| 8 | varredura + suíte completa (`test:domain`, `test:db-guards`, `test:e2e`, lint, typecheck, build, build:admin) |

---

## Achados que travam a execução (aplicando suas próprias condições de parada)

### A) Condição de parada #6 — arquivo de outra sessão precisa ser alterado

`git status` no repo mostra **trabalho não commitado de outra sessão**, ativo agora, exatamente nos
arquivos que a Onda 2 precisa editar:

```
M src/components/checkout/CheckoutPage.jsx
M src/constants/privacyPolicy.js
M src/pages/StoreApp.jsx
M src/utils/orderPayload.js
M tests/checkout.golden.mjs
```

Inspecionei o diff: é uma feature completamente diferente e não relacionada, aparentando ser
"REF-CART-PRICE-DRIFT-01" — um aviso de divergência de preço no carrinho (`buildPrecoDivergenteView`
em `orderPayload.js`, ~76 linhas novas em `checkout.golden.mjs`, prop nova `produtosVivos` passada de
`StoreApp.jsx` pra `CheckoutPage.jsx`). Não decidi tocar nesses arquivos — a Onda 1 (banco/RPC) não
precisa deles, então ela não é bloqueada por isso. Mas a Onda 2 (checkout/storefront) precisa editar
exatamente `CheckoutPage.jsx`/`StoreApp.jsx`/`orderPayload.js`/`checkout.golden.mjs`, e fazer isso
sobre um diff não commitado de outra sessão arrisca perder o trabalho dela ou colidir se as duas
sessões salvarem o mesmo arquivo ao mesmo tempo.

### B) Condição de parada #2/#3 — ambiguidade sobre qual banco é "produção"

Todo o mecanismo de teste estrutural/comportamental de banco já estabelecido neste projeto
(`scripts/*-test.mjs`, usado por REF-SAAS-01, REF-AUTH-TENANT-01, REF-SEC-DATA-01,
REF-LOYALTY-AUDIT-01 e outras) conecta via credenciais em `C:/Users/00thi/.encanto/db.env`
(arquivo fora do repo, compartilhado entre sessões). Conferi: o projeto apontado por `db.env`
(`postgres.hvbcdx...`) é o **mesmo** projeto do `.env` da raiz do repo (`hvbcdx...`), e é **diferente**
do projeto E2E dedicado `.env.e2e` (`bgzcro...`, documentado em `e2e/README.md` como "plano free,
nunca produção").

Isso significa que `db.env`/`.env` **não é** o projeto E2E — e a própria auditoria de
REF-ORDER-TENANT-01 (`docs/ref/REF-ORDER-TENANT-01-auditoria.md`) registra explicitamente que os
testes de simulação daquela REF rodaram "contra produção" usando esse mesmo mecanismo. Ou seja: o
único caminho que já existe neste projeto para testar mudança estrutural de RPC/RLS de forma
realista aponta para o que parece ser o banco de produção real da Encanto — e suas instruções desta
vez são explícitas e repetidas: **não aplicar migration em produção, validar tudo no projeto
E2E/local**.

Não tenho, até agora, credenciais Postgres diretas (`psql`/`pg`) para o projeto E2E (`bgzcro`) — só
`VITE_SUPABASE_URL`/chaves via `.env.e2e`, usadas pelo Playwright/scripts de seed via API, não uma
connection string de banco para `ALTER TABLE`/`CREATE FUNCTION`. Aplicar a migration da Onda 1 (nova
coluna, novas funções) exige DDL — preciso saber se: (a) `hvbcdx` é de fato produção e devo achar/
pedir uma connection string do projeto E2E para rodar DDL lá, ou (b) `hvbcdx` já é seguro (talvez seja
um projeto de desenvolvimento pessoal, não o que está em produção real atendendo clientes) e o
"não aplicar em produção" desta instrução se refere a outro ambiente que não esse.

---

**Não vou prosseguir para a Onda 1 até resolver os dois pontos acima — são exatamente as condições de
parada que você definiu no plano.**
