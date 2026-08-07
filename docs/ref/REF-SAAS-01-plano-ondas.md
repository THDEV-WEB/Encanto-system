# REF-SAAS-01 — Plano de implementação por ondas (fundação multi-tenant)

- **Status:** 🟢 **Em execução — Onda 0 concluída (2026-08-07).** ADR mestre (`docs/adr/REF-SAAS-01-fundacao-multitenant.md`) aprovado como referência arquitetural permanente. Autorização de escrita direta em produção concedida pelo dono (Opção B, 7 condições registradas na sessão), válida exclusivamente para esta REF.
- **Disciplina de execução** (mesma de todo REF anterior — REF-APP-01/REF-ADMIN-04): 1 commit por onda/subfase, testes automatizados + regressão verdes antes de fechar cada onda, push ao final de cada onda (autorização permanente do dono para esta REF, sem repergunta por onda), documentação e relatório técnico atualizados antes de iniciar a próxima. Zero regressão na Encanto Marmitaria (Cliente Zero) em nenhum momento do processo.
- **Pré-condição transversal:** em nenhuma onda a Encanto Marmitaria pode ficar sem catálogo/checkout/admin funcionais — toda migration nasce retrocompatível (`store_id` nullable → backfill → `NOT NULL`; `is_admin()` como wrapper de `is_admin_of()`, nunca removida).
- **Objetivo comercial:** a Encanto Marmitaria passa a ser o Cliente Zero de uma plataforma SaaS da VALION SISTEMAS. Meta inicial: ~10 lojas, sem limitar arquitetura para crescimento além disso.

---

## Base documental (ground truth desta REF)

Três investigações sucessivas, cada uma reverificando a anterior contra o código/banco reais (nenhuma conclusão foi reaproveitada sem checar de novo):

### 1. Auditoria original (read-only, sem alteração de código/banco/migration)

Introspecção direta do Postgres de produção (schema, RLS, RPCs, triggers, cron, grants, Vault) + leitura de código (auth, frontend, admin, infra). Conclusão central: sistema 100% single-tenant, zero `store_id`/`tenant_id` em qualquer lugar das então 16 tabelas / 72 migrations / ~30 RPCs / ~25 policies. Identificou os dois maiores desafios de produto (não só técnicos): modelo de identidade do cliente e tenancy do WhatsApp. Propôs roadmap de 10 ondas.

### 2. Revalidação (após 39 commits novos / 5 REFs concluídas)

Entre a auditoria original e o pedido de início da implementação, o repositório evoluiu (REF-BUSINESS-HOURS-04, REF-COMPANY-03, REF-DELIVERY-FEE-01/02, REF-GOLIVE-01, mais a pesquisa REF-WHATSAPP-01). Reintrospecção completa do banco (82 migrations, mesmo schema tenant-wise) + leitura do código tocado por essas REFs confirmou: a tese central **não mudou** — nenhuma REF nova introduziu `store_id`; pelo contrário, todas reforçaram o padrão single-tenant existente (mais chaves em `settings`, mais RPCs no mesmo molde: `get/set_business_hours_schedule`, `get/set_delivery_fee_config`). Resolveu parcialmente achados antigos (horário de funcionamento passou a ser DB-backed; branding institucional — sobre/redes sociais/endereço — migrou para `company_info`) e trouxe um achado novo relevante: a pesquisa REF-WHATSAPP-01 esclareceu que gerenciar WhatsApp em nome de múltiplos clientes exige registro como Tech Provider da Meta (ou uso de BSP) — refina a Onda 7 sem mudar sua posição no roadmap.

### 3. ADR mestre (`docs/adr/REF-SAAS-01-fundacao-multitenant.md`)

Toma as decisões que a auditoria/revalidação deixaram abertas: modelo de identidade do cliente (por loja, auth global), modelo de isolamento (shared-schema + RLS, não projeto por loja), modelo de autorização (`super_admins`/`is_admin_of(store_id)`/`is_admin()` como wrapper), fluxo de resolução de loja (parâmetro explícito `p_store_id`, nunca implícito), e as convenções obrigatórias para toda tabela/RPC/policy/REF futura. Referência permanente — toda onda abaixo cita as seções relevantes desse ADR.

---

## Roadmap — status por onda

