# ADR NORM-06.1 — HARDEN-RLS (políticas de acesso do catálogo)

- **Status:** 🔒 **CONGELADO (2026-06-29)** — desenho ratificado pelo usuário. **⛔ EXECUÇÃO BLOQUEADA:** o pré-requisito de segurança (signups públicos desabilitados) **NÃO está satisfeito** — verificação em §3/§7 (signups de email **HABILITADOS** em 2026-06-29). A aplicação do runbook §5 só inicia após o bloqueio de signups ser confirmado. Continuidade direta do [NORM-06 §19](NORM-06-collections.md); equivale à fase **F1C** na numeração do NORM-06.
- **Escopo:** **exclusivamente as tabelas de catálogo** — `products`, `categories`, `adicionais`, `product_collections`. **NÃO** toca `orders`/`customers`/`order_items` (decisão D2 → HARDEN próprio).
- **Pré-condição (§19) — VERIFICADA ✅:** o admin autentica de verdade (`db.auth.signInWithPassword`, [App.jsx:1271](../../src/App.jsx#L1271); sessão persistida no mesmo client). Storefront = `anon`; admin = `authenticated`. Logo `authenticated = acesso pleno` **não cega o painel**.
- **Base:** [NORM-06A §3.2 (G9)](NORM-06A-modelo-grupos-catalogo.md) (RLS de coluna local) — **com uma divergência deliberada documentada** (D1, §4).

---

## 0. Estado verificado (ground truth, 2026-06-29 — banco `hvbcdxsagkjtfjwvnslo`)

RLS **ligado** nas 11 tabelas. Policies atuais das tabelas de catálogo:

| Tabela | READ (anon/public) | WRITE | Problema |
|---|---|---|---|
| `products` | `Leitura pública produtos` SELECT public `USING(true)` | `Auth insert/update/delete products` (authenticated) | read vaza indisponíveis (intencional — D1) |
| `categories` | `Leitura pública categorias` SELECT public `USING(true)` | **nenhuma** | **escrita do admin negada por RLS (bug)** |
| `adicionais` | `Leitura pública adicionais` SELECT public `USING(true)` | **nenhuma** | **escrita do admin negada por RLS (bug)** |
| `product_collections` | `pc_public_read` SELECT public `USING(true)` (**provisória** F1A) | **nenhuma** | policy provisória a substituir; sem escrita p/ F4 |

**Bug latente confirmado:** o DataService escreve `categories` ([App.jsx:361-364](../../src/App.jsx#L361)) e `adicionais` ([App.jsx:408-411](../../src/App.jsx#L408)), mas RLS nega (sem policy de escrita). Só `products` escreve (tem policies `authenticated`). NORM-06.1 corrige.

**UX verificada:** a vitrine mostra produtos indisponíveis com overlay "Indisponível" ([App.jsx:636](../../src/App.jsx#L636)); admin tem toggle de disponibilidade ([App.jsx:1681](../../src/App.jsx#L1681)).

---

## 1. Objetivo e escopo

Formalizar e endurecer as políticas RLS do **catálogo**, fechando inconsistências sem mudar o comportamento da loja:
1. dar ao admin (`authenticated`) **escrita coerente** em todo o catálogo (corrige o bug de `categories`/`adicionais`; habilita o F4);
2. **substituir a policy provisória** `pc_public_read` por uma permanente e intencional;
3. **manter a leitura pública** das tabelas de catálogo como está (decisão D1 — preserva comportamento).

**Fora de escopo (deferido):** vazamento de privacidade de `orders`/`customers`/`order_items` (anon lê/edita todos os pedidos) → **HARDEN-ORDERS-RLS** próprio (toca o checkout = código de negócio; merece fase dedicada). E o redesenho "anon = só disponíveis" da §3.2 para `products` (ver D1).

---

## 2. Decisões (ratificadas pelo usuário em 2026-06-29)

- **D1 — leitura de `products`: PRESERVAR (anon lê todos).** A vitrine continua mostrando indisponíveis com overlay. `products`/`categories`/`adicionais` mantêm `SELECT public USING(true)`. **Divergência deliberada da NORM-06A §3.2** (que prescrevia `USING(disponivel)`/`USING(ativo)`) e do objetivo §19 ("anon = só disponíveis") — justificada: (a) ethos do NORM-06 = zero mudança de comportamento; (b) num cardápio público, "indisponível" não é dado sensível. Registrada em §4.
- **D2 — escopo só catálogo.** `orders`/`customers`/`order_items` ficam **inalterados** aqui → HARDEN-ORDERS-RLS próprio.
- **D3 — escrita `authenticated` em `categories` e `adicionais`.** Adicionar policies de INSERT/UPDATE/DELETE para `authenticated` (espelha `products`), fechando o bug e habilitando o F4.

---

## 3. Estado-alvo das policies (o desenho)

> Aditivo e reversível. Mantém **toda leitura pública atual**. Adiciona escrita `authenticated`. Substitui a provisória `pc_public_read` por permanente equivalente.

| Tabela | READ | WRITE (novo/mantido) |
|---|---|---|
| `products` | `USING(true)` (**inalterado** — D1) | `authenticated` ins/upd/del (**inalterado**) |
| `categories` | `USING(true)` (**inalterado**) | **+ `authenticated` ins/upd/del** (D3) |
| `adicionais` | `USING(true)` (**inalterado**) | **+ `authenticated` ins/upd/del** (D3) |
| `product_collections` | `pc_public_read` → **`product_collections_public_read`** `USING(true)` (permanente) | **+ `authenticated` ins/upd/del** (F2 backfill via admin + F4 editor) |

**SQL desenhado** (a aplicar só após congelamento):
```sql
BEGIN;
-- categories: escrita authenticated (espelha products; fecha bug)
CREATE POLICY "Auth insert categorias" ON public.categories FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update categorias" ON public.categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete categorias" ON public.categories FOR DELETE TO authenticated USING (true);
-- adicionais: idem
CREATE POLICY "Auth insert adicionais" ON public.adicionais FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update adicionais" ON public.adicionais FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete adicionais" ON public.adicionais FOR DELETE TO authenticated USING (true);
-- product_collections: substitui provisória + escrita authenticated
DROP POLICY IF EXISTS pc_public_read ON public.product_collections;
CREATE POLICY "Leitura pública coleções" ON public.product_collections FOR SELECT TO public USING (true);
CREATE POLICY "Auth insert coleções" ON public.product_collections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update coleções" ON public.product_collections FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete coleções" ON public.product_collections FOR DELETE TO authenticated USING (true);
COMMIT;
```

**⚠️ Pré-requisito de segurança (BLOQUEANTE — verificar antes de aplicar):** confirmar que **signups públicos estão DESABILITADOS** no Supabase Auth. Como `authenticated` ganha escrita plena no catálogo, se qualquer um puder se auto-registrar, qualquer um escreveria o catálogo. *(Esta exposição já existe hoje para `products`; NORM-06.1 a estende a categories/adicionais/coleções.)*

> **🔴 Verificação 2026-06-29 — REPROVADA (BLOQUEIA a fase):** sonda ao endpoint público `POST /auth/v1/signup` (com a publishable key) **criou um usuário** `authenticated` (HTTP 200) → **signups de email ESTÃO HABILITADOS**. Logo, hoje, qualquer pessoa pode se auto-registrar e obter `authenticated` (já podendo escrever `products`). O usuário-sonda foi imediatamente removido (`auth.users` voltou a 1 = só o admin). Schema `auth`: 0 SSO providers, só identity `email`. **Ação requerida do operador:** Supabase Dashboard → Authentication → Sign In / Providers → **Email → desabilitar "Allow new users to sign up"** (e confirmar que nenhum provider OAuth/SSO concede `authenticated` a externos). Após isso, re-sondar (esperado: `422 signup_disabled`) e então executar o runbook §5.

---

## 4. Divergência deliberada da base congelada (documentada)

| Fonte congelada | O que prescrevia | NORM-06.1 (D1) | Justificativa |
|---|---|---|---|
| NORM-06A §3.2 (G9) | `products USING(disponivel)`, `categories USING(ativo)` | mantém `USING(true)` | preserva overlay "Indisponível"; zero mudança de comportamento; indisponível ≠ sensível num cardápio |
| NORM-06 §19 | "anon = só disponíveis; fechar `USING(true)` em products/categories" | mantém leitura pública | mesma justificativa; o "fechamento" de leitura fica **reservado** (reabrir só se virar requisito de produto) |

Se no futuro "esconder indisponíveis do anon" virar requisito, é um ADR próprio (muda a UI da vitrine + a policy juntas).

---

## 5. Plano de execução (F1C-RLS) — runbook (após congelamento)

Mesmo rigor da F1B (modo acelerado, governança plena):
0. **Gate + backup** `snapshot.mjs NORM-06.1-RLS`; confirmar signups Supabase desabilitados.
1. **Pré-validação (read-only):** mapa de policies atual == §0.
2. **Aplicar** o SQL §3 (atômico).
3. **Validação de schema:** policies-alvo presentes; leituras públicas intactas; provisória `pc_public_read` removida.
4. **Build** verde.
5. **Testes (harness `test:rls`):** anon NÃO escreve catálogo; anon LÊ catálogo (incl. indisponíveis — D1); authenticated escreve as 4 tabelas; checkout (orders) intacto. Em transações revertidas / via 2 conexões (anon vs service) — net-zero.
6. **Funcional:** pedido tel 44 intacto; storefront lê catálogo; admin escreve categories/adicionais (bug corrigido).
7. **Evidências + commit único + doc.**

---

## 6. Rollback

```sql
BEGIN;
DROP POLICY IF EXISTS "Auth insert categorias" ON public.categories;        -- (+ update/delete)
DROP POLICY IF EXISTS "Auth insert adicionais" ON public.adicionais;        -- (+ update/delete)
DROP POLICY IF EXISTS "Auth insert coleções"  ON public.product_collections; -- (+ update/delete)
DROP POLICY IF EXISTS "Leitura pública coleções" ON public.product_collections;
CREATE POLICY pc_public_read ON public.product_collections FOR SELECT TO public USING (true);  -- restaura provisória
COMMIT;
```
Restaura exatamente o estado §0. Nenhuma tabela/coluna/dado tocado.

---

## 7. Riscos

| Risco | Mitigação |
|---|---|
| **Signup público habilitado** → authenticated ≠ só admin | **bloqueante**: confirmar signups desabilitados antes de aplicar (§3) |
| Leitura pública mantida vaza indisponíveis ao anon | **aceito por D1** (não sensível; reservado p/ ADR futuro se virar requisito) |
| `orders`/`customers` continuam abertos ao anon (privacidade) | **fora de escopo (D2)** → HARDEN-ORDERS-RLS (flag explícita; é vazamento real) |
| Escrita authenticated + trigger STI I4 (F1B) | ortogonais — policy autoriza a linha, trigger valida STI; admin toggle de tipo no F4 fica guardado pelo I4 |

---

## 8. Reservado para fases próprias

- **HARDEN-ORDERS-RLS:** fechar `orders`/`customers`/`order_items` (anon só INSERT no checkout + leitura do próprio pedido; authenticated lê tudo). Toca o checkout → fase dedicada com revisão extra.
- **"anon = só disponíveis"** (§3.2 literal): reabrir só se virar requisito de produto (muda UI + policy juntas).

---

> **Próximo passo:** congelar este ADR (você) → executo o runbook §5 com o rigor da F1B (backup, revisão adversarial, harness `test:rls`, rollback). **Antes de aplicar, confirmo a trava de signup no Supabase Auth.**
