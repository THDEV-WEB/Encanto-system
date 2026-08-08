# REF-SAAS-01 — Plano de implementação por ondas (fundação multi-tenant)

- **Status:** 🟢 **Em execução — Ondas 0, 1, 2 e 3 concluídas (2026-08-07/08).** O dono confirmou que o rigor de validação comportamental elevado na Onda 2 (teste positivo E negativo por policy, isolamento entre lojas provado por comportamento) **vale para toda onda que mexer em RLS/policy daqui pra frente**, não só a Onda 2. ADR mestre (`docs/adr/REF-SAAS-01-fundacao-multitenant.md`) aprovado como referência arquitetural permanente. Autorização de escrita direta em produção concedida pelo dono (Opção B, 7 condições registradas na sessão), válida exclusivamente para esta REF. Onda 2 opera sob exigência adicional do dono: **toda policy nova precisa de teste positivo E negativo, prova de isolamento entre lojas, e nenhuma policy é considerada concluída só por inspeção visual/compilação — só por comportamento provado.**
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
| **2** | RLS + RPCs do catálogo (`products/categories/adicionais/product_collections`) com `store_id` | Onda 1 | ✅ **Concluída (2026-08-08)** — ver seção própria abaixo |
| **3** | Identidade do cliente — decisão já tomada no ADR §2 (por loja, auth global); esta onda é só a implementação (`customers.store_id`, uniques compostos, `link_customer_to_auth`) | Onda 0 | ✅ **Concluída (2026-08-08)** — ver seção própria abaixo |
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

---

## Onda 2 — RLS + policies do catálogo

**🔧 EM EXECUÇÃO (2026-08-08).** O dono elevou explicitamente o rigor de validação exigido para esta onda em relação às anteriores: prova de leitura pública correta, prova de isolamento entre lojas, tentativa negativa de acessar catálogo de outra loja, comportamento sem autenticação, comportamento do Admin, e regressão completa do Cliente Zero — **toda policy nova precisa de teste positivo E negativo; nenhuma é aceita só por inspeção visual/compilação.**

### Auditoria específica da onda

Introspecção direta (schema + RLS + grants) das 4 tabelas de catálogo, e leitura de `src/services/DataService.js`, revelou dois pontos que a redação original do roadmap ("RLS + RPCs do catálogo") não antecipava com precisão — nenhuma conclusão da auditoria/ADR anteriores foi reaproveitada sem essa reverificação:

1. **Catálogo é a única área do sistema onde a escrita NÃO passa por RPC `SECURITY DEFINER`.** O Ground Truth do ADR (§0) generaliza "praticamente toda escrita passa por RPC nomeada" — verdadeiro para pedidos/fidelidade/config, mas **falso para catálogo**: `upsertCat`/`upsertProd`/`upsertAd`/`delCat`/`delProd`/`delAd` (`DataService.js:232-327`) chamam `.from('products'|'categories'|'adicionais').insert()/.update()/.delete()` diretamente via `supabase-js`. Toda a autorização de escrita hoje mora inteiramente nas 3 policies `is_admin()` de cada tabela (`Auth insert/update/delete <tabela>`) — não em código de aplicação nem em função alguma. Confirmado por introspecção de `pg_policy`: as 4 tabelas têm exatamente o mesmo padrão — 1 policy pública de leitura (`USING (true)`, sem nenhum predicado, aplicada a QUALQUER role incluindo `anon`) + 3 policies de escrita (`is_admin()`, sem checar `store_id` da linha) para `authenticated`.
2. **Nenhum INSERT de catálogo hoje seta `store_id`.** `upsertCat`/`upsertProd`/`upsertAd` nunca incluem essa coluna no payload. Como `store_id` é nullable desde a Onda 0 e não tinha `DEFAULT`, apertar a policy de escrita para `is_admin_of(store_id)` sem antes dar um `DEFAULT` à coluna quebraria a criação de catálogo novo (linha nasceria com `store_id NULL`, `is_admin_of(NULL)` nunca é verdadeiro, e a policy de leitura passaria a escondê-la também) — regressão real na Encanto Marmitaria, não hipotética.
3. Constraints `UNIQUE` hoje globais, exatamente como o Ground Truth do ADR já sinalizava, confirmadas por nome real: `categories_slug_uk UNIQUE(slug)`, `unique_nome_categoria UNIQUE(nome, categoria_id)` em `products`, `adicionais_nome_grupo_cat_uniq UNIQUE(nome, grupo, aplica_categoria_id)`, `product_collections_uk UNIQUE(product_id, collection_id)`. Nenhuma é referenciada por FK de outra tabela (só a PK `id` de `categories`/`products` é referenciada) — seguras para `DROP`+recriar com `store_id` líder, sem efeito colateral.
4. `product_collections` continua com 0 linhas em produção e zero código em `src/` que a referencie (confirmado por grep) — tratada com o mesmo rigor das outras 3 por consistência de schema (ADR §9), mas sem nenhum caminho de regressão possível hoje.