| Onda | Objetivo | Depende de | Status |
|---|---|---|---|
| **0** | Fundação de dados: tabela `stores`; `store_id` nullable em todas as tabelas de negócio; backfill com a loja "encanto" | ADR mestre | ✅ **Concluída (2026-08-07)** — ver seção própria abaixo |
| **1** | Gateway de autorização: `super_admins`, `is_admin_of(store_id)`, `admins.store_id`, `is_admin()` como wrapper de compatibilidade | Onda 0 | ✅ **Concluída (2026-08-07)** — ver seção própria abaixo |
| **2** | RLS + RPCs do catálogo (`products/categories/adicionais/product_collections`) com `store_id` | Onda 1 | 📋 Não iniciada |
| **3** | Identidade do cliente — decisão já tomada no ADR §2 (por loja, auth global); esta onda é só a implementação (`customers.store_id`, uniques compostos, `link_customer_to_auth`) | Onda 0 | 📋 Não iniciada |
| **4** | RLS + RPCs de pedidos/fidelidade/entrega/horário (`orders` + `delivery_fee`/`maquininha_fee`, `loyalty_*`, `business_hours_schedule`, `delivery_fee_config` → `store_settings`) | Ondas 1–3 | 📋 Não iniciada |
| **5** | Admin multi-loja: seletor de loja, papel de super admin na UI | Onda 4 | 📋 Não iniciada |
| **6** | Frontend multi-loja: `get_store_by_domain`, branding restante (logo/favicon, paleta CSS, Termos/Fidelidade), geocoding fora de Timbó-only | Onda 5 | 📋 Não iniciada |
| **7** | Notificações/WhatsApp por loja — decisão explícita Rota A (Tech Provider) vs. Rota B (BSP) antes de codificar | Onda 4 | 📋 Não iniciada |
| **8** | Infra de provisionamento: RPC `provision_store`, checklist de loja nova | Ondas 0–7 | 📋 Não iniciada |
| **9** | Mobile/Capacitor — decisão de produto (app por loja vs. shell único), fora do código desta fundação | Avaliar com N≥3 lojas | 📋 Não iniciada |

Cada onda, ao iniciar, ganha sua própria seção neste documento (auditoria específica → plano técnico → implementação → testes → regressão → commit → push → doc → relatório), seguindo o mesmo formato já usado em `REF-ADMIN-04-plano-ondas.md`.

---

## Onda 0 — Fundação de dados

**✅ CONCLUÍDA (2026-08-07)** — migration gerada, revisada, aplicada e validada (autorização Opção B do dono, condições 1–7 registradas na sessão de 2026-08-07).

### Auditoria específica da onda

Reconfirmado por introspecção direta (mesma sessão da revalidação, sem mudança desde então): 16 tabelas em `public`, zero `store_id` em qualquer uma. Das 16, **13 são dado de negócio de uma loja** e recebem `store_id` nesta onda: `customers`, `products`, `categories`, `adicionais`, `product_collections`, `orders`, `order_items`, `order_events`, `loyalty_accounts`, `loyalty_events`, `notification_outbox`, `addresses`, `application_logs` (esta última nullable/opcional, só para filtro futuro — ADR §6). As outras 3 ficam **de fora por decisão explícita, não esquecimento**: `admins` (Onda 1, junto de `super_admins`/`is_admin_of`), `settings` (Onda 4, migra para `store_settings`), `address_gazetteer` (permanece global de propósito — dado geográfico compartilhável entre lojas da mesma cidade).

### Plano técnico

1. `CREATE TABLE public.stores` (`id, slug, nome, dominio, status, created_at`), RLS habilitado sem policy ainda (mesmo padrão de `settings` — só RPC `SECURITY DEFINER` acessa até a Onda 1 trazer `is_admin_of`).
2. `INSERT` da loja "encanto" (Cliente Zero) — único registro.
3. `ALTER TABLE ... ADD COLUMN store_id uuid REFERENCES stores(id)` **nullable** nas 13 tabelas — aditivo, retrocompatível, nenhuma RLS/RPC/frontend toca essa coluna ainda, então zero risco de regressão funcional.
4. Backfill: 100% das linhas existentes → `store_id` da loja "encanto" (única loja hoje).
5. Índice `*_store_id_idx` em cada uma das 13 tabelas (preparação de performance para as Ondas 2/4).
6. Verificação: `scripts/saas01-onda0-schema-test.mjs` (`npm run test:saas01-onda0-schema`) — somente leitura, confirma S1–S7 (tabela `stores` correta, RLS habilitado, `store_id` presente/uuid/nullable/com FK nas 13, backfill 100% completo, índices presentes, as 3 tabelas fora de escopo **não** ganharam a coluna, e RPCs críticas do dia a dia continuam respondendo sem erro).

