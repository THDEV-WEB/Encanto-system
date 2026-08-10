# ADR REF-SAAS-01 — Fundação Multi-Tenant da Plataforma VALION SISTEMAS

- **Status:** 🟡 **Proposto — decisões arquiteturais fechadas, implementação NÃO iniciada.** Este documento é a referência arquitetural permanente da evolução SaaS; nenhuma migration deste REF pode ser escrita antes dele existir. Onda 0 começa em documento/commit separado, após este ADR ser lido.
- **Escopo:** fundação multi-tenant do banco (schema, RLS, RPCs), do modelo de autenticação/autorização, da resolução de loja no frontend/admin, e das convenções que toda REF futura deve seguir. Cobre as Ondas 0–9 do roadmap aprovado.
- **Não-escopo:** não implementa nenhuma tela de self-service de onboarding (Onda 8 só desenha o RPC de provisionamento); não decide o modelo de cobrança/billing da VALION; não resolve o bot de WhatsApp (REF-WHATSAPP-01, adiada por decisão do dono); não força migração dos ~10 clientes futuros — define a fundação que os tornará possíveis.
- **Depende de:** [auditoria original + revalidação REF-SAAS-01](../ref/REF-SAAS-01-plano-ondas.md) (ground truth condensado no §0 abaixo; ledger de ondas no mesmo documento).
- **Data:** 2026-08-07.

---

## 0. Ground truth (o que a auditoria e a revalidação já provaram, condensado)

Duas rodadas de investigação read-only (introspecção direta no Postgres de produção + leitura de código, sem nenhuma alteração) confirmaram, e depois reconfirmaram após 39 commits novos:

- **Zero `store_id`/`tenant_id` em qualquer lugar** — nenhuma das 16 tabelas, nenhuma das ~34 RPCs custom, nenhuma das ~25 policies RLS. O sistema é 100% single-tenant hoje.
- **`settings` é um key-value singleton global** (`chave` `UNIQUE` sozinha) — `company_info`, `store_mode`, `delivery_eta_min`, `loyalty_*`, `business_hours_schedule`, `delivery_fee_config` são todos uma linha única no sistema inteiro. Cada REF nova (BUSINESS-HOURS-04, DELIVERY-FEE-01) **adicionou mais chaves no mesmo padrão** — o débito cresce na mesma direção a cada feature nova.
- **`admins` é `(id, user_id, created_at)`** — nenhum papel, nenhum escopo. `is_admin()` é `SELECT EXISTS(... WHERE user_id = auth.uid())`, boolean puro, sem parâmetro.
- **Uniques globais que colidiriam entre lojas:** `customers.phone`/`customers.email` (`lower(email)`), `categories.slug`, `products (nome, categoria_id)`, `adicionais (nome, grupo, aplica_categoria_id)`.
- **`orders` ganhou `delivery_fee`/`maquininha_fee`** (REF-DELIVERY-FEE-01, numeric NOT NULL DEFAULT 0) desde a auditoria original — mais duas colunas que entram no particionamento por loja.
- **Praticamente toda escrita passa por RPC `SECURITY DEFINER` nomeada** — nunca INSERT/UPDATE direto do cliente. Isso é o maior ativo estrutural para a migração: centralizar `store_id` é um trabalho grande, mas mecânico e localizado.
- **Domínio puro isolado** (`pricing.js`, `addons.js`, e agora `deliveryFeeRules.js` seguindo o mesmo molde) — zero imports, data-in/data-out, garantido por golden tests + guard de dependências. Não precisa mudar para suportar multi-loja.
- **Admin já vive em bundle/subdomínio próprios** (REF-ADMIN-04, em produção) — a separação física já resolvida; falta só a dimensão "quais dados o admin enxerga".
- **`address_gazetteer`** é dado geográfico de referência (bairro/rua por cidade), não dado de negócio de uma loja — ver §9 para a decisão de mantê-lo compartilhado.
- **WhatsApp:** disparo hoje via `pg_cron`+`pg_net`+Vault direto no Postgres (não Edge Function — código morto, confirmado sem nenhuma chamada `.functions.invoke()`), credenciais **globais** (2 segredos no Vault para o sistema inteiro). A pesquisa da REF-WHATSAPP-01 (2026-08-04) confirmou que autointegração de um único número não exige registro como Tech Provider da Meta, mas **gerenciar números em nome de múltiplos clientes exige** — decisão de negócio/compliance tratada no §7 e na Onda 7.

Nenhuma dessas conclusões foi assumida sem reverificação nesta sessão — ver o histórico de revalidação para o detalhe item a item.