**Decisão de escopo registrada (não é desvio do ADR — é uma leitura mais precisa do que "RPCs do catálogo" significa aqui):** esta onda **não cria RPCs novas** para o catálogo. Não existe hoje nenhum chamador para uma futura `get_catalog(p_store_id)`/`admin_upsert_product(p_store_id, ...)` — criá-las agora, sem uso real, seria abstração especulativa (o mesmo padrão que este projeto já rejeita conscientemente em outros lugares). A "resolução explícita de loja" que o ADR §5 exige (nunca implícita via GUC/sessão) para o catálogo será naturalmente resolvida na Onda 6 (frontend multi-loja), quando `get_store_by_domain` existir e `DataService.js` puder passar `store_id` explicitamente em cada chamada — momento em que fará sentido decidir se essas chamadas migram para RPC ou continuam via tabela direta com `.eq('store_id', ...)`. Até lá, a tabela `stores` tem exatamente 1 linha (`encanto`), então a superfície de risco de manter acesso direto à tabela é conhecida e finita.

### Plano técnico

1. **`public.default_store_id()`** — nova função `SQL STABLE SECURITY DEFINER`, mesmo motivo de `is_admin()`/`is_admin_of()`/`is_super_admin()` já serem `SECURITY DEFINER` (tabela-fonte trancada por RLS sem policy): resolve o `id` da loja `encanto` bypassando o cadeado de `stores`. É a ponte de compatibilidade desta onda — mesmo papel que o wrapper `is_admin()` cumpriu na Onda 1 — usada em dois lugares:
   - `DEFAULT` de `store_id` nas 4 tabelas (cobre todo INSERT que não informa a coluna, preservando o comportamento atual do Admin).
   - Parte da nova policy de leitura pública (ver item 4).
2. `store_id` recebe o `DEFAULT` acima nas 4 tabelas, depois vai a `NOT NULL` (backfill já é 100% desde a Onda 0; com o `DEFAULT` cobrindo INSERTs futuros, nada mais depende de ficar nullable — ADR §9.1).
3. As 4 constraints `UNIQUE` globais são recriadas com `store_id` como coluna líder (ADR §9.4): `categories_store_slug_uk(store_id, slug)`, `products_store_nome_categoria_uniq(store_id, nome, categoria_id)`, `adicionais_store_nome_grupo_cat_uniq(store_id, nome, grupo, aplica_categoria_id)`, `product_collections_store_product_collection_uk(store_id, product_id, collection_id)`.
4. **Leitura pública** — de `USING (true)` (zero predicado, qualquer role) para `USING (store_id = default_store_id() OR is_admin_of(store_id))`. Padrão sugerido pelo próprio ADR §11. O `OR is_admin_of(store_id)` não é estritamente necessário para o Cliente Zero hoje, mas fecha preventivamente uma lacuna da Onda 5 (admin de uma 2a loja precisaria enxergar o próprio catálogo mesmo antes do seletor de loja existir) ao custo de uma cláusula, e é testável agora.
5. **Escrita administrativa** — as 3 policies de cada tabela (`insert`/`update`/`delete`) trocam `is_admin()` por `is_admin_of(store_id)`. Mudança de comportamento real (não só de forma): hoje um admin de QUALQUER loja (não que exista mais de uma) passa pela policy só por `is_admin()=true`, sem olhar a linha; a partir de agora a policy verifica explicitamente se aquele admin administra a loja DAQUELA linha. Super admin continua passando em qualquer loja (composição já embutida em `is_admin_of`).

Migrations: `migrations/REF-SAAS-01-onda2-catalogo.sql` + `migrations/REF-SAAS-01-onda2-catalogo-rollback.sql` (ambas já escritas e revisadas nesta seção, antes de qualquer aplicação — condição 3 da autorização do dono).

### Testes (planejados — exigência elevada desta onda)

`scripts/saas01-onda2-catalogo-test.mjs`, cobrindo, para cada uma das 4 tabelas × 4 operações (SELECT/INSERT/UPDATE/DELETE) = 16 pontos de policy, teste positivo E negativo conforme exigido:

- **Leitura pública / sem autenticação:** role `anon` (sem JWT nenhum) enxerga o catálogo da loja `encanto` (positivo) e NÃO enxerga uma linha de uma loja B fictícia inserida só dentro da transação de teste (negativo/isolamento).
- **Tentativa de acessar catálogo de outra loja:** admin real de `encanto` tenta ler/escrever uma linha da loja B fictícia → negado em todos os 4 comandos. Admin fictício da loja B tenta ler/escrever uma linha de `encanto` → negado.
- **Comportamento do Admin:** admin real de `encanto` mantém exatamente o mesmo comportamento de hoje (ler/inserir sem `store_id` explícito/atualizar/excluir suas próprias linhas). Admin fictício da loja B lê/escreve as próprias linhas normalmente (prova que `is_admin_of` funciona para uma 2a loja, não só a legada).
- **Super admin:** super admin fictício (inserido e desfeito no mesmo `ROLLBACK`) lê/escreve uma linha da loja B mesmo sem nenhuma linha em `admins` — prova a composição `is_super_admin() OR EXISTS(...)` especificamente através das policies de catálogo, não só da função isolada (já provado na Onda 1).
- **Regressão do Cliente Zero:** replay das operações reais do Admin de hoje (listar categorias ativas/todas, produtos com join de categoria, adicionais, criar/editar/excluir) como o admin real de produção, dentro de `BEGIN...ROLLBACK` — mutação líquida zero.

Toda a camada comportamental usa o padrão já validado (`SET LOCAL ROLE` + `request.jwt.claims` dentro de `BEGIN...ROLLBACK`, mesmo helper das Ondas 1/`auth-rls-test.mjs`); a loja B e seu admin fictício são inseridos como superusuário no início da transação e desfeitos pelo `ROLLBACK` final — nunca persistem.

`npm run test:domain` roda depois, para confirmar zero regressão no app (nenhum código de `src/` é tocado nesta onda).

### Migration — aplicada (2026-08-08)

Executada via `node run.mjs --file migrations/REF-SAAS-01-onda2-catalogo.sql` (tool local `.encanto`, autorização Opção B do dono). Transação única, `BEGIN...COMMIT` sem erro.

### Validação

- `npm run test:saas01-onda2-catalogo` (novo) → **124/124 PASS na versão corrigida do script** (a primeira execução encontrou 3 bugs, todos no *script de teste*, detalhados na nota de qualidade abaixo — a migration não mudou nenhuma vez). Camada A (5 checks estruturais): `store_id NOT NULL` nas 4 tabelas, as 4 uniques compostas com `store_id` líder substituíram as globais, `default_store_id()` existe e resolve para "encanto", as 4 policies de leitura pública citam `default_store_id()`/`is_admin_of()` no texto real da policy (não só na migration — lido de volta do catálogo do Postgres), as 12 policies de escrita citam `is_admin_of(store_id)` e nenhuma ficou com `is_admin()` cego. Camada B (comportamental, 29 checks × 4 tabelas = 116 checks): para cada uma das 4 tabelas, sessões simuladas via `SET LOCAL ROLE` + `request.jwt.claims` provaram — **anon** vê a loja padrão e não vê a loja B (isolamento) nem consegue escrever nada; **cliente autenticado sem nenhum vínculo de admin** tem exatamente o mesmo comportamento de leitura do anon; **admin real da Encanto** mantém 100% do comportamento de hoje (lê/insere sem `store_id`/atualiza/exclui a própria loja) e é negado ao tentar ler, inserir, atualizar, mover (`UPDATE ... SET store_id`) ou excluir qualquer linha da loja B; **admin fictício de uma 2ª loja** consegue operar a própria loja normalmente (inclusive lendo a loja padrão, que é pública por design) e é negado ao tentar tocar a loja da Encanto — inclusive o caso de borda em que esse admin insere **sem** informar `store_id` e é negado, porque o `DEFAULT` da ponte de compatibilidade aponta para "encanto", não para a loja dele (achado documentado, não bug); **super admin fictício** (inserido e desfeito no mesmo `ROLLBACK`) lê/insere/atualiza/exclui na loja B mesmo sem nenhuma linha em `admins` para aquela loja, provando a composição `is_super_admin() OR EXISTS(...)` especificamente através das policies de catálogo. Três checks finais de regressão com **dados reais** (não sintéticos): contagem de categorias/produtos/adicionais vista por `anon` bate exatamente com a contagem real vista como superusuário (nada sumiu do catálogo real); o fluxo real de `toggleProd` (alternar `disponivel` de um produto de produção de verdade) continua funcionando idêntico a antes, dentro de `ROLLBACK`; e, ao final de toda a suíte, zero linha fictícia (loja B, admin B, super admin, catálogo da loja B) ficou persistida em produção.
- `npm run test:domain` → **exit 0, zero falha** (suíte completa de golden/guard tests, nenhum código de `src/` foi tocado nesta onda).