Migrations: `migrations/REF-SAAS-01-onda0-schema.sql` + `migrations/REF-SAAS-01-onda0-schema-rollback.sql`.

### Testes

`npm run test:domain` (suíte de lógica pura — não deveria ser afetada, já que nenhum código de `src/` foi tocado nesta onda) + `npm run test:saas01-onda0-schema` (novo, ver acima) após a migration ser aplicada.

### Migration — aplicada (2026-08-07)

Executada via `node run.mjs --file migrations/REF-SAAS-01-onda0-schema.sql` (tool local `.encanto`, autorização Opção B do dono). Transação única, `BEGIN...COMMIT` sem erro. Nenhum bloqueio do guardrail do ambiente desta vez — a autorização explícita liberou a execução.

### Validação

- `npm run test:saas01-onda0-schema` → **20/20 PASS** (S1–S7): tabela `stores` com a loja "encanto" (`id 8604324d-0529-443d-aa79-4337057bfa01`, `slug=encanto`, `status=ativo`, `dominio=encanto.valionsistemas.com.br`), RLS habilitado, `store_id` presente/uuid/nullable/com FK nas 13 tabelas, backfill 100% completo em todas (contagens reais: `customers`=18, `products`=38, `categories`=9, `adicionais`=35, `product_collections`=0, `orders`=94, `order_items`=95, `order_events`=331, `loyalty_accounts`=5, `loyalty_events`=18, `notification_outbox`=51, `addresses`=14, `application_logs`=59 — zero `store_id NULL` em qualquer uma), índice `*_store_id_idx` presente nas 13, `admins`/`settings`/`address_gazetteer` **não** ganharam a coluna (confirma que o escopo foi respeitado).
- `npm run test:domain` → **exit 0, zero falha** (suíte completa de golden/guard tests). Nenhum código de `src/` foi tocado nesta onda — resultado esperado, confirma zero regressão na Encanto Marmitaria.

### Commit / Push

Commit único cobrindo migration + rollback + script de verificação + registro no `package.json` + este ledger.

### Relatório técnico da onda

**Objetivo cumprido:** fundação de dados criada — `stores` existe com a loja "encanto" como Cliente Zero, e as 13 tabelas de negócio já têm `store_id` (nullable, indexado, com FK), 100% retrocompatível. **Nada em `src/` foi alterado** — a Encanto Marmitaria continua funcionando exatamente igual, porque nenhuma RPC/RLS/componente lê essa coluna ainda. **Escopo respeitado:** `admins` (Onda 1), `settings`→`store_settings` (Onda 4) e `address_gazetteer` (permanece global) ficaram de fora, como decidido no ADR. **Risco durante a execução:** nenhum incidente — volume de dados pequeno (total ~800 linhas somadas), transação única, sem lock prolongado. **Pronta para a Onda 1** (gateway de autorização: `super_admins`, `admins.store_id`, `is_admin_of()`, `is_admin()` como wrapper).

---

## Onda 1 — Gateway de autorização

**✅ CONCLUÍDA (2026-08-07)**

### Auditoria específica da onda

Estado pré-onda confirmado por leitura direta: `public.admins` tinha 1 única linha (`user_id b9dc7626-af9c-4ab5-95f7-3207e6469129`, o admin real de produção da Encanto), `UNIQUE(user_id)`, sem `store_id`. `is_admin()` consultava essa tabela direto. Nenhum papel de super admin existia.

### Plano técnico

1. `CREATE TABLE super_admins` (global, `user_id` PK → `auth.users`, sem `store_id` por definição — ADR §1.3), RLS habilitado + policy de self-read (mesmo padrão de `admins`).
2. `admins.store_id`: adiciona nullable → backfill com a loja "encanto" (único admin hoje) → `SET NOT NULL` → troca `UNIQUE(user_id)` por `UNIQUE(store_id, user_id)` (permite 1 `user_id` em várias lojas sem tabela de vínculo separada — ADR §1.4). Diferente da Onda 0 (que manteve tudo nullable), aqui a coluna vai direto a `NOT NULL` na mesma migration porque só existe 1 admin hoje e nenhuma RPC além de `is_admin()` toca essa tabela.
3. `is_super_admin()` / `is_admin_of(p_store_id)` — novas, `SECURITY DEFINER`, mesmo estilo das RPCs existentes.
4. `is_admin()` — `CREATE OR REPLACE` (mesma assinatura) passa a delegar para `is_admin_of(<id da loja "encanto">)`. Retrocompatibilidade: nenhuma das ~30 RPCs que já chamam `is_admin()` precisou mudar.

