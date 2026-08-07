# REF-SAAS-01 — Plano de implementação por ondas (fundação multi-tenant)

- **Status:** 📋 Planejado — **nenhuma onda iniciada**. ADR mestre (`docs/adr/REF-SAAS-01-fundacao-multitenant.md`) escrito e aprovado como referência arquitetural permanente. Onda 0 é o próximo passo.
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
| **0** | Fundação de dados: tabela `stores`; `store_id` nullable em todas as tabelas de negócio; backfill com a loja "encanto" | ADR mestre | 📋 Não iniciada |
| **1** | Gateway de autorização: `super_admins`, `is_admin_of(store_id)`, `admins.store_id`, `is_admin()` como wrapper de compatibilidade | Onda 0 | 📋 Não iniciada |
| **2** | RLS + RPCs do catálogo (`products/categories/adicionais/product_collections`) com `store_id` | Onda 1 | 📋 Não iniciada |
| **3** | Identidade do cliente — decisão já tomada no ADR §2 (por loja, auth global); esta onda é só a implementação (`customers.store_id`, uniques compostos, `link_customer_to_auth`) | Onda 0 | 📋 Não iniciada |
| **4** | RLS + RPCs de pedidos/fidelidade/entrega/horário (`orders` + `delivery_fee`/`maquininha_fee`, `loyalty_*`, `business_hours_schedule`, `delivery_fee_config` → `store_settings`) | Ondas 1–3 | 📋 Não iniciada |
| **5** | Admin multi-loja: seletor de loja, papel de super admin na UI | Onda 4 | 📋 Não iniciada |
| **6** | Frontend multi-loja: `get_store_by_domain`, branding restante (logo/favicon, paleta CSS, Termos/Fidelidade), geocoding fora de Timbó-only | Onda 5 | 📋 Não iniciada |
| **7** | Notificações/WhatsApp por loja — decisão explícita Rota A (Tech Provider) vs. Rota B (BSP) antes de codificar | Onda 4 | 📋 Não iniciada |
| **8** | Infra de provisionamento: RPC `provision_store`, checklist de loja nova | Ondas 0–7 | 📋 Não iniciada |
| **9** | Mobile/Capacitor — decisão de produto (app por loja vs. shell único), fora do código desta fundação | Avaliar com N≥3 lojas | 📋 Não iniciada |

Cada onda, ao iniciar, ganha sua própria seção neste documento (auditoria específica → plano técnico → implementação → testes → regressão → commit → push → doc → relatório), seguindo o mesmo formato já usado em `REF-ADMIN-04-plano-ondas.md`.