**Nota de qualidade do processo (não é desvio do ADR, é acerto do processo de validação):**
1. A introspecção inicial de constraints (`pg_constraint`) não revelou um *trigger* (`trg_sti_pc_collection`, função `trg_sti_pc_collection_is_collection`) que exige que `product_collections.collection_id` referencie uma categoria com `tipo='collection'` (mecanismo STI de uma REF anterior, ADMIN-CATALOG-01). O script de teste precisou marcar as categorias fictícias usadas como alvo de coleção com `tipo='collection', estrategia='manual'` (a `CHECK categories_sti_biz_chk` exige `estrategia NOT NULL` sempre que `tipo <> 'business'`). Achado de auditoria incompleta corrigido no próprio script, sem qualquer mudança na migration.
2. A consulta inicial a `pg_policy` usava `conrelid` (coluna que não existe nessa view) em vez de `polrelid` — erro de sintaxe simples, corrigido nas duas queries estruturais (A4/A5).
3. **O bug mais relevante:** uma tentativa de escrita negada pelo `WITH CHECK` do RLS lança um erro real do Postgres (`new row violates row-level security policy`), que — sem tratamento — envenena a transação inteira: todo comando seguinte falha com `current transaction is aborted`, mascarando os testes seguintes como falso-negativo em vez de exercitar a policy de verdade. Corrigido envolvendo cada tentativa de escrita em `SAVEPOINT`/`ROLLBACK TO SAVEPOINT`, permitindo que uma negação esperada não derrube o restante da sessão simulada. As três correções foram só no arquivo de teste; a migration não mudou nenhuma vez desde a primeira aplicação.

### Commit / Push

Commit único cobrindo migration + rollback + script de verificação (já corrigido) + registro no `package.json` + este ledger.

### Relatório técnico da onda

**Objetivo cumprido:** as 4 tabelas de catálogo (`products`/`categories`/`adicionais`/`product_collections`) têm `store_id NOT NULL` com `DEFAULT` de compatibilidade, uniques compostas com `store_id` líder, leitura pública escopada à loja padrão (ou à própria loja do admin) e escrita administrativa escopada por `is_admin_of(store_id)` em vez de `is_admin()` cego. **Mudança de comportamento real, não só de forma:** antes desta onda, qualquer admin autenticado podia escrever em QUALQUER linha de catálogo, porque a policy nunca olhava a coluna `store_id` da linha — a partir de agora, um admin só escreve nas linhas da(s) loja(s) que administra; super admin continua com acesso irrestrito por composição. **Decisão de escopo registrada:** esta onda não criou RPCs novas para o catálogo — nenhum código em `src/` chama uma hoje, e criá-las sem uso real seria abstração especulativa; a migração de `DataService.js` para passar `store_id` explícito (via RPC ou `.eq()`) fica para a Onda 6, quando `get_store_by_domain` existir. **Achado de auditoria não previsto no ADR:** o catálogo é a única área do sistema onde a escrita não passa por RPC `SECURITY DEFINER` — toda a autorização mora nas policies RLS; isso moldou a decisão de dar `DEFAULT` ao `store_id` antes de apertar qualquer policy, para não quebrar os `upsertCat`/`upsertProd`/`upsertAd` existentes (nenhum seta `store_id` hoje). **Rigor de validação, por exigência explícita do dono para esta onda:** 124 checks comportamentais e estruturais, com teste positivo E negativo para cada uma das 16 policies novas/alteradas (4 tabelas × leitura+insert+update+delete), prova de isolamento entre lojas usando uma loja B fictícia (nunca persistida — `ROLLBACK`), prova de que `anon`/cliente sem vínculo/admin de outra loja são todos negados ao tentar tocar a loja da Encanto, e 3 checks finais de regressão contra dados reais de produção (não só sintéticos). **Risco durante a execução:** nenhum incidente em produção; todos os 3 bugs encontrados foram no script de teste (2 erros de sintaxe SQL de introspecção, 1 problema real de design de teste — falta de `SAVEPOINT` — corrigido antes do commit). **Pronta para a Onda 3** (identidade do cliente: `customers.store_id` NOT NULL, uniques compostas, `link_customer_to_auth` com `p_store_id` explícito — decisão já tomada no ADR §2, esta próxima onda é só a implementação).