Migrations: `migrations/REF-SAAS-01-onda1-autorizacao.sql` + `-rollback.sql`.

### Testes

`scripts/saas01-onda1-authz-test.mjs` (`npm run test:saas01-onda1-authz`) — 2 camadas: (A) estrutural somente-leitura e (B) **comportamental**, simulando sessão real via `SET LOCAL ROLE` + `request.jwt.claims` dentro de `BEGIN...ROLLBACK` (mesmo padrão de `scripts/auth-rls-test.mjs` já usado no projeto) — prova que o admin real de produção continua autorizado identicamente a antes da migration, que um usuário aleatório é negado, e que `is_super_admin()` implica `is_admin_of()` em qualquer loja (testado inserindo um super admin fictício que o `ROLLBACK` desfaz — mutação líquida zero). `npm run test:domain` roda depois, para confirmar zero regressão no app.

### Migration — aplicada (2026-08-07)

Via `node run.mjs --file migrations/REF-SAAS-01-onda1-autorizacao.sql`. Transação única, sem erro.

### Validação

- `npm run test:saas01-onda1-authz` → **9/9 PASS na primeira execução limpa** (3 achados na primeira rodada foram corrigidos no *script de teste*, não na migration — ver nota abaixo). Prova comportamental real: o admin de produção (`b9dc7626-...`) continua com `is_admin()=true` e agora também `is_admin_of(<id encanto>)=true`; um usuário sem vínculo nenhum é negado em ambas; um super admin simulado (inserido e desfeito dentro do mesmo `ROLLBACK`, nunca persiste) tem `is_admin_of()=true` em uma loja aleatória onde não tem nenhuma linha em `admins` — prova que a composição `is_super_admin() OR EXISTS(...)` funciona como desenhado no ADR §4.
- `npm run test:domain` → **exit 0**, zero regressão.

**Nota de qualidade do processo (não é desvio do ADR, é acerto do processo de validação):** a primeira execução do script de teste apontou 3 falhas, todas no *script*, não na migration: (1) comparação de array via `JSON.stringify` sem `::text` no `array_agg` (domínio `sql_identifier` do `information_schema` não é reconhecido pelo parser de arrays do driver `pg`); (2) duas checagens tentaram reconsultar `public.stores` de dentro da sessão simulada como `authenticated` — mas `stores` tem RLS habilitado sem nenhuma policy (de propósito, Onda 0), então essa subconsulta sempre voltava vazia sob esse papel, testando `is_admin_of(NULL)` por engano; corrigido resolvendo o `id` da loja uma vez, como superusuário, antes de entrar na sessão simulada; (3) o teste de super admin tentava inserir um `user_id` fictício que não existe em `auth.users`, violando a FK de `super_admins` — corrigido reaproveitando o `user_id` real do admin de produção (que já satisfaz a FK) para provar o mesmo comportamento. As 3 correções foram só no arquivo de teste; a migration não mudou.

### Commit / Push

Commit único cobrindo migration + rollback + script de verificação (já corrigido) + registro no `package.json` + este ledger.

### Relatório técnico da onda

**Objetivo cumprido:** `super_admins` (papel global da VALION) e `is_admin_of(store_id)`/`is_super_admin()` existem; `admins.store_id` é `NOT NULL` com `UNIQUE(store_id, user_id)`; `is_admin()` agora delega para `is_admin_of()` mantendo o mesmo comportamento para o admin único de hoje — **retrocompatibilidade comprovada por teste comportamental real**, não só por leitura de schema. **Diferença deliberada em relação à Onda 0:** `admins.store_id` foi direto a `NOT NULL` na mesma migration (não ficou nullable-para-sempre) porque só existe 1 admin hoje e nenhuma outra RPC/RLS depende dessa tabela ainda — decisão dentro do espírito do ADR (§9: nullable-primeiro é sobre não quebrar o que já depende da coluna; aqui nada dependia). **Risco:** nenhum incidente; a suíte de teste pegou 3 bugs *de teste* antes do commit, exatamente a função da etapa de Validação. **Pronta para a Onda 2** (RLS/RPCs do catálogo: `products/categories/adicionais/product_collections` ganham policy com predicado de `store_id`).