---

## 1. Conceitos

### 1.1 Tenant vs. Store — decisão: não criar `tenants` agora

O pedido cobre "conceito de Tenant" e "conceito de Store" separadamente, mas a realidade comercial hoje é **1:1**: cada empresa cliente da VALION contrata uma loja. Criar uma tabela `tenants` acima de `stores` agora, sem nenhum caso de uso real (nenhuma empresa pediu múltiplas lojas físicas sob um contrato único), seria abstração prematura — exatamente o padrão que este projeto já rejeita conscientemente em outros lugares (NORM-07/08/09: "reservado, não implementado", "adiar não encarece").

**Decisão:** `stores` é a única tabela raiz nesta fundação. "Tenant" fica como conceito comercial (a empresa cliente da VALION), sem tabela própria. Se um dia uma empresa precisar de múltiplas lojas sob o mesmo contrato, adiciona-se `stores.tenant_id` **nesse momento**, sem quebrar nada do que for construído agora (toda tabela de negócio já aponta para `stores`, não para o conceito comercial).

### 1.2 Store

Unidade operacional: tem catálogo, horário, taxa de entrega, WhatsApp, pedidos, clientes, configuração institucional. Tabela nova:

```sql
CREATE TABLE public.stores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,          -- ex.: 'encanto' — usado em domínio/subdomínio
  nome        text NOT NULL,
  dominio     text UNIQUE,                   -- ex.: 'encanto.valionsistemas.com.br' (nullable até provisionar DNS)
  status      text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','suspenso','cancelado')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

### 1.3 Super Admin (da VALION)

Opera a plataforma inteira: cria/suspende/cancela lojas, enxerga métricas cross-store, nunca é "admin operacional" de uma loja específica por padrão (mas pode agir em qualquer loja para suporte — ver §4). Papel novo, tabela nova e **genuinamente global** (não tem `store_id` — é a única tabela de autorização que não particiona por loja, por definição):

```sql
CREATE TABLE public.super_admins (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

### 1.4 Admin da Loja

Equivalente ao `is_admin()` de hoje, mas escopado a 1+ lojas. **Decisão:** não criar uma tabela nova (`store_admins`/`admin_stores`) — estender a tabela `admins` que já existe, adicionando `store_id`. Isso preserva o nome, a RLS existente (só ganha mais um predicado) e naturalmente permite um `user_id` aparecer em várias linhas (admin de múltiplas lojas), sem inventar uma entidade de vínculo N:N que hoje não tem nenhum caso de uso real:

```sql
-- Onda 1 (não agora): ALTER TABLE admins ADD COLUMN store_id uuid REFERENCES stores(id);
-- backfill: UPDATE admins SET store_id = (SELECT id FROM stores WHERE slug='encanto');
-- só depois: ALTER TABLE admins ALTER COLUMN store_id SET NOT NULL;
-- e troca do UNIQUE(user_id) por UNIQUE(store_id, user_id)
```

### 1.5 Cliente

Consumidor final. Ver §2 — é a decisão mais cara de reverter, por isso ganha seção própria.

---

## 2. Modelo de identidade do cliente

Este era o ponto que a auditoria original apontou como "a decisão mais cara de reverter" do documento inteiro. Decidido agora, com justificativa, para não ser adiado até virar dívida.

**Contexto real do produto:** as ~10 empresas da meta inicial são negócios **independentes e sem relação entre si** (não concorrem no mesmo marketplace, não têm motivo de negócio para um cliente "circular" entre elas). Cada loja tem seu próprio domínio, marca, WhatsApp, cardápio. Isso é fundamentalmente diferente de um marketplace (iFood) onde múltiplas lojas competem dentro do MESMO app e SSO entre elas é o ponto central do produto.

**Decisão: identidade de autenticação global, vínculo comercial por loja.**

- `auth.users` (Supabase Auth) continua **global** — é gratuito reaproveitar, e a mesma pessoa pode usar a mesma conta Google/e-mail em duas lojas diferentes da plataforma sem custo de engenharia adicional.
- `customers` ganha `store_id NOT NULL`. Uma mesma pessoa (`auth_user_id`) que compra em duas lojas da plataforma tem **dois registros `customers` distintos**, um por loja, cada um com seu próprio histórico de pedidos/fidelidade — exatamente como se fossem dois apps diferentes, só compartilhando a tela de login.
- Uniques deixam de ser globais e passam a ser `UNIQUE(store_id, phone)` / `UNIQUE(store_id, lower(email))`. Duas lojas podem ter clientes com o mesmo telefone sem colidir.
- `link_customer_to_auth` ganha `p_store_id` explícito e passa a buscar/criar dentro daquela loja, não globalmente.

**Por que não a alternativa (SSO real com tabela de vínculo `store_customers`):** custo de engenharia muito maior (reformula `customers`/`orders`/`loyalty_*`/toda a RLS para uma relação N:N) para um benefício de produto que não existe hoje neste modelo de negócio. Fica registrado como **decisão revisável**: se a VALION um dia lançar um agregador de verdade (múltiplas lojas dentro do mesmo app/domínio, competindo pelo mesmo cliente), essa decisão é reaberta — não é a mesma coisa que "várias empresas usando o mesmo sistema", que é o que esta REF resolve.

---

## 3. Modelo de autenticação

**Decisão: um único projeto Supabase compartilhado por todas as lojas (shared-schema multi-tenant), não um projeto por loja.**

A auditoria levantou ambas as opções. Critério de decisão: o pedido explícito de preferir soluções que não aumentem custo/complexidade recorrente por loja. Um projeto por loja significa N credenciais, N pipelines, N lugares para aplicar a mesma migration — o custo operacional escala linearmente com o número de clientes, o oposto do que uma fundação SaaS deveria fazer. Shared-schema + RLS por `store_id` é o padrão que a própria Supabase documenta para este cenário (dezenas a centenas de tenants) e é o que permite migrations, deploys e observabilidade **uma vez só**, não uma vez por loja.

Login do cliente e do admin continuam exatamente como hoje (Google/e-mail OTP para cliente, e-mail/senha para admin, dois clientes Supabase com `storageKey` isolado) — nada nessa camada muda. O que muda é o que acontece **depois** do login: qual `customers`/`admins` aquele `auth.uid()` resolve, agora filtrado por loja.

**Registrado como decisão revisável:** se um cliente da VALION exigir contratualmente isolamento físico de banco (ex.: cláusula de LGPD específica), essa decisão é reaberta para aquele cliente especificamente — não precisa virar a regra para todos.

---

## 4. Modelo de autorização

Dois papéis novos, compostos sobre o `is_admin()` de hoje:

```sql
-- genuinamente global, sem store_id
CREATE FUNCTION is_super_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid());
$$;

-- escopado por loja; super admin passa em qualquer loja (suporte/operação)
CREATE FUNCTION is_admin_of(p_store_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = p_store_id AND a.user_id = auth.uid());
$$;

-- wrapper de COMPATIBILIDADE — resolve para a loja legada "encanto" até a última RPC
-- antiga ser migrada; is_admin() nunca é removida, só passa a delegar.
CREATE FUNCTION is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_admin_of((SELECT id FROM public.stores WHERE slug = 'encanto'));
$$;
```

Isso é o que permite migrar RPC por RPC (Ondas 2/4) sem quebrar as ~30 que ainda não foram tocadas — elas continuam chamando `is_admin()`, que continua funcionando, só que agora por composição em vez de consulta direta.

**Addendum (Onda 8.3, 2026-08-10):** `is_admin()` tem semântica **fixa** ("é admin da Encanto especificamente") — correto para as ~30 RPCs legadas, mas **errado** como gate de login agora que outras lojas existem: um admin vinculado só a outra loja é rejeitado. Nova função `is_admin_anywhere()` (`is_super_admin() OR` qualquer vínculo em `admins`, sem `store_id`) criada exclusivamente para esse gate (`AdminLogin.jsx`) — `is_admin()` não foi alterada, zero risco às RPCs legadas.

---

## 5. Fluxo de resolução da loja

**Princípio não-negociável: nenhuma RPC nova ou migrada infere a loja implicitamente (sessão/GUC/JWT). Toda RPC recebe `p_store_id uuid` como parâmetro explícito.** Verboso, mas auditável — o dado de entrada é explícito, nunca há comportamento default silencioso que "esquece" o filtro.

Como o `p_store_id` chega até a chamada:

- **Storefront público (cliente navegando/comprando):** o frontend resolve sua própria loja **uma vez**, no boot, via `get_store_by_domain(p_hostname text)` — RPC pública (`STABLE`, sem autenticação), que devolve `{id, slug, status}` a partir do hostname atual (`window.location.hostname`). Se `status <> 'ativo'`, o frontend mostra "loja indisponível" em vez do catálogo. A partir daí, o `store_id` resolvido fica em memória (mesmo papel que `SUPA_URL`/`SUPA_KEY` já têm hoje) e é passado explicitamente em toda chamada de carrinho/catálogo/checkout.
- **Admin:** o `store_id` vem de um seletor de loja na sessão do admin (Onda 5) — um admin de múltiplas lojas escolhe em qual está operando; a UI guarda isso em estado local e passa explicitamente em toda RPC administrativa, do mesmo jeito.
- **Toda RPC de escrita valida a permissão internamente** (`is_admin_of(p_store_id)` ou o vínculo do cliente àquela loja) — o client nunca é confiável sobre TER permissão, só sobre DIZER qual loja; a RPC sempre reverifica.

---

## 6. Estratégia de isolamento de dados

**Decisão: shared-schema (um banco, uma tabela por entidade, `store_id` em cada linha) + RLS.** Não schema-per-tenant, não database-per-tenant.

Justificativa: volume de dados de ~10 lojas pequenas/médias não justifica o overhead operacional de N schemas/bancos (migrations deixariam de ser escritas uma vez); RLS com `store_id` como coluna líder de índice escala sem esforço adicional por tenant; é o padrão documentado pela própria Supabase para este cenário. Preserva 100% o padrão de RPC `SECURITY DEFINER` como fronteira de escrita que já existe — só adiciona um predicado a mais em cada policy e função.

Toda tabela de negócio existente ganha `store_id` como coluna **nullable primeiro** (retrocompatível), backfill com a loja "encanto", só depois `NOT NULL` — mesma técnica de migração gradual já validada na revalidação da auditoria.

**Exceção deliberada:** `address_gazetteer` (bairro/rua por cidade) é dado geográfico de referência, não dado de negócio de uma loja — duas lojas na mesma cidade **devem** compartilhar esse cache, é reaproveitamento, não vazamento. Fica global, sem `store_id`. `application_logs` fica global por padrão (observabilidade da plataforma), mas ganha um `store_id` **nullable opcional** para permitir filtro por loja quando o log tiver contexto suficiente para preenchê-lo.

---

## 7. Fluxo futuro de onboarding (desenho, Onda 8)

**✅ IMPLEMENTADO (2026-08-10)** — ver `docs/ref/REF-SAAS-01-plano-ondas.md`, seção "Onda 8". Super Admin cria uma linha em `stores` (nome, slug) → RPC `provision_store(p_nome, p_slug, p_admin_email)` cria a loja + tenta o vínculo do admin (se a pessoa já tiver conta) + seeds de `store_settings` (`company_info` com identidade neutra, nunca herdando nome/telefone/whatsapp/paleta da Encanto) → loja fica "ativa" mas sem domínio até o DNS ser configurado manualmente na Vercel (mesmo processo manual já usado hoje para `admin.encanto.valionsistemas.com.br`) → dono da loja configura o mínimo (catálogo, WhatsApp) pelo próprio Admin. Única divergência do desenho original: a criação do vínculo do admin foi desdobrada em sua própria RPC (`link_store_admin(p_store_id, p_admin_email)`), reutilizada por `provision_store` quando um e-mail é informado — permite vincular administradores adicionais depois, sem re-provisionar a loja.

**Addendum (REF-SAAS-02 · Onda 1, 2026-08-10):** a UI do Super Admin deixou de ser uma aba "Plataforma"
dentro do Admin da Encanto — virou um **Platform Console separado** (`PlatformConsole.jsx`), com
identidade/navegação próprias, onde o super admin pousa direto após o login; "Abrir Admin da loja" troca
de contexto para o Admin normal daquela loja, sem duplicar nenhuma tela. Ver
`docs/ref/REF-SAAS-01-plano-ondas.md`, seção "REF-SAAS-02 · Onda 1", para o detalhe completo (RPCs novas
de gestão de tenant, checklist de configuração real, resolução automática de domínio por slug).

## 8. Estratégia de provisionamento

**v1, implementada, é manual/assistida** — Super Admin roda `provision_store(...)` (por uma UI mínima, aba "Plataforma" do Admin, visível só para `is_super_admin()`) e configura DNS à mão, como já acontece hoje. Não é self-service (tela de cadastro público) nesta fundação; isso é trabalho de produto para depois que houver demanda real de mais de ~3 lojas simultâneas. A criação da identidade Auth do admin da loja (o `auth.users` em si) permanece manual (Supabase Dashboard) por decisão explícita — `link_store_admin` só enxerga contas que já existem (leitura por e-mail), nunca cria uma senha nem expõe `service_role` ao frontend.

**WhatsApp por loja (decisão de negócio, não só técnica — ver REF-WHATSAPP-01):** gerenciar números de múltiplos clientes exige a VALION se cadastrar como Tech Provider da Meta (processo de dias, sem custo recorrente) **ou** rotear via BSP já credenciado (sem espera, com custo recorrente por mensagem). Esta fundação não decide qual rota agora — fica registrado como decisão a ser tomada explicitamente no início da Onda 7, com o trade-off já documentado.

---

## 9. Convenções para novas tabelas

1. Toda tabela de dado de negócio de uma loja **tem** `store_id uuid NOT NULL REFERENCES stores(id)`.
2. RLS **habilitado desde o primeiro commit** — nunca "depois". Uma tabela nova sem RLS habilitado não passa revisão.
3. `store_id` é a **coluna líder** de qualquer índice composto novo.
4. Toda constraint `UNIQUE` que hoje seria "global" inclui `store_id` como parte da chave.
5. Exceção precisa ser justificada explicitamente no ADR daquela REF (como §6 fez para `address_gazetteer`) — nunca "esqueceu", sempre "decidiu".

## 10. Convenções para novas RPCs

1. Toda RPC que lê/escreve dado de loja recebe `p_store_id uuid` **explícito** — nunca implícito via GUC/JWT/sessão (§5).
2. Toda RPC de escrita continua `SECURITY DEFINER` e valida `is_admin_of(p_store_id)` (ou o vínculo do cliente àquela loja) como **primeira linha de lógica** — mesmo padrão que `is_admin()` já segue hoje em `set_company_info`/`set_store_mode`/etc.
3. RPCs públicas de leitura (catálogo, `get_store_by_domain`) continuam `STABLE`, sem autenticação obrigatória — mas sempre filtradas por `p_store_id`.

## 11. Convenções para novas policies

1. Toda policy nova em tabela com `store_id` segue o padrão `USING (store_id = <predicado> AND (is_admin_of(store_id) OR <regra de dono>))` — nunca uma policy sem predicado de `store_id` numa tabela que tem a coluna.
2. Se uma tabela é deliberadamente global (§6), a ausência de predicado de loja é documentada no ADR da REF que a criou, não assumida por omissão.

## 12. Convenções para futuras REFs

1. Configuração de loja usa `store_settings(store_id, chave, valor)` (nova, mesmo molde de `settings`) — nunca crie uma chave nova em `settings` (a global) para algo que é claramente config de UMA loja. `settings` fica reservada para o que é genuinamente da plataforma.
2. Toda REF nova que tocar tabela/RPC/policy relacionada a dado de loja cita este ADR e confirma que segue §9–§11 no próprio documento da REF (mesmo padrão de citação cruzada que o projeto já usa entre ADRs).
3. Nenhuma feature nova nasce single-tenant a partir de agora — inclusive se a v1 daquela feature só for usada pela Encanto, o `store_id` já existe no schema desde o primeiro commit.

---

## 13. Roadmap (referência)

A ordem de Ondas 0–9 aprovada na revalidação **não muda** neste ADR — este documento define COMO cada onda será construída (as decisões acima), não a ordem. Resumo:

`Onda 0` fundação de dados → `Onda 1` gateway de autorização (§4) → `Onda 2` RLS/RPCs do catálogo → `Onda 3` (decisão de identidade — **já tomada no §2**, onda passa a ser só implementação) → `Onda 4` RLS/RPCs de pedidos/fidelidade/entrega/horário → `Onda 5` admin multi-loja → `Onda 6` frontend multi-loja → `Onda 7` WhatsApp por loja → `Onda 8` provisionamento → `Onda 9` mobile/Capacitor (decisão de produto, fora do código desta fundação).

Cada onda segue o ciclo obrigatório: auditoria específica → plano técnico → implementação → testes automatizados → testes de regressão → commit → push → documentação → relatório técnico da onda.

## 14. Decisões registradas como revisáveis (não são portas fechadas)

- Identidade de cliente por loja em vez de SSO global (§2) — reabre se surgir um produto agregador real.
- Shared-schema em vez de projeto/banco por loja (§3/§6) — reabre se um cliente exigir isolamento físico contratual.
- Rota A vs. Rota B do WhatsApp (§8) — decisão de negócio explícita no início da Onda 7, não decidida aqui.
- `alert_*` (limiares de observabilidade) continuam em `settings` (global) até a Onda 4 decidir se cada loja precisa de limiares próprios — não resolvido agora de propósito, não é bloqueio para nenhuma onda anterior.