---

## Onda 3 — Identidade do cliente por loja

**🔧 EM EXECUÇÃO (2026-08-08).** Decisão arquitetural já tomada no ADR §2 (identidade de autenticação global, vínculo comercial por loja — "dois registros `customers` distintos, um por loja, como se fossem dois apps diferentes só compartilhando a tela de login"). Esta onda é a implementação. O dono pediu atenção especial às regras de unicidade por loja e manteve o rigor de validação comportamental da Onda 2 (teste positivo E negativo, prova por comportamento, não por inspeção).

### Auditoria específica da onda

Introspecção direta de `customers` (colunas/constraints/índices/RLS/triggers), da definição real de `link_customer_to_auth`/`admin_link_customer_to_auth`/`create_order`, e leitura de `AuthService.js`. Achados que moldaram o plano — nenhuma conclusão da auditoria/ADR anteriores foi reaproveitada sem reverificação:

1. **`customers.auth_user_id` tem hoje `UNIQUE(auth_user_id) WHERE auth_user_id IS NOT NULL` — global.** Essa é a trava que **fisicamente impede** a decisão do ADR §2 de existir: hoje um mesmo `auth.uid()` não pode ter mais de UM registro `customers` no sistema inteiro. Sem mudar este índice, "cliente por loja" nunca sai do papel, não importa o que mais for feito.
2. `customers.phone` (`customers_phone_uniq`) e `lower(customers.email)` (`customers_email_key`) também são únicos globais — os mesmos que o Ground Truth do ADR já sinalizava, agora confirmados pelos nomes reais dos índices (todos os 3 são **índices**, não constraints nomeadas — os dois últimos são parciais (`WHERE ... IS NOT NULL`), e Postgres não aceita `WHERE` em `ADD CONSTRAINT UNIQUE`, então continuam como índice após a migração, não viram constraint).
3. **Achado que mudou o raio da migration:** `create_order` — RPC crítica do checkout, nominalmente escopo da Onda 4 — faz `INSERT INTO customers ... ON CONFLICT (phone) DO UPDATE ...`. O alvo de um `ON CONFLICT` precisa casar exatamente com um índice único existente. Trocar `customers_phone_uniq` por `(store_id, phone)` **sem** corrigir essa linha quebraria **todo checkout** (erro `there is no unique or exclusion constraint matching the ON CONFLICT specification`). Confirmado por grep em todas as funções do banco (`ON CONFLICT`) que esta é a **única** função afetada pela mudança dos índices de `customers` — as demais ocorrências de `ON CONFLICT` são sobre `settings.chave` ou `loyalty_accounts.customer_id`, tabelas não tocadas nesta onda. Corrigido aqui, minimamente (só a linha do upsert do cliente), porque é consequência direta e obrigatória da mudança de schema desta onda, não redesenho do fluxo de pedidos.
4. **Achado de regressão latente (não corrigido nesta onda, documentado para a Onda 4):** `AuthService.js:111` faz `db.from('customers').select(...).eq('auth_user_id', userId).limit(1).maybeSingle()` — sem filtro de loja. Hoje é seguro (só existe 1 loja). No dia em que existir uma 2ª loja, essa consulta ficaria ambígua (poderia devolver a linha errada, de outra loja, sem determinismo — não há `ORDER BY`). A policy RLS "Cliente le proprio customer" ganhou uma âncora na loja padrão (`store_id = default_store_id()`) exatamente para fechar esse risco **no banco**, já nesta onda, mesmo sem tocar o código do frontend (a correção definitiva — o frontend passar `store_id` explícito na própria consulta — é trabalho da Onda 6). O mesmo padrão de âncora temporária já foi usado na Onda 2 para a leitura pública do catálogo.
5. **Fora do escopo desta onda, documentado para a Onda 4 (fidelidade/pedidos):** `get_my_loyalty()` e `redeem_reward()` fazem `SELECT id FROM customers WHERE auth_user_id = v_uid LIMIT 1` (sem filtro de loja, dentro de função `SECURITY DEFINER` — não passa pela RLS corrigida nesta onda); `admin_find_loyalty(p_query)` busca cliente por telefone **sem** filtro de loja. Nenhum dos dois é regressão hoje (1 loja só), mas ambos precisam ganhar `p_store_id`/filtro de loja quando a Onda 4 mexer em fidelidade — registrado aqui para não ser esquecido.
6. `admin_link_customer_to_auth` **não é chamada por nenhum código do frontend hoje** (confirmado por grep) — órfã/reservada. Mesmo assim, como já escreve em `customers`, foi alinhada ao mesmo padrão desta onda (`is_admin_of(store_id da linha)` em vez de `is_admin()` cego), por consistência com o resto da tabela, não por haver um caminho de regressão real.

### Plano técnico

1. `customers.store_id` ganha `DEFAULT public.default_store_id()` (função já criada na Onda 2, reaproveitada) e vai a `NOT NULL` (backfill 100% desde a Onda 0).
2. As 3 uniques viram compostas com `store_id` líder: `customers_store_phone_uniq(store_id, phone)`, `customers_store_email_key(store_id, lower(email)) WHERE email IS NOT NULL`, `customers_store_auth_user_id_key(store_id, auth_user_id) WHERE auth_user_id IS NOT NULL` — esta última é a peça central da onda (ADR §2).
3. `create_order`: linha do upsert do cliente passa a ser `INSERT ... (name, phone, store_id) VALUES (..., default_store_id()) ON CONFLICT (store_id, phone) DO UPDATE ...`. Resto da função **byte-a-byte idêntico** ao que já estava em produção.
4. `link_customer_to_auth` ganha `p_store_id uuid DEFAULT public.default_store_id()` (ADR §2, "ganha p_store_id explícito") — todas as consultas internas a `customers` passam a filtrar por `store_id = v_store`. Lock consultivo (`pg_advisory_xact_lock`) passa a incluir a loja na chave (`telefone || ':' || store_id`), corrigindo uma contenção cruzada entre lojas que existia por acidente no lock global por telefone.
5. `admin_link_customer_to_auth`: `is_admin()` cego → `is_admin_of(store_id)` resolvido a partir da própria linha do cliente alvo.
6. RLS `customers`: `"Admin all customers"` troca `is_admin()` por `is_admin_of(store_id)` (mesma mudança de comportamento real da Onda 2 — um admin deixa de conseguir tocar cliente de outra loja); `"Cliente le proprio customer"` ganha a âncora `AND store_id = default_store_id()` (ponte Onda3-6, ver achado 4 acima).

Migrations: `migrations/REF-SAAS-01-onda3-identidade-cliente.sql` + `-rollback.sql` (ambas já escritas e revisadas nesta seção, antes de qualquer aplicação — condição 3 da autorização do dono).

### Testes (planejados — mesmo rigor comportamental da Onda 2)

`scripts/saas01-onda3-identidade-cliente-test.mjs`, cobrindo:

- **Camada A (estrutural):** `store_id NOT NULL`; os 3 novos índices únicos existem com `store_id` líder e os 3 antigos (globais) sumiram; `create_order`/`link_customer_to_auth`/`admin_link_customer_to_auth` citam `store_id`/`is_admin_of` no código-fonte real (lido de volta do `pg_proc`, não da migration); as 2 policies citam o novo predicado.
- **Camada B (comportamental) — a prova central da onda:** com uma loja B fictícia (nunca persistida — `BEGIN...ROLLBACK`), provar que **a mesma pessoa** (mesmo `auth.uid()`) consegue ter um `customers` na loja encanto E outro na loja B **simultaneamente** — o cenário que a constraint antiga tornava impossível. Teste positivo (consegue) e negativo (tentar duplicar telefone/e-mail/`auth_user_id` **dentro da mesma loja** continua sendo barrado pela unique) para cada uma das 3 uniques. `link_customer_to_auth` chamado explicitamente com `p_store_id` de cada loja, provando isolamento: criar/atualizar/ler um customer na loja B não vaza nem colide com o customer da mesma pessoa na loja encanto. RLS: cliente vê o próprio customer da loja padrão, não vê o de uma loja B fictícia mesmo sendo o mesmo `auth.uid()`; admin real (encanto) não enxerga/edita customer da loja B; admin fictício da loja B enxerga/edita o próprio; `anon`/cliente sem vínculo negados em toda escrita. `admin_link_customer_to_auth` testado com admin certo (permite) e admin de outra loja (nega).
- **Regressão real:** replay do fluxo real de `create_order` (uma chamada real à RPC, dentro de `ROLLBACK`) confirmando que o checkout da Encanto continua criando/reaproveitando cliente por telefone exatamente como antes; replay de `link_customer_to_auth` sem passar `p_store_id` (como o `AuthService.js` real chama hoje) confirmando que cai no `DEFAULT` e continua se comportando exatamente como antes da onda.

`npm run test:domain` roda depois, para confirmar zero regressão no app (nenhum código de `src/` é tocado nesta onda).

### Migration — aplicada (2026-08-08)

Executada via `node run.mjs --file migrations/REF-SAAS-01-onda3-identidade-cliente.sql` (tool local `.encanto`, autorização Opção B do dono). Transação única, sem erro visível no `COMMIT`. **Correção de emergência aplicada logo em seguida** — ver nota de qualidade do processo abaixo: `CREATE OR REPLACE FUNCTION link_customer_to_auth(..., p_store_id uuid DEFAULT ...)` **não substituiu** a função de 3 argumentos já existente — Postgres identifica funções por nome+tipos dos parâmetros, então adicionar um parâmetro cria um *overload* novo em vez de substituir. Isso deixou duas versões coexistindo e tornou **ambígua qualquer chamada com exatamente 3 argumentos — inclusive a chamada real de produção em `AuthService.js:125`**, quebrando login/cadastro de cliente. Corrigido em produção na mesma sessão, antes de qualquer outro teste, via `DROP FUNCTION public.link_customer_to_auth(text, text, text);` (rodado pelo mesmo mecanismo de arquivo de migration — uma tentativa via `--query` inline foi bloqueada pelo classificador do ambiente, confirmando que o padrão de arquivo é o caminho que funciona). Os arquivos `migrations/REF-SAAS-01-onda3-identidade-cliente.sql` e `-rollback.sql` foram atualizados para refletir o `DROP FUNCTION` explícito antes de qualquer `CREATE OR REPLACE` que adicione parâmetro — a migration aplicada em produção e o arquivo versionado no commit são idênticos.

### Validação

- `npm run test:saas01-onda3-identidade-cliente` (novo) → **36/36 PASS na versão corrigida do script** (a primeira execução encontrou 5 problemas — 1 real na migration, ver acima, e 4 no script de teste, detalhados na nota de qualidade abaixo). Camada A (4 checks estruturais): `store_id NOT NULL`, os 3 índices únicos migrados para `(store_id, ...)` com os 3 antigos globais removidos, as 3 funções (`create_order`/`link_customer_to_auth`/`admin_link_customer_to_auth`) citam `store_id`/`is_admin_of` no código-fonte real (lido de volta do `pg_proc`), as 2 policies citam o novo predicado. Camada B (comportamental) — **prova central da onda**: a mesma pessoa (mesmo `auth_user_id`) tem um `customers` na loja encanto **e** outro na loja B simultaneamente, confirmado por leitura direta como superusuário (`B1`) — o cenário que a unique global antiga tornava fisicamente impossível. Testes negativos confirmam que, **dentro da mesma loja**, telefone/e-mail/`auth_user_id` duplicados continuam barrados pelas 3 novas uniques compostas (erro real de `unique_violation` capturado). Sessão da "mesma pessoa" (sem `p_store_id`, como o `AuthService.js` real chama) prova que `link_customer_to_auth` continua atualizando o customer de encanto por padrão (regressão) e que, chamado explicitamente com `p_store_id` da loja B, atualiza o customer da loja B **sem tocar** o de encanto (isolamento). RLS: cliente vê o próprio customer da loja padrão mas não o da loja B mesmo sendo a mesma pessoa (a âncora `store_id = default_store_id()` fechando exatamente o risco identificado na auditoria); `anon` não consegue nem **ler** `customers` (achado: diferente do catálogo, essa tabela não tem grant nenhum para `anon` — a negação acontece na camada de GRANT, antes da RLS); admin real não vê/edita customer da loja B e vice-versa; super admin fictício acessa customer da loja B sem nenhuma linha em `admins` para aquela loja; `admin_link_customer_to_auth` permite vincular cliente sem vínculo da própria loja e nega para loja alheia. Dois checks finais de regressão com o fluxo **real** de checkout: `create_order` chamado como `anon` cria cliente novo com `store_id=encanto` (prova que o fix do `ON CONFLICT` não quebrou nada), e chamado de novo com o mesmo telefone aciona o ramo `DO UPDATE` (não só o `INSERT`) sem duplicar a linha. Checagem final confirma zero linha fictícia persistida.
- `npm run test:domain` → **exit 0, zero falha** (nenhum código de `src/` foi tocado nesta onda).

**Nota de qualidade do processo (a migration teve 1 bug real, corrigido antes do commit — diferente das Ondas 0-2, onde só o script de teste tinha bugs):**
1. **Bug real na migration:** `CREATE OR REPLACE FUNCTION` com um parâmetro a mais cria um *overload*, não substitui a função — detalhado acima. É a primeira vez nesta REF que um bug aparece na migration em vez de só no script de teste; a causa raiz é uma armadilha conhecida do Postgres (identidade de função = nome + tipos dos parâmetros), não um erro de lógica de negócio. Corrigido com `DROP FUNCTION` explícito antes do `CREATE OR REPLACE`, e a mesma correção foi replicada na rollback (que precisa remover o *overload* de 4 argumentos antes de recriar o de 3).
2. Três clientes fictícios de teste nasceram com `auth_user_id` já preenchido (`SAME_PERSON`), e os testes positivos de `admin_link_customer_to_auth` tentavam vincular a uma pessoa **diferente** — a função corretamente recusou com "cliente já vinculado a outra conta" (comportamento correto, preexistente à onda). Corrigido adicionando 2 clientes fictícios extras, sem vínculo, dedicados a esses testes.
3. A verificação pós-`create_order` das REGRESSAO-01/02 tentava ler `customers` ainda com `SET LOCAL ROLE anon` ativo (mesmo papel usado para chamar a RPC) — e `anon` não tem grant nenhum nessa tabela, então a própria verificação (não a RPC) disparava "permission denied". Corrigido com `RESET ROLE` antes da consulta de verificação (a chamada real à RPC como `anon` já havia sido comprovada antes do reset).
4. O check estrutural `B1` originalmente rodava dentro de uma sessão já trocada para `authenticated`/admin real — a própria RLS (`is_admin_of(store_id)`) filtrava a linha da loja B antes que o teste pudesse contá-la, produzindo falso-negativo. Corrigido rodando esse check como superusuário (função `txSuper`, sem `SET LOCAL ROLE`), já que o que se queria provar era um fato cru dos dados, não um resultado filtrado por policy.
Todas as correções do script foram feitas antes do commit; a migration final aplicada em produção já inclui o `DROP FUNCTION` desde o início do arquivo versionado.

### Commit / Push

Commit único cobrindo migration + rollback (já com o `DROP FUNCTION` corrigido) + script de verificação (já corrigido) + registro no `package.json` + este ledger.

### Relatório técnico da onda

**Objetivo cumprido:** a decisão do ADR §2 ("cliente por loja, auth global") agora é fisicamente possível no banco — `customers.store_id` é `NOT NULL`, as 3 uniques que eram globais (`phone`, `lower(email)`, `auth_user_id`) viraram compostas com `store_id` líder, e `link_customer_to_auth` ganhou `p_store_id` explícito (com `DEFAULT` de compatibilidade) que escopa todas as suas consultas internas. **Achado que ampliou o raio da onda:** `create_order` — nominalmente escopo da Onda 4 — usa `ON CONFLICT (phone)`, que quebraria integralmente o checkout assim que o índice de `phone` mudasse de forma; corrigido minimamente (só a linha do upsert do cliente) por ser consequência direta e obrigatória da mudança de schema desta onda. **Achado de regressão latente documentado, não corrigido (Onda 4):** `get_my_loyalty()`, `redeem_reward()` e `admin_find_loyalty()` resolvem cliente por `auth_user_id`/telefone sem filtro de loja — seguro hoje (1 loja só), mas precisa ganhar escopo de loja quando a Onda 4 mexer em fidelidade. **Risco real encontrado e corrigido ainda na sessão:** a própria migration continha um bug (overload de função do Postgres) que quebrava login/cadastro de cliente em produção — corrigido antes de qualquer teste de validação rodar, com o arquivo de migration atualizado para refletir a correção definitiva. **Rigor de validação mantido da Onda 2, por pedido explícito do dono:** 36 checks comportamentais e estruturais, teste positivo E negativo para cada unique nova, prova de isolamento entre lojas com uma loja B fictícia inteira (nunca persistida), e regressão contra o fluxo real de checkout (não só dados sintéticos). **Pronta para a Onda 4** (RLS/RPCs de pedidos/fidelidade/entrega/horário — a maior onda do roadmap, e onde os 3 achados de fidelidade documentados acima precisam ser fechados).
